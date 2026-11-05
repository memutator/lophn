// fake source(agent-tab-fake-source.ts)가 쓰는 `/` 명령 값. core가 낼 값(lophn 내장의 `opens`·별칭·인자 hint)과 harness CLI가
// 낼 값을 손으로 적었다.
import type { AcpCommand, AcpCommandOpens } from "../../../protocol/acp/mod.ts";

function commandOf(
  source: AcpCommand["source"],
  name: string,
  description: string,
  rest: Partial<Pick<AcpCommand, "aliases" | "argument_hint" | "opens">> = {},
): AcpCommand {
  return {
    name,
    aliases: [],
    description,
    argument_hint: null,
    source,
    opens: null,
    ...rest,
  };
}

function builtin(
  name: string,
  description: string,
  opens: AcpCommandOpens,
  rest: Partial<Pick<AcpCommand, "aliases" | "argument_hint">> = {},
): AcpCommand {
  return commandOf("app", name, description, { opens, ...rest });
}

function skill(name: string, description: string): AcpCommand {
  return commandOf("skill", name, description);
}

/** lophn 내장. 순서가 메뉴 순서이고 `/clear`는 `/new`의 별칭이다. */
const BUILTIN: readonly AcpCommand[] = [
  builtin("new", "Start a new session with this agent", "new", {
    aliases: ["clear"],
  }),
  builtin("model", "Choose the model and its options", "model"),
  builtin("effort", "Change how much the model thinks", "effort"),
  builtin(
    "permissions",
    "Show the apps and MCP servers this agent can use",
    "permissions",
  ),
  builtin("status", "Show this session's model, context and usage", "status"),
  builtin("usage", "Show tokens and cost for this session", "usage"),
  builtin("context", "Show how full the context window is", "context"),
  builtin("rewind", "Go back to an earlier message", "rewind"),
  builtin("fork", "Copy this session into a new one", "fork"),
  builtin("rename", "Rename this session", "rename", {
    argument_hint: "[title]",
  }),
  builtin("compact", "Summarize this session to free up context", "compact"),
  builtin("archive", "Archive this session", "archive"),
  builtin("mcp", "Show MCP server status", "mcp"),
  builtin("skills", "Turn skills on or off for this agent", "skills"),
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

/** harness adapter가 GUI 동작으로 내는 명령(`source: "app"`). harness는 같은 탭의 새 session을 `opens: null`로 연다. */
export const HARNESS_APP_COMMANDS: readonly AcpCommand[] = [
  builtin("model", "Choose the model and its options", "model"),
  builtin("effort", "Change how much the model thinks", "effort"),
  builtin("permissions", "Change what the agent may do without asking", "mode"),
  builtin("status", "Show this session's model, context and usage", "status"),
  builtin("usage", "Show plan usage limits", "usage"),
  builtin("context", "Show how full the context window is", "context"),
  builtin("rewind", "Go back to an earlier message", "rewind"),
  builtin("compact", "Summarize this session to free up context", "compact"),
];

/** harness CLI가 주는 명령 몇 개. 하나는 인자 hint를, 하나는 별칭을 가진다. */
export const CLI_COMMANDS: readonly AcpCommand[] = [
  commandOf("harness", "init", "Create an AGENTS.md for this project"),
  commandOf("harness", "review", "Review the pending changes", {
    argument_hint: "[branch]",
  }),
  commandOf("harness", "config", "Open the settings", {
    aliases: ["settings"],
  }),
  commandOf("harness", "cost", "Show the cost of this session"),
];

/** harness CLI session에 붙은 skill·plugin·MCP·사람 명령 file. 묶음마다 하나씩이다. */
export const HARNESS_EXTRA_COMMANDS: readonly AcpCommand[] = [
  skill("consolidate-docs", "Merge overlapping notes into one page"),
  commandOf("plugin", "frontend-design", "Design a polished interface"),
  commandOf("mcp", "linear:create-issue", "Create an issue in Linear"),
  commandOf("custom_user", "standup", "Draft today's standup from commits"),
  commandOf("custom_project", "deploy", "Ship the current branch to staging", {
    argument_hint: "[environment]",
  }),
];
