// 실제 HTTP 전송(provider#R19, R20, R25). fetch로 한 번만 보내고 SDK 숨은 retry는
// 없다. redirect는 따라가지 않는다: 다른 목적지에 credential을 보내지 않기 위해
// 3xx는 본문 없는 응답으로 돌려주고 분류가 원인 불명으로 둔다(R5, R16). 응답 body는
// 성공 SSE만 stream으로 넘기고 나머지는 상한 안에서 한 덩어리로 읽는다(batch/JSON).

import { err, ok, type Result } from "../../../../base/mod.ts";
import { ERROR_BODY_MAX_BYTES } from "../failures.ts";
import type {
  AuthTransport,
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

// option 값이 요구하는 header(예: Anthropic fast mode의 beta header)를 요청에 더한다(harness/model#R22).
// 호출 형식이 이미 정한 header는 같은 이름(대소문자 무시)이면 그대로 두고, 인증 header는 이 층 안쪽의
// 인증 transport가 마지막에 붙이므로 option이 바꾸지 못한다.
export function withRequestHeaders(
  inner: AuthTransport,
  headers: Readonly<Record<string, string>>,
): AuthTransport {
  const extra = Object.entries(headers);
  if (extra.length === 0) return inner;
  return {
    send(request) {
      const merged = { ...request.headers };
      const have = new Set(
        Object.keys(merged).map((name) => name.toLowerCase()),
      );
      for (const [name, value] of extra) {
        if (have.has(name.toLowerCase())) continue;
        merged[name] = value;
      }
      return inner.send({ ...request, headers: merged });
    },
  };
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
