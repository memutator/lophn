import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_CHARACTER_COLORS,
  AGENT_CHARACTER_SHAPES,
  type Profile,
} from "../../../protocol/lophn-agent/agent-values.ts";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/mod.ts";
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
    const definition = { name: "reviewer", profile, body: "Review changes." };
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

  const old = parseAgentFile("---\nname: reader\n---\nRead.\n", target);
  assert.ok(old.ok);
  assert.strictEqual(old.value.modality, undefined);
});

// serializer는 whitelist라 새 칸을 빠뜨리면 저장 때 조용히 사라진다. 내장 lophn은 bare가 될 수 없다.
test("runtime, description, tools, skills는 저장하고 다시 읽어도 남고, lophn runtime의 tools·skills와 내장 lophn의 bare는 거절된다", () => {
  const target = { agent: AGENT } as const;
  const definition = {
    name: "ops",
    runtime: "bare" as const,
    description: "Checks the deploy queue",
    tools: ["file.read", "call.reply", "mcp__github__issue"],
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
    !serializeAgentFile({ name: "ops", skills: ["triage"], body: "" }, target)
      .ok,
  );
  assert.ok(
    !serializeAgentFile({ name: "ops", tools: ["file.read"], body: "" }, target)
      .ok,
  );

  const builtin = { agent: LOPHN_AGENT_ID } as const;
  assert.ok(
    !serializeAgentFile({ name: "lophn", runtime: "bare", body: "" }, builtin)
      .ok,
  );
  const text = "---\nruntime: bare\n---\nbody\n";
  assert.ok(!parseAgentFile(text, builtin).ok);
});
