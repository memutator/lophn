import { assertEquals } from "@std/assert";
import { type CommandGroup, listCommands } from "./command-filter.ts";
import { BUILTIN_COMMAND_IDS, type CommandEntry } from "./commands.ts";

// lophn agent의 built-in 여덟과 role 명령 둘은 registry가 내는 이름과 설명 그대로다.
const BUILTIN_DESCRIPTIONS: Record<typeof BUILTIN_COMMAND_IDS[number], string> =
  {
    new: "Start a new session with this agent",
    rename: "Rename this session",
    archive: "Archive this session",
    compact: "Summarize this session to free up context",
    fork: "Copy this session into a new one",
    mcp: "Show MCP server status",
    skills: "Turn skills on or off for this agent",
    permissions: "Change what this agent may do",
  };

function commandEntry(
  source: CommandEntry["source"],
  name: string,
  description: string,
): CommandEntry {
  const common = {
    name,
    description,
    skill_origin: null,
    while_running: "queue",
  } as const;
  if (source === "builtin") {
    return {
      ...common,
      title: name,
      source,
      action: {
        kind: "builtin",
        id: name as typeof BUILTIN_COMMAND_IDS[number],
      },
    };
  }
  if (source === "role") {
    return {
      ...common,
      title: name,
      source,
      action: { kind: "prompt", template: name },
    };
  }
  return {
    ...common,
    title: null,
    source,
    action: { kind: "skill", skill_name: name },
  };
}

const skill = (name: string, description = `Use ${name}`) =>
  commandEntry("skill", name, description);

const registryOf = (skills: readonly CommandEntry[] = []) => ({
  entries: [
    ...BUILTIN_COMMAND_IDS.map((id) =>
      commandEntry("builtin", id, BUILTIN_DESCRIPTIONS[id])
    ),
    commandEntry("role", "new-app", "Start a new app in this project"),
    commandEntry("role", "repair-app", "Find and fix what broke in an app"),
    ...skills,
  ],
});

const shape = (groups: readonly CommandGroup[]) =>
  groups.map((group) => [group.title, group.entries.map((e) => e.name)]);

Deno.test("lophn-agent/commands#R1 [agent-I6]: typed letters keep only commands whose name or description matches", () => {
  const registry = registryOf([
    skill("code-review", "Review a change"),
    skill("pdf-export", "Export pages as a document"),
  ]);
  // 이름 시작: Compact. 설명의 단어 시작: Fork("Copy ..."). 묶음은 registry 순서 그대로다.
  // 이름의 단어 시작: code-review 의 code는 이름 시작이다.
  assertEquals(shape(listCommands(registry, "lophn", "co")), [
    ["Commands", ["compact", "fork"]],
    ["Skills", ["code-review"]],
  ]);
  assertEquals(shape(listCommands(registry, "lophn", "comp")), [
    ["Commands", ["compact"]],
  ]);
  // 대소문자를 가리지 않는다.
  assertEquals(shape(listCommands(registry, "lophn", "COMP")), [
    ["Commands", ["compact"]],
  ]);
  // 이름의 단어(`-` 뒤) 시작.
  assertEquals(shape(listCommands(registry, "lophn", "review")), [
    ["Skills", ["code-review"]],
  ]);
  // 설명의 단어 시작만으로 맞는다.
  assertEquals(shape(listCommands(registry, "lophn", "pages")), [
    ["Skills", ["pdf-export"]],
  ]);
});

Deno.test("lophn-agent/commands#R1 [agent-I6]: a group with no match is hidden and no match at all gives an empty menu", () => {
  const registry = registryOf([skill("review")]);
  assertEquals(shape(listCommands(registry, "lophn", "repair")), [
    ["lophn", ["repair-app"]],
  ]);
  assertEquals(listCommands(registry, "lophn", "zzz"), []);
});
