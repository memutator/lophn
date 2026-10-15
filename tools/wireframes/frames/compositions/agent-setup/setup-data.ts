// agent 설정 화면들의 고정 데이터. phroner 예시 project의 Project Manager, Operator 둘, 앱 Budget tracker의
// App Engineer, 그리고 층(Workspace → project → agent)마다 정한 model·skill·MCP와 agent grant의 대상들이다.
import type { AgentProfile } from "../agents-data.ts";
import type { ModelSelection } from "../model-options.ts";
import type { TabSpec } from "../project-window.tsx";

// ---- agent ----

export type AgentRole =
  | "lophn"
  | "Project Manager"
  | "App Engineer"
  | "Operator";

export interface AgentSpec {
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly profile: AgentProfile;
  /** 놓인 곳. lophn은 놓인 곳이 없다. */
  readonly place: {
    readonly kind: "project" | "app" | "none";
    readonly name: string;
  };
  readonly summary: string;
  /** 이 agent가 바꾼 model. 없으면 위 층을 따른다. */
  readonly model: ModelSelection | null;
  readonly instructions: string;
  /** 붙은 context(project에 놓인 Operator만). */
  readonly contexts: readonly string[];
  /** 이 agent에서 꺼 둔 skill. */
  readonly skillsOff: readonly string[];
  /** 이 agent에서 켠 MCP server. */
  readonly mcpOn: readonly string[];
}

export const PROJECT = "phroner";
export const SOURCE_APP = "Budget tracker";

export const LOPHN: AgentSpec = {
  id: "lophn",
  name: "lophn",
  role: "lophn",
  profile: { icon: "dock" },
  place: { kind: "none", name: "All of lophn" },
  summary:
    "Talks with you about lophn itself: your projects, apps and settings.",
  model: null,
  instructions: `Answer in short plain sentences.
When a question is about one project, read that project's LOPHN.md first.`,
  contexts: [],
  skillsOff: [],
  mcpOn: ["fetch"],
};

export const MANAGER: AgentSpec = {
  id: "project-manager",
  name: "Project Manager",
  role: "Project Manager",
  profile: { icon: "contexts" },
  place: { kind: "project", name: PROJECT },
  summary: "Keeps this project's contexts and searches in shape.",
  model: null,
  instructions: "",
  contexts: [],
  skillsOff: ["scenario-authoring"],
  mcpOn: [],
};

const APP_ENGINEER: AgentSpec = {
  id: "app-engineer",
  name: "App Engineer",
  role: "App Engineer",
  profile: { icon: "apps" },
  place: { kind: "app", name: SOURCE_APP },
  summary: "Builds and repairs Budget tracker from its source folder.",
  model: { model: "Opus 5.5", values: { effort: "High", speed: "Standard" } },
  instructions:
    `Keep the app small. Change one app-api at a time and run the app's test before you ask me to check it.`,
  contexts: [],
  skillsOff: ["weekly-report", "eval-metrics", "scenario-authoring"],
  mcpOn: ["github"],
};

const EVAL_ANALYST: AgentSpec = {
  id: "eval-analyst",
  name: "Eval analyst",
  role: "Operator",
  profile: { icon: "read", image: true },
  place: { kind: "project", name: PROJECT },
  summary: "Explains what changed in the eval loop and why it matters.",
  model: { model: "Sonnet 5.5", values: { effort: "High" } },
  instructions: `# Eval analyst
Explain what changed in the eval loop and why it matters.

1. Read the findings and experiments the person points at.
2. Say which results improved and which regressed.
3. Link every claim to the document it came from.
Keep answers short. Name the scenario for every regression.`,
  contexts: ["eval"],
  skillsOff: ["scenario-authoring"],
  mcpOn: ["github"],
};

const EXPERIMENT_PLANNER: AgentSpec = {
  id: "experiment-planner",
  name: "Experiment planner",
  role: "Operator",
  profile: { icon: "compare" },
  place: { kind: "project", name: PROJECT },
  summary: "Plans the next experiments from what the project documents say.",
  model: null,
  instructions: `# Experiment planner
Propose at most three experiments. For each one write the question, the
change to try and how you will know it worked. Ask before you create files.`,
  contexts: [],
  skillsOff: ["weekly-report", "eval-metrics"],
  mcpOn: [],
};

export const OPERATORS: readonly AgentSpec[] = [
  EVAL_ANALYST,
  EXPERIMENT_PLANNER,
];

export const AGENTS: readonly AgentSpec[] = [
  LOPHN,
  MANAGER,
  APP_ENGINEER,
  ...OPERATORS,
];

export const agentOf = (id: string): AgentSpec | undefined =>
  AGENTS.find((agent) => agent.id === id);

/** project의 context 목록(Operator에 붙일 수 있는 것). */
export const PROJECT_CONTEXTS: readonly string[] = ["eval", "harness"];

// ---- 탭 ----

export const AGENTS_TAB_SPEC: TabSpec = {
  key: "agents",
  kind: "agents",
  title: `${PROJECT} · Agents`,
};

/** agent 설정 화면을 여는 탭. 새 Operator는 id가 "new"다. */
export function agentTab(id: string): TabSpec {
  const agent = agentOf(id);
  return {
    key: `agent-edit:${id}`,
    kind: "operator",
    title: agent?.name ?? "New Operator",
    label: agent?.role === "Operator" || agent === undefined
      ? "Operator"
      : "Agent",
    sub: id,
  };
}

// ---- model ----

/** Workspace 전역 기본 model 하나. */
export const GLOBAL_MODEL: ModelSelection = {
  model: "Sonnet 5.5",
  values: { effort: "Medium" },
};

/** project 층 model 하나. 없으면 Workspace 기본을 따른다. */
export const PROJECT_MODEL: ModelSelection | null = null;

// ---- 지침 ----

export const LOPHN_MD_PREVIEW = `# phroner
Eval loop for the harness. Findings go in loop/findings.
Reports go in docs/reports. Keep summaries short.
Ask before you rewrite a report that is already published.`;

export const GLOBAL_LOPHN_MD_PREVIEW = `# About me
I run the eval loop on my own. Answer in short plain sentences.
Ask before you change a document I did not mention.`;

// ---- skill와 MCP ----

export type Layer = "Workspace" | "Project" | "This agent";

export interface SkillItem {
  readonly name: string;
  readonly detail: string;
  readonly layer: Exclude<Layer, "This agent">;
  /** 그 층에서 켜 있나. */
  readonly on: boolean;
}

export type McpStatus = "connected" | "needs-sign-in" | "off";

export interface McpItem {
  readonly name: string;
  readonly detail: string;
  readonly layer: Layer;
  readonly on: boolean;
  readonly status: McpStatus;
}

export const SKILLS: readonly SkillItem[] = [
  {
    name: "plain-writing",
    detail: "Keeps summaries short and in plain words.",
    layer: "Workspace",
    on: true,
  },
  {
    name: "cite-documents",
    detail: "Links every claim to the document it came from.",
    layer: "Workspace",
    on: true,
  },
  {
    name: "weekly-report",
    detail: "Writes the weekly eval report from new findings.",
    layer: "Project",
    on: true,
  },
  {
    name: "eval-metrics",
    detail: "Explains the eval metrics and their ranges.",
    layer: "Project",
    on: true,
  },
  {
    name: "scenario-authoring",
    detail: "Drafts scenario files under eval/scenarios.",
    layer: "Project",
    on: false,
  },
];

export const MCP_SERVERS: readonly McpItem[] = [
  {
    name: "fetch",
    detail: "Reads a web page as Markdown",
    layer: "Workspace",
    on: true,
    status: "connected",
  },
  {
    name: "calendar",
    detail: "Reads your calendar",
    layer: "Workspace",
    on: false,
    status: "off",
  },
  {
    name: "github",
    detail: "Issues and pull requests of the harness repo",
    layer: "Project",
    on: true,
    status: "connected",
  },
  {
    name: "linear",
    detail: "Planning board",
    layer: "Project",
    on: false,
    status: "needs-sign-in",
  },
];

/** Workspace Settings의 전역 목록. */
export const GLOBAL_SKILLS = SKILLS.filter((item) =>
  item.layer === "Workspace"
);
export const GLOBAL_MCP = MCP_SERVERS.filter((item) =>
  item.layer === "Workspace"
);
/** Eval analyst가 agent 층에서 더한 server. 이름이 같은 서버가 위 층에 있으면 덮는다. */
export const AGENT_LAYER_MCP: Readonly<Record<string, readonly McpItem[]>> = {
  "eval-analyst": [
    {
      name: "notes-search",
      detail: "Searches your notes folder",
      layer: "This agent",
      on: true,
      status: "connected",
    },
  ],
};

// ---- agent grant ----

/** 효과. 기본값은 이 효과로 정해진다. */
export type Effect = "read" | "write" | "external" | "call" | "settings";

export type Ask = "free" | "ask";

export const EFFECT_LABEL: Record<Effect, string> = {
  read: "Read",
  write: "Write",
  external: "External",
  call: "Call agent",
  settings: "Settings",
};

/** 효과별 기본값. read·write·다른 agent 부르기는 묻지 않고 external·설정 고치기는 묻는다. */
export const DEFAULT_ASK: Record<Effect, Ask> = {
  read: "free",
  write: "free",
  external: "ask",
  call: "free",
  settings: "ask",
};

export const ASK_LABEL: Record<Ask, string> = {
  free: "Don't ask",
  ask: "Ask first",
};

export const DEFAULTS_TABLE: readonly {
  readonly effect: Effect;
  readonly meaning: string;
}[] = [
  { effect: "read", meaning: "Changes nothing" },
  {
    effect: "write",
    meaning: "Changes only the app's own data. lophn can undo it",
  },
  {
    effect: "external",
    meaning:
      "Changes something outside the app: mail, payments, other services",
  },
  { effect: "call", meaning: "Hands a task to another agent" },
  {
    effect: "settings",
    meaning: "Edits LOPHN.md, agent definitions, skills or Settings",
  },
];

/** 대상 하나(app-api, MCP tool, agent, 설정 고치기). */
export interface GrantTarget {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly effect: Effect;
  /** 사람이 이 agent에서 뺐나. */
  readonly removed?: boolean;
  /** 사람이 바꾼 값. 없으면 효과별 기본값이다. */
  readonly ask?: Ask;
  /** 새 release가 더한 app-api. 사람이 바꾸지 않았으면 기본값으로 들어온 것이다. */
  readonly addedIn?: string;
}

export interface AppGrant {
  readonly app: string;
  readonly release: string;
  readonly apis: readonly GrantTarget[];
}

export const APPS: readonly AppGrant[] = [
  {
    app: "Budget tracker",
    release: "1.4",
    apis: [
      {
        id: "list_expenses",
        name: "list_expenses",
        detail: "Lists the expenses of a month",
        effect: "read",
      },
      {
        id: "get_budget",
        name: "get_budget",
        detail: "Reads the budget and what is left",
        effect: "read",
      },
      {
        id: "summarize_month",
        name: "summarize_month",
        detail: "Totals a month by category",
        effect: "read",
      },
      {
        id: "add_expense",
        name: "add_expense",
        detail: "Adds one expense",
        effect: "write",
      },
      {
        id: "set_alert_threshold",
        name: "set_alert_threshold",
        detail: "Sets when the app warns about spending",
        effect: "write",
        ask: "ask",
      },
      {
        id: "delete_expense",
        name: "delete_expense",
        detail: "Deletes one expense",
        effect: "write",
        removed: true,
      },
      {
        id: "export_to_sheet",
        name: "export_to_sheet",
        detail: "Sends a month to a spreadsheet",
        effect: "external",
      },
      {
        id: "send_report_mail",
        name: "send_report_mail",
        detail: "Mails the monthly report",
        effect: "external",
        addedIn: "1.4",
      },
      {
        id: "tag_expense",
        name: "tag_expense",
        detail: "Puts a tag on an expense",
        effect: "write",
        addedIn: "1.4",
      },
    ],
  },
  {
    app: "Eval board",
    release: "0.9",
    apis: [
      {
        id: "list_runs",
        name: "list_runs",
        detail: "Lists eval runs",
        effect: "read",
      },
      {
        id: "get_run",
        name: "get_run",
        detail: "Reads one run with its scores",
        effect: "read",
      },
      {
        id: "pin_run",
        name: "pin_run",
        detail: "Pins a run to the board",
        effect: "write",
      },
      {
        id: "post_to_chat",
        name: "post_to_chat",
        detail: "Posts a run summary to the team chat",
        effect: "external",
      },
    ],
  },
  {
    app: "Notes sync",
    release: "2.1",
    apis: [
      {
        id: "list_notes",
        name: "list_notes",
        detail: "Lists notes",
        effect: "read",
      },
      {
        id: "push_note",
        name: "push_note",
        detail: "Sends a note to the cloud",
        effect: "external",
      },
    ],
  },
];

export interface McpToolGrants {
  readonly server: string;
  readonly tools: readonly GrantTarget[];
}

export const MCP_TOOL_GRANTS: readonly McpToolGrants[] = [
  {
    server: "github",
    tools: [
      {
        id: "search_issues",
        name: "search_issues",
        detail: "Searches issues and pull requests",
        effect: "read",
      },
      {
        id: "get_pull_request",
        name: "get_pull_request",
        detail: "Reads one pull request",
        effect: "read",
      },
      {
        id: "create_issue",
        name: "create_issue",
        detail: "Opens an issue",
        effect: "external",
      },
      {
        id: "comment_on_issue",
        name: "comment_on_issue",
        detail: "Writes a comment on an issue",
        effect: "external",
        ask: "free",
      },
    ],
  },
];

export const CALLABLE_AGENTS: readonly GrantTarget[] = [
  {
    id: "project-manager",
    name: "Project Manager",
    detail: "phroner · Keeps contexts and searches in shape",
    effect: "call",
  },
  {
    id: "app-engineer",
    name: "App Engineer",
    detail: "Budget tracker · Builds and repairs the app",
    effect: "call",
  },
  {
    id: "experiment-planner",
    name: "Experiment planner",
    detail: "phroner · Operator",
    effect: "call",
  },
];

export const SETTINGS_GRANT: GrantTarget = {
  id: "settings",
  name: "Change settings and instructions",
  detail: "LOPHN.md, agent definitions, skills and Settings",
  effect: "settings",
};

/** agent마다 처음에 붙어 있는 것. 이름을 적은 것만 붙어 있다. */
export interface AgentGrants {
  readonly apps: readonly string[];
  readonly tools: readonly string[];
  readonly agents: readonly string[];
  readonly settings: boolean;
}

export const GRANTS: Readonly<Record<string, AgentGrants>> = {
  "eval-analyst": {
    apps: ["Budget tracker", "Eval board"],
    tools: ["github"],
    agents: ["project-manager", "experiment-planner"],
    settings: false,
  },
  "experiment-planner": {
    apps: ["Eval board"],
    tools: [],
    agents: [],
    settings: false,
  },
  lophn: {
    apps: ["Budget tracker", "Eval board"],
    tools: [],
    agents: ["project-manager", "app-engineer"],
    settings: true,
  },
  "project-manager": {
    apps: [],
    tools: [],
    agents: ["app-engineer"],
    settings: true,
  },
  "app-engineer": {
    apps: ["Budget tracker"],
    tools: ["github"],
    agents: ["project-manager"],
    settings: false,
  },
};
