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
  spawnProcess,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import { launchArgv } from "../../../packages/platform/security/mod.ts";
import { type SlotSupervisor, supervisePreparationSlots } from "./slots.ts";
import {
  type Candidate,
  CANDIDATE_LIMIT,
  type CandidateQueue,
  type CoordinatorDepsLike,
  dispatchBatch,
  emptyQueue,
  enqueueCandidate,
  type ObserveDeps,
  type ObserveRoot,
  observeRoot,
  pickSlot,
  PREPARATION_SLOTS,
  type PrepareSlot,
} from "../../../packages/documents/file-tracking/mod.ts";
import { postDocumentSave, productSaveFetch } from "./submit.ts";
import type { SaveClientOptions } from "./submit.ts";

export type CoordinatorOptions = {
  root: string;
  streams: ChildStreams;
  // 준비 worker를 띄우고 지켜본다. 테스트가 넣는다.
  spawnPreparation(kind: string): Promise<ChildSession>;
  // 준비 결과 command를 core에 제출한다. 제출은 동시 2개까지다.
  submitResult(candidate: Candidate): Promise<void>;
  // 안정 읽기까지의 대기와 req id는 주입받는다.
  deps: CoordinatorDepsLike;
  // 준비 slot 감독. 없으면 coordinator가 자기 것으로 만든다.
  // 테스트가 backoff sleep과 재시작 한도를 바꿔 끼운다.
  slots?: SlotSupervisor;
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
  // root마다 watch·60초 scan·750ms 관측 루프를 돌린다. 제출은 submitResult로 간다.
  startObservation(roots: readonly ObserveRoot[], deps: ObserveDeps): void;
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
  // crash한 slot은 같은 이름의 새 프로세스로 채운다. 재시작은 한도와 backoff 뒤다.
  const supervisor = options.slots ??
    supervisePreparationSlots({ spawn: options.spawnPreparation });
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
      const slot = pickSlot(slots, false);
      if (!slot) continue;
      let worker: ChildSession;
      try {
        worker = await supervisor.acquire(slot.name);
      } catch {
        // 준비 worker를 못 띄우거나 재시작 한도를 넘기면 이 배분은 unavailable이다.
        // 큐에 되돌리지 않고, 같은 배분을 바로 다시 시도하지 않는다.
        return;
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
        // crash한 slot은 다음 배분이 새 프로세스로 다시 채운다.
        supervisor.release(slot.name);
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
    startObservation(roots, deps) {
      for (const request of roots) {
        // 루프는 root별로 독립이다. 한 root의 큰 scan이 다른 root를 막지 않는다.
        void observeRoot({
          ...deps,
          stop: {
            get stopped() {
              return stopped;
            },
          },
        }, request);
      }
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
      return supervisor.stop();
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
  // hello가 싣는 credential과 api_port는 결과 제출 client가 Bearer로 쓴다.
  // child.ts 계약이 credential을 log·stderr에 남기지 않는다고 본다.
  const position: { credential?: string; apiPort?: number } = {};
  // 준비 worker spec은 이 entry가 직접 만든다. 감독 계약(platform#T7)과 같은
  // 모양이다: launchArgv에 넣기 전 checkLaunchSpec이 권한을 거절한다. entry는
  // 이 module 옆의 preparation.ts다(apps/worker는 core package를 import하지 않는다).
  const entry = new URL("./preparation.ts", import.meta.url).pathname;
  const preparationSpec = {
    kind: "documents/preparation",
    entry,
    allow_read: [root],
    allow_write: [`${root}/documents`, `${root}/derived`],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  } as const;
  const check = checkLaunchSpec(preparationSpec);
  if (!check.ok) throw new Error(check.error.message);
  // 준비 worker는 감독 계약과 같은 argv로 자식 프로세스로 띄운다(platform#T7).
  const spawnPreparation = async (kind: string): Promise<ChildSession> => {
    const child = spawnProcess({
      command: Deno.execPath(),
      args: launchArgv(check.value),
      env: {
        LOPHN_WORKER_KIND: "documents/preparation",
        LOPHN_HOME: root,
        // deno는 이 둘 없이 캐시와 실행 파일을 못 찾는다. 그 밖 환경은 복사하지 않는다.
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
      },
    });
    const session = await startChild(
      {
        stdin: child.stdout,
        stdout: child.stdin,
        stderr: child.stderr,
      },
      {
        onHello() {},
        onStop() {
          void child.terminate();
        },
      },
    );
    void kind;
    return session;
  };
  const coordinator = await createCoordinator({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    spawnPreparation,
    submitResult: () => Promise.resolve(),
    deps: {
      nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      newRequestId: () => crypto.randomUUID(),
    },
  });
  await coordinator.session.run();
  void position;
}
