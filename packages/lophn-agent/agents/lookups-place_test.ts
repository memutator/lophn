import { assert, assertEquals } from "@std/assert";
import type { AgentPlace } from "../../protocol/lophn-agent/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../protocol/platform/mod.ts";
import { createAgentReads } from "./mod.ts";
import type { AgentDeps, AgentLookups } from "./ports.ts";

// agents가 등록 skill·MCP를 자리마다 묻는다(lophn-agent/extensions R32): 같은 agent도 여는 자리에 따라 켠 수가 다르다.
// fake snapshot과 in-memory 파일로 handler를 직접 부른다.

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fa1";
const OTHER = "prj_01arz3ndektsv4rrffq69g5fa9";
const LOPHN = "asg_01arz3ndektsv4rrffq69g5fa3";
const APP_ENGINEER = "asg_01arz3ndektsv4rrffq69g5fa5";
const APP = "app_01arz3ndektsv4rrffq69g5fa2";

const user: RequestContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1",
  scope: { operations: ["ListAgents"], targets: {} },
  conditions: {},
};

const snapshot: ReadSnapshot = {
  as_of_seq: "1",
  sql: { get: () => undefined, all: () => [] },
  port: () => {
    throw new Error("no port");
  },
};

function deps(
  asked: AgentPlace[],
  contextAsks: string[] = [],
): AgentDeps {
  const lookups = (): AgentLookups => ({
    placeExists: () => true,
    assignments: (place) => [
      {
        id: LOPHN,
        role: "lophn",
        scope: { kind: "all" },
        state: "enabled",
        revision: 1,
      },
      ...(place.kind === "app"
        ? [{
          id: APP_ENGINEER,
          role: "app_engineer" as const,
          scope: { kind: "app" as const, id: place.id },
          state: "enabled" as const,
          revision: 1,
        }]
        : []),
    ],
    assignment: () => null,
    contextStatus: () => null,
    contextProject: () => null,
    activeContexts: (place, role) => {
      contextAsks.push(`${place.kind}:${role}`);
      return [];
    },
    skills: (place) => {
      asked.push(place);
      return place.id === PROJECT ? ["global-one", "project-only"] : [
        "global-one",
      ];
    },
    mcp: (place) =>
      place.id === PROJECT
        ? [
          { server_name: "shared", original_tool: "search" },
          { server_name: "scoped", original_tool: "lookup" },
        ]
        : [{ server_name: "shared", original_tool: "search" }],
    workspace: () => ({
      models: {
        lophn: {
          provider: "pvd_01arz3ndektsv4rrffq69g5fav",
          model_name: "m",
          option_values: {},
        },
      },
    }),
  });
  return {
    files: { read: () => null, writeAtomic() {}, remove() {} },
    lookups,
    assignmentWriter: () => ({
      createOperator: () => ({ ok: true, value: "asg_x" }),
      withdraw: () => ({ ok: true, value: undefined }),
    }),
    roleCaps: () => [],
    dataRoot: "/data",
  };
}

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: the agent list counts the skills and MCP tools of the place it lists", () => {
  const asked: AgentPlace[] = [];
  const reads = createAgentReads(deps(asked));
  const countsIn = (id: string) => {
    const listed = reads.list.handle(snapshot, user, {
      place: { kind: "project", id },
    });
    assert(listed.ok, listed.ok ? "" : JSON.stringify(listed.error));
    return listed.value.agents.map((agent) => agent.counts);
  };
  assertEquals(countsIn(PROJECT), [{ contexts: null, skills: 2, mcp: 2 }]);
  assertEquals(countsIn(OTHER), [{ contexts: null, skills: 1, mcp: 1 }]);
  // 등록부는 목록을 여는 자리를 받아 묻는다.
  assertEquals(
    asked.map((place) => place.id),
    [PROJECT, OTHER],
  );
});

Deno.test("lophn-agent/agents#R16 [agent-I54]: the registry is asked for the active contexts of each agent by its role, so App Engineer in an app can differ from lophn there", () => {
  const contextAsks: string[] = [];
  const reads = createAgentReads(deps([], contextAsks));
  const listed = reads.list.handle(snapshot, user, {
    place: { kind: "app", id: APP },
  });
  assert(listed.ok, listed.ok ? "" : JSON.stringify(listed.error));
  assertEquals(contextAsks.sort(), ["app:app_engineer", "app:lophn"]);
});
