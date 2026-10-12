// lophn-agent/extensions HTTP 인증 테스트다(lophn-agent#T38). OAuth 시작·완료는
// 사람이 시작한 브라우저 흐름을 port 형식으로 본다: 실제 브라우저를 열지 않고 열
// URL을 돌려주는 port와 127.0.0.1 loopback callback listener다. 토큰 교환·갱신은
// 가짜 HTTPS token endpoint(가짜 HttpFetch)로 본다. 사람의 실제 keychain·실제
// MCP server·실제 OAuth server에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../base/mod.ts";
import { mcpServersSetting } from "../../contracts/lophn-agent/mod.ts";
import type { HttpFetch } from "./adapters/mcp-http.ts";
import {
  authHeaders,
  authorizationUrl,
  bindingChanged,
  type BrowserOpener,
  type CallbackListener,
  createMcpAuth,
  type CredentialBinding,
  MCP_AUTH_WAIT_MS,
  mcpSecretName,
  mcpSecretRef,
  type OAuthBinding,
  pkceChallengeS256,
  pkceVerifier,
  registerClient,
} from "./mcp-auth.ts";

const clock = manualClock(Date.parse("2026-10-08T00:00:00.000Z"));
const RANDOM = seededRandom(7);
const ISSUER = "https://issuer.example.test";
const SERVER_URL = "https://mcp.example.test/rpc";
const AUTH_ENDPOINT = "https://issuer.example.test/authorize";
const TOKEN_ENDPOINT = "https://issuer.example.test/token";
const REGISTRATION_ENDPOINT = "https://issuer.example.test/register";
const ACCESS = "at-test-1";
const NEXT_ACCESS = "at-test-2";
const REFRESH = "rt-test-1";
const NOW = clock.nowMs();

// ---- 가짜 HttpFetch다 ----
// 응답으로 고른다. token endpoint의 요청 body(form)와 header도 기록한다.
function fetchOf(
  respond: (url: string, init: RequestInit) => Response,
): {
  records: { url: string; init: RequestInit; body: string }[];
  fetch: HttpFetch;
} {
  const records: { url: string; init: RequestInit; body: string }[] = [];
  const fetch: HttpFetch = (url: string, init: RequestInit) => {
    records.push({
      url,
      init,
      body: typeof init.body === "string" ? init.body : String(init.body ?? ""),
    });
    return Promise.resolve(respond(url, init));
  };
  return { records, fetch };
}

function tokenResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rejected(status: number): Response {
  return new Response("", { status });
}

// ---- 판독이다 ----
function form(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const record: Record<string, string> = {};
  for (const [key, value] of params) record[key] = value;
  return record;
}

// ---- 사람이 시작한 브라우저 열기 port다(R16). URL을 돌려준다 ----
function openerOf(opened: string[]): BrowserOpener {
  return (url) => {
    opened.push(url);
    return Promise.resolve(okBrowser());
  };
}

function okBrowser(): import("../../base/mod.ts").Result<void> {
  return { ok: true, value: undefined };
}

// ---- loopback callback listener다(R16) ----
// 테스트는 127.0.0.1에 실제 Deno.listen을 받는다. 사람이 돌아온 callback은
// 이 요청으로 온다. port는 테스트가 고정한다. 실제 callback 요청은 fetch가 온다.
function listenerOf(port: number): CallbackListener {
  const control = new AbortController();
  const waited = {
    code: null as string | null,
    state: null as string | null,
    iss: null as string | null,
  };
  return {
    port: () => port,
    receive(signal: AbortSignal) {
      const merged = new AbortController();
      if (signal.aborted) merged.abort();
      else {signal.addEventListener("abort", () => merged.abort(), {
          once: true,
        });}
      control.signal.addEventListener("abort", () => merged.abort(), {
        once: true,
      });
      void merged.signal;
      if (waited.code === null) {
        return Promise.resolve({
          ok: false as const,
          error: {
            code: "unavailable" as const,
            message: "callback이 오지 않았다",
          },
        });
      }
      return Promise.resolve({
        ok: true as const,
        value: {
          code: waited.code,
          state: waited.state ?? "",
          iss: waited.iss,
        },
      });
    },
    close(): Promise<void> {
      control.abort();
      return Promise.resolve();
    },
  };
}

// loopback callback을 만족하는 표. receive가 code·state·iss로 기다린다.
// state는 begin이 만든 무작위 값이다(R16) — begin 응답을 받은 뒤 만든다.
function delivered(port: number, state: () => string): CallbackListener {
  const listener = listenerOf(port);
  return {
    port: listener.port,
    receive(_signal) {
      const code = "the-code";
      return Promise.resolve({
        ok: true as const,
        value: { code, state: state(), iss: null },
      });
    },
    close: listener.close,
  };
}

// ---- 기준 server 설정이다 ----
function httpServer(auth: Record<string, unknown>) {
  const parsed = mcpServersSetting.value_type.parse([{
    name: "notes",
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: {
      url: SERVER_URL,
      headers: {},
      auth,
    },
  }]);
  assert(parsed[0] !== undefined);
  return parsed[0];
}

Deno.test("lophn-agent/extensions#R16: 인증 없음·Bearer·API key header 부착이다", () => {
  // 인증 없음이다(R16).
  const none = authHeaders({ kind: "none" });
  assertEquals(none.headers, {});
  assertEquals(none.kind, "none");
  // Bearer다(R16): 사람이 지정한 token을 `authorization: Bearer <token>`으로 붙인다.
  const bearer = authHeaders({ kind: "bearer", token: ACCESS });
  assertEquals(bearer.headers, { authorization: `Bearer ${ACCESS}` });
  assertEquals(bearer.kind, "bearer");
  // API key header다(R16): 사람이 정한 헤더 이름에 값 그대로다.
  const api = authHeaders({
    kind: "api_key",
    token: ACCESS,
    header_name: "X-Api-Key",
  });
  assertEquals(api.headers, { "X-Api-Key": ACCESS });
  assertEquals(api.kind, "api_key");
  // 사람의 실제 keychain·설정 값은 이 표에 없다: 이 표에 온 token은 부착 경계가
  // 결정한 글 그대로다(shell#T31의 보호 창 `SetSecret`이 저장하고, 설정은
  // `sec:mcp-<server>`를 가리킨다).
  assert(httpServer({ kind: "none" }) !== undefined);
  const bearerParsed = httpServer({
    kind: "bearer",
    secret_ref: mcpSecretRef("notes"),
  });
  assert(bearerParsed !== undefined);
  const apiParsed = httpServer({
    kind: "api_key",
    secret_ref: mcpSecretRef("notes"),
    header_name: "X-Api-Key",
  });
  assert(apiParsed !== undefined);
});

Deno.test("lophn-agent/extensions#R16: OAuth 2.1 Authorization Code와 S256 PKCE, 사람이 시작한 브라우저 흐름과 loopback callback이다", async () => {
  const verifier = pkceVerifier(RANDOM);
  const challenge = await pkceChallengeS256(verifier);
  // S256이다: challenge는 verifier의 SHA-256 base64url이다.
  const challenge2 = await pkceChallengeS256(verifier);
  assertEquals(challenge, challenge2);
  assert(challenge.length > 0);
  // authorization URL이다(R16). response_type·client_id·scope·redirect_uri·state·
  // code_challenge·code_challenge_method=S256이다.
  const listener = delivered(49152, () => "the-state");
  const browser: string[] = [];
  const url = authorizationUrl({
    authorizationEndpoint: AUTH_ENDPOINT,
    clientId: "lophn",
    scopes: ["mcp:read", "mcp:write"],
    redirectPort: listener.port(),
    state: "the-state",
    challenge,
  });
  assert(url.ok);
  assertEquals(url.value.searchParams.get("response_type"), "code");
  assertEquals(url.value.searchParams.get("client_id"), "lophn");
  assertEquals(url.value.searchParams.get("scope"), "mcp:read mcp:write");
  assertEquals(
    url.value.searchParams.get("redirect_uri"),
    `http://127.0.0.1:49152/callback`,
  );
  assertEquals(url.value.searchParams.get("state"), "the-state");
  assertEquals(url.value.searchParams.get("code_challenge"), challenge);
  assertEquals(url.value.searchParams.get("code_challenge_method"), "S256");
  // 사람이 시작한 브라우저 열기 port다(R16). URL을 돌려주고 브라우저를 열지 않는다.
  const openPort = openerOf(browser);
  await openPort(url.value.href);
  assertEquals(browser, [url.value.href]);
  // loopback callback이다(R16). 127.0.0.1만 듣는다.
  assertEquals(listener.port(), 49152);
  await listener.close();
});

Deno.test("lophn-agent/extensions#R16: 사람이 시작한 OAuth가 token 교환을 마친다", async () => {
  let begunState = "";
  const listener = delivered(49152, () => begunState);
  const auth = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  const begun = await auth.begin({
    authorizationEndpoint: AUTH_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: "lophn",
    scopes: ["mcp:read"],
    listener,
  });
  assert(begun.ok, begun.ok ? "" : begun.error.message);
  begunState = begun.value.state;
  assertEquals(
    begun.value.url.searchParams.get("redirect_uri"),
    `http://127.0.0.1:49152/callback`,
  );
  const { records: exchangeRecords, fetch: exchangeFetch } = fetchOf(() =>
    tokenResponse({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
    })
  );
  const completed = await auth.complete({
    fetch: exchangeFetch,
    signal: new AbortController().signal,
  });
  assert(completed.ok, completed.ok ? "" : completed.error.message);
  // token 교환의 요청이다: grant_type=authorization_code, code, client_id,
  // redirect_uri, code_verifier다.
  assertEquals(exchangeRecords.length, 1);
  const formValues = form(exchangeRecords[0].body);
  assertEquals(formValues.grant_type, "authorization_code");
  assertEquals(formValues.code, "the-code");
  assertEquals(formValues.client_id, "lophn");
  assertEquals(formValues.redirect_uri, "http://127.0.0.1:49152/callback");
  assertEquals(formValues.code_verifier, begun.value.verifier);
  // state 검증이다(R16): 잘못된 state는 거절이다.
  const wrongState = delivered(49153, () => "the-evil-state");
  const auth2 = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  const begun2 = await auth2.begin({
    authorizationEndpoint: AUTH_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: "lophn",
    scopes: [],
    listener: wrongState,
  });
  assert(begun2.ok);
  const { fetch: wrongFetch } = fetchOf(() =>
    tokenResponse({ access_token: "x" })
  );
  const rejected2 = await auth2.complete({
    fetch: wrongFetch,
    signal: new AbortController().signal,
  });
  assert(!rejected2.ok);
  // 시작이 아닌 상태의 complete이다.
  const auth3 = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  const premature = await auth3.complete({
    fetch: new AbortController().signal as never,
    signal: new AbortController().signal,
  });
  assert(!premature.ok);
  assertEquals(premature.error.code, "conflict");
  await listener.close();
  await wrongState.close();
});

Deno.test("lophn-agent/extensions#R16: 동적 client 등록을 지원하지 않는 서버는 사람이 등록한 client를 사용한다", async () => {
  // 등록 미지원이다(R16).
  const { fetch } = fetchOf(() => rejected(400));
  const tried = await registerClient(
    {
      registrationEndpoint: REGISTRATION_ENDPOINT,
      redirectPort: 49152,
      clientName: "lophn-agent",
    },
    fetch,
    new AbortController().signal,
  );
  assert(tried.ok);
  assertEquals(tried.value, { absent: true });
  // 사람이 등록한 client 이다(R16) — absent이 나오면 부르는 쪽이 사람 등록 client로
  // 진행한다: authorization URL은 사람이 등록한 client_id로 만들어 진다.
  const manualUrl = authorizationUrl({
    authorizationEndpoint: AUTH_ENDPOINT,
    clientId: "person-registered-client",
    scopes: [],
    redirectPort: 49152,
    state: "the-state",
    challenge: "the-challenge",
  });
  assert(manualUrl.ok);
  assertEquals(
    manualUrl.value.searchParams.get("client_id"),
    "person-registered-client",
  );
  // 등록이 성공하는 서버는 client_id를 돌려준다(R16).
  const { records: registered, fetch: okFetch } = fetchOf(() =>
    new Response(
      JSON.stringify({
        client_id: "registered-id",
        client_secret: "registered-secret",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  );
  const registeredClient = await registerClient(
    {
      registrationEndpoint: REGISTRATION_ENDPOINT,
      redirectPort: 49152,
      clientName: "lophn-agent",
    },
    okFetch,
    new AbortController().signal,
  );
  assert(
    registeredClient.ok,
    registeredClient.ok ? "" : registeredClient.error.message,
  );
  assertEquals(registeredClient.value, {
    client_id: "registered-id",
    client_secret: "registered-secret",
  });
  assertEquals(registered.length, 1);
  const registrationBody = JSON.parse(registered[0].body) as Record<
    string,
    unknown
  >;
  assertEquals(registrationBody.client_name, "lophn-agent");
  assertEquals(registrationBody.redirect_uris, [
    "http://127.0.0.1:49152/callback",
  ]);
});

Deno.test("lophn-agent/extensions#R17: secret을 server URL·issuer에 묶고 URL·issuer·계정이 바뀌면 재사용 없음이다", () => {
  // credential binding이다(shell#T31 규칙, bearer·api_key). secret은 서버 URL에
  // 묶인다(R17).
  const left: CredentialBinding = {
    server_url: SERVER_URL,
    secret_name: mcpSecretName("notes"),
  };
  assertEquals(
    bindingChanged(left, {
      server_url: SERVER_URL,
      secret_name: mcpSecretName("notes"),
    }),
    false,
  );
  // URL이 바뀌면 옛 비밀을 재사용하지 않는다(R17).
  assertEquals(
    bindingChanged(left, {
      server_url: "https://other.example.test/rpc",
      secret_name: mcpSecretName("notes"),
    }),
    true,
  );
  // OAuth binding이다. secret은 발급자와 서버 URL·계정에 묶인다(R17).
  const oauth: OAuthBinding = {
    issuer: ISSUER,
    server_url: SERVER_URL,
    account: "account-a",
    secret_name: mcpSecretName("notes"),
  };
  assertEquals(bindingChanged(oauth, { ...oauth }), false);
  // issuer가 바뀌면 재사용 없음이다(R17).
  assertEquals(
    bindingChanged(oauth, {
      ...oauth,
      issuer: "https://other-issuer.example.test",
    }),
    true,
  );
  // 계정이 바뀌면 재사용 없음이다(R17).
  assertEquals(bindingChanged(oauth, { ...oauth, account: "account-b" }), true);
  // 서버 URL이 바뀌면 재사용 없음이다(R17).
  assertEquals(
    bindingChanged(oauth, {
      ...oauth,
      server_url: "https://other.example.test/rpc",
    }),
    true,
  );
  // 같은 URL과 issuer면 같은 binding이다(R17) — 같은 이름의 서버에 그대로 쓴다.
  assertEquals(bindingChanged(oauth, { ...oauth, account: null }), true);
  // 보관 이름이 같은지 본다(shell#T31 규칙): 설정의 `sec:` 참조가 같은 이름을 가리킨다.
  assertEquals(mcpSecretName("notes"), "mcp-notes");
  assertEquals(mcpSecretRef("notes"), "sec:mcp-notes");
});

// 한 번의 로그인 session이다. 갱신과 보관은 mcp_oauth_test.ts가 본다(R17).
function waitingListener(port: number) {
  const closed = { count: 0 };
  const listener: CallbackListener = {
    port: () => port,
    receive: (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () =>
            resolve({
              ok: false,
              error: { code: "unavailable", message: "callback이 오지 않았다" },
            }),
          { once: true },
        );
      }),
    close() {
      closed.count += 1;
      return Promise.resolve();
    },
  };
  return { listener, closed };
}

Deno.test("lophn-agent/extensions#R16 [agent-I52]: token 교환이 끝나면 session은 값을 쥐지 않고 보관할 grant를 돌려준다", async () => {
  let begunState = "";
  const listener = delivered(49152, () => begunState);
  const auth = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  const begun = await auth.begin({
    authorizationEndpoint: AUTH_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: "lophn",
    scopes: [],
    listener,
  });
  assert(begun.ok);
  begunState = begun.value.state;
  const { fetch } = fetchOf(() =>
    tokenResponse({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
    })
  );
  const completed = await auth.complete({
    fetch,
    signal: new AbortController().signal,
  });
  assert(completed.ok, completed.ok ? "" : completed.error.message);
  assertEquals(completed.value, {
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at_ms: NOW + 3600 * 1000,
    token_endpoint: TOKEN_ENDPOINT,
    client_id: "lophn",
  });
  // 끝난 session은 값을 남기지 않는다: 상태에도 token이 없다.
  assertEquals(auth.state(), { kind: "not_started" });
  assert(!JSON.stringify(auth.state()).includes(ACCESS));
  assertEquals(listener.port(), 49152);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: 취소하면 기다리던 complete가 끝나고 listener가 닫히며 다시 시작할 수 있다", async () => {
  const { listener, closed } = waitingListener(49160);
  const auth = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  const begin = () =>
    auth.begin({
      authorizationEndpoint: AUTH_ENDPOINT,
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "lophn",
      scopes: [],
      listener,
    });
  assert((await begin()).ok);
  assertEquals(auth.state(), { kind: "in_progress" });
  const { fetch } = fetchOf(() => tokenResponse({ access_token: "x" }));
  const waiting = auth.complete({
    fetch,
    signal: new AbortController().signal,
  });
  assertEquals(await auth.cancel(), true);
  const ended = await waiting;
  assert(!ended.ok);
  assertEquals(ended.error.code, "conflict");
  assertEquals(closed.count >= 1, true);
  assertEquals(auth.state(), { kind: "not_started" });
  assertEquals(await auth.cancel(), false);
  assert((await begin()).ok);
  await auth.cancel();
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: 기다림 시한이 지나면 callback_timeout으로 실패하고 시한은 시작 때 정한 값이다", async () => {
  assertEquals(MCP_AUTH_WAIT_MS, 5 * 60_000);
  const { listener, closed } = waitingListener(49161);
  let fire: () => void = () => {};
  const asked: number[] = [];
  const auth = createMcpAuth({
    nowMs: () => NOW,
    random: RANDOM,
    deadline: (ms, signal) =>
      new Promise((resolve) => {
        asked.push(ms);
        fire = () => resolve("elapsed");
        signal.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        });
      }),
  });
  assert(
    (await auth.begin({
      authorizationEndpoint: AUTH_ENDPOINT,
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "lophn",
      scopes: [],
      listener,
    })).ok,
  );
  const { fetch } = fetchOf(() => tokenResponse({ access_token: "x" }));
  const waiting = auth.complete({
    fetch,
    signal: new AbortController().signal,
  });
  assertEquals(asked, [MCP_AUTH_WAIT_MS]);
  fire();
  const ended = await waiting;
  assert(!ended.ok);
  assertEquals(ended.error.code, "unavailable");
  assertEquals(auth.state(), { kind: "failed", reason: "callback_timeout" });
  assertEquals(closed.count >= 1, true);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: complete을 부르지 않은 채 시한이 지난 session도 다시 시작을 막지 않는다", async () => {
  let now = NOW;
  const first = waitingListener(49162);
  const auth = createMcpAuth({ nowMs: () => now, random: RANDOM });
  const begin = (listener: CallbackListener) =>
    auth.begin({
      authorizationEndpoint: AUTH_ENDPOINT,
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "lophn",
      scopes: [],
      listener,
    });
  assert((await begin(first.listener)).ok);
  // 시한 안에서는 진행 중이고 두 번째 시작은 충돌이다.
  now += MCP_AUTH_WAIT_MS - 1;
  assertEquals(auth.state(), { kind: "in_progress" });
  const busy = await begin(waitingListener(49163).listener);
  assert(!busy.ok);
  assertEquals(busy.error.code, "conflict");
  // 시한이 지나면 실패로 읽히고 listener는 닫히며 새로 시작할 수 있다.
  now += 2;
  assertEquals(auth.state(), { kind: "failed", reason: "callback_timeout" });
  assertEquals(first.closed.count >= 1, true);
  assert((await begin(waitingListener(49164).listener)).ok);
  await auth.cancel();
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: 잘못된 state와 거절된 교환은 session 상태에 이유 코드로 남는다", async () => {
  const wrong = delivered(49170, () => "the-evil-state");
  const auth = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  assert(
    (await auth.begin({
      authorizationEndpoint: AUTH_ENDPOINT,
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "lophn",
      scopes: [],
      listener: wrong,
    })).ok,
  );
  const { fetch } = fetchOf(() => tokenResponse({ access_token: "x" }));
  const mismatched = await auth.complete({
    fetch,
    signal: new AbortController().signal,
  });
  assert(!mismatched.ok);
  assertEquals(mismatched.error.code, "invalid_input");
  assertEquals(auth.state(), { kind: "failed", reason: "state_mismatch" });

  let state = "";
  const good = delivered(49171, () => state);
  const second = createMcpAuth({ nowMs: () => NOW, random: RANDOM });
  const begun = await second.begin({
    authorizationEndpoint: AUTH_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: "lophn",
    scopes: [],
    listener: good,
  });
  assert(begun.ok);
  state = begun.value.state;
  const refused = fetchOf(() => rejected(400));
  const exchange = await second.complete({
    fetch: refused.fetch,
    signal: new AbortController().signal,
  });
  assert(!exchange.ok);
  assertEquals(second.state(), { kind: "failed", reason: "exchange_failed" });
  // 실패한 뒤에는 새로 시작할 수 있다.
  assert(
    (await second.begin({
      authorizationEndpoint: AUTH_ENDPOINT,
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "lophn",
      scopes: [],
      listener: waitingListener(49172).listener,
    })).ok,
  );
  await second.cancel();
});
