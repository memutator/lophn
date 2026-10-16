import { err, ok, type Result } from "../../../../base/mod.ts";

// Streamable HTTP MCP 전송(concern lophn-agent/extensions).
// Streamable HTTP만 지원하고 SSE로 자동
// 전환하지 않는다. HTTPS가 기본이고 평문 HTTP는 loopback뿐이다.
// 다른 origin(host·scheme·port)으로의 redirect는 거절이다. TLS 검증을
// 끄는 설정은 제공하지 않는다.

const MCP_PROTOCOL_VERSION = "2025-06-18";

// 같은 origin(host·scheme·port)인지 본다. localhost와 127.0.0.1은
// port는 같아도 host가 다르므로 다른 origin이다.
function sameOrigin(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.protocol === right.protocol &&
      left.host === right.host;
  } catch {
    return false;
  }
}

// fetch 눈이다. 테스트가 끼운다. redirect는 따라가지 않고 응답 그대로 본다.
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

// 평문 HTTP 목적지 검사다. HTTPS와 loopback HTTP만 온다.
export function endpointReason(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "http url이 URL이 아니다";
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol !== "http:") return "전송이 http·https가 아니다";
  // URL.hostname은 IPv6를 대괄호째 돌려준다([::1]). 대괄호를 벗겨 비교한다.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") {
    return null;
  }
  return "평문 http는 loopback 주소에만 허용한다";
}

type HttpRequestResult =
  | { ok: true; status: number; body: Uint8Array; headers: Headers }
  // redirect 거절이다.
  | { ok: false; reason: "redirect_rejected"; detail: string }
  | { ok: false; reason: "unavailable"; detail: string }
  | { ok: false; reason: "invalid"; detail: string };

// 한 번의 HTTP 요청이다. redirect는 따라가지 않고 원래 origin이 아닌
// 목적지를 거절한다. 인증 헤더는 이 모듈이 결정하지 않고 init에 담아 온다.
export async function httpRequest(
  fetchImpl: HttpFetch,
  url: string,
  init: RequestInit,
): Promise<HttpRequestResult> {
  const endpoint = endpointReason(url);
  if (endpoint !== null) {
    return { ok: false, reason: "invalid", detail: endpoint };
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "manual" });
  } catch {
    return { ok: false, reason: "unavailable", detail: "서버에 닿지 못했다" };
  }
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location !== null) {
    let target: URL;
    try {
      target = new URL(location, new URL(url));
    } catch {
      return {
        ok: false,
        reason: "redirect_rejected",
        detail: "redirect 목적지가 URL이 아니다",
      };
    }
    // host·scheme·port가 하나라도 다르면 거절이다.
    if (!sameOrigin(url, target.href)) {
      return {
        ok: false,
        reason: "redirect_rejected",
        detail: "다른 origin(host·scheme·port)으로의 redirect다",
      };
    }
    // 같은 origin의 redirect는 응답을 그대로 돌려준다(부르는 쪽이 다시 요청한다).
    return {
      ok: true,
      status: response.status,
      body: new Uint8Array(await response.arrayBuffer()),
      headers: response.headers,
    };
  }
  return {
    ok: true,
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
    headers: response.headers,
  };
}

// 원래 origin이 아닌 redirect URL인지 본다.
export function redirectOriginRejected(
  originalUrl: string,
  location: string,
): string | null {
  let target: URL;
  try {
    target = new URL(location, new URL(originalUrl));
  } catch {
    return "redirect 목적지가 URL이 아니다";
  }
  if (sameOrigin(originalUrl, target.href)) return null;
  return "다른 origin(host·scheme·port)으로의 redirect다";
}

// initialize 요청 본문이다(MCP initialize). capabilities는 비어 있다:
// sampling·elicitation·roots를 지원하지 않는다.
export function initializeBody(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "lophn-agent", version: "0" },
    },
  };
}

// JSON-RPC 결과를 본다. HTTP 전송은 한 요청에 한 응답이다.
export function rpcResultOf(
  body: Uint8Array,
): Result<{ id: unknown; result: Record<string, unknown> }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return err({ code: "unavailable", message: "응답이 JSON이 아니다" });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err({
      code: "unavailable",
      message: "응답이 JSON-RPC 객체가 아니다",
    });
  }
  const message = parsed as Record<string, unknown>;
  if (message.error !== undefined && message.error !== null) {
    return err({
      code: "unavailable",
      message: `오류 응답이다: ${JSON.stringify(message.error)}`,
    });
  }
  const result = message.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return err({ code: "unavailable", message: "result가 없다" });
  }
  return ok({
    id: message.id,
    result: result as Record<string, unknown>,
  });
}

// 서버가 reverse 기능(sampling·elicitation·roots)을 요청할 때 같은 id로
// `-32601`(method not found)을 답한다.
