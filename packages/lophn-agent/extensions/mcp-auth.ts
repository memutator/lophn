import { err, ok, type Result } from "../../base/mod.ts";
import { cryptoRandom, type RandomSource } from "../../base/mod.ts";
import type { HttpFetch } from "./adapters/mcp-http.ts";
import { httpRequest } from "./adapters/mcp-http.ts";

// HTTP 인증(concern lophn-agent/extensions, requirements
// lophn-agent/extensions#R16, R17). 인증 없음·사람이 지정한 Bearer 토큰·사람이
// 지정한 API 키 헤더·OAuth 2.1 Authorization Code와 S256 PKCE를 지원한다(R16).
// OAuth는 사람이 시작한 브라우저 열기(port가 열 URL을 돌려준다, 실제 브라우저를
// 열지 않는다)와 127.0.0.1 loopback callback으로 진행한다(R16). 동적 클라이언트
// 등록을 지원하지 않는 서버에는 사람이 등록한 client 정보를 넣는다(R16).

// 인증 비밀은 platform/secrets의 보관 방식으로 서버 연결 대상과 OAuth 발급자에
// 묶는다(R17). URL·발급자·사용 계정이 바뀌면 이전 비밀을 재사용하지 않는다(R17).
// 만료 토큰은 같은 연결에서 한 번에 하나만 갱신하고(single-flight), 갱신 실패는
// 재인증 필요로 알린다(R17).

// shell#T31에서 넘어온 이름 규칙이다. bearer·api_key·oauth2의 credential은
// 보호 창의 `SetSecret`(이름 `mcp-<server 이름>`)이 저장하고 설정은
// `sec:mcp-<server 이름>`을 가리킨다. 이 이름 규칙으로 찾는 곳은 이 모듈 밖의
// 통로(extensions secret-refs)다.

// 보관 이름이다(shell#T31에서 넘어온 규칙). 서버 이름을 그대로 쓴다. 서버 이름은
// 계약(extensions R12)이 `[A-Za-z0-9_-]{1,32}`로 거르므로 이 그대로가
// secretNameSchema를 지난다.
export function mcpSecretName(server: string): string {
  return `mcp-${server}`;
}

// 설정이 가리키는 참조다. `sec:` + 보관 이름이다(extensions secret-refs가 같은
// 규칙으로 읽는다).
export function mcpSecretRef(server: string): string {
  return `sec:${mcpSecretName(server)}`;
}

// 인증 방식이다(계약 mcpAuthSchema의 kind).
export type McpAuthKind = "none" | "bearer" | "api_key" | "oauth2";

// 사람이 지정한 Bearer·API 키의 인증 비밀이 묶인 서버 연결 대상이다(R17). 값은
// 이 모양 어디에도 없고 참조만 있다(platform/secrets).
export type CredentialBinding = {
  // 서버 URL이다. URL이 바뀌면 옛 인증 비밀을 재사용하지 않는다(R17).
  server_url: string;
  // 보관 이름이다(`mcp-<server>`, shell#T31 규칙).
  secret_name: string;
};

// OAuth 발급자에 묶인 인증 비밀이다(R17). 발급자·계정이 바뀌면 옛 token을
// 재사용하지 않는다(R17).
export type OAuthBinding = {
  // OAuth 발급자다(계약 mcpAuthSchema의 issuer). 발급자가 바뀌면 옛 token을
  // 재사용하지 않는다(R17).
  issuer: string;
  // 서버 URL이다. URL이 바뀌면 옛 token을 재사용하지 않는다(R17).
  server_url: string;
  // 사용 계정이다(사람이 로그인해 확인한 계정 식별). 계정이 바뀌면 옛 token을
  // 재사용하지 않는다(R17). 없으면 아직 확인한 계정이 없는 것이다.
  account: string | null;
  // secret 보관 이름이다(`mcp-<server>` 앞 규칙).
  secret_name: string;
};

// URL·issuer·계정이 바뀌었는지 본다(R17). 하나라도 다르면 옛 비밀을 재사용하지
// 않는다(R17). 같으면 같은 binding이고 재사용이다(R17).
export function bindingChanged(
  left: CredentialBinding | OAuthBinding,
  right: CredentialBinding | OAuthBinding,
): boolean {
  return left.server_url !== right.server_url ||
    ("issuer" in left ? left.issuer : null) !==
      ("issuer" in right ? right.issuer : null) ||
    ("account" in left ? left.account : null) !==
      ("account" in right ? right.account : null);
}

// 인증 헤더 붙이기다(R16). Bearer는 `authorization: Bearer <token>`이고 API 키는
// 사람이 정한 헤더 이름에 값 그대로다. redirect가 같은 origin이 아니면 인증
// 헤더를 넘기지 않는다(R15, adapter의 httpRequest가 거른다).
export type HttpAuth = {
  // 요청에 붙일 헤더다. 값이 비어 있으면 인증 없음이다(R16: 인증 없음).
  headers: Record<string, string>;
  kind: McpAuthKind;
};

// 인증 헤더를 만든다(R16). Bearer는 `authorization` 하나고 API 키는 사람이 정한
// 헤더 이름이다. 값은 부르는 쪽이 결정한다. redirect의 다른 origin은 adapter가
// 거른다(R15).
export function authHeaders(
  auth:
    & {
      kind: McpAuthKind;
    }
    & (
      | { kind: "none" }
      | { kind: "bearer"; token: string }
      | { kind: "api_key"; token: string; header_name: string }
    ),
): HttpAuth {
  if (auth.kind === "none") return { headers: {}, kind: auth.kind };
  if (auth.kind === "bearer") {
    return {
      headers: { authorization: `Bearer ${auth.token}` },
      kind: auth.kind,
    };
  }
  return {
    headers: { [auth.header_name]: auth.token },
    kind: auth.kind,
  };
}

// OAuth 2.1 Authorization Code + S256 PKCE다(R16).

// PKCE verifier이다. RFC 7636의 43자 base64url이다.
export function pkceVerifier(random: RandomSource = cryptoRandom): string {
  const bytes = new Uint8Array(32);
  random.fill(bytes);
  return base64url(bytes);
}

// RFC 7636 S256 challenge다. verifier의 SHA-256을 base64url로 인코딩한다.
export async function pkceChallengeS256(
  verifier: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

// 사람이 시작한 브라우저 열기 port다(R16). 실제 브라우저를 열지 않고 열 URL을
// 돌려준다(shell#T31의 `[Sign in]` 흐름이 OS browser로 연다). 값은 접어 두는
// 근거가 없다.
export type BrowserOpener = (url: string) => Promise<Result<void>>;

// 127.0.0.1 loopback callback listener port다(R16). 테스트가 끼운다. 사람이
// return 해 주는 요청을 받아 redirect URL로 돌려주는 port다(렇게
// 흐르는 근거는 없다). ListenAddr은 127.0.0.1의 port다.
export type CallbackListener = {
  // loopback callback port다. 127.0.0.1에만 듣는다(R16).
  port(): number;
  // 사람이 돌아온 callback을 기다린다. code·state·iss를 돌려준다.
  receive(signal: AbortSignal): Promise<
    Result<{
      code: string;
      state: string;
      iss: string | null;
    }>
  >;
  close(): Promise<void>;
};

// callback listener port를 만든다(R16). 실제 loopback listener는 이 모듈 밖의
// port에서 만들고, 테스트는 가짜를 끼운다.
export type CallbackOpener = () => Promise<Result<CallbackListener>>;

// OAuth 시작이다(R16). authorization URL을 만들고 사람이 연다.
export type OAuthStartInput = {
  authorizationEndpoint: string;
  clientId: string;
  // 동적 클라이언트 등록을 지원하지 않는 서버에는 사람이 등록한 client_id를
  // 넣는다(R16). 없으면 등록을 시도한다.
  scopes: readonly string[];
  redirectPort: number;
  state: string;
  challenge: string;
};

export function authorizationUrl(
  input: OAuthStartInput,
): Result<URL> {
  let endpoint: URL;
  try {
    endpoint = new URL(input.authorizationEndpoint);
  } catch {
    return err({
      code: "invalid_input",
      message: "authorization endpoint가 URL이 아니다",
    });
  }
  if (endpoint.protocol !== "https:") {
    return err({
      code: "invalid_input",
      message: "authorization endpoint는 https다",
    });
  }
  const url = new URL(endpoint.href);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  if (input.scopes.length > 0) {
    url.searchParams.set("scope", input.scopes.join(" "));
  }
  url.searchParams.set(
    "redirect_uri",
    `http://127.0.0.1:${input.redirectPort}/callback`,
  );
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return ok(url);
}

// OAuth token 교환이다(R16). code·verifier·redirect_port로 token endpoint를
// 부른다. endpoint는 https다.
export type TokenExchangeInput = {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectPort: number;
  // 동적 클라이언트 등록을 지원하지 않는 서버는 사람이 등록한 client secret을
  // 넣는다(R16).
  clientSecret: string | null;
};

export type TokenExchangeOutcome = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
};

export async function exchangeToken(
  input: TokenExchangeInput,
  fetch: HttpFetch,
  signal: AbortSignal,
): Promise<Result<TokenExchangeOutcome>> {
  let endpoint: URL;
  try {
    endpoint = new URL(input.tokenEndpoint);
  } catch {
    return err({
      code: "invalid_input",
      message: "token endpoint가 URL이 아니다",
    });
  }
  if (endpoint.protocol !== "https:") {
    return err({ code: "invalid_input", message: "token endpoint는 https다" });
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: `http://127.0.0.1:${input.redirectPort}/callback`,
    code_verifier: input.verifier,
  });
  if (input.clientSecret !== null) {
    body.set("client_secret", input.clientSecret);
  }
  const response = await httpRequest(fetch, input.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal,
  });
  if (!response.ok) {
    return err({
      code: response.reason === "invalid" ? "invalid_input" : "unavailable",
      message: response.detail,
    });
  }
  if (response.status !== 200) {
    return err({
      code: "unavailable",
      message: `token endpoint가 ${response.status}로 답했다`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    return err({ code: "unavailable", message: "token 응답이 JSON이 아니다" });
  }
  if (parsed === null || typeof parsed !== "object") {
    return err({ code: "unavailable", message: "token 응답이 객체가 아니다" });
  }
  const record = parsed as Record<string, unknown>;
  const accessToken = record["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return err({ code: "unavailable", message: "access_token이 없다" });
  }
  const refreshToken = record["refresh_token"];
  const expiresIn = record["expires_in"];
  return ok({
    access_token: accessToken,
    refresh_token: typeof refreshToken === "string" ? refreshToken : null,
    expires_in: typeof expiresIn === "number" ? expiresIn : null,
  });
}

// OAuth refresh이다(R17). 만료 토큰은 같은 연결에서 한 번에 하나만 갱신한다.
export type RefreshOutcome = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
};

export async function refreshToken(
  input: {
    tokenEndpoint: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string | null;
  },
  fetch: HttpFetch,
  signal: AbortSignal,
): Promise<Result<RefreshOutcome>> {
  let endpoint: URL;
  try {
    endpoint = new URL(input.tokenEndpoint);
  } catch {
    return err({
      code: "invalid_input",
      message: "token endpoint가 URL이 아니다",
    });
  }
  if (endpoint.protocol !== "https:") {
    return err({ code: "invalid_input", message: "token endpoint는 https다" });
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  if (input.clientSecret !== null) {
    body.set("client_secret", input.clientSecret);
  }
  const response = await httpRequest(fetch, input.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal,
  });
  if (!response.ok) {
    return err({
      code: response.reason === "invalid" ? "invalid_input" : "unavailable",
      message: response.detail,
    });
  }
  if (response.status >= 400) {
    // 갱신 거절(폐기된 refresh token 등)은 재인증 필요다(R17).
    return err({
      code: "forbidden",
      message: "갱신 거절이다. 재인증이 필요하다",
    });
  }
  if (response.status !== 200) {
    return err({
      code: "unavailable",
      message: `token endpoint가 ${response.status}로 답했다`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    return err({ code: "unavailable", message: "token 응답이 JSON이 아니다" });
  }
  if (parsed === null || typeof parsed !== "object") {
    return err({ code: "unavailable", message: "token 응답이 객체가 아니다" });
  }
  const record = parsed as Record<string, unknown>;
  const accessToken = record["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return err({ code: "unavailable", message: "access_token이 없다" });
  }
  const nextRefresh = record["refresh_token"];
  const expiresIn = record["expires_in"];
  return ok({
    access_token: accessToken,
    refresh_token: typeof nextRefresh === "string" ? nextRefresh : null,
    expires_in: typeof expiresIn === "number" ? expiresIn : null,
  });
}

// 사람이 돌아온 callback이다(R16). code·state·iss다.

// 동적 클라이언트 등록 시도다(R16). 지원하지 않는 서버는 사람이 등록한 client
// 정보를 넣는다(R16). 등록 미지원(400대)은 absent이고 부르는 쪽이 사람 등록
// client로 진행한다(R16).
export type Registration =
  | { client_id: string; client_secret: string | null }
  | { absent: true };

export async function registerClient(
  input: {
    registrationEndpoint: string;
    redirectPort: number;
    clientName: string;
  },
  fetch: HttpFetch,
  signal: AbortSignal,
): Promise<Result<Registration>> {
  let endpoint: URL;
  try {
    endpoint = new URL(input.registrationEndpoint);
  } catch {
    return err({
      code: "invalid_input",
      message: "registration endpoint가 URL이 아니다",
    });
  }
  if (endpoint.protocol !== "https:") {
    return err({
      code: "invalid_input",
      message: "registration endpoint는 https다",
    });
  }
  const response = await httpRequest(fetch, input.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: input.clientName,
      redirect_uris: [`http://127.0.0.1:${input.redirectPort}/callback`],
      token_endpoint_auth_method: "none",
    }),
    signal,
  });
  if (!response.ok) {
    return err({
      code: response.reason === "invalid" ? "invalid_input" : "unavailable",
      message: response.detail,
    });
  }
  // 등록 미지원이다(R16). 부르는 쪽이 사람 등록 client로 진행한다(R16).
  if (response.status >= 400) return ok({ absent: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    return err({ code: "unavailable", message: "등록 응답이 JSON이 아니다" });
  }
  if (parsed === null || typeof parsed !== "object") {
    return err({ code: "unavailable", message: "등록 응답이 객체가 아니다" });
  }
  const record = parsed as Record<string, unknown>;
  const clientId = record["client_id"];
  if (typeof clientId !== "string" || clientId.length === 0) {
    return err({ code: "unavailable", message: "client_id가 없다" });
  }
  const clientSecret = record["client_secret"];
  return ok({
    client_id: clientId,
    client_secret: typeof clientSecret === "string" ? clientSecret : null,
  });
}

// 같은 연결의 갱신은 하나다(R17). 두 번째 부름은 첫 번째 응답을 같이 기다린다.
export class SingleFlight<Void> {
  private running: Promise<Void> | null = null;

  run(next: () => Promise<Void>): Promise<Void> {
    if (this.running !== null) return this.running;
    const started = next().finally(() => {
      this.running = null;
    });
    this.running = started;
    return started;
  }
}

// 같은 연결의 인증 상태다(R17). 만료 토큰은 같은 연결에서 하나만 갱신한다(R17).
// 실패는 재인증 필요다(R17).
export type AuthState =
  | { kind: "not_started" }
  | { kind: "in_progress" }
  | { kind: "authorized"; access_token: string; expires_at: number | null }
  | { kind: "reauth_needed"; reason: string };

// 같은 연결의 OAuth 인증 관리다(R16, R17). 만료 토큰은 같은 연결에서 하나만
// 갱신한다(single-flight, R17). 실패는 재인증 필요다(R17).
export function createMcpAuth(options: {
  nowMs(): number;
  random?: RandomSource;
}): {
  state(): AuthState;
  // 사람이 시작한 OAuth다(R16). callback listener는 port로 시작했고 loopback
  // port다(R16). 값을 저장하는 곳은 이 모듈 밖의 secret namespace다.
  begin(input: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    scopes: readonly string[];
    listener: CallbackListener;
  }): Promise<Result<{ url: URL; verifier: string; state: string }>>;
  // 사람이 돌아온 callback을 받아 token 교환을 마친다(R16). 같은 연결에서
  // 하나만 진행하고, 실패는 재인증 필요다(R17).
  complete(input: {
    fetch: HttpFetch;
    signal: AbortSignal;
  }): Promise<Result<void>>;
  // 갱신이다(R17). 만료 토큰은 같은 연결에서 하나만 갱신하고 실패는
  // 재인증 필요다(R17).
  refresh(input: {
    fetch: HttpFetch;
    signal: AbortSignal;
  }): Promise<Result<void>>;
} {
  let state: AuthState = { kind: "not_started" };
  const single = new SingleFlight<Result<void>>();
  let session: {
    verifier: string;
    tokenEndpoint: string;
    clientId: string;
    stateValue: string;
    listener: CallbackListener;
    startedAt: number;
  } | null = null;
  let current: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    // token 교환·갱신의 endpoint와 client다(R16). complete이 끝나도 살아 있어야
    // 같은 연결의 refresh가 같은 endpoint·client를 쓴다(R17).
    tokenEndpoint: string;
    clientId: string;
  } | null = null;
  const random = options.random ?? cryptoRandom;

  return {
    state() {
      return state;
    },
    async begin(input) {
      if (state.kind === "in_progress") {
        return err({
          code: "conflict",
          message: "OAuth 시작이 이미 진행 중이다",
        });
      }
      let endpoint: URL;
      try {
        endpoint = new URL(input.authorizationEndpoint);
      } catch {
        return err({
          code: "invalid_input",
          message: "authorization endpoint가 URL이 아니다",
        });
      }
      if (endpoint.protocol !== "https:") {
        return err({
          code: "invalid_input",
          message: "authorization endpoint는 https다",
        });
      }
      const verifier = pkceVerifier(random);
      const challenge = await pkceChallengeS256(verifier);
      // 무작위 state다(R16: 사람이 시작한 OAuth의 cryptographic state).
      const stateBytes = new Uint8Array(16);
      random.fill(stateBytes);
      const stateValue = base64url(stateBytes);
      const url = authorizationUrl({
        authorizationEndpoint: input.authorizationEndpoint,
        clientId: input.clientId,
        scopes: input.scopes,
        redirectPort: input.listener.port(),
        state: stateValue,
        challenge,
      });
      if (!url.ok) return url;
      state = { kind: "in_progress" };
      session = {
        verifier,
        tokenEndpoint: input.tokenEndpoint,
        clientId: input.clientId,
        stateValue,
        listener: input.listener,
        startedAt: options.nowMs(),
      };
      return ok({ url: url.value, verifier, state: stateValue });
    },
    async complete(input) {
      if (session === null) {
        return err({
          code: "conflict",
          message: "OAuth 시작이 아닌 상태다",
        });
      }
      const held = session;
      const received = await held.listener.receive(input.signal);
      if (!received.ok) {
        state = { kind: "reauth_needed", reason: received.error.message };
        return received;
      }
      // state 검증이다(R16: 잘못된 반환 검증 값은 거절이다).
      if (received.value.state !== held.stateValue) {
        await held.listener.close();
        state = { kind: "reauth_needed", reason: "state가 다르다" };
        return err({ code: "invalid_input", message: "state가 다르다" });
      }
      const exchanged = await exchangeToken(
        {
          tokenEndpoint: held.tokenEndpoint,
          code: received.value.code,
          verifier: held.verifier,
          clientId: held.clientId,
          redirectPort: held.listener.port(),
          clientSecret: null,
        },
        input.fetch,
        input.signal,
      );
      await held.listener.close();
      session = null;
      if (!exchanged.ok) {
        state = { kind: "reauth_needed", reason: exchanged.error.message };
        return exchanged;
      }
      current = {
        accessToken: exchanged.value.access_token,
        refreshToken: exchanged.value.refresh_token,
        expiresAt: exchanged.value.expires_in === null
          ? null
          : options.nowMs() + exchanged.value.expires_in * 1000,
        tokenEndpoint: held.tokenEndpoint,
        clientId: held.clientId,
      };
      state = {
        kind: "authorized",
        access_token: current.accessToken,
        expires_at: current.expiresAt,
      };
      return ok(undefined);
    },
    async refresh(input) {
      if (current === null) {
        return err({
          code: "conflict",
          message: "권한을 얻은 상태가 아니다",
        });
      }
      const held: { nonEmpty: string | null } = {
        nonEmpty: current.refreshToken,
      };
      if (held.nonEmpty === null) {
        state = { kind: "reauth_needed", reason: "refresh token이 없다" };
        return err({ code: "forbidden", message: "재인증이 필요하다" });
      }
      const token: string = held.nonEmpty;
      const tokenEndpoint = current.tokenEndpoint;
      const clientId = current.clientId;
      return await single.run(async () => {
        const exchanged = await refreshToken(
          {
            tokenEndpoint,
            refreshToken: token,
            clientId,
            clientSecret: null,
          },
          input.fetch,
          input.signal,
        );
        if (!exchanged.ok) {
          state = { kind: "reauth_needed", reason: exchanged.error.message };
          return exchanged;
        }
        current = {
          accessToken: exchanged.value.access_token,
          refreshToken: exchanged.value.refresh_token ??
            held.nonEmpty,
          expiresAt: exchanged.value.expires_in === null
            ? null
            : options.nowMs() + exchanged.value.expires_in * 1000,
          tokenEndpoint,
          clientId,
        };
        state = {
          kind: "authorized",
          access_token: current.accessToken,
          expires_at: current.expiresAt,
        };
        return ok(undefined);
      });
    },
  };
}
