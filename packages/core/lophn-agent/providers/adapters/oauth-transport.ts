// OAuth transport. OAuth HTTP는 HTTPS 목적지만 부르고
// redirect는 따라가지 않는다(다른 origin으로 credential을 흘리지 않는다). 사람
// credential의 loopback callback은 127.0.0.1 실제 listener로만 받는다. fake
// 브라우저는 열 주소를 돌려주는 port다(실제 OS browser는 여기서 열지 않는다 —
// shell이 sign_in.url을 OS browser로 연다).

import { err, ok, type Result } from "../../../../base/mod.ts";

// OAuth endpoint의 HTTP 응답. 본문은 상한 안에서 한 덩어리로 읽고 보존하지 않는다.
type OAuthHttpResponse = {
  status: number;
  body: string;
  headers: Headers;
};

// fetch 눈이다. 제품은 실제 fetch, 테스트는 in-process fake를 준다.
type OAuthHttpFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

// OAuth token·device 응답 본문의 읽기 상한. 분류 조각용이고 보존하지 않는다.
const OAUTH_BODY_MAX_BYTES = 65_536;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// OAuth 목적지는 HTTPS만이다. 파싱 실패는 fail closed다.
function httpsDestination(url: string): URL | null {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.protocol === "https:" ? parsed : null;
}

// xAI discovery가 알려 준 목적지도 다시 검사한다: HTTPS이고 host가 x.ai 또는
// 그 하위 도메인이어야 한다.
export function xaiHostAllowed(url: string): boolean {
  const parsed = httpsDestination(url);
  if (parsed === null) return false;
  const host = parsed.hostname;
  return host === "x.ai" || host.endsWith(".x.ai");
}

type HttpOutcome =
  | { ok: true; response: OAuthHttpResponse }
  | { ok: false; code: "unavailable" | "invalid_input"; message: string };

// OAuth endpoint 하나의 HTTP 요청. redirect는 manual이라 3xx를 응답 그대로 돌려
// 주고 따라가지 않는다(다른 목적지에 token을 보내지 않는다). 본문은 상한 안에서
// 한 덩어리로 읽는다.
export async function oauthHttp(
  fetcher: OAuthHttpFetch,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  signal: AbortSignal,
): Promise<HttpOutcome> {
  if (httpsDestination(url) === null) {
    return {
      ok: false,
      code: "invalid_input",
      message: "OAuth endpoint는 HTTPS가 아니다",
    };
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      method: init.method,
      headers: init.headers ?? {},
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: "manual",
      signal,
    });
  } catch {
    if (signal.aborted) {
      return { ok: false, code: "unavailable", message: "요청이 취소됐다" };
    }
    return {
      ok: false,
      code: "unavailable",
      message: "OAuth endpoint에 닿지 못했다",
    };
  }
  let body = "";
  try {
    body = await readBounded(response.body, OAUTH_BODY_MAX_BYTES);
  } catch {
    body = "";
  }
  return {
    ok: true,
    response: {
      status: response.status,
      body,
      headers: response.headers,
    },
  };
}

// 상한까지만 읽고 나머지는 버린다.
async function readBounded(
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

// 사람이 돌아온 loopback callback의 값. code·state와, 서버가 보낸 iss다.
export type OAuthCallback = {
  code: string;
  state: string;
  iss: string | null;
};

// loopback callback listener port. 사람이 시작한 browser가 이 주소로
// 돌아온 요청을 받는다. 제품은 127.0.0.1 실제 listener, 테스트는 가짜를 준다.
export type OAuthListener = {
  port(): number;
  receive(signal: AbortSignal): Promise<Result<OAuthCallback>>;
  close(): Promise<void>;
};

// callback listener의 실제 open port다. 없으면 begin은 unavailable이다.
export type OAuthListenerOpener = () => Promise<Result<OAuthListener>>;

// 127.0.0.1 실제 listener(제품용). browser가 돌아온 callback 요청의 code·state·iss를
// 한 번 받고 200으로 답한다. 받기 전에 끊기면 unavailable이다. listener는 begin에서
// 열리고 complete·cancel 뒤에 닫는다.
export function openCallbackListener(): Promise<Result<OAuthListener>> {
  const waiting: oauthSignalAwait[] = [];
  // receive가 아직 대기자가 없을 때 도착한 callback이다. 버려지지 않고 나중에
  // receive가 불리면 전달된다.
  let arrived: OAuthCallback | undefined;
  const handler = (request: Request): Response => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const iss = url.searchParams.get("iss");
    if (
      code !== null && code.length > 0 && state !== null && state.length > 0
    ) {
      const callback = { code, state, iss: iss === null ? null : iss };
      arrived ??= callback;
      resolveAll(waiting, callback);
    }
    return new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };
  let server: Deno.HttpServer;
  try {
    server = Deno.serve({
      hostname: "127.0.0.1",
      port: 0,
      onListen: () => {},
    }, handler);
  } catch {
    return Promise.resolve(err({
      code: "unavailable",
      message: "loopback callback listener를 열지 못했다",
    }));
  }
  const port = "port" in server.addr ? server.addr.port : 0;
  return Promise.resolve(ok({
    port: () => port,
    receive(signal) {
      if (signal.aborted) {
        return Promise.resolve(err({
          code: "unavailable",
          message: "callback 대기가 취소됐다",
        }));
      }
      // receive 전에 도착한 callback이다. 그대로 전달한다.
      if (arrived !== undefined) {
        return Promise.resolve(ok(arrived));
      }
      return new Promise<Result<OAuthCallback>>((resolve) => {
        const onAbort = () => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          resolve(err({
            code: "unavailable",
            message: "callback 대기가 취소됐다",
          }));
        };
        const entry = { resolve, onAbort };
        waiting.push(entry);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    close() {
      for (const entry of [...waiting]) entry.onAbort();
      waiting.length = 0;
      return server.shutdown();
    },
  }));
}

type oauthSignalAwait = {
  resolve(result: Result<OAuthCallback>): void;
  onAbort(): void;
};

function resolveAll(
  waiting: oauthSignalAwait[],
  callback: OAuthCallback,
): void {
  const entries = [...waiting];
  waiting.length = 0;
  for (const entry of entries) {
    entry.resolve(ok(callback));
  }
}
