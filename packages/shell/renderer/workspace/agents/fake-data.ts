// fake source와 gallery가 같이 쓰는 값. tools/wireframes의 phroner 예시(lophn과 사람이 만든 agent 셋)와 층마다 정한
// model·skill·MCP, 붙일 앱과 할당을 contract 모양으로 담는다.

import type { HarnessCatalogView } from "../../../../protocol/acp/harness-catalog.ts";
import type { AcpModelAxis } from "../../../../protocol/acp/session.ts";
import type { AssignmentEntry } from "../../../../protocol/approvals/assignment.ts";
import type { GuiHarness } from "../../../../protocol/coding-agent/gui-harness.ts";
import type {
  CatalogEntry,
  ModelChoice,
  OptionAxis,
} from "../../../../protocol/lophn-agent/models.ts";
import type { ToolEffect } from "../../../../protocol/lophn-agent/tool-values.ts";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { BrowserProfile } from "../../../../protocol/secrets/browser-vault.ts";
import type { AgentDraft, CodingChoices, GrantApp } from "./source.ts";
import type { DeployableSkill, McpRow, SkillRow } from "./views.ts";

const id = (prefix: string, seed: string) =>
  `${prefix}_${seed.padStart(26, "0")}`;

export const ANTHROPIC = id("pvd", "an1");
export const PROJECT_ID = id("prj", "ph1");
export const PROJECT_NAME = "phroner";
/** 이 project의 lophn. 다른 workspace의 lophn은 fake source가 이 정의를 본떠 만든다. */
export const PROJECT_LOPHN_ID = lophnIdOf({ kind: "project", id: PROJECT_ID });
/** Home의 lophn. */
export const HOME_LOPHN_ID = lophnIdOf(null);
export const APP_ID = id("app", "bt1");
export const APP_NAME = "Budget tracker";
// agent에게는 일하는 자리가 그 앱일 때 tool이 모두, 다른 앱의 tool은 public만 보인다.
export const EVAL_ANALYST_ID = id("agt", "ea1");
export const BUDGET_REVIEWER_ID = id("agt", "br1");
export const EXPERIMENT_PLANNER_ID = id("agt", "ep1");
export const QUEUE_WATCHER_ID = id("agt", "qw1");
export const CODEX_RUNNER_ID = id("agt", "cx1");
/** 화면 확인용 browser profile 둘. Settings의 fake와 agent 편집기의 fake가 같은 id를 쓴다. */
export const PROFILE_WORK = id("bpf", "wk1");
export const PROFILE_SHOP = id("bpf", "sh1");
export const SAMPLE_BROWSER_PROFILES: readonly BrowserProfile[] = [
  { id: PROFILE_WORK, name: "Work", color: "blue" },
  { id: PROFILE_SHOP, name: "Shopping", color: "coral" },
];

/** 정의 file이 틀린 agent. 목록에 개수와 명함이 없다. fake source의 brokenAgent 설정이 켠다. */
export const BROKEN_AGENT_ID = id("agt", "bk1");

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

/** 앱 source 폴더의 AGENTS.md. */
export const APP_AGENTS_MD = [
  "# Budget tracker",
  "Expenses are stored per month. Amounts are in whole cents.",
  "Run the tests before you change the budget limits.",
].join("\n");

/** Home의 LOPHN.md. */
export const HOME_LOPHN_MD = [
  "# Home",
  "Apps live in the app list. Ask which project an idea belongs to before you start a new app.",
].join("\n");

/** workspace memory와 agent memory의 처음 글. */
export const PROJECT_MEMORY = [
  "- Weekly report goes out on Friday. (you told me on Oct 18)",
  "- Ask Eval analyst about run scores before you read the raw files.",
].join("\n");
export const HOME_MEMORY = [
  "- You keep receipts in the Budget tracker app, not in a project.",
  "- Ask Budget reviewer when an expense looks odd.",
].join("\n");
export const APP_MEMORY = "- Month closes on the 25th. (you told me on Nov 2)";
export const AGENT_MEMORY =
  "- Keep summaries under five lines. (you told me on Oct 30)";

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
    protocol: null,
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

// ---- harness catalog & coding agent choices ----

const ACP_EFFORT: AcpModelAxis = {
  id: "effort",
  label: "Effort",
  kind: "choice",
  values: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "max", label: "Max" },
  ],
};

const ACP_CODEX_EFFORT: AcpModelAxis = {
  id: "effort",
  label: "Effort",
  kind: "choice",
  values: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "XHigh" },
  ],
};

const ACP_FAST_SWITCH: AcpModelAxis = {
  id: "fast",
  label: "Speed",
  kind: "switch",
  values: [
    { value: "off", label: "Off" },
    { value: "on", label: "Fast" },
  ],
};

const HARNESS_FETCHED_AT = "2026-11-23T05:00:00.000Z";

export const FAKE_CODING_CHOICES: CodingChoices = {
  favorites: ["claude", "codex", "opencode"],
  detected: ["claude", "codex", "opencode", "omp", "antigravity"],
};

export const FAKE_HARNESS_CATALOGS: Readonly<
  Record<GuiHarness, HarnessCatalogView>
> = {
  claude: {
    harness: "claude",
    status: "ready",
    catalog: {
      models: [
        {
          id: "anthropic",
          label: "Anthropic",
          models: [
            {
              id: "claude-opus-4-7",
              label: "Opus 4.7",
              axes: [ACP_EFFORT, ACP_FAST_SWITCH],
            },
            {
              id: "claude-sonnet-4-6",
              label: "Sonnet 4.6",
              axes: [ACP_EFFORT],
            },
            { id: "claude-haiku-4-5", label: "Haiku 4.5", axes: [] },
          ],
        },
      ],
      defaults: { model: "claude-sonnet-4-6", options: { effort: "medium" } },
    },
    fetched_at: HARNESS_FETCHED_AT,
    stale: false,
    error: null,
  },
  codex: {
    harness: "codex",
    status: "ready",
    catalog: {
      models: [
        {
          id: "openai",
          label: "OpenAI",
          models: [
            {
              id: "gpt-5.3-codex",
              label: "GPT-5.3 Codex",
              axes: [ACP_CODEX_EFFORT],
            },
            {
              id: "gpt-5.2-codex",
              label: "GPT-5.2 Codex",
              axes: [ACP_CODEX_EFFORT],
            },
          ],
        },
      ],
      defaults: { model: "gpt-5.3-codex", options: { effort: "medium" } },
    },
    fetched_at: HARNESS_FETCHED_AT,
    stale: false,
    error: null,
  },
  opencode: {
    harness: "opencode",
    status: "ready",
    catalog: {
      models: [
        {
          id: "anthropic",
          label: "Anthropic",
          models: [
            {
              id: "anthropic/claude-sonnet-4-6",
              label: "Claude Sonnet 4.6",
              axes: [ACP_EFFORT],
            },
          ],
        },
        {
          id: "openai",
          label: "OpenAI",
          models: [
            {
              id: "openai/gpt-5.3-codex",
              label: "GPT-5.3 Codex",
              axes: [ACP_CODEX_EFFORT],
            },
          ],
        },
      ],
      defaults: { model: "anthropic/claude-sonnet-4-6", options: {} },
    },
    fetched_at: HARNESS_FETCHED_AT,
    stale: false,
    error: null,
  },
  omp: {
    harness: "omp",
    status: "ready",
    catalog: {
      models: [
        {
          id: "anthropic",
          label: "Anthropic",
          models: [
            {
              id: "anthropic/claude-opus-4-7",
              label: "Claude Opus 4.7",
              axes: [ACP_EFFORT],
            },
            {
              id: "anthropic/claude-sonnet-4-6",
              label: "Claude Sonnet 4.6",
              axes: [ACP_EFFORT],
            },
          ],
        },
      ],
      defaults: { model: "anthropic/claude-sonnet-4-6", options: {} },
    },
    fetched_at: HARNESS_FETCHED_AT,
    stale: false,
    error: null,
  },
  antigravity: {
    harness: "antigravity",
    status: "ready",
    catalog: {
      models: [
        {
          id: "google",
          label: "Google",
          models: [
            {
              id: "gemini-3.8-pro",
              label: "Gemini 3.8 Pro",
              axes: [ACP_EFFORT],
            },
            {
              id: "gemini-3.8-flash",
              label: "Gemini 3.8 Flash",
              axes: [ACP_EFFORT],
            },
          ],
        },
      ],
      defaults: { model: "gemini-3.8-pro", options: { effort: "medium" } },
    },
    fetched_at: HARNESS_FETCHED_AT,
    stale: false,
    error: null,
  },
};

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
      avatar: { kind: "character", shape: "square", color: "coral" },
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
      handle: "eval-analyst",
      name: "Eval analyst",
      description: "Explains what changed in the eval loop and why it matters.",
      avatar: { kind: "image", image: "avatar.png" },
      browser_profile: PROFILE_WORK,
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
      deployed_skills: [{ app: "eval-board", skill: "read-eval-runs" }],
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
      handle: "experiment-planner",
      name: "Experiment planner",
      description: "Plans the next experiments from the project documents.",
      workspace: { kind: "project", id: PROJECT_ID },
      avatar: { kind: "character", shape: "round", color: "blue" },
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
      handle: "budget-reviewer",
      name: "Budget reviewer",
      description: "Reads the month's expenses and flags what looks off.",
      workspace: { kind: "app", id: APP_ID },
      avatar: { kind: "character", shape: "round", color: "blue" },
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
      handle: "queue-watcher",
      name: "Queue watcher",
      runtime: "custom",
      description: "Reads the run queue and answers with what is stuck.",
      tools: ["file.read", "file.grep"],
      avatar: { kind: "character", shape: "capsule", color: "teal" },
      body: `Read the queue file the caller names and list the runs that
have not moved. Answer in one short list.`,
    },
  },
  {
    key: CODEX_RUNNER_ID,
    name: "Codex runner",
    summary: "Runs coding tasks in Codex.",
    definition: {
      handle: "codex-runner",
      name: "Codex runner",
      runtime: "codex",
      harness_config: {
        model: "gpt-5.3-codex",
        options: { effort: "high" },
      },
      description: "Runs coding tasks in Codex.",
      avatar: { kind: "character", shape: "square", color: "teal" },
      body: "Do the coding task the caller names and answer with a short summary.",
    },
  },
  {
    key: "coding_claude",
    name: "Claude Code",
    summary: "Runs Claude Code.",
    definition: {
      name: "Claude Code",
      handle: "claude",
      runtime: "claude-code",
      description: "Runs Claude Code.",
      avatar: { kind: "character", shape: "square", color: "sage" },
      body: "",
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

export const HOME_SKILLS: readonly SkillRow[] = [
  {
    name: "inbox-triage",
    detail: "Sorts what came in today into projects and apps.",
    layer: "workspace-data",
    on: true,
    builtIn: false,
  },
];

export const HOME_MCP: readonly McpRow[] = [
  {
    name: "notes-index",
    detail: "Searches the notes you keep outside projects",
    layer: "workspace",
    on: true,
    status: "connected",
  },
];

export const APP_MCP: readonly McpRow[] = [
  {
    name: "bank-feed",
    detail: "Reads new transactions of your bank accounts",
    layer: "workspace",
    on: true,
    status: "connected",
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

/** workspace 종류마다 보이는 내장 skill. 끌 수 없다. */
const builtIn = (name: string, detail: string): SkillRow => ({
  name,
  detail,
  layer: "builtin",
  on: true,
  builtIn: true,
});
export const BUILT_IN_SKILLS = {
  home: [
    builtIn("new-app", "Start a new app from an idea."),
    builtIn(
      "update",
      "Review platform, SDK, and workflow updates across your workspace.",
    ),
  ],
  project: [
    builtIn("write-workflow", "Write or update a workflow of the project."),
  ],
  app: [builtIn("design-app", "Design the screens of the app.")],
} as const;

export const GLOBAL_MCP: readonly McpRow[] = [
  {
    name: "fetch",
    detail: "Reads a web page as Markdown",
    layer: "global",
    on: true,
    status: "connected",
    secrets: [{ name: "mcp.global.fetch", label: "value", set: true }],
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
    layer: "workspace",
    on: true,
    status: "connected",
  },
  {
    name: "linear",
    detail: "Planning board",
    layer: "workspace",
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

/** 배포할 수 있는 앱 skill. 앱마다 active release의 public skill이다. */
export const DEPLOYABLE: readonly DeployableSkill[] = [
  {
    app: "budget-tracker",
    appName: APP_NAME,
    skill: "track-expenses",
    description: "How to add, tag and total expenses with the budget app.",
  },
  {
    app: "budget-tracker",
    appName: APP_NAME,
    skill: "monthly-report",
    description: "How to build and send the monthly spending report.",
  },
  {
    app: "eval-board",
    appName: "Eval board",
    skill: "read-eval-runs",
    description: "How to list eval runs and read their scores.",
  },
];

/** gallery의 기계 목록(`sampleMachines`)에 있는 다른 컴퓨터. */
export const HOME_SERVER = "mch_homeserver";
export const WORK_LAPTOP = "mch_laptop";
const WEEKLY_REPORT_ID = id("app", "wr1");
const SKETCH_SYNC_ID = id("app", "sk1");
const RECIPES_ID = id("app", "rc1");

/** 연결된 다른 컴퓨터가 앱 목록과 선언으로 답하는 앱. public이 아닌 command는 붙일 수 없어 화면이 뺀다. */
export const COMPUTER_APPS: Readonly<Record<string, readonly GrantApp[]>> = {
  [HOME_SERVER]: [
    {
      app: WEEKLY_REPORT_ID,
      name: "Weekly report",
      tools: [
        tool("list_reports", "Lists the weekly reports", "read", true),
        tool("build_report", "Builds this week's report", "write", true),
        tool(
          "send_report_mail",
          "Mails the report to the team",
          "external",
          true,
        ),
        tool("reset_templates", "Resets the report templates", "write"),
      ],
    },
    {
      app: RECIPES_ID,
      name: "Recipes",
      tools: [
        tool("search_recipes", "Searches the recipe book", "read", true),
        tool("add_recipe", "Adds a recipe", "write", true),
      ],
    },
  ],
};

/** agent마다 처음에 붙어 있는 다른 컴퓨터의 앱. */
export const FAKE_GRANTS: Readonly<Record<string, readonly AssignmentEntry[]>> =
  {
    // 다른 컴퓨터의 앱 줄: Home server는 연결되어 있고 Work laptop은 꺼져 있어 저장된 이름으로 보인다.
    [EXPERIMENT_PLANNER_ID]: [
      {
        app: WEEKLY_REPORT_ID,
        machine: HOME_SERVER,
        name: "Weekly report",
        removed_tools: ["send_report_mail"],
      },
      {
        app: SKETCH_SYNC_ID,
        machine: WORK_LAPTOP,
        name: "Sketch sync",
        removed_tools: [],
      },
    ],
  };
