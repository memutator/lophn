import { assert, assertEquals } from "@std/assert";
import { type AgentRef, ROLES } from "../../../protocol/lophn-agent/mod.ts";
import { ROLE_TABLE } from "../../agent-roles/agents/role-table.ts";
import { parseAgentFile } from "./definition-file.ts";
import { resolveAgent } from "./resolve.ts";

// role 층이 정하는 값이다. resolve는 받은 그대로 담는다.
const TOOLS = ["file.read", "ticket.list"];
const PROJECT = "prj_00000000000000000000000001";
const APP = "app_00000000000000000000000001";
const OPERATOR = "agt_00000000000000000000000001";
const MODEL = {
  provider: "pvd_00000000000000000000000001",
  model_name: "m",
  option_values: {},
} as const;

const REFS: Record<(typeof ROLES)[number], AgentRef> = {
  lophn: { role: "lophn" },
  project_manager: { role: "project_manager", project: PROJECT },
  app_engineer: { role: "app_engineer", app: APP },
  operator: { role: "operator", agent: OPERATOR },
};
const PLACES = {
  lophn: null,
  project_manager: { kind: "project", id: PROJECT },
  app_engineer: { kind: "app", id: APP },
  operator: { kind: "project", id: PROJECT },
} as const;

Deno.test("정의 파일에 tool을 적어도 role이 고정한 tool 목록은 바뀌지 않는다", async () => {
  for (const role of ROLES) {
    const target = {
      role,
      place: PLACES[role] === null ? null : PLACES[role].kind,
    };
    // tool을 적은 정의 파일은 읽을 때 거절된다.
    const written = parseAgentFile(
      `---\nname: reviewer\npermissions:\n  tools:\n    - file.write\n---\nbody\n`,
      target,
    );
    assert(!written.ok);

    // 정의가 있어도 없어도 결과 tools는 role이 고정한 목록이다.
    const definition = role === "operator"
      ? { name: "reviewer", body: "review" }
      : { body: "" };
    const resolved = await resolveAgent({
      agent: REFS[role],
      place: PLACES[role],
      definition,
      global_model: MODEL,
      session_model: null,
      environment: {
        default_profile: { kind: "icon", icon: "roles" },
        skills: [],
        mcp: [],
        active_contexts: [],
      },
      tools: TOOLS,
      roles: ROLE_TABLE,
    });
    assert(resolved.ok);
    assertEquals(resolved.value.tools, TOOLS);
  }
});
