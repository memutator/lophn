import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  createGuideToolHandlers,
  executeTool,
  GUIDE_TOOLS,
  listTools,
  type RunCredential,
  runOperations,
  TOOL_BUNDLES,
} from "./mod.ts";

// 제품 안내·설정 읽기 tool(lophn.guide, setting.read)을 본다. 가짜 통로만 쓰고 실제 core·provider·
// 사람 데이터 root는 열지 않는다.

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

type Call = { contract: string; input: unknown; run: string };

const GUIDE_LIST = {
  lophn_version: "1.4.0",
  guides: [
    {
      lophn_version: "1.4.0",
      title: "Settings",
      content_hash: HASH,
      files: [{ path: "roles/lophn/guides/settings.md", primary: true }],
    },
    {
      lophn_version: "1.4.0",
      title: "Revert",
      content_hash: "cd".repeat(32),
      files: [{ path: "roles/lophn/guides/revert.md", primary: true }],
    },
  ],
  next_cursor: null,
  complete: true,
};

const DEFINITIONS = {
  definitions: [
    {
      key: "shell.reading_width",
      owner: "shell/design-system",
      description: "Reading width.",
      display_name_key: "settings.reading-width.name",
      value_meaning_key: "settings.reading-width.value",
      default_meaning_key: "settings.reading-width.default",
      affected_features: ["shell"],
      risk_key: "settings.reading-width.risk",
      revert_key: "settings.reading-width.revert",
      constraints: { minimum: 60 },
      required: false,
      layers: ["common"],
      apply_at: "next_run",
      apply_at_key: "settings.reading-width.apply_at",
      machine_local: false,
      value_type: { type: "number" },
      default_present: true,
      default: 80,
    },
    {
      key: "provider.api_token",
      owner: "lophn-agent/harness/provider",
      description: "A credential reference.",
      display_name_key: "settings.provider.token.name",
      value_meaning_key: "settings.provider.token.value",
      default_meaning_key: "settings.provider.token.default",
      affected_features: ["provider"],
      risk_key: "settings.provider.token.risk",
      revert_key: "settings.provider.token.revert",
      constraints: {},
      required: false,
      layers: ["common"],
      apply_at: "next_call",
      apply_at_key: "settings.provider.token.apply_at",
      machine_local: true,
      value_type: { type: "string" },
      default_present: true,
      default: "sk-default-secret",
    },
  ],
  defaults_revision: "defaults-1",
  as_of_seq: "5",
};

const SETTINGS = {
  settings: [
    {
      key: "shell.reading_width",
      resolved: true,
      value: 90,
      source_layer: "common",
      choices: [{ layer: "common", key: "shell.reading_width", value: 90 }],
      revision: 3,
      apply_at: "next_run",
    },
    {
      key: "provider.api_token",
      resolved: true,
      value: "sk-live-secret",
      source_layer: "common",
      choices: [],
      revision: 3,
      apply_at: "next_call",
    },
  ],
  revision: 3,
  defaults_revision: "defaults-1",
  as_of_seq: "5",
};

function ports(calls: Call[]) {
  return {
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>> {
      calls.push({ contract, input, run });
      const wanted = (input as { keys?: string[] }).keys;
      switch (contract) {
        case "guide.list":
          return Promise.resolve(ok(GUIDE_LIST));
        case "guide.read":
          return Promise.resolve(ok({
            section: (input as { section: string | null }).section,
            section_status: "found",
            text: "## Applying a change\nA change applies at the next run.",
            failure_reason: null,
            complete: true,
            next_cursor: null,
          }));
        case "SettingsDefinitions":
          return Promise.resolve(ok({
            ...DEFINITIONS,
            definitions: DEFINITIONS.definitions.filter((definition) =>
              wanted === undefined || wanted.includes(definition.key)
            ),
          }));
        case "GetSettings":
          return Promise.resolve(ok({
            ...SETTINGS,
            settings: SETTINGS.settings.filter((setting) =>
              wanted === undefined || wanted.includes(setting.key)
            ),
          }));
        default:
          return Promise.resolve(
            err({ code: "forbidden", message: "not a read contract" }),
          );
      }
    },
  };
}

function credential(): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(["guide.read", "GetSettings"]),
  };
}

function deps(calls: Call[]) {
  const names = GUIDE_TOOLS.map((tool) => tool.name);
  return {
    listed: listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: names, roleTools: names },
    ),
    handlers: createGuideToolHandlers(ports(calls)),
    credential: credential(),
  };
}

Deno.test("lophn-agent/harness/tools#R20: 안내 묶음은 lophn.guide와 setting.read 읽기 tool뿐이고 어느 tool도 설정을 바꾸는 command를 소유 contract로 갖지 않는다", () => {
  assertEquals(GUIDE_TOOLS.map((tool) => tool.name), [
    "lophn.guide",
    "setting.read",
  ]);
  for (const tool of GUIDE_TOOLS) {
    assertEquals(tool.effect, "read", tool.name);
    assertEquals(tool.confirm, false, tool.name);
  }
  assertEquals(TOOL_BUNDLES.get("lophn-guide"), [
    "lophn.guide",
    "setting.read",
  ]);
  for (const tool of BUILTIN_TOOLS) {
    assert(
      !["ApplySettings", "ReloadSettings"].includes(tool.contract),
      tool.name,
    );
    assert(!/settings?\.(apply|set|change|write)/.test(tool.name), tool.name);
  }
  // run 자격에는 읽기 operation만 더해진다.
  assertEquals(
    [...runOperations(GUIDE_TOOLS)].sort(),
    ["GetSettings", "SettingsDefinitions", "guide.list", "guide.read"],
  );
});

Deno.test("lophn-agent/harness/tools#R20: setting.read는 정의·현재 값·출처·적용 시점을 읽고 secret 항목은 값 없이 정의만 준다", async () => {
  const calls: Call[] = [];
  const outcome = await executeTool(deps(calls), "setting.read", {});
  assertEquals(outcome.outcome.kind, "success");
  const content = outcome.result.content as {
    defaults_revision: string;
    settings: Record<string, unknown>[];
  };
  assertEquals(content.defaults_revision, "defaults-1");
  const [normal, secret] = content.settings;
  assertEquals(normal["key"], "shell.reading_width");
  assertEquals(normal["value"], 90);
  assertEquals(normal["source_layer"], "common");
  assertEquals(normal["default"], 80);
  assertEquals(normal["apply_at"], "next_run");
  assertEquals(normal["value_meaning_key"], "settings.reading-width.value");
  assertEquals(normal["value_hidden"], false);
  assertEquals(secret["key"], "provider.api_token");
  assertEquals(secret["value_hidden"], true);
  assertEquals(secret["apply_at"], "next_call");
  assert(!("value" in secret) && !("default" in secret));
  assert(!JSON.stringify(outcome.result).includes("sk-"));
  // 등록되지 않은 key를 묻으면 없는 항목을 만들어 말하지 않는다.
  const unknown = await executeTool(deps(calls), "setting.read", {
    keys: ["no.such_key"],
  });
  assertEquals(unknown.outcome.code, "not_found");
});

Deno.test("lophn-agent/harness/tools#R20: 안내·설정 handler는 읽기 contract만 부르고 값을 바꾸려는 입력은 소유 contract에 닿기 전에 거절한다", async () => {
  const calls: Call[] = [];
  const run = deps(calls);
  await executeTool(run, "lophn.guide", {});
  await executeTool(run, "lophn.guide", { feature: "settings" });
  await executeTool(run, "setting.read", { keys: ["shell.reading_width"] });
  const names = new Set(calls.map((call) => call.contract));
  assertEquals(
    [...names].sort(),
    ["GetSettings", "SettingsDefinitions", "guide.list", "guide.read"],
  );
  const before = calls.length;
  for (
    const [tool, input] of [
      ["setting.read", { keys: ["shell.reading_width"], value: 100 }],
      ["setting.read", { changes: [{ key: "shell.reading_width" }] }],
      ["lophn.guide", { feature: "Settings", apply: true }],
    ] as const
  ) {
    const rejected = await executeTool(run, tool, input);
    assertEquals(rejected.outcome.code, "invalid_input", tool);
    assertEquals(rejected.executed, false, tool);
  }
  assertEquals(calls.length, before);
});

Deno.test("lophn-agent/harness/tools#R20: lophn.guide는 안내 목록과 현재 제품 판, 한 절을 읽고 없는 안내는 지어 내지 않는다", async () => {
  const calls: Call[] = [];
  const run = deps(calls);
  const listed = await executeTool(run, "lophn.guide", {});
  assertEquals(listed.outcome.kind, "success");
  assertEquals(listed.result.content, {
    lophn_version: "1.4.0",
    guides: [
      { title: "Settings", content_hash: HASH },
      { title: "Revert", content_hash: "cd".repeat(32) },
    ],
  });
  const read = await executeTool(run, "lophn.guide", {
    feature: "settings",
    section: "Applying a change",
  });
  assertEquals(read.outcome.kind, "success");
  const content = read.result.content as Record<string, unknown>;
  assertEquals(content["lophn_version"], "1.4.0");
  assertEquals(content["title"], "Settings");
  assertEquals(content["section"], "Applying a change");
  assertEquals(
    content["text"],
    "## Applying a change\nA change applies at the next run.",
  );
  const readCall = calls.find((call) => call.contract === "guide.read")!;
  assertEquals(readCall.input, {
    reference: {
      lophn_version: "1.4.0",
      title: "Settings",
      content_hash: HASH,
    },
    path: "roles/lophn/guides/settings.md",
    section: "Applying a change",
    max_codepoints: 6000,
  });
  const before = calls.filter((call) => call.contract === "guide.read").length;
  const unknown = await executeTool(run, "lophn.guide", { feature: "Billing" });
  assertEquals(unknown.outcome.code, "not_found");
  assertEquals(unknown.result.content, null);
  assertEquals(
    calls.filter((call) => call.contract === "guide.read").length,
    before,
  );
});
