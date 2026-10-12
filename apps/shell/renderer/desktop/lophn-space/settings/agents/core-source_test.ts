// Settings › Agents 통로(shell/desktop#R50). 부른 route·입력·비교 기준을 가짜 core 위에서 본다. route에
// 없는 칸(전역 LOPHN.md 미리보기, skill 목록과 끄기, server 더하기)은 화면이 그 칸만 비우도록
// unavailable이거나 빈 값이다. route는 contracts(models·mcp-settings·skill-settings·settings)를 따른다.
import { assert, assertEquals } from "@std/assert";

import { mcpServersSetting } from "../../../../../../../packages/contracts/lophn-agent/mod.ts";
import {
  assertCallsFitRoutes,
  fail,
  fakeCore,
  HTTP_SERVER,
  ok,
  settingsAnswers,
} from "../testdata/fake-core.ts";
import { coreAgentsSettingsSource } from "./core-source.ts";

const ANTHROPIC = "pvd_01h455vb4pex5v6nkc6gd5fd11";
const OPENAI = "pvd_01h455vb4pex5v6nkc6gd5fd12";

const OPTIONS = { picker: undefined, random: () => "r1" };

const EMPTY_SLOTS = {
  lophn: null,
  context_engineer: null,
  app_engineer: null,
  operator: null,
  summaries: null,
};

const DEFAULTS = {
  ...EMPTY_SLOTS,
  lophn: {
    provider: ANTHROPIC,
    model_name: "claude-sonnet-5-5",
    option_values: { effort: "medium" },
  },
  summaries: {
    provider: OPENAI,
    model_name: "gpt-6.1-mini",
    option_values: {},
  },
  settings_seq: "7",
};

function providerRecord(id: string, name: string, key: string, over = {}) {
  return {
    id,
    name,
    definition: {
      key,
      display_name: name,
      protocols: ["openai-chat-completions"],
      auth_kinds: ["api_key"],
      models_endpoint: null,
      oauth: null,
      revision: "1",
    },
    endpoint: "https://api.example.com/v1",
    protocol: "openai-chat-completions",
    enabled: true,
    credentials: [],
    last_check: null,
    revision: 3,
    ...over,
  };
}

function entry(definition: string, model: string, options: unknown) {
  return {
    provider_definition: definition,
    model_name: model,
    context_limit: null,
    input_limit: null,
    output_limit: null,
    supports_tools: null,
    input_media: null,
    output_media: null,
    options,
    preview: null,
    deprecated: null,
    source: "release_snapshot",
    source_revision: "r1",
    checked_at: null,
    received_at: null,
    price_basis: null,
  };
}

const EFFORT = {
  id: "effort",
  label: "Effort",
  values: [
    { value: "low", label: "Low", wire: null },
    { value: "medium", label: "Medium", wire: null },
    { value: "high", label: "High", wire: null },
  ],
  default_value: "medium",
  budget: null,
};

const SPEED = {
  id: "speed",
  label: "Speed",
  values: [
    {
      value: "standard",
      label: "Standard",
      wire: { kind: "body_patch", patch: {} },
    },
    {
      value: "fast",
      label: "Fast",
      wire: { kind: "body_patch", patch: { fast: true } },
    },
  ],
  default_value: null,
  budget: null,
};

const CATALOG = {
  state: {
    auto_update: true,
    etag: null,
    last_checked_at: null,
    last_received_at: null,
    last_failure: null,
    snapshot_hash: "a".repeat(64),
  },
  entries: [
    entry("anthropic", "claude-sonnet-5-5", [EFFORT]),
    entry("anthropic", "claude-opus-5-5", [EFFORT, SPEED]),
    entry("openai", "gpt-6.1", null),
    entry("openai", "gpt-6.1-mini", []),
  ],
};

function agentsAnswers(servers: unknown[] = [], folders: string[] = []) {
  return {
    "read:agent-model-defaults/read": () => ok({ defaults: DEFAULTS }),
    "read:providers/list": () =>
      ok({
        providers: [
          providerRecord(ANTHROPIC, "Anthropic", "anthropic"),
          providerRecord(OPENAI, "OpenAI", "openai"),
          providerRecord("pvd_01h455vb4pex5v6nkc6gd5fd13", "xAI", "xai", {
            enabled: false,
          }),
        ],
        next_cursor: null,
      }),
    "read:agent-model-catalog/read": () => ok(CATALOG),
    ...settingsAnswers(servers, folders),
  };
}

Deno.test("shell/desktop#R50 [agent-I46]: Agents 화면 값은 기본값 칸 다섯·연결된 provider·model catalog를 하나씩 읽어 옮기고 option 값은 축 id로 둔다", async () => {
  const { core, calls } = fakeCore(agentsAnswers());
  const result = await coreAgentsSettingsSource(core, OPTIONS).read();
  assert(result.ok, JSON.stringify(result));
  // core reader는 동시 읽기 수를 제한하므로 하나씩 읽는다.
  assertEquals(calls.map((call) => `${call.resource}/${call.method}`), [
    "agent-model-defaults/read",
    "providers/list",
    "agent-model-catalog/read",
    "settings/get",
  ]);
  const view = result.value;
  assertEquals(view.settingsSeq, "7");
  assertEquals(view.defaults.lophn, {
    provider: ANTHROPIC,
    modelName: "claude-sonnet-5-5",
    optionValues: { effort: "medium" },
  });
  assertEquals(view.defaults.summaries, {
    provider: OPENAI,
    modelName: "gpt-6.1-mini",
    optionValues: {},
  });
  assertEquals(view.defaults.operator, null);
  assertEquals(view.defaults.context_engineer, null);
  // 끈 provider의 model은 고르지 못하게 연결 목록에서 뺀다.
  assertEquals(view.providers, [
    { id: ANTHROPIC, name: "Anthropic", definition: "anthropic" },
    { id: OPENAI, name: "OpenAI", definition: "openai" },
  ]);
  assertEquals(
    view.catalog.map((model) => [model.providerDefinition, model.modelName]),
    [
      ["anthropic", "claude-sonnet-5-5"],
      ["anthropic", "claude-opus-5-5"],
      ["openai", "gpt-6.1"],
      ["openai", "gpt-6.1-mini"],
    ],
  );
  // option 축은 id·이름·값 이름·기본값만 옮기고 wire는 싣지 않는다. 모르는 option은 null, 없는 option은 빈 배열이다.
  assertEquals(view.catalog[1]!.options, [
    {
      id: "effort",
      label: "Effort",
      values: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
      defaultValue: "medium",
    },
    {
      id: "speed",
      label: "Speed",
      values: [
        { value: "standard", label: "Standard" },
        { value: "fast", label: "Fast" },
      ],
      defaultValue: null,
    },
  ]);
  assertEquals(view.catalog[2]!.options, null);
  assertEquals(view.catalog[3]!.options, []);
  assert(!JSON.stringify(view).includes("wire"));
});

Deno.test("shell/desktop#R50 [agent-I46]: 전역 LOPHN.md 미리보기와 skill 목록을 읽을 route가 없어 그 칸은 비어 있고 전역 MCP server는 설정에서 읽되 끄면 off·credential이 없으면 needs-sign-in이다", async () => {
  const servers = [
    HTTP_SERVER("notes", "bearer", "sec:mcp-notes"),
    HTTP_SERVER("search", "api_key", "sec:mcp-search"),
    HTTP_SERVER("open", "none"),
    { ...HTTP_SERVER("paused", "none"), enabled: false },
    {
      name: "files",
      revision: 1,
      enabled: true,
      call_timeout_ms: 60_000,
      classifications: {},
      transport: "stdio",
      stdio: { executable: "/usr/bin/files-mcp", args: [], cwd: null, env: {} },
    },
  ];
  const { core, calls } = fakeCore(agentsAnswers(servers, ["/home/me/skills"]));
  const result = await coreAgentsSettingsSource(core, OPTIONS).read();
  assert(result.ok);
  assertEquals(result.value.instructionsPreview, null);
  assertEquals(result.value.skills, []);
  assertEquals(
    result.value.servers.map((row) => [row.name, row.enabled, row.status]),
    [
      ["notes", true, "connected"],
      ["search", true, "needs-sign-in"],
      ["open", true, "connected"],
      ["paused", false, "off"],
      ["files", true, "connected"],
    ],
  );
  assertEquals(result.value.servers[4]!.detail, "/usr/bin/files-mcp");
  assertEquals(result.value.servers[0]!.detail, "https://tools.example.com");
  // credential 값은 읽지 않고 이름과 저장 여부만 묻는다.
  const secrets = calls.find((call) => call.resource === "secrets")!;
  assertEquals(secrets.body, { names: ["mcp-notes", "mcp-search"] });
  assert(!JSON.stringify(result.value).includes("sec:"));
});

Deno.test("shell/desktop#R50 [agent-I46]: 기본값·provider·catalog 가운데 하나라도 못 읽으면 그 오류가 가고 설정만 못 읽으면 server 칸만 비운다", async () => {
  for (
    const missing of [
      "read:agent-model-defaults/read",
      "read:providers/list",
      "read:agent-model-catalog/read",
    ]
  ) {
    const answers: Record<string, () => ReturnType<typeof ok>> = {
      ...agentsAnswers(),
      [missing]: () => fail("unavailable"),
    };
    const { core } = fakeCore(answers);
    assertEquals(await coreAgentsSettingsSource(core, OPTIONS).read(), {
      ok: false,
      code: "unavailable",
    });
  }
  const { core } = fakeCore({
    ...agentsAnswers(),
    "read:settings/get": () => fail("unavailable"),
  });
  const result = await coreAgentsSettingsSource(core, OPTIONS).read();
  assert(result.ok);
  assertEquals(result.value.servers, []);
  assertEquals(result.value.defaults.lophn?.modelName, "claude-sonnet-5-5");
});

Deno.test("lophn-agent/harness/model#R9, shell/desktop#R50 [agent-I46]: 기본값 한 칸을 바꿀 때는 그 칸만 model·option과 함께 싣고 읽은 settingsSeq를 비교 기준으로 보낸다", async () => {
  const { core, calls } = fakeCore({
    "command:agent-model-defaults/change": () =>
      ok({ defaults: { ...DEFAULTS, settings_seq: "8" } }),
  });
  const source = coreAgentsSettingsSource(core, OPTIONS);
  const saved = await source.changeDefault("operator", {
    provider: OPENAI,
    modelName: "gpt-6.1",
    optionValues: { effort: "high" },
  }, "7");
  assertEquals(saved, { ok: true, value: null });
  const body = calls[0]!.body as Record<string, unknown>;
  assertEquals(body.input, {
    operator: {
      provider: OPENAI,
      model_name: "gpt-6.1",
      option_values: { effort: "high" },
    },
  });
  assertEquals(body.compare, { settings_seq: "7" });
  // 그 사이 바뀌었으면 conflict가 그대로 간다.
  const stale = fakeCore({
    "command:agent-model-defaults/change": () => fail("conflict"),
  });
  assertEquals(
    await coreAgentsSettingsSource(stale.core, OPTIONS).changeDefault(
      "summaries",
      { provider: OPENAI, modelName: "gpt-6.1-mini", optionValues: {} },
      "6",
    ),
    { ok: false, code: "conflict" },
  );
});

Deno.test("shell/desktop#R50 [agent-I46]: [Add skill]은 OS 선택기가 준 폴더를 읽은 비교 기준으로 기존 skill 폴더 뒤에 더하고 이미 있으면 다시 쓰지 않으며 그만두면 아무것도 하지 않는다", async () => {
  const { core, calls } = fakeCore(agentsAnswers([], ["/home/me/old"]));
  const picks = ["/home/me/new", "/home/me/old", null];
  const source = coreAgentsSettingsSource(core, {
    ...OPTIONS,
    picker: {
      pick: () => Promise.resolve({ ok: true, path: picks.shift() ?? null }),
    },
  });
  assertEquals(await source.addSkill(), { ok: true, value: null });
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
  assertEquals(await source.addSkill(), { ok: true, value: null });
  assertEquals(await source.addSkill(), { ok: true, value: null });
  assertEquals(applies(), 1);
  const none = coreAgentsSettingsSource(core, OPTIONS);
  assertEquals(await none.addSkill(), { ok: false, code: "unavailable" });
});

Deno.test("shell/desktop#R50 [agent-I46]: server를 켜고 끄면 설정의 server 목록에서 그 server의 enabled만 바꿔 읽은 비교 기준으로 적용하고 없는 server는 not_found다", async () => {
  const notes = HTTP_SERVER("notes", "bearer", "sec:mcp-notes");
  const open = HTTP_SERVER("open", "none");
  const { core, calls } = fakeCore(agentsAnswers([notes, open]));
  const source = coreAgentsSettingsSource(core, OPTIONS);
  assertEquals(await source.setServerEnabled("notes", false), {
    ok: true,
    value: null,
  });
  const apply = calls.find((call) => call.method === "apply")!.body as {
    input: { changes: { key: string; value: unknown[] }[] };
    compare: unknown;
  };
  assertEquals(apply.compare, { revision: 7, defaults_revision: "d1" });
  assertEquals(
    apply.input.changes[0]!.key,
    "lophn-agent.extensions.mcp_servers",
  );
  assertEquals(apply.input.changes[0]!.value, [
    { ...notes, enabled: false },
    open,
  ]);
  assert(
    mcpServersSetting.value_type.safeParse(apply.input.changes[0]!.value)
      .success,
  );
  const applies = () => calls.filter((call) => call.method === "apply").length;
  assertEquals(await source.setServerEnabled("missing", true), {
    ok: false,
    code: "not_found",
  });
  assertEquals(applies(), 1);
});

Deno.test("shell/desktop#R50 [agent-I46]: skill 켜고 끄기·server 더하기·LOPHN.md 열기는 이 통로에 core route가 없어 core를 부르지 않고 unavailable이다", async () => {
  const { core, calls } = fakeCore({});
  const source = coreAgentsSettingsSource(core, OPTIONS);
  const unavailable = { ok: false, code: "unavailable" };
  assertEquals(await source.setSkillEnabled("notes", false), unavailable);
  assertEquals(await source.addServer(), unavailable);
  assertEquals(await source.openInstructions(), unavailable);
  assertEquals(calls, []);
});

Deno.test("shell/desktop#R50 [agent-I46]: 보내는 입력과 비교 기준은 contract route의 schema를 그대로 통과한다", async () => {
  const { core, calls } = fakeCore({
    ...agentsAnswers([HTTP_SERVER("notes", "none")]),
    "command:agent-model-defaults/change": () =>
      ok({ defaults: { ...DEFAULTS, settings_seq: "8" } }),
  });
  const source = coreAgentsSettingsSource(core, {
    ...OPTIONS,
    picker: { pick: () => Promise.resolve({ ok: true, path: "/home/me/s" }) },
  });
  await source.read();
  await source.changeDefault("lophn", {
    provider: ANTHROPIC,
    modelName: "claude-sonnet-5-5",
    optionValues: {},
  }, "7");
  await source.addSkill();
  await source.setServerEnabled("notes", false);
  assert(calls.length >= 7);
  assertCallsFitRoutes(calls);
});
