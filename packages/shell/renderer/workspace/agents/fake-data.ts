// fake source와 gallery가 같이 쓰는 값. tools/wireframes의 phroner 예시(Project Manager, Operator 둘, 앱 Budget tracker의
// App Engineer, lophn)와 층마다 정한 model·skill·MCP, agent grant 대상을 contract 모양으로 담는다.
import type {
  CatalogEntry,
  ModelChoice,
  OptionAxis,
} from "../../../../protocol/lophn-agent/models.ts";
import type { AgentGrantEntry } from "../../../../protocol/approvals/grants.ts";
import type { DomainView } from "../source.ts";
import type {
  AgentDraft,
  GrantApp,
  GrantCatalog,
  GrantMcpServer,
} from "./source.ts";
import type { McpRow, SkillRow } from "./views.ts";

const id = (prefix: string, seed: string) =>
  `${prefix}_${seed.padStart(26, "0")}`;

export const ANTHROPIC = id("pvd", "an1");
export const PROJECT_ID = id("prj", "ph1");
export const PROJECT_NAME = "phroner";
export const APP_ID = id("app", "bt1");
export const APP_NAME = "Budget tracker";
const EVAL_BOARD_ID = id("app", "eb1");
const NOTES_SYNC_ID = id("app", "ns1");
// agent에게는 일할 domain의 tool이 모두, 다른 domain의 tool은 public만 보인다. domain 이름은 전체에서 하나라 project의 domain은 앱의 tool과 겹치지 않는다.
export const EVAL_ANALYST_ID = id("agt", "ea1");
export const BUDGET_REVIEWER_ID = id("agt", "br1");
const EXPERIMENT_PLANNER_ID = id("agt", "ep1");

const domain = (
  seed: string,
  name: string,
  title: string,
  purpose: string,
): DomainView => ({
  id: id("dom", seed),
  name,
  title,
  purpose,
  status: "active",
});

export const PROJECT_DOMAINS: readonly DomainView[] = [
  domain("ex1", "experiments", "Experiments", "Scenario runs and rubrics."),
  domain("fi1", "findings", "Findings", "What each experiment taught us."),
];
export const APP_DOMAINS: readonly DomainView[] = [
  domain("xp1", "expenses", "Expenses", "What was spent and where."),
  domain("bu1", "budgets", "Budgets", "What may be spent in a month."),
];
const [EXPERIMENTS, FINDINGS] = PROJECT_DOMAINS.map((one) => one.id);
const [EXPENSES, BUDGETS] = APP_DOMAINS.map((one) => one.id);

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

const EFFORT = axis("effort", "Effort", [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
], "medium");
const SPEED = axis("speed", "Speed", [
  ["standard", "Standard"],
  ["fast", "Fast"],
], "standard");

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
  readonly role: "lophn" | "project_manager" | "app_engineer" | "operator";
  readonly name: string;
  readonly place: "none" | "project" | "app";
  readonly summary: string;
  readonly definition: AgentDraft;
}

const AVATAR = `data:image/svg+xml;utf8,${
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#8a6cd6"/><circle cx="24" cy="19" r="9" fill="#fff"/><rect x="9" y="31" width="30" height="14" rx="7" fill="#fff"/></svg>',
  )
}`;
export const AVATAR_SRC = AVATAR;

export const FAKE_AGENTS: readonly FakeAgent[] = [
  {
    key: "lophn",
    role: "lophn",
    name: "lophn",
    place: "none",
    summary:
      "Talks with you about lophn itself: your projects, apps and settings.",
    definition: {
      profile: { kind: "icon", icon: "dock" },
      body: `Answer in short plain sentences.
When a question is about one project, read that project's LOPHN.md first.`,
      mcp_off: [{ server_name: "calendar" }],
    },
  },
  {
    key: "project_manager",
    role: "project_manager",
    name: "Project Manager",
    place: "project",
    summary: "Keeps this project's kinds in shape.",
    definition: {
      body: "",
      skills: ["plain-writing", "weekly-report"],
      mcp_off: [{ server_name: "fetch" }, { server_name: "github" }],
    },
  },
  {
    key: "app_engineer",
    role: "app_engineer",
    name: "App Engineer",
    place: "app",
    summary: "Builds and repairs Budget tracker from its source folder.",
    definition: {
      model: {
        provider: ANTHROPIC,
        model_name: "Opus 5.5",
        option_values: { effort: "high", speed: "standard" },
      },
      body:
        "Keep the app small. Change one tool at a time and run the app's test before you ask me to check it.",
      skills: ["plain-writing", "cite-documents"],
      mcp_off: [{ server_name: "fetch" }],
    },
  },
  {
    key: EVAL_ANALYST_ID,
    role: "operator",
    name: "Eval analyst",
    place: "project",
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
      skills: ["plain-writing", "cite-documents", "weekly-report"],
      domains: [FINDINGS],
      mcp_off: [{ server_name: "fetch" }],
      mcp_servers: [{
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
      }],
    },
  },
  {
    key: EXPERIMENT_PLANNER_ID,
    role: "operator",
    name: "Experiment planner",
    place: "project",
    summary: "Plans the next experiments from what the project documents say.",
    definition: {
      name: "Experiment planner",
      profile: { kind: "icon", icon: "compare" },
      body: `# Experiment planner
Propose at most three experiments. For each one write the question, the
change to try and how you will know it worked. Ask before you create files.`,
      skills: ["plain-writing", "cite-documents", "scenario-authoring"],
      domains: [EXPERIMENTS],
      mcp_off: [{ server_name: "fetch" }, { server_name: "github" }],
    },
  },
  {
    key: BUDGET_REVIEWER_ID,
    role: "operator",
    name: "Budget reviewer",
    place: "app",
    summary: "Reads the month's expenses and flags what looks off.",
    definition: {
      name: "Budget reviewer",
      profile: { kind: "icon", icon: "compare" },
      body: `# Budget reviewer
Read the expenses of the month and list the ones that look wrong.
Never change an expense. Ask me first.`,
      skills: ["plain-writing"],
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
    layer: "domain",
    domain: FINDINGS,
    on: true,
    builtIn: false,
  },
  {
    name: "eval-metrics",
    detail: "Explains the eval metrics and their ranges.",
    layer: "domain",
    domain: EXPERIMENTS,
    on: true,
    builtIn: false,
  },
  {
    name: "scenario-authoring",
    detail: "Drafts scenario files under eval/scenarios.",
    layer: "domain",
    domain: EXPERIMENTS,
    on: false,
    builtIn: false,
  },
];

export const APP_SKILLS: readonly SkillRow[] = [
  {
    name: "expense-categories",
    detail: "Sorts a new expense into the app's categories.",
    layer: "domain",
    domain: EXPENSES,
    on: true,
    builtIn: false,
  },
  {
    name: "budget-limits",
    detail: "Explains how the monthly limits are set.",
    layer: "domain",
    domain: BUDGETS,
    on: true,
    builtIn: false,
  },
];

/** Project Manager가 가진 내장 skill. 끌 수 없다. */
export const BUILT_IN_SKILLS: readonly SkillRow[] = [
  {
    name: "kinds-yaml",
    detail: "Write or update the project's kinds.yaml from its documents.",
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
    on: false,
    status: "needs-sign-in",
  },
];

// ---- agent grant ----

function tool(
  domain: string,
  name: string,
  detail: string,
  effect: "read" | "write" | "external",
  addedIn: string | null = null,
  isPublic = false,
) {
  return { tool: name, detail, effect, addedIn, public: isPublic, domain };
}

const APPS: readonly GrantApp[] = [
  {
    app: APP_ID,
    name: APP_NAME,
    release: "1.4",
    tools: [
      tool(
        "expenses",
        "list_expenses",
        "Lists the expenses of a month",
        "read",
        null,
        true,
      ),
      tool(
        "budgets",
        "get_budget",
        "Reads the budget and what is left",
        "read",
        null,
        true,
      ),
      tool("budgets", "summarize_month", "Totals a month by category", "read"),
      tool("expenses", "add_expense", "Adds one expense", "write"),
      tool(
        "budgets",
        "set_alert_threshold",
        "Sets when the app warns about spending",
        "write",
      ),
      tool("expenses", "delete_expense", "Deletes one expense", "write"),
      tool(
        "expenses",
        "export_to_sheet",
        "Sends a month to a spreadsheet",
        "external",
      ),
      tool(
        "budgets",
        "send_report_mail",
        "Mails the monthly report",
        "external",
        "1.4",
      ),
      tool(
        "expenses",
        "tag_expense",
        "Puts a tag on an expense",
        "write",
        "1.4",
      ),
    ],
  },
  {
    app: EVAL_BOARD_ID,
    name: "Eval board",
    release: "0.9",
    tools: [
      tool("runs", "list_runs", "Lists eval runs", "read", null, true),
      tool(
        "runs",
        "get_run",
        "Reads one run with its scores",
        "read",
        null,
        true,
      ),
      tool("runs", "pin_run", "Pins a run to the board", "write"),
      tool(
        "runs",
        "post_to_chat",
        "Posts a run summary to the team chat",
        "external",
      ),
    ],
  },
  {
    app: NOTES_SYNC_ID,
    name: "Notes sync",
    release: "2.1",
    tools: [
      tool("notes", "list_notes", "Lists notes", "read", null, true),
      tool("notes", "push_note", "Sends a note to the cloud", "external"),
    ],
  },
];

const MCP_TOOLS: readonly GrantMcpServer[] = [{
  server: "github",
  tools: [
    {
      tool: "search_issues",
      detail: "Searches issues and pull requests",
      effect: "read",
    },
    {
      tool: "get_pull_request",
      detail: "Reads one pull request",
      effect: "read",
    },
    { tool: "create_issue", detail: "Opens an issue", effect: "external" },
    {
      tool: "comment_on_issue",
      detail: "Writes a comment on an issue",
      effect: "external",
    },
  ],
}];

export const GRANT_CATALOG: GrantCatalog = {
  apps: APPS,
  mcpServers: MCP_TOOLS,
  agents: [
    {
      agent: { role: "project_manager", project: PROJECT_ID },
      name: "Project Manager",
      detail: `${PROJECT_NAME} · Keeps kinds in shape`,
    },
    {
      agent: { role: "app_engineer", app: APP_ID },
      name: "App Engineer",
      detail: `${APP_NAME} · Builds and repairs the app`,
    },
    {
      agent: { role: "operator", agent: EXPERIMENT_PLANNER_ID },
      name: "Experiment planner",
      detail: `${PROJECT_NAME} · Operator`,
    },
    {
      agent: { role: "operator", agent: EVAL_ANALYST_ID },
      name: "Eval analyst",
      detail: `${PROJECT_NAME} · Operator`,
    },
  ],
};

const PM_REF = GRANT_CATALOG.agents[0].agent;
const ENGINEER_REF = GRANT_CATALOG.agents[1].agent;
const PLANNER_REF = GRANT_CATALOG.agents[2].agent;

const allTools = () =>
  MCP_TOOLS[0].tools.map((tool): AgentGrantEntry => ({
    kind: "mcp_tool",
    server: "github",
    tool: tool.tool,
    ...(tool.tool === "comment_on_issue" ? { setting: "never" as const } : {}),
  }));

/** agent마다 처음에 붙어 있는 것. */
export const FAKE_GRANTS: Readonly<Record<string, readonly AgentGrantEntry[]>> =
  {
    [EVAL_ANALYST_ID]: [
      {
        kind: "app",
        app: APP_ID,
        tools: [
          { tool: "set_alert_threshold", setting: "ask" },
          { tool: "delete_expense", setting: "excluded" },
        ],
      },
      { kind: "app", app: EVAL_BOARD_ID, tools: [] },
      ...allTools(),
      { kind: "agent", agent: PM_REF },
      { kind: "agent", agent: PLANNER_REF },
    ],
    [EXPERIMENT_PLANNER_ID]: [{ kind: "app", app: EVAL_BOARD_ID, tools: [] }],
    lophn: [
      { kind: "app", app: APP_ID, tools: [] },
      { kind: "app", app: EVAL_BOARD_ID, tools: [] },
      { kind: "agent", agent: PM_REF },
      { kind: "agent", agent: ENGINEER_REF },
      { kind: "settings" },
    ],
    project_manager: [
      { kind: "app", app: APP_ID, tools: [] },
      ...allTools(),
      { kind: "settings" },
    ],
    app_engineer: [
      { kind: "app", app: APP_ID, tools: [] },
      ...allTools(),
      { kind: "agent", agent: PM_REF },
    ],
  };
