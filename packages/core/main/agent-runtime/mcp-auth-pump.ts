import { routePath } from "../../../protocol/base/mod.ts";
import {
  MCP_AUTH_REQUEST_BODY_MAX,
  type McpAuthRequest,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";

// MCP OAuth 발급자(token endpoint) 호출을 core 대신 보낸다(concern lophn-agent/extensions, requirements #R16, #R17).
// core module graph에는 외부 fetch가 없어서 core가 token 교환·갱신 요청을 대기열에 놓고,
// 이 pump가 machine 입구로 하나씩 가져가 이 프로세스의 `--allow-net`(등록한 OAuth 서버의 발급자)이 허락하는 곳에만
// 보낸다. 허락 밖 목적지는 Deno 권한이 막으므로 응답 없음(닿지 못함)으로 돌아간다.
// 요청·응답에는 code·verifier·refresh token·새 token이 있으므로 어디에도 남기지 않고 오류와 log에 싣지 않는다.

export const MCP_AUTH_PUMP_IDLE_MS = 250;
// 발급자 한 번 호출의 상한이다. core가 기다리는 기한(8초)보다 짧아야 닿지 못했다는 답이 제때 간다.
export const MCP_AUTH_FETCH_TIMEOUT_MS = 6_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function send(
  request: McpAuthRequest,
  fetchImpl: Fetch,
  timeoutMs: number,
) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      // 다른 origin으로 따라가지 않는다. 3xx는 Location과 함께 돌려주고 판단은 core의 코드가 한다.
      redirect: "manual",
      signal: timeout.signal,
    });
    const body = await response.text();
    if (body.length > MCP_AUTH_REQUEST_BODY_MAX) return null;
    return {
      status: response.status,
      location: response.headers.get("location"),
      body,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function startMcpAuthPump(options: {
  // machine 자격의 core loopback이다.
  call: CoreCall;
  fetch: Fetch;
  signal: AbortSignal;
  idleMs?: number;
  fetchTimeoutMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const idleMs = options.idleMs ?? MCP_AUTH_PUMP_IDLE_MS;
  const timeoutMs = options.fetchTimeoutMs ?? MCP_AUTH_FETCH_TIMEOUT_MS;
  const wait = options.wait ?? abortableWait;
  while (!options.signal.aborted) {
    let worked = false;
    try {
      const taken = await readOf(options.call, mcpAuthRequestTake, {});
      const request = taken.ok ? taken.value.request : null;
      if (request !== null) {
        worked = true;
        const response = await send(request, options.fetch, timeoutMs);
        await options.call(routePath(mcpAuthRequestDone), {
          id: request.id,
          response,
        });
      }
    } catch {
      // core에 닿지 못했거나 답이 이상하다. 값을 싣지 않고 다음 차례에 다시 본다.
    }
    // 일을 한 직후에는 곧바로 다음 요청을 본다. 없거나 core에 닿지 못하면 쉰다.
    if (!worked) await wait(idleMs, options.signal);
  }
}
