import assert from "node:assert/strict";
import { test } from "node:test";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/mod.ts";
import { parseAgentFile } from "./definition-file.ts";
import { resolveAgent } from "./resolve.ts";

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
      environment: { skills: [], mcp: [] },
      tools: TOOLS,
    });
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.value.tools, TOOLS);
  }
});
