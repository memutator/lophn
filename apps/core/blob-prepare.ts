// core의 blob 준비 중계(blob contract, platform/blob-store#R1).
// 준비 참조는 principal·purpose·hash·크기와 10분 수명으로 core 메모리에 등록된다.
// core는 파일을 다시 hash하지 않는다. 바이트는 해석 없이 I/O worker로 넘긴다(Q6).

import {
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  BLOB_PREPARE_OP,
  BLOB_READ_OP,
  type BlobPrepareChunk,
} from "../../packages/contracts/platform/mod.ts";
import {
  type PreparationRegistry,
} from "../../packages/platform/blob-store/mod.ts";

// I/O worker의 감독 session에서 쓰는 callback 묶음. core가 넣는다.
export type BlobPrepareRelay = {
  // worker_request에 byte chunk를 묶어 보낸다. 내용을 해석하지 않는다.
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
};

export type PreparedRelayResult = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

export type BlobRelayDeps = {
  // I/O worker에 worker_request json frame과 byte chunk frame을 쓴다.
  send(payload: unknown): Promise<void>;
  // 요청의 channel에 묶인 byte chunk를 쓴다.
  sendBytes(channel: number, chunk: Uint8Array): Promise<void>;
  // worker_response를 기다린다. core가 callback으로 넣는다.
  responses: { queue: Map<string, unknown> };
  // 준비 참조 registry. 등록은 worker_response 성공 때 한다.
  registry: PreparationRegistry;
  nowMs(): number;
  // writer 메모리에 같은 참조를 남긴다. 등록 판정은 그 메모리를 본다.
  note(prepared: PreparedRelayResult, nowMs: number): Promise<Result<void>>;
};

export function createBlobPrepareRelay(deps: BlobRelayDeps): BlobPrepareRelay {
  let channelCounter = 0;
  return {
    async prepare(input, bytes) {
      channelCounter = channelCounter % 0xffffffff + 1;
      const channel = channelCounter;
      const requestId = `blob-prepare-${channel}-${deps.nowMs()}`;
      // child dispatch는 frame을 하나씩 처리한다. byte chunk를 요청 json보다 먼저
      // 보내야 worker가 요청을 볼 때 이미 내용이 모여 있다(Q6).
      const chunks: BlobPrepareChunk[] = [];
      const reader = bytes.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push({ kind: "bytes", channel, payload: next.value });
      }
      try {
        reader.releaseLock();
      } catch { /* 이미 닫힌 stream */ }
      for (const chunk of chunks) {
        await deps.sendBytes(chunk.channel, chunk.payload);
      }
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
      const answered = await waitFor(deps.responses, requestId);
      if (!answered.ok) {
        return err(answered.error);
      }
      const payload = answered.payload as PreparedRelayResult;
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
    },
    live(prepared, nowMs) {
      const found = deps.registry.live(prepared, nowMs);
      return found.ok ? found.value : false;
    },
    prune(nowMs) {
      deps.registry.prune(nowMs);
    },
    async readBytes(hash, offset, length) {
      channelCounter = channelCounter % 0xffffffff + 1;
      const requestId = `blob-read-${channelCounter}-${deps.nowMs()}`;
      await deps.send({
        type: "worker_request",
        request_id: requestId,
        op: BLOB_READ_OP,
        payload: { hash, offset, length },
      });
      const answered = await waitFor(deps.responses, requestId);
      if (!answered.ok) return err(answered.error);
      const payload = answered.payload as {
        hash: string;
        size_bytes: number;
        bytes: string;
      };
      const raw = atob(payload.bytes);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return ok({ hash: payload.hash, sizeBytes: payload.size_bytes, bytes });
    },
    get size() {
      return deps.registry.size;
    },
  };
}

async function waitFor(
  responses: { queue: Map<string, unknown> },
  requestId: string,
): Promise<
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } }
> {
  // queue를 감시한다. worker_response는 core의 onMessage callback이 채운다.
  for (let waited = 0; waited < 120; waited++) {
    const found = responses.queue.get(requestId);
    if (found !== undefined) {
      responses.queue.delete(requestId);
      const value = found as {
        ok: boolean;
        payload?: unknown;
        error?: { code: ErrorCode; message: string };
      };
      if (value.ok) return { ok: true, payload: value.payload };
      return {
        ok: false,
        error: value.error ??
          { code: "unavailable", message: "blob 준비에 실패했다" },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    ok: false,
    error: { code: "unavailable", message: "blob 준비 응답이 없다" },
  };
}
