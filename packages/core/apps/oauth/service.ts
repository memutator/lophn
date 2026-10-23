import { err, ok, type RandomSource, type Result } from "../../../base/mod.ts";
import {
  APP_OAUTH_SIGN_IN_REQUIRED,
  appOAuthNames,
  appsOAuthBegin,
  appsOAuthCancel,
  appsOAuthClientSet,
  appsOAuthState,
} from "../../../protocol/apps/mod.ts";
import type { OAuthDeclaration } from "../../../protocol/apps/blueprint/mod.ts";
import type { SecretStorePort } from "../../../protocol/secrets/mod.ts";
import {
  type AuthDeadline,
  type CallbackListener,
  createMcpOAuth,
  createMcpOAuthVault,
  type HttpFetch,
  type McpOAuthServer,
} from "../../lophn-agent/extensions/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";

// 앱 선언의 secret.use oauth 블록으로 사람이 하는 OAuth 로그인이다. MCP OAuth와 같은 session·vault·refresh를 쓰고
// 다른 것은 보관 이름(access는 선언한 이름, refresh·meta는 `app-oauth.` 공간), 끝점(선언에서), client(사람이 넣은 값)다.
// refresh token은 core 밖으로 나가지 않는다. 앱에는 `prepare`가 refresh한 access token을 apps.secret_value가 준다.

export type AppOAuthDeclared = {
  // secret 이름. access token은 이 이름에 둔다.
  name: string;
  oauth: OAuthDeclaration;
  // 현재 선언 ∩ active grant에 이 scope(oauth 포함)가 들어 있다.
  granted: boolean;
};

export type AppOAuthDeps = {
  secrets: Pick<SecretStorePort, "get" | "put" | "delete">;
  // 발급자 호출 대기열의 fetch.
  fetch: HttpFetch;
  openListener(): Promise<Result<CallbackListener>>;
  declared(app: string): Promise<Result<readonly AppOAuthDeclared[]>>;
  nowMs(): number;
  random?: RandomSource;
  waitMs?: number;
  deadline?: AuthDeadline;
};

export type AppOAuth = {
  // "apps/oauth_client_set" | "apps/oauth_begin" | "apps/oauth_cancel" | "apps/oauth_state"
  handlers: ReadonlyMap<string, MemoryHandler>;
  // secretValueHandler의 prepare hook. OAuth 선언이 아닌 이름이면 undefined다.
  prepare(
    input: { app: string; name: string },
  ): Promise<Result<void> | undefined>;
  endAll(): Promise<void>;
};

// 만료가 가까우면 이 시간 전부터 갱신한다. 값을 보내기 직전에 갱신하므로 요청이 가는 동안 만료되지 않을 만큼이다.
const REFRESH_SKEW_MS = 5 * 60_000;

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

const SIGN_IN_REQUIRED = err({
  code: "conflict" as const,
  message: APP_OAUTH_SIGN_IN_REQUIRED,
});

// 발급자가 400·401·invalid_grant로 답하면 refresh token이 죽은 것이다. 그 밖(5xx 등)은 일시 오류다.
function refreshRejected(
  status: number,
  body: Record<string, unknown> | null,
): boolean {
  return status === 400 || status === 401 ||
    body?.["error"] === "invalid_grant";
}

export function createAppOAuth(deps: AppOAuthDeps): AppOAuth {
  const { secrets } = deps;
  const vault = createMcpOAuthVault({
    secrets,
    names: (key) => {
      const names = appOAuthNames(key.name);
      return { access: key.name, refresh: names.refresh, meta: names.meta };
    },
  });
  const oauth = createMcpOAuth({
    vault,
    fetch: deps.fetch,
    nowMs: deps.nowMs,
    ...(deps.random === undefined ? {} : { random: deps.random }),
    ...(deps.waitMs === undefined ? {} : { waitMs: deps.waitMs }),
    deadline: deps.deadline ?? timerDeadline,
    refreshSkewMs: REFRESH_SKEW_MS,
    keepValidOnUnavailable: true,
  });

  function text(name: string): string | null {
    const got = secrets.get(name);
    return got.ok && got.value !== "" ? got.value : null;
  }

  // client id가 없으면 ""다. 그러면 저장된 token의 binding과 맞지 않아 쓰지 않는다.
  function serverOf(name: string, declared: OAuthDeclaration): McpOAuthServer {
    const names = appOAuthNames(name);
    const clientId = text(names.client_id) ?? "";
    return {
      key: { place: null, name },
      issuer: declared.token_endpoint,
      serverUrl: declared.authorization_endpoint,
      clientId,
      endpoints: {
        authorization: declared.authorization_endpoint,
        token: declared.token_endpoint,
      },
      clientSecret: text(names.client),
      ...(declared.params === undefined ? {} : { params: declared.params }),
      binding: {
        authorization_endpoint: declared.authorization_endpoint,
        token_endpoint: declared.token_endpoint,
        scopes: JSON.stringify(declared.scopes),
        params: JSON.stringify(declared.params ?? {}),
        client_id: clientId,
      },
      refreshRejected,
    };
  }

  async function find(
    app: string,
    name: string,
  ): Promise<Result<AppOAuthDeclared>> {
    const declared = await deps.declared(app);
    if (!declared.ok) return declared;
    const found = declared.value.find((one) => one.name === name);
    return found === undefined
      ? err({ code: "not_found", message: "oauth secret이 선언에 없다" })
      : ok(found);
  }

  const clientSet: MemoryHandler = async (_ctx, body) => {
    const parsed = appsOAuthClientSet.input.safeParse(body);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "client id가 올바르지 않다",
      });
    }
    const { app, name, client_id } = parsed.data;
    const found = await find(app, name);
    if (!found.ok) return found;
    const put = await secrets.put(appOAuthNames(name).client_id, client_id);
    return put.ok ? ok({ stored: true }) : put;
  };

  const begin: MemoryHandler = async (_ctx, body) => {
    const parsed = appsOAuthBegin.input.safeParse(body);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "입력이 올바르지 않다" });
    }
    const found = await find(parsed.data.app, parsed.data.name);
    if (!found.ok) return found;
    if (!found.value.granted) {
      return err({ code: "forbidden", message: "허락하지 않은 secret이다" });
    }
    const server = serverOf(found.value.name, found.value.oauth);
    if (server.clientId === "") {
      return err({ code: "invalid_input", message: "client id가 없다" });
    }
    const listener = await deps.openListener();
    if (!listener.ok) return listener;
    const begun = await oauth.begin(server, {
      scopes: found.value.oauth.scopes,
      listener: listener.value,
    });
    if (!begun.ok) return begun;
    // 사람이 돌아오기를 기다리지 않는다. 결과는 oauth_state가 report로 보인다.
    void oauth.complete(server).catch(() => {});
    return ok({ url: begun.value.url });
  };

  const cancel: MemoryHandler = async (_ctx, body) => {
    const parsed = appsOAuthCancel.input.safeParse(body);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "입력이 올바르지 않다" });
    }
    const cancelled = await oauth.cancel({
      key: { place: null, name: parsed.data.name },
    });
    return ok({ cancelled });
  };

  const state: MemoryHandler = async (_ctx, body) => {
    const parsed = appsOAuthState.input.safeParse(body);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "입력이 올바르지 않다" });
    }
    const declared = await deps.declared(parsed.data.app);
    if (!declared.ok) return declared;
    const secretsOut = [];
    for (const one of declared.value) {
      const server = serverOf(one.name, one.oauth);
      const report = await oauth.report(server);
      secretsOut.push({
        name: one.name,
        client_id: server.clientId === "" ? null : server.clientId,
        client_secret_set: server.clientSecret !== null,
        ...report,
      });
    }
    return ok({ secrets: secretsOut });
  };

  return {
    handlers: new Map([
      ["apps/oauth_client_set", clientSet],
      ["apps/oauth_begin", begin],
      ["apps/oauth_cancel", cancel],
      ["apps/oauth_state", state],
    ]),

    async prepare(input) {
      const declared = await deps.declared(input.app);
      if (!declared.ok) return declared;
      const found = declared.value.find((one) => one.name === input.name);
      // grant 판정은 이어지는 attach가 한다.
      if (found === undefined || !found.granted) return undefined;
      const server = serverOf(found.name, found.oauth);
      if (server.clientId === "") return SIGN_IN_REQUIRED;
      const access = await oauth.access(server);
      if (access.ok) return access;
      // 재인증 필요(지워짐, refresh 거절, token 없음, 설정이 바뀜)만 sign-in 요청이다.
      return access.error.code === "forbidden" ? SIGN_IN_REQUIRED : access;
    },

    endAll: () => oauth.endAll(),
  };
}
