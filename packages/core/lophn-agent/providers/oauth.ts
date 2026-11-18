// 구독 OAuth 로그인 작업이다. begin이 사람이 OS browser에서 열 주소를 내고, complete는 기다리지 않고 한 번 보고
// 돌아온다(아직이면 pending, 끝났으면 token). login.ts가 interval_ms마다 complete를 다시 부른다.
// - chatgpt: Codex CLI의 ChatGPT 로그인. PKCE(S256) + 발급자에 등록된 고정 loopback callback. 교환은 oauth-chatgpt.ts가 한다.
// - claude: Claude account. PKCE(S256) + 발급자에 등록된 고정 loopback callback. 교환은 oauth-claude.ts가 한다.
// - antigravity: Google account. PKCE(S256) + 고정 loopback callback. 교환 뒤 Cloud Code project까지 정해야 연결이다
//   (oauth-antigravity.ts).
// - supergrok: RFC 8628 device code. complete마다 token endpoint를 한 번 poll한다.
// 발급자 주소와 client 값은 모두 provider 정의 data다. 상수 주소가 없어 fake 발급자도 정의만 바꿔 돈다.
// 값(state·verifier·device_code·token)은 이 작업 메모리와 complete의 결과에만 있고 ledger·event·log·오류에
// 싣지 않는다. network(발급자 요청 대기열)·listener·시각·무작위 값은 deps로 받는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import {
  type OAuthDefinition,
  type OAuthFlow,
  oauthFlowOf,
  type ProviderAccount,
} from "../../../protocol/lophn-agent/mod.ts";
import type { CallbackListener, CallbackOptions } from "../extensions/mod.ts";
import { type IssuerFetch, positive, postForm, text } from "./issuer-http.ts";
import { chatGptAuthorizeUrl, chatGptExchange } from "./oauth-chatgpt.ts";
import { claudeAuthorizeUrl, claudeExchange } from "./oauth-claude.ts";
import {
  antigravityAccount,
  antigravityAuthorizeUrl,
  antigravityExchange,
} from "./oauth-antigravity.ts";
import type { ProviderTokenMeta } from "./oauth-secrets.ts";

// 고정 callback으로 돌아오기를 기다리는 시간이다. 그동안 그 port를 쥔다.
const FIXED_CALLBACK_MS = 5 * 60_000;
const CALLBACK_CHECK_MS = 1_000;
const DEVICE_DEFAULT_EXPIRES_S = 300;
const DEVICE_DEFAULT_INTERVAL_S = 5;
const DEVICE_SLOW_DOWN_MS = 5_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const ACCESS_DEFAULT_S = 3_600;

export type OAuthTokens = {
  access: string;
  refresh: string;
  expires_at_ms: number;
  meta: ProviderTokenMeta;
  // 로그인이 확정한 계정이다. SuperGrok은 null이다.
  account: ProviderAccount | null;
};

export type OAuthBegin = {
  login: string;
  flow: OAuthFlow;
  interval_ms: number;
  expires_at_ms: number;
  sign_in: { url: string; user_code: string | null };
};

export type OAuthStep<T> =
  | { state: "pending"; interval_ms: number }
  | { state: "done"; tokens: OAuthTokens; target: T };

type Callback = Awaited<ReturnType<CallbackListener["receive"]>>;

// loopback callback으로 code를 받는 product다.
type PkceOAuth = Extract<
  OAuthDefinition,
  { product: "chatgpt" | "claude" | "antigravity" }
>;

type Session<T> = {
  provider: string;
  target: T;
  deadlineMs: number;
  intervalMs: number;
  // complete가 겹치면 두 번째는 교환을 다시 보내지 않는다.
  busy: boolean;
} & (
  | {
      flow: "pkce_loopback";
      oauth: PkceOAuth;
      listener: CallbackListener;
      stop: AbortController;
      callback: Callback | null;
      state: string;
      verifier: string;
      redirectUri: string;
    }
  | {
      flow: "device_code";
      oauth: Extract<OAuthDefinition, { product: "supergrok" }>;
      deviceCode: string;
      nextPollMs: number;
    }
);

// 등록된 callback 주소에서 들을 곳이다. localhost를 광고하면 IPv4와 IPv6 loopback을 함께 쥔다.
function listenerOptions(redirectUri: string, state: string): CallbackOptions {
  const url = new URL(redirectUri);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return {
    hosts: host === "localhost" ? ["127.0.0.1", "::1"] : [host],
    port: Number(url.port),
    path: url.pathname,
    state,
  };
}

// 로그인 대상은 provider endpoint를 안다. Antigravity는 그 주소가 계정 control plane이다.
export function createProviderOAuth<T extends { endpoint: string }>(deps: {
  http: IssuerFetch;
  openListener(options?: CallbackOptions): Promise<Result<CallbackListener>>;
  nowMs(): number;
  random: RandomSource;
  // 계정 준비(onboarding)를 다시 볼 때까지 쉰다.
  wait?: (ms: number) => Promise<void>;
}): {
  begin(
    provider: string,
    oauth: OAuthDefinition,
    target: T,
  ): Promise<Result<OAuthBegin>>;
  complete(provider: string, login: string): Promise<Result<OAuthStep<T>>>;
  cancel(provider: string, login: string): Promise<Result<void>>;
  endAll(): Promise<void>;
} {
  const sessions = new Map<string, Session<T>>();
  const wait =
    deps.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const randomText = (bytes: number) => {
    const value = new Uint8Array(bytes);
    deps.random.fill(value);
    return base64url(value);
  };

  async function end(login: string): Promise<void> {
    const session = sessions.get(login);
    if (session === undefined) return;
    sessions.delete(login);
    if (session.flow === "pkce_loopback") {
      session.stop.abort();
      await session.listener.close();
    }
  }

  // 기한이 지난 세션을 치운다. 따로 timer를 두지 않고 begin·complete가 부를 때 본다.
  async function sweep(): Promise<void> {
    const now = deps.nowMs();
    for (const [login, session] of [...sessions]) {
      if (session.deadlineMs <= now) await end(login);
    }
  }

  // callback을 기다리는 세션을 연다. callback은 사람이 돌아올 때 온다. complete가 기다리지 않도록 받으면 세션에 쥔다.
  function startPkce(
    provider: string,
    oauth: PkceOAuth,
    target: T,
    pending: {
      listener: CallbackListener;
      state: string;
      verifier: string;
      redirectUri: string;
      signIn: string;
      windowMs: number;
    },
  ): OAuthBegin {
    const login = randomText(16);
    const stop = new AbortController();
    const deadlineMs = deps.nowMs() + pending.windowMs;
    const session: Session<T> = {
      provider,
      target,
      deadlineMs,
      intervalMs: CALLBACK_CHECK_MS,
      busy: false,
      flow: "pkce_loopback",
      oauth,
      listener: pending.listener,
      stop,
      callback: null,
      state: pending.state,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
    };
    sessions.set(login, session);
    void pending.listener.receive(stop.signal).then((callback) => {
      session.callback = callback;
    });
    return {
      login,
      flow: "pkce_loopback",
      interval_ms: CALLBACK_CHECK_MS,
      expires_at_ms: deadlineMs,
      sign_in: { url: pending.signIn, user_code: null },
    };
  }

  // browser를 열기 전에 등록된 port로 듣는다. 그 port를 다른 프로그램이 쓰면 conflict로 끝난다.
  async function beginFixed(
    provider: string,
    oauth: PkceOAuth,
    target: T,
  ): Promise<Result<OAuthBegin>> {
    const state = randomText(32);
    const opened = await deps.openListener(
      listenerOptions(oauth.redirect_uri, state),
    );
    if (!opened.ok) return opened;
    const verifier = randomText(32);
    const authorize = {
      redirectUri: oauth.redirect_uri,
      state,
      challenge: await pkceChallenge(verifier),
    };
    const signIn =
      oauth.product === "chatgpt"
        ? chatGptAuthorizeUrl(oauth, authorize)
        : oauth.product === "claude"
          ? claudeAuthorizeUrl(oauth, authorize)
          : antigravityAuthorizeUrl(oauth, authorize);
    return ok(
      startPkce(provider, oauth, target, {
        listener: opened.value,
        state,
        verifier,
        redirectUri: oauth.redirect_uri,
        signIn,
        windowMs: FIXED_CALLBACK_MS,
      }),
    );
  }

  async function beginDevice(
    provider: string,
    oauth: Extract<OAuthDefinition, { product: "supergrok" }>,
    target: T,
  ): Promise<Result<OAuthBegin>> {
    const started = await postForm(
      deps.http,
      oauth.device_authorization_endpoint,
      {
        client_id: oauth.client_id,
        scope: oauth.scopes.join(" "),
      },
    );
    if (!started.ok) return started;
    if (started.value.status !== 200) {
      return err({
        code: "unavailable",
        message: "발급자가 device code를 내주지 않았다",
      });
    }
    const body = started.value.body;
    const deviceCode = text(body["device_code"]);
    const userCode = text(body["user_code"]);
    const signIn =
      text(body["verification_uri_complete"]) ?? text(body["verification_uri"]);
    if (deviceCode === null || userCode === null || signIn === null) {
      return err({
        code: "unavailable",
        message: "device code 응답이 모자라다",
      });
    }
    const now = deps.nowMs();
    const intervalMs =
      (positive(body["interval"]) ?? DEVICE_DEFAULT_INTERVAL_S) * 1000;
    const deadlineMs =
      now + (positive(body["expires_in"]) ?? DEVICE_DEFAULT_EXPIRES_S) * 1000;
    const login = randomText(16);
    sessions.set(login, {
      provider,
      target,
      deadlineMs,
      intervalMs,
      busy: false,
      flow: "device_code",
      oauth,
      deviceCode,
      nextPollMs: now + intervalMs,
    });
    return ok({
      login,
      flow: "device_code",
      interval_ms: intervalMs,
      expires_at_ms: deadlineMs,
      sign_in: { url: signIn, user_code: userCode },
    });
  }

  async function completeChatGpt(
    login: string,
    session: Extract<Session<T>, { flow: "pkce_loopback" }>,
    oauth: Extract<OAuthDefinition, { product: "chatgpt" }>,
  ): Promise<Result<OAuthStep<T>>> {
    const callback = session.callback;
    if (callback === null) {
      return ok({ state: "pending", interval_ms: session.intervalMs });
    }
    // code를 보내면 다시 쓸 수 없다. 여기부터는 성공이든 실패든 세션을 끝낸다.
    await end(login);
    if (!callback.ok) return refused("로그인이 끝나지 않았다");
    if (callback.value.state !== session.state) {
      return refused("로그인 응답이 이 시도의 것이 아니다");
    }
    const granted = await chatGptExchange(deps.http, oauth, {
      code: callback.value.code,
      verifier: session.verifier,
      redirectUri: session.redirectUri,
      nowMs: deps.nowMs,
    });
    if (!granted.ok) return granted;
    return ok({
      state: "done",
      target: session.target,
      tokens: {
        access: granted.value.access,
        refresh: granted.value.refresh,
        expires_at_ms: granted.value.expires_at_ms,
        meta: { subject: granted.value.account.id },
        account: granted.value.account,
      },
    });
  }

  async function completeClaude(
    login: string,
    session: Extract<Session<T>, { flow: "pkce_loopback" }>,
    oauth: Extract<OAuthDefinition, { product: "claude" }>,
  ): Promise<Result<OAuthStep<T>>> {
    const callback = session.callback;
    if (callback === null) {
      return ok({ state: "pending", interval_ms: session.intervalMs });
    }
    await end(login);
    if (!callback.ok) return refused("로그인이 끝나지 않았다");
    if (callback.value.state !== session.state) {
      return refused("로그인 응답이 이 시도의 것이 아니다");
    }
    const granted = await claudeExchange(deps.http, oauth, {
      code: callback.value.code,
      verifier: session.verifier,
      state: session.state,
      redirectUri: session.redirectUri,
      nowMs: deps.nowMs,
    });
    if (!granted.ok) return granted;
    return ok({
      state: "done",
      target: session.target,
      tokens: {
        access: granted.value.access,
        refresh: granted.value.refresh,
        expires_at_ms: granted.value.expires_at_ms,
        meta: { subject: granted.value.account.id },
        account: granted.value.account,
      },
    });
  }

  // 교환 뒤 계정 project까지 정해야 연결이다. 그 전에 실패하면 token을 저장하지 않는다.
  async function completeAntigravity(
    login: string,
    session: Extract<Session<T>, { flow: "pkce_loopback" }>,
    oauth: Extract<OAuthDefinition, { product: "antigravity" }>,
  ): Promise<Result<OAuthStep<T>>> {
    const callback = session.callback;
    if (callback === null) {
      return ok({ state: "pending", interval_ms: session.intervalMs });
    }
    await end(login);
    if (!callback.ok) return refused("로그인이 끝나지 않았다");
    if (callback.value.state !== session.state) {
      return refused("로그인 응답이 이 시도의 것이 아니다");
    }
    const granted = await antigravityExchange(deps.http, oauth, {
      code: callback.value.code,
      verifier: session.verifier,
      redirectUri: session.redirectUri,
      nowMs: deps.nowMs,
    });
    if (!granted.ok) return granted;
    const account = await antigravityAccount(deps.http, oauth, {
      endpoint: session.target.endpoint,
      access: granted.value.access,
      nowMs: deps.nowMs,
      wait,
    });
    if (!account.ok) return account;
    return ok({
      state: "done",
      target: session.target,
      tokens: {
        ...granted.value,
        meta: { subject: null },
        account: account.value,
      },
    });
  }

  async function completeDevice(
    login: string,
    session: Extract<Session<T>, { flow: "device_code" }>,
  ): Promise<Result<OAuthStep<T>>> {
    const now = deps.nowMs();
    // 간격 전에 부르면 poll하지 않는다(발급자가 slow_down으로 벌한다).
    if (now < session.nextPollMs) {
      return ok({ state: "pending", interval_ms: session.nextPollMs - now });
    }
    const polled = await postForm(deps.http, session.oauth.token_endpoint, {
      grant_type: DEVICE_GRANT,
      client_id: session.oauth.client_id,
      device_code: session.deviceCode,
    });
    session.nextPollMs = deps.nowMs() + session.intervalMs;
    // 발급자에 닿지 못했으면 세션을 남겨 다음 poll이 잇는다.
    if (!polled.ok) return polled;
    const body = polled.value.body;
    if (polled.value.status === 200) {
      await end(login);
      const tokens = tokensOf(body, deps.nowMs());
      if (tokens === null) return refused("token 응답이 모자라다");
      return ok({
        state: "done",
        target: session.target,
        tokens: {
          ...tokens,
          meta: { subject: null },
          account: null,
        },
      });
    }
    const reason = text(body["error"]);
    if (reason === "authorization_pending") {
      return ok({ state: "pending", interval_ms: session.intervalMs });
    }
    if (reason === "slow_down") {
      session.intervalMs += DEVICE_SLOW_DOWN_MS;
      session.nextPollMs = deps.nowMs() + session.intervalMs;
      return ok({ state: "pending", interval_ms: session.intervalMs });
    }
    await end(login);
    if (reason === "expired_token") {
      return err({ code: "not_found", message: "로그인 기한이 지났다" });
    }
    return refused("발급자가 로그인을 거절했다");
  }

  return {
    async begin(provider, oauth, target) {
      await sweep();
      if (oauthFlowOf(oauth.product) === "device_code") {
        return await beginDevice(
          provider,
          oauth as Extract<OAuthDefinition, { product: "supergrok" }>,
          target,
        );
      }
      return await beginFixed(provider, oauth as PkceOAuth, target);
    },
    async complete(provider, login) {
      await sweep();
      const session = sessions.get(login);
      if (session === undefined || session.provider !== provider) {
        return err({ code: "not_found", message: "login not found" });
      }
      if (session.busy) {
        return ok({ state: "pending", interval_ms: session.intervalMs });
      }
      session.busy = true;
      try {
        if (session.flow === "device_code") {
          return await completeDevice(login, session);
        }
        const oauth = session.oauth;
        if (oauth.product === "chatgpt") {
          return await completeChatGpt(login, session, oauth);
        }
        return oauth.product === "claude"
          ? await completeClaude(login, session, oauth)
          : await completeAntigravity(login, session, oauth);
      } finally {
        session.busy = false;
      }
    },
    async cancel(provider, login) {
      const session = sessions.get(login);
      if (session === undefined || session.provider !== provider) {
        return err({ code: "not_found", message: "login not found" });
      }
      await end(login);
      return ok(undefined);
    },
    async endAll() {
      for (const login of [...sessions.keys()]) await end(login);
    },
  };
}

function refused(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// access와 refresh가 둘 다 있어야 성공이다(offline_access를 요청했다).
function tokensOf(
  body: Record<string, unknown>,
  nowMs: number,
): Omit<OAuthTokens, "meta" | "account"> | null {
  const access = text(body["access_token"]);
  const refresh = text(body["refresh_token"]);
  if (access === null || refresh === null) return null;
  return {
    access,
    refresh,
    expires_at_ms:
      nowMs + (positive(body["expires_in"]) ?? ACCESS_DEFAULT_S) * 1000,
  };
}

// ---- base64url / PKCE ----

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

// RFC 7636 S256 challenge다.
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}
