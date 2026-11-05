// fake source(agent-tab-fake-source.ts)가 쓰는 `/` 명령 값. lophn-agent/commands가 낸 값을 ACP 꼴로 옮겨 고정했다.
import type { AcpCommand } from "../../../protocol/acp/mod.ts";

function builtin(name: string, description: string): AcpCommand {
  return { name, description, argument_hint: null, source: "builtin" };
}

function skill(name: string, description: string): AcpCommand {
  return { name, description, argument_hint: null, source: "skill" };
}

/** 모든 agent 첫 묶음. 고정 순서이고 알파벳순이 아니며 Feedback은 없다. */
const BUILTIN: readonly AcpCommand[] = [
  builtin("new", "Start a new session with this agent"),
  builtin("rename", "Rename this session"),
  builtin("archive", "Archive this session"),
  builtin("compact", "Summarize this session to free up context"),
  builtin("fork", "Copy this session into a new one"),
  builtin("mcp", "Show MCP server status"),
  builtin("skills", "Turn skills on or off for this agent"),
  builtin("permissions", "Show the apps and MCP servers this agent can use"),
  builtin("status", "Show this session's model, context and usage"),
];

/**
 * lophn에게 core가 낼 값이다: 사람이 부르는 내장 skill(new-app, repair-app. 설명은 SKILL.md frontmatter 그대로)과
 * 전역 skill을 이름 영문 사전순으로 둔다. 사용법 안내 skill은 model이 읽는 것이라 없다.
 */
const SKILLS: readonly AcpCommand[] = [
  skill("eval-metrics", "Compute pass rate and regressions"),
  skill("new-app", "Start a new app with the person."),
  skill("release-notes", "Draft release notes from merged changes"),
  skill("repair-app", "Find out what went wrong in one of the person's apps."),
  skill("weekly-report", "Write the weekly eval report"),
];

export const LOPHN_COMMANDS: readonly AcpCommand[] = [...BUILTIN, ...SKILLS];

/** harness CLI가 주는 명령 몇 개. */
export const CLI_COMMANDS: readonly AcpCommand[] = [
  {
    name: "init",
    description: "Create an AGENTS.md for this project",
    argument_hint: null,
    source: "cli",
  },
  {
    name: "review",
    description: "Review the pending changes",
    argument_hint: "[branch]",
    source: "cli",
  },
];
