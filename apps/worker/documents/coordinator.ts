// documents/worker coordinator. 준비 worker 2 slot을 띄우고 root별 후보 큐를
// round-robin으로 배분한다(architecture/documents 2.1–2.3). codec은 contracts#T6
// supervision 하나다. kind와 root는 환경으로만 받는다.
import type {
  KindLaunchSpec,
  ParentMessage,
  WorkerRequest,
  WorkerResponse,
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
import { createStatusRecorder } from "../../../packages/documents/file-tracking/mod.ts";
import { createRequestHandler } from "./requests.ts";
import {
  childBlobPort,
  createObservationSubmit,
  readObservationSource,
  unavailableLink,
} from "./observation.ts";
import {
  fileReadPort,
  fileScanPort,
  fileWatchPort,
} from "../../../packages/documents/file-tracking/fs.ts";
import { createCoreClient, productFetch } from "./submit.ts";
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

export type CoordinatorOptions = {
  root: string;
  streams: ChildStreams;
  // 준비 worker를 띄우고 지켜본다. 테스트가 넣는다.
  spawnPreparation(kind: string): Promise<ChildSession>;
  // 준비 결과 command를 core에 제출한다. 제출은 동시 2개까지다.
  submitResult(candidate: Candidate): Promise<void>;
  // 안정 읽기까지의 대기와 req id는 주입받는다.
  deps: CoordinatorDepsLike;
  // hello가 싣는 machine credential과 core api port. 제출 client가 Bearer로 쓴다.
  // credential은 log·stderr에 남기지 않는다(child.ts 계약).
  onHello?(hello: { credential: string; api_port: number }): void;
  // core가 감독 pipe로 보내는 worker_request의 처리. 답은 같은 request_id의
  // worker_response다. 없으면 요청은 unavailable로 답한다(조용히 버리지 않는다).
  handleRequest?(request: WorkerRequest): Promise<WorkerResponse>;
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
      options.onHello?.({
        credential: hello.credential,
        api_port: hello.api_port,
      });
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
      const request = parsed.data;
      const answer = options.handleRequest
        ? options.handleRequest(request)
        : Promise.resolve<WorkerResponse>({
          type: "worker_response",
          request_id: request.request_id,
          ok: false,
          error: {
            code: "unavailable",
            message: "documents worker does not serve requests",
          },
        });
      return answer.catch((): WorkerResponse => ({
        type: "worker_response",
        request_id: request.request_id,
        ok: false,
        error: { code: "internal", message: "documents worker request failed" },
      })).then((response) => session.send(response));
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
  // FileStatus 메모리. 관측이 채우고 core의 documents.file_status 요청이 읽는다.
  const status = createStatusRecorder();
  // hello가 싣는 machine credential과 core api port로 제출 client를 만든다. 원문 blob은
  // 자식 session이 감독 pipe로 core에 준비한다. credential은 이 process 메모리에만 있다.
  const session: { current?: ChildSession } = {};
  const coordinator: { current?: Coordinator } = {};
  const created = await createCoordinator({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    onHello(received) {
      const current = session.current;
      if (current === undefined) return;
      const submit = createObservationSubmit({
        client: createCoreClient({
          baseUrl: `http://127.0.0.1:${received.api_port}`,
          credential: received.credential,
          fetch: productFetch(),
        }),
        prepareBlob: childBlobPort(current),
        // 연결 근거 read가 생기면 core read로 바꾼다(Q15). 그 전에는 시작하지 않는다.
        link: () => Promise.resolve(unavailableLink()),
        status,
        nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
        newKey: () => crypto.randomUUID(),
      });
      const source = readObservationSource();
      // root·규칙을 읽지 못하면 관측하지 않는다. 추적 중으로 꾸미지 않는다.
      if (!source.ok) return;
      coordinator.current?.startObservation(source.value.roots, {
        watch: fileWatchPort(),
        scan: fileScanPort(),
        read: fileReadPort(),
        nowMs: () => Date.now(),
        submit,
        basisFor: source.value.basisFor,
      });
    },
    handleRequest: createRequestHandler({ status }),
    // 준비 worker spawn(platform#T7)과 그 결과 제출이 들어오기 전에는 batch가 준비
    // worker에 닿지 않는다. 그때까지 제출은 성공이 아니라 unavailable이다.
    spawnPreparation: () => {
      throw new Error("preparation spawn is not wired");
    },
    submitResult: () =>
      Promise.reject(new Error("preparation results are not submitted yet")),
    deps: {
      nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      newRequestId: () => crypto.randomUUID(),
    },
  });
  coordinator.current = created;
  session.current = created.session;
  await created.session.run();
}
