// 자식 쪽 blob 준비 client. 신뢰 자식(문서 worker, report collector)이
// 감독 pipe로 core에 blob 준비를 청한다. hash·설치는 I/O worker만 하고 이 client는 바이트를
// 해석하지 않는다. core가 준 credit 안에서만 bytes frame을 보내고, 끝나면 end, 실패하면
// abort를 보낸다. 결과의 hash는 core가 I/O worker에서 받은 값이고 자식이 정하지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type BlobPrepareResult,
  blobPrepareResultSchema,
  type ChildMessage,
  type ParentMessage,
} from "../../../protocol/supervision/mod.ts";
import type { PreparedBlob } from "../../../protocol/storage/mod.ts";
import { STREAM_CHUNK_MAX_BYTES } from "../../../protocol/base/mod.ts";

export type BlobPrepareInput = {
  purpose: string;
  // 선언 크기. core가 실제로 받은 바이트 수와 대조하고 purpose 상한을 이 값으로 먼저 본다.
  sizeBytes: number;
  bytes: Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
};

type BlobPrepareLink = {
  send(message: ChildMessage): Promise<void>;
  sendBytes(channel: number, payload: Uint8Array): Promise<void>;
  sendEnd(channel: number): Promise<void>;
  sendAbort(channel: number): Promise<void>;
};

type BlobPrepareClient = {
  prepare(input: BlobPrepareInput): Promise<Result<PreparedBlob>>;
  // credit·결과 메시지를 받는다. 소비하면 true. 자식 entry의 parent message 처리와는
  // 별도로, 진행 중인 handler 뒤에 줄 서지 않게 바로 불려야 한다(startChild가 한다).
  accept(message: ParentMessage): boolean;
  // 자식이 멈출 때 진행 중인 준비를 모두 unavailable로 끝낸다.
  close(): void;
};

type BlobPrepareClientOptions = {
  // 결과를 기다리는 최대 시간. 지나면 abort를 보내고 unavailable이다.
  timeoutMs?: number;
};

const BLOB_PREPARE_CLIENT_TIMEOUT_MS = 30_000;

type Pending = {
  requestId: string;
  credit: number;
  result: BlobPrepareResult | undefined;
  // credit이나 결과가 오면 깨운다.
  wake: (() => void) | undefined;
  closed: boolean;
};

export function createBlobPrepareClient(
  link: BlobPrepareLink,
  options: BlobPrepareClientOptions = {},
): BlobPrepareClient {
  const timeoutMs = options.timeoutMs ?? BLOB_PREPARE_CLIENT_TIMEOUT_MS;
  const byChannel = new Map<number, Pending>();
  const byRequest = new Map<string, Pending>();
  let counter = 0;
  let requests = 0;

  function nextChannel(): number {
    for (let tries = 0; tries < 0xffffffff; tries++) {
      counter = counter % 0xffffffff + 1;
      if (!byChannel.has(counter)) return counter;
    }
    throw new Error("no free blob prepare channel");
  }

  function wake(pending: Pending) {
    const fn = pending.wake;
    pending.wake = undefined;
    fn?.();
  }

  // credit·결과·닫힘 중 하나가 올 때까지 기다린다. 기한이 지나면 false다.
  function waitFor(
    pending: Pending,
    ready: () => boolean,
    deadline: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const step = () => {
        if (ready()) return resolve(true);
        const left = deadline - Date.now();
        if (left <= 0) return resolve(false);
        const timer = setTimeout(() => {
          pending.wake = undefined;
          resolve(ready());
        }, left);
        pending.wake = () => {
          clearTimeout(timer);
          step();
        };
      };
      step();
    });
  }

  async function* chunksOf(
    bytes: BlobPrepareInput["bytes"],
  ): AsyncGenerator<Uint8Array> {
    if (bytes instanceof Uint8Array) {
      yield bytes;
      return;
    }
    if (Symbol.asyncIterator in bytes) {
      yield* bytes as AsyncIterable<Uint8Array>;
      return;
    }
    const reader = (bytes as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch { /* 이미 닫힌 stream */ }
    }
  }

  async function prepare(
    input: BlobPrepareInput,
  ): Promise<Result<PreparedBlob>> {
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      return err({ code: "invalid_input", message: "invalid declared size" });
    }
    const channel = nextChannel();
    const requestId = `blob-prepare-${channel}-${++requests}`;
    const pending: Pending = {
      requestId,
      credit: 0,
      result: undefined,
      wake: undefined,
      closed: false,
    };
    byChannel.set(channel, pending);
    byRequest.set(requestId, pending);
    const deadline = Date.now() + timeoutMs;
    let opened = false;
    const abort = async () => {
      if (!opened) return;
      opened = false;
      await link.sendAbort(channel).catch(() => {});
    };
    try {
      await link.send({
        type: "blob_prepare_request",
        request_id: requestId,
        channel,
        purpose: input.purpose,
        size_bytes: input.sizeBytes,
      });
      opened = true;
      let sent = 0;
      const stopped = () => pending.result !== undefined || pending.closed;
      for await (const chunk of chunksOf(input.bytes)) {
        let offset = 0;
        while (offset < chunk.length) {
          if (stopped()) break;
          if (sent >= input.sizeBytes) {
            await abort();
            return err({
              code: "invalid_input",
              message: "bytes exceed declared size",
            });
          }
          const reached = await waitFor(
            pending,
            () => pending.credit > 0 || stopped(),
            deadline,
          );
          if (!reached) {
            await abort();
            return err({
              code: "unavailable",
              message: "blob prepare credit timed out",
            });
          }
          if (stopped()) break;
          const size = Math.min(
            pending.credit,
            chunk.length - offset,
            STREAM_CHUNK_MAX_BYTES,
            input.sizeBytes - sent,
          );
          if (size <= 0) {
            await abort();
            return err({
              code: "invalid_input",
              message: "bytes exceed declared size",
            });
          }
          pending.credit -= size;
          sent += size;
          await link.sendBytes(channel, chunk.subarray(offset, offset + size));
          offset += size;
        }
        if (stopped()) break;
      }
      if (!stopped()) {
        if (sent !== input.sizeBytes) {
          await abort();
          return err({
            code: "invalid_input",
            message: "bytes do not match declared size",
          });
        }
        await link.sendEnd(channel);
        opened = false;
      }
      const answered = await waitFor(pending, stopped, deadline);
      if (!answered) {
        await abort();
        return err({
          code: "unavailable",
          message: "blob prepare timed out",
        });
      }
      const result = pending.result;
      if (result === undefined) {
        return err({
          code: "unavailable",
          message: "blob prepare was interrupted",
        });
      }
      // core가 먼저 실패를 알렸으면 stream은 이미 닫혔다. abort를 또 보내지 않는다.
      opened = false;
      if (!result.ok) return err(result.error);
      return ok(result.prepared);
    } catch {
      await abort();
      return err({ code: "unavailable", message: "blob prepare failed" });
    } finally {
      byChannel.delete(channel);
      byRequest.delete(requestId);
    }
  }

  return {
    prepare,
    accept(message) {
      if (message.type === "credit") {
        const pending = byChannel.get(message.channel);
        if (!pending) return true;
        pending.credit += message.window;
        wake(pending);
        return true;
      }
      if (message.type === "blob_prepare_result") {
        const parsed = blobPrepareResultSchema.safeParse(message);
        const pending = byRequest.get(message.request_id);
        if (!pending) return true;
        // 모양이 틀린 결과는 성공으로 받지 않는다.
        pending.result = parsed.success ? parsed.data : {
          type: "blob_prepare_result",
          request_id: message.request_id,
          ok: false,
          error: { code: "unavailable", message: "invalid prepare result" },
        };
        wake(pending);
        return true;
      }
      return false;
    },
    close() {
      for (const pending of byChannel.values()) {
        pending.closed = true;
        wake(pending);
      }
    },
  };
}
