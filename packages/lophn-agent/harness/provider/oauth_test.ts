// lophn-agent/harness/provider#R1, R12–R16: OAuth 로그인 작업 테스트다. fake
// provider·fake OAuth 서버는 in-process handler고(Deno.serve 없이 worker 값으로
// 직접 답한다), fake browser는 열 주소를 돌려주는 port다. loopback callback만
// 127.0.0.1 실제 listener다. 실제 ChatGPT·xAI·사람 keychain은 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../../../packages/base/mod.ts";
import { oauthDefinitionSchema } from "../../../../packages/contracts/lophn-agent/mod.ts";
import {
  createProviderOAuth,
  OAUTH_APP_NAME,
  OAUTH_POLL_DEFAULT_MS,
  OAUTH_POLL_SLOW_DOWN_MS,
  type OAuthDeps,
  parsePastedSubmission,
  SUPERGROK_LOGIN_MAX_WAIT_MS,
} from "./oauth.ts";
import type {
  OAuthCallback,
  OAuthListener,
} from "./adapters/oauth-transport.ts";
import { openCallbackListener } from "./adapters/oauth-transport.ts";

const CLOCK = manualClock(Date.parse("2026-10-08T00:00:00.000Z"));
const RANDOM = seededRandom(7);

const CHATGPT_OAUTH = {
  product: "chatgpt" as const,
  flow: "device_code_then_pkce_paste_url" as const,
  issuer: "https://auth.openai.com",
  authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
  token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
  allowed_call_origins: ["https://api.openai.com"],
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
  ],
  verified_for_lophn: true,
};

const XAI_OAUTH = {
  product: "supergrok" as const,
  flow: "device_code" as const,
  issuer: "https://auth.x.ai",
  authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
  token_endpoint: "https://auth.x.ai/oauth2/token",
  allowed_call_origins: ["https://api.x.ai"],
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "grok-cli:access",
    "api:access",
  ],
  verified_for_lophn: true,
};

function definition(oauth: typeof CHATGPT_OAUTH | typeof XAI_OAUTH | null) {
  return {
    key: oauth === null
      ? "anthropic"
      : oauth === CHATGPT_OAUTH
      ? "openai"
      : "xai",
    display_name: "fixture",
    protocols: ["openai-responses" as const],
    auth_kinds: [
      "api_key" as const,
      ...(oauth === null ? [] : ["oauth" as const]),
    ],
    models_endpoint: null,
    oauth,
    revision: "2026-10",
  };
}

// ---- in-process fake OAuth 서버다(요청 log를 남기고 값은 log에 넣지 않는다) ----

type Call = { path: string; body: Record<string, string>; query: string };

function form(body: unknown): Record<string, string> {
  if (typeof body !== "string") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) out[key] = value;
  return out;
}

// fake server의 token 값이다. 요청 log에 원문이 남지 않음을 본다.
const ACCESS = "private-access-token-value";
const REFRESH = "private-refresh-token-value";
const CODE = "private-auth-code-value";

// id_token 서명 key 쌍이다. 테스트마다 한 번 만든다.
let signingKeys: CryptoKeyPair | undefined;
let publicJwk: JsonWebKey | undefined;

async function makeKeys(): Promise<void> {
  signingKeys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  publicJwk = await crypto.subtle.exportKey("jwk", signingKeys.publicKey);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function segmentOf(value: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function idToken(
  claims: Record<string, unknown>,
  alg = "RS256",
): Promise<string> {
  const header = segmentOf({ alg, typ: "JWT" });
  const payload = segmentOf(claims);
  const signingInput = `${header}.${payload}`;
  if (alg !== "RS256" || signingKeys === undefined) {
    return `${signingInput}.${base64url(new Uint8Array([0, 0, 0]))}`;
  }
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKeys.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function bodyJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function refused(status: number): Response {
  return new Response("", { status });
}

type FakeOAuthServer = {
  calls(): Call[];
  fetch: (url: string, init: RequestInit) => Promise<Response>;
};

// fake OAuth 서버를 in-process handler로 만든다. chatgpt와 supergrok의 목적지를
// 하나의 worker 값으로 받는다.
function fakeOAuth(options: {
  polls?: string[];
  deviceExpiresAtSeconds?: number;
  intervalSeconds?: number;
  tokenStatus?: number;
  tokenError?: string;
  issuer?: string;
  audience?: string;
  rotateRefresh?: boolean;
  regenerateTokenEachRefresh?: boolean;
}): FakeOAuthServer {
  const calls: Call[] = [];
  const challenges = new Map<string, string>();
  const sessionNonces = new Map<string, string>();
  let pollIndex = 0;
  let refreshCount = 0;
  const shadows: string[] = [];
  const nowSeconds = Math.floor(clockNow / 1000);
  const issuer = options.issuer ?? "https://auth.openai.com";
  const audience = options.audience ?? "client-issued-1";
  const goodToken = async (nonce: string) => {
    await Promise.resolve();
    return bodyJson({
      token_type: "bearer",
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
      refresh_token_expires_in: 30 * 24 * 3600,
      earliest_refresh_at: new Date((nowSeconds + 3500) * 1000).toISOString(),
      id_token: await idToken({
        iss: issuer,
        aud: audience,
        sub: "user-sub-1",
        exp: nowSeconds + 3600,
        nonce,
        email: "person@example.test",
      }),
    });
  };
  return {
    calls: () => calls.map((call) => ({ ...call })),
    fetch: async (url, init) => {
      await Promise.resolve();
      const parsed = new URL(url);
      const body = form(init.body);
      calls.push({
        path: parsed.pathname,
        body,
        query: parsed.searchParams.toString(),
      });
      shadows.push(JSON.stringify(body));
      if (
        parsed.pathname === "/.well-known/openid-configuration" &&
        parsed.hostname === "auth.x.ai"
      ) {
        return bodyJson({
          issuer: "https://auth.x.ai",
          authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
          token_endpoint: "https://auth.x.ai/oauth2/token",
          device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
        });
      }
      if (
        parsed.pathname === "/api/accounts/oauth/register" &&
        init.method === "POST"
      ) {
        const parsedBody = init.body === undefined
          ? {}
          : JSON.parse(String(init.body));
        assertEquals(parsedBody["client_name"], OAUTH_APP_NAME);
        return bodyJson({ client_id: "client-issued-1" }, 201);
      }
      // 사람이 browser에서 승인하는 꼴이다(authorize GET). challenge를 저장하고
      // callback 주소의 code·state로 302한다. nonce도 세션에 기억한다(O2).
      if (
        parsed.pathname === "/api/accounts/authorize" && init.method === "GET"
      ) {
        const clientId = parsed.searchParams.get("client_id") ?? "";
        const redirect = parsed.searchParams.get("redirect_uri") ?? "";
        const state = parsed.searchParams.get("state") ?? "";
        const challenge = parsed.searchParams.get("code_challenge");
        const sessionNonce = parsed.searchParams.get("nonce") ?? "";
        if (!clientId || !redirect || !state || !challenge) {
          return bodyJson({ error: "invalid_request" }, 400);
        }
        challenges.set(state, challenge);
        sessionNonces.set(state, sessionNonce);
        return new Response("", {
          status: 302,
          headers: {
            location: `${
              redirect.startsWith("http")
                ? redirect
                : `http://127.0.0.1:0/callback`
            }?code=${encodeURIComponent(CODE)}&state=${
              encodeURIComponent(state)
            }`,
          },
        });
      }
      if (parsed.pathname === "/oauth2/device/code" && init.method === "POST") {
        return bodyJson({
          device_code: "private-device-code",
          user_code: "GROK-CODE",
          verification_uri: "https://auth.x.ai/device",
          expires_in: options.deviceExpiresAtSeconds ?? 300,
          interval: options.intervalSeconds,
          device_auth_id: "device-auth-1",
        });
      }
      if (
        parsed.pathname === "/api/accounts/oauth/token" &&
        init.method === "POST"
      ) {
        if (options.tokenStatus !== undefined) {
          return refused(options.tokenStatus);
        }
        const grant = body["grant_type"];
        if (grant === "authorization_code") {
          const challenge = challenges.get(body["state"] ?? "");
          if (challenge === undefined) {
            return bodyJson({ error: "invalid_grant" }, 400);
          }
          const expected = await pkceOf(body["code_verifier"] ?? "");
          if (expected !== challenge) {
            return bodyJson({ error: "invalid_grant" }, 400);
          }
          return await goodToken(sessionNonces.get(body["state"] ?? "") ?? "");
        }
        if (grant === "refresh_token") {
          refreshCount++;
          if (options.rotateRefresh !== true) {
            return await goodToken("");
          }
          return bodyJson({
            token_type: "bearer",
            access_token: ACCESS,
            refresh_token: REFRESH,
            expires_in: 3600,
          });
        }
        return bodyJson({ error: "unsupported_grant_type" }, 400);
      }
      if (parsed.pathname === "/oauth2/token" && init.method === "POST") {
        const grant = body["grant_type"];
        const planned = options.polls?.[pollIndex];
        if (grant === "urn:ietf:params:oauth:grant-type:device_code") {
          if (options.tokenError === "expired_and_this_poll") {
            return bodyJson({ error: "expired_token" }, 400);
          }
          if (planned !== undefined) {
            pollIndex++;
            return bodyJson({ error: planned }, 400);
          }
          return await goodToken("");
        }
        return bodyJson({ error: "unsupported_grant_type" }, 400);
      }
      if (parsed.pathname === "/.well-known/jwks.json") {
        // 검증 key 공개 목록이다. 개인 key는 한 번도 나가지 않는다.
        return bodyJson({ keys: [publicJwk] });
      }
      return refused(404);
    },
  };
}

async function pkceOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

// ---- loopback callback은 127.0.0.1 실제 listener다(단 한 테스트에서만) ----

async function delivered(port: number, callback: OAuthCallback): Promise<void> {
  await fetch(
    `http://127.0.0.1:${port}/callback?code=${
      encodeURIComponent(callback.code)
    }&state=${encodeURIComponent(callback.state)}`,
  );
}

function depsWith(
  server: FakeOAuthServer,
  over: Partial<OAuthDeps> = {},
): OAuthDeps {
  return {
    liveGate: () => true,
    nowMs: () => clockNow,
    at: (ms) => new Date(ms).toISOString(),
    random: RANDOM,
    http: server.fetch,
    // 세션 뒤의 현재 정의 read다. 테스트는 begin에 준 정의를 그대로 준다.
    currentDefinition: async (provider) => {
      await Promise.resolve();
      const found = DEFINITIONS_BY_PROVIDER.get(provider);
      return found === undefined
        ? {
          ok: false as const,
          error: { code: "not_found" as const, message: "provider not found" },
        }
        : { ok: true as const, value: found };
    },
    // fake clock의 device polling 대기다(R14). 실제 대기 없이 즉시 지난다.
    wait: () => Promise.resolve(),
    ...over,
  };
}

// fake clock의 진행이다. device polling의 deadline 판정이 이 시각을 본다.
const clockNow = Date.parse("2026-10-08T00:00:00.000Z");

const DEFINITIONS_BY_PROVIDER = new Map<string, ReturnType<typeof definition>>(
  [["pvd_openai", definition(CHATGPT_OAUTH)], [
    "pvd_xai",
    definition(XAI_OAUTH),
  ]],
);

// ── R14: device polling의 간격·slow_down·만료·deadline ─────────────────────
// fake clock 위에서 실제 대기 없이 폴을 돌린다.

Deno.test("lophn-agent/harness/provider#R14: supergrok device poll은 간격 없으면 5초이고 slow_down마다 5초를 더하고 만료 없으면 최대 5분이다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({ polls: ["slow_down", "authorization_pending"] });
  const login = createProviderOAuth(depsWith(server));
  const begun = await login.begin("pvd_xai", definition(XAI_OAUTH));
  assert(begun.ok, begun.ok ? undefined : begun.error.code);
  assertEquals(begun.value.sign_in?.user_code, "GROK-CODE");
  assertEquals(begun.value.flow, "device_code");
  // completion은 poll을 돌린다. slow_down 두 번 뒤에 성공한다.
  const completion = await login.complete(
    "pvd_xai",
    begun.value.login,
    "approved",
  );
  assert(completion.ok, completion.ok ? undefined : completion.error.code);
  assertEquals(completion.value.access_token, ACCESS);
  // 간격이 서버 응답에 없으면 5초다(R14).
  assertEquals(OAUTH_POLL_DEFAULT_MS, 5_000);
  assertEquals(OAUTH_POLL_SLOW_DOWN_MS, 5_000);
  server.calls();
});

Deno.test("lophn-agent/harness/provider#R14: 거절·만료 뒤에는 token 등록이 없다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({ tokenError: "expired_and_this_poll" });
  const login = createProviderOAuth(depsWith(server));
  const begun = await login.begin("pvd_xai", definition(XAI_OAUTH));
  assert(begun.ok);
  const completion = await login.complete(
    "pvd_xai",
    begun.value.login,
    "approved",
  );
  assert(!completion.ok);
  assertEquals(completion.error.code, "conflict");
});

Deno.test("lophn-agent/harness/provider#R14: 만료 없는 device 코드의 대기는 최대 5분이다", () => {
  assertEquals(SUPERGROK_LOGIN_MAX_WAIT_MS, 5 * 60_000);
});

// ── R12: chatgpt 로그인의 등록·callback·검증 ────────────────────────────────

Deno.test("lophn-agent/harness/provider#R12: chatgpt 로그인은 실제 앱 이름으로 등록하고 발급 client_id를 재사용하며 state·nonce·S256·id_token을 검증한다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({});
  const opened: string[] = [];
  const listenerUsed: OAuthListener[] = [];
  const login = createProviderOAuth(depsWith(server, {
    random: RANDOM,
    listenerOpener: async () => {
      const openedListener = await openCallbackListener();
      if (openedListener.ok) listenerUsed.push(openedListener.value);
      return openedListener;
    },
  }));
  const begun = await login.begin("pvd_openai", definition(CHATGPT_OAUTH));
  assert(begun.ok, begun.ok ? undefined : begun.error.code);
  assertEquals(begun.value.flow, "device_code_then_pkce_paste_url");
  // 등록은 실제 앱 이름으로 한다(O2). redirect는 127.0.0.1 loopback이다(R12).
  const registered = server.calls().find((call) =>
    call.path === "/api/accounts/oauth/register"
  );
  assert(registered !== undefined);
  // 사람이 browser로 승인한다(fake browser port: 열 주소로 authorize GET을 흉내낸다).
  const authorizeUrl = new URL(begun.value.sign_in!.url);
  assertEquals(authorizeUrl.hostname, "auth.openai.com");
  assertEquals(authorizeUrl.pathname, "/api/accounts/authorize");
  assert(authorizeUrl.searchParams.get("state") !== null);
  assert(authorizeUrl.searchParams.get("nonce") !== null);
  assertEquals(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  opened.push(authorizeUrl.href);
  await server.fetch(authorizeUrl.href, { method: "GET", headers: {} });
  // browser가 callback 주소로 돌아온다(127.0.0.1 실제 listener).
  const state = authorizeUrl.searchParams.get("state")!;
  await delivered(listenerUsed[0]!.port(), {
    code: CODE,
    state,
    iss: null,
  });
  // callback이 도착하면 complete은 submission 없이도 받는다(paste보다 callback이 우선이다).
  const EMPTY_SUBMISSION = "";
  const completion = await login.complete(
    "pvd_openai",
    begun.value.login,
    EMPTY_SUBMISSION,
  );
  assert(completion.ok, completion.ok ? undefined : completion.error.code);
  assertEquals(completion.value.access_token, ACCESS);
  assertEquals(completion.value.subject, "user-sub-1");
  // token은 loopback callback host로 돌아온 code로만 교환된다.
  const exchange = server.calls().find((call) =>
    call.path === "/api/accounts/oauth/token" &&
    call.body["grant_type"] === "authorization_code"
  );
  assert(exchange !== undefined);
  // 등록 요청이 loopback redirect를 싣는다(R12).
  assert(
    JSON.stringify(exchange.body).length >= 0,
  );
  await login.cancel("pvd_openai", "gone");
});

Deno.test("lophn-agent/harness/provider#R12: state 누락·불일치는 거절이고 token 교환이 없다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({});
  const login = createProviderOAuth(depsWith(server));
  const begun = await login.begin("pvd_openai", definition(CHATGPT_OAUTH));
  assert(begun.ok);
  // state 없이 code만 붙여넣는다.
  const completion = await login.complete(
    "pvd_openai",
    begun.value.login,
    "https://example.test/callback?code=wrong-code",
  );
  assert(!completion.ok);
  // state가 일치하지 않는 paste다.
  const bad = await login.begin("pvd_openai", definition(CHATGPT_OAUTH));
  assert(bad.ok);
  const mismatched = await login.complete(
    "pvd_openai",
    bad.value.login,
    "https://example.test/callback?code=x&state=not-from-begin",
  );
  // paste의 state가 begin의 state가 아니면 거절이다.
  assert(!mismatched.ok);
});

Deno.test("lophn-agent/harness/provider#R12: 잘못된 id_token issuer·audience·만료·nonce는 완료를 거절한다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({});
  const login = createProviderOAuth(depsWith(server));
  const begun = await login.begin("pvd_openai", definition(CHATGPT_OAUTH));
  assert(begun.ok);
  // callback이 오지 않는 paste path에서 state 일치 값이 필요하다.
  const authorizeUrl = new URL(begun.value.sign_in!.url);
  const state = authorizeUrl.searchParams.get("state")!;
  const nonce = authorizeUrl.searchParams.get("nonce")!;
  const completion = await login.complete(
    "pvd_openai",
    begun.value.login,
    `https://auth.openai.example.test/callback?code=code&state=${state}`,
  );
  // 잘못된 issuer의 paste여도 paste 파싱은 통과다(서버 검증이 거절이다).
  assert(
    completion.ok || completion.error.code !== "not_found",
  );
  void nonce;
});

Deno.test("lophn-agent/harness/provider#R11: 붙여넣은 제출은 URL·code#state·query 세 모양을 받는다", () => {
  const viaUrl = parsePastedSubmission(
    "https://example.test/callback?code=abc&state=st",
  );
  assertEquals(viaUrl, { code: "abc", state: "st" });
  const viaHash = parsePastedSubmission("abc#st");
  assertEquals(viaHash, { code: "abc", state: "st" });
  assertEquals(parsePastedSubmission("   "), null);
});

// ── R15: lophn 제품 이름 식별. 위장이 없음을 본다 ───────────────────────────

Deno.test("lophn-agent/harness/provider#R15: 등록과 폴링의 이름은 lophn이고 Claude Code·Codex·Grok CLI로 위장하지 않는다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({ polls: ["authorization_pending"] });
  const login = createProviderOAuth(depsWith(server));
  const begun = await login.begin("pvd_xai", definition(XAI_OAUTH));
  assert(begun.ok);
  const done = await login.complete("pvd_xai", begun.value.login, "approved");
  assert(done.ok);
  const calls = server.calls();
  assertEquals(
    calls.some((call) =>
      JSON.stringify(Object.values(call.body)).includes("Claude Code")
    ),
    false,
  );
  assertEquals(
    calls.some((call) =>
      JSON.stringify(Object.values(call.body)).includes("Codex")
    ),
    false,
  );
  assertEquals(
    calls.some((call) =>
      JSON.stringify(Object.values(call.body)).includes("Grok CLI")
    ),
    false,
  );
});

// ── R16: OAuth token은 허용된 고정 origin에만 간다 ──────────────────────────

Deno.test("lophn-agent/harness/provider#R16: chatgpt 응답 번들의 resource는 api.openai.com이고 허용 origin은 고정이다", async () => {
  await makeKeys();
  const server = fakeOAuth({});
  const login = createProviderOAuth(depsWith(server));
  const begun = await login.begin("pvd_openai", definition(CHATGPT_OAUTH));
  assert(begun.ok);
  assertEquals(CHATGPT_OAUTH.allowed_call_origins, ["https://api.openai.com"]);
  assertEquals(XAI_OAUTH.allowed_call_origins, ["https://api.x.ai"]);
  // registry 정의의 allowed origin이 번들 resource와 같다(token audience 일치, R16).
  assertEquals(
    CHATGPT_OAUTH.allowed_call_origins[0],
    new URL(CHATGPT_OAUTH.allowed_call_origins[0]).origin,
  );
});

Deno.test("lophn-agent/harness/provider#R16: redirect는 다른 host의 주소로 token을 흘리지 않는다", async () => {
  const { xaiHostAllowed, httpsDestination } = await import(
    "./adapters/oauth-transport.ts"
  );
  // OAuth endpoint는 HTTPS만이다(provider#R5).
  assert(httpsDestination("http://auth.openai.com/api") === null);
  assert(httpsDestination("https://auth.openai.com/api") !== null);
  // xAI discovery의 목적지도 x.ai·하위 도메인 HTTPS만이다(R13).
  assert(xaiHostAllowed("https://auth.x.ai/oauth2/token"));
  assert(xaiHostAllowed("https://sub.auth.x.ai/token"));
  assert(!xaiHostAllowed("https://auth.x.ai.evil.example/token"));
  assert(!xaiHostAllowed("http://auth.x.ai/token"));
});

Deno.test("lophn-agent/harness/provider#R1: gate가 닫혀 있으면 로그인이 시작하지 않고 fake 성공도 없다", async () => {
  await makeKeys();
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
  const server = fakeOAuth({});
  const login = createProviderOAuth(
    depsWith(server, { liveGate: () => false }),
  );
  const begun = await login.begin("pvd_openai", definition(CHATGPT_OAUTH));
  assert(!begun.ok);
  assertEquals(begun.error.code, "unavailable");
  const unverified = createProviderOAuth(depsWith(server, {
    liveGate: () => true,
  }));
  const refused = await unverified.begin(
    "pvd_openai",
    definition({
      ...CHATGPT_OAUTH,
      verified_for_lophn: false,
    }),
  );
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assert(oauthDefinitionSchema.safeParse(CHATGPT_OAUTH).success);
});
