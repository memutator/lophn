// agent 화면의 고정 데이터와, 데이터에서 탭을 만드는 작은 함수들. phroner 예시 project의 lophn·Context
// Engineer·Operator 둘과 최근 대화, 고를 수 있는 model, project skill·MCP 목록이다.
import type { TabSpec } from "./project-window.tsx";

/** Weekly report 대화의 진행. report는 일이 끝난 모양이고 나머지는 사람을 기다리거나 답한 뒤다. */
export type ChatStage = "report" | "question" | "answered" | "approval";

/** 대화 탭을 어떤 모양으로 열지. page마다 한 상태를 고정해 보이는 데 쓴다. */
export interface ChatInit {
  readonly stage?: ChatStage;
  /** 새 대화의 agent 이름. */
  readonly agent?: string;
  /** 첫 context로 붙은 chip. */
  readonly chip?: string;
  /** 내 메시지의 Rewind menu를 연 채 시작한다. */
  readonly rewind?: boolean;
  /** composer의 model picker를 연 채 시작한다. */
  readonly model?: boolean;
  /** 승인 카드의 Allow menu를 연 채 시작한다. */
  readonly allowMenu?: boolean;
  /** 진행 chip의 Tasks popover를 연 채 시작한다. */
  readonly tasks?: boolean;
}

export type ConvState = "waiting" | "working" | "done";

export interface ConversationRow {
  readonly id: string;
  readonly title: string;
  readonly agent: string;
  readonly when: string;
  readonly state: ConvState;
}

/** sidebar의 최근 대화. Waiting for you가 맨 위다. */
export const CONVERSATIONS: readonly ConversationRow[] = [
  {
    id: "weekly",
    title: "Weekly report",
    agent: "lophn",
    when: "2 min ago",
    state: "waiting",
  },
  {
    id: "failing",
    title: "Failing scenarios",
    agent: "Context Engineer",
    when: "12 min ago",
    state: "working",
  },
  {
    id: "nightly",
    title: "Nightly scenario check",
    agent: "Operator",
    when: "1 h ago",
    state: "done",
  },
  {
    id: "release-notes",
    title: "Release notes context",
    agent: "Context Engineer",
    when: "yesterday",
    state: "done",
  },
  {
    id: "c049",
    title: "Findings about C-049",
    agent: "lophn",
    when: "2 days ago",
    state: "done",
  },
];

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly operator?: boolean;
}

/** sidebar Agents 묶음의 줄. "operators"는 줄이 아니라 아래 Operator들의 작은 머리다. */
export const AGENT_ROWS: readonly AgentRow[] = [
  { id: "lophn", name: "lophn" },
  { id: "engineer", name: "Context Engineer" },
  { id: "operators", name: "Operators" },
  { id: "weekly-eval-report", name: "Weekly eval report", operator: true },
  {
    id: "nightly-scenario-check",
    name: "Nightly scenario check",
    operator: true,
  },
];

const nameOf = (id: string) =>
  AGENT_ROWS.find((row) => row.id === id)?.name ?? "lophn";

let fresh = 0;

/** sidebar에서 agent를 눌러 여는 새 Agent 탭. 누를 때마다 새 탭이다. */
export function newConversationTab(
  agent: string,
  chat: Pick<ChatInit, "chip"> = {},
  key?: string,
): TabSpec {
  fresh += 1;
  const name = nameOf(agent);
  return {
    key: key ?? `agent:${agent}:${fresh}`,
    kind: "agent",
    title: `New session · ${name}`,
    sub: "new",
    chat: { agent: name, ...chat },
  };
}

/** 최근 대화를 다시 여는 탭. */
export function conversationTab(
  row: ConversationRow,
  chat?: ChatInit,
): TabSpec {
  return {
    key: `conv:${row.id}`,
    kind: "agent",
    title: row.agent === "Operator" ? row.title : `${row.title} · ${row.agent}`,
    sub: row.id === "weekly" ? "weekly" : `conv:${row.id}`,
    chat: chat ?? (row.id === "weekly" ? { stage: "question" } : undefined),
  };
}

export const WEEKLY: ConversationRow = CONVERSATIONS[0];
export const weeklyTab = (chat?: ChatInit): TabSpec => ({
  key: "conv:weekly",
  kind: "agent",
  title: "Weekly report · lophn",
  sub: "weekly",
  chat: chat ?? { stage: "question" },
});

/** toast의 [Ask lophn]이 여는 대화. toast가 가리킨 일이 첫 context로 붙는다. */
export const FAILED_RUN_CHIP =
  "Failed in eval run 2026-10-10: query-recipe-gap, sched-edit, wake-plant";
export const askLophnTab = (): TabSpec => ({
  key: "agent:lophn:toast",
  kind: "agent",
  title: "New session · lophn",
  sub: "new",
  chat: { agent: "lophn", chip: FAILED_RUN_CHIP },
});

export const AGENTS_TAB: TabSpec = {
  key: "agents",
  kind: "agents",
  title: "phroner · Agents",
};

export const operatorTab = (id: string): TabSpec => {
  const name = nameOf(id);
  const builtIn = id === "lophn" || id === "engineer";
  return {
    key: `agent-edit:${id}`,
    kind: "operator",
    title: id === "new" ? "New Operator" : name,
    label: builtIn ? "Agent" : "Operator",
    sub: id,
  };
};

/** composer의 model picker. 연결된 provider(Anthropic·OpenAI·OpenRouter)의 model만 보인다. */
export const PROVIDER_MODELS: readonly {
  readonly provider: string;
  readonly models: readonly string[];
}[] = [
  { provider: "Anthropic", models: ["Sonnet 5.5", "Opus 5.5", "Haiku 5.5"] },
  { provider: "OpenAI", models: ["GPT-6.1 Sol", "GPT-6.1 mini"] },
  { provider: "OpenRouter", models: ["DeepSeek V4.1 Flash", "GLM 5.3 Flash"] },
];

export const EFFORTS = ["Low", "Medium", "High"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ToggleItem {
  readonly name: string;
  readonly detail: string;
  readonly on: boolean;
  /** MCP server의 상태. */
  readonly status?: "connected" | "needs-sign-in" | "off";
}

export const PROJECT_SKILLS: readonly ToggleItem[] = [
  {
    name: "weekly-report",
    detail: "Writes the weekly eval report from new findings.",
    on: true,
  },
  {
    name: "eval-metrics",
    detail: "Explains the eval metrics and their ranges.",
    on: true,
  },
  {
    name: "scenario-authoring",
    detail: "Drafts scenario files under eval/scenarios.",
    on: false,
  },
];

export const PROJECT_MCP: readonly ToggleItem[] = [
  {
    name: "github",
    detail: "Issues and pull requests of the harness repo",
    on: true,
    status: "connected",
  },
  {
    name: "linear",
    detail: "Planning board",
    on: false,
    status: "needs-sign-in",
  },
];

export const GLOBAL_SKILLS: readonly ToggleItem[] = [
  {
    name: "plain-writing",
    detail: "Keeps summaries short and in plain words.",
    on: true,
  },
  {
    name: "cite-documents",
    detail: "Links every claim to the document it came from.",
    on: true,
  },
];

export const GLOBAL_MCP: readonly ToggleItem[] = [
  {
    name: "fetch",
    detail: "Reads a web page as Markdown",
    on: true,
    status: "connected",
  },
  {
    name: "calendar",
    detail: "Reads your calendar",
    on: false,
    status: "off",
  },
];

export const LOPHN_MD_PREVIEW = `# phroner
Eval loop for the harness. Findings go in loop/findings.
Reports go in docs/reports. Keep summaries short.`;

export const GLOBAL_LOPHN_MD_PREVIEW = `# About me
I run the eval loop on my own. Answer in short plain sentences.
Ask before you change a document I did not mention.`;
