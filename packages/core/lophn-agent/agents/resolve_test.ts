import assert from "node:assert/strict";
import { test } from "node:test";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import { resolveAgent } from "./resolve.ts";

const TOOLS = ["file.read", "ticket.list"];
const PROJECT = "prj_00000000000000000000000001";
const AGENT = "agt_00000000000000000000000001";
const MODEL = {
  provider: "pvd_00000000000000000000000001",
  model_name: "m",
  option_values: {},
} as const;

const resolve = (definition: AgentFileDefinition) =>
  resolveAgent({
    agent: AGENT,
    place: { kind: "project", id: PROJECT },
    definition,
    global_model: MODEL,
    session_model: null,
    environment: { skills: [{ name: "s", can_disable: true }], mcp: [] },
    tools: TOOLS,
  });

test("bare는 고른 tool 이름을 그대로 picks로 갖고 skill을 받지 않는다. place 종류 tool 목록은 그대로다", async () => {
  const bare = await resolve({
    name: "reviewer",
    body: "review",
    runtime: "bare",
    tools: ["file.read", "call.reply", "mcp__x__y"],
  });
  assert.ok(bare.ok);
  assert.equal(bare.value.runtime, "bare");
  assert.deepEqual(bare.value.picks, ["file.read", "call.reply", "mcp__x__y"]);
  assert.deepEqual(bare.value.skills, []);
  assert.deepEqual(bare.value.tools, TOOLS);

  const plain = await resolve({ name: "reviewer", body: "review" });
  assert.ok(plain.ok);
  assert.equal(plain.value.runtime, "lophn");
  assert.deepEqual(plain.value.picks, []);
  assert.deepEqual(plain.value.skills, ["s"]);

  const lophn = await resolveAgent({
    agent: LOPHN_AGENT_ID,
    place: null,
    definition: null,
    global_model: MODEL,
    session_model: null,
    environment: { skills: [], mcp: [] },
    tools: TOOLS,
  });
  assert.ok(lophn.ok);
  assert.equal(lophn.value.runtime, "lophn");
});
