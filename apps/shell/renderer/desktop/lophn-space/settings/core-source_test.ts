// settings 통로(shell#T31). 부른 route·입력·비교 기준과 secret 값이 이 통로를 지나지 않는다는 것을 가짜
// core 위에서 본다.
import { assert, assertEquals } from "@std/assert";

import { ALL_ROUTES } from "../../../../../../packages/contracts/mod.ts";
import {
  connectionTest,
  mcpServersSetting,
  providerDefinitions,
} from "../../../../../../packages/contracts/lophn-agent/mod.ts";
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreSettingsSource } from "./core-source.ts";

const PVD = "pvd_01h455vb4pex5v6nkc6gd5fd01";
const NOW = Date.parse("2026-10-07T00:00:00.000Z");

interface Fake {
  readonly core: CoreSource;
  readonly calls: CoreCall[];
}

function fakeCore(
  answers: Record<string, (body: unknown) => CoreReply>,
): Fake {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const key = `${input.kind}:${input.resource}/${input.method}`;
        const answer = answers[key];
        return Promise.resolve(
          answer === undefined
            ? { ok: false, error: { code: "not_found", message: key } }
            : answer(input.body),
        );
      },
    },
  };
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });

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

const OPTIONS = {
  openWindow: undefined,
  openLink: undefined,
  picker: undefined,
  now: () => NOW,
  random: () => "r1",
  providerId: () => NEW_PVD,
};

const NEW_PVD = "pvd_01h455vb4pex5v6nkc6gd5fd09";

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
    oauth: { ...OAUTH, product: "chatgpt" },
  }),
  builtin("openai", {
    protocols: ["openai-responses", "openai-chat-completions"],
    auth_kinds: ["api_key", "oauth"],
    oauth: OAUTH,
  }),
  builtin("groq"),
  builtin("ollama", { auth_kinds: ["none"], models_endpoint: null }),
];

Deno.test("shell/wording#R10: 연결 목록은 contract가 알려 준 인증 방식만 정해진 순서로 옮기고 secret 참조를 화면 값에 싣지 않는다", async () => {
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
            last_check: {
              at: "2026-10-06T00:00:00.000Z",
              result: "success",
              test_kind: "text",
              model_name: "m",
            },
          })],
          next_cursor: null,
        }),
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
  });
  const result = await coreSettingsSource(core, OPTIONS).providers();
  assert(result.ok);
  assertEquals(calls.map((call) => call.body), [{}, { cursor: "c1" }, {}]);
  assert(
    providerDefinitions.output.safeParse({ definitions: DEFINITIONS }).success,
  );
  const [claude, local] = result.value;
  assertEquals(claude!.ways, ["oauth", "api_key", "none"]);
  assertEquals(claude!.signIn, { verified: false });
  assertEquals(claude!.local, false);
  assertEquals(local!.ways, ["none"]);
  assertEquals(local!.local, true);
  assertEquals(local!.signIn, null);
  assertEquals(local!.lastCheck?.result, "success");
  assertEquals(claude!.accounts.map((account) => account.key), [
    "main",
    "spare",
  ]);
  assert(!JSON.stringify(result.value).includes("sealed-value"));
  assert(!JSON.stringify(result.value).includes("f".repeat(64)));
  // 등록한 연결이 쓰지 않는 내장 정의만 연결 가능한 행으로 더한다. 계정·확인 기록·secret은 없다.
  assertEquals(result.value.map((row) => [row.id, row.registered]), [
    [PVD, true],
    ["pvd_01h455vb4pex5v6nkc6gd5fd02", true],
    ["definition:openai", false],
    ["definition:groq", false],
    ["definition:ollama", false],
  ]);
  const [openai, groq, ollama] = result.value.slice(2);
  assertEquals(openai!.ways, ["oauth", "api_key"]);
  assertEquals(openai!.signIn, { verified: false });
  assertEquals(groq!.ways, ["api_key"]);
  assertEquals(groq!.signIn, null);
  assertEquals([ollama!.ways, ollama!.local], [["none"], true]);
  assertEquals(openai!.accounts, []);
  assertEquals(openai!.lastCheck, null);
});

Deno.test("shell/wording#R10: 등록한 연결이 없는 처음 설치에서도 내장 정의가 연결 목록이 되고 정의를 못 읽으면 그 오류가 간다", async () => {
  const fresh = fakeCore({
    "read:providers/list": () => ok({ providers: [], next_cursor: null }),
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
  });
  const rows = await coreSettingsSource(fresh.core, OPTIONS).providers();
  assert(rows.ok);
  assertEquals(
    rows.value.map((row) => row.definition),
    ["claude-def", "openai", "groq", "ollama"],
  );
  assert(
    rows.value.every((row) => !row.registered && row.accounts.length === 0),
  );
  const noDefinitions = fakeCore({
    "read:providers/list": () => ok({ providers: [], next_cursor: null }),
  });
  assertEquals(
    await coreSettingsSource(noDefinitions.core, OPTIONS).providers(),
    { ok: false, code: "not_found" },
  );
});

Deno.test("platform/secrets#R2, shell/wording#R10: 등록 전 정의에서 key를 연결하면 사람 command로 provider를 먼저 등록하고 값 없는 보호 창만 연다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ok({ provider: {} }),
  });
  const sent: { request: Record<string, unknown> }[] = [];
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    openWindow: (intent) => {
      sent.push(intent as typeof sent[number]);
      return Promise.resolve({ windowId: "w1", displayId: "d1" });
    },
  });
  assertEquals(await source.connectKey("definition:groq", "Work"), {
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
  assertEquals(sent.map((item) => item.request.owner), [NEW_PVD]);
  assert(!JSON.stringify([calls, sent]).includes("secret_ref"));
  // 같은 행을 다시 누르면 다시 등록하지 않는다. 로그인 응답과 취소도 등록한 id를 쓴다.
  await source.connectKey("definition:groq", "Spare");
  assertEquals(calls.filter((call) => call.method === "register").length, 1);
  assertEquals(
    await source.enterSignInResponse("definition:groq", "Groq"),
    { ok: true, value: null },
  );
  assertEquals(sent.map((item) => item.request.owner), [
    NEW_PVD,
    NEW_PVD,
    NEW_PVD,
  ]);
  // 주소를 알 수 없는 정의(로컬)는 등록하지 않는다.
  assertEquals(await source.connectKey("definition:ollama", "Local"), {
    ok: false,
    code: "unavailable",
  });
  assertEquals(calls.filter((call) => call.method === "register").length, 1);
  // 등록이 거절되면 보호 창을 열지 않는다.
  const refused = fakeCore({
    "read:providers/definitions": () => ok({ definitions: DEFINITIONS }),
    "command:providers/register": () => ({
      ok: false,
      error: { code: "forbidden", message: "no" },
    }),
  });
  const opened: unknown[] = [];
  const denied = coreSettingsSource(refused.core, {
    ...OPTIONS,
    openWindow: (intent) => {
      opened.push(intent);
      return Promise.resolve({ windowId: "w1" });
    },
  });
  assertEquals(await denied.connectKey("definition:groq", "Work"), {
    ok: false,
    code: "forbidden",
  });
  assertEquals(opened, []);
});

Deno.test("lophn-agent/harness/provider#R30: 연결 테스트 입력과 응답은 TestProviderConnection의 {check, timeout_ms}와 같고 결과 없음은 성공으로 채우지 않는다", async () => {
  const check = {
    at: "2026-10-07T00:00:00.000Z",
    credential_key: "main",
    credential_revision: 2,
    model_name: "m1",
    test_kind: "text",
    command_key: "test-text-r1",
    calls: [],
    result: "success",
    code: null,
  };
  const reply = { check, timeout_ms: 30_000 };
  assert(connectionTest.output.safeParse(reply).success);
  assert(
    connectionTest.output.safeParse({ check: null, timeout_ms: 30_000 })
      .success,
  );
  const answers = [reply, { check: null, timeout_ms: 30_000 }];
  const { core } = fakeCore({
    "command:providers/test": () => ok(answers.shift()),
  });
  const tested = await coreSettingsSource(core, OPTIONS).testConnection({
    provider: PVD,
    account: "main",
    model: "m1",
  });
  assert(tested.ok);
  assertEquals(tested.value.map((result) => result.result), ["success", null]);
});

Deno.test("shell/wording#R10: 사용량은 그 계정의 최근 30일만 읽고 비용 줄은 종류별로 모으되 모르는 비용에 금액을 붙이지 않는다", async () => {
  const { core, calls } = fakeCore({
    "read:agent-usage/read": () =>
      ok({
        totals: [
          {
            calls: 3,
            complete: true,
            costs: [
              { kind: "reported", amount: "1.5", currency: "USD", calls: 2 },
              { kind: "unknown", amount: null, currency: null, calls: 1 },
            ],
          },
          {
            calls: 2,
            complete: false,
            costs: [
              { kind: "reported", amount: "0.25", currency: "USD", calls: 1 },
              { kind: "unknown", amount: null, currency: null, calls: 1 },
            ],
          },
        ],
      }),
  });
  const usage = await coreSettingsSource(core, OPTIONS).usage("main");
  assert(usage.ok);
  assertEquals(calls[0]!.body, {
    credential_key: "main",
    from_at: "2026-09-07T00:00:00.000Z",
    through_at: "2026-10-07T00:00:00.000Z",
  });
  assertEquals(usage.value, {
    calls: 5,
    complete: false,
    costs: [
      { kind: "reported", amount: "1.75", currency: "USD", calls: 3 },
      { kind: "unknown", amount: null, currency: null, calls: 2 },
    ],
  });
});

Deno.test("shell/wording#R10: 연결 테스트는 부를 때만 글·도구 호출 두 종류를 하나씩 보내고 한쪽이 실패하면 거기서 멈추며 결과 없는 확인은 성공으로 채우지 않는다", async () => {
  const { core, calls } = fakeCore({
    "command:providers/test": () => ok({ check: null, timeout_ms: 30_000 }),
  });
  const source = coreSettingsSource(core, OPTIONS);
  assertEquals(calls.length, 0);
  const tested = await source.testConnection({
    provider: PVD,
    account: "main",
    model: "m1",
  });
  assert(tested.ok);
  assertEquals(
    tested.value,
    [
      { kind: "text", result: null, timeoutSeconds: 30 },
      { kind: "tool_call", result: null, timeoutSeconds: 30 },
    ],
  );
  const bodies = calls.map((call) => call.body as Record<string, unknown>);
  assertEquals(
    bodies.map((body) => (body.input as Record<string, unknown>).test_kind),
    ["text", "tool_call"],
  );
  const first = bodies[0]!.input as Record<string, string>;
  assertEquals(first.provider, PVD);
  assertEquals(first.credential_key, "main");
  assertEquals(first.model_name, "m1");
  assertEquals(first.command_key, bodies[0]!.idempotency_key);
  assertEquals(bodies[0]!.prepared, []);

  const absent = fakeCore({});
  const missing = await coreSettingsSource(absent.core, OPTIONS)
    .testConnection({ provider: PVD, account: "main", model: "m1" });
  assertEquals(missing, { ok: false, code: "not_found" });
  assertEquals(absent.calls.length, 1);
});

Deno.test("shell/app-frame#R7: 로그인 시작은 열 주소와 코드만 옮기고 링크 열기는 shell 통로의 결과만 믿는다", async () => {
  const { core } = fakeCore({
    "command:providers/login-begin": () =>
      ok({
        login: "login-1",
        flow: "device_code_then_pkce_paste_url",
        interval_ms: 5000,
        expires_at: "2026-10-07T00:10:00.000Z",
        sign_in: { url: "https://auth.example.com/x", user_code: null },
      }),
  });
  const opened: string[] = [];
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    openLink: (url) => {
      opened.push(url);
      return Promise.resolve({ ok: true });
    },
  });
  const begun = await source.beginSignIn(PVD);
  assertEquals(begun, {
    ok: true,
    value: {
      login: "login-1",
      url: "https://auth.example.com/x",
      code: null,
      paste: true,
    },
  });
  assertEquals(await source.openLink("https://auth.example.com/x"), true);
  assertEquals(opened, ["https://auth.example.com/x"]);
  const refused = coreSettingsSource(core, {
    ...OPTIONS,
    openLink: () => Promise.resolve({ ok: false, code: "invalid_input" }),
  });
  assertEquals(await refused.openLink("file:///etc/passwd"), false);
  assertEquals(
    await coreSettingsSource(core, OPTIONS).openLink("https://a.b"),
    false,
  );
  // 로그인 통로가 core에 없으면 그 오류가 그대로 간다.
  const none = coreSettingsSource(fakeCore({}).core, OPTIONS);
  assertEquals(await none.beginSignIn(PVD), { ok: false, code: "not_found" });
});

Deno.test("platform/secrets#R2, shell/wording#R10: key·로그인 응답·교체·삭제는 값 없는 열기 요청으로만 보호 창을 열고 지문과 값은 보내지 않는다", async () => {
  const { core } = fakeCore({});
  const sent: { request: Record<string, unknown>; parentWindow: string }[] = [];
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    openWindow: (intent) => {
      sent.push(intent as typeof sent[number]);
      return Promise.resolve({ windowId: "w1", displayId: "d1" });
    },
  });
  assertEquals(await source.connectKey(PVD, "Work"), { ok: true, value: null });
  assertEquals(await source.enterSignInResponse(PVD, "Claude"), {
    ok: true,
    value: null,
  });
  await source.replaceKey(PVD, "main");
  await source.removeAccount(PVD, "spare");
  await source.enterServerCredential("mcp-notes");
  assertEquals(sent.map((item) => item.request), [
    {
      kind: "secret_input",
      owner: PVD,
      purpose: "provider_credential",
      credential: {
        key: "key-r1",
        kind: "api_key",
        label: "Work",
        account: null,
        organization: null,
        plan: null,
      },
    },
    {
      kind: "secret_input",
      owner: PVD,
      purpose: "provider_credential",
      credential: {
        key: "login-r1",
        kind: "oauth",
        label: "Claude",
        account: null,
        organization: null,
        plan: null,
      },
    },
    {
      kind: "secret_input",
      owner: PVD,
      purpose: "provider_credential",
      change: { key: "main", action: "replace" },
    },
    {
      kind: "secret_input",
      owner: PVD,
      purpose: "provider_credential",
      change: { key: "spare", action: "revoke" },
    },
    { kind: "secret_input", owner: "mcp-notes", purpose: "app_secret" },
  ]);
  assert(sent.every((item) => !JSON.stringify(item).includes("fingerprint")));
  // 창이 없거나 열리지 않으면 열린 것처럼 말하지 않는다.
  assertEquals(
    await coreSettingsSource(core, OPTIONS).connectKey(PVD, "Work"),
    { ok: false, code: "unavailable" },
  );
  const refused = coreSettingsSource(core, {
    ...OPTIONS,
    openWindow: () => Promise.resolve({ code: "forbidden" }),
  });
  assertEquals(await refused.removeAccount(PVD, "spare"), {
    ok: false,
    code: "forbidden",
  });
});

Deno.test("lophn-agent/harness/model#R9, shell/wording#R13: model 기본값은 읽은 비교 기준과 바꾸지 않는 쪽 원본을 그대로 돌려보내 한쪽만 바꾼다", async () => {
  const decisions = {
    provider: PVD,
    credentials: ["main"],
    model_name: "m1",
    reasoning_level: "high",
    options: { a: 1 },
  };
  const { core, calls } = fakeCore({
    "read:agent-model-defaults/read": () =>
      ok({
        defaults: { judgment: decisions, organizing: null, settings_seq: "9" },
      }),
    "command:agent-model-defaults/change": (body) => {
      const input = (body as { input: Record<string, unknown> }).input;
      return ok({
        judgment: input.judgment,
        organizing: input.organizing,
        settings_seq: "10",
      });
    },
  });
  const source = coreSettingsSource(core, OPTIONS);
  const read = await source.modelDefaults();
  assert(read.ok);
  assertEquals(read.value.decisions, { provider: PVD, model: "m1" });
  assertEquals(read.value.summaries, null);
  const saved = await source.setModelDefault("summaries", {
    provider: PVD,
    model: "m2",
    accounts: ["spare", "main"],
  }, read.value);
  assert(saved.ok);
  const body = calls[1]!.body as Record<string, unknown>;
  assertEquals(body.compare, { settings_seq: "9" });
  assertEquals(body.input, {
    judgment: decisions,
    organizing: {
      provider: PVD,
      credentials: ["spare", "main"],
      model_name: "m2",
      reasoning_level: "provider_default",
      options: {},
    },
    settings_seq: "9",
  });
  assertEquals(saved.value.summaries, { provider: PVD, model: "m2" });
  assertEquals(saved.value.seq, "10");
});

function settingsAnswers(
  servers: unknown[],
  folders: string[] = [],
): Record<string, (body: unknown) => CoreReply> {
  return {
    "read:settings/definitions": () =>
      ok({
        definitions: [
          {
            key: "shell.os_notifications",
            description: "Show a desktop notification.",
            default_present: true,
            default: false,
          },
          {
            key: "lophn-agent.extensions.skill_folders",
            description: "Folders.",
            default_present: true,
            default: [],
          },
          {
            key: "lophn-agent.extensions.mcp_servers",
            description: "Servers.",
            default_present: true,
            default: [],
          },
          { key: "unset.one", description: "Unset.", default_present: false },
        ],
        defaults_revision: "d1",
      }),
    "read:settings/get": () =>
      ok({
        settings: [
          {
            key: "shell.os_notifications",
            resolved: true,
            value: true,
            source_layer: "common",
            apply_at: "current_check",
          },
          {
            key: "lophn-agent.extensions.skill_folders",
            resolved: true,
            value: folders,
            source_layer: folders.length === 0 ? "builtin" : "common",
            apply_at: "next_run",
          },
          {
            key: "lophn-agent.extensions.mcp_servers",
            resolved: true,
            value: servers,
            source_layer: servers.length === 0 ? "builtin" : "common",
            apply_at: "next_run",
          },
          {
            key: "unset.one",
            resolved: false,
            value: null,
            source_layer: null,
            apply_at: "next_run",
          },
        ],
        revision: 7,
        defaults_revision: "d1",
      }),
    "read:secrets/list": (body) =>
      ok({
        secrets: (body as { names: string[] }).names.map((name) => ({
          name,
          configured: name === "mcp-notes",
          revision: name === "mcp-notes" ? 1 : null,
        })),
      }),
    "command:settings/apply": () =>
      ok({ revision: 8, changed: true, applied: [] }),
  };
}

function settingsCore(servers: unknown[], folders: string[] = []) {
  return fakeCore(settingsAnswers(servers, folders));
}

const HTTP_SERVER = (name: string, kind: string, ref?: string) => ({
  name,
  revision: 1,
  enabled: true,
  call_timeout_ms: 60_000,
  classifications: {},
  transport: "http",
  http: {
    url: "https://tools.example.com",
    headers: {},
    auth: { kind, ...(ref === undefined ? {} : { secret_ref: ref }) },
  },
});

Deno.test("shell/wording#R13: 설정은 정의와 현재 적용값·효력 시점·기본값을 합치고 확장 설정과 server의 credential 저장 여부(이름만)를 읽는다", async () => {
  const servers = [
    HTTP_SERVER("notes", "bearer", "sec:mcp-notes"),
    HTTP_SERVER("search", "api_key", "sec:mcp-search"),
    HTTP_SERVER("open", "none"),
  ];
  const { core, calls } = settingsCore(servers, ["/home/me/skills"]);
  const view = await coreSettingsSource(core, OPTIONS).settings();
  assert(view.ok);
  assertEquals(view.value.revision, 7);
  assertEquals(view.value.defaultsRevision, "d1");
  assertEquals(view.value.folders, ["/home/me/skills"]);
  const row = view.value.rows.find((r) => r.key === "shell.os_notifications")!;
  assertEquals(
    [row.title, row.value, row.changed, row.defaultValue, row.applyAt],
    ["Show a desktop notification.", true, true, false, "current_check"],
  );
  const unset = view.value.rows.find((r) => r.key === "unset.one")!;
  assertEquals([unset.resolved, unset.hasDefault, unset.changed], [
    false,
    false,
    false,
  ]);
  assertEquals(
    view.value.servers.map((s) => [s.name, s.auth, s.secret, s.credential]),
    [
      ["notes", "bearer", "mcp-notes", "set"],
      ["search", "api_key", "mcp-search", "missing"],
      ["open", "none", null, null],
    ],
  );
  const secrets = calls.find((call) => call.resource === "secrets")!;
  assertEquals(secrets.body, { names: ["mcp-notes", "mcp-search"] });
  // 값은 읽지 않는다. 이름과 저장 여부만이다.
  assert(!JSON.stringify(view.value).includes("Bearer"));
});

Deno.test("shell/wording#R10: skill 폴더는 OS 선택기가 준 폴더만 기존 목록 뒤에 더하고 읽은 비교 기준으로 적용하며 이미 있으면 다시 쓰지 않는다", async () => {
  const { core, calls } = settingsCore([], ["/home/me/old"]);
  const picks = ["/home/me/new", "/home/me/old", null];
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    picker: {
      pick: () => Promise.resolve({ ok: true, path: picks.shift() ?? null }),
    },
  });
  const view = await source.settings();
  assert(view.ok);
  const added = await source.addSkillFolder(view.value);
  assertEquals(added, { ok: true, value: { path: "/home/me/new" } });
  const apply = calls.find((call) => call.method === "apply")!.body as Record<
    string,
    unknown
  >;
  assertEquals(apply.compare, { revision: 7, defaults_revision: "d1" });
  assertEquals(apply.input, {
    changes: [{
      layer: "common",
      key: "lophn-agent.extensions.skill_folders",
      action: "set",
      value: ["/home/me/old", "/home/me/new"],
    }],
  });
  const applies = () => calls.filter((call) => call.method === "apply").length;
  assertEquals(await source.addSkillFolder(view.value), {
    ok: true,
    value: { path: "/home/me/old" },
  });
  assertEquals(applies(), 1);
  assertEquals(await source.addSkillFolder(view.value), {
    ok: true,
    value: null,
  });
  assertEquals(applies(), 1);
  const none = coreSettingsSource(core, OPTIONS);
  assertEquals(await none.addSkillFolder(view.value), {
    ok: false,
    code: "unavailable",
  });
});

Deno.test("shell/wording#R10: 도구 server는 기존 설정 뒤에 stdio 또는 HTTP 설정으로 더하고 credential은 값 없이 이름 참조(sec:)로만 가리킨다", async () => {
  const existing = HTTP_SERVER("notes", "none");
  const { core, calls } = settingsCore([existing]);
  const source = coreSettingsSource(core, OPTIONS);
  const view = await source.settings();
  assert(view.ok);
  assert(
    (await source.addServer(view.value, {
      transport: "stdio",
      name: "files",
      executable: "/usr/bin/files-mcp",
      args: ["--root", "/docs"],
    })).ok,
  );
  assert(
    (await source.addServer(view.value, {
      transport: "http",
      name: "search",
      url: "https://search.example.com/mcp",
      auth: "api_key",
      header: "X-Api-Key",
    })).ok,
  );
  assert(
    (await source.addServer(view.value, {
      transport: "http",
      name: "wiki",
      url: "http://127.0.0.1:9000/mcp",
      auth: "bearer",
      header: null,
    })).ok,
  );
  const values = calls.filter((call) => call.method === "apply").map((call) => {
    const change = (call.body as { input: { changes: { value: unknown[] }[] } })
      .input.changes[0]!;
    return change.value;
  });
  assertEquals(values[0], [existing, {
    name: "files",
    revision: 1,
    enabled: true,
    call_timeout_ms: 60_000,
    classifications: {},
    transport: "stdio",
    stdio: {
      executable: "/usr/bin/files-mcp",
      args: ["--root", "/docs"],
      cwd: null,
      env: {},
    },
  }]);
  const search = values[1]![1] as { http: { auth: unknown } };
  assertEquals(search.http.auth, {
    kind: "api_key",
    secret_ref: "sec:mcp-search",
    header_name: "X-Api-Key",
  });
  const wiki = values[2]![1] as { http: { auth: unknown } };
  assertEquals(wiki.http.auth, { kind: "bearer", secret_ref: "sec:mcp-wiki" });
  // 설정 정의의 값 모양을 그대로 통과한다.
  for (const value of values) {
    assert(mcpServersSetting.value_type.safeParse(value).success);
  }
});

Deno.test("shell/wording#R10: 보내는 입력과 비교 기준은 contract route의 schema를 그대로 통과한다", async () => {
  const route = (kind: string, resource: string, method: string) =>
    ALL_ROUTES.find((candidate) =>
      candidate.kind === kind && candidate.resource === resource &&
      candidate.method === method
    ) as unknown as {
      input: { safeParse(value: unknown): { success: boolean } };
      compare?: { safeParse(value: unknown): { success: boolean } };
    };
  const answer = (value: unknown) => () => ok(value);
  const { core, calls } = fakeCore({
    "read:providers/list": answer({ providers: [], next_cursor: null }),
    "read:providers/definitions": answer({ definitions: DEFINITIONS }),
    "command:providers/register": answer({ provider: {} }),
    "read:agent-model-defaults/read": answer({
      defaults: { judgment: null, organizing: null, settings_seq: "9" },
    }),
    "command:agent-model-defaults/change": answer({
      judgment: null,
      organizing: null,
      settings_seq: "10",
    }),
    "command:providers/test": answer({ check: null, timeout_ms: 30_000 }),
    "command:providers/login-begin": answer({
      login: "l",
      flow: "device_code",
      interval_ms: 5000,
      expires_at: "2026-10-07T00:10:00.000Z",
    }),
    "command:providers/login-cancel": answer({ cancelled: true }),
    "read:agent-usage/read": answer({ totals: [] }),
    "read:agent-model-catalog/read": answer({ entries: [] }),
    ...settingsAnswers([]),
  });
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    picker: { pick: () => Promise.resolve({ ok: true, path: "/home/me/s" }) },
    openWindow: () => Promise.resolve({ windowId: "w1" }),
  });
  assert((await source.providers()).ok);
  await source.connectKey("definition:openai", "Work");
  const defaults = await source.modelDefaults();
  assert(defaults.ok);
  await source.setModelDefault("decisions", {
    provider: PVD,
    model: "m1",
    accounts: ["main"],
  }, defaults.value);
  await source.testConnection({ provider: PVD, account: "main", model: "m1" });
  await source.beginSignIn(PVD);
  await source.cancelSignIn(PVD, "l");
  await source.usage("main");
  await source.models("claude-def");
  const view = await source.settings();
  assert(view.ok);
  await source.addSkillFolder(view.value);
  await source.addServer(view.value, {
    transport: "http",
    name: "wiki",
    url: "https://wiki.example.com/mcp",
    auth: "bearer",
    header: null,
  });
  await source.addServer(view.value, {
    transport: "stdio",
    name: "files",
    executable: "/usr/bin/files-mcp",
    args: [],
  });
  assert(calls.length >= 15);
  for (const call of calls) {
    const found = route(call.kind, call.resource, call.method);
    assert(found !== undefined, `${call.resource}/${call.method} is a route`);
    const body = call.body as Record<string, unknown>;
    const input = call.kind === "command" ? body.input : body;
    assert(
      found.input.safeParse(input).success,
      `${call.resource}/${call.method} input fits its schema`,
    );
    if (call.kind === "command" && found.compare !== undefined) {
      assert(
        found.compare.safeParse(body.compare).success,
        `${call.resource}/${call.method} compare fits its schema`,
      );
    }
  }
});
