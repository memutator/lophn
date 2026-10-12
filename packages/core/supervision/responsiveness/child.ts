import {
  type ChildMessage,
  childMessageSchema,
  type ParentMessage,
  parentMessageSchema,
} from "../../../protocol/supervision/mod.ts";
import type { PreparedBlob } from "../../../protocol/storage/mod.ts";
import {
  type BlobPrepareInput,
  createBlobPrepareClient,
} from "./blob-client.ts";
import type { Result } from "../../../base/mod.ts";
import {
  type ByteReader,
  type ByteWriter,
  createFrameWriter,
  readFrames,
} from "./frames.ts";
import {
  type Frame,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../protocol/base/mod.ts";

export type ChildStreams = {
  stdin: ByteReader;
  stdout: ByteWriter;
  stderr: ByteWriter;
};

type Hello = Extract<ParentMessage, { type: "hello" }>;

export type ChildHandlers = {
  // hello의 credential은 여기로만 간다. log·stderr에 남기지 않는다.
  onHello(message: Hello): Promise<void> | void;
  // explicit stop·EOF·protocol 위반 모두 이 hook을 정확히 한 번 부른다. 앞선 handler가 아직
  // 끝나지 않았어도 기다리지 않고 부른다. 이때 credentialUsable은 이미 false다.
  // entry는 여기서 자기가 띄운 작업·손자를 끝낸다.
  onStop(): Promise<void> | void;
  // byte chunk는 제어 메시지가 아니다. entry가 채널로 받는다.
  onFrame?(frame: Frame): Promise<void> | void;
  // 후속 contract가 parent message를 늘려도 여기서 protocol 위반으로 죽이지 않는다.
  onParent?(message: ParentMessage): Promise<void> | void;
};

export type ReadAhead = {
  // 지금 handler가 처리 중인 frame과 아직 시작하지 않은 frame의 수·크기.
  activeFrames: number;
  activeBytes: number;
  pendingFrames: number;
  pendingBytes: number;
};

export type ChildSession = {
  send(message: ChildMessage): Promise<void>;
  sendBytes(channel: number, payload: Uint8Array): Promise<void>;
  // stream 하나를 닫는다. end는 정상 끝, abort는 중단이다.
  sendEnd(channel: number): Promise<void>;
  sendAbort(channel: number): Promise<void>;
  // core에 blob 준비를 청한다. core가 credit을 주는 만큼만 바이트를 보내고,
  // 결과의 hash·참조는 core가 I/O worker에서 받은 값이다. credit·결과 메시지는 handler
  // 처리 중에도 바로 소비하므로, 요청을 처리하는 handler 안에서 불러도 막히지 않는다.
  // core가 이 kind에 허용하지 않았으면 forbidden이다.
  prepareBlob(input: BlobPrepareInput): Promise<Result<PreparedBlob>>;
  // run()이 끝났다. 그 전이라도 EOF·stop·protocol 실패 뒤에는 stopped ack 말고는 보낼 수 없다.
  readonly stopped: boolean;
  // session이 내리는 사용 허가다. handler가 이미 복사한 credential 값을 지우지는 못한다.
  readonly credentialUsable: boolean;
  readonly readAhead: ReadAhead;
  run(): Promise<void>;
};

const FRAME_HEADER_BYTES = 9;
// handler가 느려도 stdin은 계속 읽어 EOF·stop을 바로 본다. 대신 미리 읽은 양은 이 한도를
// 넘으면 protocol 실패로 끝낸다(무제한 queue 없음). 처리 중 최대 frame 하나와 대기 최대 frame
// 하나가 함께 들어가는 크기다.
export const READ_AHEAD_MAX_FRAMES = 256;
export const READ_AHEAD_MAX_BYTES = 2 *
  (STREAM_CHUNK_MAX_BYTES + FRAME_HEADER_BYTES);

type Work =
  | { kind: "hello"; message: Hello; bytes: number }
  | { kind: "frame"; frame: Frame; bytes: number }
  | { kind: "parent"; message: ParentMessage; bytes: number };

const encoder = new TextEncoder();

function frameBytes(frame: Frame): number {
  if (frame.kind === "bytes") return FRAME_HEADER_BYTES + frame.payload.length;
  if (frame.kind === "json") {
    return FRAME_HEADER_BYTES +
      encoder.encode(JSON.stringify(frame.payload)).length;
  }
  return FRAME_HEADER_BYTES;
}

export function startChild(
  streams: ChildStreams,
  handlers: ChildHandlers,
): ChildSession {
  const stdout = createFrameWriter(streams.stdout);
  const blob = createBlobPrepareClient({
    send: (message) => session.send(message),
    sendBytes: (channel, payload) => session.sendBytes(channel, payload),
    sendEnd: (channel) => session.sendEnd(channel),
    sendAbort: (channel) => session.sendAbort(channel),
  });
  let stopped = false;
  let credentialUsable = false;
  let helloSeen = false;
  let helloRead = false;
  const pending: Work[] = [];
  const size = {
    activeFrames: 0,
    activeBytes: 0,
    pendingFrames: 0,
    pendingBytes: 0,
  };
  let wakeDispatch: (() => void) | undefined;
  // 처음 관측한 끝(EOF·stop·protocol 실패·handler 실패)만 결과를 정한다.
  let terminal = false;
  let failure: Error | undefined;
  let cleanup: Promise<void> | undefined;
  let endedResolve: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    endedResolve = resolve;
  });

  // 세 경로가 모두 여기로 모인다. 상태를 먼저 내리고, 대기 중인 handler는 버리고, onStop은 한 번만.
  function finish(error?: Error) {
    if (terminal) return;
    terminal = true;
    failure = error;
    credentialUsable = false;
    blob.close();
    // 아직 쓰기를 시작하지 않은 일반 frame은 버린다. 이후로는 stopped ack 하나만 나간다.
    stdout.close();
    pending.length = 0;
    size.pendingFrames = 0;
    size.pendingBytes = 0;
    wakeDispatch?.();
    cleanup = Promise.resolve()
      .then(() => handlers.onStop())
      .catch(() => {
        // 안전 실패: cleanup 예외가 pipe 종료·상태 하향을 막지 않는다.
      });
    endedResolve();
  }

  function enqueue(work: Work) {
    if (
      size.activeFrames + size.pendingFrames + 1 > READ_AHEAD_MAX_FRAMES ||
      size.activeBytes + size.pendingBytes + work.bytes > READ_AHEAD_MAX_BYTES
    ) {
      throw new Error("read-ahead limit exceeded");
    }
    pending.push(work);
    size.pendingFrames += 1;
    size.pendingBytes += work.bytes;
    wakeDispatch?.();
  }

  // stdin 관측만 한다. handler가 끝나기를 기다리지 않는다.
  function observe(frame: Frame) {
    const bytes = frameBytes(frame);
    if (!helloRead) {
      // hello 전에는 bytes도 다른 json도 받지 않는다. 최초 메시지는 hello 하나뿐이다.
      const parsed = frame.kind === "json"
        ? parentMessageSchema.safeParse(frame.payload)
        : undefined;
      if (!parsed?.success || parsed.data.type !== "hello") {
        throw new Error("message arrived before hello");
      }
      helloRead = true;
      return enqueue({ kind: "hello", message: parsed.data, bytes });
    }
    if (frame.kind !== "json") return enqueue({ kind: "frame", frame, bytes });
    const parsed = parentMessageSchema.safeParse(frame.payload);
    if (!parsed.success) throw new Error("parent message is not valid");
    const message = parsed.data;
    // credential은 한 번만 받는다. 두 번째는 protocol 위반이다.
    if (message.type === "hello") throw new Error("hello was already received");
    // 새 작업과 credential 사용은 즉시 멈춘다. onStop 안에서 stopped frame은 보낼 수 있다.
    if (message.type === "stop") return finish();
    // credit·blob 준비 결과는 순서대로 도는 handler 뒤에 줄 서지 않고 바로 소비한다.
    // 줄을 서면 준비를 기다리는 handler가 자기가 기다리는 메시지를 막는다.
    if (blob.accept(message)) return;
    enqueue({ kind: "parent", message, bytes });
  }

  async function pump(frames: AsyncGenerator<Frame, "eof" | "closed">) {
    try {
      while (!terminal) {
        const next = await frames.next();
        if (terminal) return;
        if (next.done) return finish();
        observe(next.value);
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async function invoke(work: Work) {
    if (work.kind === "hello") {
      helloSeen = true;
      credentialUsable = true;
      return await handlers.onHello(work.message);
    }
    if (work.kind === "frame") return await handlers.onFrame?.(work.frame);
    if (!credentialUsable) throw new Error("credential is not usable");
    await handlers.onParent?.(work.message);
  }

  // handler는 받은 순서대로 하나씩 돈다. 끝난 뒤(terminal) 대기 중인 것은 시작하지 않는다.
  async function dispatch() {
    while (true) {
      const work = pending.shift();
      if (!work) {
        // terminal 뒤에 대기하면 이 promise가 세션을 붙잡는다.
        if (terminal) return;
        await new Promise<void>((resolve) => {
          wakeDispatch = resolve;
        });
        wakeDispatch = undefined;
        continue;
      }
      if (terminal) return;
      size.pendingFrames -= 1;
      size.pendingBytes -= work.bytes;
      size.activeFrames = 1;
      size.activeBytes = work.bytes;
      try {
        await invoke(work);
      } catch (error) {
        // 끝난 뒤 진 handler의 거절은 관측만 한다. 결과를 바꾸지 않는다.
        if (!terminal) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        size.activeFrames = 0;
        size.activeBytes = 0;
      }
    }
  }

  function sendable(): Error | undefined {
    if (stopped) return new Error("child pipe is closed");
    if (!helloSeen) return new Error("send before hello is not allowed");
    // EOF·stop·protocol 실패를 본 순간부터 일반 전송은 막는다(진 handler의 늦은 전송 포함).
    if (terminal) return new Error("child session is stopping");
    return undefined;
  }

  const session: ChildSession = {
    get stopped() {
      return stopped;
    },
    get credentialUsable() {
      return credentialUsable;
    },
    get readAhead() {
      return { ...size };
    },
    send(message) {
      // cleanup(onStop) 중에는 stopped ack 하나만 보낼 수 있다.
      if (terminal && !stopped && helloSeen && message.type === "stopped") {
        return stdout.writeFinal(childMessageSchema.parse(message));
      }
      const refused = sendable();
      if (refused) return Promise.reject(refused);
      return stdout.writeJson(childMessageSchema.parse(message));
    },
    // byte chunk도 제어 메시지와 같은 hello 경계를 따른다.
    sendBytes(channel, payload) {
      const refused = sendable();
      if (refused) return Promise.reject(refused);
      if (!Number.isInteger(channel) || channel < 1) {
        return Promise.reject(new Error("byte channel must be nonzero"));
      }
      return stdout.writeBytes(channel, payload);
    },
    sendEnd(channel) {
      const refused = sendable();
      if (refused) return Promise.reject(refused);
      if (!Number.isInteger(channel) || channel < 1) {
        return Promise.reject(new Error("stream channel must be nonzero"));
      }
      return stdout.writeEnd(channel);
    },
    sendAbort(channel) {
      const refused = sendable();
      if (refused) return Promise.reject(refused);
      if (!Number.isInteger(channel) || channel < 1) {
        return Promise.reject(new Error("stream channel must be nonzero"));
      }
      return stdout.writeAbort(channel);
    },
    prepareBlob: (input) => blob.prepare(input),
    async run() {
      const frames = readFrames(streams.stdin);
      void pump(frames);
      void dispatch();
      await ended;
      await cleanup;
      stopped = true;
      credentialUsable = false;
      // 대기 중인 read 뒤에 줄을 서므로 기다리지 않는다.
      void frames.return("closed").catch(() => {});
      if (failure) throw failure;
    },
  };
  return session;
}
