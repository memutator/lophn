// Settings › Agents 통로(shell/desktop#R50). 부른 route·입력·비교 기준을 가짜 core 위에서 본다. 미리보기와
// 전역 skill 목록은 각자의 읽기 route에서, 끄고 켜기는 설정 registry의 skills_off로 적용한다. server 더하기와
// LOPHN.md 열기는 settings 화면이 연결하므로 이 통로에서는 unavailable이다. route는 contracts(models·
// mcp-settings·skill-settings·instructions·settings)를 따른다.
import { assert, assertEquals } from "@std/assert";

import {
  mcpServersSetting,
  skillsOffSetting,
} from "../../../../../../protocol/lophn-agent/mod.ts";
import {
  assertCallsFitRoutes,
  authStateAnswer,
  fail,
  fakeCore,
  HTTP_SERVER,
  OAUTH_SERVER,
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
    credential: {
      kind: "api_key",
      secret_ref: { name: "provider.x", sealed_ref: "sealed", revision: 1 },
      revision: 1,
      state: "available",
      unavailable_reason: null,
      until: null,
      expires_at: null,
      logged_in_at: null,
      refreshed_at: null,
      model_blocks: [],
    },
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

const SKILL_LINES = [
  {
    name: "team-style",
    description: "Team writing style",
    source_kind: "registered",
    enabled: true,
  },
  {
    name: "personal-notes",
    description: "My own notes",
    source_kind: "personal",
    enabled: false,
  },
  {
    name: "bundled-help",
    description: "Comes with lophn",
    source_kind: "bundled",
    enabled: true,
  },
];

function skillsAnswer(over: Record<string, unknown> = {}) {
  return ok({
    skills: SKILL_LINES,
    skills_off: ["personal-notes", "gone-for-now"],
    shadowed: [],
    skipped: [],
    as_of_seq: "5",
    next_cursor: null,
    ...over,
  });
}

function previewAnswer(preview: unknown) {
  return ok({ preview, as_of_seq: "5", next_cursor: null });
}

function agentsAnswers(servers: unknown[] = [], folders: string[] = []) {
  return {
    "read:instructions/preview": () =>
      previewAnswer({
        text: "# Rules\nBe brief.\n",
        size_bytes: 18,
        truncated: false,
      }),
    "read:global-skills/read": () => skillsAnswer(),
    "read:agent-model-defaults/read": () => ok({ defaults: DEFAULTS }),
    "read:providers/list": () =>
      ok({
        providers: [
          providerRecord(ANTHROPIC, "Anthropic", "anthropic"),
          providerRecord(OPENAI, "OpenAI", "openai"),
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
    "instructions/preview",
    "global-skills/read",
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
  // 연결된 provider가 고를 수 있는 provider 목록이다.
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

Deno.test("shell/desktop#R50 [agent-I46]: 전역 MCP server는 설정에서 읽되 끄면 off·credential이 없으면 needs-sign-in이다", async () => {
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

Deno.test("lophn-agent/extensions#R16 #R17 shell/desktop#R50 [agent-I52]: OAuth server의 상태는 core가 읽어 준 로그인 상태이고 signed_in일 때만 connected며 token 이름은 묻지 않는다", async () => {
  const servers = [
    OAUTH_SERVER("signed", "sec:mcp-oauth:global:signed"),
    OAUTH_SERVER("fresh", null),
    OAUTH_SERVER("broken", "sec:mcp-oauth:global:broken"),
    OAUTH_SERVER("waiting", null),
    { ...OAUTH_SERVER("paused", null), enabled: false },
  ];
  const { core, calls } = fakeCore({
    ...agentsAnswers(servers),
    "memory:agent-mcp-auth/state": authStateAnswer({
      signed: { state: "signed_in" },
      broken: { state: "failed", reason: "refresh_rejected" },
      waiting: { state: "in_progress" },
    }),
  });
  const result = await coreAgentsSettingsSource(core, OPTIONS).read();
  assert(result.ok);
  assertEquals(
    result.value.servers.map((row) => [row.name, row.status]),
    [
      ["signed", "connected"],
      ["fresh", "needs-sign-in"],
      ["broken", "needs-sign-in"],
      ["waiting", "needs-sign-in"],
      ["paused", "off"],
    ],
  );
  const states = calls.filter((call) => call.method === "state");
  assertEquals(states.length, 1);
  assertEquals(states[0]!.body, {
    servers: ["signed", "fresh", "broken", "waiting"].map((name) => ({
      name,
      place: null,
    })),
  });
  assertEquals(calls.find((call) => call.resource === "secrets"), undefined);
  assertCallsFitRoutes(states);
  // 상태를 읽지 못하면 로그인했다고 말하지 않는다.
  const blind = fakeCore({
    ...agentsAnswers(servers),
    "memory:agent-mcp-auth/state": () => fail("unavailable"),
  });
  const unread = await coreAgentsSettingsSource(blind.core, OPTIONS).read();
  assert(unread.ok);
  assertEquals(
    unread.value.servers.map((row) => row.status),
    ["needs-sign-in", "needs-sign-in", "needs-sign-in", "needs-sign-in", "off"],
  );
});

Deno.test("lophn-agent/instructions#R9 shell/desktop#R50 [agent-I49]: 모든 project의 LOPHN.md 미리보기는 사람 읽기 route의 앞부분이고 잘렸으면 말줄임으로 알리며 없거나 빈 파일이면 null이다", async () => {
  const read = async (preview: unknown) => {
    const { core } = fakeCore({
      ...agentsAnswers(),
      "read:instructions/preview": () => previewAnswer(preview),
    });
    const result = await coreAgentsSettingsSource(core, OPTIONS).read();
    assert(result.ok);
    return result.value.instructionsPreview;
  };
  assertEquals(
    await read({
      text: "# Rules\nBe brief.\n",
      size_bytes: 18,
      truncated: false,
    }),
    "# Rules\nBe brief.\n",
  );
  assertEquals(
    await read({ text: "# Rules\nBe", size_bytes: 9000, truncated: true }),
    "# Rules\nBe…",
  );
  assertEquals(await read(null), null);
  assertEquals(
    await read({ text: "", size_bytes: 0, truncated: false }),
    null,
  );
  // 사람이 읽는 route를 부르고 machine 전용 instructions/read나 run·층·경로를 보내지 않는다.
  const { core, calls } = fakeCore(agentsAnswers());
  await coreAgentsSettingsSource(core, OPTIONS).read();
  const previews = calls.filter((call) => call.resource === "instructions");
  assertEquals(previews.map((call) => [call.kind, call.method, call.body]), [
    ["read", "preview", {}],
  ]);
});

Deno.test("lophn-agent/extensions#R1 R4 shell/desktop#R50 [agent-I49]: 전역 skill은 목록 route의 이름·설명·켜짐을 옮기고 출처 이름과 본문·경로는 싣지 않는다", async () => {
  const { core } = fakeCore(agentsAnswers());
  const result = await coreAgentsSettingsSource(core, OPTIONS).read();
  assert(result.ok);
  assertEquals(result.value.skills, [
    { name: "team-style", detail: "Team writing style", enabled: true },
    { name: "personal-notes", detail: "My own notes", enabled: false },
    { name: "bundled-help", detail: "Comes with lophn", enabled: true },
  ]);
  assert(!JSON.stringify(result.value.skills).includes("registered"));
});

Deno.test("shell/desktop#R50 [agent-I49]: 미리보기나 skill 목록만 못 읽으면 그 칸만 비우고 나머지는 그대로 보인다", async () => {
  const { core } = fakeCore({
    ...agentsAnswers([HTTP_SERVER("notes", "none")]),
    "read:instructions/preview": () => fail("unavailable"),
    "read:global-skills/read": () => fail("unavailable"),
  });
  const result = await coreAgentsSettingsSource(core, OPTIONS).read();
  assert(result.ok);
  assertEquals(result.value.instructionsPreview, null);
  assertEquals(result.value.skills, []);
  assertEquals(result.value.servers.map((row) => row.name), ["notes"]);
  assertEquals(result.value.defaults.lophn?.modelName, "claude-sonnet-5-5");
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

Deno.test("shell/desktop#R50 [agent-I49]: skill을 끄면 지금 끈 이름 뒤에 그 이름만 더해 읽은 비교 기준으로 skills_off를 적용하고 지금 없는 끈 이름도 지우지 않는다", async () => {
  const { core, calls } = fakeCore(agentsAnswers());
  const source = coreAgentsSettingsSource(core, OPTIONS);
  assertEquals(await source.setSkillEnabled("team-style", false), {
    ok: true,
    value: null,
  });
  const apply = calls.find((call) => call.method === "apply")!.body as {
    input: {
      changes: { layer: string; key: string; action: string; value: unknown }[];
    };
    compare: unknown;
  };
  assertEquals(apply.compare, { revision: 7, defaults_revision: "d1" });
  assertEquals(apply.input.changes, [{
    layer: "common",
    key: "lophn-agent.extensions.skills_off",
    action: "set",
    value: ["personal-notes", "gone-for-now", "team-style"],
  }]);
  assert(
    skillsOffSetting.value_type.safeParse(apply.input.changes[0]!.value)
      .success,
  );
  assert(calls.some((call) => call.resource === "global-skills"));
});

Deno.test("shell/desktop#R50 [agent-I49]: skill을 켜면 끈 이름에서 그 이름만 빼고 나머지 끈 이름은 그대로 둔다", async () => {
  const { core, calls } = fakeCore(agentsAnswers());
  const source = coreAgentsSettingsSource(core, OPTIONS);
  assertEquals(await source.setSkillEnabled("personal-notes", true), {
    ok: true,
    value: null,
  });
  const apply = calls.find((call) => call.method === "apply")!.body as {
    input: { changes: { key: string; value: unknown }[] };
  };
  assertEquals(
    apply.input.changes[0]!.key,
    "lophn-agent.extensions.skills_off",
  );
  assertEquals(apply.input.changes[0]!.value, ["gone-for-now"]);
});

Deno.test("shell/desktop#R50 [agent-I49]: 이미 그 상태인 skill은 다시 쓰지 않고 목록에 없는 skill은 not_found이며 설정을 건드리지 않는다", async () => {
  const { core, calls } = fakeCore(agentsAnswers());
  const source = coreAgentsSettingsSource(core, OPTIONS);
  assertEquals(await source.setSkillEnabled("team-style", true), {
    ok: true,
    value: null,
  });
  assertEquals(await source.setSkillEnabled("personal-notes", false), {
    ok: true,
    value: null,
  });
  assertEquals(await source.setSkillEnabled("missing-skill", false), {
    ok: false,
    code: "not_found",
  });
  assertEquals(
    calls.filter((call) => call.method === "apply").length,
    0,
  );
});

Deno.test("shell/desktop#R50 [agent-I49]: skill을 켜고 끄다 설정이 그 사이 바뀌었으면 conflict가 그대로 가고 목록이나 설정을 못 읽으면 쓰지 않는다", async () => {
  const stale = fakeCore({
    ...agentsAnswers(),
    "command:settings/apply": () => fail("conflict"),
  });
  assertEquals(
    await coreAgentsSettingsSource(stale.core, OPTIONS).setSkillEnabled(
      "team-style",
      false,
    ),
    { ok: false, code: "conflict" },
  );
  for (const missing of ["read:global-skills/read", "read:settings/get"]) {
    const broken = fakeCore({
      ...agentsAnswers(),
      [missing]: () => fail("unavailable"),
    });
    assertEquals(
      await coreAgentsSettingsSource(broken.core, OPTIONS).setSkillEnabled(
        "team-style",
        false,
      ),
      { ok: false, code: "unavailable" },
    );
    assertEquals(
      broken.calls.filter((call) => call.method === "apply").length,
      0,
    );
  }
});

Deno.test("shell/desktop#R50 [agent-I49]: server 더하기와 LOPHN.md 열기는 form과 editor를 가진 settings 화면이 잇고 이 통로는 core를 부르지 않고 unavailable이다", async () => {
  const { core, calls } = fakeCore({});
  const source = coreAgentsSettingsSource(core, OPTIONS);
  const unavailable = { ok: false, code: "unavailable" } as const;
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
  await source.setSkillEnabled("team-style", false);
  assert(calls.length >= 10);
  assertCallsFitRoutes(calls);
});
