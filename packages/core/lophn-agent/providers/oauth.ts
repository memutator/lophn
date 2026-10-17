// 구독 OAuth 로그인 작업이다. begin이 사람이 OS browser에서 열 주소를 내고, complete는 기다리지 않고 한 번 보고
// 돌아온다(아직이면 pending, 끝났으면 token). 화면이 interval_ms마다 complete를 다시 부른다.
// - chatgpt: OpenAI 공식 Sign in with ChatGPT. PKCE(S256) + 127.0.0.1 loopback(`/auth/callback`). 첫 로그인은
//   `client_id=dynamic_agent_client`로 등록하고 callback의 발급 client_id로 교환한다. id_token은 JWKS 서명·issuer·
//   audience·exp·nonce를 검증하고, granted scope에 `chatgpt.tokens.use.direct`가 없으면 plan usage가 없는 것이다.
// - supergrok: RFC 8628 device code. complete마다 token endpoint를 한 번 poll한다.
// 발급자 주소와 client 값은 모두 provider 정의 data다. 상수 주소가 없어 fake 발급자도 정의만 바꿔 돈다.
// 값(state·nonce·verifier·device_code·token)은 이 작업 메모리와 complete의 결과에만 있고 ledger·event·log·오류에
// 싣지 않는다. network(발급자 요청 대기열)·listener·시각·무작위 값은 deps로 받는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import {
  type OAuthDefinition,
  type OAuthFlow,
  oauthFlowOf,
} from "../../../protocol/lophn-agent/mod.ts";
import type { CallbackListener } from "../extensions/mod.ts";
import type { ProviderTokenMeta } from "./oauth-secrets.ts";

// 발급자에게 보내는 이름이다. 동의 화면과 ChatGPT 설정의 앱 목록에 보인다.
const OAUTH_APP_NAME = "lophn";
const CHATGPT_REGISTER_CLIENT = "dynamic_agent_client";
const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
const CHATGPT_LOGIN_MS = 15 * 60_000;
const CHATGPT_CHECK_MS = 1_000;
const DEVICE_DEFAULT_EXPIRES_S = 300;
const DEVICE_DEFAULT_INTERVAL_S = 5;
const DEVICE_SLOW_DOWN_MS = 5_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const ACCESS_DEFAULT_S = 3_600;

export type IssuerFetch = (url: string, init: RequestInit) => Promise<Response>;

export type OAuthTokens = {
  access: string;
  refresh: string;
  expires_at_ms: number;
  meta: ProviderTokenMeta;
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

type Session<T> =
  & {
    provider: string;
    target: T;
    deadlineMs: number;
    intervalMs: number;
    // complete가 겹치면 두 번째는 교환을 다시 보내지 않는다.
    busy: boolean;
  }
  & (
    | {
      flow: "pkce_loopback";
      oauth: Extract<OAuthDefinition, { product: "chatgpt" }>;
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

export function createProviderOAuth<T>(deps: {
  http: IssuerFetch;
  openListener(): Promise<Result<CallbackListener>>;
  hostId(): Promise<Result<string>>;
  nowMs(): number;
  random: RandomSource;
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

  async function beginChatGpt(
    provider: string,
    oauth: Extract<OAuthDefinition, { product: "chatgpt" }>,
    target: T,
  ): Promise<Result<OAuthBegin>> {
    const hostId = await deps.hostId();
    if (!hostId.ok) return hostId;
    const opened = await deps.openListener();
    if (!opened.ok) return opened;
    const listener = opened.value;
    const state = randomText(32);
    const nonce = randomText(32);
    const verifier = randomText(32);
    const redirectUri = `http://127.0.0.1:${listener.port()}/auth/callback`;
    const url = new URL(oauth.authorization_endpoint);
    for (
      const [key, value] of Object.entries({
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
      })
    ) url.searchParams.set(key, value);
    const login = randomText(16);
    const stop = new AbortController();
    const deadlineMs = deps.nowMs() + CHATGPT_LOGIN_MS;
    const session: Session<T> = {
      provider,
      target,
      deadlineMs,
      intervalMs: CHATGPT_CHECK_MS,
      busy: false,
      flow: "pkce_loopback",
      oauth,
      listener,
      stop,
      callback: null,
      state,
      nonce,
      verifier,
      redirectUri,
    };
    sessions.set(login, session);
    // callback은 사람이 돌아올 때 온다. complete가 기다리지 않도록 받으면 세션에 쥔다.
    void listener.receive(stop.signal).then((callback) => {
      session.callback = callback;
    });
    return ok({
      login,
      flow: "pkce_loopback",
      interval_ms: CHATGPT_CHECK_MS,
      expires_at_ms: deadlineMs,
      sign_in: { url: url.toString(), user_code: null },
    });
  }

  async function beginDevice(
    provider: string,
    oauth: Extract<OAuthDefinition, { product: "supergrok" }>,
    target: T,
  ): Promise<Result<OAuthBegin>> {
    const started = await post(deps.http, oauth.device_authorization_endpoint, {
      client_id: oauth.client_id,
      scope: oauth.scopes.join(" "),
    });
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
    const signIn = text(body["verification_uri_complete"]) ??
      text(body["verification_uri"]);
    if (deviceCode === null || userCode === null || signIn === null) {
      return err({
        code: "unavailable",
        message: "device code 응답이 모자라다",
      });
    }
    const now = deps.nowMs();
    const intervalMs =
      (positive(body["interval"]) ?? DEVICE_DEFAULT_INTERVAL_S) * 1000;
    const deadlineMs = now +
      (positive(body["expires_in"]) ?? DEVICE_DEFAULT_EXPIRES_S) * 1000;
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
    const exchanged = await post(deps.http, session.oauth.token_endpoint, {
      grant_type: "authorization_code",
      client_id: clientId,
      code: callback.value.code,
      code_verifier: session.verifier,
      redirect_uri: session.redirectUri,
      resource: session.oauth.resource,
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
      jwksUri: session.oauth.jwks_uri,
      issuer: session.oauth.issuer,
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
    const polled = await post(deps.http, session.oauth.token_endpoint, {
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
        tokens: { ...tokens, meta: { client_id: null, subject: null } },
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
      return oauthFlowOf(oauth) === "pkce_loopback"
        ? await beginChatGpt(
          provider,
          oauth as Extract<OAuthDefinition, { product: "chatgpt" }>,
          target,
        )
        : await beginDevice(
          provider,
          oauth as Extract<OAuthDefinition, { product: "supergrok" }>,
          target,
        );
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
        return session.flow === "pkce_loopback"
          ? await completeChatGpt(login, session)
          : await completeDevice(login, session);
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

// ---- 발급자 HTTP ----

type Answer = { status: number; body: Record<string, unknown> };

// form POST 한 번. 발급자에 닿지 못하면 unavailable이다. 본문이 JSON object가 아니면 빈 object로 본다.
async function post(
  http: IssuerFetch,
  url: string,
  fields: Record<string, string>,
): Promise<Result<Answer>> {
  return await send(http, url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function send(
  http: IssuerFetch,
  url: string,
  init: RequestInit,
): Promise<Result<Answer>> {
  let response: Response;
  let raw: string;
  try {
    response = await http(url, init);
    raw = await response.text();
  } catch {
    return err({ code: "unavailable", message: "발급자에 닿지 못했다" });
  }
  if (response.status >= 500) {
    return err({ code: "unavailable", message: "발급자가 답하지 못했다" });
  }
  return ok({ status: response.status, body: objectOf(raw) });
}

export function objectOf(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// access와 refresh가 둘 다 있어야 성공이다(offline_access를 요청했다).
function tokensOf(
  body: Record<string, unknown>,
  nowMs: number,
): Omit<OAuthTokens, "meta"> | null {
  const access = text(body["access_token"]);
  const refresh = text(body["refresh_token"]);
  if (access === null || refresh === null) return null;
  return {
    access,
    refresh,
    expires_at_ms: nowMs +
      (positive(body["expires_in"]) ?? ACCESS_DEFAULT_S) * 1000,
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
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// RFC 7636 S256 challenge다.
async function pkceChallenge(verifier: string): Promise<string> {
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
    ? value as Record<string, unknown>
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

async function verifiedSubject(http: IssuerFetch, input: {
  idToken: string | null;
  jwksUri: string;
  issuer: string;
  clientId: string;
  nonce: string;
  nowMs: number;
}): Promise<Result<string>> {
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
  const candidates = keys.filter((key) =>
    key["kty"] === "RSA" && (kid === undefined || key["kid"] === kid)
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
    !signed || claims["iss"] !== input.issuer ||
    !audiences.includes(input.clientId) ||
    typeof exp !== "number" || exp * 1000 <= input.nowMs ||
    claims["nonce"] !== input.nonce || subject === null
  ) return bad;
  return ok(subject);
}
