import {
  cryptoRandom,
  err,
  errorCode,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  type AgentId,
  mcpAuthBegin,
  mcpAuthBeginInputSchema,
  mcpAuthCallback,
  mcpAuthCallbackInputSchema,
  mcpAuthCancel,
  mcpAuthCancelInputSchema,
  mcpAuthComplete,
  mcpAuthCompleteInputSchema,
  mcpAuthState,
  mcpAuthStateInputSchema,
  type McpOwnerWorkspace,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  secretDestinationOf,
  type SecretFileUse,
  type SecretStorePort,
} from "../../../protocol/secrets/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { serve, type ServeHandle } from "../../server/serve.ts";
import {
  type AuthDeadline,
  type CallbackListener,
  type CallbackOptions,
  createMcpOAuth,
  type HttpFetch,
  type McpOAuthServer,
  type McpOAuthVault,
  mcpTokenNames,
} from "./mod.ts";
import {
  createHandoffListener,
  type HandoffListener,
  handoffPort,
} from "./callback-handoff.ts";
import { mcpOwnerScope } from "./mcp-oauth-vault.ts";
import type { McpRuntimeServer } from "./mcp-server.ts";
import type { RegisteredMcpServer } from "./mcp-snapshot.ts";

// MCP OAuth 2.1의 시작·완료·상태·취소 memory route와 연결 때의 token 부착 대조다.
// 업무 규칙은 extensions의 mcp-oauth에 있고
// 여기는 core의 입구와 재료를 끼운다.
// - 발급자(token endpoint)에 닿는 일은 이 core 프로세스가 한다. 시작에서 낸 verifier·state와 받은 token이 모두
//   core 안에만 있어야 하기 때문이다. 값은 응답·log·ledger·event 어디에도 없다.
// - token은 `secrets.json`(vault)에만 보관한다. 설정에는 token이 없다. 서버(workspace+이름)에서 정해지는 이름에 두고,
//   로그인했는지는 보관이 말한다.
// - ledger를 거치지 않는다: 진행 중인 로그인은 작업 메모리가 곧 상태다.

type McpAuthMemoryHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Promise<Result<unknown>>;

type McpAuthControlDeps = {
  // token 교환·갱신이 쓰는 fetch다. 테스트가 가짜 발급자를 끼운다.
  fetch: HttpFetch;
  // 사람 credential의 loopback callback listener다. 127.0.0.1에만 듣는다. 테스트가 가짜를
  // 끼우므로 사람의 실제 OS browser는 열지 않는다.
  openListener(): Promise<Result<CallbackListener>>;
  // 등록한 MCP server의 읽기다(전역 서버는 workspace와 agent가 모두 null). 같은 이름의 서버가 여러 소유자에 있을 수
  // 있어 서버는 이름과 소유자(workspace 또는 agent)로 고른다.
  registered(): Promise<Result<RegisteredMcpServer[]>>;
  // token 보관이다(`secrets.json`).
  vault: McpOAuthVault;
  // 사람이 넣은 client secret 값이다. 값은 발급자 요청 본문에만 실리고 응답·log에 남지 않는다.
  secrets: Pick<SecretStorePort, "get">;
  nowMs(): number;
  // 기다림 시한 timer다. 없으면 제품 timer다.
  deadline?: AuthDeadline;
};

// 서버의 소유자는 workspace나 agent 중 하나다. 둘 다 있으면 어느 서버인지 정할 수 없다.
const TWO_OWNERS = err({
  code: "invalid_input" as const,
  message: "서버 자리와 agent 중 하나만 고른다",
});

// 소유자 열쇠(`global`, `home`, workspace id)가 같은 서버만 같은 자리다.
function sameWorkspace(
  left: McpOwnerWorkspace | null,
  right: McpOwnerWorkspace | null,
) {
  return mcpOwnerScope(left) === mcpOwnerScope(right);
}

// 서버가 가는 곳의 origin이 청한 목적지와 같은지 본다.
function sameOrigin(url: string, destination: SecretFileUse["destination"]) {
  const own = secretDestinationOf(url);
  return (
    own !== undefined &&
    own.kind === destination.kind &&
    own.origin === destination.origin
  );
}

// OAuth로 로그인하는 http 서버만 McpOAuthServer가 된다. client secret은 사람이 넣은 값을 이름으로 읽는다.
function oauthServerOf(
  workspace: McpOwnerWorkspace | null,
  agent: AgentId | null,
  server: McpRuntimeServer,
  secretValue: (name: string) => string | null,
): McpOAuthServer | undefined {
  if (server.transport !== "http" || server.http.auth.kind !== "oauth2") {
    return undefined;
  }
  const auth = server.http.auth;
  return {
    key: { workspace, agent, name: server.name },
    issuer: auth.issuer,
    serverUrl: server.http.url,
    clientId: auth.client_id,
    clientSecret:
      auth.client_secret === null ? null : secretValue(auth.client_secret),
  };
}

// 기다림 시한 timer다. 신호가 중단되면 timer를 지우고 일찍 돌아온다.
export const timerDeadline: AuthDeadline = (ms, signal) =>
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

  // 기기가 시작한 로그인의 callback 받는 자리다. 서버(소유자와 이름)마다 하나다.
  const handoffs = new Map<string, HandoffListener>();
  const ownerKey = (
    workspace: McpOwnerWorkspace | null,
    agent: AgentId | null,
    name: string,
  ) => `${mcpOwnerScope(workspace)}\0${agent ?? ""}\0${name}`;

  // 사람이 넣은 client secret 값이다. 없는 이름과 빈 값은 없는 것으로 본다.
  function secretValue(name: string): string | null {
    const got = deps.secrets.get(name);
    return got.ok && got.value !== "" ? got.value : null;
  }

  async function registeredServerOf(
    workspace: McpOwnerWorkspace | null,
    agent: AgentId | null,
    name: string,
  ): Promise<Result<McpRuntimeServer>> {
    const loaded = await deps.registered();
    if (!loaded.ok) return loaded;
    const found = loaded.value.find(
      (entry) =>
        entry.server.name === name &&
        entry.agent === agent &&
        sameWorkspace(entry.workspace, workspace),
    );
    if (found === undefined) {
      return err({ code: "not_found", message: "등록한 서버가 아니다" });
    }
    return ok(found.server);
  }

  // 로그인할 수 있는 서버: 그 소유자에 등록된 http oauth2 서버다.
  async function oauthTarget(
    workspace: McpOwnerWorkspace | null,
    agent: AgentId | null,
    name: string,
  ): Promise<Result<McpOAuthServer>> {
    const config = await registeredServerOf(workspace, agent, name);
    if (!config.ok) return config;
    if (config.value.transport !== "http") {
      return err({
        code: "invalid_input",
        message: "oauth2 인증은 http 서버만 고른다",
      });
    }
    const server = oauthServerOf(workspace, agent, config.value, secretValue);
    if (server === undefined) {
      return err({
        code: "invalid_input",
        message: "oauth2 인증 방식이 아니다",
      });
    }
    return ok(server);
  }

  const begin: McpAuthMemoryHandler = async (ctx, input) => {
    const parsed = mcpAuthBeginInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    const { name, workspace, agent } = parsed.data;
    if (workspace !== null && agent !== null) return TWO_OWNERS;
    const target = await oauthTarget(workspace, agent, name);
    if (!target.ok) return target;
    // 사람이 등록한 client_id만 쓴다. 입력이 등록과 다르면 거절이다.
    if (parsed.data.client_id !== target.value.clientId) {
      return err({
        code: "invalid_input",
        message: "client_id가 등록한 것과 다르다",
      });
    }
    // 기기(폰, 다른 컴퓨터)가 시작한 로그인은 이 기계에 browser가 없어도 끝나야 한다: port를 쥐지 않고 그 기기가 건네는
    // callback을 기다린다.
    const handoff = ctx.principal.startsWith("device:")
      ? createHandoffListener({
          port: handoffPort(cryptoRandom),
          path: "/callback",
        })
      : null;
    // 사람 credential의 callback listener다(사람 credential의 loopback callback).
    const listener = handoff === null ? await deps.openListener() : ok(handoff);
    if (!listener.ok) return listener;
    const begun = await oauth.begin(target.value, {
      scopes: parsed.data.scopes,
      listener: listener.value,
    });
    if (!begun.ok) return begun;
    const id = ownerKey(workspace, agent, name);
    if (handoff === null) handoffs.delete(id);
    else {
      const stateParam = new URL(begun.value.url).searchParams.get("state");
      if (stateParam !== null) handoff.expectState(stateParam);
      handoffs.set(id, handoff);
    }
    return ok({
      url: begun.value.url,
      callback_port: begun.value.callbackPort,
      callback_mode: handoff === null ? "local" : "remote_handoff",
      redirect_uri: `http://127.0.0.1:${begun.value.callbackPort}/callback`,
    });
  };

  // 건넨 callback으로 교환까지 마친다. 기기는 오래 기다리는 complete를 부르지 않는다.
  const callback: McpAuthMemoryHandler = async (_ctx, input) => {
    const parsed = mcpAuthCallbackInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    const { name, workspace, agent, callback_url } = parsed.data;
    if (workspace !== null && agent !== null) return TWO_OWNERS;
    const target = await oauthTarget(workspace, agent, name);
    if (!target.ok) return target;
    const id = ownerKey(workspace, agent, name);
    const held = handoffs.get(id);
    if (held === undefined) {
      return err({
        code: "conflict",
        message: "기기가 시작한 로그인이 아니다",
      });
    }
    const delivered = held.deliver(callback_url);
    if (!delivered.ok) return delivered;
    handoffs.delete(id);
    const done = await oauth.complete(target.value);
    return done.ok ? ok({ completed: true }) : done;
  };

  const complete: McpAuthMemoryHandler = async (_ctx, input) => {
    const parsed = mcpAuthCompleteInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "서버 이름이 올바르지 않다",
      });
    }
    const { name, workspace, agent } = parsed.data;
    if (workspace !== null && agent !== null) return TWO_OWNERS;
    const target = await oauthTarget(workspace, agent, name);
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
    const { name, workspace, agent } = parsed.data;
    if (workspace !== null && agent !== null) return TWO_OWNERS;
    handoffs.delete(ownerKey(workspace, agent, name));
    return ok({
      cancelled: await oauth.cancel({ key: { workspace, agent, name } }),
    });
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
    for (const { name, workspace, agent } of parsed.data.servers) {
      if (workspace !== null && agent !== null) return TWO_OWNERS;
      const found = loaded.value.find(
        (entry) =>
          entry.server.name === name &&
          entry.agent === agent &&
          sameWorkspace(entry.workspace, workspace),
      );
      const server =
        found === undefined
          ? undefined
          : oauthServerOf(workspace, agent, found.server, secretValue);
      // 등록하지 않았거나 OAuth가 아닌 서버는 로그인할 것이 없다.
      const report =
        server === undefined
          ? { state: "none" as const, reason: null }
          : await oauth.report(server);
      servers.push({ name, workspace, agent, ...report });
    }
    return ok({ servers });
  };

  return {
    handlers: new Map([
      [`${mcpAuthBegin.resource}/${mcpAuthBegin.method}`, begin],
      [`${mcpAuthComplete.resource}/${mcpAuthComplete.method}`, complete],
      [`${mcpAuthCallback.resource}/${mcpAuthCallback.method}`, callback],
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
        const server = oauthServerOf(
          entry.workspace,
          entry.agent,
          entry.server,
          secretValue,
        );
        return (
          server !== undefined &&
          entry.server.enabled &&
          mcpTokenNames(server.key).access === use.name &&
          sameOrigin(server.serverUrl, use.destination)
        );
      });
      if (match === undefined) {
        return err({
          code: "forbidden",
          message: "secret 전송을 허용하지 않는다",
        });
      }
      return await oauth.access(
        oauthServerOf(match.workspace, match.agent, match.server, secretValue)!,
      );
    },

    endAll: () => oauth.endAll(),
  };
}

// OAuth loopback callback listener다(MCP 서버, 앱, 구독 provider 로그인이 같이 쓴다). loopback에만 듣는다.
// 사람이 OS browser에서 돌아온 callback 요청을 받아 code·state·발급 client_id를 옮긴다. 실제 browser 열기는
// shell이 크롬 링크로 하고 이 listener는 닿는 요청만 받는다. 맞는 callback 하나만 받는다: path나 state가 다르거나
// code가 빈 요청은 400으로 돌려보내고 계속 기다린다. 발급자가 `error`로 돌려보내면(state를 정했으면 그 state와 함께
// 와야 한다) 받기는 forbidden으로 끝난다. 취소나 기다림 시한은 받기에 건 AbortSignal이 끊고 unavailable로 돌아온다.
// 정한 port를 다른 프로세스가 쓰고 있으면 conflict다.
export async function openCallbackListener(
  options: CallbackOptions = {},
): Promise<Result<CallbackListener>> {
  let settled: Callback | "refused" | null = null;
  let accepted: () => void = () => {};
  const incoming = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let port = options.port ?? 0;
  const handler = (request: Request) => {
    const url = new URL(request.url);
    if (settled !== null) {
      return new Response("이미 받은 로그인이다", { status: 409 });
    }
    if (options.path !== undefined && url.pathname !== options.path) {
      return new Response("모르는 주소다", { status: 404 });
    }
    const state = url.searchParams.get("state");
    const ours = options.state === undefined || state === options.state;
    if (url.searchParams.get("error") !== null && ours) {
      settled = "refused";
      accepted();
      return new Response(CALLBACK_REFUSED, CALLBACK_PAGE);
    }
    const code = url.searchParams.get("code");
    if (code === null || code.length === 0 || state === null || !ours) {
      return new Response("요청 값이 맞지 않는다", { status: 400 });
    }
    settled = {
      code,
      state,
      iss: url.searchParams.get("iss"),
      client_id: url.searchParams.get("client_id"),
    };
    accepted();
    return new Response(CALLBACK_DONE, CALLBACK_PAGE);
  };
  const servers: ServeHandle[] = [];
  const closeAll = () =>
    Promise.all(servers.map((server) => server.shutdown())).then(() => {});
  for (const hostname of options.hosts ?? ["127.0.0.1"]) {
    try {
      servers.push(
        await serve(
          {
            hostname,
            port,
            onListen: (addr) => {
              port = addr.port;
            },
          },
          handler,
        ),
      );
    } catch (thrown) {
      const code = errorCode(thrown);
      // IPv6가 없는 기계에서는 ::1을 잡을 수 없다. 그 주소로 오는 callback도 없다.
      if (
        servers.length > 0 &&
        (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT")
      ) {
        continue;
      }
      await closeAll();
      return code === "EADDRINUSE"
        ? err({
            code: "conflict",
            message: "다른 프로그램이 로그인 callback port를 쓰고 있다",
            details: { reason: "callback_port_in_use" },
          })
        : err({
            code: "unavailable",
            message: "loopback callback port를 열 수 없다",
          });
    }
  }
  return ok({
    port: () => port,
    receive(signal: AbortSignal) {
      const aborted = new Promise<null>((resolve) => {
        if (signal.aborted) resolve(null);
        else {
          signal.addEventListener("abort", () => resolve(null), {
            once: true,
          });
        }
      });
      return Promise.race([incoming, aborted]).then((how): Result<Callback> => {
        if (settled === "refused") {
          return err({
            code: "forbidden",
            message: "발급자가 로그인을 거절했다",
          });
        }
        if (how === null || settled === null) {
          return err({
            code: "unavailable",
            message: "callback이 오지 않았다",
          });
        }
        return ok(settled);
      });
    },
    close(): Promise<void> {
      return closeAll();
    },
  });
}

type Callback = {
  code: string;
  state: string;
  iss: string | null;
  client_id: string | null;
};

// browser 탭에 남는 글이다. 값은 싣지 않는다.
const CALLBACK_PAGE = {
  status: 200,
  headers: { "content-type": "text/plain; charset=utf-8" },
};
const CALLBACK_DONE = "Signed in. You can close this tab and go back to lophn.";
const CALLBACK_REFUSED = "Sign-in was not completed. You can close this tab.";
