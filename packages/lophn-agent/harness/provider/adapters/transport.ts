// 실제 HTTP 전송(provider#R19, R20, R25). fetch로 한 번만 보내고 SDK 숨은 retry는
// 없다. redirect는 따라가지 않는다: 다른 목적지에 credential을 보내지 않기 위해
// 3xx는 본문 없는 응답으로 돌려주고 분류가 원인 불명으로 둔다(R5, R16). 응답 body는
// 성공 SSE만 stream으로 넘기고 나머지는 상한 안에서 한 덩어리로 읽는다(batch/JSON).

import { err, ok, type Result } from "../../../../base/mod.ts";
import { ERROR_BODY_MAX_BYTES } from "../failures.ts";
import type {
  Transport,
  TransportRequest,
  TransportResponse,
} from "./auth-transport.ts";

// 상한까지만 읽고 나머지는 버린다. 읽은 본문은 분류 조각용이고 보존하지 않는다.
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const room = maxBytes - total;
      if (room <= 0) break;
      const piece = next.value.byteLength > room
        ? next.value.subarray(0, room)
        : next.value;
      chunks.push(piece);
      total += piece.byteLength;
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function isEventStream(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().startsWith(
    "text/event-stream",
  );
}

export function createFetchTransport(
  fetchImpl: typeof fetch = fetch,
): Transport {
  return async (
    request: TransportRequest,
  ): Promise<Result<TransportResponse>> => {
    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal: request.signal,
      });
    } catch (error) {
      // 기한·취소는 호출자가 signal로 안다. 연결 실패는 일시 실패 분류의 근거다.
      if (request.signal?.aborted) {
        return err({
          code: "unavailable",
          message: "request aborted",
          details: { transport: "aborted" },
        });
      }
      void error;
      return err({
        code: "unavailable",
        message: "connection failed",
        details: { transport: "connection_failed" },
      });
    }
    const headers = response.headers;
    if (
      response.status >= 200 && response.status < 300 && isEventStream(headers)
    ) {
      return ok({
        status: response.status,
        headers,
        stream: response.body,
        json: null,
      });
    }
    let json: string;
    try {
      json = await readBounded(response.body, ERROR_BODY_MAX_BYTES);
    } catch {
      json = "";
    }
    return ok({ status: response.status, headers, stream: null, json });
  };
}
