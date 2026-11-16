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
      shell: "attached",
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
    "coding_sessions/wake": () => ({ shell: "attached" }),
    "acp/send": () => ({}),
  };
}

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
        path: "direct",
        waiting: sample.waiting.get().count,
      }),
      subscribe: (listener) => sample.waiting.subscribe(listener),
      pause() {},
      resume() {},
      close() {},
    },
  };
}
