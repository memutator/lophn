import { err, ok, type Result } from "../../../base/mod.ts";
import { cryptoRandom, type RandomSource } from "../../../base/mod.ts";
import type { McpAuthFailure } from "../../../protocol/lophn-agent/mod.ts";
import type { HttpFetch } from "./adapters/mcp-http.ts";
import { httpRequest } from "./adapters/mcp-http.ts";

// HTTP 인증.
// 인증 없음·사람이 지정한 Bearer 토큰·사람이
// 지정한 API 키 헤더·OAuth 2.1 Authorization Code와 S256 PKCE를 지원한다.
// OAuth는 사람이 시작한 브라우저 열기(port가 열 URL을 돌려준다, 실제 브라우저를
// 열지 않는다)와 127.0.0.1 loopback callback으로 진행한다. 동적 클라이언트
// 등록을 지원하지 않는 서버에는 사람이 등록한 client 정보를 넣는다.

// 인증 비밀은 platform/secrets의 보관 방식으로 서버 연결 대상과 OAuth 발급자에
// 묶는다. URL·발급자·사용 계정이 바뀌면 이전 비밀을 재사용하지 않는다.
// 만료 토큰은 같은 연결에서 한 번에 하나만 갱신하고(single-flight), 갱신 실패는
// 재인증 필요로 알린다.

// 인증 방식이다(설정 schema의 auth kind).
type McpAuthKind = "none" | "bearer" | "api_key" | "oauth2";

// 사람이 지정한 Bearer·API 키의 인증 비밀이 묶인 서버 연결 대상이다. 값은
// 이 모양 어디에도 없고 참조만 있다(platform/secrets).
type CredentialBinding = {
  // 서버 URL이다. URL이 바뀌면 옛 인증 비밀을 재사용하지 않는다.
  server_url: string;
  // 보관 이름이다(`mcp-<server>`).
  secret_name: string;
};

// OAuth 발급자에 묶인 인증 비밀이다. 발급자·계정이 바뀌면 옛 token을
// 재사용하지 않는다.
type OAuthBinding = {
  // OAuth 발급자다(설정 schema의 issuer). 발급자가 바뀌면 옛 token을
  // 재사용하지 않는다.
  issuer: string;
  // 서버 URL이다. URL이 바뀌면 옛 token을 재사용하지 않는다.
  server_url: string;
  // 사용 계정이다(사람이 로그인해 확인한 계정 식별). 계정이 바뀌면 옛 token을
  // 재사용하지 않는다. 없으면 아직 확인한 계정이 없는 것이다.
  account: string | null;
  // secret 보관 이름이다(`mcp-<server>` 앞 규칙).
  secret_name: string;
};

// URL·issuer·계정이 바뀌었는지 본다. 하나라도 다르면 옛 비밀을 재사용하지
// 않는다. 같으면 같은 binding이고 재사용이다.
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

// 인증 헤더 붙이기다. Bearer는 `authorization: Bearer <token>`이고 API 키는
// 사람이 정한 헤더 이름에 값 그대로다. redirect가 같은 origin이 아니면 인증
// 헤더를 넘기지 않는다(adapter의 httpRequest가 거른다).
type HttpAuth = {
  // 요청에 붙일 헤더다. 값이 비어 있으면 인증 없음이다(인증 없음).
  headers: Record<string, string>;
  kind: McpAuthKind;
};

// 인증 헤더를 만든다. Bearer는 `authorization` 하나고 API 키는 사람이 정한
// 헤더 이름이다. 값은 부르는 쪽이 결정한다. redirect의 다른 origin은 adapter가
// 거른다.
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

// OAuth 2.1 Authorization Code + S256 PKCE다.

// PKCE verifier이다. RFC 7636의 43자 base64url이다.
function pkceVerifier(random: RandomSource = cryptoRandom): string {
  const bytes = new Uint8Array(32);
  random.fill(bytes);
  return base64url(bytes);
}

// RFC 7636 S256 challenge다. verifier의 SHA-256을 base64url로 인코딩한다.
async function pkceChallengeS256(
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

// 사람이 시작한 브라우저 열기 port다. 실제 브라우저를 열지 않고 열 URL을
// 돌려준다(`[Sign in]` 흐름이 OS browser로 연다). 값은 접어 두는
// 근거가 없다.

// 127.0.0.1 loopback callback listener port다. 테스트가 끼운다. 사람이
// return 해 주는 요청을 받아 redirect URL로 돌려주는 port다(렇게
// 흐르는 근거는 없다). ListenAddr은 127.0.0.1의 port다.
export type CallbackListener = {
  // loopback callback port다. 127.0.0.1에만 듣는다.
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

// callback listener port를 만든다. 실제 loopback listener는 이 모듈 밖의
// port에서 만들고, 테스트는 가짜를 끼운다.

// OAuth 시작이다. authorization URL을 만들고 사람이 연다.
type OAuthStartInput = {
  authorizationEndpoint: string;
  clientId: string;
  // 동적 클라이언트 등록을 지원하지 않는 서버에는 사람이 등록한 client_id를
  // 넣는다. 없으면 등록을 시도한다.
  scopes: readonly string[];
  redirectPort: number;
  state: string;
  challenge: string;
};

function authorizationUrl(
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

// OAuth token 교환이다. code·verifier·redirect_port로 token endpoint를
// 부른다. endpoint는 https다.
type TokenExchangeInput = {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectPort: number;
  // 동적 클라이언트 등록을 지원하지 않는 서버는 사람이 등록한 client secret을
  // 넣는다.
  clientSecret: string | null;
};

type TokenExchangeOutcome = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
};

async function exchangeToken(
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

// OAuth refresh이다. 만료 토큰은 같은 연결에서 한 번에 하나만 갱신한다.
type RefreshOutcome = {
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
    // 갱신 거절(폐기된 refresh token 등)은 재인증 필요다.
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

// 사람이 돌아온 callback이다. code·state·iss다.

// 동적 클라이언트 등록 시도다. 지원하지 않는 서버는 사람이 등록한 client
// 정보를 넣는다. 등록 미지원(400대)은 absent이고 부르는 쪽이 사람 등록
// client로 진행한다.

// 사람이 browser에서 돌아오기를 기다리는 시한이다. 요구가 시한을 정하지 않아 추천값 5분으로 둔다:
// 로그인 페이지에서 계정을 고르고 허락하는 데 충분하고, 닫힌 browser가 작업 메모리를 오래 잡지 않는다.
const MCP_AUTH_WAIT_MS = 5 * 60_000;

// 기다림 시한 timer다. 신호가 중단되면 "aborted"로 일찍 돌아온다(mcp-connections의 DeadlineFn과 같은 모양).
export type AuthDeadline = (
  ms: number,
  signal: AbortSignal,
) => Promise<"elapsed" | "aborted">;

// 로그인 session의 상태다. 값(verifier·state·token)은 어디에도 없다. 끝나면 session은 값을 쥐지 않고
// not_started로 돌아간다(받은 token은 부르는 쪽이 `secrets.json`에 보관한다).
type AuthState =
  | { kind: "not_started" }
  | { kind: "in_progress" }
  | { kind: "failed"; reason: McpAuthFailure };

// token 교환이 끝난 결과다. 보관은 부르는 쪽이 한다.
type TokenGrant = {
  access_token: string;
  refresh_token: string | null;
  expires_at_ms: number | null;
  token_endpoint: string;
  client_id: string;
};

// 같은 연결의 OAuth 로그인 session이다: 시작 → 사람이 돌아옴 → state 검사 → token 교환. 하나만 진행하고
// 취소하거나 시한이 지나면 listener를 닫는다. 갱신은 보관한 grant로 하므로 여기 없다(mcp-oauth.ts).
export function createMcpAuth(options: {
  nowMs(): number;
  random?: RandomSource;
  waitMs?: number;
  deadline?: AuthDeadline;
}): {
  state(): AuthState;
  // 사람이 시작한 OAuth다. callback listener는 port로 시작했고 loopback port다.
  begin(input: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    scopes: readonly string[];
    listener: CallbackListener;
  }): Promise<Result<{ url: URL; verifier: string; state: string }>>;
  // 사람이 돌아온 callback을 받아 token 교환을 마친다. 기다리는 동안 취소나 시한으로 끝난다.
  complete(input: {
    fetch: HttpFetch;
    signal: AbortSignal;
  }): Promise<Result<TokenGrant>>;
  // 기다리는 로그인을 그만둔다. 진행 중인 것이 없으면 false다.
  cancel(): Promise<boolean>;
} {
  let state: AuthState = { kind: "not_started" };
  type Session = {
    verifier: string;
    tokenEndpoint: string;
    clientId: string;
    stateValue: string;
    listener: CallbackListener;
    startedAt: number;
    // 기다림을 끝내는 신호다. 취소와 시한 둘 다 이 신호로 간다.
    stop: AbortController;
    cancelled: boolean;
    timedOut: boolean;
  };
  let session: Session | null = null;
  const random = options.random ?? cryptoRandom;
  const waitMs = options.waitMs ?? MCP_AUTH_WAIT_MS;

  // 시한이 지난 session은 실패로 닫는다. complete를 부르지 않은 채 남은 로그인도 다시 시작을 막지 않는다.
  function expire(): void {
    if (session === null) return;
    if (options.nowMs() - session.startedAt <= waitMs) return;
    timeout(session);
  }

  function timeout(held: Session): void {
    held.timedOut = true;
    held.stop.abort();
    void held.listener.close();
    if (session === held) {
      session = null;
      state = { kind: "failed", reason: "callback_timeout" };
    }
  }

  return {
    state() {
      expire();
      return state;
    },
    async begin(input) {
      expire();
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
      // 무작위 state다(사람이 시작한 OAuth의 cryptographic state).
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
      // 위의 await 동안 다른 시작이 끼어들었을 수 있다.
      if (session !== null) {
        return err({
          code: "conflict",
          message: "OAuth 시작이 이미 진행 중이다",
        });
      }
      state = { kind: "in_progress" };
      session = {
        verifier,
        tokenEndpoint: input.tokenEndpoint,
        clientId: input.clientId,
        stateValue,
        listener: input.listener,
        startedAt: options.nowMs(),
        stop: new AbortController(),
        cancelled: false,
        timedOut: false,
      };
      return ok({ url: url.value, verifier, state: stateValue });
    },
    async complete(input) {
      expire();
      const held = session;
      if (held === null) {
        return err({
          code: "conflict",
          message: "OAuth 시작이 아닌 상태다",
        });
      }
      const ended = new AbortController();
      const merged = AbortSignal.any([input.signal, held.stop.signal]);
      if (options.deadline !== undefined) {
        const remaining = Math.max(
          0,
          waitMs - (options.nowMs() - held.startedAt),
        );
        void options.deadline(remaining, ended.signal).then((how) => {
          if (how === "elapsed" && session === held) timeout(held);
        });
      }
      let received;
      try {
        received = await held.listener.receive(merged);
      } finally {
        ended.abort();
      }
      const cancelled = (): Result<never> =>
        err({ code: "conflict", message: "로그인이 취소됐다" });
      if (held.cancelled) return cancelled();
      if (!received.ok) {
        if (session === held) {
          session = null;
          state = { kind: "failed", reason: "callback_timeout" };
          await held.listener.close();
        }
        return received;
      }
      // 시한이 지난 뒤에 도착한 반환은 받지 않는다.
      if (held.timedOut || session !== held) {
        return err({ code: "unavailable", message: "기다림 시한이 지났다" });
      }
      // state 검증이다(잘못된 반환 검증 값은 거절이다).
      if (received.value.state !== held.stateValue) {
        session = null;
        state = { kind: "failed", reason: "state_mismatch" };
        await held.listener.close();
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
        merged,
      );
      await held.listener.close();
      if (held.cancelled) return cancelled();
      if (session === held) session = null;
      if (!exchanged.ok) {
        state = { kind: "failed", reason: "exchange_failed" };
        return exchanged;
      }
      state = { kind: "not_started" };
      return ok({
        access_token: exchanged.value.access_token,
        refresh_token: exchanged.value.refresh_token,
        expires_at_ms: exchanged.value.expires_in === null
          ? null
          : options.nowMs() + exchanged.value.expires_in * 1000,
        token_endpoint: held.tokenEndpoint,
        client_id: held.clientId,
      });
    },
    async cancel() {
      expire();
      const held = session;
      if (held === null) return false;
      held.cancelled = true;
      held.stop.abort();
      session = null;
      state = { kind: "not_started" };
      await held.listener.close();
      return true;
    },
  };
}
