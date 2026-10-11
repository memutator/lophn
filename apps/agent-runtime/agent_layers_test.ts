import { assert, assertEquals } from "@std/assert";
import type { McpTool } from "../../packages/contracts/lophn-agent/mod.ts";
import { resolveRunAgent } from "./agent-layers.ts";
import { ASG, MODEL, openWorld, RUN, SES } from "./testing/world.ts";

// resolved agent가 켠 MCP만 쓴다: 서버 통째로 끈 것은 연결하기 전에 알리고, tool 하나만 끈 것은 목록에서 뺀다
// (lophn-agent/extensions R18, R31, lophn-agent/agents R19).

const RUN_RECORD = { id: RUN, session: SES, source: { kind: "message" } };
const ASSIGNMENT = {
  id: ASG,
  role: "lophn" as const,
  scope: { kind: "all", id: null },
};

const CONNECTED: McpTool[] = [
  { server_name: "notes", original_tool: "a" },
  { server_name: "notes", original_tool: "b" },
  { server_name: "scoped", original_tool: "lookup" },
];

Deno.test("lophn-agent/extensions#R31 lophn-agent/extensions#R18 [agent-I19b]: the servers an agent turned off are told before connecting and the tools it turned off are not in its list", async () => {
  const world = openWorld({
    workspaceModels: { lophn: MODEL() },
    definition: {
      mcp_off: [
        { server_name: "scoped" },
        { server_name: "notes", original_tool: "b" },
      ],
      body: "",
    },
  });
  let told: ReadonlySet<string> | undefined;
  const made = await resolveRunAgent(world.calls.machine, {
    run: RUN_RECORD,
    assignment: ASSIGNMENT,
    skills: [],
    mcp: (off) => {
      told = off;
      return Promise.resolve(
        CONNECTED.filter((tool) => !off.has(tool.server_name)),
      );
    },
  });
  assert(made.ok, made.ok ? "" : JSON.stringify(made.error));
  assert(made.value.kind === "resolved");
  // 서버 통째로 끈 것만 알린다. tool 하나만 끈 서버는 다른 tool 때문에 연결해야 한다.
  assertEquals([...told!], ["scoped"]);
  assertEquals(made.value.agent.mcp, [
    { server_name: "notes", original_tool: "a" },
  ]);
});

Deno.test("lophn-agent/extensions#R31 [agent-I19b]: an agent that turned nothing off connects every server and takes every tool", async () => {
  const world = openWorld({ workspaceModels: { lophn: MODEL() } });
  let told: ReadonlySet<string> | undefined;
  const made = await resolveRunAgent(world.calls.machine, {
    run: RUN_RECORD,
    assignment: ASSIGNMENT,
    skills: [],
    mcp: (off) => {
      told = off;
      return Promise.resolve(CONNECTED);
    },
  });
  assert(made.ok, made.ok ? "" : JSON.stringify(made.error));
  assert(made.value.kind === "resolved");
  assertEquals([...told!], []);
  assertEquals(made.value.agent.mcp, CONNECTED);
});

Deno.test("lophn-agent/extensions#R4 [agent-I19b]: skills the agent turned off by exact name are not in its list, and a name that is not found now stays off", async () => {
  const world = openWorld({
    workspaceModels: { lophn: MODEL() },
    definition: { skills_off: ["turn-off", "not-found-now"], body: "" },
  });
  const made = await resolveRunAgent(world.calls.machine, {
    run: RUN_RECORD,
    assignment: ASSIGNMENT,
    skills: ["keep-me", "turn-off"],
    mcp: () => Promise.resolve([]),
  });
  assert(made.ok, made.ok ? "" : JSON.stringify(made.error));
  assert(made.value.kind === "resolved");
  assertEquals(made.value.agent.skills, ["keep-me"]);
});
