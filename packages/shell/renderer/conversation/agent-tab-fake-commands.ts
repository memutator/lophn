// fake source(agent-tab-fake-source.ts)가 쓰는 `/` 메뉴 값. lophn-agent/commands가 낸 값을 그대로 옮겨 고정했다.
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";

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

function skill(
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
  "See which apps this agent can use",
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
  "Start a new app",
);
export const REPAIR_APP = role(
  "repair-app",
  "Repair app",
  "Find and fix what broke in an app",
);

const EVAL_METRICS = skill(
  "eval-metrics",
  "Compute pass rate and regressions",
);
const RELEASE_NOTES = skill(
  "release-notes",
  "Draft release notes from merged changes",
);
const WEEKLY_REPORT = skill(
  "weekly-report",
  "Write the weekly eval report",
);

/** 이름 영문 사전순. 전역 skill과 agent 전용 skill을 가르지 않고 출처 표시도 없다. */
export const SKILLS_GROUP: SlashGroupView = {
  source: "skill",
  title: "Skills",
  entries: [EVAL_METRICS, RELEASE_NOTES, WEEKLY_REPORT],
};
