import {
  type AgentRole,
  BUILTIN_COMMAND_IDS,
  type CommandEntry,
  type CommandNotice,
  type SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  CHECK_CONTRACTS_PROMPT,
  NEW_APP_PROMPT,
  NEW_CONTEXT_PROMPT,
  REPAIR_APP_PROMPT,
} from "./role-prompts.ts";

// `/` 명령 registry(concern lophn-agent/commands). 저장하는 표가 아니라 열 때마다
// 코드의 built-in·role 목록과 그 agent가 쓸 수 있는 skill에서 계산하는 값이다(domain
// model 정책). IO가 없는 순수 함수다.

// extensions의 skill 발견 결과에서 registry가 쓰는 칸만이다. `origin`은 skill을 찾은
// 층(builtin, global, project)이고, `selected`는 agent 정의에서
// 끄지 않았는지다.
export type RegistrySkill = {
  name: string;
  description: string;
  origin: SkillSource;
  selected: boolean;
};

export type RegistryInput = {
  role: AgentRole;
  skills: readonly RegistrySkill[];
};

// entries는 전역 built-in(고정 순서) · role 명령 · skill(이름 사전순)의 순서다.
// notices는 built-in 이름과 같아 `/`에서 빠진 skill을 알린다.
export type CommandRegistry = {
  entries: readonly CommandEntry[];
  notices: readonly CommandNotice[];
};

type BuiltinId = typeof BUILTIN_COMMAND_IDS[number];

const BUILTIN_TABLE: Record<
  BuiltinId,
  Pick<CommandEntry, "title" | "description" | "while_running">
> = {
  new: {
    title: "New session",
    description: "Start a new session with this agent",
    while_running: "run",
  },
  rename: {
    title: "Rename",
    description: "Rename this session",
    while_running: "run",
  },
  archive: {
    title: "Archive",
    description: "Archive this session",
    while_running: "run",
  },
  compact: {
    title: "Compact",
    description: "Summarize this session to free up context",
    while_running: "queue",
  },
  fork: {
    title: "Fork",
    description: "Copy this session into a new one",
    while_running: "blocked",
  },
  mcp: {
    title: "MCP",
    description: "Show MCP server status",
    while_running: "run",
  },
  skills: {
    title: "Skills",
    description: "Turn skills on or off for this agent",
    while_running: "run",
  },
  permissions: {
    title: "Permissions",
    description: "Change what this agent may do",
    while_running: "run",
  },
  recap: {
    title: "Recap",
    description: "Summarize this session on screen",
    while_running: "run",
  },
};

// 모든 agent 공통 전역 built-in을 고정 순서로 준다.
export function builtinCommands(): readonly CommandEntry[] {
  return BUILTIN_COMMAND_IDS.map((id): CommandEntry => ({
    name: id,
    ...BUILTIN_TABLE[id],
    source: "builtin",
    skill_origin: null,
    action: { kind: "builtin", id },
  }));
}

function promptCommand(
  name: string,
  title: string,
  description: string,
  template: string,
): CommandEntry {
  return {
    name,
    title,
    description,
    source: "role",
    skill_origin: null,
    while_running: "queue",
    action: { kind: "prompt", template },
  };
}

// role 명령을 더하는 자리는 role마다의 목록 하나다.
const ROLE_COMMANDS: Record<AgentRole, readonly CommandEntry[]> = {
  lophn: [
    promptCommand(
      "new-app",
      "New app",
      "Start a new app in this project",
      NEW_APP_PROMPT,
    ),
    promptCommand(
      "repair-app",
      "Repair app",
      "Find and fix what broke in an app",
      REPAIR_APP_PROMPT,
    ),
  ],
  context_engineer: [
    promptCommand(
      "check-contracts",
      "Check contracts",
      "Check every context against its documents",
      CHECK_CONTRACTS_PROMPT,
    ),
    promptCommand(
      "new-context",
      "New context",
      "Set up a new context with you",
      NEW_CONTEXT_PROMPT,
    ),
  ],
  app_engineer: [],
  operator: [],
};

// 그 role의 built-in이다. lophn은 New app · Repair app, Context Engineer는 Check
// contracts · New context, App Engineer와 Operator는 빈 목록이다.
export function roleCommands(role: AgentRole): readonly CommandEntry[] {
  return ROLE_COMMANDS[role].map((entry) => structuredClone(entry));
}

// 이름 영문 사전순이고, 같은 이름은 마지막 층(project, global, builtin 순)이 앞이다.
const ORIGIN_RANK: Record<SkillSource, number> = {
  project: 0,
  global: 1,
  builtin: 2,
};
function compareSkills(a: RegistrySkill, b: RegistrySkill): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
}

export function buildRegistry(input: RegistryInput): CommandRegistry {
  const builtins = builtinCommands();
  const roles = roleCommands(input.role);
  const reserved = new Map<string, CommandNotice["reserved_by"]>();
  for (const entry of builtins) reserved.set(entry.name, "builtin");
  for (const entry of roles) reserved.set(entry.name, "role");

  // 끈 skill은 없는 것과 같다. 예약된 이름의 skill은 목록에서 빠지고 알림이 된다.
  const selected = input.skills.filter((skill) => skill.selected)
    .toSorted(compareSkills);
  const usable = selected.filter((skill) => !reserved.has(skill.name));
  const notices: CommandNotice[] = [];
  for (const skill of selected) {
    const reserved_by = reserved.get(skill.name);
    if (
      reserved_by !== undefined &&
      notices[notices.length - 1]?.name !== skill.name
    ) {
      notices.push({ kind: "reserved_name", name: skill.name, reserved_by });
    }
  }

  // 출처는 같은 이름이 둘 이상일 때만 붙인다.
  const counts = new Map<string, number>();
  for (const skill of usable) {
    counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  }
  const skillEntries = usable.map((skill): CommandEntry => ({
    name: skill.name,
    title: null,
    description: skill.description,
    source: "skill",
    skill_origin: (counts.get(skill.name) ?? 0) > 1 ? skill.origin : null,
    while_running: "queue",
    action: { kind: "skill", skill_name: skill.name },
  }));

  return { entries: [...builtins, ...roles, ...skillEntries], notices };
}
