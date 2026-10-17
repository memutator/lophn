import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentPlace,
  mcpAuthBegin,
  mcpAuthBeginInputSchema,
  mcpAuthCancel,
  mcpAuthCancelInputSchema,
  mcpAuthComplete,
  mcpAuthCompleteInputSchema,
  mcpAuthState,
  mcpAuthStateInputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  secretDestinationOf,
  type SecretFileUse,
} from "../../../protocol/secrets/mod.ts";
import {
  type AuthDeadline,
  type CallbackListener,
  createMcpOAuth,
  type HttpFetch,
  type McpOAuthServer,
  type McpOAuthVault,
  mcpTokenNames,
} from "./mod.ts";
import type { McpRuntimeServer } from "./mcp-server.ts";
import type { RegisteredMcpServer } from "./mcp-snapshot.ts";

// MCP OAuth 2.1의 시작·완료·상태·취소 memory route와 연결 때의 token 부착 대조다.
// 업무 규칙은 extensions의 mcp-oauth에 있고
// 여기는 core의 입구와 재료를 끼운다.
// - 발급자(token endpoint)에 닿는 일은 이 core 프로세스가 한다. 시작에서 낸 verifier·state와 받은 token이 모두
//   core 안에만 있어야 하기 때문이다. 값은 응답·log·ledger·event 어디에도 없다.
// - token은 `secrets.json`(vault)에만 보관한다. 설정에는 token이 없다. 서버(place+이름)에서 정해지는 이름에 두고,
//   로그인했는지는 보관이 말한다.
// - ledger를 거치지 않는다: 진행 중인 로그인은 작업 메모리가 곧 상태다.

type McpAuthMemoryHandler = (
  ctx: unknown,
  input: unknown,
) => Promise<Result<unknown>>;

type McpAuthControlDeps = {
  // token 교환·갱신이 쓰는 fetch다. 테스트가 가짜 발급자를 끼운다.
  fetch: HttpFetch;
  // 사람 credential의 loopback callback listener다. 127.0.0.1에만 듣는다. 테스트가 가짜를
  // 끼우므로 사람의 실제 OS browser는 열지 않는다.
  openListener(): Promise<Result<CallbackListener>>;
  // 등록한 MCP server와 등록된 place의 읽기다(전역 서버는 place가 null). 같은 이름의 서버가 여러 place에 있을 수
  // 있어 서버는 이름과 place로 고른다.
  registered(): Promise<Result<RegisteredMcpServer[]>>;
  // token 보관이다(`secrets.json`).
  vault: McpOAuthVault;
  nowMs(): number;
  // 기다림 시한 timer다. 없으면 제품 timer다.
  deadline?: AuthDeadline;
};

function samePlace(left: AgentPlace | null, right: AgentPlace | null) {
  return left === null || right === null
    ? left === right
    : left.kind === right.kind && left.id === right.id;
}

// 서버가 가는 곳의 origin이 청한 목적지와 같은지 본다.
function sameOrigin(url: string, destination: SecretFileUse["destination"]) {
  const own = secretDestinationOf(url);
  return own !== undefined && own.kind === destination.kind &&
    own.origin === destination.origin;
}

// OAuth로 로그인하는 http 서버만 McpOAuthServer가 된다.
function oauthServerOf(
  place: AgentPlace | null,
  server: McpRuntimeServer,
): McpOAuthServer | undefined {
  if (server.transport !== "http" || server.http.auth.kind !== "oauth2") {
    return undefined;
  }
  return {
    key: { place, name: server.name },
    issuer: server.http.auth.issuer,
    serverUrl: server.http.url,
    clientId: server.http.auth.client_id,
  };
}

// 기다림 시한 timer다. 신호가 중단되면 timer를 지우고 일찍 돌아온다.
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

export function createMcpAuthControl(deps: McpAuthControlDeps): {
  handlers: ReadonlyMap<string, McpAuthMemoryHandler>;
  // 연결이 접근 token을 붙이려고 청한 이름을 현재 설정과 보관에 대조한다. OAuth token 이름이 아니면 undefined다.
  // 만료가 가까우면 여기서 갱신한다: refresh token은 core 밖으로 나가지 않는다. 값은 이 뒤 secret 부착이 읽는다.
  prepareToken(use: SecretFileUse): Promise<Result<void> | undefined>;
  endAll(): Promise<void>;
} {
  const oauth = createMcpOAuth({
    vault: deps.vault,
    fetch: deps.fetch,
    nowMs: deps.nowMs,
    deadline: deps.deadline ?? timerDeadline,
  });

  async function registeredServerOf(
    place: AgentPlace | null,
    name: string,
  ): Promise<Result<McpRuntimeServer>> {
    const loaded = await deps.registered();
    if (!loaded.ok) return loaded;
    const found = loaded.value.find((entry) =>
      entry.server.name === name && samePlace(entry.place, place)
    );
    if (found === undefined) {
      return err({ code: "not_found", message: "등록한 서버가 아니다" });
    }
    return ok(found.server);
  }

  // 로그인할 수 있는 서버: 그 place에 등록된 http oauth2 서버다.
  async function oauthTarget(
    place: AgentPlace | null,
    name: string,
  ): Promise<Result<McpOAuthServer>> {
    const config = await registeredServerOf(place, name);
    if (!config.ok) return config;
    if (config.value.transport !== "http") {
      return err({
        code: "invalid_input",
        message: "oauth2 인증은 http 서버만 고른다",
      });
    }
    const server = oauthServerOf(place, config.value);
    if (server === undefined) {
      return err({
        code: "invalid_input",
        message: "oauth2 인증 방식이 아니다",
      });
    }
    return ok(server);
  }

  const begin: McpAuthMemoryHandler = async (_ctx, input) => {
    const parsed = mcpAuthBeginInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    const { name, place } = parsed.data;
    const target = await oauthTarget(place, name);
    if (!target.ok) return target;
    // 사람이 등록한 client_id만 쓴다. 입력이 등록과 다르면 거절이다.
    if (parsed.data.client_id !== target.value.clientId) {
      return err({
        code: "invalid_input",
        message: "client_id가 등록한 것과 다르다",
      });
    }
    // 사람 credential의 callback listener다(사람 credential의 loopback callback).
    const listener = await deps.openListener();
    if (!listener.ok) return listener;
    const begun = await oauth.begin(target.value, {
      scopes: parsed.data.scopes,
      listener: listener.value,
    });
    if (!begun.ok) return begun;
    return ok({
      url: begun.value.url,
      callback_port: begun.value.callbackPort,
    });
  };

  const complete: McpAuthMemoryHandler = async (_ctx, input) => {
    const parsed = mcpAuthCompleteInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    const { name, place } = parsed.data;
    const target = await oauthTarget(place, name);
    if (!target.ok) return target;
    const done = await oauth.complete(target.value);
    if (!done.ok) return done;
    return ok({ completed: true });
  };

  const cancel: McpAuthMemoryHandler = async (_ctx, input) => {
    const parsed = mcpAuthCancelInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    // 설정에서 지워진 서버의 기다리는 로그인도 그만둘 수 있어야 한다.
    const { name, place } = parsed.data;
    return ok({ cancelled: await oauth.cancel({ key: { place, name } }) });
  };

  const state: McpAuthMemoryHandler = async (_ctx, input) => {
    const parsed = mcpAuthStateInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    const loaded = await deps.registered();
    if (!loaded.ok) return loaded;
    const servers = [];
    for (const { name, place } of parsed.data.servers) {
      const found = loaded.value.find((entry) =>
        entry.server.name === name && samePlace(entry.place, place)
      );
      const server = found === undefined
        ? undefined
        : oauthServerOf(place, found.server);
      // 등록하지 않았거나 OAuth가 아닌 서버는 로그인할 것이 없다.
      const report = server === undefined
        ? { state: "none" as const, reason: null }
        : await oauth.report(server);
      servers.push({ name, place, ...report });
    }
    return ok({ servers });
  };

  return {
    handlers: new Map([
      [`${mcpAuthBegin.resource}/${mcpAuthBegin.method}`, begin],
      [`${mcpAuthComplete.resource}/${mcpAuthComplete.method}`, complete],
      [`${mcpAuthState.resource}/${mcpAuthState.method}`, state],
      [`${mcpAuthCancel.resource}/${mcpAuthCancel.method}`, cancel],
    ]),

    async prepareToken(use) {
      if (!use.name.startsWith("mcp-oauth.")) return undefined;
      const loaded = await deps.registered();
      if (!loaded.ok) {
        return err({
          code: "unavailable",
          message: "MCP 서버 설정을 읽지 못했다",
        });
      }
      // 이 이름을 자기 접근 token으로 가진 켜진 서버만 쓴다. token은 로그인한 서버의 URL origin에만 간다.
      const match = loaded.value.find((entry) => {
        const server = oauthServerOf(entry.place, entry.server);
        return server !== undefined && entry.server.enabled &&
          mcpTokenNames(server.key).access === use.name &&
          sameOrigin(server.serverUrl, use.destination);
      });
      if (match === undefined) {
        return err({
          code: "forbidden",
          message: "secret 전송을 허용하지 않는다",
        });
      }
      return await oauth.access(oauthServerOf(match.place, match.server)!);
    },

    endAll: () => oauth.endAll(),
  };
}

// 사람 credential의 loopback callback listener다. 127.0.0.1에만 듣는다.
// 사람이 OS browser에서 돌아온 callback 요청을 받아 code·state를 옮긴다. 실제 browser 열기는
// shell이 크롬 링크로 하고 이 listener는 닿는 요청만 받는다. 요청 하나를 마치면 닫는다.
// 취소나 기다림 시한은 받기에 건 AbortSignal이 끊고 unavailable로 돌아온다.
export function openMcpCallbackListener(): Promise<Result<CallbackListener>> {
  const settled: { code: string | null; state: string | null } = {
    code: null,
    state: null,
  };
  let accepted: () => void = () => {};
  const incoming = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let http: Deno.HttpServer<Deno.NetAddr>;
  try {
    http = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      (request: Request) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (code === null || code.length === 0 || state === null) {
          return new Response("요청 값이 부족하다", { status: 400 });
        }
        settled.code = code;
        settled.state = state;
        accepted();
        return new Response("", { status: 200 });
      },
    );
  } catch {
    return Promise.resolve(err({
      code: "unavailable",
      message: "loopback callback port를 열 수 없다",
    }));
  }
  const port = http.addr.port;
  return Promise.resolve(ok({
    port: () => port,
    receive(signal: AbortSignal) {
      const aborted = new Promise<null>((resolve) => {
        if (signal.aborted) resolve(null);
        else {signal.addEventListener("abort", () => resolve(null), {
            once: true,
          });}
      });
      return Promise.race([incoming, aborted]).then((how): Result<{
        code: string;
        state: string;
        iss: string | null;
      }> => {
        if (how === null || settled.code === null || settled.state === null) {
          return err({
            code: "unavailable",
            message: "callback이 오지 않았다",
          });
        }
        return ok({ code: settled.code, state: settled.state, iss: null });
      });
    },
    close(): Promise<void> {
      return Promise.resolve(http.shutdown());
    },
  }));
}
