import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  MCP_AUTH_REQUEST_BODY_MAX,
  type McpAuthRequest,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type {
  AuthDeadline,
  HttpFetch,
} from "../../packages/core/lophn-agent/extensions/mod.ts";

// MCP OAuth 발급자(token endpoint) 호출의 대기열이다(concern lophn-agent/extensions, requirements #R16, #R17).
// core module graph에는 외부 fetch를 두지 않는다(platform/responsiveness#R1). 발급자에 닿는 network는 agent
// runtime의 몫이므로(architecture §2.3: `--allow-net`에 등록 MCP HTTP·검증된 issuer) core의 token 교환·갱신은 이
// 대기열에 요청을 놓고, runtime이 machine 입구(`TakeMcpAuthRequest`)로 가져가 대신 보낸 뒤 응답을
// (`FinishMcpAuthRequest`)로 돌려준다.
// - 대기열은 작업 메모리다: 요청·응답 본문(code·verifier·token)을 ledger·event·log 어디에도 남기지 않는다.
// - 기한 안에 답이 없으면(runtime이 없거나 발급자가 느리면) 요청은 실패하고 대기열에서 빠진다. 늦은 답은 받지 않는다.

export const MCP_AUTH_REQUEST_WAIT_MS = 8_000;

type Entry = {
  request: McpAuthRequest;
  taken: boolean;
  settle(response: Response | undefined): void;
  stop: AbortController;
};

type Handler = (ctx: unknown, input: unknown) => Promise<Result<unknown>>;

// 기한 timer다. 신호가 중단되면 timer를 지우고 일찍 돌아온다.
const timerDeadline: AuthDeadline = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve("aborted");
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve("elapsed");
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve("aborted");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });

// null 본문이어야 하는 상태다(Response 생성자 규칙).
const NO_BODY = new Set([101, 204, 205, 304]);

export function createMcpAuthRequests(options: {
  newId(): string;
  waitMs?: number;
  deadline?: AuthDeadline;
}): {
  // core가 발급자에 보내는 요청이다. HttpFetch 모양이라 token 교환·갱신 코드가 그대로 쓴다. 기한이 지나거나
  // runtime이 닿지 못하면 던진다(부르는 쪽이 연결 실패로 바꾼다).
  fetch: HttpFetch;
  // runtime이 가져갈 가장 오래된 요청이다. 없으면 null이다.
  take(): McpAuthRequest | null;
  // runtime의 답이다. 아직 기다리는 요청이면 true다. 응답이 null이면 발급자에 닿지 못한 것이다.
  done(id: string, response: DoneResponse | null): boolean;
  handlers: ReadonlyMap<string, Handler>;
} {
  const waitMs = options.waitMs ?? MCP_AUTH_REQUEST_WAIT_MS;
  const deadline = options.deadline ?? timerDeadline;
  const entries = new Map<string, Entry>();

  function take(): McpAuthRequest | null {
    for (const entry of entries.values()) {
      if (entry.taken) continue;
      entry.taken = true;
      return entry.request;
    }
    return null;
  }

  function done(id: string, response: DoneResponse | null): boolean {
    const entry = entries.get(id);
    if (entry === undefined) return false;
    entries.delete(id);
    entry.stop.abort();
    entry.settle(
      response === null ? undefined : new Response(
        NO_BODY.has(response.status) ? null : response.body,
        {
          status: response.status,
          ...(response.location === null
            ? {}
            : { headers: { location: response.location } }),
        },
      ),
    );
    return true;
  }

  const requestFetch: HttpFetch = (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    if (
      !url.startsWith("https://") || init.method !== "POST" ||
      typeof init.body !== "string" ||
      init.body.length > MCP_AUTH_REQUEST_BODY_MAX
    ) {
      return Promise.reject(new Error("보낼 수 없는 요청이다"));
    }
    const request: McpAuthRequest = {
      id: options.newId(),
      url,
      method: "POST",
      headers,
      body: init.body,
    };
    return new Promise<Response>((resolve, reject) => {
      const stop = new AbortController();
      entries.set(request.id, {
        request,
        taken: false,
        stop,
        settle: (response) =>
          response === undefined
            ? reject(new Error("발급자에 닿지 못했다"))
            : resolve(response),
      });
      void deadline(waitMs, stop.signal).then((how) => {
        if (how !== "elapsed") return;
        // 기한이 지났다. 늦게 오는 답은 받지 않는다.
        if (entries.delete(request.id)) {
          reject(new Error("발급자 호출이 기한 안에 끝나지 않았다"));
        }
      });
    });
  };

  const takeHandler: Handler = (_ctx, input) => {
    if (!mcpAuthRequestTake.input.safeParse(input).success) {
      return Promise.resolve(
        err({ code: "invalid_input", message: "입력이 올바르지 않다" }),
      );
    }
    return Promise.resolve(ok({ request: take() }));
  };

  const doneHandler: Handler = (_ctx, input) => {
    const parsed = mcpAuthRequestDone.input.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        err({ code: "invalid_input", message: "입력이 올바르지 않다" }),
      );
    }
    return Promise.resolve(
      ok({ accepted: done(parsed.data.id, parsed.data.response) }),
    );
  };

  return {
    fetch: requestFetch,
    take,
    done,
    handlers: new Map([
      [
        `${mcpAuthRequestTake.resource}/${mcpAuthRequestTake.method}`,
        takeHandler,
      ],
      [
        `${mcpAuthRequestDone.resource}/${mcpAuthRequestDone.method}`,
        doneHandler,
      ],
    ]),
  };
}

type DoneResponse = { status: number; location: string | null; body: string };
