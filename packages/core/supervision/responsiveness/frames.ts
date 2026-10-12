import { armTimer } from "./deadline.ts";
import {
  CONTROL_MAX_BYTES,
  encodeFrame,
  type Frame,
  FrameDecoder,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../protocol/base/mod.ts";

export type ByteReader = {
  read(buffer: Uint8Array): Promise<number | null>;
};

export type ByteWriter = {
  write(bytes: Uint8Array): Promise<number>;
};

export type WriterBacklog = { frames: number; bytes: number };

export type FrameWriter = {
  writeJson(payload: unknown): Promise<void>;
  writeBytes(channel: number, payload: Uint8Array): Promise<void>;
  // stream 하나를 닫는 end·abort frame. payload가 없다.
  writeEnd(channel: number): Promise<void>;
  writeAbort(channel: number): Promise<void>;
  // 마지막 제어 frame 하나(stop·stopped). 아래 여유분으로 들어가고, 그 뒤로는 아무것도 받지 않는다.
  writeFinal(payload: unknown): Promise<void>;
  // 아직 쓰기를 시작하지 않은 frame을 거절하고 일반 쓰기를 닫는다. 이미 시작된 OS write는 되돌리지 못한다.
  // 닫은 뒤에도 writeFinal은 한 번 쓸 수 있다.
  close(): void;
  // 한 번 partial write가 실패하거나 backlog가 넘치거나 쓰기 기한을 넘기면 영원히 true다.
  readonly faulted: boolean;
  // 쓰는 중인 frame과 줄 선 frame의 수·바이트(header 포함).
  readonly backlog: WriterBacklog;
};

const FRAME_HEADER_BYTES = 9;
// 막힌 sink에 계속 써도 payload·promise가 무한히 쌓이지 않는다. 넘치면 그 writer는 fault다.
export const WRITE_BACKLOG_MAX_FRAMES = 256;
export const WRITE_BACKLOG_MAX_BYTES = 2 *
  (STREAM_CHUNK_MAX_BYTES + FRAME_HEADER_BYTES);
// 일반 frame이 상한까지 차도 마지막 제어 frame 하나는 들어갈 자리.
const FINAL_RESERVE_FRAMES = 1;
const FINAL_RESERVE_BYTES = CONTROL_MAX_BYTES + FRAME_HEADER_BYTES;

export type FrameWriterOptions = {
  // frame 하나를 쓰기 시작해 끝나기까지의 기한(ms). 실제 경과 시간으로 잰다. 넘으면 그 writer는
  // fault가 되고(쓰던 frame은 끊겼을 수 있다), 쓰던 frame과 줄 선 frame은 같은 오류로 거절한다.
  // 없으면 기한이 없다(상대가 읽지 않으면 쓰기가 끝나지 않는다).
  writeMs?: number;
  // 기한을 넘겨 fault가 났을 때 한 번 부른다. 상대가 읽지 않으니 호출자가 상대를 끝낸다.
  onTimeout?: () => void;
};

// 기한을 넘겨 버린 쓰기는 더 쓰지 않는다. 늦게 깨어난 write가 끊긴 frame의 나머지를 잇지 않는다.
type WriteGuard = { abandoned: boolean };

async function writeAll(
  writer: ByteWriter,
  bytes: Uint8Array,
  guard: WriteGuard = { abandoned: false },
) {
  let offset = 0;
  while (offset < bytes.length) {
    if (guard.abandoned) throw new Error("frame write was abandoned");
    const remaining = bytes.length - offset;
    const written = await writer.write(bytes.subarray(offset));
    if (!Number.isInteger(written) || written < 1 || written > remaining) {
      throw new Error("frame write progress out of range");
    }
    offset += written;
  }
}

type Item = {
  bytes: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
};

// 한 pipe(한 spawned handle)에 하나만 만든다. 전역 상태 없이 이 instance 안에서만
// FIFO queue와 fault를 쥔다. partial write가 실패하면 그 뒤로 큐에 있던 것과
// 새로 들어오는 것 모두 같은 오류로 거절한다(protocol이 깨진 pipe에 더 쓰지 않는다).
export function createFrameWriter(
  writer: ByteWriter,
  options: FrameWriterOptions = {},
): FrameWriter {
  const queue: Item[] = [];
  let active: Item | undefined;
  let queuedBytes = 0;
  let fault: Error | undefined;
  let closed = false;
  let finalUsed = false;

  const backlog = (): WriterBacklog => ({
    frames: queue.length + (active ? 1 : 0),
    bytes: queuedBytes + (active?.bytes.length ?? 0),
  });

  function rejectQueued(error: Error) {
    for (const item of queue.splice(0)) item.reject(error);
    queuedBytes = 0;
  }

  async function drain() {
    while (!active && !fault) {
      const item = queue.shift();
      if (!item) return;
      queuedBytes -= item.bytes.length;
      active = item;
      const guard: WriteGuard = { abandoned: false };
      const timer = options.writeMs === undefined
        ? undefined
        : armTimer(options.writeMs);
      let timedOut = false;
      try {
        const writing = writeAll(writer, item.bytes, guard);
        if (timer === undefined) {
          await writing;
        } else {
          // 진 쪽(막힌 write)이 나중에 거절해도 처리하지 않은 거절로 남기지 않는다.
          writing.catch(() => {});
          const raced = await Promise.race([
            writing.then(() => "written" as const),
            timer.promise,
          ]);
          if (raced === "timeout") {
            timedOut = true;
            guard.abandoned = true;
            throw new Error(
              `frame write timed out after ${options.writeMs}ms`,
            );
          }
        }
        item.resolve();
      } catch (error) {
        fault = error instanceof Error ? error : new Error(String(error));
        item.reject(fault);
        rejectQueued(fault);
      } finally {
        timer?.cancel();
        active = undefined;
      }
      if (timedOut) {
        try {
          options.onTimeout?.();
        } catch {
          /* 안전 실패: 호출자 hook 예외가 writer 정리를 막지 않는다 */
        }
      }
    }
  }

  function enqueue(frame: Frame, final: boolean): Promise<void> {
    if (fault) return Promise.reject(fault);
    if (final ? finalUsed : closed) {
      return Promise.reject(new Error("frame writer is closed"));
    }
    let bytes: Uint8Array;
    try {
      // 지금 인코딩해 둔다. 호출자가 뒤에 payload를 바꿔도 줄 선 frame은 바뀌지 않는다.
      // 인코딩 실패는 이 호출만 거절한다. 아무것도 줄에 들어가지 않았으므로 pipe는 멀쩡하다.
      bytes = encodeFrame(frame);
    } catch (error) {
      return Promise.reject(error);
    }
    const now = backlog();
    const frameLimit = WRITE_BACKLOG_MAX_FRAMES -
      (final ? 0 : FINAL_RESERVE_FRAMES);
    const byteLimit = WRITE_BACKLOG_MAX_BYTES -
      (final ? 0 : FINAL_RESERVE_BYTES);
    if (now.frames + 1 > frameLimit || now.bytes + bytes.length > byteLimit) {
      // 순서를 지키지 못하는 frame을 빼고 계속 쓰지 않는다. 그 writer 전체를 fail-closed한다.
      fault = new Error("frame write backlog exceeded");
      rejectQueued(fault);
      return Promise.reject(fault);
    }
    if (final) {
      finalUsed = true;
      closed = true;
    }
    const result = new Promise<void>((resolve, reject) => {
      queue.push({ bytes, resolve, reject });
    });
    queuedBytes += bytes.length;
    void drain();
    return result;
  }

  return {
    writeJson: (payload) =>
      enqueue({ kind: "json", channel: 0, payload }, false),
    writeBytes: (channel, payload) =>
      enqueue({ kind: "bytes", channel, payload }, false),
    writeEnd: (channel) => enqueue({ kind: "end", channel }, false),
    writeAbort: (channel) => enqueue({ kind: "abort", channel }, false),
    writeFinal: (payload) =>
      enqueue({ kind: "json", channel: 0, payload }, true),
    close() {
      if (closed) return;
      closed = true;
      rejectQueued(new Error("frame writer is closed"));
    },
    get faulted() {
      return fault !== undefined;
    },
    get backlog() {
      return backlog();
    },
  };
}

// frame이 아닌 바이트는 FrameDecoder가 throw한다. 호출자가 protocol 위반으로 다룬다.
// 한 번에 읽은 chunk 안의 frame은 버리지 않고 전부 넘긴다.
export async function* readFrames(
  reader: ByteReader,
): AsyncGenerator<Frame, "eof" | "closed"> {
  const decoder = new FrameDecoder();
  const buffer = new Uint8Array(64 * 1024);
  while (true) {
    const count = await reader.read(buffer);
    if (count === null) {
      decoder.finish();
      return "eof";
    }
    if (count === 0) return "closed";
    for (const frame of decoder.push(buffer.subarray(0, count))) yield frame;
  }
}
