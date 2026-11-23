import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_CHARACTER_COLORS,
  AGENT_CHARACTER_SHAPES,
  type AgentAvatar,
} from "../../../protocol/lophn-agent/agent-values.ts";
import { LOPHN_HOME_ID } from "../../../protocol/lophn-agent/mod.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";

const AGENT = "agt_00000000000000000000000001";

// serializer가 avatar의 새 칸을 빠뜨리면 저장한 선택이 다음 읽기에서 사라진다.
test("정의 파일을 저장하고 다시 읽어도 character의 형태·색과 이미지 선택이 보존된다", () => {
  const target = { agent: AGENT } as const;
  const avatars: AgentAvatar[] = AGENT_CHARACTER_SHAPES.flatMap((shape) =>
    AGENT_CHARACTER_COLORS.map((color) => ({
      kind: "character" as const,
      shape,
      color,
    })),
  );
  avatars.push({ kind: "image", image: "avatar.png" });
  for (const avatar of avatars) {
    const definition = {
      handle: "reviewer",
      name: "reviewer",
      avatar,
      body: "Review changes.",
    };
    const saved = serializeAgentFile(definition, target);
    assert.ok(saved.ok);
    const read = parseAgentFile(saved.value, target);
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value, definition);
  }
});

// modality 칸이 저장 때 사라지면 Router가 거절하는 근거가 말없이 없어진다. 칸 없는 옛 정의는 그대로 읽혀야 한다.
test("modality는 저장하고 다시 읽어도 남고, 칸 없는 옛 정의도 읽힌다", () => {
  const target = { agent: AGENT } as const;
  const definition = {
    handle: "reader",
    name: "reader",
    modality: {
      input: ["text" as const, "image" as const],
      output: ["text" as const],
    },
    body: "Read.",
  };
  const saved = serializeAgentFile(definition, target);
  assert.ok(saved.ok);
  const read = parseAgentFile(saved.value, target);
  assert.ok(read.ok);
  assert.deepStrictEqual(read.value, definition);

  const old = parseAgentFile(
    "---\nhandle: reader\nname: reader\n---\nRead.\n",
    target,
  );
  assert.ok(old.ok);
  assert.strictEqual(old.value.modality, undefined);
});

test("remote_apps는 저장하고 다시 읽어도 남고, 칸 없는 옛 정의도 읽힌다", () => {
  const target = { agent: AGENT } as const;
  const definition = {
    handle: "browser-user",
    name: "browser-user",
    // 다른 기계의 앱 할당도 같은 whitelist를 지난다.
    remote_apps: [
      {
        machine: "mch_00000000000000000000000001",
        app: "app_00000000000000000000000001",
        name: "monitor",
        removed: ["stop"],
      },
    ],
    body: "Use the tools.",
  };
  const saved = serializeAgentFile(definition, target);
  assert.ok(saved.ok);
  const read = parseAgentFile(saved.value, target);
  assert.ok(read.ok);
  assert.deepStrictEqual(read.value, definition);

  const old = parseAgentFile(
    "---\nhandle: reader\nname: reader\n---\nRead.\n",
    target,
  );
  assert.ok(old.ok);
});

// serializer는 whitelist라 새 칸을 빠뜨리면 저장 때 조용히 사라진다. 내장 lophn은 custom이 될 수 없다.
test("runtime, description, tools, skills는 저장하고 다시 읽어도 남고, lophn runtime의 tools·skills와 내장 lophn의 custom은 거절된다", () => {
  const target = { agent: AGENT } as const;
  const definition = {
    handle: "ops",
    name: "ops",
    runtime: "custom" as const,
    description: "Checks the deploy queue",
    tools: ["file.read", "file.write", "mcp__github__issue"],
    skills: ["triage"],
    body: "Check.",
  };
  const saved = serializeAgentFile(definition, target);
  assert.ok(saved.ok);
  const read = parseAgentFile(saved.value, target);
  assert.ok(read.ok);
  assert.deepStrictEqual(read.value, definition);

  const lophnWithTools = serializeAgentFile(
    { ...definition, runtime: "lophn" },
    target,
  );
  assert.ok(!lophnWithTools.ok);
  assert.ok(
    !serializeAgentFile(
      { handle: "ops", name: "ops", skills: ["triage"], body: "" },
      target,
    ).ok,
  );
  assert.ok(
    !serializeAgentFile(
      { handle: "ops", name: "ops", tools: ["file.read"], body: "" },
      target,
    ).ok,
  );

  const builtin = { agent: LOPHN_HOME_ID } as const;
  assert.ok(
    !serializeAgentFile(
      { handle: "lophn", name: "lophn", runtime: "custom", body: "" },
      builtin,
    ).ok,
  );
  const text = "---\nruntime: custom\n---\nbody\n";
  assert.ok(!parseAgentFile(text, builtin).ok);
});

// harness_config는 harness runtime의 칸이고 model은 lophn·custom의 칸이다. 섞이면 한쪽이 조용히 무시되므로 저장 때 거절한다.
test("harness_config는 harness runtime에만, model은 harness가 아닌 runtime에만 둘 수 있고 다섯 harness 모두 runtime이 된다", () => {
  const target = { agent: AGENT } as const;
  const model = {
    provider: "pvd_00000000000000000000000000",
    model_name: "m",
    option_values: {},
  };
  const config = { model: "gpt-5", options: { effort: "high" } };
  for (const runtime of [
    "claude-code",
    "codex",
    "opencode",
    "omp",
    "antigravity",
  ] as const) {
    const base = { handle: "ops", name: "ops", runtime, body: "" };
    assert.ok(
      serializeAgentFile({ ...base, harness_config: config }, target).ok,
    );
    assert.ok(!serializeAgentFile({ ...base, model }, target).ok, runtime);
  }
  for (const runtime of [undefined, "lophn", "custom"] as const) {
    const base = {
      handle: "ops",
      name: "ops",
      body: "",
      ...(runtime ? { runtime } : {}),
    };
    assert.ok(
      !serializeAgentFile({ ...base, harness_config: config }, target).ok,
      String(runtime),
    );
    assert.ok(
      serializeAgentFile({ ...base, model }, target).ok,
      String(runtime),
    );
  }
});

test("harness_config는 저장하고 다시 읽어도 보존되고 빈 값은 파일에 쓰지 않는다", () => {
  const target = { agent: AGENT } as const;
  const base = {
    handle: "ops",
    name: "ops",
    runtime: "codex",
    body: "",
  } as const;
  const config = { model: "gpt-5", options: { speed: "fast", effort: "high" } };
  const written = serializeAgentFile(
    { ...base, harness_config: config },
    target,
  );
  assert.ok(written.ok);
  assert.match(
    written.value,
    /harness_config:\n  model: gpt-5\n  options:\n    effort: high\n    speed: fast\n/,
  );
  const read = parseAgentFile(written.value, target);
  assert.ok(read.ok);
  assert.deepStrictEqual(read.value.harness_config, config);

  for (const empty of [{}, { options: {} }]) {
    const text = serializeAgentFile({ ...base, harness_config: empty }, target);
    assert.ok(text.ok);
    assert.ok(!text.value.includes("harness_config"));
  }
  const noOptions = serializeAgentFile(
    { ...base, harness_config: { model: "m", options: {} } },
    target,
  );
  assert.ok(noOptions.ok);
  assert.ok(!noOptions.value.includes("options"));
});

// lophn.md에 handle을 적으면 주소가 흔들린다. name은 사람이 바꿀 수 있고 바꾼 값만 file에 남는다.
test("lophn은 handle·avatar를 file에 적을 수 없고 name은 바꾼 값만 쓴다", () => {
  const builtin = { agent: LOPHN_HOME_ID } as const;
  assert.ok(!parseAgentFile("---\nhandle: x\n---\n", builtin).ok);
  const empty = parseAgentFile("", builtin);
  assert.ok(empty.ok);
  assert.deepStrictEqual(
    [empty.value.handle, empty.value.name],
    ["lophn", "lophn"],
  );
  const renamed = serializeAgentFile(
    { handle: "lophn", name: "Mina", body: "" },
    builtin,
  );
  assert.ok(renamed.ok);
  assert.strictEqual(renamed.value, "---\nname: Mina\n---\n");
  const kept = serializeAgentFile(
    { handle: "lophn", name: "lophn", body: "" },
    builtin,
  );
  assert.ok(kept.ok);
  assert.strictEqual(kept.value, "");
});
