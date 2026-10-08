// OAuth 로그인 작업(provider#R1, R12–R16, 조사 docs/research/provider-auth.md).
// chatgpt는 공식 Sign in with ChatGPT(실제 lophn 앱 이름의 dynamic client 등록·발급
// client_id 재사용·127.0.0.1 loopback callback·state·nonce·S256·id_token 검증)이고
// supergrok은 xAI discovery(fake 포함)와 device code flow다. 활성 gate는
// verified_for_lophn과 live 확인(D31) 둘이 모두 열려 있어야 통과한다. 값(state·
// nonce·verifier·device_code·token)은 이 작업 메모리와 창가의 응답에만 산고
// ledger·event·log에 남지 않는다(R6, R7). network·listener·시각은 deps로 받는다;
// 이 모듈 자체는 IO를 하지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type { RandomSource } from "../../../base/mod.ts";
import type {
  OAuthDefinition,
  ProviderDefinition,
} from "../../../contracts/lophn-agent/mod.ts";
import { OAUTH_REFRESH_LEAD_MS } from "../../../contracts/lophn-agent/mod.ts";
import {
  type OAuthCallback,
  oauthHttp,
  type OAuthListener,
  type OAuthListenerOpener,
  openCallbackListener,
  xaiHostAllowed,
} from "./adapters/oauth-transport.ts";

// lophn 제품 이름 식별(R15). 등록·요청 어디서도 Claude Code·Codex·Grok CLI로
// 위장하지 않는다.
export const OAUTH_APP_NAME = "lophn";

// chatgpt(공식 Sign in with ChatGPT)의 고정 목적지(O2, 조사 문서).
export const SIWC_AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
export const SIWC_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
export const SIWC_REGISTER =
  "https://auth.openai.com/api/accounts/oauth/register";
export const SIWC_RESOURCE = "https://api.openai.com/v1";
export const SIWC_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
] as const;
// token reference(O4): access 3600초, refresh 30일. 매 갱신 뒤 새 30일이다.
export const SIWC_ACCESS_SECONDS = 3_600;
export const SIWC_REFRESH_SECONDS = 30 * 24 * 3_600;

// supergrok의 고정 discovery와 device 코드 목적지(X1, 조사 문서). 실제 endpoints는
// discovery 응답을 다시 검사한 뒤에만 쓴다(R13).
export const XAI_DISCOVERY =
  "https://auth.x.ai/.well-known/openid-configuration";
export const XAI_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "grok-cli:access",
  "api:access",
] as const;

// device polling(R14): 간격 없으면 5초, slow_down마다 5초를 더하고, chatgpt는 최대
// 15분, xAI는 만료가 없으면 최대 5분까지만 기다린다.
export const OAUTH_POLL_DEFAULT_MS = 5_000;
export const OAUTH_POLL_SLOW_DOWN_MS = 5_000;
export const OAUTH_POLL_MIN_MS = 1_000;
export const CHATGPT_LOGIN_MAX_WAIT_MS = 15 * 60_000;
export const SUPERGROK_LOGIN_MAX_WAIT_MS = 5 * 60_000;

// ---- base64url / PKCE / state / nonce ----

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

export function oauthRandomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

// RFC 7636 S256 challenge다. verifier의 SHA-256을 base64url로 인코딩한다.
export async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

function randomToken(random?: RandomSource): string {
  const bytes = new Uint8Array(16);
  if (random === undefined) crypto.getRandomValues(bytes);
  else random.fill(bytes);
  return base64url(bytes);
}

// ---- JWT 검증(R12: id_token 서명·issuer·audience·만료·nonce) ----

function jwtSegment(jwt: string, index: 0 | 1): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[index]!.replaceAll("-", "+").replaceAll(
      "_",
      "/",
    );
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const decoded = JSON.parse(atob(padded));
    return decoded !== null && typeof decoded === "object" &&
        !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

// id_token의 서명을 JWKS의 RSA 공개 key로 검증한다(RS256만, O2). JWK의 n·e는
// base64url(unpadded)이다.
async function rs256Verified(
  signingInput: string,
  signatureB64: string,
  jwk: Record<string, unknown>,
): Promise<boolean> {
  try {
    const modulus = jwk["n"];
    const exponent = jwk["e"];
    if (typeof modulus !== "string" || typeof exponent !== "string") {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "RSA",
        n: modulus,
        e: exponent,
        alg: "RS256",
        use: "sig",
      },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    // signature는 base64url이다. 풀어서 bytes로 옮긴다.
    const normalized = signatureB64.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - signatureB64.length % 4) % 4);
    const signature = atob(normalized);
    const sigBytes = new Uint8Array(signature.length);
    for (let i = 0; i < signature.length; i++) {
      sigBytes[i] = signature.charCodeAt(i);
    }
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      sigBytes,
      new TextEncoder().encode(signingInput),
    );
  } catch {
    return false;
  }
}

// ---- 붙여넣은 인증 응답 파싱(R11, T29에서 넘어온 것) ----
// browser 최종 URL(code·state query), code#state, query string 세 모양을 받는다.

export function parsePastedSubmission(
  text: string,
): { code: string; state: string | null } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  // URL이면 query의 code·state를 본다.
  const parsed = parsePastedUrl(trimmed);
  if (parsed !== null) return parsed;
  // code#state 꼴이다(Pi 조사 parseAuthorizationInput의 다른 모양).
  const hash = trimmed.indexOf("#");
  if (hash > 0) {
    const code = trimmed.slice(0, hash).trim();
    const state = trimmed.slice(hash + 1).trim();
    if (code.length > 0) {
      return { code, state: state.length > 0 ? state : null };
    }
  }
  return null;
}

function parsePastedUrl(
  text: string,
): { code: string; state: string | null } | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) return null;
  const state = url.searchParams.get("state");
  return { code, state: state === null ? null : state };
}

// ---- 로그인 세션과 취득 번들 ----

// 갱신할 token 묶음. access·refresh·id_token과 실제 만료, 발급 client·resource,
// 검증된 identity가 함께 교체된다(조사 구현 메모 1, R17).
export type OAuthTokenBundle = {
  access_token: string;
  refresh_token: string | null;
  // 실제 만료(ms epoch). expiry margin은 refresh 쪽이 정한다(R17).
  expires_in: number;
  issued_client_id: string | null;
  resource: string | null;
  // id_token의 검증된 sub다. 알 수 없으면 null이다(추측 금지, R9).
  subject: string | null;
  // earliest_refresh_at(O4)의 ms epoch다. 알 수 없으면 null이다.
  earliest_refresh_at: number | null;
};

export type OAuthBegin = {
  login: string;
  flow: OAuthDefinition["flow"];
  interval_ms: number;
  expires_at: string;
  sign_in: { url: string; user_code: string | null } | null;
};

// login 세션. state·nonce·verifier·device_code는 값이라 메모리에만 산다(R6).
type LoginSession = {
  login: string;
  provider: string;
  flow: OAuthDefinition["flow"];
  clientId: string;
  verifier: string | null;
  nonce: string | null;
  state: string | null;
  challenge: string | null;
  resource: string | null;
  scopes: readonly string[];
  // paste 방식을 기다리는 callback listener다. 취소·완료 뒤에 닫는다.
  listener: OAuthListener | null;
  // device flow의 값이다(R14).
  deviceCode: string | null;
  deviceAuthId: string | null;
  userCode: string | null;
  verificationUrl: string | null;
  intervalMs: number;
  deadlineMs: number;
  // supergrok의 slow_down 누적이다(R14).
  slowDownMs: number;
  startedMs: number;
};

// device code 시작 응답(R13).
type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number | null;
  interval_ms: number;
  device_auth_id: string | null;
};

// token endpoint의 원시 응답이다.
type NativeTokens = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
  id_token?: string | null;
  earliest_refresh_at?: string | null;
};

export type OAuthDeps = {
  // 사람이 LOPHN_LIVE_PROVIDER=1로 실제 계정 확인을 시작했을 때만 열리는 활성
  // gate다(D31). gate가 닫혀 있으면 begin·complete은 시작하지 않는다(fake 성공으로
  // 열지 않는다). 테스트가 openGate를 대신 준다.
  liveGate(): boolean;
  nowMs(): number;
  at: (ms: number) => string;
  random?: RandomSource;
  // 인증 HTTP의 fetch 눈이다. 없으면(제품 정상 기동) network은 아예 닫혀 있다.
  http?: (url: string, init: RequestInit) => Promise<Response>;
  // loopback callback listener의 open port다. 없으면 제품 openCallbackListener다.
  listenerOpener?: OAuthListenerOpener;
  // device polling의 대기이다(R14: 서버 간격). 제품은 실제 대기, 테스트 fake clock은
  // 즉시 돌려주는 대기를 준다.
  wait?: (ms: number) => Promise<void>;
  // provider의 현재 정의 read port다(complete이 세션 뒤 정의 변경을 검사한다).
  // 테스트가 주입한다. 없으면 begin에 준 정의를 그대로 믿지 않고 unavailable이다.
  currentDefinition?: (
    provider: string,
  ) => Promise<Result<ProviderDefinition>>;
};

export function createProviderOAuth(deps: OAuthDeps): {
  begin: (
    provider: string,
    definition: ProviderDefinition,
  ) => Promise<Result<OAuthBegin>>;
  complete: (
    provider: string,
    login: string,
    submission: string,
  ) => Promise<Result<OAuthTokenBundle>>;
  cancel: (provider: string, login: string) => Promise<Result<void>>;
} {
  // 발급 client_id 재사용(R12). 등록은 최초 한 번, 이후 세션이 같은 client를 쓴다.
  let issuedClientId: string | null = null;
  const sessions = new Map<string, LoginSession>();

  const gate = (): Result<void> => {
    if (deps.http === undefined || !deps.liveGate()) {
      return err({
        code: "unavailable",
        message: "OAuth login is not enabled in this build yet",
      });
    }
    return ok(undefined);
  };

  const validDefinition = (
    definition: ProviderDefinition,
  ): Result<OAuthDefinition> => {
    if (definition.oauth === null) {
      return err({
        code: "invalid_input",
        message: "provider does not support OAuth login",
      });
    }
    // D31: 실제 확인 전까지 활성 gate는 false다.
    if (definition.oauth.verified_for_lophn !== true) {
      return err({
        code: "unavailable",
        message: "OAuth login is not enabled in this build yet",
      });
    }
    return ok(definition.oauth);
  };

  const sessionOf = (provider: string, login: string): Result<LoginSession> => {
    const session = sessions.get(login);
    if (session === undefined || session.provider !== provider) {
      return err({ code: "not_found", message: "login not found" });
    }
    return ok(session);
  };

  const closeListener = async (session: LoginSession): Promise<void> => {
    const listener = session.listener;
    session.listener = null;
    if (listener !== null) await listener.close().catch(() => undefined);
  };

  const dropSession = (session: LoginSession): void => {
    sessions.delete(session.login);
  };

  async function registerClient(
    signal: AbortSignal,
    redirectPort: number,
  ): Promise<Result<string>> {
    const http = deps.http!;
    // 발급 client_id를 재사용한다(R12). 등록은 최초 한 번이다.
    if (issuedClientId !== null) return ok(issuedClientId);
    const response = await oauthHttp(
      http,
      SIWC_REGISTER,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: OAUTH_APP_NAME,
          redirect_uris: [`http://127.0.0.1:${redirectPort}/callback`],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
        }),
      },
      signal,
    );
    if (!response.ok) {
      return err({ code: response.code, message: response.message });
    }
    if (response.response.status === 400 || response.response.status === 404) {
      return err({
        code: "unavailable",
        message: "client registration is not enabled",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.response.body);
    } catch {
      return err({
        code: "unavailable",
        message: "client registration is not JSON",
      });
    }
    if (parsed === null || typeof parsed !== "object") {
      return err({
        code: "unavailable",
        message: "client registration is not JSON",
      });
    }
    const clientId = (parsed as Record<string, unknown>)["client_id"];
    if (typeof clientId !== "string" || clientId.length === 0) {
      return err({ code: "unavailable", message: "client_id is missing" });
    }
    issuedClientId = clientId;
    return ok(clientId);
  }

  async function beginChatGpt(
    session: LoginSession,
    definition: OAuthDefinition,
  ): Promise<Result<OAuthBegin>> {
    const opener = deps.listenerOpener ?? openCallbackListener;
    const opened = await opener();
    if (!opened.ok) return opened;
    session.listener = opened.value;
    const signal = new AbortController().signal;
    const clientId = await registerClient(signal, opened.value.port());
    // 등록이 열리지 않아도 paste 방식은 진행할 수 없다. 발급 client가 필수다(R12).
    if (!clientId.ok) {
      await closeListener(session);
      return clientId;
    }
    session.clientId = clientId.value;
    session.nonce = randomToken(deps.random);
    session.state = randomToken(deps.random);
    session.verifier = base64url(oauthRandomBytes(32));
    session.challenge = await pkceChallengeS256(session.verifier);
    session.resource = definition.issuer;
    const url = new URL(SIWC_AUTHORIZE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", session.clientId);
    url.searchParams.set(
      "redirect_uri",
      `http://127.0.0.1:${opened.value.port()}/callback`,
    );
    url.searchParams.set("scope", session.scopes.join(" "));
    url.searchParams.set("state", session.state!);
    url.searchParams.set("nonce", session.nonce!);
    url.searchParams.set("code_challenge", session.challenge!);
    url.searchParams.set("code_challenge_method", "S256");
    if (session.resource !== null) {
      url.searchParams.set("resource", session.resource);
    }
    return ok({
      login: session.login,
      flow: session.flow,
      interval_ms: OAUTH_POLL_DEFAULT_MS,
      expires_at: deps.at(session.deadlineMs),
      sign_in: { url: url.href, user_code: null },
    });
  }

  async function beginDevice(
    session: LoginSession,
    definition: OAuthDefinition,
  ): Promise<Result<OAuthBegin>> {
    const http = deps.http!;
    const signal = new AbortController().signal;
    session.clientId = definition.issuer;
    session.scopes = [...XAI_SCOPES];
    // discovery를 다시 확인하고 x.ai·하위 도메인 HTTPS인지 검사한다(R13).
    const discovery = await oauthHttp(http, XAI_DISCOVERY, {
      method: "GET",
    }, signal);
    if (!discovery.ok) {
      return err({ code: discovery.code, message: discovery.message });
    }
    if (discovery.response.status !== 200) {
      return err({
        code: "unavailable",
        message: "xAI discovery did not answer",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(discovery.response.body);
    } catch {
      return err({ code: "unavailable", message: "xAI discovery is not JSON" });
    }
    if (parsed === null || typeof parsed !== "object") {
      return err({ code: "unavailable", message: "xAI discovery is not JSON" });
    }
    const record = parsed as Record<string, unknown>;
    const endpoints = [
      record["authorization_endpoint"],
      record["token_endpoint"],
      record["device_authorization_endpoint"],
    ];
    for (const endpoint of endpoints) {
      if (typeof endpoint !== "string") {
        return err({
          code: "unavailable",
          message: "xAI discovery is missing an endpoint",
        });
      }
      if (!xaiHostAllowed(endpoint)) {
        // discovery가 알려 준 목적지도 검사를 통과하지 못하면 중단한다(R13).
        return err({
          code: "forbidden",
          message: "xAI discovery endpoint is outside the trusted host",
        });
      }
    }
    const authorizeEndpoint = String(endpoints[0]);
    const tokenEndpoint = String(endpoints[1]);
    const deviceEndpoint = String(endpoints[2]);
    session.state = null;
    session.verifier = null;
    // device code 시작이다(R13: device code만).
    const body = new URLSearchParams({
      client_id: definition.issuer,
      scope: session.scopes.join(" "),
    });
    const started = await oauthHttp(http, deviceEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": `${OAUTH_APP_NAME}/cli`,
      },
      body: body.toString(),
    }, signal);
    if (!started.ok) {
      return err({ code: started.code, message: started.message });
    }
    if (started.response.status !== 200) {
      return err({
        code: "unavailable",
        message: "device code start was refused",
      });
    }
    let deviceParsed: unknown;
    try {
      deviceParsed = JSON.parse(started.response.body);
    } catch {
      return err({ code: "unavailable", message: "device start is not JSON" });
    }
    if (deviceParsed === null || typeof deviceParsed !== "object") {
      return err({ code: "unavailable", message: "device start is not JSON" });
    }
    const device = deviceParsed as Record<string, unknown>;
    const deviceCode = device["device_code"];
    const userCode = device["user_code"];
    const verification = device["verification_uri"] ??
      device["verification_url"];
    if (
      typeof deviceCode !== "string" || typeof userCode !== "string" ||
      typeof verification !== "string"
    ) {
      return err({
        code: "unavailable",
        message: "device start is missing values",
      });
    }
    session.deviceCode = deviceCode;
    session.userCode = userCode;
    session.verificationUrl = verification;
    session.deviceAuthId = typeof device["device_auth_id"] === "string"
      ? device["device_auth_id"]
      : null;
    const expiresIn = device["expires_in"];
    session.intervalMs = typeof device["interval"] === "number" &&
        (device["interval"] as number) > 0
      ? (device["interval"] as number) * 1000
      : OAUTH_POLL_DEFAULT_MS;
    // 만료가 없으면 최대 5분까지만 기다린다(R14). 만료 값이 있으면 그 둘 중 이른 값이다.
    const deviceDeadline = typeof expiresIn === "number" && expiresIn > 0
      ? deps.nowMs() + expiresIn * 1000
      : session.deadlineMs;
    session.deadlineMs = Math.min(session.deadlineMs, deviceDeadline);
    // 정의의 token endpoint도 x.ai 호스트 규칙을 지나는지 재검사한다(R13).
    if (
      !xaiHostAllowed(tokenEndpoint) || !xaiHostAllowed(authorizeEndpoint) ||
      tokenEndpoint !== definition.token_endpoint ||
      deviceEndpoint !== definition.authorization_endpoint
    ) {
      return err({
        code: "forbidden",
        message: "xAI endpoints do not match the verified definition",
      });
    }
    return ok({
      login: session.login,
      flow: session.flow,
      interval_ms: session.intervalMs,
      expires_at: deps.at(session.deadlineMs),
      sign_in: {
        url: session.verificationUrl,
        user_code: session.userCode,
      },
    });
  }

  async function tokenExchange(
    _session: LoginSession,
    definition: OAuthDefinition,
    body: URLSearchParams,
  ): Promise<Result<NativeTokens>> {
    const http = deps.http!;
    const signal = new AbortController().signal;
    const response = await oauthHttp(http, definition.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, signal);
    if (!response.ok) {
      return err({ code: response.code, message: response.message });
    }
    if (response.response.status !== 200) {
      return err({
        code: "unavailable",
        message: "token exchange was refused",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.response.body);
    } catch {
      return err({
        code: "unavailable",
        message: "token exchange is not JSON",
      });
    }
    if (parsed === null || typeof parsed !== "object") {
      return err({
        code: "unavailable",
        message: "token exchange is not JSON",
      });
    }
    const record = parsed as Record<string, unknown>;
    const accessToken = record["access_token"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return err({ code: "unavailable", message: "access_token is missing" });
    }
    return ok({
      access_token: accessToken,
      refresh_token: typeof record["refresh_token"] === "string"
        ? record["refresh_token"]
        : null,
      expires_in: typeof record["expires_in"] === "number"
        ? record["expires_in"]
        : null,
      id_token: typeof record["id_token"] === "string"
        ? record["id_token"]
        : null,
      earliest_refresh_at: typeof record["earliest_refresh_at"] === "string"
        ? record["earliest_refresh_at"]
        : null,
    });
  }

  async function identityOf(
    idToken: string | null,
    nonce: string | null,
    clientId: string,
    issuer: string,
  ): Promise<Result<string | null>> {
    if (idToken === null) {
      return err({ code: "unavailable", message: "id_token is missing" });
    }
    const header = jwtSegment(idToken, 0);
    const payload = jwtSegment(idToken, 1);
    if (header === null || payload === null) {
      return err({ code: "unavailable", message: "id_token is malformed" });
    }
    if (header["alg"] !== "RS256") {
      return err({ code: "unavailable", message: "id_token is not RS256" });
    }
    if (typeof payload["exp"] !== "number") {
      return err({ code: "unavailable", message: "id_token has no expiry" });
    }
    const nowSeconds = Math.floor(deps.nowMs() / 1000);
    if (payload["exp"] <= nowSeconds) {
      return err({ code: "unavailable", message: "id_token is expired" });
    }
    if (typeof payload["iss"] !== "string" || payload["iss"] !== issuer) {
      return err({ code: "unavailable", message: "id_token issuer is wrong" });
    }
    const audience = payload["aud"];
    const matches = typeof audience === "string"
      ? audience === clientId
      : Array.isArray(audience) && audience.includes(clientId);
    if (!matches) {
      return err({
        code: "unavailable",
        message: "id_token audience is wrong",
      });
    }
    if (typeof payload["nonce"] !== "string" || payload["nonce"] !== nonce) {
      return err({ code: "unavailable", message: "id_token nonce is wrong" });
    }
    // 서명 검증은 JWKS의 공개 key로 한다(R12). 실패는 거절이다.
    const parts = idToken.split(".");
    const verified = await jwksVerified(
      `${parts[0]}.${parts[1]}`,
      parts[2]!,
      issuer,
    );
    if (!verified.ok) return verified;
    if (!verified.value) {
      return err({
        code: "unavailable",
        message: "id_token signature is wrong",
      });
    }
    const subject = payload["sub"];
    return ok(
      typeof subject === "string" && subject.length > 0 ? subject : null,
    );
  }

  let cachedJwks: {
    issuer: string;
    keys: Record<string, unknown>[];
    fetchedMs: number;
  } | null = null;

  async function jwksVerified(
    signingInput: string,
    signatureB64: string,
    issuer: string,
  ): Promise<Result<boolean>> {
    const now = deps.nowMs();
    if (
      cachedJwks === null || cachedJwks.issuer !== issuer ||
      now - cachedJwks.fetchedMs > 60_000
    ) {
      const http = deps.http!;
      const wellKnown = issuer === "https://auth.openai.com"
        ? "https://auth.openai.com/.well-known/jwks.json"
        : `${issuer}/.well-known/jwks.json`;
      const response = await oauthHttp(
        http,
        wellKnown,
        { method: "GET" },
        new AbortController().signal,
      );
      if (!response.ok) {
        return err({ code: response.code, message: response.message });
      }
      if (response.response.status !== 200) {
        return err({ code: "unavailable", message: "JWKS did not answer" });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.response.body);
      } catch {
        return err({ code: "unavailable", message: "JWKS is not JSON" });
      }
      const keys = (parsed as { keys?: unknown })?.keys;
      if (!Array.isArray(keys)) {
        return err({ code: "unavailable", message: "JWKS has no keys" });
      }
      cachedJwks = {
        issuer,
        keys: keys.filter((key) =>
          key !== null && typeof key === "object"
        ) as Record<string, unknown>[],
        fetchedMs: now,
      };
    }
    // 검증에 성공하는 key가 하나라도 있으면 서명은 맞다(RS256만 시도한다).
    for (const key of cachedJwks.keys) {
      if ((key as Record<string, unknown>)["kty"] !== "RSA") continue;
      if (await rs256Verified(signingInput, signatureB64, key)) return ok(true);
    }
    return ok(false);
  }

  async function completeChatGpt(
    session: LoginSession,
    definition: OAuthDefinition,
    submission: string,
  ): Promise<Result<OAuthTokenBundle>> {
    // paste와 callback 둘을 본다(R12). callback이 먼저 도착했으면 그 값을 쓴다.
    let callback: OAuthCallback | null = null;
    if (submission.trim().length > 0) {
      const pasted = parsePastedSubmission(submission);
      if (pasted === null) {
        await closeListener(session);
        dropSession(session);
        return err({
          code: "invalid_input",
          message: "submission is not a code",
        });
      }
      callback = { code: pasted.code, state: pasted.state ?? "", iss: null };
    } else if (session.listener !== null) {
      const received = await session.listener.receive(
        new AbortController().signal,
      );
      if (!received.ok) {
        await closeListener(session);
        dropSession(session);
        return received;
      }
      callback = received.value;
    } else {
      dropSession(session);
      return err({ code: "invalid_input", message: "submission is empty" });
    }
    // state 누락·불일치는 거절이다(R12). verifier를 state로도 쓰지 않는다.
    if (
      session.state === null || callback.state !== session.state ||
      session.verifier === null || session.nonce === null
    ) {
      await closeListener(session);
      dropSession(session);
      return err({ code: "invalid_input", message: "state does not match" });
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: session.clientId,
      code: callback.code,
      redirect_uri: `http://127.0.0.1:${
        session.listener?.port() ?? 0
      }/callback`,
      state: callback.state,
      nonce: session.nonce,
      code_verifier: session.verifier,
      ...(session.resource === null ? {} : { resource: session.resource }),
    });
    const tokens = await tokenExchange(session, definition, body);
    await closeListener(session);
    if (!tokens.ok) {
      dropSession(session);
      return tokens;
    }
    const identity = await identityOf(
      tokens.value.id_token ?? null,
      session.nonce,
      session.clientId,
      "https://auth.openai.com",
    );
    if (!identity.ok) {
      dropSession(session);
      return identity;
    }
    const secured: OAuthTokenBundle = {
      access_token: tokens.value.access_token,
      refresh_token: tokens.value.refresh_token,
      expires_in: tokens.value.expires_in ?? SIWC_ACCESS_SECONDS,
      issued_client_id: session.clientId,
      resource: session.resource,
      subject: identity.value,
      earliest_refresh_at: earliestOf(
        tokens.value.earliest_refresh_at ?? null,
        tokens.value.expires_in ?? SIWC_ACCESS_SECONDS,
        deps.nowMs(),
      ),
    };
    dropSession(session);
    return ok(secured);
  }

  async function completeDevice(
    session: LoginSession,
    definition: OAuthDefinition,
  ): Promise<Result<OAuthTokenBundle>> {
    const http = deps.http!;
    // device polling이다(R14). 서버 간격·만료를 따르고 거절·만료·취소에 중단한다.
    for (;;) {
      const now = deps.nowMs();
      if (now >= session.deadlineMs) {
        dropSession(session);
        return err({
          code: "unavailable",
          message: "device login deadline has passed",
        });
      }
      const signal = new AbortController().signal;
      const body = new URLSearchParams({
        client_id: definition.issuer,
        device_code: session.deviceCode ?? "",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      const response = await oauthHttp(http, definition.token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": `${OAUTH_APP_NAME}/cli`,
        },
        body: body.toString(),
      }, signal);
      if (!response.ok) {
        dropSession(session);
        return err({ code: response.code, message: response.message });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.response.body);
      } catch {
        parsed = null;
      }
      const record = parsed !== null && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : null;
      if (response.response.status === 200) {
        const accessToken = record?.["access_token"];
        if (typeof accessToken !== "string" || accessToken.length === 0) {
          dropSession(session);
          return err({
            code: "unavailable",
            message: "device token response has no access_token",
          });
        }
        const secured: OAuthTokenBundle = {
          access_token: accessToken,
          refresh_token: typeof record?.["refresh_token"] === "string"
            ? record["refresh_token"]
            : null,
          expires_in: typeof record?.["expires_in"] === "number"
            ? record["expires_in"]
            : SIWC_ACCESS_SECONDS,
          issued_client_id: null,
          resource: null,
          subject: null,
          earliest_refresh_at: null,
        };
        dropSession(session);
        return ok(secured);
      }
      const error = record?.["error"];
      const code = typeof error === "string" ? error : null;
      if (code === "authorization_pending") {
        await pollingWait(session.intervalMs);
        continue;
      }
      if (code === "slow_down") {
        // 대기 연장마다 5초를 더한다(R14).
        session.slowDownMs += OAUTH_POLL_SLOW_DOWN_MS;
        await pollingWait(session.intervalMs + session.slowDownMs);
        continue;
      }
      // 거절·만료·취소다(R14).
      dropSession(session);
      return err({
        code: code === "access_denied" || code === "expired_token"
          ? "conflict"
          : "unavailable",
        message: "device login was refused",
      });
    }

    async function pollingWait(ms: number): Promise<void> {
      await (deps.wait ?? realWait)(ms);
    }
  }
  return {
    async begin(provider, definition) {
      const gated = gate();
      if (!gated.ok) return gated;
      const oauth = validDefinition(definition);
      if (!oauth.ok) return oauth;
      const session: LoginSession = {
        login: randomToken(deps.random),
        provider,
        flow: oauth.value.flow,
        clientId: "",
        verifier: null,
        nonce: null,
        state: null,
        challenge: null,
        resource: null,
        scopes: [...oauth.value.scopes],
        listener: null,
        deviceCode: null,
        deviceAuthId: null,
        userCode: null,
        verificationUrl: null,
        intervalMs: OAUTH_POLL_DEFAULT_MS,
        deadlineMs: deps.nowMs() +
          (oauth.value.product === "chatgpt"
            ? CHATGPT_LOGIN_MAX_WAIT_MS
            : SUPERGROK_LOGIN_MAX_WAIT_MS),
        slowDownMs: 0,
        startedMs: deps.nowMs(),
      };
      sessions.set(session.login, session);
      const begun = oauth.value.product === "chatgpt"
        ? await beginChatGpt(session, oauth.value)
        : await beginDevice(session, oauth.value);
      if (!begun.ok) {
        await closeListener(session);
        dropSession(session);
        return begun;
      }
      return begun;
    },
    async complete(provider, login, submission) {
      const gated = gate();
      if (!gated.ok) return gated;
      const session = sessionOf(provider, login);
      if (!session.ok) return session;
      // provider의 현재 정의를 다시 본다. 세션이 열린 뒤 정의가 바뀌었으면 거절이다.
      const current = deps.currentDefinition === undefined
        ? await Promise.resolve(
          err({
            code: "unavailable" as const,
            message: "definition read port is missing",
          }) as Result<ProviderDefinition>,
        )
        : await deps.currentDefinition(provider);
      if (!current.ok) {
        await closeListener(session.value);
        dropSession(session.value);
        return current;
      }
      const oauth = validDefinition(current.value);
      if (!oauth.ok) return oauth;
      if (oauth.value.product === "chatgpt") {
        return await completeChatGpt(
          session.value,
          oauth.value,
          submission,
        );
      }
      return await completeDevice(session.value, oauth.value);
    },
    async cancel(provider, login) {
      const session = sessionOf(provider, login);
      if (!session.ok) return session;
      await closeListener(session.value);
      dropSession(session.value);
      return ok(undefined);
    },
  };
}

// earliest_refresh_at(O4)의 ms epoch다. 값이 없으면 만료에서 lead를 뺀 시각을 둔다
// (그 이전에 갱신 요청하지 않는다 — R17).
function earliestOf(
  value: string | null,
  expiresIn: number,
  nowMs: number,
): number | null {
  if (value !== null) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return nowMs + Math.max(0, expiresIn * 1000 - OAUTH_REFRESH_LEAD_MS);
}

// device polling의 실제 대기다(R14). 테스트는 deps.wait으로 대신한다.
function realWait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
