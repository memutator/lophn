// lophn-agent/extensions#R16 #R17 [agent-I52]: MCP OAuth를 처음부터 끝까지 이어 주는 서비스다. 사람이 시작한 로그인(PKCE·
// loopback), 기다림 시한과 취소, token 교환, keychain 보관, 설정 연결, 상태 보고, 연결 때의 갱신(한 번에 하나)을 본다.
// 발급자는 가짜 HttpFetch이고 keychain은 시험용이다. 사람의 실제 keychain·브라우저·OAuth server에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { HttpFetch } from "./adapters/mcp-http.ts";
import type { CallbackListener } from "./mcp-auth.ts";
import { MCP_AUTH_WAIT_MS } from "./mcp-auth.ts";
import {
  createMcpOAuth,
  type McpAuthReport,
  type McpOAuthServer,
  REFRESH_SKEW_MS,
} from "./mcp-oauth.ts";
import {
  createMcpOAuthVault,
  mcpTokenRef,
  type McpVaultKeychain,
} from "./mcp-oauth-vault.ts";
import { fakeVaultKeychain } from "./testing/mod.ts";
import { pkceChallengeS256 } from "./mcp-auth.ts";

const ISSUER = "https://issuer.example.test";
const SERVER_URL = "https://mcp.example.test/rpc";
const KEY = { place: null, name: "notes" } as const;
const PROJECT_KEY = {
  place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fa1" },
  name: "notes",
} as const;

const ACCESS_ONE = "access-one-teal-orchard";
const REFRESH_ONE = "refresh-one-saffron-meadow";
const ACCESS_TWO = "access-two-amber-canyon";
const REFRESH_TWO = "refresh-two-plum-willow";

function serverOf(overrides: Partial<McpOAuthServer> = {}): McpOAuthServer {
  return {
    key: KEY,
    issuer: ISSUER,
    serverUrl: SERVER_URL,
    clientId: "lophn",
    tokenRef: mcpTokenRef(KEY),
    ...overrides,
  };
}

// 연결 전(token 참조를 아직 설정에 쓰지 않은) 서버다.
const unlinked = () => serverOf({ tokenRef: null });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Seen = { url: string; form: Record<string, string> };

function issuerOf(
  answer: (seen: Seen) => Response | Promise<Response>,
): { fetch: HttpFetch; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      const record: Seen = {
        url,
        form: Object.fromEntries(
          new URLSearchParams(String(init.body ?? "")).entries(),
        ),
      };
      seen.push(record);
      return await answer(record);
    },
  };
}

// 사람이 browser에서 돌아오는 것을 시험이 정한다. 받기는 deliver를 기다리고 취소 신호로 끝난다.
type FakeListener = CallbackListener & {
  deliver(code: string, state: string): void;
  closed: number;
};

function listenerOf(port = 49152): FakeListener {
  let arrive: (value: { code: string; state: string }) => void = () => {};
  const arrived = new Promise<{ code: string; state: string }>((resolve) => {
    arrive = resolve;
  });
  const listener: FakeListener = {
    closed: 0,
    port: () => port,
    receive(signal) {
      return new Promise((resolve) => {
        const abort = () =>
          resolve(
            err({ code: "unavailable", message: "callback이 오지 않았다" }),
          );
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        void arrived.then((value) => resolve(ok({ ...value, iss: null })));
      });
    },
    close() {
      listener.closed += 1;
      return Promise.resolve();
    },
    deliver: (code, state) => arrive({ code, state }),
  };
  return listener;
}

// 기다림 시한은 시험이 흘린다.
function deadlines() {
  const waiting: { ms: number; fire(): void }[] = [];
  return {
    waiting,
    deadline: (ms: number, signal: AbortSignal) =>
      new Promise<"elapsed" | "aborted">((resolve) => {
        waiting.push({ ms, fire: () => resolve("elapsed") });
        signal.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        });
      }),
  };
}

function world(
  options: {
    fetch?: HttpFetch;
    keychain?: McpVaultKeychain;
    changed?: () => Promise<unknown>;
  } = {},
) {
  const keychain = options.keychain ?? fakeVaultKeychain();
  let serial = 0;
  const vault = createMcpOAuthVault({
    keychain: () => keychain,
    randomRef: () => `ref-${++serial}`,
  });
  const clock = { now: 1_000_000 };
  const timers = deadlines();
  const changes: number[] = [];
  const oauth = createMcpOAuth({
    vault,
    fetch: options.fetch ??
      (() => Promise.reject(new Error("발급자에 닿으면 안 된다"))),
    nowMs: () => clock.now,
    deadline: timers.deadline,
    changed: options.changed ?? (() => {
      changes.push(clock.now);
      return Promise.resolve();
    }),
  });
  return { keychain, vault, oauth, clock, timers, changes };
}

function stateOf(url: string): string {
  return new URL(url).searchParams.get("state")!;
}

function unwrap<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
  return result.value;
}

const link = () => Promise.resolve(ok(undefined));

const NONE: McpAuthReport = { state: "none", reason: null };

// 로그인 한 번을 끝까지 돌려 token을 보관한다.
async function signIn(
  w: ReturnType<typeof world>,
  server = unlinked(),
  tokens = { access_token: ACCESS_ONE, refresh_token: REFRESH_ONE },
) {
  const listener = listenerOf();
  const begun = unwrap(
    await w.oauth.begin(server, { scopes: ["read"], listener }),
  );
  const done = w.oauth.complete(server, link);
  listener.deliver("the-code", stateOf(begun.url));
  return { result: await done, begun, listener, tokens };
}

Deno.test("lophn-agent/extensions#R16 [agent-I52]: beginning a sign-in gives the browser address with PKCE S256 and a random state, keeps the verifier and state out of the answer, and reports in_progress", async () => {
  const w = world();
  const listener = listenerOf(50111);
  const begun = unwrap(
    await w.oauth.begin(unlinked(), { scopes: ["read", "write"], listener }),
  );
  assertEquals(begun.callbackPort, 50111);
  const url = new URL(begun.url);
  assertEquals(url.origin + url.pathname, `${ISSUER}/authorize`);
  assertEquals(url.searchParams.get("response_type"), "code");
  assertEquals(url.searchParams.get("client_id"), "lophn");
  assertEquals(url.searchParams.get("scope"), "read write");
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "http://127.0.0.1:50111/callback",
  );
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assert((url.searchParams.get("state") ?? "").length >= 16);
  // 응답 모양에는 주소와 port뿐이다.
  assertEquals(Object.keys(begun).sort(), ["callbackPort", "url"]);
  assertEquals(await w.oauth.report(unlinked()), {
    state: "in_progress",
    reason: null,
  });
  await w.oauth.cancel(unlinked());
});

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: the loopback return is exchanged with the verifier, the tokens go to the keychain, the setting is linked, and the server reports signed_in", async () => {
  const issuer = issuerOf(() =>
    json({
      access_token: ACCESS_ONE,
      refresh_token: REFRESH_ONE,
      expires_in: 3600,
    })
  );
  const w = world({ fetch: issuer.fetch });
  const listener = listenerOf(50112);
  const server = unlinked();
  const begun = unwrap(await w.oauth.begin(server, { scopes: [], listener }));
  const challenge = new URL(begun.url).searchParams.get("code_challenge")!;
  const linkedWith: string[] = [];
  const done = w.oauth.complete(server, () => {
    linkedWith.push("linked");
    return Promise.resolve(ok(undefined));
  });
  // 돌아오기 전에는 발급자에 닿지 않는다.
  assertEquals(issuer.seen.length, 0);
  listener.deliver("the-code", stateOf(begun.url));
  unwrap(await done);
  assertEquals(issuer.seen.length, 1);
  assertEquals(issuer.seen[0]!.url, `${ISSUER}/token`);
  const form = issuer.seen[0]!.form;
  assertEquals(form.grant_type, "authorization_code");
  assertEquals(form.code, "the-code");
  assertEquals(form.client_id, "lophn");
  assertEquals(form.redirect_uri, "http://127.0.0.1:50112/callback");
  // 교환에 쓴 verifier가 시작 때 낸 challenge와 짝이다.
  assertEquals(await pkceChallengeS256(form.code_verifier!), challenge);
  assertEquals(linkedWith, ["linked"]);
  assertEquals(listener.closed, 1);
  // token은 keychain 항목에만 있고 알려진 값 맞춤이 불렸다.
  const stored = [...(w.keychain as ReturnType<typeof fakeVaultKeychain>).items
    .values()].map((item) => item.value);
  assert(stored.includes(ACCESS_ONE) && stored.includes(REFRESH_ONE));
  assertEquals(w.changes.length >= 1, true);
  // 설정이 token 참조를 가리킬 때부터 signed_in이다.
  assertEquals(await w.oauth.report(serverOf()), {
    state: "signed_in",
    reason: null,
  });
  // 설정이 아직 가리키지 않으면 쓸 수 없으므로 signed_in이 아니다.
  assertEquals(await w.oauth.report(unlinked()), NONE);
  assert(
    !JSON.stringify(await w.oauth.report(serverOf())).includes(ACCESS_ONE),
  );
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a return with the wrong state is rejected, no token is requested, and the failure is reported", async () => {
  const issuer = issuerOf(() => json({ access_token: "x" }));
  const w = world({ fetch: issuer.fetch });
  const listener = listenerOf();
  const server = unlinked();
  unwrap(await w.oauth.begin(server, { scopes: [], listener }));
  const done = w.oauth.complete(server, link);
  listener.deliver("the-code", "the-evil-state");
  const result = await done;
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
  assertEquals(issuer.seen.length, 0);
  assertEquals(listener.closed, 1);
  assertEquals(await w.oauth.report(server), {
    state: "failed",
    reason: "state_mismatch",
  });
  assertEquals(
    (w.keychain as ReturnType<typeof fakeVaultKeychain>).items.size,
    0,
  );
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: cancelling a waiting sign-in ends the wait without a failure, closes the listener, and the person can begin again", async () => {
  const w = world();
  const server = unlinked();
  const first = listenerOf(50121);
  unwrap(await w.oauth.begin(server, { scopes: [], listener: first }));
  // 진행 중에 또 시작하면 거절이다.
  const busy = await w.oauth.begin(server, {
    scopes: [],
    listener: listenerOf(50122),
  });
  assert(!busy.ok);
  assertEquals(busy.error.code, "conflict");
  const waiting = w.oauth.complete(server, link);
  assertEquals(await w.oauth.cancel(server), true);
  const ended = await waiting;
  assert(!ended.ok);
  assertEquals(ended.error.code, "conflict");
  assertEquals(first.closed >= 1, true);
  // 취소는 실패가 아니다: 아무것도 시작하지 않은 것과 같다.
  assertEquals(await w.oauth.report(server), NONE);
  const again = listenerOf(50123);
  const begun = unwrap(
    await w.oauth.begin(server, { scopes: [], listener: again }),
  );
  assertEquals(begun.callbackPort, 50123);
  assertEquals((await w.oauth.report(server)).state, "in_progress");
  // 취소할 것이 없으면 false다.
  assertEquals(await w.oauth.cancel(server), true);
  assertEquals(await w.oauth.cancel(server), false);
  assertEquals(await w.oauth.cancel(serverOf({ key: PROJECT_KEY })), false);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a sign-in nobody finishes times out after five minutes, reports callback_timeout, and can be begun again", async () => {
  assertEquals(MCP_AUTH_WAIT_MS, 5 * 60_000);
  const w = world();
  const server = unlinked();
  const listener = listenerOf();
  unwrap(await w.oauth.begin(server, { scopes: [], listener }));
  const waiting = w.oauth.complete(server, link);
  // 기다림 시한은 시작할 때 정한 5분이다.
  assertEquals(w.timers.waiting.map((timer) => timer.ms), [MCP_AUTH_WAIT_MS]);
  w.timers.waiting[0]!.fire();
  const result = await waiting;
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(listener.closed >= 1, true);
  assertEquals(await w.oauth.report(server), {
    state: "failed",
    reason: "callback_timeout",
  });
  // 실패 뒤에는 다시 시작할 수 있고 시작하면 실패 이유가 지워진다.
  unwrap(await w.oauth.begin(server, { scopes: [], listener: listenerOf() }));
  assertEquals(await w.oauth.report(server), {
    state: "in_progress",
    reason: null,
  });
  await w.oauth.cancel(server);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a sign-in nobody asked to complete does not block beginning again once the wait is over", async () => {
  const w = world();
  const server = unlinked();
  const first = listenerOf(50131);
  unwrap(await w.oauth.begin(server, { scopes: [], listener: first }));
  w.clock.now += MCP_AUTH_WAIT_MS - 1;
  assertEquals((await w.oauth.report(server)).state, "in_progress");
  w.clock.now += 2;
  assertEquals(await w.oauth.report(server), {
    state: "failed",
    reason: "callback_timeout",
  });
  assertEquals(first.closed >= 1, true);
  unwrap(await w.oauth.begin(server, { scopes: [], listener: listenerOf() }));
  await w.oauth.cancel(server);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a token endpoint that refuses the code reports exchange_failed and stores nothing", async () => {
  const issuer = issuerOf(() => new Response("", { status: 400 }));
  const w = world({ fetch: issuer.fetch });
  const { result } = await signIn(w);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(await w.oauth.report(unlinked()), {
    state: "failed",
    reason: "exchange_failed",
  });
  assertEquals(
    (w.keychain as ReturnType<typeof fakeVaultKeychain>).items.size,
    0,
  );
});

Deno.test("lophn-agent/extensions#R17 platform/secrets#R8 [agent-I52]: a keychain that cannot keep the token fails the sign-in with store_failed and no token is linked", async () => {
  const issuer = issuerOf(() =>
    json({ access_token: ACCESS_ONE, refresh_token: REFRESH_ONE })
  );
  const keychain = fakeVaultKeychain();
  const w = world({ fetch: issuer.fetch, keychain });
  keychain.unavailable = true;
  let linked = 0;
  const listener = listenerOf();
  const server = unlinked();
  const begun = unwrap(await w.oauth.begin(server, { scopes: [], listener }));
  const done = w.oauth.complete(server, () => {
    linked += 1;
    return Promise.resolve(ok(undefined));
  });
  listener.deliver("code", stateOf(begun.url));
  const result = await done;
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(linked, 0);
  assertEquals(await w.oauth.report(server), {
    state: "failed",
    reason: "store_failed",
  });
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: when the setting cannot be linked the stored token is taken back so nothing half signed in remains", async () => {
  const issuer = issuerOf(() =>
    json({ access_token: ACCESS_ONE, refresh_token: REFRESH_ONE })
  );
  const w = world({ fetch: issuer.fetch });
  const listener = listenerOf();
  const server = unlinked();
  const begun = unwrap(await w.oauth.begin(server, { scopes: [], listener }));
  const done = w.oauth.complete(
    server,
    () =>
      Promise.resolve(err({ code: "conflict", message: "settings changed" })),
  );
  listener.deliver("code", stateOf(begun.url));
  const result = await done;
  assert(!result.ok);
  assertEquals(result.error.code, "conflict");
  assertEquals(
    (w.keychain as ReturnType<typeof fakeVaultKeychain>).items.size,
    0,
  );
  assertEquals(w.vault.refs(), []);
  assertEquals(await w.oauth.report(serverOf()), {
    state: "failed",
    reason: "store_failed",
  });
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a token minted for another issuer, URL or client is not reused, and asking for it never reaches the network", async () => {
  const issuer = issuerOf(() =>
    json({ access_token: ACCESS_ONE, refresh_token: REFRESH_ONE })
  );
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  assertEquals((await w.oauth.report(serverOf())).state, "signed_in");
  const requests = issuer.seen.length;
  for (
    const changed of [
      { issuer: "https://other-issuer.example.test" },
      { serverUrl: "https://elsewhere.example.test/rpc" },
      { clientId: "another-client" },
    ]
  ) {
    assertEquals(await w.oauth.report(serverOf(changed)), NONE);
    const access = await w.oauth.access(serverOf(changed));
    assert(!access.ok);
    assertEquals(access.error.code, "forbidden");
  }
  // 옛 비밀은 쓰이지 않았고 지워졌다. 원래 설정으로 돌아와도 되살아나지 않는다.
  assertEquals(issuer.seen.length, requests);
  assertEquals(
    (w.keychain as ReturnType<typeof fakeVaultKeychain>).items.size,
    0,
  );
  assertEquals(await w.oauth.report(serverOf()), NONE);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a server whose setting does not point at its token needs sign-in and its token is never handed out", async () => {
  const issuer = issuerOf(() =>
    json({ access_token: ACCESS_ONE, refresh_token: REFRESH_ONE })
  );
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  const unpointed = serverOf({ tokenRef: null });
  assertEquals(await w.oauth.report(unpointed), NONE);
  const access = await w.oauth.access(unpointed);
  assert(!access.ok);
  assertEquals(access.error.code, "forbidden");
  // 다른 서버(같은 이름, 다른 자리)의 참조로는 이 token을 얻지 못한다.
  const other = await w.oauth.access(serverOf({ key: PROJECT_KEY }));
  assert(!other.ok);
  assertEquals(other.error.code, "forbidden");
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a token that is still good is handed out by reference without any network call", async () => {
  const issuer = issuerOf(() =>
    json({
      access_token: ACCESS_ONE,
      refresh_token: REFRESH_ONE,
      expires_in: 3600,
    })
  );
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  const requests = issuer.seen.length;
  const access = unwrap(await w.oauth.access(serverOf()));
  assertEquals(access.sealedRef, w.vault.sealedRefOf(KEY, "access"));
  // 만료 직전 여유 안이 아니면 갱신하지 않는다.
  w.clock.now += (3600 * 1000) - REFRESH_SKEW_MS - 1;
  unwrap(await w.oauth.access(serverOf()));
  assertEquals(issuer.seen.length, requests);
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: an expiring token is refreshed with the refresh token and the new values replace the old", async () => {
  let round = 0;
  const issuer = issuerOf(() => {
    round += 1;
    return round === 1
      ? json({
        access_token: ACCESS_ONE,
        refresh_token: REFRESH_ONE,
        expires_in: 3600,
      })
      : json({
        access_token: ACCESS_TWO,
        refresh_token: REFRESH_TWO,
        expires_in: 3600,
      });
  });
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  const before = w.vault.sealedRefOf(KEY, "access");
  const changesBefore = w.changes.length;
  w.clock.now += 3600 * 1000 - REFRESH_SKEW_MS + 1;
  const access = unwrap(await w.oauth.access(serverOf()));
  assertEquals(issuer.seen.length, 2);
  assertEquals(issuer.seen[1]!.url, `${ISSUER}/token`);
  assertEquals(issuer.seen[1]!.form.grant_type, "refresh_token");
  assertEquals(issuer.seen[1]!.form.refresh_token, REFRESH_ONE);
  assertEquals(issuer.seen[1]!.form.client_id, "lophn");
  assert(access.sealedRef !== before);
  assertEquals(access.sealedRef, w.vault.sealedRefOf(KEY, "access"));
  // 알려진 값 맞춤이 다시 불려 새 값이 안전화에 든다.
  assert(w.changes.length > changesBefore);
  const values = [
    ...(w.keychain as ReturnType<typeof fakeVaultKeychain>).items.values(),
  ].map((item) => item.value);
  assert(values.includes(ACCESS_TWO) && values.includes(REFRESH_TWO));
  assert(!values.includes(ACCESS_ONE) && !values.includes(REFRESH_ONE));
  // 새 만료 시각이 서고 나면 더 갱신하지 않는다.
  unwrap(await w.oauth.access(serverOf()));
  assertEquals(issuer.seen.length, 2);
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: when two calls find the token expired at once only one refresh request goes out", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let round = 0;
  const issuer = issuerOf(async () => {
    round += 1;
    if (round === 1) {
      return json({
        access_token: ACCESS_ONE,
        refresh_token: REFRESH_ONE,
        expires_in: 60,
      });
    }
    await gate;
    return json({
      access_token: ACCESS_TWO,
      refresh_token: REFRESH_TWO,
      expires_in: 3600,
    });
  });
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  w.clock.now += 120_000;
  const first = w.oauth.access(serverOf());
  const second = w.oauth.access(serverOf());
  const third = w.oauth.access(serverOf());
  // 갱신 요청이 발급자에 걸려 있는 동안 나머지는 같은 결과를 기다린다.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(issuer.seen.length, 2);
  release();
  const [a, b, c] = await Promise.all([first, second, third]);
  assertEquals(issuer.seen.length, 2);
  assertEquals(unwrap(a), unwrap(b));
  assertEquals(unwrap(b), unwrap(c));
  assertEquals(unwrap(a).sealedRef, w.vault.sealedRefOf(KEY, "access"));
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: servers refresh on their own, so two servers with expired tokens send two requests", async () => {
  let round = 0;
  const issuer = issuerOf(() => {
    round += 1;
    return json({
      access_token: `access-${round}`,
      refresh_token: `refresh-${round}`,
      expires_in: 60,
    });
  });
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  const projectServer = serverOf({
    key: PROJECT_KEY,
    tokenRef: null,
  });
  unwrap((await signIn(w, projectServer)).result);
  w.clock.now += 120_000;
  const before = issuer.seen.length;
  await Promise.all([
    w.oauth.access(serverOf()),
    w.oauth.access(
      serverOf({ key: PROJECT_KEY, tokenRef: mcpTokenRef(PROJECT_KEY) }),
    ),
  ]);
  assertEquals(issuer.seen.length - before, 2);
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a refresh the issuer rejects means sign in again, which is told apart from a connection failure", async () => {
  let round = 0;
  const issuer = issuerOf(() => {
    round += 1;
    return round === 1
      ? json({
        access_token: ACCESS_ONE,
        refresh_token: REFRESH_ONE,
        expires_in: 60,
      })
      : new Response("", { status: 400 });
  });
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  w.clock.now += 120_000;
  const refused = await w.oauth.access(serverOf());
  assert(!refused.ok);
  // 재인증 필요는 forbidden(인증 거절)이고 연결 실패(unavailable)와 다르다.
  assertEquals(refused.error.code, "forbidden");
  assertEquals(await w.oauth.report(serverOf()), {
    state: "failed",
    reason: "refresh_rejected",
  });
  // 폐기된 token은 keychain에서도 사라져 다시 쓰이지 않는다.
  assertEquals(
    (w.keychain as ReturnType<typeof fakeVaultKeychain>).items.size,
    0,
  );
  const again = await w.oauth.access(serverOf());
  assert(!again.ok);
  assertEquals(again.error.code, "forbidden");
  assertEquals(issuer.seen.length, 2);
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a refresh that cannot reach the issuer is a connection failure, keeps the token, and stays signed in", async () => {
  let round = 0;
  const issuer = issuerOf(() => {
    round += 1;
    if (round === 1) {
      return json({
        access_token: ACCESS_ONE,
        refresh_token: REFRESH_ONE,
        expires_in: 60,
      });
    }
    throw new Error("network down");
  });
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  w.clock.now += 120_000;
  const failed = await w.oauth.access(serverOf());
  assert(!failed.ok);
  assertEquals(failed.error.code, "unavailable");
  assertEquals((await w.oauth.report(serverOf())).state, "signed_in");
  const values = [
    ...(w.keychain as ReturnType<typeof fakeVaultKeychain>).items.values(),
  ].map((item) => item.value);
  assert(values.includes(REFRESH_ONE));
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: an expired token with no refresh token needs sign-in again and is taken out of the keychain", async () => {
  const issuer = issuerOf(() =>
    json({ access_token: ACCESS_ONE, expires_in: 60 })
  );
  const w = world({ fetch: issuer.fetch });
  unwrap((await signIn(w)).result);
  w.clock.now += 120_000;
  const result = await w.oauth.access(serverOf());
  assert(!result.ok);
  assertEquals(result.error.code, "forbidden");
  assertEquals(issuer.seen.length, 1);
  assertEquals(await w.oauth.report(serverOf()), {
    state: "failed",
    reason: "expired",
  });
  assertEquals(
    (w.keychain as ReturnType<typeof fakeVaultKeychain>).items.size,
    0,
  );
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a server never signed in reports none, and the report is the same after a restart that reads the keychain again", async () => {
  const issuer = issuerOf(() =>
    json({
      access_token: ACCESS_ONE,
      refresh_token: REFRESH_ONE,
      expires_in: 3600,
    })
  );
  const keychain = fakeVaultKeychain();
  const first = world({ fetch: issuer.fetch, keychain });
  assertEquals(await first.oauth.report(serverOf()), NONE);
  unwrap((await signIn(first)).result);
  assertEquals((await first.oauth.report(serverOf())).state, "signed_in");
  // 같은 keychain을 쥔 새 서비스는 끝난 세션을 기억하지 않고 keychain과 설정으로 답한다.
  const second = world({ fetch: issuer.fetch, keychain });
  assertEquals(await second.oauth.report(serverOf()), {
    state: "signed_in",
    reason: null,
  });
  assertEquals(await second.oauth.report(serverOf({ key: PROJECT_KEY })), NONE);
  // 위의 새 서비스가 읽은 뒤에는 알려진 값 참조가 채워진다.
  assertEquals(second.vault.refs().length, 2);
});
