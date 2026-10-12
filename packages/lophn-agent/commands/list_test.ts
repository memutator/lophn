import { assertEquals } from "@std/assert";
import {
  type AgentRole,
  type CommandGroup,
  listCommands,
} from "../../protocol/lophn-agent/mod.ts";
import {
  buildRegistry,
  type CommandRegistry,
  type RegistrySkill,
} from "./registry.ts";
import { resolveSubmission } from "./list.ts";

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

const registryOf = (
  role: AgentRole,
  skills: readonly RegistrySkill[] = [],
): CommandRegistry => buildRegistry({ role, skills });

const shape = (groups: readonly CommandGroup[]) =>
  groups.map((group) => [group.title, group.entries.map((e) => e.name)]);

Deno.test("lophn-agent/commands#R1 [agent-I6]: `/` shows Commands, the agent name and Skills in that order", () => {
  const registry = registryOf("lophn", [skill("review"), skill("audit")]);
  assertEquals(shape(listCommands(registry, "lophn", "")), [
    ["Commands", [
      "new",
      "rename",
      "archive",
      "compact",
      "fork",
      "mcp",
      "skills",
      "permissions",
    ]],
    ["lophn", ["new-app", "repair-app"]],
    ["Skills", ["audit", "review"]],
  ]);
  assertEquals(
    listCommands(registry, "lophn", "").map((group) => group.source),
    ["builtin", "role", "skill"],
  );
});

Deno.test("lophn-agent/commands#R3 [agent-I6]: the middle group carries the agent's own name and is missing for App Engineer and Operator", () => {
  const ce = listCommands(
    registryOf("context_engineer"),
    "Context Engineer",
    "",
  );
  assertEquals(shape(ce).map(([title]) => title), [
    "Commands",
    "Context Engineer",
  ]);
  for (
    const [role, name] of [["app_engineer", "Notes app"], [
      "operator",
      "Weekly report",
    ]] as const
  ) {
    const groups = listCommands(registryOf(role, [skill("review")]), name, "");
    assertEquals(shape(groups).map(([title]) => title), ["Commands", "Skills"]);
  }
});

Deno.test("lophn-agent/commands#R2 [agent-I6]: the first group is the same eight in the same order on every agent", () => {
  const first = (role: AgentRole) =>
    listCommands(registryOf(role), "agent", "")[0].entries.map((e) => e.name);
  const lophn = first("lophn");
  for (
    const role of ["context_engineer", "app_engineer", "operator"] as const
  ) {
    assertEquals(first(role), lophn);
  }
  assertEquals(lophn.length, 8);
  assertEquals(lophn.includes("feedback"), false);
});

Deno.test("lophn-agent/commands#R3 [agent-I6]: another role's command is neither listed nor callable", () => {
  const lophn = registryOf("lophn");
  assertEquals(listCommands(lophn, "lophn", "check"), []);
  assertEquals(resolveSubmission(lophn, "/check-contracts"), {
    kind: "unknown_command",
    name: "check-contracts",
  });
  assertEquals(resolveSubmission(lophn, "/new-context"), {
    kind: "unknown_command",
    name: "new-context",
  });

  const ce = registryOf("context_engineer");
  assertEquals(shape(listCommands(ce, "Context Engineer", "check")), [
    ["Context Engineer", ["check-contracts"]],
  ]);
  assertEquals(listCommands(ce, "Context Engineer", "new-app"), []);
  assertEquals(resolveSubmission(ce, "/new-app"), {
    kind: "unknown_command",
    name: "new-app",
  });
  assertEquals(resolveSubmission(registryOf("operator"), "/new-app"), {
    kind: "unknown_command",
    name: "new-app",
  });
  // 자기 role의 명령은 불린다.
  const called = resolveSubmission(lophn, "/new-app");
  assertEquals(called.kind, "command");
  if (called.kind === "command") {
    assertEquals(called.entry.name, "new-app");
    assertEquals(called.entry.source, "role");
  }
});

Deno.test("lophn-agent/commands#R11 [agent-I6]: a `/…` with no matching command is an unknown command, not a message", () => {
  const registry = registryOf("lophn", [skill("review")]);
  assertEquals(resolveSubmission(registry, "/compcat"), {
    kind: "unknown_command",
    name: "compcat",
  });
  // registry에 없는 이름은 옛 built-in이었어도 실행되지 않는다.
  assertEquals(resolveSubmission(registry, "/feedback"), {
    kind: "unknown_command",
    name: "feedback",
  });
  assertEquals(resolveSubmission(registry, "/compcat now"), {
    kind: "unknown_command",
    name: "compcat",
  });
  // `/`로 시작하지 않으면 일반 메시지다.
  assertEquals(resolveSubmission(registry, "compact the notes"), {
    kind: "message",
  });
  assertEquals(resolveSubmission(registry, "see /compact later"), {
    kind: "message",
  });
});

Deno.test("lophn-agent/commands#R4 [agent-I6]: a submitted name runs exactly the registry entry and keeps what follows as the argument", () => {
  const registry = registryOf("lophn", [skill("review")]);
  const compact = resolveSubmission(registry, "/compact");
  assertEquals(compact.kind, "command");
  if (compact.kind === "command") {
    assertEquals(compact.entry.action, { kind: "builtin", id: "compact" });
    assertEquals(compact.argument, "");
  }
  const rename = resolveSubmission(registry, "/rename  Weekly plan ");
  assertEquals(rename.kind, "command");
  if (rename.kind === "command") {
    assertEquals(rename.entry.name, "rename");
    assertEquals(rename.argument, "Weekly plan");
  }
  const review = resolveSubmission(registry, "/review src/a.ts");
  assertEquals(review.kind, "command");
  if (review.kind === "command") {
    assertEquals(review.entry.source, "skill");
    assertEquals(review.entry.action, { kind: "skill", skill_name: "review" });
    assertEquals(review.argument, "src/a.ts");
  }
});

Deno.test("lophn-agent/commands#R5 [agent-I6]: `/compact` runs only the built-in when a skill has the same name", () => {
  const registry = registryOf("lophn", [skill("compact"), skill("review")]);
  const called = resolveSubmission(registry, "/compact");
  assertEquals(called.kind, "command");
  if (called.kind === "command") {
    assertEquals(called.entry.source, "builtin");
    assertEquals(called.entry.action, { kind: "builtin", id: "compact" });
  }
  // skill 묶음에는 그 이름이 없다. 부를 수 없는 사실은 registry의 알림이 맡는다.
  assertEquals(shape(listCommands(registry, "lophn", "compact")), [
    ["Commands", ["compact"]],
  ]);
  assertEquals(registry.notices, [
    { kind: "reserved_name", name: "compact", reserved_by: "builtin" },
  ]);
});

Deno.test("lophn-agent/commands#R6 [agent-I6]: a name shared by two skills is not run by name alone and the user chooses", () => {
  const registry = registryOf("app_engineer", [
    skill("review", { origin: "workspace", description: "Global review" }),
    skill("review", { origin: "place", description: "App review" }),
    skill("audit"),
  ]);
  // 메뉴에는 둘이 출처와 함께 나온다.
  const menu = listCommands(registry, "Notes app", "rev")[0];
  assertEquals(
    menu.entries.map((entry) => [entry.name, entry.skill_origin]),
    [["review", "place"], ["review", "workspace"]],
  );
  // 이름만 제출하면 실행하지 않고 고르게 한다.
  const submitted = resolveSubmission(registry, "/review");
  assertEquals(submitted.kind, "choose_skill");
  if (submitted.kind === "choose_skill") {
    assertEquals(submitted.name, "review");
    assertEquals(
      submitted.candidates.map((entry) => entry.skill_origin),
      ["place", "workspace"],
    );
  }
  assertEquals(
    resolveSubmission(registry, "/review src/a.ts").kind,
    "choose_skill",
  );
  // 하나뿐인 이름은 바로 실행한다.
  assertEquals(resolveSubmission(registry, "/audit").kind, "command");
});

Deno.test("lophn-agent/commands#R7 [agent-I6]: a skill that was turned off cannot be listed or called", () => {
  const registry = registryOf("lophn", [
    skill("review"),
    skill("draft", { selected: false }),
  ]);
  assertEquals(shape(listCommands(registry, "lophn", "dra")), []);
  assertEquals(resolveSubmission(registry, "/draft"), {
    kind: "unknown_command",
    name: "draft",
  });
});
