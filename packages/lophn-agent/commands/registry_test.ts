import { assert, assertEquals } from "@std/assert";
import {
  AGENT_ROLES,
  type AgentRole,
  commandEntrySchema,
} from "../../protocol/lophn-agent/mod.ts";
import {
  buildRegistry,
  builtinCommands,
  type RegistrySkill,
  roleCommands,
} from "./registry.ts";

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

const names = (entries: readonly { name: string }[]) =>
  entries.map((entry) => entry.name);

Deno.test("lophn-agent/commands#R2 [agent-I6]: the global built-ins are the eight commands in the fixed order", () => {
  const entries = builtinCommands();
  // 알파벳순으로 다시 정렬하지 않는다. Feedback과 model·속도 명령은 없다.
  assertEquals(names(entries), [
    "new",
    "rename",
    "archive",
    "compact",
    "fork",
    "mcp",
    "skills",
    "permissions",
  ]);
  assertEquals(entries.map((entry) => entry.title), [
    "New session",
    "Rename",
    "Archive",
    "Compact",
    "Fork",
    "MCP",
    "Skills",
    "Permissions",
  ]);
  assertEquals(entries.map((entry) => entry.description), [
    "Start a new session with this agent",
    "Rename this session",
    "Archive this session",
    "Summarize this session to free up context",
    "Copy this session into a new one",
    "Show MCP server status",
    "Turn skills on or off for this agent",
    "Change what this agent may do",
  ]);
  for (const entry of entries) {
    assertEquals(entry.source, "builtin");
    assertEquals(entry.skill_origin, null);
    assertEquals(entry.action.kind, "builtin");
    if (entry.action.kind === "builtin") {
      assertEquals(entry.action.id, entry.name);
    }
  }
});

Deno.test("lophn-agent/commands#R3 [agent-I6]: role built-ins exist for lophn and Context Engineer only", () => {
  assertEquals(names(roleCommands("lophn")), ["new-app", "repair-app"]);
  assertEquals(
    roleCommands("lophn").map((entry) => entry.title),
    ["New app", "Repair app"],
  );
  assertEquals(names(roleCommands("context_engineer")), [
    "check-contracts",
    "new-context",
  ]);
  assertEquals(
    roleCommands("context_engineer").map((entry) => entry.title),
    ["Check contracts", "New context"],
  );
  assertEquals(roleCommands("app_engineer"), []);
  assertEquals(roleCommands("operator"), []);
  for (const role of AGENT_ROLES) {
    for (const entry of roleCommands(role)) {
      assertEquals(entry.source, "role");
      assertEquals(entry.skill_origin, null);
      // 첫 목록의 role 명령은 모두 prompt를 사람의 메시지로 접수한다.
      assertEquals(entry.action.kind, "prompt");
      if (entry.action.kind === "prompt") {
        assert(entry.action.template.trim().length > 0);
      }
    }
  }
});

Deno.test("lophn-agent/commands#R4 [agent-I6]: every entry the registry yields satisfies the CommandEntry schema", () => {
  const skills = [
    skill("zeta"),
    skill("review", { origin: "place" }),
    skill("review", { origin: "workspace" }),
    skill("compact"),
  ];
  for (const role of AGENT_ROLES) {
    const registry = buildRegistry({ role, skills });
    for (const entry of registry.entries) {
      assert(commandEntrySchema.safeParse(entry).success, entry.name);
    }
  }
});

Deno.test("lophn-agent/commands#R1 [agent-I6]: entries are global built-ins, then the role built-ins, then skills", () => {
  const registry = buildRegistry({
    role: "lophn",
    skills: [skill("b-skill"), skill("a-skill")],
  });
  assertEquals(names(registry.entries), [
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
    "a-skill",
    "b-skill",
  ]);
  assertEquals(registry.entries.map((entry) => entry.source), [
    ...Array(8).fill("builtin"),
    "role",
    "role",
    "skill",
    "skill",
  ]);
  assertEquals(registry.notices, []);
});

Deno.test("lophn-agent/commands#R3 [agent-I6]: the role group differs by role and is empty for App Engineer and Operator", () => {
  const sources = (role: AgentRole) =>
    buildRegistry({ role, skills: [] }).entries.filter((entry) =>
      entry.source === "role"
    ).map((entry) => entry.name);
  assertEquals(sources("lophn"), ["new-app", "repair-app"]);
  assertEquals(sources("context_engineer"), ["check-contracts", "new-context"]);
  assertEquals(sources("app_engineer"), []);
  assertEquals(sources("operator"), []);
  // 다른 role의 명령은 registry에 아예 없다.
  const lophn = names(buildRegistry({ role: "lophn", skills: [] }).entries);
  assert(!lophn.includes("check-contracts"));
  assert(!lophn.includes("new-context"));
  const ce = names(
    buildRegistry({ role: "context_engineer", skills: [] }).entries,
  );
  assert(!ce.includes("new-app"));
  assert(!ce.includes("repair-app"));
});

Deno.test("lophn-agent/commands#R7 [agent-I6]: skills are one list in English dictionary order without origin badges", () => {
  const registry = buildRegistry({
    role: "app_engineer",
    skills: [
      skill("zebra", { origin: "workspace" }),
      skill("alpha", { origin: "place", description: "Alpha steps" }),
      skill("mango", { origin: "workspace" }),
      skill("beta-2", { origin: "place" }),
    ],
  });
  const skills = registry.entries.filter((entry) => entry.source === "skill");
  // 전역인지 그 agent 전용인지 구분하지 않고 이름 사전순이다.
  assertEquals(names(skills), ["alpha", "beta-2", "mango", "zebra"]);
  // 이름이 겹치지 않으면 출처를 붙이지 않는다.
  assert(skills.every((entry) => entry.skill_origin === null));
  assertEquals(skills[0], {
    name: "alpha",
    title: null,
    description: "Alpha steps",
    source: "skill",
    skill_origin: null,
    while_running: "queue",
    action: { kind: "skill", skill_name: "alpha" },
  });
});

Deno.test("lophn-agent/commands#R7 [agent-I6]: a skill the agent turned off is not in the registry", () => {
  const registry = buildRegistry({
    role: "lophn",
    skills: [
      skill("kept"),
      skill("off", { selected: false }),
      skill("off-too", { selected: false, origin: "place" }),
    ],
  });
  const skills = registry.entries.filter((entry) => entry.source === "skill");
  assertEquals(names(skills), ["kept"]);
  assertEquals(registry.notices, []);
});

Deno.test("lophn-agent/commands#R5 [agent-I6]: a skill named like a global built-in is left out of the slash list with a notice", () => {
  const registry = buildRegistry({
    role: "lophn",
    skills: [skill("compact"), skill("fork"), skill("helper")],
  });
  // `/`로는 built-in만 불리고 skill은 불리지 않는다.
  assertEquals(
    registry.entries.filter((entry) => entry.name === "compact").map((entry) =>
      entry.source
    ),
    ["builtin"],
  );
  assertEquals(
    registry.entries.filter((entry) => entry.source === "skill").map((entry) =>
      entry.name
    ),
    ["helper"],
  );
  // 부를 수 없다는 사실은 알림 값으로 사람에게 간다(알림은 skill 이름 사전순).
  assertEquals(registry.notices, [
    { kind: "reserved_name", name: "compact", reserved_by: "builtin" },
    { kind: "reserved_name", name: "fork", reserved_by: "builtin" },
  ]);
});

Deno.test("lophn-agent/commands#R5 [agent-I6]: a role built-in name is reserved only for the agent that has it", () => {
  const skills = [skill("new-app"), skill("check-contracts")];
  const lophn = buildRegistry({ role: "lophn", skills });
  assertEquals(
    lophn.entries.filter((entry) => entry.name === "new-app").map((entry) =>
      entry.source
    ),
    ["role"],
  );
  assertEquals(lophn.notices, [
    { kind: "reserved_name", name: "new-app", reserved_by: "role" },
  ]);
  // check-contracts는 lophn의 예약 이름이 아니라 skill로 그대로 보인다.
  assert(
    lophn.entries.some((entry) =>
      entry.source === "skill" && entry.name === "check-contracts"
    ),
  );
  // App Engineer에는 role 명령이 없으니 어느 이름도 예약되지 않는다.
  const appEngineer = buildRegistry({ role: "app_engineer", skills });
  assertEquals(
    appEngineer.entries.filter((entry) => entry.source === "skill").map((
      entry,
    ) => entry.name),
    ["check-contracts", "new-app"],
  );
  assertEquals(appEngineer.notices, []);
});

Deno.test("lophn-agent/commands#R5 [agent-I6]: two skills with a reserved name give one notice", () => {
  const registry = buildRegistry({
    role: "operator",
    skills: [
      skill("compact", { origin: "place" }),
      skill("compact", { origin: "workspace" }),
    ],
  });
  assertEquals(
    registry.entries.filter((entry) => entry.source === "skill"),
    [],
  );
  assertEquals(registry.notices, [
    { kind: "reserved_name", name: "compact", reserved_by: "builtin" },
  ]);
});

Deno.test("lophn-agent/commands#R6 [agent-I6]: skills with the same name all stay and carry where they were found", () => {
  // 같은 이름이 둘 이상 올라오는 것은 extensions가 하나로 줄이지 않은 경우뿐이다.
  const inputs: RegistrySkill[][] = [
    [
      skill("review", { origin: "workspace", description: "Global review" }),
      skill("alpha"),
      skill("review", { origin: "place", description: "App review" }),
    ],
    [
      skill("review", { origin: "place", description: "App review" }),
      skill("review", { origin: "workspace", description: "Global review" }),
      skill("alpha"),
    ],
  ];
  for (const skills of inputs) {
    const entries = buildRegistry({ role: "app_engineer", skills }).entries
      .filter((entry) => entry.source === "skill");
    // 입력 순서와 상관없이 이름 사전순 안에서 place가 workspace보다 앞이다.
    assertEquals(
      entries.map((
        entry,
      ) => [entry.name, entry.skill_origin, entry.description]),
      [
        ["alpha", null, "Use alpha"],
        ["review", "place", "App review"],
        ["review", "workspace", "Global review"],
      ],
    );
    for (const entry of entries) {
      assertEquals(entry.action, { kind: "skill", skill_name: entry.name });
    }
  }
});

Deno.test("lophn-agent/commands#R8 [agent-I6]: only Fork is blocked while a run is going; Compact, role built-ins and skills wait; the rest run", () => {
  const registry = buildRegistry({
    role: "context_engineer",
    skills: [skill("helper")],
  });
  const whileRunning = Object.fromEntries(
    registry.entries.map((entry) => [entry.name, entry.while_running]),
  );
  assertEquals(whileRunning, {
    new: "run",
    rename: "run",
    archive: "run",
    compact: "queue",
    fork: "blocked",
    mcp: "run",
    skills: "run",
    permissions: "run",
    "check-contracts": "queue",
    "new-context": "queue",
    helper: "queue",
  });
  const lophn = buildRegistry({ role: "lophn", skills: [] });
  assert(
    lophn.entries.filter((entry) => entry.source === "role").every((entry) =>
      entry.while_running === "queue"
    ),
  );
});

Deno.test("lophn-agent/commands#R4 [agent-I6]: the registry is a pure calculation that leaves its input alone", () => {
  const skills = [skill("b"), skill("a", { origin: "place" })];
  const snapshot = structuredClone(skills);
  const first = buildRegistry({ role: "lophn", skills });
  const second = buildRegistry({ role: "lophn", skills });
  assertEquals(first, second);
  assertEquals(skills, snapshot);
  assertEquals(builtinCommands(), builtinCommands());
});
