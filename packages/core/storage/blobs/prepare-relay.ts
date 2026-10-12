// core의 blob 준비 중계(blob contract, platform/blob-store#R1, platform Q2·Q6).
// 준비 참조는 principal·purpose·hash·크기와 10분 수명으로 core 메모리에 등록된다.
// core는 파일을 다시 hash하지 않는다. 바이트는 해석 없이 I/O worker로 흘려보낸다.
// 순서는 worker_request, bytes(worker가 준 credit 안에서만), end(또는 abort)다.
// core가 쥐는 바이트는 자식 쪽 credit window와 한 chunk뿐이다: 전체를 모으지 않는다.

import { err, type ErrorCode, ok, type Result } from "../../../base/mod.ts";
import {
  BLOB_PREPARE_CREDIT_WINDOW,
  type ChildMessage,
  type Frame,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../protocol/supervision/mod.ts";
import {
  BLOB_PREPARE_OP,
  BLOB_READ_MAX_BYTES,
  BLOB_READ_OP,
} from "../../../protocol/storage/mod.ts";
import { type PreparationRegistry } from "./mod.ts";

// core가 한 준비에서 동시에 쥘 수 있는 바이트의 상한. 자식 쪽에서 받아 둔 credit
// window(BLOB_PREPARE_CREDIT_WINDOW)와 I/O worker로 넘기는 중인 chunk 하나다.
export const BLOB_RELAY_BUFFER_MAX_BYTES = BLOB_PREPARE_CREDIT_WINDOW +
  STREAM_CHUNK_MAX_BYTES;

// 이보다 작은 chunk는 합쳐서 한 frame으로 보낸다(마지막 chunk와 credit이 모자란 경우 제외).
export const BLOB_RELAY_MIN_FRAME_BYTES = 32 * 1024;

// worker가 credit을 더 주지 않고 말이 없을 때 기다리는 시간. 지나면 abort한다.
export const BLOB_RELAY_CREDIT_MS = 30_000;
// end를 보낸 뒤 fsync·설치가 끝나 응답이 오기까지 기다리는 시간.
export const BLOB_RELAY_RESPONSE_MS = 120_000;
// blob.read 응답을 기다리는 시간.
export const BLOB_RELAY_READ_MS = 6_000;

// core가 바이트를 쥐고 있는 양의 관측. 자식 쪽 대기열과 중계가 읽어 쥔 chunk가 더한다.
export type BufferGauge = {
  readonly current: number;
  // 만들어진 뒤 가장 컸던 값.
  readonly peak: number;
  add(bytes: number): void;
};

export function createBufferGauge(): BufferGauge {
  let current = 0;
  let peak = 0;
  return {
    get current() {
      return current;
    },
    get peak() {
      return peak;
    },
    add(bytes) {
      current += bytes;
      if (current > peak) peak = current;
    },
  };
}

// I/O worker의 감독 session에서 쓰는 callback 묶음. core가 넣는다.
export type BlobPrepareRelay = {
  // worker_request를 먼저 보내고 byte chunk를 worker credit 안에서 흘려보낸다.
  // 내용을 해석하지 않는다.
  prepare(
    input: { principal: string; purpose: string; expectedHash?: string },
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<PreparedRelayResult>>;
  // 준비 성공을 writer에 알린 뒤 끝난다. 알림이 실패하면 준비도 실패다.
  live(
    prepared: { hash: string; principal: string; purpose: string },
    nowMs: number,
  ): boolean;
  // 만기 참조를 떨어뜨린다.
  prune(nowMs: number): void;
  // I/O worker가 설치한 blob의 구간을 읽는다. core는 파일을 열지 않는다.
  readBytes(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  readonly size: number;
  // worker→core byte chunk frame. 읽기 응답의 바이트를 channel별로 모은다.
  take(frame: Frame): void;
  // worker→core worker_response와 credit. 그 밖의 메시지는 무시한다.
  accept(message: ChildMessage): void;
  // I/O worker가 끝났다(crash·재기동·정지). 답을 기다리던 준비·읽기는 기한(credit 30초·응답
  // 120초·읽기 6초)까지 기다리지 않고 바로 unavailable로 끝난다.
  failPending(message: string): void;
};

export type PreparedRelayResult = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

export type BlobRelayDeps = {
  // I/O worker에 worker_request json frame을 쓴다.
  send(payload: unknown): Promise<void>;
  // 요청의 channel에 묶인 byte chunk, end, abort를 쓴다.
  sendBytes(channel: number, chunk: Uint8Array): Promise<void>;
  sendEnd(channel: number): Promise<void>;
  sendAbort(channel: number): Promise<void>;
  // 준비 참조 registry. 등록은 worker_response 성공 때 한다.
  registry: PreparationRegistry;
  nowMs(): number;
  // writer 메모리에 같은 참조를 남긴다. 등록 판정은 그 메모리를 본다.
  note(prepared: PreparedRelayResult, nowMs: number): Promise<Result<void>>;
  // 중계가 쥔 chunk를 관측한다. 없으면 관측하지 않는다.
  gauge?: BufferGauge;
  // 시험이 기한을 줄일 때만 쓴다. 기본값은 위 상수다.
  creditMs?: number;
  responseMs?: number;
  readMs?: number;
};

type Answer =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

// 요청 하나가 기다리는 worker의 말: 준 credit과 응답.
type Pending = {
  credit: number;
  answer: Answer | undefined;
  // credit이나 응답이 오면 깨운다. 기다리는 쪽은 하나다.
  wake: (() => void) | undefined;
  // 응답이 오면 이행한다. 바이트를 읽으며 기다리던 중계가 같이 깨어난다.
  responded: Promise<void>;
  respond: () => void;
};

function newPending(): Pending {
  const { promise, resolve } = Promise.withResolvers<void>();
  return {
    credit: 0,
    answer: undefined,
    wake: undefined,
    responded: promise,
    respond: resolve,
  };
}

// ready가 될 때까지 기다린다. 기한이 지나도 안 되면 false다.
function until(
  pending: Pending,
  ready: () => boolean,
  ms: number,
): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.wake = undefined;
      resolve(ready());
    }, ms);
    pending.wake = () => {
      if (!ready()) return;
      clearTimeout(timer);
      pending.wake = undefined;
      resolve(true);
    };
  });
}

const UNAVAILABLE = (message: string) =>
  err({ code: "unavailable" as const, message });

export function createBlobPrepareRelay(deps: BlobRelayDeps): BlobPrepareRelay {
  const creditMs = deps.creditMs ?? BLOB_RELAY_CREDIT_MS;
  const responseMs = deps.responseMs ?? BLOB_RELAY_RESPONSE_MS;
  const readMs = deps.readMs ?? BLOB_RELAY_READ_MS;
  let channelCounter = 0;
  // worker→core 읽기 응답의 byte chunk를 channel별로 모은다. 요청 동안만 산다.
  const incoming = new Map<number, Uint8Array[]>();
  // 응답을 기다리는 요청. 요청 id로 응답을, channel로 credit을 맞춘다.
  const byRequest = new Map<string, Pending>();
  const byChannel = new Map<number, Pending>();
  function collect(channel: number): { chunks: Uint8Array[]; stop(): void } {
    const chunks: Uint8Array[] = [];
    incoming.set(channel, chunks);
    return {
      chunks,
      stop() {
        incoming.delete(channel);
      },
    };
  }
  function nextChannel(): number {
    // 1..0x7fffffff만 쓴다. 0x80000000 위는 보호 입력 중계의 channel이다(secret-input.ts).
    for (let tries = 0; tries < 0x7fffffff; tries++) {
      channelCounter = channelCounter % 0x7fffffff + 1;
      if (!byChannel.has(channelCounter) && !incoming.has(channelCounter)) {
        return channelCounter;
      }
    }
    throw new Error("no free blob channel");
  }
  function expect(requestId: string, channel: number): Pending {
    const pending = newPending();
    byRequest.set(requestId, pending);
    byChannel.set(channel, pending);
    return pending;
  }
  function forget(requestId: string, channel: number) {
    byRequest.delete(requestId);
    byChannel.delete(channel);
  }

  async function prepare(
    input: { principal: string; purpose: string; expectedHash?: string },
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<PreparedRelayResult>> {
    const channel = nextChannel();
    const requestId = `blob-prepare-${channel}-${deps.nowMs()}`;
    const pending = expect(requestId, channel);
    const reader = bytes.getReader();
    // 읽어 쥔 chunk 중 아직 worker로 넘기지 않은 바이트.
    let held = 0;
    let closed = false;
    const abort = async () => {
      if (closed) return;
      closed = true;
      await deps.sendAbort(channel).catch(() => {});
    };
    try {
      // 요청을 먼저 보낸다. worker가 channel을 알아야 chunk를 그 준비에 붙이고
      // 첫 credit을 준다.
      await deps.send({
        type: "worker_request",
        request_id: requestId,
        op: BLOB_PREPARE_OP,
        channel,
        payload: {
          principal: input.principal,
          purpose: input.purpose,
          ...(input.expectedHash !== undefined
            ? { expected_hash: input.expectedHash }
            : {}),
        },
      });
      const ready = () => pending.credit > 0 || pending.answer !== undefined;
      const readNext = async () => {
        const reading = reader.read();
        reading.catch(() => {});
        return await Promise.race([
          reading,
          pending.responded.then(() => "answered" as const),
        ]);
      };
      let finished = false;
      stream: for (;;) {
        // worker가 받아들일 자리가 생길 때까지 읽지 않는다. 자식에게 credit을 다시
        // 주는 것은 이 읽기라서, worker가 받아야 자식이 더 보낸다.
        if (!await until(pending, ready, creditMs)) {
          await abort();
          return UNAVAILABLE("blob 준비를 받는 쪽이 멈췄다");
        }
        if (pending.answer !== undefined) break;
        let next = await readNext();
        if (next === "answered") break;
        if (next.done) {
          finished = true;
          break;
        }
        let chunk = next.value;
        deps.gauge?.add(chunk.length);
        held = chunk.length;
        // 작은 chunk는 합쳐서 보낸다. 작은 frame이 많으면 받는 쪽이 아직 처리하지 못한
        // frame 수 한도를 바이트보다 먼저 쓴다.
        let sourceDone = false;
        while (chunk.length < BLOB_RELAY_MIN_FRAME_BYTES) {
          next = await readNext();
          if (next === "answered") break stream;
          if (next.done) {
            sourceDone = true;
            break;
          }
          const merged = new Uint8Array(chunk.length + next.value.length);
          merged.set(chunk);
          merged.set(next.value, chunk.length);
          deps.gauge?.add(next.value.length);
          held += next.value.length;
          chunk = merged;
        }
        let offset = 0;
        while (offset < chunk.length) {
          if (!await until(pending, ready, creditMs)) {
            await abort();
            return UNAVAILABLE("blob 준비를 받는 쪽이 멈췄다");
          }
          if (pending.answer !== undefined) break stream;
          const size = Math.min(
            pending.credit,
            chunk.length - offset,
            STREAM_CHUNK_MAX_BYTES,
          );
          pending.credit -= size;
          await deps.sendBytes(channel, chunk.subarray(offset, offset + size));
          offset += size;
          held -= size;
          deps.gauge?.add(-size);
        }
        if (sourceDone) {
          finished = true;
          break;
        }
      }
      if (!finished) {
        // 바이트가 끝나기 전에 worker가 답했다. 더 보내지 않고 그 오류를 돌려준다.
        await reader.cancel().catch(() => {});
        await abort();
        const early = pending.answer;
        if (early !== undefined && !early.ok) return err(early.error);
        return err({
          code: "internal",
          message: "blob 준비가 바이트가 끝나기 전에 답했다",
        });
      }
      await deps.sendEnd(channel);
      closed = true;
      if (
        !await until(pending, () => pending.answer !== undefined, responseMs)
      ) {
        await abort();
        return UNAVAILABLE("blob 준비 응답이 없다");
      }
      const answered = pending.answer!;
      if (!answered.ok) return err(answered.error);
      const payload = answered.payload as PreparedRelayResult;
      // 같은 주체·purpose·내용의 준비가 아직 살아 있으면 그 참조를 그대로 돌려준다.
      // 같은 파일을 다시 제출하는 재시도가 conflict가 되지 않고, 이미 저장 command가 쥔
      // 준비 참조도 바뀌지 않는다. 바이트는 I/O worker가 기존 파일을 검증해 재사용했다.
      const existing = deps.registry.find(payload, deps.nowMs());
      if (existing !== undefined) {
        return ok({
          preparation: existing.preparation,
          principal: existing.principal,
          purpose: existing.purpose,
          hash: existing.hash,
          size_bytes: existing.size_bytes,
        });
      }
      // 준비 참조 등록. core는 결과를 검사한 뒤 파일을 다시 hash하지 않는다.
      const registered = deps.registry.register(
        {
          preparation: payload.preparation,
          principal: payload.principal,
          purpose: payload.purpose,
          hash: payload.hash,
          size_bytes: payload.size_bytes,
        },
        deps.nowMs(),
      );
      if (!registered.ok) return registered;
      // writer가 이 참조를 보기 전에 끝나면 등록 command가 살아 있는 준비를 못 찾는다.
      const noted = await deps.note(payload, deps.nowMs());
      if (!noted.ok) return noted;
      return ok(payload);
    } catch {
      // 원천이 실패했거나(자식 abort) worker로 쓰지 못했다. worker는 blob을 만들지 않는다.
      await reader.cancel().catch(() => {});
      await abort();
      return UNAVAILABLE("blob 준비를 넘기지 못했다");
    } finally {
      if (held > 0) deps.gauge?.add(-held);
      forget(requestId, channel);
      try {
        reader.releaseLock();
      } catch { /* 읽기가 아직 끝나지 않은 stream */ }
    }
  }

  return {
    prepare,
    live(prepared, nowMs) {
      const found = deps.registry.live(prepared, nowMs);
      return found.ok ? found.value : false;
    },
    prune(nowMs) {
      deps.registry.prune(nowMs);
    },
    async readBytes(hash, offset, length) {
      const channel = nextChannel();
      const requestId = `blob-read-${channel}-${deps.nowMs()}`;
      const pending = expect(requestId, channel);
      const collected = collect(channel);
      try {
        await deps.send({
          type: "worker_request",
          request_id: requestId,
          op: BLOB_READ_OP,
          payload: { hash, offset, length, channel },
        });
        if (
          !await until(pending, () => pending.answer !== undefined, readMs)
        ) {
          return UNAVAILABLE("blob 읽기 응답이 없다");
        }
        const answered = pending.answer!;
        if (!answered.ok) return err(answered.error);
        const payload = answered.payload as {
          hash: string;
          size_bytes: number;
          channel: number;
        };
        // 바이트는 JSON이 아니라 같은 channel의 byte chunk frame으로 온다.
        // control frame 한도(256KiB)보다 큰 창을 담기 위해서다.
        if (payload.channel !== channel) {
          return UNAVAILABLE("blob 읽기 channel이 다르다");
        }
        const chunks = collected.chunks;
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (total > length) {
          return UNAVAILABLE("blob 읽기 바이트가 요청한 길이를 넘는다");
        }
        const bytes = new Uint8Array(total);
        let written = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, written);
          written += chunk.length;
        }
        return ok({ hash: payload.hash, sizeBytes: payload.size_bytes, bytes });
      } catch {
        return UNAVAILABLE("blob 읽기를 넘기지 못했다");
      } finally {
        collected.stop();
        forget(requestId, channel);
      }
    },
    failPending(message) {
      for (const pending of byRequest.values()) {
        if (pending.answer !== undefined) continue;
        pending.answer = {
          ok: false,
          error: { code: "unavailable", message },
        };
        pending.respond();
        pending.wake?.();
      }
    },
    get size() {
      return deps.registry.size;
    },
    // worker가 돌려준 byte chunk frame. 읽기 요청이 모으고 있는 channel만 받는다.
    take(frame) {
      if (frame.kind !== "bytes") return;
      // 받는 쪽 상한: 요청 창(256KiB)을 넘게 쌓지 않는다. 넘으면 readBytes가 거절한다.
      const chunks = incoming.get(frame.channel);
      if (!chunks) return;
      const held = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (held > BLOB_READ_MAX_BYTES) return;
      chunks.push(frame.payload);
    },
    accept(message) {
      if (message.type === "credit") {
        const pending = byChannel.get(message.channel);
        if (pending === undefined) return;
        pending.credit += message.window;
        pending.wake?.();
        return;
      }
      if (message.type !== "worker_response") return;
      // 기다리는 요청이 없는 응답(이미 abort한 준비)은 버린다.
      const pending = byRequest.get(message.request_id);
      if (pending === undefined || pending.answer !== undefined) return;
      pending.answer = message.ok
        ? { ok: true, payload: message.payload }
        : { ok: false, error: message.error };
      pending.respond();
      pending.wake?.();
    },
  };
}
