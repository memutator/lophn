import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../server/mod.ts";
import {
  BUILTIN_COMMAND_IDS,
  COMMAND_ROUTES,
  commandEntrySchema,
  commandNoticeSchema,
  commandsList,
  commandsListInputSchema,
  commandsListOutputSchema,
} from "./commands.ts";

const ses = "ses_01arz3ndektsv4rrffq69g5fav";

const builtin = {
  name: "compact",
  title: "Compact",
  description: "Summarize this session to free up context",
  source: "builtin",
  skill_origin: null,
  while_running: "queue",
  action: { kind: "builtin", id: "compact" },
};
const role = {
  name: "new-app",
  title: "New app",
  description: "Start a new app in this project",
  source: "role",
  skill_origin: null,
  while_running: "queue",
  action: { kind: "prompt", template: "Help me start a new app." },
};
const skill = {
  name: "code-review",
  title: null,
  description: "Review a change",
  source: "skill",
  skill_origin: null,
  while_running: "queue",
  action: { kind: "skill", skill_name: "code-review" },
};

Deno.test("lophn-agent/commands#R4: the registry is one read route with no command or event", () => {
  assertEquals(COMMAND_ROUTES.map(routePath), ["/v1/commands/list"]);
  assertEquals(commandsList.actors, ["user"]);
  assert(commandsList.errors.every((code) => ERROR_CODES.includes(code)));
  assert(!("events" in commandsList));
});

Deno.test("lophn-agent/commands#R1: list input names a session and nothing else", () => {
  assert(commandsListInputSchema.safeParse({ session: ses }).success);
  assert(!commandsListInputSchema.safeParse({}).success);
  assert(!commandsListInputSchema.safeParse({ session: "asg_x" }).success);
  assert(
    !commandsListInputSchema.safeParse({ session: ses, role: "lophn" }).success,
  );
});

Deno.test("lophn-agent/commands#R4: an entry carries name, description, source, when it can run and how it runs", () => {
  for (const entry of [builtin, role, skill]) {
    assert(commandEntrySchema.safeParse(entry).success);
  }
  assert(
    commandEntrySchema.safeParse({
      ...role,
      action: { kind: "tool", tool: "app.create" },
    }).success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...builtin, while_running: "later" })
      .success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...builtin, source: "plugin" }).success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...builtin, description: " " }).success,
  );
  const { while_running: _w, ...withoutWhile } = builtin;
  assert(!commandEntrySchema.safeParse(withoutWhile).success);
});

Deno.test("lophn-agent/commands#R2: the global built-ins are the eight ids in the fixed order", () => {
  assertEquals(BUILTIN_COMMAND_IDS, [
    "new",
    "rename",
    "archive",
    "compact",
    "fork",
    "mcp",
    "skills",
    "permissions",
  ]);
  assert(
    !commandEntrySchema.safeParse({
      ...builtin,
      name: "feedback",
      action: { kind: "builtin", id: "feedback" },
    }).success,
  );
});

Deno.test("lophn-agent/commands#R4: a name is a slashless lowercase token of 1 to 64 characters", () => {
  for (const name of ["a", "new-app", "x1", "a".repeat(64)]) {
    assert(commandEntrySchema.safeParse({ ...role, name }).success, name);
  }
  for (const name of ["", "New", "/new", "new app", "a".repeat(65)]) {
    assert(!commandEntrySchema.safeParse({ ...role, name }).success, name);
  }
});

Deno.test("lophn-agent/commands#R4: source, action, title and origin must agree", () => {
  // built-in은 builtin action만, role은 prompt나 tool만, skill은 skill action만 쓴다.
  assert(
    !commandEntrySchema.safeParse({ ...builtin, action: role.action }).success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...role, action: builtin.action }).success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...role, action: skill.action }).success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...skill, action: builtin.action }).success,
  );
  assert(
    !commandEntrySchema.safeParse({
      ...skill,
      action: { kind: "skill", skill_name: "other" },
    }).success,
  );
  // title은 built-in·role에만 쓴다.
  assert(!commandEntrySchema.safeParse({ ...builtin, title: null }).success);
  assert(!commandEntrySchema.safeParse({ ...role, title: null }).success);
  assert(!commandEntrySchema.safeParse({ ...skill, title: "Review" }).success);
  // skill_origin은 skill에만 있고 같은 이름이 둘 이상일 때만 채워진다.
  assert(
    commandEntrySchema.safeParse({ ...skill, skill_origin: "place" }).success,
  );
  assert(
    commandEntrySchema.safeParse({ ...skill, skill_origin: "workspace" })
      .success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...skill, skill_origin: "registered" })
      .success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...builtin, skill_origin: "place" })
      .success,
  );
  assert(
    !commandEntrySchema.safeParse({ ...role, skill_origin: "workspace" })
      .success,
  );
});

Deno.test("lophn-agent/commands#R5: a reserved-name notice names the skill and who reserved it", () => {
  assert(
    commandNoticeSchema.safeParse({
      kind: "reserved_name",
      name: "compact",
      reserved_by: "builtin",
    }).success,
  );
  assert(
    commandNoticeSchema.safeParse({
      kind: "reserved_name",
      name: "new-app",
      reserved_by: "role",
    }).success,
  );
  assert(
    !commandNoticeSchema.safeParse({
      kind: "reserved_name",
      name: "compact",
      reserved_by: "skill",
    }).success,
  );
});

Deno.test("lophn-agent/commands#R1: list output is the entries, the notices and the read meta", () => {
  const output = {
    commands: [builtin, role, skill],
    notices: [{ kind: "reserved_name", name: "fork", reserved_by: "builtin" }],
    as_of_seq: "7",
    next_cursor: null,
  };
  assert(commandsListOutputSchema.safeParse(output).success);
  assert(
    commandsListOutputSchema.safeParse({ ...output, commands: [] }).success,
  );
  assert(
    !commandsListOutputSchema.safeParse({
      ...output,
      commands: [{ ...builtin, source: "plugin" }],
    }).success,
  );
  const { notices: _n, ...withoutNotices } = output;
  assert(!commandsListOutputSchema.safeParse(withoutNotices).success);
});
