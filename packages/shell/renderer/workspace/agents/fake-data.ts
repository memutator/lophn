// fake source와 gallery가 같이 쓰는 값. tools/wireframes의 phroner 예시(lophn과 사람이 만든 agent 셋)와 층마다 정한
// model·skill·MCP, 붙일 앱과 할당을 contract 모양으로 담는다.

import type { AssignmentEntry } from "../../../../protocol/approvals/assignment.ts";
import type {
  CatalogEntry,
  ModelChoice,
  OptionAxis,
} from "../../../../protocol/lophn-agent/models.ts";
import type { ToolEffect } from "../../../../protocol/lophn-agent/tool-values.ts";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { AgentDraft, GrantApp, GrantCatalog } from "./source.ts";
import type { McpRow, SkillRow } from "./views.ts";

const id = (prefix: string, seed: string) =>
  `${prefix}_${seed.padStart(26, "0")}`;

export const ANTHROPIC = id("pvd", "an1");
export const PROJECT_ID = id("prj", "ph1");
export const PROJECT_NAME = "phroner";
/** 이 project의 lophn. 다른 workspace의 lophn은 fake source가 이 정의를 본떠 만든다. */
export const PROJECT_LOPHN_ID = lophnIdOf({ kind: "project", id: PROJECT_ID });
export const APP_ID = id("app", "bt1");
export const APP_NAME = "Budget tracker";
const EVAL_BOARD_ID = id("app", "eb1");
const NOTES_SYNC_ID = id("app", "ns1");
// agent에게는 일하는 자리가 그 앱일 때 tool이 모두, 다른 앱의 tool은 public만 보인다.
export const EVAL_ANALYST_ID = id("agt", "ea1");
export const BUDGET_REVIEWER_ID = id("agt", "br1");
const EXPERIMENT_PLANNER_ID = id("agt", "ep1");
const QUEUE_WATCHER_ID = id("agt", "qw1");
const CODEX_RUNNER_ID = id("agt", "cx1");

/** 전역 model 하나. */
export const GLOBAL_MODEL: ModelChoice = {
  provider: ANTHROPIC,
  model_name: "Sonnet 5.5",
  option_values: { effort: "medium" },
};

export const LOPHN_MD = [
  "# phroner",
  "Eval loop for the harness. Findings go in loop/findings.",
  "Reports go in docs/reports. Keep summaries short.",
  "Ask before you rewrite a report that is already published.",
].join("\n");

export const GLOBAL_LOPHN_MD = [
  "# About me",
  "I run the eval loop on my own. Answer in short plain sentences.",
  "Ask before you change a document I did not mention.",
].join("\n");

// ---- model catalog ----

function axis(
  id: string,
  label: string,
  values: readonly (readonly [string, string])[],
  defaultValue: string,
): OptionAxis {
  return {
    id,
    label,
    values: values.map(([value, name]) => ({ value, label: name, wire: null })),
    default_value: defaultValue,
    budget: null,
  };
}

const EFFORT = axis(
  "effort",
  "Effort",
  [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
  ],
  "medium",
);
const SPEED = axis(
  "speed",
  "Speed",
  [
    ["standard", "Standard"],
    ["fast", "Fast"],
  ],
  "standard",
);

function entry(
  name: string,
  options: readonly OptionAxis[],
  contextLimit: number,
  inputMedia: CatalogEntry["input_media"],
): CatalogEntry {
  return {
    provider_definition: "anthropic",
    model_name: name,
    context_limit: contextLimit,
    input_limit: null,
    output_limit: null,
    supports_tools: null,
    input_media: inputMedia,
    output_media: ["text"],
    options: [...options],
    preview: null,
    deprecated: null,
    source: "release_snapshot",
    source_revision: "fake",
    checked_at: null,
    received_at: null,
    price_basis: null,
  };
}

export const CATALOG: readonly CatalogEntry[] = [
  entry("Sonnet 5.5", [EFFORT], 1_000_000, ["text", "image", "pdf"]),
  entry("Opus 5.5", [EFFORT, SPEED], 1_000_000, ["text", "image", "pdf"]),
  entry("Haiku 5.5", [], 200_000, ["text", "image"]),
];

// ---- 정의 ----

export interface FakeAgent {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  readonly definition: AgentDraft;
}

const AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#8a6cd6"/><circle cx="24" cy="19" r="9" fill="#fff"/><rect x="9" y="31" width="30" height="14" rx="7" fill="#fff"/></svg>',
)}`;
export const AVATAR_SRC = AVATAR;

export const FAKE_AGENTS: readonly FakeAgent[] = [
  {
    key: PROJECT_LOPHN_ID,
    name: "lophn",
    summary:
      "Talks with you about lophn itself: your projects, apps and settings.",
    definition: {
      name: "lophn",
      profile: { kind: "character", shape: "square", color: "coral" },
      body: `Answer in short plain sentences.
When a question is about one project, read that project's LOPHN.md first.`,
      mcp_off: [{ server_name: "calendar" }],
    },
  },
  {
    key: EVAL_ANALYST_ID,
    name: "Eval analyst",
    summary: "Explains what changed in the eval loop and why it matters.",
    definition: {
      name: "Eval analyst",
      profile: { kind: "image", image: "avatar.png" },
      model: {
        provider: ANTHROPIC,
        model_name: "Sonnet 5.5",
        option_values: { effort: "high" },
      },
      body: `# Eval analyst
Explain what changed in the eval loop and why it matters.

1. Read the findings and experiments the person points at.
2. Say which results improved and which regressed.
3. Link every claim to the document it came from.
Keep answers short. Name the scenario for every regression.`,
      skills_off: ["cite-documents"],
      mcp_off: [{ server_name: "fetch" }],
      mcp_servers: [
        {
          name: "notes-search",
          enabled: true,
          call_timeout_ms: 60_000,
          transport: "stdio",
          stdio: {
            executable: "/usr/local/bin/notes-mcp",
            args: [],
            cwd: null,
            env: {},
          },
        },
        {
          name: "linear",
          enabled: true,
          call_timeout_ms: 60_000,
          transport: "http",
          http: {
            url: "https://mcp.linear.app/mcp",
            headers: {},
            auth: {
              kind: "oauth2",
              issuer: "https://mcp.linear.app",
              client_id: "linear-client",
              client_credential: null,
              scopes: ["read"],
            },
          },
        },
      ],
    },
  },
  {
    key: EXPERIMENT_PLANNER_ID,
    name: "Experiment planner",
    summary: "Plans the next experiments from what the project documents say.",
    definition: {
      name: "Experiment planner",
      workspace: { kind: "project", id: PROJECT_ID },
      profile: { kind: "character", shape: "round", color: "blue" },
      body: `# Experiment planner
Propose at most three experiments. For each one write the question, the
change to try and how you will know it worked. Ask before you create files.`,
      skills_off: ["eval-metrics"],
      mcp_off: [{ server_name: "fetch" }, { server_name: "github" }],
    },
  },
  {
    key: BUDGET_REVIEWER_ID,
    name: "Budget reviewer",
    summary: "Reads the month's expenses and flags what looks off.",
    definition: {
      name: "Budget reviewer",
      workspace: { kind: "app", id: APP_ID },
      profile: { kind: "character", shape: "round", color: "blue" },
      body: `# Budget reviewer
Read the expenses of the month and list the ones that look wrong.
Never change an expense. Ask me first.`,
      skills_off: ["cite-documents"],
    },
  },
  {
    key: QUEUE_WATCHER_ID,
    name: "Queue watcher",
    summary: "Reads the run queue and answers with what is stuck.",
    definition: {
      name: "Queue watcher",
      runtime: "bare",
      description: "Reads the run queue and answers with what is stuck.",
      tools: ["file.read", "file.grep", "call.reply"],
      profile: { kind: "character", shape: "capsule", color: "teal" },
      body: `Read the queue file the caller names and list the runs that
have not moved. Answer in one short list.`,
    },
  },
  {
    key: CODEX_RUNNER_ID,
    name: "Codex runner",
    summary: "Runs coding tasks in Codex.",
    definition: {
      name: "Codex runner",
      runtime: "codex",
      description: "Runs coding tasks in Codex.",
      profile: { kind: "character", shape: "square", color: "teal" },
      body: "Do the coding task the caller names and answer with a short summary.",
    },
  },
];

// ---- skill와 MCP ----

export const GLOBAL_SKILLS: readonly SkillRow[] = [
  {
    name: "plain-writing",
    detail: "Keeps summaries short and in plain words.",
    layer: "global",
    on: true,
    builtIn: false,
  },
  {
    name: "cite-documents",
    detail: "Links every claim to the document it came from.",
    layer: "global",
    on: true,
    builtIn: false,
  },
];

export const PROJECT_SKILLS: readonly SkillRow[] = [
  {
    name: "weekly-report",
    detail: "Writes the weekly eval report from new findings.",
    layer: "workspace-data",
    on: true,
    builtIn: false,
  },
  {
    name: "eval-metrics",
    detail: "Explains the eval metrics and their ranges.",
    layer: "workspace-data",
    on: true,
    builtIn: false,
  },
  {
    name: "scenario-authoring",
    detail: "Drafts scenario files under eval/scenarios.",
    layer: "workspace-data",
    on: false,
    builtIn: false,
  },
];

export const APP_SKILLS: readonly SkillRow[] = [
  {
    name: "expense-categories",
    detail: "Sorts a new expense into the app's categories.",
    layer: "workspace-data",
    on: true,
    builtIn: false,
  },
  {
    name: "budget-limits",
    detail: "Explains how the monthly limits are set.",
    layer: "workspace-data",
    on: true,
    builtIn: false,
  },
];

/** project 자리에서 보이는 내장 skill. 끌 수 없다. */
export const BUILT_IN_SKILLS: readonly SkillRow[] = [
  {
    name: "write-workflow",
    detail: "Write or update a workflow of the project.",
    layer: "builtin",
    on: true,
    builtIn: true,
  },
];

export const GLOBAL_MCP: readonly McpRow[] = [
  {
    name: "fetch",
    detail: "Reads a web page as Markdown",
    layer: "global",
    on: true,
    status: "connected",
  },
  {
    name: "calendar",
    detail: "Reads your calendar",
    layer: "global",
    on: false,
    status: null,
  },
  {
    name: "notion",
    detail: "Searches your pages",
    layer: "global",
    on: true,
    status: "needs-sign-in",
    login: {
      workspace: null,
      agent: null,
      client_id: "notion-client",
      scopes: ["read"],
      state: "none",
      reason: null,
    },
  },
];

export const PROJECT_MCP: readonly McpRow[] = [
  {
    name: "github",
    detail: "Issues and pull requests of the harness repo",
    layer: "project",
    on: true,
    status: "connected",
  },
  {
    name: "linear",
    detail: "Planning board",
    layer: "project",
    on: true,
    status: "needs-sign-in",
    login: {
      workspace: { kind: "project", id: PROJECT_ID },
      agent: null,
      client_id: "linear-client",
      scopes: ["read"],
      state: "none",
      reason: null,
    },
  },
];

// ---- 할당 ----

function tool(
  name: string,
  detail: string,
  effect: ToolEffect,
  isPublic = false,
) {
  return { tool: name, detail, effect, public: isPublic };
}

const APPS: readonly GrantApp[] = [
  {
    app: APP_ID,
    name: APP_NAME,
    tools: [
      tool("list_expenses", "Lists the expenses of a month", "read", true),
      tool("get_budget", "Reads the budget and what is left", "read", true),
      tool("summarize_month", "Totals a month by category", "read"),
      tool("add_expense", "Adds one expense", "write"),
      tool(
        "set_alert_threshold",
        "Sets when the app warns about spending",
        "write",
      ),
      tool("delete_expense", "Deletes one expense", "write"),
      tool("export_to_sheet", "Sends a month to a spreadsheet", "external"),
      tool("send_report_mail", "Mails the monthly report", "external"),
      tool("tag_expense", "Puts a tag on an expense", "write"),
    ],
  },
  {
    app: EVAL_BOARD_ID,
    name: "Eval board",
    tools: [
      tool("list_runs", "Lists eval runs", "read", true),
      tool("get_run", "Reads one run with its scores", "read", true),
      tool("pin_run", "Pins a run to the board", "write"),
      tool("post_to_chat", "Posts a run summary to the team chat", "external"),
    ],
  },
  {
    app: NOTES_SYNC_ID,
    name: "Notes sync",
    tools: [
      tool("list_notes", "Lists notes", "read", true),
      tool("push_note", "Sends a note to the cloud", "external"),
    ],
  },
];

export const GRANT_CATALOG: GrantCatalog = { apps: APPS };

/** agent마다 처음에 붙어 있는 앱. */
export const FAKE_GRANTS: Readonly<Record<string, readonly AssignmentEntry[]>> =
  {
    [EVAL_ANALYST_ID]: [
      { app: APP_ID, removed_tools: ["delete_expense"] },
      { app: EVAL_BOARD_ID, removed_tools: [] },
    ],
    [EXPERIMENT_PLANNER_ID]: [{ app: EVAL_BOARD_ID, removed_tools: [] }],
    [PROJECT_LOPHN_ID]: [
      { app: APP_ID, removed_tools: [] },
      { app: EVAL_BOARD_ID, removed_tools: [] },
    ],
  };
