// documents/worker coordinator. 준비 worker 2 slot을 띄우고 root별 후보 큐를
// round-robin으로 배분한다(architecture/documents 2.1–2.3). codec은 contracts#T6
// supervision 하나다. kind와 root는 환경으로만 받는다.
import type {
  Frame,
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
  basisFromStore,
  childBlobPort,
  createObservationSubmit,
  linkFromStore,
  retryOnNewBasis,
  sharePreparedBlob,
} from "./observation.ts";
import { createBasisStore } from "./basis.ts";
import { createByteInbox, validateFiles } from "./validation.ts";
import { createFormatHandlers } from "../../../packages/documents/formats/reads.ts";
import { createSearchServing, openSearchStore } from "./search.ts";
import { createRootObservers } from "./observers.ts";
import { createPreparationPool } from "./pool.ts";
import { createBatchDispatch } from "./batch.ts";
import { preparationSpec, previewSpec } from "./launch.ts";
import { createFileHandlers, recordKeyOf } from "./files.ts";
import { denoFileOps } from "../../../packages/documents/file-tracking/adapters/file-ops.ts";
import {
  fileOperationResultSchema,
  projectPreviewTracking,
  projectPreviewTrackingInputSchema,
} from "../../../packages/contracts/documents/mod.ts";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { CoreClient } from "./submit.ts";
import {
  createIdSource,
  cryptoRandom,
  monotonicClock,
  systemClock,
} from "../../../packages/base/mod.ts";
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
  // 준비 결과 command를 core에 제출한다. 제출은 동시 2개까지다. outcome은 준비 worker가
  // 그 후보에 낸 안정 읽기 결과다(dispatchBatch가 있을 때만).
  submitResult(candidate: Candidate, outcome?: unknown): Promise<void>;
  // 후보 묶음을 준비 worker에 보내고 후보 순서대로 결과를 받는다. 없으면 session.send로
  // 보내던 옛 배분을 쓴다. 준비 worker의 실패는 이 배분의 unavailable이다.
  dispatchBatch?(
    slot: PrepareSlot,
    scheduled: { root: string; batch: readonly Candidate[] },
  ): Promise<Result<readonly unknown[], LophnError>>;
  // 안정 읽기까지의 대기와 req id는 주입받는다.
  deps: CoordinatorDepsLike;
  // hello가 싣는 machine credential과 core api port. 제출 client가 Bearer로 쓴다.
  // credential은 log·stderr에 남기지 않는다(child.ts 계약).
  onHello?(hello: { credential: string; api_port: number }): void;
  // core가 보낸 byte chunk frame(format 검사 입력). 없으면 받지 않는다.
  onFrame?(frame: Frame): void;
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
  // 멈출 때 부른다(감독의 stop 요청과 stop()). 관측 loop를 멈추는 자리다.
  onStop(listener: () => void): void;
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
  const stopListeners: (() => void)[] = [];
  const notifyStop = () => {
    for (const listener of stopListeners) listener();
  };
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
      notifyStop();
      wake?.();
      return session.send({ type: "stopped" });
    },
    onFrame(frame) {
      options.onFrame?.(frame);
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
      // 답을 기다리지 않는다: 오래 걸리는 요청(파일 쓰기, 변화 기다리기)이 뒤따르는 요청과
      // byte chunk frame을 막지 않는다. 요청은 request_id로 짝을 짓는다.
      void answer.catch((): WorkerResponse => ({
        type: "worker_response",
        request_id: request.request_id,
        ok: false,
        error: { code: "internal", message: "documents worker request failed" },
      })).then((response) => session.send(response)).catch(() => {
        // 답을 못 보낸 요청은 core의 기한이 unavailable로 끝낸다.
      });
      return;
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
      if (options.dispatchBatch) {
        const answered = await options.dispatchBatch(slot, {
          root: scheduled.root,
          batch: scheduled.batch,
        });
        // 준비 worker가 답하지 못한 배분은 제출하지 않는다. 성공으로 바꾸지 않는다.
        if (!answered.ok) continue;
        for (const [index, candidate] of scheduled.batch.entries()) {
          await options.submitResult(candidate, answered.value[index]);
        }
        continue;
      }
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
    onStop(listener) {
      stopListeners.push(listener);
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
      notifyStop();
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

// 기한 안에 새 관측 근거가 오지 않으면 conflict를 그대로 둔다. 자기 저장 직후 core가
// 새 근거를 보내는 데 걸리는 시간보다 넉넉하다.
const BASIS_RETRY_WAIT_MS = 5_000;

export async function runCoordinator(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  // FileStatus 메모리. 관측이 채우고 core의 documents.file_status 요청이 읽는다.
  const status = createStatusRecorder();
  // core가 감독 pipe로 보낸 관측 근거(Q15). 반영되면 root별 관측 loop를 맞춘다.
  const basis = createBasisStore();
  // format 검사 입력(원문 바이트)을 요청 앞에 받아 두는 곳과 runner 호출.
  const inbox = createByteInbox();
  const formats = createFormatHandlers();
  const ids = createIdSource({
    clock: monotonicClock(systemClock),
    random: cryptoRandom,
  });
  // derived 검색 store. 이 process가 유일한 writer고 search consumer가 core가 보낸 event와
  // 원문으로 채운다. 못 열면 search 요청은 unavailable이고 빈 index로 꾸미지 않는다.
  const store = openSearchStore(root);
  const search = store.ok
    ? createSearchServing({
      store: store.value,
      inbox,
      call: (input) => formats.call(input),
    })
    : undefined;
  // hello가 싣는 machine credential과 core api port로 제출 client를 만든다. 원문 blob은
  // 자식 session이 감독 pipe로 core에 준비한다. credential은 이 process 메모리에만 있다.
  const session: { current?: ChildSession } = {};
  const coordinator: { current?: Coordinator } = {};
  // 준비 worker pool(architecture/documents 2.1). coordinator가 띄우고 감독한다. 권한을 줄
  // root는 core가 보낸 근거의 등록 폴더 전부다(tracking을 껐어도 사람이 쓴다). 관측 root가
  // 아니다. worker는 첫 요청에서 띄운다.
  const rootsOf = () => basis.folders().map((entry) => entry.path);
  const pool = createPreparationPool({
    specFor: () => preparationSpec(root, rootsOf()),
    signature: () => rootsOf().join("\n"),
    denoCommand: Deno.execPath(),
    env: (kind) => ({
      LOPHN_WORKER_KIND: kind,
      LOPHN_HOME: root,
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
    }),
  });
  // 성공한 파일 작업을 machine credential로 기록한다. hello 전에는 core에 닿을 수 없다.
  const core: { client?: CoreClient } = {};
  const files = createFileHandlers({
    dataRoot: root,
    basis,
    pool,
    inbox,
    status,
    ops: denoFileOps(),
    sendBytes: (channel, bytes) => {
      const current = session.current;
      if (current === undefined) {
        return Promise.reject(new Error("core is not connected"));
      }
      return current.sendBytes(channel, bytes);
    },
    nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    async record(result) {
      if (core.client === undefined) {
        return err({ code: "unavailable", message: "core is not connected" });
      }
      const recorded = await core.client.call("files/record_result", {
        input: result,
        idempotency_key: await recordKeyOf(result),
        compare: {},
        prepared: [],
      });
      if (!recorded.ok) return recorded;
      const parsed = fileOperationResultSchema.safeParse(recorded.value);
      return parsed.success
        ? ok(parsed.data)
        : err({ code: "internal", message: "file result is invalid" });
    },
  });
  const created = await createCoordinator({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    onHello(received) {
      const current = session.current;
      if (current === undefined) return;
      const client = createCoreClient({
        baseUrl: `http://127.0.0.1:${received.api_port}`,
        credential: received.credential,
        fetch: productFetch(),
      });
      core.client = client;
      const submit = retryOnNewBasis(
        createObservationSubmit({
          client,
          prepareBlob: sharePreparedBlob(childBlobPort(current)),
          link: linkFromStore(basis, () => ids.newId("doc")),
          status,
          nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
          newKey: () => crypto.randomUUID(),
        }),
        basis,
        BASIS_RETRY_WAIT_MS,
      );
      // root·규칙은 core가 보낸 근거에서 온다. 근거가 오기 전에는 관측하지 않고, 근거에
      // 없는 root는 추적 중으로 꾸미지 않는다.
      const observers = createRootObservers({
        store: basis,
        observe: observeRoot,
        deps: {
          watch: fileWatchPort(),
          scan: fileScanPort(),
          read: fileReadPort(),
          nowMs: () => Date.now(),
          submit,
          basisFor: basisFromStore(basis),
        },
      });
      basis.onCommit(() => observers.sync());
      coordinator.current?.onStop(() => observers.stopAll());
    },
    onFrame: (frame) => inbox.collect(frame),
    handleRequest: createRequestHandler({
      status,
      basis,
      ...(search === undefined
        ? {}
        : { search: (request) => search.handle(request) }),
      files,
      preview: (payload) => previewTracking(pool, payload),
      validate: (request) =>
        validateFiles(request, { inbox, call: (input) => formats.call(input) }),
    }),
    // 준비 worker는 pool이 띄우고 감독한다(platform createSupervisor를 slot마다 하나씩).
    // coordinator 자신의 slot 감독(slots)은 쓰지 않는다. 파일 관측은 이 process의 관측
    // loop가 직접 한다: 관측 제출은 읽은 바이트를 core의 blob으로 준비해야 해서 읽기를
    // 준비 worker로 옮기려면 바이트 전달이 따로 있어야 한다. 그래서 후보 배분의 결과
    // 제출은 연결하지 않았고 성공이 아니라 unavailable이다.
    spawnPreparation: () => {
      throw new Error("preparation spawn is owned by the pool");
    },
    dispatchBatch: createBatchDispatch(pool),
    submitResult: () =>
      Promise.reject(new Error("preparation results are not submitted yet")),
    deps: {
      nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      newRequestId: () => crypto.randomUUID(),
    },
  });
  coordinator.current = created;
  session.current = created.session;
  if (search !== undefined) created.onStop(() => search.close());
  created.onStop(() => void pool.stop());
  await created.session.run();
}

// 폴더 미리보기. 아직 등록하지 않은 폴더를 읽어야 해서 그 폴더만 읽는 새 준비 worker 하나가
// 한 번 맡는다. 폴더는 사람이 고른 것이고(route는 user만) 그 요청의 읽기 권한으로만 준다.
function previewTracking(
  pool: ReturnType<typeof createPreparationPool>,
  payload: unknown,
): Promise<Result<unknown, LophnError>> {
  const parsed = projectPreviewTrackingInputSchema.safeParse(payload);
  const spec = parsed.success
    ? previewSpec(parsed.data.folders.map((folder) => folder.path))
    : undefined;
  if (!parsed.success || spec === undefined) {
    return Promise.resolve(
      err({ code: "invalid_input", message: "invalid preview input" }),
    );
  }
  return pool.requestOnce(spec, {
    op: projectPreviewTracking.name,
    payload: parsed.data,
    timeoutMs: 60_000,
  });
}
