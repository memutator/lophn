import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentRef, ROLES } from "../../../protocol/lophn-agent/mod.ts";
import { ROLE_TABLE } from "../../agent-roles/agents/role-table.ts";
import { parseAgentFile } from "./definition-file.ts";
import { type AvailableSkill, resolveAgent } from "./resolve.ts";

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

test("정의 파일에 tool을 적어도 role이 고정한 tool 목록은 바뀌지 않는다", async () => {
  for (const role of ROLES) {
    const target = {
      role,
      place: PLACES[role] === null ? null : PLACES[role].kind,
    };
    // tool을 적은 정의 파일은 읽을 때 거절된다.
    const written = parseAgentFile(
      `---\nname: reviewer\npermissions:\n  tools:\n    - file.write\n---\nbody\n`,
      target,
      ROLE_TABLE,
    );
    assert.ok(!written.ok);

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
        domains: [],
      },
      tools: TOOLS,
      roles: ROLE_TABLE,
    });
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.value.tools, TOOLS);
  }
});

// 다른 domain의 skill이 섞이면 그 domain의 지식·절차가 이 agent의 일에 새어 들어온다.
test("Operator가 domain 하나를 고르면 그 domain만 일하고 다른 domain의 skill은 받지 않는다", async () => {
  const A = "dom_00000000000000000000000001";
  const B = "dom_00000000000000000000000002";
  const skills: AvailableSkill[] = [
    { name: "built-in", can_disable: false, domain: null },
    { name: "global", can_disable: true, domain: null },
    { name: "in-a", can_disable: true, domain: A },
    { name: "in-b", can_disable: true, domain: B },
  ];
  const resolve = async (
    definition: { name: string; body: string; domains?: string[] },
    container = [A, B],
  ) => {
    const resolved = await resolveAgent({
      agent: REFS.operator,
      place: PLACES.operator,
      definition,
      global_model: MODEL,
      session_model: null,
      environment: {
        default_profile: { kind: "icon", icon: "roles" },
        skills,
        mcp: [],
        domains: container,
      },
      tools: TOOLS,
      roles: ROLE_TABLE,
    });
    assert.ok(resolved.ok);
    return resolved.value;
  };

  const one = await resolve({ name: "r", body: "x", domains: [B] });
  assert.deepEqual(one.domains, [B]);
  assert.deepEqual(one.skills, ["built-in", "global", "in-b"]);

  // 고르지 않으면 그릇의 domain 전부다. 보관돼 그릇에서 빠진 domain은 고른 채여도 빠진다.
  const all = await resolve({ name: "r", body: "x" });
  assert.deepEqual(all.domains, [A, B]);
  assert.deepEqual(all.skills, ["built-in", "global", "in-a", "in-b"]);
  const archived = await resolve({ name: "r", body: "x", domains: [A, B] }, [
    B,
  ]);
  assert.deepEqual(archived.domains, [B]);
  assert.deepEqual(archived.skills, ["built-in", "global", "in-b"]);
});
