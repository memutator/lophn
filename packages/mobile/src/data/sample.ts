// The sample computer: the wireframe's made-up data behind a fake core, for dev builds only. It reuses the desktop's
// gallery fakes (the fake Gateway with the Inbox items, the in-memory conversation) and runs them through the same event
// client, stores and hooks as a real computer, so screens see the same shapes; the routes the fakes do not know (workflows,
// files, jobs, agents, an app's runs) are answered below. Every time is counted back from now. What the person does
// changes memory only.
import type { AgentTabSource } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import {
  type AgentTabScene,
  createFakeAgentTabSource,
  SESSION_MAIN,
} from "../../../shell/renderer/conversation/agent-tab-fake-source.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  ACTIVATION,
  createFakeWaiting,
  HISTORY_NOTICES,
  JOB_HOLD_AGENT,
  SHELL_COMMAND,
} from "../../../shell/renderer/desktop/connection/waiting/fake-source.ts";
import type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
import type { TerminalLine } from "../../../protocol/coding-agent/terminal-view.ts";
import type { BusEvent, SessionSnapshot } from "../../../protocol/events/mod.ts";
import type { CharacterProfile } from "../../../protocol/lophn-agent/agent-values.ts";
import {
  type AgentId,
  LOPHN_HOME_ID,
  lophnIdOf,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { ProjectFileEntry } from "../../../protocol/projects/project-files.ts";
import type {
  ReportLine,
  WorkflowEntry,
  WorkflowInstance,
  WorkflowInstanceSummary,
  WorkflowLine,
} from "../../../protocol/workflows/instances.ts";
import type { JobRunView, JobView } from "../../../shell/renderer/desktop/jobs/source.ts";
import { sampleOrdersRoutes } from "../apps/sample-orders.ts";
import type { SampleComputer } from "../../../remote-client/mod.ts";
import { type ComputerData, dataOf, type SampleConversation } from "./link.ts";

export const SAMPLE_KEY = "sample";

const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5p${String(n).padStart(3, "0")}`;
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// The conversation fake's project and the Inbox fake's Orders app, so their sessions and items land in these workspaces.
const PHRONER = {
  kind: "project",
  id: "prj_01h455vb4pex5v6nkc6gd5f001",
} as const;
const ORDERS = { kind: "app", id: ACTIVATION().app } as const;
const CALENDAR = { kind: "app", id: id("app", 2) } as const;
const MEALS = { kind: "app", id: id("app", 3) } as const;
const READING = { kind: "app", id: id("app", 4) } as const;

const LOPHN_PHRONER = lophnIdOf(PHRONER);
const PLANNER = id("agt", 1);

const AGENTS: Record<string, { name: string; profile: CharacterProfile }> = {
  [LOPHN_HOME_ID]: {
    name: "lophn",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  [LOPHN_PHRONER]: {
    name: "lophn",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  [lophnIdOf(ORDERS)]: {
    name: "lophn",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  [PLANNER]: {
    name: "Experiment planner",
    profile: { kind: "character", shape: "round", color: "blue" },
  },
  coding_claude: {
    name: "Claude Code",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  coding_codex: {
    name: "Codex",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
};

interface Sample {
  readonly id: string;
  readonly agent: AgentId;
  readonly workspace: SessionSnapshot["workspace"];
  readonly title: string;
  readonly state: SessionSnapshot["state"];
  readonly minutesAgo: number;
  readonly desk: string | null;
}

// Weekly report (waiting on the cleanup command) and Harness change summary (waiting on a question) come from the Inbox fake.
const SESSIONS: readonly Sample[] = [
  {
    id: id("ses", 1),
    agent: LOPHN_HOME_ID,
    workspace: null,
    title: "Plan the week",
    state: "idle",
    minutesAgo: 25,
    desk: null,
  },
  {
    id: id("ses", 2),
    agent: "coding_claude",
    workspace: PHRONER,
    title: "Fix flaky retry in the scenario runner",
    state: "running",
    minutesAgo: 2,
    desk: "Main",
  },
  {
    id: id("ses", 3),
    agent: "coding_codex",
    workspace: PHRONER,
    title: "Split the eval board loader",
    state: "running",
    minutesAgo: 4,
    desk: "weekly-review",
  },
  {
    id: id("ses", 4),
    agent: PLANNER,
    workspace: PHRONER,
    title: "Tune the retry budget",
    state: "idle",
    minutesAgo: 3 * 24 * 60,
    desk: null,
  },
  {
    id: id("ses", 5),
    agent: LOPHN_PHRONER,
    workspace: PHRONER,
    title: "Explain the scoring change",
    state: "idle",
    minutesAgo: 6 * 24 * 60,
    desk: null,
  },
  {
    id: id("ses", 6),
    agent: lophnIdOf(ORDERS),
    workspace: ORDERS,
    title: "Add a CSV export",
    state: "idle",
    minutesAgo: 40,
    desk: null,
  },
];

const WEEKLY = {
  id: SESSION_MAIN,
  agent: LOPHN_PHRONER,
  workspace: PHRONER,
};

const TITLES: Record<string, { title: string; minutesAgo: number }> = {
  [SESSION_MAIN]: { title: "Weekly report", minutesAgo: 1 },
  // The Inbox fake's question waits in this Home session.
  ses_01h455vb4pex5v6nkc6gd5fd04: {
    title: "Harness change summary",
    minutesAgo: 0,
  },
  ...Object.fromEntries(
    SESSIONS.map((one) => [
      one.id,
      { title: one.title, minutesAgo: one.minutesAgo },
    ]),
  ),
};

const DESKS: Record<string, string> = {
  [SESSION_MAIN]: "Main",
  ...Object.fromEntries(
    SESSIONS.flatMap((one) => (one.desk === null ? [] : [[one.id, one.desk]])),
  ),
};

const COMMON = { as_of_seq: "0", next_cursor: null };

function inbox() {
  const shell = SHELL_COMMAND();
  return createFakeWaiting([
    {
      session: WEEKLY,
      request: {
        ...shell.request,
        session: WEEKLY.id,
        subject: { kind: "shell", command: "rm -r docs/reports/2026-w40" },
        always_patterns: ["rm -r *"],
      },
    },
    "question",
    ACTIVATION(),
    JOB_HOLD_AGENT(),
    ...HISTORY_NOTICES(),
  ]);
}

// ---- workflows, files, jobs, agents, an app's runs and release: what the place screens read

const DAY = 24 * 60;
const PROJECT = PHRONER.id;

const PARTICIPANTS = {
  lophn: { agent: "lophn" },
  analyst: { agent: "Eval analyst" },
  human: { kind: "human" },
} as const;

const STEPS = [
  { name: "plan", by: "lophn", with: null, prompt: "Plan the run.", in: "", out: "", next: ["execute"] },
  { name: "execute", by: "analyst", with: null, prompt: "Run the scenarios.", in: "", out: "", next: ["review"] },
  {
    name: "review",
    by: "human",
    with: "lophn",
    prompt: "Decide whether the fix is good enough to keep.",
    in: "",
    out: "",
    next: ["report", "plan"],
  },
  { name: "report", by: "lophn", with: null, prompt: "Write it up.", in: "", out: "", next: ["end"] },
];

const DEFINITIONS: readonly WorkflowEntry[] = [
  {
    key: "phroner/eval-loop",
    project: PROJECT,
    name: "eval-loop",
    state: "ok",
    kind: "agent",
    startable: true,
    problem: null,
    participants: PARTICIPANTS,
    steps: STEPS.map(({ name, by, with: withKey, next }) => ({ name, by, with: withKey, next })),
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/weekly-review",
    project: PROJECT,
    name: "weekly-review",
    state: "ok",
    kind: "flow",
    startable: true,
    problem: null,
    participants: null,
    steps: [{ name: "fetch", by: "program", with: null, next: [] }],
    artifacts: { static: false, instance: false },
  },
];

interface SampleRun {
  readonly instance: WorkflowInstance;
  readonly last_reports: Record<string, ReportLine>;
  readonly lines: readonly WorkflowLine[];
}

function workflowRun(n: number, input: string, step: string, human: boolean, minutes: number): SampleRun {
  const at = (back: number) => ago(minutes - back);
  const id = `wfi_sample${n}`;
  const report = (seq: string, name: string, text: string, back: number): ReportLine => ({
    instance: id,
    seq,
    at: at(back),
    by: { kind: "agent", session: SESSION_MAIN },
    kind: "report",
    step: name,
    text,
    next: null,
    session: "new",
  });
  const handed = (seq: string, name: string, participant: string, back: number, humanTurn: boolean): WorkflowLine => ({
    instance: id,
    seq,
    at: at(back),
    by: { kind: "lophn" },
    kind: "handed",
    step: name,
    participant,
    receiver: SESSION_MAIN,
    human_turn: humanTurn,
    cause: "report",
    session: null,
  });
  const plan = report("2", "plan", "Repeat exp-011 on the full scenario set with the chest-name fix.", 5);
  const execute = report(
    "4",
    "execute",
    "Ran exp-013 on 24 scenarios. 19 passed, 5 failed, all five on quest lookups with more than one quest line.",
    40,
  );
  const started: WorkflowLine = { instance: id, seq: "1", at: at(0), by: { kind: "user" }, kind: "started", step: "plan", text: input };
  return {
    instance: {
      id,
      project: PROJECT,
      workflow: "eval-loop",
      input,
      state: "running",
      participants: PARTICIPANTS,
      steps: STEPS,
      current: { step, human_turn: human },
      started_by: { kind: "user" },
      created_at: ago(minutes),
      finished_at: null,
      state_seq: "1",
    },
    last_reports: n === 1 ? { plan, execute } : {},
    lines:
      n === 1
        ? [started, plan, handed("3", "execute", "analyst", 6, false), execute, handed("5", "review", "lophn", 41, true)]
        : [started],
  };
}

const workflowRuns = (): SampleRun[] => [
  workflowRun(1, "Check whether the chest-name fix holds on the full scenario set", "review", true, 120),
  workflowRun(2, "Plan the next round of ftb quests experiments", "execute", false, 300),
  workflowRun(3, "Look into why the recipe lookups flip", "execute", false, DAY),
  workflowRun(4, "Re-check the inventory read scenarios", "plan", false, DAY + 120),
];

const summaryOf = ({ instance, lines }: SampleRun): WorkflowInstanceSummary => ({
  id: instance.id,
  project: instance.project,
  workflow: instance.workflow,
  state: instance.state,
  current: instance.current,
  input: instance.input,
  started_by: instance.started_by,
  created_at: instance.created_at,
  finished_at: instance.finished_at,
  last_line: lines.at(-1) ?? null,
});

const entry = (name: string, kind: "file" | "folder", minutes: number): ProjectFileEntry => ({
  name,
  kind,
  size: kind === "file" ? 1200 : 0,
  modified_at: ago(minutes),
});

const files = (): Record<string, readonly ProjectFileEntry[]> => ({
  "": [entry("docs", "folder", 2 * DAY), entry("src", "folder", DAY), entry("README.md", "file", 9 * DAY)],
  docs: [entry("reports", "folder", 60), entry("overview.md", "file", 5 * DAY)],
  "docs/reports": [
    entry("archive", "folder", 20 * DAY),
    entry("2026-w41.md", "file", 60),
    entry("2026-w40.md", "file", 7 * DAY),
    entry("2026-w39.md", "file", 14 * DAY),
    entry("template.md", "file", 46 * DAY),
    entry("regressions.csv", "file", DAY),
  ],
  src: [entry("runner.ts", "file", DAY), entry("scoring.ts", "file", 3 * DAY)],
});

const REPORT = `# Week 41 report

The regression share fell to **0.4%** this week (11 of 2,400 scenarios). All eleven trace back to the same recipe lookup.

## Regressions

| Finding | Scenarios | Cause |
| --- | --- | --- |
| F-011 | 6 | query-recipe gap |
| F-012 | 3 | same lookup |
| F-013 | 2 | same lookup |

## Next week

Rerun exp-011 with the name fix and compare against this table.
`;

const CSV = `finding,scenarios,cause
F-011,6,query-recipe gap
F-012,3,same lookup
F-013,2,same lookup
`;

const EVAL = id("agt", 2);
const BUDGET = id("agt", 3);

function jobs(): JobView[] {
  const held = JOB_HOLD_AGENT().job as JobView;
  const base = {
    trigger: null,
    fired_count: 0,
    skipped_count: 0,
    last_fired_at: null,
    last_skipped_at: null,
    last_skip_reason: null,
    source_gone: false,
    missed_policy: "run",
    enabled: true,
    approved_at: ago(30 * DAY),
    at: null,
    every: null,
  } as const;
  return [
    {
      ...held,
      action: {
        kind: "agent_run",
        agent: LOPHN_HOME_ID,
        agent_workspace: null,
        prompt: "Summarize yesterday’s finished tasks and list the open questions for today.",
      },
      next_due_at: ago(-3 * 60),
      machine: null,
      runs_here: true,
    },
    {
      ...base,
      id: "job_sample_usage",
      title: "Wrap up at the usage limit",
      creator: { agent: BUDGET, workspace: ORDERS },
      trigger: { source: "orders", event: "usage.limit", min_interval: "5m", pass_event: false },
      fired_count: 3,
      last_fired_at: ago(2 * 60),
      action: {
        kind: "agent_run",
        agent: BUDGET,
        agent_workspace: ORDERS,
        prompt: "Wrap up the open work and write down where you stopped.",
      },
      next_due_at: null,
      machine: null,
      runs_here: true,
      last_run: { job_run: "jbr_s1", state: "done", due_at: ago(2 * 60), started_at: ago(2 * 60) },
    },
    {
      ...base,
      id: "job_sample_weekly",
      title: "Weekly review",
      creator: { agent: LOPHN_HOME_ID, workspace: null },
      every: "7d",
      at: "10:00",
      action: { kind: "workflow_start", project: PROJECT, workflow: "weekly-review" },
      next_due_at: ago(-4 * DAY),
      machine: null,
      runs_here: true,
      last_run: { job_run: "jbr_s2", state: "done", due_at: ago(3 * DAY), started_at: ago(3 * DAY) },
    },
    {
      ...base,
      id: "job_sample_export",
      title: "Export orders nightly",
      creator: { agent: LOPHN_HOME_ID, workspace: null },
      every: "1d",
      at: "02:00",
      enabled: false,
      action: { kind: "tool_run", app: ORDERS.id, tool: "orders.export_csv" },
      next_due_at: null,
      machine: null,
      runs_here: true,
      last_run: { job_run: "jbr_s3", state: "done", due_at: ago(6 * DAY), started_at: ago(6 * DAY) },
    },
  ] as JobView[];
}

function jobRuns(job: JobView): JobRunView[] {
  const run = (n: number, state: JobRunView["state"], hours: number, extra: Partial<JobRunView> = {}): JobRunView => ({
    id: `jbr_sample_${job.id}_${n}`,
    due_at: ago(hours * 60),
    missed_count: 0,
    state,
    reason: null,
    instance: null,
    session: null,
    started_at: state === "held" || state === "skipped" ? null : ago(hours * 60),
    ...extra,
  });
  return job.last_run?.state === "held"
    ? [
        run(0, "held", 9),
        run(1, "done", 21, { session: id("ses", 1) }),
        run(2, "done", 45),
        run(3, "skipped", 72, { reason: "person", missed_count: 1 }),
      ]
    : [run(1, "done", 72)];
}

const agentRow = (agent: string, name: string, profile: CharacterProfile, extra: Record<string, unknown> = {}) => ({
  agent,
  handle: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  workspace: null,
  profile,
  model: { provider: "pvd_sample", model_name: "Sonnet 5.5", source: "global" },
  issues: [],
  counts: { skills: 5, mcp: 2 },
  ...extra,
});

const AGENT_ROWS = [
  agentRow(LOPHN_HOME_ID, "lophn", AGENTS[LOPHN_HOME_ID]!.profile, { handle: "lophn" }),
  agentRow(EVAL, "Eval analyst", { kind: "character", shape: "pear", color: "lavender" }),
  agentRow(PLANNER, "Experiment planner", AGENTS[PLANNER]!.profile, {
    workspace: PHRONER,
    description:
      "Plans the next eval experiment from the findings, cheapest first, and writes the plan where the runner picks it up.",
  }),
  agentRow(BUDGET, "Budget reviewer", { kind: "character", shape: "arch", color: "sage" }, { workspace: ORDERS }),
  agentRow("coding_claude", "Claude Code", AGENTS.coding_claude!.profile, {
    model: null,
    counts: { skills: null, mcp: null },
    handle: "claude",
  }),
  agentRow("coding_codex", "Codex", AGENTS.coding_codex!.profile, {
    model: null,
    counts: { skills: null, mcp: null },
    handle: "codex",
  }),
];

const appRuns = () => [
  { id: "run_sample1", target: { tool: "export_csv" }, state: "done", created_at: ago(60), job: {}, error: null, session: null },
  { id: "run_sample2", target: { tool: "mark_shipped" }, state: "done", created_at: ago(180), job: null, error: null, session: null },
  {
    id: "run_sample3",
    target: { tool: "sync_inventory" },
    state: "failed",
    created_at: ago(DAY),
    job: {},
    error: { message: "The stock service did not answer in 30 seconds." },
    session: id("ses", 6),
  },
  { id: "run_sample4", target: { tool: "export_csv" }, state: "done", created_at: ago(DAY + 60), job: {}, error: null, session: null },
];

type Answer = (body: Record<string, unknown>) => unknown;

/** The reads and changes of the place screens, over one memory of jobs so switching one stays switched. */
function placeRoutes(): Record<string, Answer> {
  const jobList = jobs();
  const runs = workflowRuns();
  return {
    "workflows/list": () => ({ workflows: DEFINITIONS }),
    "workflow_instances/list": () => ({ ...COMMON, instances: runs.map(summaryOf) }),
    "workflow_instances/read": (body) => {
      const found = runs.find((one) => one.instance.id === body.instance);
      return found === undefined ? undefined : { ...COMMON, ...found };
    },
    "workflows/start": () => ({ instance: runs[0]!.instance, handed: null }),
    "workflows/stop": () => ({}),
    "project_files/list": (body) => ({ entries: files()[(body.path as string | undefined) ?? ""] ?? [] }),
    "project_files/read": (body) => ({
      text: String(body.path).endsWith(".csv") ? CSV : REPORT,
      truncated: false,
    }),
    "jobs/list": () => ({ ...COMMON, jobs: jobList }),
    "job_runs/list": (body) => {
      const job = jobList.find((one) => one.id === body.job);
      return { ...COMMON, job_runs: job === undefined ? [] : jobRuns(job) };
    },
    // A command's body wraps its input.
    "jobs/update": (body) => {
      const input = body.input as { job: string; enabled?: boolean };
      const at = jobList.findIndex((one) => one.id === input.job);
      const job = jobList[at];
      if (job === undefined) return undefined;
      const enabled = input.enabled ?? job.enabled;
      jobList[at] = { ...job, enabled, next_due_at: enabled ? ago(-6 * 60) : null };
      return { job: jobList[at] };
    },
    "agents/list": () => ({ ...COMMON, agents: AGENT_ROWS }),
    "agents/card": () => ({ card: { modality: { input: ["text", "image", "file"], output: ["text"] } } }),
    "runs/list": () => ({ ...COMMON, runs: appRuns() }),
    "releases/list_records": () => ({
      ...COMMON,
      releases: [{ number: 7, activated_at: ago(2 * DAY), created_at: ago(2 * DAY) }],
    }),
  };
}

/**
 * The computer's coding sessions, in memory: a Claude Code chat waiting on an approval and a Codex session in its
 * terminal (the wireframe's). Switching and opening change the list the way the core would, and tell the list to
 * read again. The chat is the conversation fake's harness scene, read-only (a message sent goes nowhere).
 */
function codingRoutes(changed: () => void): Record<string, Answer> {
  const row = (n: number, harness: string, label: string, view: "gui" | "tui", title: string, minutes: number): CodingSession => ({
    session: id("ses", n),
    terminal: `trm_sample${n}`,
    harness,
    label,
    project: PHRONER.id,
    cwd: "/Users/mina/phroner",
    title,
    state: view === "gui" ? "waiting" : "running",
    view,
    handoff: "restart",
    cli_session: `cli-sample-${n}`,
    last_active_at: ago(minutes),
    switch: null,
  });
  const list = [
    row(21, "claude", "Claude Code", "gui", "Fix flaky retry in the scenario runner", 2),
    row(22, "codex", "Codex", "tui", "Split the eval board loader", 9),
  ];
  const find = (body: Record<string, unknown>) => list.find((one) => one.session === body.session);
  return {
    "coding_sessions/list": (body) => ({
      sessions: list.filter((one) => body.project === undefined || one.project === body.project),
    }),
    "coding_sessions/switch_plan": (body) => {
      const found = find(body);
      return found === undefined
        ? undefined
        : {
            to: found.view === "gui" ? "tui" : "gui",
            stops: { turn: found.state !== "idle", tasks: 0, queued: 0 },
            blocked: null,
          };
    },
    "coding_sessions/switch": (body) => {
      const found = find(body);
      if (found === undefined) return undefined;
      const to = body.to as "gui" | "tui";
      list[list.indexOf(found)] = { ...found, view: to, state: to === "gui" ? "waiting" : "running" };
      changed();
      return { ok: true };
    },
    "coding_sessions/open": (body) => {
      const session = id("ses", 30 + list.length);
      list.unshift({ ...row(30 + list.length, String(body.harness), body.harness === "codex" ? "Codex" : "Claude Code", "gui", "New session", 0), session, state: "idle" });
      changed();
      return { session };
    },
    "acp/send": () => ({}),
  };
}

/**
 * The terminal screen of every sample terminal: a few colored lines with Hangul and an emoji, and what was typed on the
 * prompt line. It follows the size the phone claims. Typing is on, so the text box and the key bar show.
 */
function terminalRoutes(emit: (event: BusEvent) => void): Record<string, Answer> {
  let size = { columns: 44, rows: 18 };
  let typed = "";
  let seq = 1;
  const line = (...runs: TerminalLine["runs"]): TerminalLine => ({ runs, wrapped: false });
  const changed = (terminal: unknown) => {
    seq++;
    emit({
      type: "TerminalScreenChanged",
      subject: `terminal:${String(terminal)}`,
      at: new Date().toISOString(),
      payload: { terminal: String(terminal), seq },
    } as BusEvent);
  };
  return {
    "terminal_view/watch": () => ({}),
    "terminal_view/resize": (body) => {
      size = { columns: Number(body.columns), rows: Number(body.rows) };
      changed(body.terminal);
      return {};
    },
    "terminals/input": (body) => {
      typed += String(body.text).replace(/[\x00-\x1f\x7f]/g, "");
      changed(body.terminal);
      return {};
    },
    "terminals/open": () => ({ terminal: "trm_sample90" }),
    "terminal_view/snapshot": (body) => {
      const lines = [
        line({ text: ">_ ", dim: true }, { text: "OpenAI Codex", bold: true }, { text: " (v0.58.0)", dim: true }),
        line(),
        line({ text: "• ", fg: "p2" }, { text: "Edited ", bold: true }, { text: "src/eval/loader.ts " }, { text: "+42", fg: "p2" }, { text: " " }, { text: "-18", fg: "p1" }),
        line({ text: "  18 ", fg: "p8" }, { text: "+export async function loadBoard(", fg: "p2" }),
        line(),
        line({ text: "✔ ", fg: "p2" }, { text: "테스트", wide: true }, { text: " 48 passed " }, { text: "🎉", wide: true }),
        line(),
        line({ text: "▌ ", fg: "p6" }, { text: typed === "" ? "Ask Codex to do anything" : typed, dim: typed === "" }),
      ];
      const rows = Math.max(size.rows, lines.length);
      return {
        terminal: String(body.terminal),
        generation: 1,
        seq,
        columns: size.columns,
        rows,
        cursor: { x: 2 + typed.length, y: lines.length - 1, hidden: false },
        scrollback: [],
        lines: [...lines, ...Array.from({ length: rows - lines.length }, () => line())],
        input: true,
      };
    },
  };
}

/**
 * The computer's browser pages: a sign-in page an agent opened and one the person opened. Every page shows the same fixed
 * picture (a sign-in form). Typing changes nothing on it; going to an address renames the page, take control and hand
 * back switch who drives it, and opening one adds it to the list, each told the way the core would.
 */
function pageRoutes(emit: (event: BusEvent) => void): Record<string, Answer> {
  const pages = [
    { tab: id("tab", 1), title: "Sign in to GitHub", url: "https://github.com/login", loading: false, by: "Eval analyst" as string | null, held: false },
    { tab: id("tab", 2), title: "phroner dev", url: "http://localhost:5173/boards", loading: false, by: null as string | null, held: false },
  ];
  let seq = 1;
  const find = (body: Record<string, unknown>) => pages.find((one) => one.tab === body.tab);
  const changed = (tab: string) => {
    seq++;
    emit({
      type: "PageViewChanged",
      subject: `page:${tab}`,
      at: new Date().toISOString(),
      payload: { tab, seq },
    } as BusEvent);
  };
  return {
    "page_view/list": () => ({ pages: pages.map(({ held, ...page }) => ({ ...page, held_by: held ? "you" : null })), control: true }),
    "page_view/snapshot": (body) => {
      const page = find(body);
      if (page === undefined) return undefined;
      const { held, ...fields } = page;
      return {
        ...fields,
        seq,
        frame: { media_type: "image/jpeg", data_base64: SAMPLE_PAGE_JPEG, width: 390, height: 520 },
        painting: true,
        agent: page.by !== null && !held,
        held,
        control: true,
      };
    },
    "page_view/watch": (body) => (find(body) === undefined ? undefined : {}),
    "page_view/input": (body) => {
      const page = find(body);
      if (page === undefined) return undefined;
      const input = body.input as { type: string; url?: string };
      if (input.type === "navigate" && input.url !== undefined) {
        page.url = input.url;
        page.title = input.url.replace(/^https?:\/\//, "");
        changed(page.tab);
      }
      return {};
    },
    "page_view/control": (body) => {
      const page = find(body);
      if (page === undefined) return undefined;
      page.held = body.held === true;
      changed(page.tab);
      return {};
    },
    "page_view/open": (body) => {
      const url = String(body.url);
      const tab = id("tab", 10 + pages.length);
      pages.push({ tab, title: url.replace(/^https?:\/\//, ""), url, loading: false, by: null, held: false });
      emit({
        type: "StateChanged",
        subject: null,
        at: new Date().toISOString(),
        payload: { changes: [{ name: "browser_pages", id: null }] },
      } as BusEvent);
      return { tab };
    },
  };
}

// A sign-in form, 390 by 520, the picture of every sample page.
const SAMPLE_PAGE_JPEG =
  "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";

/** The fake Gateway plus the reads every screen makes: projects, apps, sessions, agents, and what the place screens read. */
function sampleCore(): CoreSource {
  const fake = inbox();
  // A coding session's chat is the conversation fake's harness scene with an approval waiting.
  const codingConversation = createFakeAgentTabSource({ scene: "approval-scopes" });
  const snapshots: SessionSnapshot[] = SESSIONS.map((one) => ({
    session: one.id,
    agent: one.agent,
    workspace: one.workspace,
    state: one.state,
    turn_requests: [],
    questions: [],
  }));
  const coding = codingRoutes(() =>
    fake.emitEvent({
      type: "StateChanged",
      subject: null,
      at: new Date().toISOString(),
      payload: { changes: [{ name: "coding_sessions", id: null }] },
    } as BusEvent),
  );
  const reads: Record<string, Answer> = {
    ...placeRoutes(),
    ...coding,
    ...terminalRoutes((event) => fake.emitEvent(event)),
    ...pageRoutes((event) => fake.emitEvent(event)),
    ...sampleOrdersRoutes({
      app: ORDERS.id,
      releases: [id("rel", 7), id("rel", 8)],
      emit: (event) => fake.emitEvent(event),
    }),
    "projects/list": () => ({
      ...COMMON,
      projects: [
        {
          id: PHRONER.id,
          name: "phroner",
          title: "phroner",
          purpose: "",
          revision: "1",
          status: "active",
          folders: [],
        },
      ],
    }),
    "apps/list": () => ({
      ...COMMON,
      apps: [
        [ORDERS, "Orders"],
        [CALENDAR, "Calendar"],
        [MEALS, "Meal planner"],
        [READING, "Reading list"],
      ].map(([app, name]) => ({
        id: (app as { id: string }).id,
        name,
      })),
    }),
    "sessions/list": (body) => {
      const agent = body.agent as string;
      const workspace = body.workspace as { id: string } | null;
      const all: { id: string; agent: string; workspace: { id: string } | null }[] = [
        ...SESSIONS,
        WEEKLY,
        {
          id: "ses_01h455vb4pex5v6nkc6gd5fd04",
          agent: LOPHN_HOME_ID,
          workspace: null,
        },
      ];
      return {
        ...COMMON,
        sessions: all
          .filter(
            (one) =>
              one.agent === agent &&
              (one.workspace?.id ?? null) === (workspace?.id ?? null),
          )
          .map((one) => ({
            id: one.id,
            agent: one.agent,
            workspace: one.workspace,
            title: TITLES[one.id]?.title ?? null,
            lifecycle: "open",
            last_active_at: ago(TITLES[one.id]?.minutesAgo ?? 0),
          })),
      };
    },
    "agents/read": (body) => {
      const agent = AGENTS[body.agent as string];
      return agent === undefined
        ? undefined
        : {
            agent: body.agent,
            effective: {
              name: { value: agent.name },
              profile: { value: agent.profile },
            },
          };
    },
  };
  return {
    ...fake,
    async call(input) {
      const key = `${input.resource}/${input.method}`;
      if (key === "session_snapshots/list") {
        const reply = await fake.call(input);
        const wanted = (input.body as { sessions?: string[] } | undefined)
          ?.sessions;
        const value = reply.value as { snapshots: SessionSnapshot[] };
        return {
          ok: true,
          value: {
            ...value,
            snapshots: [
              ...value.snapshots,
              ...snapshots.filter(
                (one) => wanted === undefined || wanted.includes(one.session),
              ),
            ],
          },
        };
      }
      if (key === "acp/snapshot") {
        const state = await codingConversation.acp(SESSION_MAIN);
        return state.ok
          ? { ok: true, value: shifted(state.value, Date.now() - FAKE_NOW) }
          : { ok: false, error: { code: "not_found", message: "sample" } };
      }
      const read = reads[key];
      if (read === undefined) return fake.call(input);
      const value = read((input.body ?? {}) as Record<string, unknown>);
      return value === undefined
        ? { ok: false, error: { code: "not_found", message: "sample" } }
        : { ok: true, value };
    },
  };
}

const SCENES: Record<SampleConversation, AgentTabScene> = {
  done: "report",
  working: "working",
  approval: "approval",
  question: "question",
};

// The conversation fake's "now" (agent-tab-fake-source.ts: 50 minutes into 2026-10-06 09:00 UTC, when it sends).
const FAKE_NOW = Date.parse("2026-10-06T09:50:00Z");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Every ISO time in a read moved by `by` ms. */
function shifted<T>(value: T, by: number): T {
  if (typeof value === "string") {
    return (ISO.test(value) ? new Date(Date.parse(value) + by).toISOString() : value) as T;
  }
  if (Array.isArray(value)) return value.map((one) => shifted(one, by)) as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, shifted(one, by)])) as T;
  }
  return value;
}

/**
 * One in-memory conversation for every sample session; only Weekly report has messages. The state can be switched so
 * screens can show all four; listeners of `changed` hear the switch and read again.
 */
function sampleSource(): {
  source: AgentTabSource;
  show(state: SampleConversation): void;
} {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const make = (state: SampleConversation) => {
    const inner = createFakeAgentTabSource({ scene: SCENES[state] });
    inner.changed?.(notify);
    return inner;
  };
  let inner = make("approval");
  // The fake dates its whole conversation on one morning; moved so that morning's "now" is when the sample was made.
  const by = Date.now() - FAKE_NOW;
  const source = new Proxy({} as AgentTabSource, {
    get: (_target, key) => {
      if (key === "changed") {
        return (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        };
      }
      const value = Reflect.get(inner, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(inner, args);
        return result instanceof Promise
          ? result.then((read) => shifted(read, by))
          : result;
      };
    },
  });
  return {
    source,
    show(state) {
      inner = make(state);
      notify();
    },
  };
}

export function createSampleComputer(): SampleComputer<ComputerData> {
  const conversation = sampleSource();
  const { data } = dataOf(sampleCore(), () => conversation.source);
  const sample: ComputerData = {
    ...data,
    deskOf: (session) => DESKS[session] ?? null,
    sample: { conversation: conversation.show },
  };
  return {
    key: SAMPLE_KEY,
    name: "mina-desktop",
    link: {
      data: sample,
      state: () => ({
        status: "connected",
        update: null,
        path: "direct",
        waiting: sample.stores.waiting.get().count,
      }),
      subscribe: (listener) => sample.stores.waiting.subscribe(listener),
      pause() {},
      resume() {},
      close() {},
    },
  };
}
