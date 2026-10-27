import { Buffer } from "node:buffer";
import type { Readable, Writable } from "node:stream";

// 한 frame(1MiB + header)이 들어오도록 멈춤 선을 잡고, 멈춘 뒤에도 쌓이면 fault로 끊는다.
const PIPE_PAUSE_BYTES = 1024 * 1024 + 64 * 1024;
const PIPE_MAX_BYTES = 2 * PIPE_PAUSE_BYTES;
const PIPE_RESUME_BYTES = PIPE_PAUSE_BYTES / 2;

// stdio 오류·overflow는 EOF와 다르다. 호출자가 성공적인 끝으로 오해하지 않게 따로 표시한다.
export class PipeFault extends Error {}

export type SpawnedPipe = {
  // EOF면 null, 우리가 cancel했으면 null, stdio 오류·overflow면 PipeFault로 거절한다.
  read(buffer: Uint8Array): Promise<number | null>;
  // 이 pipe의 읽기를 끝낸다. 기다리던 read는 null로 깨어나고 stream은 닫힌다.
  cancel(): void;
  readonly bufferedBytes: number;
};

// Deno 2.9.7의 node:child_process stdio는 paused mode('readable' + read())로 두면 데이터가
// 와도 'readable'이 leader가 끝날 때에야 온다(실측). 그래서 flowing mode('data')로 받되,
// 쌓인 양이 멈춤 선을 넘으면 stream.pause()로 실제 backpressure를 걸고(실측: 멈춘 뒤 data 0),
// 그래도 상한을 넘으면 PipeFault로 끊는다. 'exit'가 data보다 먼저 올 수 있어 exit 때 끊지 않는다.
export function fromReadable(stream: Readable): SpawnedPipe {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let buffered = 0;
  let ended = false;
  let cancelled = false;
  let fault: PipeFault | undefined;
  const waiters: Array<() => void> = [];
  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const drop = () => {
    chunks.length = 0;
    offset = 0;
    buffered = 0;
  };
  const fail = (message: string) => {
    if (fault || cancelled) return;
    fault = new PipeFault(message);
    drop();
    try {
      stream.destroy();
    } catch { /* 이미 닫힌 stream */ }
    wake();
  };
  stream.on("data", (chunk: Buffer) => {
    if (fault || cancelled) return;
    chunks.push(chunk);
    buffered += chunk.length;
    if (buffered > PIPE_MAX_BYTES) return fail("pipe buffer overflow");
    if (buffered >= PIPE_PAUSE_BYTES) stream.pause();
    wake();
  });
  stream.on("end", () => {
    ended = true;
    wake();
  });
  stream.on("close", () => {
    if (!ended) fail("pipe closed before end");
    wake();
  });
  stream.on("error", () => fail("pipe read failed"));
  return {
    get bufferedBytes() {
      return buffered;
    },
    async read(buffer) {
      while (true) {
        if (cancelled) return null;
        if (fault) throw fault;
        const head = chunks[0];
        if (head) {
          const count = Math.min(buffer.length, head.length - offset);
          buffer.set(head.subarray(offset, offset + count));
          offset += count;
          buffered -= count;
          if (offset >= head.length) {
            chunks.shift();
            offset = 0;
          }
          if (buffered < PIPE_RESUME_BYTES && stream.isPaused() && !ended) {
            stream.resume();
          }
          return count;
        }
        if (ended) return null;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      drop();
      try {
        stream.destroy();
      } catch { /* 이미 닫힌 stream */ }
      wake();
    },
  };
}

export type SpawnedWriter = {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

export function toWriter(stream: Writable): SpawnedWriter {
  // child가 먼저 죽으면 EPIPE 'error'가 온다. listener가 없으면 core 전체가 죽는다.
  stream.on("error", () => {});
  return {
    write(bytes) {
      return new Promise((resolve, reject) => {
        stream.write(Buffer.from(bytes), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    // child가 먼저 끝나 pipe가 이미 닫혔으면 end의 callback이 오지 않는다. 닫힘과 오류도 끝으로 센다.
    close() {
      if (stream.destroyed || stream.writableFinished) return Promise.resolve();
      return new Promise((resolve) => {
        stream.once("close", () => resolve());
        stream.once("error", () => resolve());
        stream.end(() => resolve());
      });
    },
  };
}
