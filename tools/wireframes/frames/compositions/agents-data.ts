// agent 화면의 고정 데이터와, 데이터에서 탭을 만드는 작은 함수들. phroner 예시 project의 lophn·Context
// Engineer·Operator 둘과 agent별 session, `/` 명령, 설정 층(Workspace → project → Operator)의 model 값,
// project skill·MCP 목록이다. model과 option은 models-data.ts(catalog)에서만 온다.
import type { ModelSelection } from "./model-options.ts";
import type { TabSpec } from "./project-window.tsx";

/** Weekly report session의 진행. report는 일이 끝난 모양이고 나머지는 사람을 기다리거나 답한 뒤다. */
export type ChatStage = "report" | "question" | "answered" | "approval";

/** model picker를 어떻게 연 채 시작할지. switched는 model을 바꿔 effort를 맞춘 직후다. */
export type ModelDemo = "picker" | "switched";

/** session switcher를 어떻게 연 채 시작할지. edit는 이름 고치기 input과 삭제 확인을 같이 보인다. */
export type SwitcherDemo = "open" | "edit";

/** Agent 탭을 어떤 모양으로 열지. page마다 한 상태를 고정해 보이는 데 쓴다. */
export interface ChatInit {
  readonly stage?: ChatStage;
  /** 새 session의 agent 이름. */
  readonly agent?: string;
  /** 첫 context로 붙은 chip. */
  readonly chip?: string;
  /** 내 메시지의 Rewind menu를 연 채 시작한다. */
  readonly rewind?: boolean;
  /** composer의 model picker를 연 채 시작한다. */
  readonly modelDemo?: ModelDemo;
  /** 승인 카드의 Allow menu를 연 채 시작한다. */
  readonly allowMenu?: boolean;
  /** 진행 chip의 Tasks popover를 연 채 시작한다. */
  readonly tasks?: boolean;
  /** agent header의 session switcher를 연 채 시작한다. */
  readonly switcher?: SwitcherDemo;
  /** 입력칸에 이 글자를 넣고 시작한다("/"나 "/co"면 명령 메뉴가 열린다). */
  readonly slash?: string;
}

/** agent profile의 icon. 사용자가 올린 이미지는 icon 대신 image다. */
export type AvatarIconKey =
  | "dock"
  | "roles"
  | "contexts"
  | "documents"
  | "apps"
  | "search"
  | "series"
  | "bookmark"
  | "terminal"
  | "read"
  | "edit"
  | "compare";

export const AVATAR_ICON_KEYS: readonly AvatarIconKey[] = [
  "dock",
  "roles",
  "contexts",
  "documents",
  "apps",
  "search",
  "series",
  "bookmark",
  "terminal",
  "read",
  "edit",
  "compare",
];

export interface AgentProfile {
  readonly icon: AvatarIconKey;
  /** 사용자가 올린 이미지를 쓴다(icon은 이미지를 지우면 돌아갈 자리). */
  readonly image?: boolean;
}

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly operator?: boolean;
  readonly profile: AgentProfile;
}

/** sidebar Agents 묶음의 줄. "operators"는 줄이 아니라 아래 Operator들의 작은 머리다. */
export const AGENT_ROWS: readonly AgentRow[] = [
  { id: "lophn", name: "lophn", profile: { icon: "dock" } },
  { id: "engineer", name: "Context Engineer", profile: { icon: "contexts" } },
  {
    id: "operators",
    name: "Operators",
    operator: true,
    profile: { icon: "roles" },
  },
  {
    id: "eval-analyst",
    name: "Eval analyst",
    operator: true,
    profile: { icon: "read", image: true },
  },
  {
    id: "experiment-planner",
    name: "Experiment planner",
    operator: true,
    profile: { icon: "compare" },
  },
];

export const profileOf = (name: string): AgentProfile =>
  AGENT_ROWS.find((row) => row.name === name)?.profile ??
    { icon: "dock" };

const nameOf = (id: string) =>
  AGENT_ROWS.find((row) => row.id === id)?.name ?? "lophn";

// ---- session ----

export type SessionState = "waiting" | "working" | "idle";

export interface SessionRow {
  readonly id: string;
  readonly agent: string;
  readonly title: string;
  readonly when: string;
  readonly state: SessionState;
  readonly group: "today" | "earlier" | "archived";
  /** 탭의 `sub`. 없으면 `conv:<id>`. */
  readonly sub?: string;
}

/** agent별 session. switcher는 그 agent의 것만 보인다. */
export const SESSIONS: readonly SessionRow[] = [
  {
    id: "weekly",
    agent: "lophn",
    title: "Weekly report",
    when: "2 min ago",
    state: "waiting",
    group: "today",
    sub: "weekly",
  },
  {
    id: "harness",
    agent: "lophn",
    title: "Harness change summary",
    when: "12 min ago",
    state: "working",
    group: "today",
  },
  {
    id: "release-check",
    agent: "lophn",
    title: "Release notes check",
    when: "3 h ago",
    state: "idle",
    group: "today",
  },
  {
    id: "c049",
    agent: "lophn",
    title: "Findings about C-049",
    when: "2 days ago",
    state: "idle",
    group: "earlier",
  },
  {
    id: "eval-questions",
    agent: "lophn",
    title: "Eval loop questions",
    when: "last week",
    state: "idle",
    group: "earlier",
  },
  {
    id: "old-1",
    agent: "lophn",
    title: "Docs folder cleanup",
    when: "3 weeks ago",
    state: "idle",
    group: "archived",
  },
  {
    id: "old-2",
    agent: "lophn",
    title: "First eval run",
    when: "last month",
    state: "idle",
    group: "archived",
  },
  {
    id: "old-3",
    agent: "lophn",
    title: "Naming the harness",
    when: "last month",
    state: "idle",
    group: "archived",
  },
  {
    id: "release-ctx",
    agent: "Context Engineer",
    title: "Release notes context",
    when: "yesterday",
    state: "idle",
    group: "earlier",
    sub: "engineer",
  },
  {
    id: "failing",
    agent: "Context Engineer",
    title: "Failing scenarios",
    when: "12 min ago",
    state: "working",
    group: "today",
  },
  {
    id: "week41",
    agent: "Eval analyst",
    title: "Week 41 summary",
    when: "1 h ago",
    state: "idle",
    group: "today",
  },
  {
    id: "recipe-gap",
    agent: "Eval analyst",
    title: "Regression on query-recipe-gap",
    when: "3 days ago",
    state: "idle",
    group: "earlier",
  },
  {
    id: "next-experiments",
    agent: "Experiment planner",
    title: "Next experiments for query tools",
    when: "1 h ago",
    state: "idle",
    group: "today",
  },
  {
    id: "exp-013",
    agent: "Experiment planner",
    title: "Plan for exp-013",
    when: "last week",
    state: "idle",
    group: "earlier",
  },
];

export const sessionsOf = (agent: string): readonly SessionRow[] =>
  SESSIONS.filter((row) => row.agent === agent);

export const sessionBySub = (
  agent: string,
  sub: string,
): SessionRow | undefined =>
  sessionsOf(agent).find((row) => (row.sub ?? `conv:${row.id}`) === sub);

export const STATE_TEXT: Record<SessionState, string> = {
  waiting: "Waiting for you",
  working: "Working",
  idle: "",
};

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

/** session을 여는 탭. */
export function sessionTab(row: SessionRow, chat?: ChatInit): TabSpec {
  const sub = row.sub ?? `conv:${row.id}`;
  return {
    key: `conv:${row.id}`,
    kind: "agent",
    title: `${row.title} · ${row.agent}`,
    sub,
    chat: chat ?? (row.id === "weekly" ? { stage: "question" } : undefined),
  };
}

export const weeklyTab = (chat?: ChatInit): TabSpec => ({
  key: "conv:weekly",
  kind: "agent",
  title: "Weekly report · lophn",
  sub: "weekly",
  chat: chat ?? { stage: "question" },
});

/** 작업 중인 lophn session(`/` 메뉴에서 Fork가 흐려지는 것을 보이는 page가 쓴다). */
export const workingTab = (chat?: ChatInit): TabSpec =>
  sessionTab(SESSIONS.find((row) => row.id === "harness")!, chat);

/**
 * toast의 [Ask Context Engineer]가 여는 session. toast가 가리킨 사건(context 계약 위반)이 첫 context로
 * 붙는다. 붙는 것은 사건의 사실과 식별자뿐이다.
 */
export const VIOLATION_CHIP =
  'eval · 2 violations: reports/weekly-12.md (missing "Findings"), reports/weekly-13.md (name doesn\'t match reports/weekly-{n}.md)';
export const askEngineerTab = (): TabSpec => ({
  key: "agent:engineer:toast",
  kind: "agent",
  title: "New session · Context Engineer",
  sub: "new",
  chat: { agent: "Context Engineer", chip: VIOLATION_CHIP },
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

// ---- Operator와 설정 층 ----

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

/** project의 context 목록(Operator에 붙일 수 있는 것). */
export const PROJECT_CONTEXTS: readonly string[] = ["eval", "harness"];

export interface OperatorDef {
  readonly id: string;
  readonly name: string;
  /** 붙은 context. 0개도 된다. */
  readonly contexts: readonly string[];
  readonly skills: readonly string[];
  readonly mcp: readonly string[];
  /** 이 Operator가 바꾼 model. 없으면 project·Workspace 기본값을 따른다. */
  readonly model: ModelSelection | null;
  readonly instructions: string;
}

export const OPERATORS: readonly OperatorDef[] = [
  {
    id: "eval-analyst",
    name: "Eval analyst",
    contexts: ["eval"],
    skills: ["weekly-report", "eval-metrics"],
    mcp: ["github"],
    model: { model: "Sonnet 5.5", values: { effort: "High" } },
    instructions: `# Eval analyst
Explain what changed in the eval loop and why it matters.

1. Read the findings and experiments the person points at.
2. Say which results improved and which regressed.
3. Link every claim to the document it came from.
Keep answers short. Name the scenario for every regression.`,
  },
  {
    id: "experiment-planner",
    name: "Experiment planner",
    contexts: [],
    skills: ["scenario-authoring"],
    mcp: [],
    model: null,
    instructions: `# Experiment planner
Plan the next experiments from what the project documents already say.

Propose at most three experiments. For each one write the question, the
change to try and how you will know it worked. Ask before you create files.`,
  },
];

export const operatorOf = (id: string): OperatorDef | undefined =>
  OPERATORS.find((item) => item.id === id);

/** 이 context를 쓰는 Operator의 이름(Contexts 탭의 "쓰는 Operator"). */
export const operatorsUsing = (context: string): readonly string[] =>
  OPERATORS.filter((item) => item.contexts.includes(context)).map((item) =>
    item.name
  );

/** 층마다 정한 model. Workspace 기본값 → project → Operator 순서로 덮는다. */
export interface RoleModel {
  readonly role: string;
  readonly workspace: ModelSelection;
  /** project가 바꾼 값. 없으면 Workspace를 따른다. */
  readonly project: ModelSelection | null;
}

export const ROLE_MODELS: readonly RoleModel[] = [
  {
    role: "lophn",
    workspace: { model: "Sonnet 5.5", values: { effort: "Medium" } },
    project: null,
  },
  {
    role: "Context Engineer",
    workspace: { model: "Sonnet 5.5", values: { effort: "High" } },
    project: {
      model: "Opus 5.5",
      values: { effort: "High", speed: "Standard" },
    },
  },
  {
    role: "App Engineer",
    workspace: {
      model: "Opus 5.5",
      values: { effort: "High", speed: "Standard" },
    },
    project: null,
  },
  {
    role: "Operators",
    workspace: { model: "Haiku 5.5", values: {} },
    project: null,
  },
];

export const roleModel = (role: string): RoleModel =>
  ROLE_MODELS.find((row) => row.role === role) ?? ROLE_MODELS[0];

/** project의 Context Engineer처럼 Operator 위 층이 정한 model(없으면 Workspace). */
export const effectiveRoleModel = (role: string): ModelSelection => {
  const row = roleModel(role);
  return row.project ?? row.workspace;
};

/** 새 session의 model. agent 정의의 기본값에서 오고, composer에서 고르면 그 session만 바뀐다. */
export const SESSION_MODEL: ModelSelection = {
  model: "Sonnet 5.5",
  values: { effort: "Medium" },
};

/** A3b: picker를 연 session의 model(effort 밖의 option 축이 보이는 model). */
export const DEMO_PICKER: ModelSelection = {
  model: "GPT-6.1 Sol",
  values: { effort: "High", speed: "Priority" },
};

/** A3c: 이 model에서 아래 model로 바꾸면 없는 effort가 가까운 약한 값으로 맞춰지고 한 줄로 알린다. */
export const DEMO_SWITCH_FROM: ModelSelection = {
  model: "GPT-6.1 Sol",
  values: { effort: "XHigh", speed: "Priority" },
};
export const DEMO_SWITCH_TO = "Sonnet 5.5";

export const LOPHN_MD_PREVIEW = `# phroner
Eval loop for the harness. Findings go in loop/findings.
Reports go in docs/reports. Keep summaries short.
Ask before you rewrite a report that is already published.`;

export const GLOBAL_LOPHN_MD_PREVIEW = `# About me
I run the eval loop on my own. Answer in short plain sentences.
Ask before you change a document I did not mention.`;

// ---- `/` 명령 ----

export interface SlashCommand {
  readonly name: string;
  readonly text: string;
  /** 작업 중에는 쓸 수 없다. */
  readonly idleOnly?: boolean;
}

export interface SlashGroup {
  readonly title: string;
  readonly items: readonly SlashCommand[];
}

/** 전역 built-in. 모든 agent가 같다. 자주 쓰는 순서이고 알파벳 순이 아니다. */
export const GLOBAL_COMMANDS: SlashGroup = {
  title: "Commands",
  items: [
    { name: "Compact", text: "Summarize this session to free up context" },
    { name: "Fork", text: "Copy this session into a new one", idleOnly: true },
    { name: "Rename", text: "Rename this session" },
    { name: "Archive", text: "Archive this session" },
    { name: "New session", text: "Start a fresh session with this agent" },
    { name: "MCP", text: "Show MCP server status" },
    { name: "Skills", text: "Turn skills on or off" },
    { name: "Permissions", text: "Change what lophn may do" },
    { name: "Feedback", text: "Send feedback about this session" },
  ],
};

/** agent별 built-in. 이름이 같은 agent의 묶음만 둘째에 보인다(Operator는 없다). */
export const ROLE_COMMANDS: Readonly<Record<string, readonly SlashCommand[]>> =
  {
    lophn: [
      { name: "New app", text: "Start a new app in this project" },
      { name: "Repair app", text: "Find and fix what broke in an app" },
    ],
    "Context Engineer": [
      {
        name: "Check contracts",
        text: "Check every context against its documents",
      },
      { name: "New context", text: "Set up a new context with you" },
    ],
  };

/** skill. 전역과 이 agent 전용을 가르지 않고 출처 badge도 없다. */
export const SKILL_COMMANDS: SlashGroup = {
  title: "Skills",
  items: [
    { name: "weekly-report", text: "Write the weekly eval report" },
    { name: "eval-metrics", text: "Compute pass rate and regressions" },
    {
      name: "release-notes",
      text: "Draft release notes from merged changes",
    },
  ],
};
