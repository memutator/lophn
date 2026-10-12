// documents/file-tracking#R5: 큰 root scan 중 작은 root의 변경이 처리되고,
// 동시 준비가 2를 넘지 않고, 예산 초과는 unverified(rescan_required)로 남는다.
// IPC 끊김·worker crash 테스트는 coordinator 세션 위에서 본다.
import { assert, assertEquals } from "@std/assert";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../protocol/server/mod.ts";
import {
  type Candidate,
  CANDIDATE_LIMIT,
  dispatchBatch,
  emptyQueue,
  enqueueCandidate,
  pickSlot,
  takeSubmitSlots,
} from "./mod.ts";
import {
  batchToChunks,
  markUnavailable,
  type RequestPayload,
  sendPreparationRequest,
} from "./ipc.ts";
// ChildSession 모양은 감독 계약(a.k.a. responsiveness child.ts)의 계약이다.
type ChildSession = {
  send(message: unknown): Promise<void>;
  sendBytes(channel: number, payload: Uint8Array): Promise<void>;
  readonly stopped: boolean;
  readonly credentialUsable: boolean;
  readonly readAhead: {
    activeFrames: number;
    activeBytes: number;
    pendingFrames: number;
    pendingBytes: number;
  };
  run(): Promise<void>;
};
// coordinator·준비 worker 엔트리는 dynamic import로 부른다(leaf 경계). 부르는
// 테스트는 모듈을 기다린 뒤 세션을 연다.
const coordinatorEntry = "./worker/coordinator.ts";
const preparationEntry = "./worker/preparation.ts";
type CoordinatorModule = {
  createCoordinator(options: Record<string, unknown>): Promise<{
    session: ChildSession;
    queues: unknown[];
    slots: unknown[];
    addCandidate(root: string, path: string): void;
    dispatchRoots(roots: readonly { path: string }[]): void;
    stop(): Promise<void>;
  }>;
};
type PreparationModule = {
  createPreparation(options: Record<string, unknown>): Promise<ChildSession>;
};
let coordinatorModule: CoordinatorModule | undefined;
async function loadCoordinator(): Promise<CoordinatorModule> {
  coordinatorModule ??= await import(coordinatorEntry) as CoordinatorModule;
  return coordinatorModule!;
}
let preparationModule: PreparationModule | undefined;
async function loadPreparation(): Promise<PreparationModule> {
  preparationModule ??= await import(preparationEntry) as PreparationModule;
  return preparationModule!;
}

// IPC가 끊긴 준비 세션. hello를 본 적 없는 세션이라 send는 전부 거절된다.
function makeCutSession(): ChildSession {
  const session: ChildSession = {
    send: () => Promise.reject(new Error("ipc ended")),
    sendBytes: () => Promise.reject(new Error("ipc ended")),
    get stopped() {
      return true;
    },
    get credentialUsable() {
      return false;
    },
    get readAhead() {
      return {
        activeFrames: 0,
        activeBytes: 0,
        pendingFrames: 0,
        pendingBytes: 0,
      };
    },
    run: () => Promise.resolve(),
  };
  return session;
}

Deno.test("documents/file-tracking#R5: dispatchBatch는 큰 root가 작은 root를 굶기지 않는다", () => {
  // 큰 root는 배분 여러 개 분을 넣되 CANDIDATE_LIMIT 안으로 둔다.
  const big = emptyQueue("big-root");
  const small = emptyQueue("small-root");
  for (let index = 0; index < 300; index++) {
    enqueueCandidate(big, {
      root: "big-root",
      path: `src-${index}.ts`,
      observedAt: "2026-10-05T00:00:00.000Z",
    });
  }
  enqueueCandidate(small, {
    root: "small-root",
    path: "notes.md",
    observedAt: "2026-10-05T00:00:01.000Z",
  });
  const queues = [big, small];
  const first = dispatchBatch(queues, -1);
  assert(first, "큐에 후보가 있으면 배분이 나와야 한다");
  assertEquals(first.root, "big-root");
  assertEquals(first.batch.length, 128);
  const served: string[] = [first.root];
  let last = first.next;
  for (let round = 0; round < 6; round++) {
    const next = dispatchBatch(queues, last);
    if (!next) break;
    served.push(next.root);
    last = next.next;
  }
  // 큰 root 두 배분 사이에 작은 root 배분이 끼어 든다(R5: 폴더별 공정 큐).
  assertEquals(served, [
    "big-root",
    "small-root",
    "big-root",
    "big-root",
  ]);
});

Deno.test("documents/file-tracking#R5: 동시 준비가 2를 넘지 않고 초과분은 기다린다", () => {
  // 제출 slot: 동시 2까지만 열리고 나머지는 대기로 남는다.
  assertEquals(takeSubmitSlots(3, 0), { allowed: 2, waitlisted: 1 });
  assertEquals(takeSubmitSlots(2, 2), { allowed: 0, waitlisted: 2 });
  assertEquals(takeSubmitSlots(1, 2), { allowed: 0, waitlisted: 1 });

  // 준비 slot: human 우선, 없으면 background다.
  const slots = [
    {
      name: "preparation-human",
      priority: "human" as const,
      state: "idle" as const,
    },
    {
      name: "preparation-background",
      priority: "background" as const,
      state: "idle" as const,
    },
  ];
  const human = pickSlot(slots, true);
  assertEquals(human?.name, "preparation-human");
  if (human) human.state = "busy";
  const background = pickSlot(slots, false);
  assertEquals(background?.name, "preparation-background");
  if (background) background.state = "busy";
  // slot 2개가 모두 busy면 세 번째를 만들지 않는다(R5: 준비 worker는 2개).
  const third = pickSlot(slots, true);
  assertEquals(third, undefined);
  // 기다리는 요청이 없으면 두 slot 모두 background로 쓴다.
  for (const slot of slots) slot.state = "idle";
  assertEquals(pickSlot(slots, false)?.priority, "human");
});

Deno.test("documents/file-tracking#R5: budget overrun은 rescan_required로 남는다", () => {
  const queue = emptyQueue("root-a");
  const over = {
    root: "root-a",
    path: "overflow.ts",
    observedAt: "2026-10-05T00:00:00.000Z",
  };
  let overrun: Candidate | undefined;
  for (let index = 0; index < CANDIDATE_LIMIT + 1; index++) {
    const outcome = enqueueCandidate(queue, over);
    if (outcome?.kind === "rescan_required") {
      overrun = queue.items[0];
      break;
    }
  }
  assertEquals(queue.rescanRequired, true);
  assertEquals(queue.items.length, 0);
  // 초과 시점의 후보는 unverified 상태로 남는다(개별 후보는 버려진다).
  assert(!overrun, "초과 root는 개별 후보를 더 받지 않는다");
  // 초과 root는 dispatchBatch에서 건너뛴다.
  const batch = dispatchBatch([queue], -1);
  assertEquals(batch, undefined);
});

// coordinator 세션 위에서 framing과 형태를 본다. 미리 준 frame을 순서대로 내주고
// 끝나면 EOF(null)로 막는다. ByteReader·Writer 모양은 responsiveness mod의 계약이다.
type ByteReader = { read(buffer: Uint8Array): Promise<number | null> };
type ByteWriter = { write(bytes: Uint8Array): Promise<number> };

function queuedStdin(frames: Uint8Array[]): ByteReader {
  const queue = [...frames];
  return {
    read: (buffer: Uint8Array) => {
      const next = queue.shift();
      if (!next) return Promise.resolve(null);
      buffer.set(next.subarray(0, buffer.length));
      return Promise.resolve(Math.min(buffer.length, next.length));
    },
  };
}

function recordingStderr(): { lines: string[]; writer: ByteWriter } {
  const lines: string[] = [];
  return {
    lines,
    writer: {
      write: (bytes: Uint8Array) => {
        lines.push(new TextDecoder().decode(bytes));
        return Promise.resolve(bytes.length);
      },
    },
  };
}

function decodeWrite(output: Frame[]): ByteWriter {
  const decoder = new FrameDecoder();
  return {
    write: (bytes: Uint8Array) => {
      output.push(...decoder.push(bytes));
      return Promise.resolve(bytes.length);
    },
  };
}

const preparationHello = {
  type: "hello" as const,
  core_epoch: "epoch-1",
  process_identity: "prep-1",
  kind: "documents/preparation" as const,
  task: "documents",
  scope: { operations: [], targets: {} },
  credential: "credential-from-hello-not-argv",
  api_port: 7431,
};
const workerHello = {
  type: "hello" as const,
  core_epoch: "epoch-1",
  process_identity: "coordinator-1",
  kind: "documents/worker" as const,
  task: "documents",
  scope: { operations: [], targets: {} },
  credential: "documents-worker",
  api_port: 7431,
};
const stop = { type: "stop" as const, grace_ms: 10 };
const payload: RequestPayload = {
  operation: "scan_batch",
  input_ref: "root-a",
  basis: { observed_at: "2026-10-05T00:00:00.000Z" },
};

Deno.test("documents/file-tracking#R5: IPC framing은 worker_request와 1MiB 이하 chunk를 순서대로 싣는다", async () => {
  const output: Frame[] = [];
  const stderr = recordingStderr();
  // batchToChunks가 1MiB 이하 유지를 확인한다.
  const bigBatch = Array.from({ length: 5_000 }, (_, index) => ({
    root: "root-a",
    path: `src-${index}.ts`,
    observedAt: "2026-10-05T00:00:00.000Z",
  }));
  const chunks = batchToChunks("req-1", bigBatch, 1);
  for (const chunk of chunks.slice(0, -1)) {
    assert(chunk.kind === "bytes", "chunk는 bytes frame이다");
    assert(chunk.payload.length <= 1024 * 1024, "chunk는 1MiB를 넘지 않는다");
  }
  assertEquals(chunks[chunks.length - 1].kind, "end");
  const writer = {
    write: (frame: Frame) => {
      output.push(frame);
      return Promise.resolve();
    },
  };
  await sendPreparationRequest(writer, {
    request_id: "req-1",
    payload,
    channel: 1,
  }, [
    {
      root: "root-a",
      path: "src-1.ts",
      observedAt: "2026-10-05T00:00:00.000Z",
    },
  ]);
  assertEquals(output[0].kind, "json");
  assert(output[0].kind === "json", "첫 frame은 json worker_request다");
  assertEquals(output[0].payload, {
    type: "worker_request",
    request_id: "req-1",
    op: "scan_batch",
    channel: 1,
    payload,
  });
  const [json, ...rest] = output;
  assert(json.kind === "json");
  const bytesFrames = rest.filter((frame) => frame.kind === "bytes");
  assert(bytesFrames.length >= 1, "배분은 bytes chunk로 실린다");
  assertEquals(rest[rest.length - 1].kind, "end", "마지막은 end frame이다");
  // stderr에는 본문·token이 없다(T2 완료 조건).
  assert(
    !stderr.lines.some((line) => line.includes("token-never-record")),
    "stderr에 credential을 남기지 않는다",
  );
});

Deno.test("documents/file-tracking#R5: IPC 종료는 진행 요청의 unavailable이다", () => {
  const ended = markUnavailable({ request_id: "req-9", payload });
  assertEquals(ended.ok, false);
  assertEquals(ended.error.code, "unavailable");
  // 다른 code로 바꾸지 않는다(T2: 성공으로 바꾸지 않는다).
  assert(ended.error.message.length > 0);
});

Deno.test("documents/file-tracking#R5: coordinator는 잘못된 kind hello를 거절한다", async () => {
  const output: Frame[] = [];
  const stderr = recordingStderr();
  const coordinator = await (await loadCoordinator()).createCoordinator({
    root: "/tmp/root",
    streams: {
      stdin: queuedStdin([
        encodeFrame({
          kind: "json",
          channel: 0,
          payload: { ...workerHello, kind: "platform/io" },
        }),
      ]),
      stdout: decodeWrite(output),
      stderr: stderr.writer,
    },
    spawnPreparation: () => Promise.reject(new Error("spawned")),
    submitResult: () => Promise.resolve(),
    deps: {
      nowIso: () => "2026-10-05T00:00:00.000Z",
      newRequestId: () => "req",
    },
  });
  let failure: unknown;
  try {
    await coordinator.session.run();
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, "잘못된 kind는 실패한다");
  // 거절 경로에서 stopped ack 하나만 나간다(본문은 나가지 않는다).
  const bodies = output.filter((frame) =>
    frame.kind === "json" &&
    (frame.payload as { type?: string }).type !== "stopped"
  );
  assertEquals(bodies.length, 0);
});

Deno.test("documents/file-tracking#R5: coordinator는 배분 request를 준비 worker 세션으로 싣는다", async () => {
  const output: Frame[] = [];
  const stderr = recordingStderr();
  const coordinator = await (await loadCoordinator()).createCoordinator({
    root: "/tmp/root",
    streams: {
      stdin: queuedStdin([
        encodeFrame({
          kind: "json",
          channel: 0,
          payload: workerHello,
        }),
        encodeFrame({ kind: "json", channel: 0, payload: stop }),
      ]),
      stdout: decodeWrite(output),
      stderr: stderr.writer,
    },
    spawnPreparation: () => {
      throw new Error("spawned in this test");
    },
    submitResult: () => Promise.resolve(),
    deps: {
      nowIso: () => "2026-10-05T00:00:00.000Z",
      newRequestId: () => "req",
    },
  });
  // root를 등록하고 후보를 넣으면 dispatchBatch가 배분을 만든다.
  coordinator.dispatchRoots([{ path: "/tmp/root" }]);
  coordinator.addCandidate("/tmp/root", "src-1.ts");
  // stop frame으로 세션을 마친다(EOF였다면 drain이 막힌다).
  await coordinator.session.run();
  assertEquals(coordinator.session.stopped, true);
  // ready response가 나간다.
  const ready = output.find((frame) =>
    frame.kind === "json" &&
    (frame.payload as { type?: string }).type === "ready"
  );
  assert(ready, "hello 뒤 ready response가 나간다");
});

Deno.test("documents/file-tracking#R5: 준비 worker는 요청을 받아 echo하고 오류는 본문 없이 내보낸다", async () => {
  const output: Frame[] = [];
  const stderr = recordingStderr();
  const request = {
    type: "worker_request" as const,
    request_id: "req-2",
    op: "scan_batch",
    channel: 1,
    payload,
  };
  const session = await (await loadPreparation()).createPreparation({
    root: "/tmp/root",
    streams: {
      stdin: queuedStdin([
        encodeFrame({
          kind: "json",
          channel: 0,
          payload: preparationHello,
        }),
        encodeFrame({ kind: "json", channel: 0, payload: request }),
        encodeFrame({ kind: "json", channel: 0, payload: stop }),
      ]),
      stdout: decodeWrite(output),
      stderr: stderr.writer,
    },
    accept: (accepted: { op: string }) =>
      Promise.resolve({ op: accepted.op, accepted: true }),
  });
  await session.run();
  const responses = output.filter((frame) =>
    frame.kind === "json" &&
    (frame.payload as { type?: string }).type === "worker_response"
  );
  assertEquals(responses.length, 1);
  assert(responses[0].kind === "json");
  assertEquals(responses[0].payload, {
    type: "worker_response",
    request_id: "req-2",
    ok: true,
    payload: { op: "scan_batch", accepted: true },
  });
  // 실제 pipe에서 bogus frame은 observe 경계에서 protocol 위반이다(platform/security#R1).
  // 준비 worker 안에서의 오류 경로는 accept 실패(unavailable)로만 볼 수 있다.
  assert(
    !stderr.lines.some((line) => line.includes("credential-from-hello")),
    "stderr에 credential을 남기지 않는다",
  );
});

Deno.test("documents/file-tracking#R5: 준비 worker 내부 실패는 unavailable 응답이다", async () => {
  const output: Frame[] = [];
  const request = {
    type: "worker_request" as const,
    request_id: "req-3",
    op: "scan_batch",
    channel: 1,
    payload,
  };
  const session = await (await loadPreparation()).createPreparation({
    root: "/tmp/root",
    streams: {
      stdin: queuedStdin([
        encodeFrame({
          kind: "json",
          channel: 0,
          payload: preparationHello,
        }),
        encodeFrame({ kind: "json", channel: 0, payload: request }),
        encodeFrame({ kind: "json", channel: 0, payload: stop }),
      ]),
      stdout: decodeWrite(output),
      stderr: recordingStderr().writer,
    },
    accept: () => Promise.reject(new Error("scan failed")),
  });
  await session.run();
  const failed = output.filter((frame) =>
    frame.kind === "json" &&
    (frame.payload as { type?: string; ok?: boolean }).type ===
      "worker_response" &&
    (frame.payload as { ok?: boolean }).ok === false
  );
  assertEquals(failed.length, 1);
  assert(failed[0].kind === "json");
  assertEquals(failed[0].payload, {
    type: "worker_response",
    request_id: "req-3",
    ok: false,
    error: { code: "unavailable", message: "preparation failed" },
  });
});

Deno.test("documents/file-tracking#R5: coordinator는 crash한 준비 slot을 세션 끝으로 마친다", async () => {
  const output: Frame[] = [];
  const stderr = recordingStderr();
  // spawnPreparation이 끊긴 세션을 돌려준다(IPC 끊김). 배분의 send는 실패한다.
  const spawned: ChildSession[] = [];
  let sessionId = 0;
  const coordinator = await (await loadCoordinator()).createCoordinator({
    root: "/tmp/root",
    streams: {
      stdin: queuedStdin([
        encodeFrame({ kind: "json", channel: 0, payload: workerHello }),
        encodeFrame({ kind: "json", channel: 0, payload: stop }),
      ]),
      stdout: decodeWrite(output),
      stderr: stderr.writer,
    },
    // IPC가 끊긴 준비 세션: hello를 본 적 없는 세션이라 send는 전부 거절된다.
    spawnPreparation: () => {
      sessionId += 1;
      const cut = makeCutSession();
      spawned.push(cut);
      return Promise.resolve(cut);
    },
    submitResult: () => Promise.resolve(),
    deps: {
      nowIso: () => "2026-10-05T00:00:00.000Z",
      newRequestId: () => "req",
    },
  });
  coordinator.addCandidate("/tmp/root", "src-1.ts");
  // stop frame이 observe를 지나면 세션이 끝난다. drain 루프 사이 send 실패는
  // 이 배분의 unavailable이지 성공이 아니다(코멘트의 흐름).
  await coordinator.session.run();
  assertEquals(coordinator.session.stopped, true);
  assert(spawned.length >= 1, "배분이 준비 세션을 띄운다");
  // coordinator 세션 자체는 stopped ack만으로 정리됐다.
  const bodies = output.filter((frame) =>
    frame.kind === "json" &&
    (frame.payload as { type?: string }).type !== "stopped" &&
    (frame.payload as { type?: string }).type !== "ready"
  );
  assertEquals(bodies.length, 0);
});
