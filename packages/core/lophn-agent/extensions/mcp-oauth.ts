import { err, ok, type RandomSource, type Result } from "../../../base/mod.ts";
import type {
  McpAuthFailure,
  McpAuthStateName,
} from "../../../protocol/lophn-agent/mod.ts";
import type { HttpFetch } from "./adapters/mcp-http.ts";
import {
  type AuthDeadline,
  bindingChanged,
  type CallbackListener,
  createMcpAuth,
  refreshToken,
} from "./mcp-auth.ts";
import {
  type McpAuthKey,
  mcpAuthKeyId,
  type McpGrant,
  type McpOAuthVault,
  mcpTokenRef,
} from "./mcp-oauth-vault.ts";

// MCP OAuth를 처음부터 끝까지 잇는다(concern lophn-agent/extensions, requirements #R16, #R17).
// - 사람이 시작한 로그인(PKCE S256·loopback 반환)을 서버(place+이름)마다 하나씩 쥐고, 기다림 시한과 취소를 정한다.
// - 받은 token은 vault(OS keychain)에만 보관하고, 설정이 그 보관을 가리키게 쓰는 일은 부르는 쪽이 넘긴 link가 한다.
// - 연결이 token을 붙일 때 만료가 가까우면 갱신한다. 같은 서버의 갱신은 한 번에 하나다.
// - 상태는 끝난 세션의 기억이 아니라 진행 중인 시도, 마지막 실패, 지금 설정과 맞는 보관 token에서 읽는다.
// network는 token endpoint(발급자)뿐이고 fetch로 받는다. 값(verifier·state·token)은 응답 모양 어디에도 없다.

// 접근 token이 만료되기 이 시간 전부터 갱신한다(요청이 가는 도중 만료되는 일을 줄인다).
const REFRESH_SKEW_MS = 60_000;

// 로그인·갱신이 서버를 가리키는 설정의 지금 값이다. token이 이 값들과 묶여 있어야 쓴다.
export type McpOAuthServer = {
  key: McpAuthKey;
  issuer: string;
  serverUrl: string;
  clientId: string;
  // 설정이 지금 가리키는 token 참조다. 로그인 전이면 null이다.
  tokenRef: string | null;
};

type McpAuthReport = {
  state: McpAuthStateName;
  reason: McpAuthFailure | null;
};

type McpOAuth = {
  // 로그인을 시작한다. 이미 기다리는 로그인이 있으면 conflict다. 실패하면 listener를 닫는다.
  begin(
    server: McpOAuthServer,
    input: { scopes: readonly string[]; listener: CallbackListener },
  ): Promise<Result<{ url: string; callbackPort: number }>>;
  // 사람이 돌아오기를 기다려 token을 교환하고 보관한 뒤 link로 설정에 참조를 쓴다. link가 실패하면 보관한
  // token을 도로 지운다. 취소나 시한은 error로 끝난다.
  complete(
    server: McpOAuthServer,
    link: () => Promise<Result<void>>,
  ): Promise<Result<void>>;
  // 기다리는 로그인을 그만둔다. 보관한 token은 건드리지 않는다. 그만둔 것이 없으면 false다.
  cancel(server: Pick<McpOAuthServer, "key">): Promise<boolean>;
  report(server: McpOAuthServer): Promise<McpAuthReport>;
  // 연결이 붙일 접근 token의 보관 참조다. 값이 아니라 참조다. 로그인이 필요하면 forbidden(재인증 필요),
  // 발급자에 닿지 못하면 unavailable(연결 실패)로 구별한다.
  access(server: McpOAuthServer): Promise<Result<{ sealedRef: string }>>;
  // 기다리는 모든 로그인을 그만둔다.
  endAll(): Promise<void>;
};

function reauth(message = "재인증이 필요하다"): Result<never> {
  return err({ code: "forbidden", message });
}

export function createMcpOAuth(options: {
  vault: McpOAuthVault;
  fetch: HttpFetch;
  nowMs(): number;
  random?: RandomSource;
  waitMs?: number;
  deadline: AuthDeadline;
  // 보관한 값이 바뀐 뒤 불린다. 알려진 값 registry가 새 값을 읽고 옛 값을 회수한다.
  changed?: () => Promise<unknown>;
}): McpOAuth {
  const { vault } = options;
  const sessions = new Map<string, ReturnType<typeof createMcpAuth>>();
  // 시도가 아닌 이유로 로그인할 수 없게 된 서버의 마지막 실패다. 새로 시작하거나 성공하면 지워진다.
  const failures = new Map<string, McpAuthFailure>();
  const flights = new Map<string, Promise<Result<void>>>();

  const changed = async () => {
    await options.changed?.();
  };

  function sessionOf(key: McpAuthKey) {
    const id = mcpAuthKeyId(key);
    let session = sessions.get(id);
    if (session === undefined) {
      session = createMcpAuth({
        nowMs: options.nowMs,
        ...(options.random === undefined ? {} : { random: options.random }),
        ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
        deadline: options.deadline,
      });
      sessions.set(id, session);
    }
    return session;
  }

  // 보관한 grant가 지금 설정의 발급자·URL·client와 같은지 본다.
  function bound(grant: McpGrant, server: McpOAuthServer): boolean {
    const side = (issuer: string, url: string) => ({
      issuer,
      server_url: url,
      account: null,
      secret_name: "",
    });
    return !bindingChanged(
      side(grant.binding.issuer, grant.binding.server_url),
      side(server.issuer, server.serverUrl),
    ) && grant.binding.client_id === server.clientId;
  }

  const pointed = (server: McpOAuthServer) =>
    server.tokenRef === mcpTokenRef(server.key);

  async function discard(
    key: McpAuthKey,
    reason: McpAuthFailure | null,
  ): Promise<void> {
    await vault.remove(key);
    await changed();
    if (reason !== null) failures.set(mcpAuthKeyId(key), reason);
  }

  // 접근 token을 쓸 수 있게 한다: 묶음이 맞는지 보고, 만료가 가까우면 갱신한다.
  async function ensureFresh(server: McpOAuthServer): Promise<Result<void>> {
    const { key } = server;
    const loaded = await vault.load(key);
    if (!loaded.ok) return loaded;
    const grant = loaded.value;
    if (grant === null) return reauth();
    if (!bound(grant, server)) {
      // 발급자·URL·client가 바뀌었다. 옛 비밀은 쓰지 않고 지운다.
      await discard(key, null);
      return reauth("설정이 바뀌어 다시 로그인해야 한다");
    }
    const expiresAt = grant.expires_at_ms;
    if (expiresAt === null || expiresAt - options.nowMs() > REFRESH_SKEW_MS) {
      return ok(undefined);
    }
    if (grant.refresh_token === null) {
      await discard(key, "expired");
      return reauth();
    }
    const refreshed = await refreshToken(
      {
        tokenEndpoint: grant.token_endpoint,
        refreshToken: grant.refresh_token,
        clientId: grant.binding.client_id,
        clientSecret: null,
      },
      options.fetch,
      new AbortController().signal,
    );
    if (!refreshed.ok) {
      // 발급자가 거절했다: 재인증 필요다. 닿지 못했거나 응답이 이상한 것은 연결 실패이고 token은 그대로다.
      if (refreshed.error.code === "forbidden") {
        await discard(key, "refresh_rejected");
        return reauth();
      }
      return err({ code: "unavailable", message: "발급자에 닿지 못했다" });
    }
    const saved = await vault.save(key, {
      ...grant,
      access_token: refreshed.value.access_token,
      refresh_token: refreshed.value.refresh_token ?? grant.refresh_token,
      expires_at_ms: refreshed.value.expires_in === null
        ? null
        : options.nowMs() + refreshed.value.expires_in * 1000,
    });
    if (!saved.ok) return saved;
    await changed();
    return ok(undefined);
  }

  return {
    async begin(server, input) {
      const base = server.issuer.replace(/\/+$/, "");
      const begun = await sessionOf(server.key).begin({
        authorizationEndpoint: `${base}/authorize`,
        tokenEndpoint: `${base}/token`,
        clientId: server.clientId,
        scopes: input.scopes,
        listener: input.listener,
      });
      if (!begun.ok) {
        await input.listener.close();
        return begun;
      }
      failures.delete(mcpAuthKeyId(server.key));
      return ok({
        url: begun.value.url.href,
        callbackPort: input.listener.port(),
      });
    },

    async complete(server, link) {
      const id = mcpAuthKeyId(server.key);
      const session = sessions.get(id);
      if (session === undefined) {
        return err({ code: "conflict", message: "OAuth 시작이 아닌 상태다" });
      }
      const done = await session.complete({
        fetch: options.fetch,
        signal: new AbortController().signal,
      });
      if (!done.ok) return done;
      const saved = await vault.save(server.key, {
        access_token: done.value.access_token,
        refresh_token: done.value.refresh_token,
        expires_at_ms: done.value.expires_at_ms,
        token_endpoint: done.value.token_endpoint,
        binding: {
          issuer: server.issuer,
          server_url: server.serverUrl,
          client_id: server.clientId,
        },
      });
      if (!saved.ok) {
        failures.set(id, "store_failed");
        return saved;
      }
      await changed();
      const linked = await link();
      if (!linked.ok) {
        // 설정이 token을 가리키지 못하면 쓸 수 없는 token이다. 반쯤 로그인된 채로 두지 않는다.
        await discard(server.key, "store_failed");
        return linked;
      }
      failures.delete(id);
      return ok(undefined);
    },

    async cancel(server) {
      const session = sessions.get(mcpAuthKeyId(server.key));
      return session === undefined ? false : await session.cancel();
    },

    async report(server) {
      const id = mcpAuthKeyId(server.key);
      const attempt = sessions.get(id)?.state();
      if (attempt?.kind === "in_progress") {
        return { state: "in_progress", reason: null };
      }
      if (attempt?.kind === "failed") {
        return { state: "failed", reason: attempt.reason };
      }
      const failure = failures.get(id);
      if (failure !== undefined) return { state: "failed", reason: failure };
      const loaded = await vault.load(server.key);
      // keychain을 읽을 수 없으면 쓸 수 있는 token이 없다. 로그인했다고 말하지 않고 none으로 두며, 다시 로그인하려
      // 하면 보관 실패(store_failed)가 이유로 남는다.
      const grant = loaded.ok ? loaded.value : null;
      if (grant === null || !pointed(server) || !bound(grant, server)) {
        return { state: "none", reason: null };
      }
      const expiresAt = grant.expires_at_ms;
      if (
        expiresAt !== null && expiresAt <= options.nowMs() &&
        grant.refresh_token === null
      ) {
        return { state: "failed", reason: "expired" };
      }
      return { state: "signed_in", reason: null };
    },

    async access(server) {
      if (!pointed(server)) return reauth();
      const id = mcpAuthKeyId(server.key);
      // 같은 서버에 같은 설정으로 동시에 온 요청은 한 번의 확인·갱신을 같이 기다린다.
      const flightId =
        `${id}\0${server.issuer}\0${server.serverUrl}\0${server.clientId}`;
      let flight = flights.get(flightId);
      if (flight === undefined) {
        flight = ensureFresh(server).finally(() => {
          flights.delete(flightId);
        });
        flights.set(flightId, flight);
      }
      const done = await flight;
      if (!done.ok) return done;
      const sealedRef = vault.sealedRefOf(server.key, "access");
      return sealedRef === undefined ? reauth() : ok({ sealedRef });
    },

    async endAll() {
      for (const session of sessions.values()) await session.cancel();
    },
  };
}
