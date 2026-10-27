// fake source(agent-tab-fake-source.ts)가 쓰는 `/` 메뉴 값. lophn-agent/commands가 낸 값을 그대로 옮겨 고정했다.
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";

function builtin(
  name: string,
  title: string,
  description: string,
): SlashEntryView {
  return { name, title, description, source: "builtin" };
}

function skill(name: string, description: string): SlashEntryView {
  return { name, title: null, description, source: "skill" };
}

/** 모든 agent 첫 묶음. 고정 순서이고 알파벳순이 아니며 Feedback은 없다. */
export const COMMANDS_GROUP: SlashGroupView = {
  source: "builtin",
  title: "Commands",
  entries: [
    builtin("new", "New session", "Start a new session with this agent"),
    builtin("rename", "Rename", "Rename this session"),
    builtin("archive", "Archive", "Archive this session"),
    builtin("compact", "Compact", "Summarize this session to free up context"),
    builtin("fork", "Fork", "Copy this session into a new one"),
    builtin("mcp", "MCP", "Show MCP server status"),
    builtin("skills", "Skills", "Turn skills on or off for this agent"),
    builtin(
      "permissions",
      "Permissions",
      "Show the apps and MCP servers this agent can use",
    ),
  ],
};

/**
 * lophn에게 core가 낼 값이다: 사람이 부르는 내장 skill(new-app, repair-app. 설명은 SKILL.md frontmatter 그대로)과
 * 전역 skill을 이름 영문 사전순으로 둔다. 사용법 안내 skill은 model이 읽는 것이라 없다.
 */
export const SKILLS_GROUP: SlashGroupView = {
  source: "skill",
  title: "Skills",
  entries: [
    skill("eval-metrics", "Compute pass rate and regressions"),
    skill(
      "new-app",
      "Start a new app with the person: find out what it should do, check what already exists, then register it and hand it to its App Engineer.",
    ),
    skill("release-notes", "Draft release notes from merged changes"),
    skill(
      "repair-app",
      "Find out what went wrong in one of the person's apps from its status, log and failed calls, tell the person what you found, and hand the fix to that app's App Engineer.",
    ),
    skill("weekly-report", "Write the weekly eval report"),
  ],
};
