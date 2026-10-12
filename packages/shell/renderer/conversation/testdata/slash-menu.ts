// `/` 메뉴 test의 입력. lophn-agent/commands(buildRegistry·listCommands)가 낸 값을 그대로 옮겨 고정한
// 순수 data다. 거르기와 묶음 규칙은 여기서 다시 만들지 않고 query별로 나온 결과를 적어 둔다.
import type { SlashMenuProps } from "../slash-menu/slash-menu.tsx";
import type { SlashEntryView, SlashGroupView } from "../slash-menu/types.ts";

function builtin(
  name: string,
  title: string,
  description: string,
  whileRunning: SlashEntryView["whileRunning"] = "run",
): SlashEntryView {
  return {
    name,
    title,
    description,
    source: "builtin",
    skillOrigin: null,
    whileRunning,
  };
}

function role(name: string, title: string, description: string) {
  return {
    name,
    title,
    description,
    source: "role",
    skillOrigin: null,
    whileRunning: "queue",
  } satisfies SlashEntryView;
}

export function skill(
  name: string,
  description: string,
  skillOrigin: SlashEntryView["skillOrigin"] = null,
): SlashEntryView {
  return {
    name,
    title: null,
    description,
    source: "skill",
    skillOrigin,
    whileRunning: "queue",
  };
}

export const NEW_SESSION = builtin(
  "new",
  "New session",
  "Start a new session with this agent",
);
export const RENAME = builtin("rename", "Rename", "Rename this session");
export const ARCHIVE = builtin("archive", "Archive", "Archive this session");
export const COMPACT = builtin(
  "compact",
  "Compact",
  "Summarize this session to free up context",
  "queue",
);
export const FORK = builtin(
  "fork",
  "Fork",
  "Copy this session into a new one",
  "blocked",
);
export const MCP = builtin("mcp", "MCP", "Show MCP server status");
export const SKILLS = builtin(
  "skills",
  "Skills",
  "Turn skills on or off for this agent",
);
export const PERMISSIONS = builtin(
  "permissions",
  "Permissions",
  "Change what this agent may do",
);

/** 모든 agent 첫 묶음. 고정 순서이고 알파벳순이 아니며 Feedback은 없다. */
export const COMMANDS_GROUP: SlashGroupView = {
  source: "builtin",
  title: "Commands",
  entries: [
    NEW_SESSION,
    RENAME,
    ARCHIVE,
    COMPACT,
    FORK,
    MCP,
    SKILLS,
    PERMISSIONS,
  ],
};

export const NEW_APP = role(
  "new-app",
  "New app",
  "Start a new app in this project",
);
export const REPAIR_APP = role(
  "repair-app",
  "Repair app",
  "Find and fix what broke in an app",
);
export const CHECK_CONTRACTS = role(
  "check-contracts",
  "Check contracts",
  "Check every context against its documents",
);
export const NEW_CONTEXT = role(
  "new-context",
  "New context",
  "Set up a new context with you",
);

export const EVAL_METRICS = skill(
  "eval-metrics",
  "Compute pass rate and regressions",
);
export const RELEASE_NOTES = skill(
  "release-notes",
  "Draft release notes from merged changes",
);
export const WEEKLY_REPORT = skill(
  "weekly-report",
  "Write the weekly eval report",
);

/** 이름 영문 사전순. 전역 skill과 agent 전용 skill을 가르지 않고 출처 표시도 없다. */
export const SKILLS_GROUP: SlashGroupView = {
  source: "skill",
  title: "Skills",
  entries: [EVAL_METRICS, RELEASE_NOTES, WEEKLY_REPORT],
};

/** query가 없을 때 lophn 탭: 둘째 묶음 이름은 agent 이름 lophn이다. */
export const LOPHN_ALL: readonly SlashGroupView[] = [
  COMMANDS_GROUP,
  { source: "role", title: "lophn", entries: [NEW_APP, REPAIR_APP] },
  SKILLS_GROUP,
];

/** query가 없을 때 Context Engineer 탭: 둘째 묶음의 이름과 내용이 바뀐다. */
export const CONTEXT_ENGINEER_ALL: readonly SlashGroupView[] = [
  COMMANDS_GROUP,
  {
    source: "role",
    title: "Context Engineer",
    entries: [CHECK_CONTRACTS, NEW_CONTEXT],
  },
  SKILLS_GROUP,
];

/** Operator 탭은 role 명령이 없어 둘째 묶음이 없다. */
export const OPERATOR_ALL: readonly SlashGroupView[] = [
  COMMANDS_GROUP,
  SKILLS_GROUP,
];

/**
 * query "co"의 lophn 탭. 이름이나 설명에서 `co`로 시작하는 단어가 있는 것만 남는다:
 * Compact(이름 Compact, 설명 context), Fork(설명 Copy), eval-metrics(설명 Compute).
 * 맞는 것이 없는 lophn 묶음은 사라졌다.
 */
export const LOPHN_CO: readonly SlashGroupView[] = [
  { source: "builtin", title: "Commands", entries: [COMPACT, FORK] },
  { source: "skill", title: "Skills", entries: [EVAL_METRICS] },
];

/** 같은 이름 skill 둘: 서로 구분되는 출처가 붙고, 이름이 하나뿐인 skill에는 붙지 않는다. */
export const WEEKLY_REPORT_PLACE = skill(
  "weekly-report",
  "Write the weekly eval report",
  "place",
);
export const WEEKLY_REPORT_WORKSPACE = skill(
  "weekly-report",
  "Write the weekly report for the whole workspace",
  "workspace",
);
export const LOPHN_DUPLICATE_SKILLS: readonly SlashGroupView[] = [
  COMMANDS_GROUP,
  { source: "role", title: "lophn", entries: [NEW_APP, REPAIR_APP] },
  {
    source: "skill",
    title: "Skills",
    entries: [
      EVAL_METRICS,
      RELEASE_NOTES,
      WEEKLY_REPORT_PLACE,
      WEEKLY_REPORT_WORKSPACE,
    ],
  },
];

export interface SlashCalls {
  readonly picked: SlashEntryView[];
}

export function slashCalls(): SlashCalls {
  return { picked: [] };
}

/** 기본값: lophn 탭, 입력은 `/`만, 일하는 중 아님. */
export function slashProps(
  over: Partial<SlashMenuProps> = {},
  calls: SlashCalls = slashCalls(),
): SlashMenuProps {
  return {
    agentName: "lophn",
    query: "",
    working: false,
    state: { kind: "list", groups: LOPHN_ALL },
    highlightedIndex: 0,
    onPick: (entry) => calls.picked.push(entry),
    ...over,
  };
}
