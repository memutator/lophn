// documents/worker coordinator. 준비 worker 2 slot을 띄우고 root별 후보 큐를
// round-robin으로 배분한다(architecture/documents 2.1–2.3). codec은 contracts#T6
// supervision 하나다. kind와 root는 환경으로만 받는다.
import type {
  KindLaunchSpec,
  ParentMessage,
} from "../../../packages/contracts/platform/mod.ts";
import {
  processKindSchema,
  workerRequestEnvelopeSchema,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  type Candidate,
  CANDIDATE_LIMIT,
  type CandidateQueue,
  type CoordinatorDepsLike,
  dispatchBatch,
  emptyQueue,
  enqueueCandidate,
  pickSlot,
  PREPARATION_SLOTS,
  type PrepareSlot,
} from "../../../packages/documents/file-tracking/mod.ts";

export type CoordinatorOptions = {
  root: string;
  streams: ChildStreams;
  // 준비 worker를 띄우고 지켜본다. 테스트가 넣는다.
  spawnPreparation(kind: string): Promise<ChildSession>;
  // 준비 결과 command를 core에 제출한다. 제출은 동시 2개까지다.
  submitResult(candidate: Candidate): Promise<void>;
  // 안정 읽기까지의 대기와 req id는 주입받는다.
  deps: CoordinatorDepsLike;
};

export type ScanRootInput = {
  path: string;
};

export type Coordinator = {
  session: ChildSession;
  // root별 후보 큐와 준비 slot. T2 뼈대는 이 상태를 쥔다.
  readonly queues: readonly CandidateQueue[];
  readonly slots: readonly PrepareSlot[];
  // root당 후보 10,000 초과면 rescan_required 하나만 남긴다.
  addCandidate(root: string, path: string): void;
  dispatchRoots(roots: readonly ScanRootInput[]): void;
  stop(): Promise<void>;
};

export type CoordinatorSpec = KindLaunchSpec;

export function createCoordinator(
  options: CoordinatorOptions,
): Coordinator {
  const queues: CandidateQueue[] = [];
  const slots: PrepareSlot[] = [];
  for (let index = 0; index < PREPARATION_SLOTS; index++) {
    slots.push({
      name: `preparation-${index === 0 ? "human" : "background"}`,
      priority: index === 0 ? "human" : "background",
      state: "idle",
    });
  }
  let lastServed = -1;
  let stopped = false;
  let drained = false;
  let wake: (() => void) | undefined;
  const draining = new Promise<void>((resolve) => {
    wake = resolve;
  }).then(() => {});

  const session = startChild(options.streams, {
    onHello(hello) {
      const parsed = processKindSchema.safeParse(hello.kind);
      if (!parsed.success || parsed.data !== "documents/worker") {
        throw new Error("invalid worker kind");
      }
      session.send({ type: "ready" }).then(() => {
        if (!stopped) void drain();
      }).catch(() => {
        // ready 전송 실패는 onStop 경로로 끝난다.
      });
    },
    onStop() {
      stopped = true;
      wake?.();
      return session.send({ type: "stopped" });
    },
    onParent(message) {
      if (message.type !== "worker_request") return;
      // coordinator가 parent pipe에서 받는 worker_request는 core의 root 교체·scan 예약이다.
      // 본문은 workerRequestEnvelopeSchema의 payload다.
      const parsed = workerRequestEnvelopeSchema.safeParse(message);
      if (!parsed.success) return;
      return Promise.resolve();
    },
  });

  // round-robin 배분 루프. 줄 선 root를 돌고 각 root에서 최대 128 entry씩 내보낸다.
  async function drain() {
    while (!stopped) {
      const scheduled = dispatchBatch(queues, lastServed);
      if (!scheduled) {
        if (drained) break;
        drained = true;
        await draining;
        continue;
      }
      drained = false;
      lastServed = scheduled.next;
      let worker: Awaited<ReturnType<typeof options.spawnPreparation>>;
      try {
        worker = await options.spawnPreparation(
          pickSlot(slots, false)?.name ?? "",
        );
      } catch {
        // 준비 worker를 못 띄우면 이 배분은 unavailable이다. 큐에 되돌리지 않는다.
        continue;
      }
      const result = {
        batch: scheduled.batch,
        root: scheduled.root,
      };
      try {
        await worker.send({
          type: "worker_response",
          request_id: options.deps.newRequestId(),
          ok: true,
          payload: result,
        });
      } catch {
        // IPC 종료는 이 배분의 unavailable이다. 성공으로 바꾸지 않는다.
        continue;
      }
      for (const candidate of scheduled.batch) {
        await options.submitResult(
          candidate,
        );
      }
    }
  }

  return {
    session,
    get queues() {
      return queues;
    },
    get slots() {
      return slots;
    },
    addCandidate(root, path) {
      const queue = queues.find((queue) => queue.root === root) ??
        emptyQueue(root);
      if (!queues.includes(queue)) queues.push(queue);
      enqueueCandidate(queue, {
        root,
        path,
        observedAt: options.deps.nowIso(),
      });
      drained = false;
      wake?.();
      void CANDIDATE_LIMIT;
    },
    dispatchRoots(inputs) {
      for (const input of inputs) {
        if (!queues.some((queue) => queue.root === input.path)) {
          queues.push(emptyQueue(input.path));
        }
      }
      drained = false;
      wake?.();
    },
    stop() {
      stopped = true;
      wake?.();
      return Promise.resolve();
    },
  };
}

export function coordinatorHello(
  epoch: string,
  apiPort: number,
): ParentMessage {
  return {
    type: "hello",
    core_epoch: epoch,
    process_identity: epoch,
    kind: "documents/worker",
    task: "documents",
    scope: { operations: [], targets: {} },
    credential: "documents-worker",
    api_port: apiPort,
  };
}

export async function runCoordinator(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const coordinator = await createCoordinator({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    // 준비 worker와 결과 제출은 core/T11 조립이 넣는다. 뼈대는 세션만 연다.
    spawnPreparation: () => {
      throw new Error("preparation spawn is not wired");
    },
    submitResult: () => Promise.resolve(),
    deps: {
      nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      newRequestId: () => crypto.randomUUID(),
    },
  });
  await coordinator.session.run();
}
