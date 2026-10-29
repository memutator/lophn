// 구독 OAuth 로그인 작업이다. begin이 사람이 OS browser에서 열 주소를 내고, complete는 기다리지 않고 한 번 보고
// 돌아온다(아직이면 pending, 끝났으면 token). 화면이 interval_ms마다 complete를 다시 부른다.
// - chatgpt: OpenAI 공식 Sign in with ChatGPT. PKCE(S256) + 127.0.0.1 loopback(`/auth/callback`). 첫 로그인은
//   `client_id=dynamic_agent_client`로 등록하고 callback의 발급 client_id로 교환한다. id_token은 JWKS 서명·issuer·
//   audience·exp·nonce를 검증하고, granted scope에 `chatgpt.tokens.use.direct`가 없으면 plan usage가 없는 것이다.
// - claude: Claude account. PKCE(S256) + 발급자에 등록된 고정 loopback callback. 교환은 oauth-claude.ts가 한다.
// - antigravity: Google account. PKCE(S256) + 고정 loopback callback. 교환 뒤 Cloud Code project까지 정해야 연결이다
//   (oauth-antigravity.ts).
// - supergrok: RFC 8628 device code. complete마다 token endpoint를 한 번 poll한다.
// 발급자 주소와 client 값은 모두 provider 정의 data다. 상수 주소가 없어 fake 발급자도 정의만 바꿔 돈다.
// 값(state·nonce·verifier·device_code·token)은 이 작업 메모리와 complete의 결과에만 있고 ledger·event·log·오류에
// 싣지 않는다. network(발급자 요청 대기열)·listener·시각·무작위 값은 deps로 받는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import {
  type OAuthDefinition,
  type OAuthFlow,
  type ProviderAccount,
} from "../../../protocol/lophn-agent/mod.ts";
import type { CallbackListener, CallbackOptions } from "../extensions/mod.ts";
import {
  type IssuerFetch,
  positive,
  postForm,
  send,
  text,
} from "./issuer-http.ts";
import { claudeAuthorizeUrl, claudeExchange } from "./oauth-claude.ts";
import {
  antigravityAccount,
  antigravityAuthorizeUrl,
  antigravityExchange,
} from "./oauth-antigravity.ts";
import type { ProviderTokenMeta } from "./oauth-secrets.ts";

// 발급자에게 보내는 이름이다. 동의 화면과 ChatGPT 설정의 앱 목록에 보인다.
const OAUTH_APP_NAME = "lophn";
const CHATGPT_REGISTER_CLIENT = "dynamic_agent_client";
const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
const CHATGPT_LOGIN_MS = 15 * 60_000;
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
  // 로그인이 확정한 계정이다. ChatGPT·SuperGrok은 null이다.
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
      nonce: string;
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
  hostId(): Promise<Result<string>>;
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
      nonce: string;
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
      nonce: pending.nonce,
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

  async function beginChatGpt(
    provider: string,
    oauth: Extract<OAuthDefinition, { product: "chatgpt" }>,
    target: T,
  ): Promise<Result<OAuthBegin>> {
    const hostId = await deps.hostId();
    if (!hostId.ok) return hostId;
    const state = randomText(32);
    const opened = await deps.openListener({ path: "/auth/callback", state });
    if (!opened.ok) return opened;
    const listener = opened.value;
    const nonce = randomText(32);
    const verifier = randomText(32);
    const redirectUri = `http://127.0.0.1:${listener.port()}/auth/callback`;
    const url = new URL(oauth.authorization_endpoint);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: CHATGPT_REGISTER_CLIENT,
      agent_name_hint: OAUTH_APP_NAME,
      ext_agent_host_id: hostId.value,
      redirect_uri: redirectUri,
      scope: oauth.scopes.join(" "),
      resource: oauth.resource,
      state,
      nonce,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(key, value);
    return ok(
      startPkce(provider, oauth, target, {
        listener,
        state,
        nonce,
        verifier,
        redirectUri,
        signIn: url.toString(),
        windowMs: CHATGPT_LOGIN_MS,
      }),
    );
  }

  // browser를 열기 전에 등록된 port로 듣는다. 그 port를 다른 프로그램이 쓰면 conflict로 끝난다.
  async function beginFixed(
    provider: string,
    oauth: Extract<OAuthDefinition, { product: "claude" | "antigravity" }>,
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
      oauth.product === "claude"
        ? claudeAuthorizeUrl(oauth, authorize)
        : antigravityAuthorizeUrl(oauth, authorize);
    return ok(
      startPkce(provider, oauth, target, {
        listener: opened.value,
        state,
        nonce: "",
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
    const clientId = callback.value.client_id;
    if (clientId === null) return refused("발급자가 client를 등록하지 않았다");
    const exchanged = await postForm(deps.http, oauth.token_endpoint, {
      grant_type: "authorization_code",
      client_id: clientId,
      code: callback.value.code,
      code_verifier: session.verifier,
      redirect_uri: session.redirectUri,
      resource: oauth.resource,
    });
    if (!exchanged.ok) return exchanged;
    if (exchanged.value.status !== 200) {
      return refused("발급자가 token 교환을 거절했다");
    }
    const body = exchanged.value.body;
    const tokens = tokensOf(body, deps.nowMs());
    if (tokens === null) return refused("token 응답이 모자라다");
    if (!grantedScopes(body).includes(CHATGPT_PLAN_SCOPE)) {
      return refused("이 ChatGPT 계정은 plan usage를 허락하지 않았다");
    }
    const subject = await verifiedSubject(deps.http, {
      idToken: text(body["id_token"]),
      jwksUri: oauth.jwks_uri,
      issuer: oauth.issuer,
      clientId,
      nonce: session.nonce,
      nowMs: deps.nowMs(),
    });
    if (!subject.ok) return subject;
    return ok({
      state: "done",
      target: session.target,
      tokens: {
        ...tokens,
        meta: { client_id: clientId, subject: subject.value },
        account: null,
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
        meta: { client_id: null, subject: granted.value.account.id },
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
        meta: { client_id: null, subject: null },
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
          meta: { client_id: null, subject: null },
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
      if (oauth.product === "chatgpt") {
        return await beginChatGpt(provider, oauth, target);
      }
      if (oauth.product === "claude" || oauth.product === "antigravity") {
        return await beginFixed(provider, oauth, target);
      }
      return await beginDevice(provider, oauth, target);
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

function grantedScopes(body: Record<string, unknown>): string[] {
  const value = body["scope"] ?? body["scopes"];
  if (typeof value === "string") return value.split(/\s+/);
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string")
    : [];
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

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const normalized =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// RFC 7636 S256 challenge다.
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

// ---- id_token 검증(RS256 서명·issuer·audience·exp·nonce) ----

function jwtPart(jwt: string, index: 0 | 1): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return objectOrNull(
      JSON.parse(new TextDecoder().decode(fromBase64url(parts[index]!))),
    );
  } catch {
    return null;
  }
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function rs256Verified(
  jwt: string,
  jwk: Record<string, unknown>,
): Promise<boolean> {
  const [header, payload, signature] = jwt.split(".");
  if (typeof jwk["n"] !== "string" || typeof jwk["e"] !== "string") {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk["n"], e: jwk["e"], alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64url(signature!),
      new TextEncoder().encode(`${header}.${payload}`),
    );
  } catch {
    return false;
  }
}

async function verifiedSubject(
  http: IssuerFetch,
  input: {
    idToken: string | null;
    jwksUri: string;
    issuer: string;
    clientId: string;
    nonce: string;
    nowMs: number;
  },
): Promise<Result<string>> {
  const bad = refused("id_token을 믿을 수 없다");
  if (input.idToken === null) return bad;
  const header = jwtPart(input.idToken, 0);
  const claims = jwtPart(input.idToken, 1);
  if (header === null || claims === null || header["alg"] !== "RS256") {
    return bad;
  }
  const jwks = await send(http, input.jwksUri, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!jwks.ok) return jwks;
  const keys = Array.isArray(jwks.value.body["keys"])
    ? jwks.value.body["keys"].map(objectOrNull).filter((key) => key !== null)
    : [];
  const kid = header["kid"];
  const candidates = keys.filter(
    (key) => key["kty"] === "RSA" && (kid === undefined || key["kid"] === kid),
  );
  let signed = false;
  for (const key of candidates) {
    if (await rs256Verified(input.idToken, key)) {
      signed = true;
      break;
    }
  }
  const audience = claims["aud"];
  const audiences = Array.isArray(audience) ? audience : [audience];
  const exp = claims["exp"];
  const subject = text(claims["sub"]);
  if (
    !signed ||
    claims["iss"] !== input.issuer ||
    !audiences.includes(input.clientId) ||
    typeof exp !== "number" ||
    exp * 1000 <= input.nowMs ||
    claims["nonce"] !== input.nonce ||
    subject === null
  )
    return bad;
  return ok(subject);
}
