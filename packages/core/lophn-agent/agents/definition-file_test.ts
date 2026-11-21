import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_CHARACTER_COLORS,
  AGENT_CHARACTER_SHAPES,
  type Profile,
} from "../../../protocol/lophn-agent/agent-values.ts";
import { LOPHN_HOME_ID } from "../../../protocol/lophn-agent/mod.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";

const AGENT = "agt_00000000000000000000000001";

// serializer가 profile의 새 칸을 빠뜨리면 저장한 선택이 다음 읽기에서 사라진다.
test("정의 파일을 저장하고 다시 읽어도 character의 형태·색과 이미지 선택이 보존된다", () => {
  const target = { agent: AGENT } as const;
  const profiles: Profile[] = AGENT_CHARACTER_SHAPES.flatMap((shape) =>
    AGENT_CHARACTER_COLORS.map((color) => ({
      kind: "character" as const,
      shape,
      color,
    })),
  );
  profiles.push({ kind: "image", image: "avatar.png" });
  for (const profile of profiles) {
    const definition = {
      handle: "reviewer",
      name: "reviewer",
      profile,
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

// serializer는 whitelist라 `extensions`를 빠뜨리면 사람이 할당한 extension이 저장 때 조용히 사라진다.
test("extensions와 remote_apps는 저장하고 다시 읽어도 남고, 칸 없는 옛 정의도 읽힌다", () => {
  const target = { agent: AGENT } as const;
  const definition = {
    handle: "browser-user",
    name: "browser-user",
    extensions: ["browser-use", "web"],
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
  assert.strictEqual(old.value.extensions, undefined);
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
  // headless 명령이 없는 harness는 사람이 만든 agent의 runtime이 아니다(그 session이 돌 길이 없다).
  for (const runtime of ["omp", "antigravity"]) {
    const harness = `---\nhandle: ops\nname: ops\nruntime: ${runtime}\n---\nbody\n`;
    assert.ok(!parseAgentFile(harness, target).ok, runtime);
  }
});

// lophn.md에 handle을 적으면 주소가 흔들린다. name은 사람이 바꿀 수 있고 바꾼 값만 file에 남는다.
test("lophn은 handle·profile을 file에 적을 수 없고 name은 바꾼 값만 쓴다", () => {
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
