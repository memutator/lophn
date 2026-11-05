import {
  BUILTIN_COMMAND_IDS,
  BUILTIN_SKILLS,
  type CommandEntry,
  type SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";

// `/` 명령 registry. 저장하는 표가 아니라 열 때마다
// 코드의 built-in 목록과 그 agent가 쓸 수 있는 skill에서 계산하는 값이다(domain
// model 정책). IO가 없는 순수 함수다.

// extensions의 skill 발견 결과에서 registry가 쓰는 칸만이다. `origin`은 skill을 찾은
// 층(builtin, global, workspace-data 등)이고, `selected`는 agent 정의에서
// 끄지 않았는지다. 같은 이름은 발견이 한 줄로 줄여 준다.
export type RegistrySkill = {
  name: string;
  description: string;
  origin: SkillSource;
  selected: boolean;
};

type BuiltinId = (typeof BUILTIN_COMMAND_IDS)[number];

const BUILTIN_TABLE: Record<
  BuiltinId,
  Pick<CommandEntry, "title" | "description">
> = {
  new: {
    title: "New session",
    description: "Start a new session with this agent",
  },
  rename: { title: "Rename", description: "Rename this session" },
  archive: { title: "Archive", description: "Archive this session" },
  compact: {
    title: "Compact",
    description: "Summarize this session to free up context",
  },
  fork: { title: "Fork", description: "Copy this session into a new one" },
  mcp: { title: "MCP", description: "Show MCP server status" },
  skills: {
    title: "Skills",
    description: "Turn skills on or off for this agent",
  },
  permissions: {
    title: "Permissions",
    description: "Show the apps and MCP servers this agent can use",
  },
  status: {
    title: "Status",
    description: "Show this session's model, context and usage",
  },
};

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_COMMAND_IDS);

// 안내 skill(menu=false)은 model이 읽는 것이라 메뉴에서 뺀다. 사람은 말로 묻는다. 사람이 쓴 skill은 늘 뜬다.
function onMenu(skill: RegistrySkill): boolean {
  if (skill.origin !== "builtin") return true;
  return (
    BUILTIN_SKILLS.find((builtin) => builtin.name === skill.name)?.menu ?? false
  );
}

// built-in(고정 순서) 뒤에 skill(이름 사전순)이다. 끈 skill은 없는 것과 같고, built-in 이름과 같은 skill은 `/`로
// 부를 수 없어 빠진다(skill 자체는 읽을 수 있다).
export function buildRegistry(
  skills: readonly RegistrySkill[],
): CommandEntry[] {
  const builtins = BUILTIN_COMMAND_IDS.map(
    (id): CommandEntry => ({
      name: id,
      ...BUILTIN_TABLE[id],
      source: "builtin",
    }),
  );
  const skillEntries = skills
    .filter(
      (skill) =>
        skill.selected && !BUILTIN_NAMES.has(skill.name) && onMenu(skill),
    )
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(
      (skill): CommandEntry => ({
        name: skill.name,
        title: null,
        description: skill.description,
        source: "skill",
      }),
    );
  return [...builtins, ...skillEntries];
}
