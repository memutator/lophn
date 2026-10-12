import { assert, assertEquals } from "@std/assert";
import {
  type AgentRole,
  commandsList,
  commandsListOutputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import { createCommandReads } from "./reads.ts";
import type { RegistrySkill } from "./registry.ts";

// `/` 명령 목록 read(concern lophn-agent/commands). 목록은 저장하지 않고 session의 agent에서
// 계산한다. session·assignment 행만 있는 fake snapshot으로 handler를 직접 부른다.

const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";
const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

const user: RequestContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1",
  scope: { operations: ["ListCommands"], targets: {} },
  conditions: {},
};

function snapshot(role: AgentRole | null): ReadSnapshot {
  const row: SqlRow | undefined = role === null ? undefined : {
    assignment: ASSIGNMENT,
    role,
    work_place_kind: "project",
    work_place_id: PROJECT,
  };
  return {
    as_of_seq: "42",
    sql: {
      get: (_query, params) => params[0] === SESSION ? row : undefined,
      all: () => [],
    },
    port: () => {
      throw new Error("no port");
    },
  };
}

const skill = (
  name: string,
  over: Partial<RegistrySkill> = {},
): RegistrySkill => ({
  name,
  description: `Use ${name}`,
  origin: "workspace",
  selected: true,
  ...over,
});

function list(
  role: AgentRole | null,
  skills: readonly RegistrySkill[] = [],
  seen: unknown[] = [],
  session = SESSION,
) {
  const reads = createCommandReads({
    skills: (_sql, place) => {
      seen.push(place);
      return skills;
    },
  });
  assertEquals(reads.list.route, commandsList);
  return reads.list.handle(snapshot(role), user, { session });
}

Deno.test("lophn-agent/commands#R1 [agent-I16]: the list of a lophn session is the eight built-ins, the lophn commands and its skills in order", () => {
  const listed = list("lophn", [skill("review"), skill("audit")]);
  assert(listed.ok);
  assertEquals(listed.value.commands.map((entry) => entry.name), [
    "new",
    "rename",
    "archive",
    "compact",
    "fork",
    "mcp",
    "skills",
    "permissions",
    "new-app",
    "repair-app",
    "audit",
    "review",
  ]);
  assertEquals(listed.value.as_of_seq, "42");
  assert(commandsListOutputSchema.safeParse(listed.value).success);
});

Deno.test("lophn-agent/commands#R3 [agent-I16]: the role commands follow the role of the session's agent", () => {
  const names = (role: AgentRole) => {
    const listed = list(role);
    assert(listed.ok);
    return listed.value.commands.slice(8).map((entry) => entry.name);
  };
  assertEquals(names("lophn"), ["new-app", "repair-app"]);
  assertEquals(names("context_engineer"), ["check-contracts", "new-context"]);
  assertEquals(names("app_engineer"), []);
  assertEquals(names("operator"), []);
});

Deno.test("lophn-agent/commands#R7 [agent-I16]: the skills of the session's agent and place are asked for, off ones are hidden", () => {
  const seen: unknown[] = [];
  const listed = list("operator", [
    skill("review"),
    skill("draft", { selected: false }),
  ], seen);
  assert(listed.ok);
  assertEquals(
    listed.value.commands.filter((entry) => entry.source === "skill").map((
      entry,
    ) => entry.name),
    ["review"],
  );
  assertEquals(seen, [{
    assignment: ASSIGNMENT,
    role: "operator",
    work_place: { kind: "project", id: PROJECT },
  }]);
});

Deno.test("lophn-agent/commands#R5 [agent-I16]: a skill named like a built-in is dropped from the list and reported", () => {
  const listed = list("lophn", [skill("compact"), skill("review")]);
  assert(listed.ok);
  assertEquals(
    listed.value.commands.filter((entry) => entry.source === "skill").map((
      entry,
    ) => entry.name),
    ["review"],
  );
  assertEquals(listed.value.notices, [
    { kind: "reserved_name", name: "compact", reserved_by: "builtin" },
  ]);
});

Deno.test("lophn-agent/commands#R6 [agent-I16]: two skills of one name are both listed with their origin", () => {
  const listed = list("lophn", [
    skill("review", { origin: "place" }),
    skill("review", { origin: "workspace" }),
  ]);
  assert(listed.ok);
  const skills = listed.value.commands.filter((entry) =>
    entry.source === "skill"
  );
  assertEquals(skills.map((entry) => entry.skill_origin), [
    "place",
    "workspace",
  ]);
});

Deno.test("lophn-agent/commands#R4 [agent-I16]: a session that is not there is not found and no skill lookup happens", () => {
  const seen: unknown[] = [];
  const listed = list(null, [skill("review")], seen);
  assert(!listed.ok);
  assertEquals(listed.error.code, "not_found");
  assertEquals(seen, []);
});

Deno.test("lophn-agent/commands#R4 [agent-I16]: only a person reads the list", () => {
  const reads = createCommandReads({ skills: () => [] });
  const machine = reads.list.handle(snapshot("lophn"), {
    ...user,
    actor: "machine",
  }, { session: SESSION });
  assert(!machine.ok);
  assertEquals(machine.error.code, "forbidden");
});
