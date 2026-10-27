import { routePath } from "../../../protocol/base/mod.ts";
import {
  ISSUER_REQUEST_BODY_MAX,
  type IssuerRequest,
  issuerRequestDone,
  issuerRequestTake,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";

// OAuth 발급자 호출(MCP 서버와 구독 provider의 token 교환·갱신, JWKS, device code)을 core 대신 보낸다.
// core module graph에는 외부 fetch가 없어서 core가 요청을 대기열에 놓고,
// 이 pump가 machine 입구로 하나씩 가져가 보낸다. 이 프로세스는 lophn 자신의 것이라 나가는 곳이
// 막히지 않는다: 어디로 보낼지는 core가 대기열에 넣을 때 정한다.
// 요청·응답에는 code·verifier·refresh token·새 token이 있으므로 어디에도 남기지 않고 오류와 log에 싣지 않는다.

const ISSUER_PUMP_IDLE_MS = 250;
// 발급자 한 번 호출의 상한이다. core가 기다리는 기한(8초)보다 짧아야 닿지 못했다는 답이 제때 간다.
const ISSUER_FETCH_TIMEOUT_MS = 6_000;

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
  request: IssuerRequest,
  fetchImpl: Fetch,
  timeoutMs: number,
) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.method === "GET" ? {} : { body: request.body }),
      // 다른 origin으로 따라가지 않는다. 3xx는 Location과 함께 돌려주고 판단은 core의 코드가 한다.
      redirect: "manual",
      signal: timeout.signal,
    });
    const body = await response.text();
    if (body.length > ISSUER_REQUEST_BODY_MAX) return null;
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

export async function startIssuerPump(options: {
  // machine 자격의 core loopback이다.
  call: CoreCall;
  fetch: Fetch;
  signal: AbortSignal;
  idleMs?: number;
  fetchTimeoutMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const idleMs = options.idleMs ?? ISSUER_PUMP_IDLE_MS;
  const timeoutMs = options.fetchTimeoutMs ?? ISSUER_FETCH_TIMEOUT_MS;
  const wait = options.wait ?? abortableWait;
  while (!options.signal.aborted) {
    let worked = false;
    try {
      const taken = await readOf(options.call, issuerRequestTake, {});
      const request = taken.ok ? taken.value.request : null;
      if (request !== null) {
        worked = true;
        const response = await send(request, options.fetch, timeoutMs);
        await options.call(routePath(issuerRequestDone), {
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
