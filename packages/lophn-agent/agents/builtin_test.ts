import { assert, assertEquals } from "@std/assert";
import {
  AGENT_ROLES,
  type AgentPlace,
  BUILTIN_AGENT_NAMES,
  profileSchema,
} from "../../protocol/lophn-agent/mod.ts";
import {
  APP_COMMAND_EXPOSURE,
  BUILTIN_AGENTS,
  DEFAULT_PROFILES,
  productEnvironment,
  resolveAgent,
  ROLE_CAPS,
  roleCapsOf,
} from "./mod.ts";

// built-in 정의는 코드에 있다: 제품 이름, 기본 icon, 역할 상한(RoleCaps). 정의 파일은 바꾼 칸만 가진다.

const PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const APP: AgentPlace = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };
const MODEL = {
  provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
  model_name: "gpt-5",
  option_values: {},
};

Deno.test("lophn-agent/agents#R5 lophn-agent/agents#R13: built-in agents carry the product name and a default icon in code", () => {
  assertEquals(Object.keys(BUILTIN_AGENTS).sort(), [
    "app_engineer",
    "context_engineer",
    "lophn",
  ]);
  for (const [role, agent] of Object.entries(BUILTIN_AGENTS)) {
    assertEquals(
      agent.name,
      BUILTIN_AGENT_NAMES[role as keyof typeof BUILTIN_AGENT_NAMES],
    );
    assertEquals(agent.profile.kind, "icon");
    assert(profileSchema.safeParse(agent.profile).success);
    assertEquals(
      DEFAULT_PROFILES[role as keyof typeof BUILTIN_AGENTS],
      agent.profile,
    );
  }
  // Operator는 정의 파일이 이름을 주지만 icon은 제품 기본이 있다.
  assertEquals(DEFAULT_PROFILES.operator.kind, "icon");
  assertEquals(
    new Set(AGENT_ROLES.map((role) => JSON.stringify(DEFAULT_PROFILES[role])))
      .size,
    AGENT_ROLES.length,
  );
});

Deno.test("lophn-agent/agents#R20: RoleCaps are fixed in the agents module for all four roles and roleCapsOf reads them", () => {
  assertEquals([...ROLE_CAPS.keys()].sort(), [...AGENT_ROLES].sort());
  for (const role of AGENT_ROLES) {
    assertEquals(roleCapsOf(role), ROLE_CAPS.get(role)!.tools);
    assert(roleCapsOf(role).length > 0);
    assert(APP_COMMAND_EXPOSURE.has(role));
  }
  // 개별 동작 이름뿐이다: 묶음 이름이나 wildcard를 두지 않는다(R22).
  for (const role of AGENT_ROLES) {
    for (const tool of roleCapsOf(role)) {
      assert(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(tool), tool);
    }
  }
  // 코드(agents/builtin)를 고르면 고정한 상한이 그대로 제공 tool의 위쪽 경계가 된다.
  assert(!roleCapsOf("operator").includes("ticket.create"));
  assert(roleCapsOf("lophn").includes("ticket.create"));
});

Deno.test("lophn-agent/agents#R25 lophn-agent/agents#R20: productEnvironment feeds resolveAgent with the built-in caps and icon", async () => {
  const environment = productEnvironment("lophn", {
    skills: ["notes"],
    mcp: [{ server_name: "files", original_tool: "read" }],
    active_contexts: ["ctx_01arz3ndektsv4rrffq69g5fb1"],
  });
  assertEquals(environment.role_caps, roleCapsOf("lophn"));
  assertEquals(environment.default_profile, BUILTIN_AGENTS.lophn.profile);
  const resolved = await resolveAgent({
    assignment: "asg_01arz3ndektsv4rrffq69g5fa3",
    role: "lophn",
    place: PRJ,
    definition: null,
    workspace: { models: { lophn: MODEL } },
    place_settings: {},
    session_model: null,
    environment,
  });
  assert(resolved.ok);
  assertEquals(resolved.value.name, "lophn");
  assertEquals(resolved.value.tools, [...roleCapsOf("lophn")]);
  assertEquals(resolved.value.profile, BUILTIN_AGENTS.lophn.profile);
  assertEquals(resolved.value.skills, ["notes"]);
  assertEquals(resolved.value.contexts, ["ctx_01arz3ndektsv4rrffq69g5fb1"]);
  // 앱 자리에서 열린 built-in은 context 자료가 0개이고 이유를 밝힌다.
  const inApp = await resolveAgent({
    assignment: "asg_01arz3ndektsv4rrffq69g5fa3",
    role: "lophn",
    place: APP,
    definition: null,
    workspace: { models: { lophn: MODEL } },
    place_settings: {},
    session_model: null,
    environment: productEnvironment("lophn", {
      skills: [],
      mcp: [],
      active_contexts: [],
    }),
  });
  assert(inApp.ok);
  assertEquals(inApp.value.contexts_reason, "no_project");
});
