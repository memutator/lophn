// Settings › Providers 통로(shell/desktop#R49). 부른 route·입력과 secret 값이 이 통로를 지나지 않는다는
// 것을 가짜 core 위에서 본다. route는 contracts(providers·provider-credentials)를 따른다.
import { assert, assertEquals } from "@std/assert";

import {
  providerDefinitions,
  registerProvider,
} from "../../../../../../../packages/contracts/lophn-agent/mod.ts";
import {
  assertCallsFitRoutes,
  fail,
  fakeCore,
  ok,
} from "../testdata/fake-core.ts";
import { coreProviderSettingsSource } from "./core-source.ts";

const PVD = "pvd_01h455vb4pex5v6nkc6gd5fd01";
const NEW_PVD = "pvd_01h455vb4pex5v6nkc6gd5fd09";
const NOW = Date.parse("2026-10-07T00:00:00.000Z");

const OPTIONS = {
  openWindow: undefined,
  openLink: undefined,
  now: () => NOW,
  random: () => "r1",
  providerId: () => NEW_PVD,
};

function credential(key: string, order: number, over: object = {}) {
  return {
    key,
    kind: "api_key",
    label: key,
    secret_ref: { name: "s", sealed_ref: "sealed-value", revision: 1 },
    revision: 2,
    order,
    enabled: true,
    account: null,
    organization: null,
    plan: null,
    dedup_fingerprint: "f".repeat(64),
    state: "available",
    unavailable_reason: null,
    until: null,
    expires_at: null,
    logged_in_at: null,
    refreshed_at: null,
    model_blocks: [],
    ...over,
  };
}

function providerValue(over: object = {}) {
  return {
    id: PVD,
    name: "Claude",
    definition: {
      key: "claude-def",
      display_name: "Claude",
      protocols: ["anthropic-messages"],
      auth_kinds: ["none", "api_key", "oauth"],
      models_endpoint: null,
      oauth: { verified_for_lophn: false },
      revision: "1",
    },
    endpoint: "https://api.example.com",
    protocol: "anthropic-messages",
    enabled: true,
    credentials: [credential("main", 0), credential("spare", 1)],
    last_check: null,
    revision: 4,
    ...over,
  };
}

const OAUTH = {
  product: "chatgpt",
  flow: "device_code_then_pkce_paste_url",
  issuer: "https://auth.example.com",
  authorization_endpoint: "https://auth.example.com/authorize",
  token_endpoint: "https://auth.example.com/token",
  allowed_call_origins: ["https://chatgpt.example.com"],
  scopes: ["openid"],
  verified_for_lophn: false,
};

/** `providers/definitions`의 내장 정의 모양. 답은 route output schema를 통과해야 한다. */
function builtin(key: string, over: object = {}) {
  return {
    key,
    display_name: key.toUpperCase(),
    protocols: ["openai-chat-completions"],
    auth_kinds: ["api_key"],
    models_endpoint: `https://api.${key}.example.com/v1/models`,
    oauth: null,
    revision: "2026-10",
    ...over,
  };
}

const DEFINITIONS = [
  builtin("claude-def", {
    protocols: ["anthropic-messages"],
    auth_kinds: ["api_key", "oauth"],
    oauth: OAUTH,
  }),
  builtin("openai", {
    protocols: ["openai-responses", "openai-chat-completions"],
    auth_kinds: ["api_key", "oauth"],
    oauth: OAUTH,
  }),
  builtin("groq"),
  builtin("ollama", { auth_kinds: ["none"], models_endpoint: null }),
];

const LOGIN = {
  login: "login-1",
  flow: "device_code",
  interval_ms: 5000,
  expires_at: "2026-10-07T00:10:00.000Z",
  sign_in: { url: "https://auth.example.com/device", user_code: "AB-12" },
};

interface Sent {
  readonly request: Record<string, unknown>;
}

function windowSpy() {
  const sent: Sent[] = [];
  return {
    sent,
    openWindow: (intent: unknown) => {
      sent.push(intent as Sent);
      return Promise.resolve({ windowId: "w1", displayId: "d1" });
    },
  };
}

Deno.test("shell/desktop#R49 [agent-I46]: 연결된 provider는 providers/list를 쪽마다 읽어 계정 순서와 인증 방식만 옮기고 secret 참조와 지문을 싣지 않으며 등록 전 정의를 섞지 않는다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/list": (body) =>
      (body as { cursor?: string }).cursor === undefined
        ? ok({ providers: [providerValue()], next_cursor: "c1" })
        : ok({
          providers: [providerValue({
            id: "pvd_01h455vb4pex5v6nkc6gd5fd02",
            name: "Local",
            endpoint: "http://127.0.0.1:8123",
            definition: {
              key: "local-def",
              auth_kinds: ["none"],
              oauth: null,
            },
            credentials: [],
          })],
          next_cursor: null,
        }),
  });
  const result = await coreProviderSettingsSource(core, OPTIONS).connected();
  assert(result.ok);
  assertEquals(calls.map((call) => [call.resource, call.method, call.body]), [
    ["providers", "list", {}],
    ["providers", "list", { cursor: "c1" }],
  ]);
  const [claude, local] = result.value;
  assertEquals(claude!.id, PVD);
  assertEquals(claude!.registered, true);
  assertEquals(claude!.ways, ["oauth", "api_key", "none"]);
  assertEquals(claude!.signIn, { verified: false });
  assertEquals(claude!.accounts.map((a) => [a.key, a.order, a.enabled]), [
    ["main", 0, true],
    ["spare", 1, true],
  ]);
  assertEquals(claude!.revision, 4);
  assertEquals([local!.ways, local!.local], [["none"], true]);
  assert(!JSON.stringify(result.value).includes("sealed-value"));
  assert(!JSON.stringify(result.value).includes("f".repeat(64)));
});

Deno.test("shell/desktop#R49 [agent-I46]: Add a provider 목록은 아직 연결하지 않은 내장 정의에 Custom provider를 마지막으로 더하고 로그인 방법은 정해진 순서로 옮긴다", async () => {
  assert(
    providerDefinitions.output.safeParse({ definitions: DEFINITIONS }).success,
  );
  const { core, calls } = fakeCore({
    "read:providers/list": () =>
      ok({ providers: [providerValue()], next_cursor: null }),
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
  });
  const result = await coreProviderSettingsSource(core, OPTIONS).available();
  assert(result.ok);
  // 연결된 provider가 쓰는 정의(claude-def)는 빠지고, 남은 정의 뒤에 Custom provider가 온다.
  assertEquals(result.value.map((row) => row.key), [
    "openai",
    "groq",
    "ollama",
    "custom",
  ]);
  assertEquals(calls.map((call) => call.resource + "/" + call.method), [
    "providers/list",
    "providers/definitions",
  ]);
  const [openai, groq, ollama, custom] = result.value;
  assertEquals(openai!.name, "OPENAI");
  assertEquals(openai!.ways, ["oauth", "api_key"]);
  assertEquals(openai!.signIn, { product: "ChatGPT", verified: false });
  assertEquals(openai!.custom, false);
  assertEquals(groq!.ways, ["api_key"]);
  assertEquals(groq!.signIn, null);
  assertEquals(ollama!.ways, ["none"]);
  assertEquals(custom!.custom, true);
  assertEquals(custom!.signIn, null);
  // 정의를 못 읽으면 그 오류가 간다.
  const noDefinitions = fakeCore({
    "read:providers/list": () => ok({ providers: [], next_cursor: null }),
  });
  assertEquals(
    await coreProviderSettingsSource(noDefinitions.core, OPTIONS).available(),
    { ok: false, code: "not_found" },
  );
});

Deno.test("platform/secrets#R2, shell/desktop#R49 [agent-I46]: API key로 연결하면 사람 command로 provider를 먼저 등록하고 값 없는 보호 창만 열며 같은 정의를 다시 등록하지 않는다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ok({ provider: {} }),
  });
  const spy = windowSpy();
  const source = coreProviderSettingsSource(core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  assertEquals(await source.connect("groq", "api_key"), {
    ok: true,
    value: null,
  });
  const register = calls.find((call) => call.method === "register")!;
  assertEquals(register.kind, "command");
  const body = register.body as {
    input: Record<string, unknown>;
    idempotency_key: string;
  };
  assertEquals(body.input.id, NEW_PVD);
  assertEquals(body.input.name, "GROQ");
  assertEquals(body.input.endpoint, "https://api.groq.example.com/v1");
  assertEquals(body.input.protocol, "openai-chat-completions");
  assertEquals(
    body.input.definition,
    DEFINITIONS.find((entry) => entry.key === "groq"),
  );
  assert(registerProvider.input.safeParse(body.input).success);
  assertEquals(spy.sent.map((item) => item.request.owner), [NEW_PVD]);
  assertEquals(spy.sent[0]!.request.purpose, "provider_credential");
  assertEquals(
    (spy.sent[0]!.request.credential as { kind: string }).kind,
    "api_key",
  );
  assert(!JSON.stringify([calls, spy.sent]).includes("secret_ref"));
  await source.connect("groq", "api_key");
  assertEquals(calls.filter((call) => call.method === "register").length, 1);
  assertEquals(spy.sent.map((item) => item.request.owner), [NEW_PVD, NEW_PVD]);
});

Deno.test("shell/desktop#R49 [agent-I46]: 등록이 거절되면 보호 창을 열지 않고 창을 열지 못하면 그 오류가 가며 알 수 없는 정의는 등록하지 않는다", async () => {
  const refused = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => fail("forbidden"),
  });
  const spy = windowSpy();
  const denied = coreProviderSettingsSource(refused.core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  assertEquals(await denied.connect("groq", "api_key"), {
    ok: false,
    code: "forbidden",
  });
  assertEquals(spy.sent, []);
  const accepted = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ok({ provider: {} }),
  });
  const noWindow = coreProviderSettingsSource(accepted.core, OPTIONS);
  assertEquals(await noWindow.connect("groq", "api_key"), {
    ok: false,
    code: "unavailable",
  });
  const blocked = coreProviderSettingsSource(accepted.core, {
    ...OPTIONS,
    openWindow: () => Promise.resolve({ code: "forbidden" }),
  });
  assertEquals(await blocked.connect("groq", "api_key"), {
    ok: false,
    code: "forbidden",
  });
  const unknown = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
  });
  assertEquals(
    await coreProviderSettingsSource(unknown.core, OPTIONS).connect(
      "nope",
      "api_key",
    ),
    { ok: false, code: "unavailable" },
  );
  assertEquals(unknown.calls.filter((c) => c.method === "register"), []);
});

Deno.test("shell/app-frame#R7, shell/desktop#R49 [agent-I46]: 공식 로그인은 provider를 등록하고 로그인을 시작해 OS browser로 열며 붙여 넣는 방식만 보호 창을 열고 열지 못하면 로그인을 닫는다", async () => {
  const answers = {
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ok({ provider: {} }),
    "command:providers/login-begin": () => ok(LOGIN),
    "command:providers/login-cancel": () => ok({ cancelled: true }),
  };
  // 기기 코드 방식은 창이 필요 없다. 주소를 열면 끝이다.
  const device = fakeCore(answers);
  const links: string[] = [];
  const spy = windowSpy();
  const source = coreProviderSettingsSource(device.core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
    openLink: (url: string) => {
      links.push(url);
      return Promise.resolve({ ok: true } as const);
    },
  });
  assertEquals(await source.connect("openai", "oauth"), {
    ok: true,
    value: null,
  });
  assertEquals(links, ["https://auth.example.com/device"]);
  assertEquals(spy.sent, []);
  const begin = device.calls.find((call) => call.method === "login-begin")!;
  assertEquals((begin.body as { input: unknown }).input, { provider: NEW_PVD });
  // 최종 주소를 붙여 넣는 방식은 응답을 받는 보호 창을 연다(값은 창만 안다).
  const paste = fakeCore({
    ...answers,
    "command:providers/login-begin": () =>
      ok({ ...LOGIN, flow: "device_code_then_pkce_paste_url" }),
  });
  const pasteSpy = windowSpy();
  const pasteSource = coreProviderSettingsSource(paste.core, {
    ...OPTIONS,
    openWindow: pasteSpy.openWindow,
    openLink: () => Promise.resolve({ ok: true } as const),
  });
  assertEquals(await pasteSource.connect("openai", "oauth"), {
    ok: true,
    value: null,
  });
  assertEquals(pasteSpy.sent.map((item) => item.request.owner), [NEW_PVD]);
  assertEquals(
    (pasteSpy.sent[0]!.request.credential as { kind: string }).kind,
    "oauth",
  );
  // 주소를 열지 못하면 시작한 로그인을 닫고 열지 못했다고 알린다.
  const closed = fakeCore(answers);
  const stuck = coreProviderSettingsSource(closed.core, {
    ...OPTIONS,
    openLink: () =>
      Promise.resolve({ ok: false, code: "unavailable" } as const),
  });
  assertEquals(await stuck.connect("openai", "oauth"), {
    ok: false,
    code: "unavailable",
  });
  const cancel = closed.calls.find((call) => call.method === "login-cancel")!;
  assertEquals((cancel.body as { input: unknown }).input, {
    provider: NEW_PVD,
    login: "login-1",
  });
});

Deno.test("shell/desktop#R49 [agent-I46]: 주소를 알 수 없는 로컬 정의는 등록하지 않고 unavailable이다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ok({ provider: {} }),
  });
  const source = coreProviderSettingsSource(core, OPTIONS);
  assertEquals(await source.connect("ollama", "none"), {
    ok: false,
    code: "unavailable",
  });
  assertEquals(calls.filter((call) => call.method === "register"), []);
});

Deno.test("shell/desktop#R49 [agent-I46]: Custom provider는 입력한 ID·이름·Base URL로 정의를 만들어 등록하고 key를 더하겠다고 한 때만 값 없는 보호 창을 연다", async () => {
  const { core, calls } = fakeCore({
    "command:providers/register": () => ok({ provider: {} }),
  });
  const spy = windowSpy();
  const source = coreProviderSettingsSource(core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  assertEquals(
    await source.registerCustom({
      id: "my-proxy",
      name: "My proxy",
      baseUrl: "https://llm.example.com/v1",
      withKey: true,
    }),
    { ok: true, value: null },
  );
  const first = (calls[0]!.body as { input: Record<string, unknown> }).input;
  assertEquals(first.id, NEW_PVD);
  assertEquals(first.name, "My proxy");
  assertEquals(first.endpoint, "https://llm.example.com/v1");
  assertEquals(first.protocol, "openai-chat-completions");
  const definition = first.definition as Record<string, unknown>;
  assertEquals(definition.key, "my-proxy");
  assertEquals(definition.display_name, "My proxy");
  assertEquals(definition.auth_kinds, ["api_key"]);
  assertEquals(definition.oauth, null);
  assert(registerProvider.input.safeParse(first).success);
  assertEquals(spy.sent.map((item) => item.request.owner), [NEW_PVD]);
  // key 없이 이 컴퓨터의 http 주소를 등록하면 인증이 없는 정의이고 창은 열리지 않는다.
  assertEquals(
    await source.registerCustom({
      id: "local-llm",
      name: "Local LLM",
      baseUrl: "http://localhost:8000/v1",
      withKey: false,
    }),
    { ok: true, value: null },
  );
  const second = (calls[1]!.body as { input: Record<string, unknown> }).input;
  assertEquals(
    (second.definition as { auth_kinds: unknown }).auth_kinds,
    ["none"],
  );
  assert(registerProvider.input.safeParse(second).success);
  assertEquals(spy.sent.length, 1);
});

Deno.test("shell/desktop#R49 [agent-I46]: Custom provider 등록이 거절되면 그 오류가 가고 창을 열지 않는다", async () => {
  const { core } = fakeCore({
    "command:providers/register": () => fail("conflict"),
  });
  const spy = windowSpy();
  const source = coreProviderSettingsSource(core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  assertEquals(
    await source.registerCustom({
      id: "my-proxy",
      name: "My proxy",
      baseUrl: "https://llm.example.com/v1",
      withKey: true,
    }),
    { ok: false, code: "conflict" },
  );
  assertEquals(spy.sent, []);
});

Deno.test("shell/desktop#R49 [agent-I46]: 끊기·계정 끄고 켜기·계정 순서 바꾸기는 보호 확인 창에 이 일의 요청 종류가 생기기 전까지 core를 부르지 않고 unavailable이다", async () => {
  const { core, calls } = fakeCore({});
  const source = coreProviderSettingsSource(core, OPTIONS);
  const unavailable = { ok: false, code: "unavailable" };
  assertEquals(await source.disconnect(PVD), unavailable);
  assertEquals(await source.setAccountEnabled(PVD, "main", false), unavailable);
  assertEquals(
    await source.reorderAccounts(PVD, ["spare", "main"]),
    unavailable,
  );
  assertEquals(calls, []);
});

Deno.test("shell/desktop#R49 [agent-I46]: 보내는 입력과 비교 기준은 contract route의 schema를 그대로 통과한다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/list": () => ok({ providers: [], next_cursor: null }),
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ok({ provider: {} }),
    "command:providers/login-begin": () => ok(LOGIN),
    "command:providers/login-cancel": () => ok({ cancelled: true }),
  });
  const source = coreProviderSettingsSource(core, {
    ...OPTIONS,
    openWindow: () => Promise.resolve({ windowId: "w1" }),
    openLink: () =>
      Promise.resolve({ ok: false, code: "unavailable" } as const),
  });
  await source.connected();
  await source.available();
  await source.connect("groq", "api_key");
  await source.connect("openai", "oauth");
  await source.registerCustom({
    id: "my-proxy",
    name: "My proxy",
    baseUrl: "https://llm.example.com/v1",
    withKey: false,
  });
  assertCallsFitRoutes(calls);
});
