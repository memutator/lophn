// What the project and app workspace screens read beyond the workspace list: a project's workflows, files and jobs, an app's
// runs and release: plain reads of the routes the phone may call. The sample computer has no core behind these, so each read
// answers from the wireframe's example data there.
import type { z } from "zod";
import type { MemoryRoute, ReadRoute } from "../../../protocol/base/route.ts";
import { releasesListRecords } from "../../../protocol/apps/activation/activation.ts";
import { jobList } from "../../../protocol/jobs/jobs.ts";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type ProjectFileEntry,
  projectFilesList,
  projectFilesRead,
} from "../../../protocol/projects/project-files.ts";
import { runList } from "../../../protocol/runs/runs.ts";
import {
  type ReportLine,
  type WorkflowEntry,
  type WorkflowInstance,
  type WorkflowInstanceSummary,
  type WorkflowLine,
} from "../../../protocol/workflows/instances.ts";
import {
  workflowInstanceList,
  workflowInstanceRead,
  workflowList,
  workflowStart,
  workflowStop,
} from "../../../protocol/workflows/routes.ts";
import { SESSION_MAIN } from "../../../shell/renderer/conversation/agent-tab-fake-source.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  type ReadHandle,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import {
  useEventClient,
  useSessions,
} from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { jobsOfProject } from "../../../shell/renderer/desktop/jobs/model.ts";
import type { JobView } from "../../../shell/renderer/desktop/jobs/source.ts";
import { type ConversationTarget, useSampleConversation } from "./hooks.tsx";

export type { ReadHandle } from "../../../shell/renderer/desktop/connection/core-read.ts";
export type { ProjectFileEntry } from "../../../protocol/projects/project-files.ts";
export type { JobView } from "../../../shell/renderer/desktop/jobs/source.ts";

type Route = ReadRoute | MemoryRoute;
type Asked<T> = { ok: true; value: T } | { ok: false; code: string };

async function ask<R extends Route>(
  core: CoreSource,
  route: R,
  input: z.input<R["input"]>,
): Promise<Asked<z.output<R["output"]>>> {
  try {
    const reply = await core.call({
      kind: route.kind,
      resource: route.resource,
      method: route.method,
      body: input,
    });
    return reply.ok
      ? { ok: true, value: reply.value as z.output<R["output"]> }
      : { ok: false, code: reply.error?.code ?? "internal" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

const ok = <T>(value: T) => ({ ok: true, value }) as const;
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const DAY = 24 * 60;

/** The core of the computer on screen, and whether it is the sample computer. */
function useEnv(): { core: CoreSource; sample: boolean } {
  const core = useEventClient().core;
  const sample = useSampleConversation() !== null;
  return { core, sample };
}

// ---- a session to open from a workflow

/** Where to open a session that is only known by its id (a workflow hands its step to one). Null while the list has not got it. */
export function useSessionTarget(
  session: string | null,
): ConversationTarget | null {
  const { sessions } = useSessions();
  const found = sessions.find((one) => one.session === session);
  return found === undefined
    ? null
    : {
        session: found.session,
        agent: found.agent ?? lophnIdOf(found.workspace),
        workspace: found.workspace,
      };
}

// ---- workflows

export type WorkflowDefinition = WorkflowEntry;
export type WorkflowRunSummary = WorkflowInstanceSummary;

export interface WorkflowDetail {
  readonly instance: WorkflowInstance;
  /** The last report of each step. */
  readonly last_reports: Readonly<Record<string, ReportLine>>;
  readonly lines: readonly WorkflowLine[];
}

const PARTICIPANTS = {
  lophn: { agent: "lophn" },
  analyst: { agent: "Eval analyst" },
  human: { kind: "human" },
} as const;

const SAMPLE_STEPS = [
  {
    name: "plan",
    by: "lophn",
    with: null,
    prompt: "Plan the run.",
    in: "",
    out: "",
    next: ["execute"],
  },
  {
    name: "execute",
    by: "analyst",
    with: null,
    prompt: "Run the scenarios.",
    in: "",
    out: "",
    next: ["review"],
  },
  {
    name: "review",
    by: "human",
    with: "lophn",
    prompt: "Decide whether the fix is good enough to keep.",
    in: "",
    out: "",
    next: ["report", "plan"],
  },
  {
    name: "report",
    by: "lophn",
    with: null,
    prompt: "Write it up.",
    in: "",
    out: "",
    next: ["end"],
  },
];

const SAMPLE_DEFINITIONS: readonly WorkflowEntry[] = [
  {
    key: "phroner/eval-loop",
    project: "prj_sample",
    name: "eval-loop",
    state: "ok",
    kind: "agent",
    startable: true,
    problem: null,
    participants: PARTICIPANTS,
    steps: SAMPLE_STEPS.map(({ name, by, with: withKey, next }) => ({
      name,
      by,
      with: withKey,
      next,
    })),
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/weekly-review",
    project: "prj_sample",
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

function sampleRun(
  n: number,
  input: string,
  step: string,
  human: boolean,
  minutes: number,
): WorkflowDetail {
  const at = (back: number) => ago(minutes - back);
  const by = { kind: "user" } as const;
  const lophn = { kind: "lophn" } as const;
  const id = `wfi_sample${n}`;
  const report = (
    seq: string,
    name: string,
    text: string,
    back: number,
  ): ReportLine => ({
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
  const plan = report(
    "2",
    "plan",
    "Repeat exp-011 on the full scenario set with the chest-name fix.",
    5,
  );
  const execute = report(
    "4",
    "execute",
    "Ran exp-013 on 24 scenarios. 19 passed, 5 failed, all five on quest lookups with more than one quest line.",
    40,
  );
  const lines: WorkflowLine[] = [
    {
      instance: id,
      seq: "1",
      at: at(0),
      by,
      kind: "started",
      step: "plan",
      text: input,
    },
    ...(n === 1
      ? ([
          plan,
          {
            instance: id,
            seq: "3",
            at: at(6),
            by: lophn,
            kind: "handed",
            step: "execute",
            participant: "analyst",
            receiver: SESSION_MAIN,
            human_turn: false,
            cause: "report",
            session: null,
          },
          execute,
          {
            instance: id,
            seq: "5",
            at: at(41),
            by: lophn,
            kind: "handed",
            step: "review",
            participant: "lophn",
            receiver: SESSION_MAIN,
            human_turn: true,
            cause: "report",
            session: null,
          },
        ] as const)
      : []),
  ];
  return {
    instance: {
      id,
      project: "prj_sample",
      workflow: "eval-loop",
      input,
      state: "running",
      participants: PARTICIPANTS,
      steps: SAMPLE_STEPS,
      current: { step, human_turn: human },
      started_by: { kind: "user" },
      created_at: ago(minutes),
      finished_at: null,
      state_seq: "1",
    },
    last_reports: n === 1 ? { plan, execute } : {},
    lines,
  };
}

const SAMPLE_RUNS_OF_WORKFLOW: readonly WorkflowDetail[] = [
  sampleRun(
    1,
    "Check whether the chest-name fix holds on the full scenario set",
    "review",
    true,
    120,
  ),
  sampleRun(
    2,
    "Plan the next round of ftb quests experiments",
    "execute",
    false,
    300,
  ),
  sampleRun(3, "Look into why the recipe lookups flip", "execute", false, DAY),
  sampleRun(
    4,
    "Re-check the inventory read scenarios",
    "plan",
    false,
    DAY + 120,
  ),
];

const summaryOf = ({
  instance,
  lines,
}: WorkflowDetail): WorkflowInstanceSummary => ({
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

// Every list the core pages through is read to its end, up to this many pages.
const PAGE_LIMIT = 20;

export interface Workflows {
  readonly definitions: readonly WorkflowEntry[];
  /** Newest first, every workflow of the project. */
  readonly instances: readonly WorkflowInstanceSummary[];
}

export interface WorkflowsHandle extends ReadHandle<Workflows> {
  /** Starts a run of the workflow with the text its first step works on. Resolves to the new run's id, or null when it did not start. */
  start(entry: WorkflowEntry, text: string): Promise<string | null>;
}

export function useWorkflows(project: string): WorkflowsHandle {
  const { core, sample } = useEnv();
  const read = useFollowedRead<Workflows>(
    async () => {
      if (sample) {
        return ok({
          definitions: SAMPLE_DEFINITIONS,
          instances: SAMPLE_RUNS_OF_WORKFLOW.map(summaryOf),
        });
      }
      const definitions = await ask(core, workflowList, { project });
      if (!definitions.ok) return { ok: false };
      const instances: WorkflowInstanceSummary[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const read = await ask(core, workflowInstanceList, {
          project,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return { ok: false };
        instances.push(...read.value.instances);
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return ok({ definitions: definitions.value.workflows, instances });
    },
    ["workflow_instances"],
    project,
  );
  return {
    ...read,
    async start(entry, text) {
      if (sample) return SAMPLE_RUNS_OF_WORKFLOW[0]!.instance.id;
      const started = await ask(core, workflowStart, {
        workflow: entry.key,
        text,
      });
      if (!started.ok) return null;
      read.reload();
      return started.value.instance.id;
    },
  };
}

export interface WorkflowRun extends ReadHandle<WorkflowDetail> {
  stop(): Promise<boolean>;
}

export function useWorkflowRun(instance: string): WorkflowRun {
  const { core, sample } = useEnv();
  const read = useFollowedRead<WorkflowDetail>(
    async () => {
      if (sample) {
        const found = SAMPLE_RUNS_OF_WORKFLOW.find(
          (one) => one.instance.id === instance,
        );
        return found === undefined ? { ok: false } : ok(found);
      }
      const lines: WorkflowLine[] = [];
      let cursor: string | undefined;
      let last: Awaited<ReturnType<typeof readOnce>> | null = null;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const one = await readOnce(core, instance, cursor);
        if (!one.ok) return { ok: false };
        last = one;
        lines.push(...one.value.lines);
        if (one.value.next_cursor === null) break;
        cursor = one.value.next_cursor;
      }
      return last?.ok === true
        ? ok({
            instance: last.value.instance,
            last_reports: last.value.last_reports,
            lines,
          })
        : { ok: false };
    },
    [{ name: "workflow_instances", id: instance }],
    instance,
  );
  return {
    ...read,
    async stop() {
      if (sample) return true;
      const stopped = await ask(core, workflowStop, { instance });
      read.reload();
      return stopped.ok;
    },
  };
}

// A run's lines come 200 at a time, oldest first.
const readOnce = (core: CoreSource, instance: string, cursor?: string) =>
  ask(core, workflowInstanceRead, {
    instance,
    ...(cursor === undefined ? {} : { cursor }),
  });

// ---- files

const FOLDER = (name: string, minutes: number): ProjectFileEntry => ({
  name,
  kind: "folder",
  size: 0,
  modified_at: ago(minutes),
});
const FILE = (name: string, minutes: number): ProjectFileEntry => ({
  name,
  kind: "file",
  size: 1200,
  modified_at: ago(minutes),
});

const SAMPLE_FILES: Record<string, readonly ProjectFileEntry[]> = {
  "": [FOLDER("docs", 2 * DAY), FOLDER("src", DAY), FILE("README.md", 9 * DAY)],
  docs: [FOLDER("reports", 60), FILE("overview.md", 5 * DAY)],
  "docs/reports": [
    FOLDER("archive", 20 * DAY),
    FILE("2026-w41.md", 60),
    FILE("2026-w40.md", 7 * DAY),
    FILE("2026-w39.md", 14 * DAY),
    FILE("template.md", 46 * DAY),
    FILE("regressions.csv", DAY),
  ],
  src: [FILE("runner.ts", DAY), FILE("scoring.ts", 3 * DAY)],
};

const SAMPLE_REPORT = `# Week 41 report

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

const SAMPLE_CSV = `finding,scenarios,cause
F-011,6,query-recipe gap
F-012,3,same lookup
F-013,2,same lookup
`;

/** The folder `path` (relative to the project folder, "" for its root): folders first, then files by name. */
export function useProjectFiles(
  project: string,
  path: string,
): ReadHandle<readonly ProjectFileEntry[]> {
  const { core, sample } = useEnv();
  return useFollowedRead<readonly ProjectFileEntry[]>(
    async () => {
      if (sample) return ok(SAMPLE_FILES[path] ?? []);
      const listed = await ask(core, projectFilesList, {
        project,
        ...(path === "" ? {} : { path }),
      });
      return listed.ok ? ok(listed.value.entries) : { ok: false };
    },
    [],
    `${project}\0${path}`,
  );
}

export type FileContent =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly truncated: boolean;
    }
  /** The core only reads UTF-8 text; anything else is opened on the computer. */
  | { readonly kind: "not-text" };

export function useProjectFile(
  project: string,
  path: string,
): ReadHandle<FileContent> {
  const { core, sample } = useEnv();
  return useFollowedRead<FileContent>(
    async () => {
      if (sample) {
        return ok({
          kind: "text",
          text: path.endsWith(".csv") ? SAMPLE_CSV : SAMPLE_REPORT,
          truncated: false,
        } as const);
      }
      const read = await ask(core, projectFilesRead, { project, path });
      if (read.ok) return ok({ kind: "text", ...read.value } as const);
      return read.code === "invalid_input"
        ? ok({ kind: "not-text" } as const)
        : { ok: false };
    },
    [],
    `${project}\0${path}`,
  );
}

// ---- a project's jobs

const SAMPLE_JOBS = (project: string): readonly JobView[] => [
  {
    id: "job_sample1",
    title: "Weekly review",
    creator: {
      agent: lophnIdOf({ kind: "project", id: project }),
      workspace: { kind: "project", id: project },
    },
    every: "7d",
    at: "09:00",
    trigger: null,
    fired_count: 0,
    skipped_count: 0,
    last_fired_at: null,
    last_skipped_at: null,
    last_skip_reason: null,
    action: { kind: "workflow_start", project, workflow: "weekly-review" },
    missed_policy: "run",
    enabled: true,
    approved_at: ago(30 * DAY),
    next_due_at: new Date(Date.now() + 2 * DAY * 60_000).toISOString(),
    last_run: {
      state: "done",
      due_at: ago(5 * DAY),
      started_at: ago(5 * DAY),
    },
  },
  {
    id: "job_sample2",
    title: "Export the regression table",
    creator: {
      agent: lophnIdOf({ kind: "project", id: project }),
      workspace: { kind: "project", id: project },
    },
    every: "1d",
    at: "02:00",
    trigger: null,
    fired_count: 0,
    skipped_count: 0,
    last_fired_at: null,
    last_skipped_at: null,
    last_skip_reason: null,
    action: {
      kind: "agent_run",
      agent: lophnIdOf({ kind: "project", id: project }),
      agent_workspace: { kind: "project", id: project },
      prompt: "Export docs/reports/regressions.csv",
    },
    missed_policy: "run",
    enabled: false,
    approved_at: ago(30 * DAY),
    next_due_at: null,
    last_run: null,
  },
];

/** The jobs that belong to a project (made in it, asking its agents, starting its workflows), read-only. */
export function useProjectJobs(
  project: string,
): ReadHandle<readonly JobView[]> {
  const { core, sample } = useEnv();
  return useFollowedRead<readonly JobView[]>(
    async () => {
      if (sample) return ok(SAMPLE_JOBS(project));
      const jobs: JobView[] = [];
      let cursor: string | undefined;
      // 20 pages of 50 are far more jobs than a phone list can show.
      for (let page = 0; page < 20; page += 1) {
        const read = await ask(
          core,
          jobList,
          cursor === undefined ? {} : { cursor },
        );
        if (!read.ok) return { ok: false };
        jobs.push(...(read.value.jobs as readonly JobView[]));
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return ok(jobsOfProject(jobs, project));
    },
    ["jobs"],
    project,
  );
}

// ---- an app's runs and release

export interface ActivityRun {
  readonly id: string;
  /** The tool a tool run called; null for an agent run. */
  readonly tool: string | null;
  readonly state: "running" | "done" | "failed" | "cancelled";
  readonly at: string;
  /** A job started it. */
  readonly job: boolean;
  /** Why a failed run failed. */
  readonly error: string | null;
  /** The session an agent run opened (lophn opens one when a run fails). */
  readonly session: string | null;
}

const SAMPLE_RUNS: readonly ActivityRun[] = [
  {
    id: "run_sample1",
    tool: "export_csv",
    state: "done",
    at: ago(60),
    job: true,
    error: null,
    session: null,
  },
  {
    id: "run_sample2",
    tool: "mark_shipped",
    state: "done",
    at: ago(180),
    job: false,
    error: null,
    session: null,
  },
  {
    id: "run_sample3",
    tool: "sync_inventory",
    state: "failed",
    at: ago(DAY),
    job: true,
    error: "The stock service did not answer in 30 seconds.",
    session: "ses_01h455vb4pex5v6nkc6gd5p006",
  },
  {
    id: "run_sample4",
    tool: "export_csv",
    state: "done",
    at: ago(DAY + 60),
    job: true,
    error: null,
    session: null,
  },
];

/** The newest runs in the app's workspace, newest first. */
export function useAppActivity(
  app: string,
): ReadHandle<readonly ActivityRun[]> {
  const { core, sample } = useEnv();
  return useFollowedRead<readonly ActivityRun[]>(
    async () => {
      if (sample) return ok(SAMPLE_RUNS);
      const read = await ask(core, runList, { workspace: { app } });
      return read.ok
        ? ok(
            read.value.runs.map((run) => ({
              id: run.id,
              tool: "tool" in run.target ? run.target.tool : null,
              state: run.state,
              at: run.created_at,
              job: run.job !== null,
              error: run.error?.message ?? null,
              session: run.session,
            })),
          )
        : { ok: false };
    },
    ["runs"],
    app,
  );
}

export interface AppRelease {
  readonly number: number;
  readonly activatedAt: string;
}

/** The release that is live, or null before the app has one. */
export function useAppRelease(app: string): ReadHandle<AppRelease | null> {
  const { core, sample } = useEnv();
  return useFollowedRead<AppRelease | null>(
    async () => {
      if (sample) return ok({ number: 7, activatedAt: ago(2 * DAY) });
      const read = await ask(core, releasesListRecords, {
        app,
        status: "active",
        limit: 1,
      });
      if (!read.ok) return { ok: false };
      const live = read.value.releases[0];
      return ok(
        live === undefined
          ? null
          : {
              number: live.number,
              activatedAt: live.activated_at ?? live.created_at,
            },
      );
    },
    [{ name: "releases", id: app }],
    app,
  );
}
