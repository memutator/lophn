// Settings › Providers 통로(shell/desktop#R49). 부른 route·입력과 secret 값이 이 통로를 지나지 않는다는
// 것을 가짜 core 위에서 본다. route는 contracts(providers)를 따른다. provider에는 credential이 하나라
// 계정 순서·끄기·연결 테스트 호출은 없고, API key로 연결하는 일은 보호 창이 RegisterProvider를 부른다.
import { assert, assertEquals } from "@std/assert";

import {
  providerDefinitions,
  registerProvider,
} from "../../../../../../../packages/contracts/lophn-agent/mod.ts";
import { confirmationOpenIntentSchema } from "../../../../../../../packages/contracts/shell/confirmation.ts";
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

function credential(over: object = {}) {
  return {
    kind: "api_key",
    secret_ref: { name: "s", sealed_ref: "sealed-value", revision: 1 },
    revision: 2,
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
      auth_kinds: ["api_key", "oauth"],
      models_endpoint: null,
      oauth: { verified_for_lophn: false },
      revision: "1",
    },
    endpoint: "https://api.example.com",
    protocol: "anthropic-messages",
    credential: credential(),
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
  readonly parentWindow: string;
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

/** 보호 창을 여는 요청은 main이 받는 contract 모양을 그대로 따라야 한다. */
function assertFitsIntent(sent: Sent): void {
  const parsed = confirmationOpenIntentSchema.safeParse(sent);
  assert(parsed.success, JSON.stringify(parsed));
}

Deno.test("shell/desktop#R49: 연결된 provider는 providers/list를 쪽마다 읽어 이름·로그인 방법·상태만 옮기고 secret 참조를 싣지 않으며 등록 전 정의를 섞지 않는다", async () => {
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
            credential: credential({
              kind: "none",
              secret_ref: null,
              state: "usage_wait",
              unavailable_reason: "quota",
              until: "2026-10-07T01:00:00.000Z",
            }),
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
  assertEquals(result.value, [
    {
      id: PVD,
      name: "Claude",
      definition: "claude-def",
      way: "api_key",
      state: "available",
      reason: null,
      revision: 4,
    },
    {
      id: "pvd_01h455vb4pex5v6nkc6gd5fd02",
      name: "Local",
      definition: "local-def",
      way: "none",
      state: "usage_wait",
      reason: "quota",
      revision: 4,
    },
  ]);
  assert(!JSON.stringify(result.value).includes("sealed-value"));
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R1: Add a provider 목록은 아직 연결하지 않은 내장 정의에 Custom provider를 마지막으로 더하고 로그인 방법은 정해진 순서로 옮긴다", async () => {
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
    "custom",
  ]);
  assertEquals(calls.map((call) => call.resource + "/" + call.method), [
    "providers/list",
    "providers/definitions",
  ]);
  const [openai, groq, custom] = result.value;
  assertEquals(openai!.name, "OPENAI");
  assertEquals(openai!.ways, ["oauth", "api_key"]);
  assertEquals(openai!.signIn, { product: "ChatGPT", verified: false });
  assertEquals(openai!.custom, false);
  assertEquals(groq!.ways, ["api_key"]);
  assertEquals(groq!.signIn, null);
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

Deno.test("platform/secrets#R2, lophn-agent/harness/provider#R8: API key로 연결하면 core를 부르지 않고 등록 정보를 실은 값 없는 보호 창만 열어 그 창이 RegisterProvider를 부르게 한다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
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
  // 값 없는 provider를 먼저 등록하지 않는다: 읽기 말고는 core를 부르지 않는다.
  assertEquals(calls.map((call) => call.kind), ["read"]);
  assertEquals(spy.sent.length, 1);
  assertFitsIntent(spy.sent[0]!);
  const groq = DEFINITIONS.find((entry) => entry.key === "groq");
  assertEquals(spy.sent[0]!.request, {
    kind: "secret_input",
    owner: NEW_PVD,
    purpose: "provider_credential",
    connect: {
      name: "GROQ",
      definition: groq,
      endpoint: "https://api.groq.example.com/v1",
      protocol: "openai-chat-completions",
      kind: "api_key",
    },
  });
  // 창이 보낼 RegisterProvider 입력의 앞 절반은 contract를 통과한다.
  const connect = spy.sent[0]!.request.connect as Record<string, unknown>;
  assert(
    registerProvider.input.safeParse({
      id: NEW_PVD,
      name: connect.name,
      definition: connect.definition,
      endpoint: connect.endpoint,
      protocol: connect.protocol,
      credential: {
        kind: "api_key",
        preparation: {
          preparation: "p",
          sealed_ref: "s",
          purpose: "provider_credential",
          owner: NEW_PVD,
        },
      },
    }).success,
  );
  assert(!JSON.stringify([calls, spy.sent]).includes("secret_ref"));
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R6: 끊은 provider를 다시 Connect하면 같은 ID로 연결한다", async () => {
  const groq = DEFINITIONS.find((entry) => entry.key === "groq")!;
  const { core } = fakeCore({
    "read:providers/list": () =>
      ok({
        providers: [providerValue({
          id: PVD,
          name: "GROQ",
          definition: groq,
        })],
        next_cursor: null,
      }),
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
  });
  const spy = windowSpy();
  const source = coreProviderSettingsSource(core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  await source.connected();
  await source.disconnect(PVD);
  await source.connect("groq", "api_key");
  assertEquals(spy.sent.map((item) => item.request.owner), [PVD, PVD]);
  // 다른 정의는 새 ID를 쓴다.
  await source.connect("openai", "api_key");
  assertEquals(spy.sent[2]!.request.owner, NEW_PVD);
});

Deno.test("shell/desktop#R49: 창을 열지 못하면 그 오류가 가고 알 수 없는 정의는 열지 않는다", async () => {
  const defined = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
  });
  const noWindow = coreProviderSettingsSource(defined.core, OPTIONS);
  assertEquals(await noWindow.connect("groq", "api_key"), {
    ok: false,
    code: "unavailable",
  });
  const blocked = coreProviderSettingsSource(defined.core, {
    ...OPTIONS,
    openWindow: () => Promise.resolve({ code: "forbidden" }),
  });
  assertEquals(await blocked.connect("groq", "api_key"), {
    ok: false,
    code: "forbidden",
  });
  const spy = windowSpy();
  const unknown = coreProviderSettingsSource(defined.core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  assertEquals(await unknown.connect("nope", "api_key"), {
    ok: false,
    code: "unavailable",
  });
  assertEquals(spy.sent, []);
  assertEquals(
    defined.calls.filter((call) => call.kind === "command"),
    [],
  );
});

Deno.test("shell/app-frame#R7, shell/desktop#R49: 공식 로그인은 로그인을 시작해 OS browser로 열고 붙여 넣는 방식만 시작한 login handle을 실은 보호 창을 열며 열지 못하면 로그인을 닫는다", async () => {
  const answers = {
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
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
  // 아직 없는 provider라 login은 만들 provider ID와 내장 정의 key로 시작한다.
  const begin = device.calls.find((call) => call.method === "login-begin")!;
  assertEquals((begin.body as { input: unknown }).input, {
    provider: NEW_PVD,
    definition: "openai",
  });
  assertEquals(
    device.calls.filter((call) => call.method === "register"),
    [],
  );
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
  assertFitsIntent(pasteSpy.sent[0]!);
  const connect = pasteSpy.sent[0]!.request.connect as Record<string, unknown>;
  assertEquals(connect.kind, "oauth");
  assertEquals(connect.login, "login-1");
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

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R31: Custom provider는 key를 더하겠다고 한 때만 값 없는 보호 창을 열고 이 컴퓨터의 주소를 key 없이 연결하면 RegisterProvider를 바로 부른다", async () => {
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
  // key를 받는 연결은 보호 창이 RegisterProvider를 부른다. 이 통로는 core를 부르지 않는다.
  assertEquals(calls, []);
  assertEquals(spy.sent.length, 1);
  assertFitsIntent(spy.sent[0]!);
  const intent = spy.sent[0]!.request as {
    owner: string;
    connect: {
      name: string;
      endpoint: string;
      protocol: string;
      kind: string;
      definition: Record<string, unknown>;
    };
  };
  assertEquals(intent.owner, NEW_PVD);
  assertEquals(intent.connect.name, "My proxy");
  assertEquals(intent.connect.endpoint, "https://llm.example.com/v1");
  assertEquals(intent.connect.protocol, "openai-chat-completions");
  assertEquals(intent.connect.kind, "api_key");
  assertEquals(intent.connect.definition.key, "my-proxy");
  assertEquals(intent.connect.definition.display_name, "My proxy");
  assertEquals(intent.connect.definition.auth_kinds, ["api_key"]);
  assertEquals(intent.connect.definition.oauth, null);
  // key 없이 이 컴퓨터의 http 주소를 연결하면 인증이 없는 연결이고 창은 열리지 않는다.
  assertEquals(
    await source.registerCustom({
      id: "local-llm",
      name: "Local LLM",
      baseUrl: "http://localhost:8000/v1",
      withKey: false,
    }),
    { ok: true, value: null },
  );
  const sent = calls[0]!.body as {
    input: Record<string, unknown>;
    idempotency_key: string;
  };
  assertEquals(calls[0]!.method, "register");
  assertEquals(sent.input.id, NEW_PVD);
  assertEquals(sent.input.credential, { kind: "none", preparation: null });
  assertEquals(
    (sent.input.definition as { auth_kinds: unknown }).auth_kinds,
    ["none"],
  );
  assert(registerProvider.input.safeParse(sent.input).success);
  assertEquals(spy.sent.length, 1);
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R5: 웹 주소를 key 없이 연결하려는 요청은 core도 창도 부르지 않고 거절한다", async () => {
  const { core, calls } = fakeCore({});
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
      withKey: false,
    }),
    { ok: false, code: "invalid_input" },
  );
  assertEquals(calls, []);
  assertEquals(spy.sent, []);
});

Deno.test("shell/desktop#R49: Custom provider 등록이 거절되면 그 오류가 간다", async () => {
  const { core } = fakeCore({
    "command:providers/register": () => fail("conflict"),
  });
  const source = coreProviderSettingsSource(core, OPTIONS);
  assertEquals(
    await source.registerCustom({
      id: "local-llm",
      name: "Local LLM",
      baseUrl: "http://localhost:8000/v1",
      withKey: false,
    }),
    { ok: false, code: "conflict" },
  );
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R6: 끊기는 core를 부르지 않고 그 provider의 Disconnect 확인 창을 열며 창을 열지 못하면 그 오류가 간다", async () => {
  const { core, calls } = fakeCore({});
  const spy = windowSpy();
  const source = coreProviderSettingsSource(core, {
    ...OPTIONS,
    openWindow: spy.openWindow,
  });
  assertEquals(await source.disconnect(PVD), { ok: true, value: null });
  assertEquals(calls, []);
  assertEquals(spy.sent.length, 1);
  assertFitsIntent(spy.sent[0]!);
  assertEquals(spy.sent[0]!.request, {
    kind: "secret_input",
    owner: PVD,
    purpose: "provider_credential",
    disconnect: true,
  });
  assertEquals(
    await coreProviderSettingsSource(core, OPTIONS).disconnect(PVD),
    { ok: false, code: "unavailable" },
  );
  // 계정을 끄고 켜거나 순서를 바꾸는 통로는 없다.
  const keys = Object.keys(source).sort();
  assertEquals(keys, [
    "available",
    "connect",
    "connected",
    "disconnect",
    "registerCustom",
  ]);
});

Deno.test("shell/desktop#R49: 보내는 입력과 비교 기준은 contract route의 schema를 그대로 통과한다", async () => {
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
    baseUrl: "http://127.0.0.1:8000/v1",
    withKey: false,
  });
  assertCallsFitRoutes(calls);
});
