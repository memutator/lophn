// chunk는 pull 때 하나씩 나간다. abort/cancel은 delay·gate·hold를 즉시 끝낸다.
import type { ResponseChunk } from "./types.ts";

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export function decodeChunk(chunk: ResponseChunk): Uint8Array {
  if (chunk.encoding === "base64") {
    const binary = atob(chunk.bytes);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return new TextEncoder().encode(chunk.bytes);
}

export function openStream(options: {
  chunks: ResponseChunk[];
  end?: "close" | "reset" | "hold";
  signal: AbortSignal;
  instant: boolean;
  sleep: Sleep;
  waitGate: (name: string, signal: AbortSignal) => Promise<void>;
  onAbort: () => void;
}): ReadableStream<Uint8Array> {
  const lifetime = new AbortController();
  let index = 0;
  let cancelled = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => options.signal.removeEventListener("abort", abort);
  const abort = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    options.onAbort();
    cleanup();
    if (!cancelled) controller.error(new DOMException("aborted", "AbortError"));
  };
  const wait = async (pending: Promise<void>) => {
    if (lifetime.signal.aborted) return;
    let wake: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
      wake = resolve;
      lifetime.signal.addEventListener("abort", wake, { once: true });
    });
    try {
      await Promise.race([pending, stopped]);
    } finally {
      lifetime.signal.removeEventListener("abort", wake);
    }
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    },
    async pull() {
      if (lifetime.signal.aborted) return;
      if (index >= options.chunks.length) {
        if (options.end === "hold") {
          await wait(options.waitGate("hold", lifetime.signal));
        }
        if (lifetime.signal.aborted) return;
        cleanup();
        if (options.end === "reset") {
          controller.error(new Error("fake-provider: connection reset"));
        } else controller.close();
        return;
      }
      const chunk = options.chunks[index++];
      if (chunk.gate) {
        await wait(options.waitGate(chunk.gate, lifetime.signal));
      }
      if (lifetime.signal.aborted) return;
      if (!options.instant && (chunk.delayMs ?? 0) > 0) {
        await wait(options.sleep(chunk.delayMs!, lifetime.signal));
      }
      if (lifetime.signal.aborted) return;
      controller.enqueue(decodeChunk(chunk));
    },
    cancel() {
      cancelled = true;
      abort();
      cleanup();
    },
  });
}
