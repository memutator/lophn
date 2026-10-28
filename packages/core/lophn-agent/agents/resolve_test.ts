import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AgentDefinition,
  LOPHN_AGENT_ID,
} from "../../../protocol/lophn-agent/mod.ts";
import { parseAgentFile } from "./definition-file.ts";
import { type AvailableSkill, resolveAgent } from "./resolve.ts";

const TOOLS = ["file.read", "ticket.list"];
const PROJECT = "prj_00000000000000000000000001";
const AGENT = "agt_00000000000000000000000001";
const MODEL = {
  provider: "pvd_00000000000000000000000001",
  model_name: "m",
  option_values: {},
} as const;

test("정의 파일에 tool을 적어도 받은 tool 목록은 바뀌지 않는다", async () => {
  const written = parseAgentFile(
    `---\nname: reviewer\npermissions:\n  tools:\n    - file.write\n---\nbody\n`,
    { agent: AGENT },
  );
  assert.ok(!written.ok);

  for (const lophn of [true, false]) {
    const resolved = await resolveAgent({
      agent: lophn ? LOPHN_AGENT_ID : AGENT,
      place: lophn ? null : { kind: "project", id: PROJECT },
      definition: lophn ? null : { name: "reviewer", body: "review" },
      global_model: MODEL,
      session_model: null,
      environment: { skills: [], mcp: [], domains: [] },
      tools: TOOLS,
    });
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.value.tools, TOOLS);
  }
});

// 다른 domain의 skill이 섞이면 그 domain의 지식·절차가 이 agent의 일에 새어 들어온다.
test("agent가 domain 하나를 고르면 그 domain만 일하고 다른 domain의 skill은 받지 않는다", async () => {
  const A = "dom_00000000000000000000000001";
  const B = "dom_00000000000000000000000002";
  const skills: AvailableSkill[] = [
    { name: "built-in", can_disable: false, domain: null },
    { name: "global", can_disable: true, domain: null },
    { name: "in-a", can_disable: true, domain: A },
    { name: "in-b", can_disable: true, domain: B },
  ];
  const resolve = async (definition: AgentDefinition, container = [A, B]) => {
    const resolved = await resolveAgent({
      agent: AGENT,
      place: { kind: "project", id: PROJECT },
      definition,
      global_model: MODEL,
      session_model: null,
      environment: { skills, mcp: [], domains: container },
      tools: TOOLS,
    });
    assert.ok(resolved.ok);
    return resolved.value;
  };

  const one = await resolve({ name: "r", body: "x", domains: [B] });
  assert.deepEqual(one.domains, [B]);
  assert.deepEqual(one.skills, ["built-in", "global", "in-b"]);

  const all = await resolve({ name: "r", body: "x" });
  assert.deepEqual(all.domains, [A, B]);
  assert.deepEqual(all.skills, ["built-in", "global", "in-a", "in-b"]);
  const archived = await resolve({ name: "r", body: "x", domains: [A, B] }, [
    B,
  ]);
  assert.deepEqual(archived.domains, [B]);
  assert.deepEqual(archived.skills, ["built-in", "global", "in-b"]);
});
