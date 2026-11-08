// Scheduled jobs 화면의 가짜 통로. core를 부르지 않고 job을 메모리에 두며 부른 것을 기록한다.
// 기본 값은 화면 확인용 대표 job 다섯(하나는 꺼짐)과 그 기록이다. 시각은 지금 기준 상대값이다.
import { lophnIdOf } from "../../../../../protocol/lophn-agent/workspaces.ts";
import type {
  JobNames,
  JobRunState,
  JobRunView,
  JobsSource,
  JobView,
} from "../source.ts";

export interface FakeJobsOptions {
  jobs: readonly JobView[];
  /** job id → 그 job의 기록(새것이 앞). */
  runs: Readonly<Record<string, readonly JobRunView[]>>;
  names: JobNames;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;

const GROCERY = id("prj", 1);
const PHRONER = id("prj", 2);
const ORDERS = id("app", 1);
const BUDGET = id("app", 2);

const NAMES: JobNames = {
  projects: { [GROCERY]: "Grocery", [PHRONER]: "Phroner" },
  apps: { [ORDERS]: "Orders", [BUDGET]: "Budget" },
  agents: { [id("agt", 1)]: "Bookkeeper" },
};

export const JOB_DIGEST = id("job", 1);
export const JOB_REVIEW = id("job", 2);
export const JOB_ORDERS = id("job", 3);
export const JOB_BUDGET = id("job", 4);
export const JOB_BACKUP = id("job", 5);

const last = (
  state: JobRunState,
  due: number,
  started: number | null,
): NonNullable<JobView["last_run"]> => ({
  state,
  due_at: at(due),
  started_at: started === null ? null : at(started),
});

const JOBS: readonly JobView[] = [
  {
    id: JOB_DIGEST,
    title: "Morning digest",
    creator: { agent: lophnIdOf(null), workspace: null },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: lophnIdOf({ kind: "project", id: GROCERY }),
      agent_workspace: { kind: "project", id: GROCERY },
      prompt:
        "Summarize yesterday's finished tasks and list the open questions for today.",
    },
    missed_policy: "hold",
    enabled: true,
    approved_at: at(-30 * DAY),
    next_due_at: at(3 * HOUR),
    last_run: last("done", -21 * HOUR, -21 * HOUR),
  },
  {
    id: JOB_REVIEW,
    title: "Weekly review",
    creator: {
      agent: lophnIdOf({ kind: "project", id: PHRONER }),
      workspace: { kind: "project", id: PHRONER },
    },
    every: "7d",
    at: "10:00",
    action: {
      kind: "workflow_start",
      project: PHRONER,
      workflow: "weekly-review",
    },
    missed_policy: "hold",
    enabled: true,
    approved_at: at(-30 * DAY),
    next_due_at: at(4 * DAY),
    last_run: last("held", -2 * DAY, null),
  },
  {
    id: JOB_ORDERS,
    title: "Refresh stale orders",
    creator: {
      agent: lophnIdOf({ kind: "app", id: ORDERS }),
      workspace: { kind: "app", id: ORDERS },
    },
    every: "30m",
    at: null,
    action: { kind: "tool_run", app: ORDERS, tool: "refresh_stale" },
    missed_policy: "run",
    enabled: true,
    approved_at: at(-30 * DAY),
    next_due_at: at(29 * MIN),
    last_run: last("running", -MIN, -40_000),
  },
  {
    id: JOB_BUDGET,
    title: "Bookkeeping notes",
    creator: { agent: lophnIdOf(null), workspace: null },
    every: "1d",
    at: "23:30",
    action: {
      kind: "agent_run",
      agent: id("agt", 1),
      agent_workspace: { kind: "app", id: BUDGET },
      prompt: "Write today's bookkeeping notes for the Budget app.",
    },
    missed_policy: "hold",
    enabled: false,
    approved_at: at(-30 * DAY),
    next_due_at: null,
    last_run: last("failed", -9 * HOUR, -9 * HOUR),
  },
  {
    id: JOB_BACKUP,
    title: "Check backups",
    creator: { agent: id("agt", 1), workspace: { kind: "app", id: BUDGET } },
    every: "6h",
    at: null,
    action: { kind: "tool_run", app: BUDGET, tool: "check_backups" },
    missed_policy: "run",
    enabled: true,
    approved_at: at(-30 * DAY),
    next_due_at: at(6 * HOUR),
    last_run: last("queued", -20_000, null),
  },
];

function run(
  n: number,
  state: JobRunState,
  due: number,
  fields: Partial<JobRunView> = {},
): JobRunView {
  return {
    id: id("jbr", n),
    due_at: at(due),
    missed_count: 0,
    state,
    reason: null,
    instance: null,
    session: null,
    started_at: null,
    ...fields,
  };
}

const started = (from: number) => ({ started_at: at(from) });

const RUNS: Readonly<Record<string, readonly JobRunView[]>> = {
  [JOB_DIGEST]: [
    run(101, "done", -21 * HOUR, {
      ...started(-21 * HOUR),
      session: id("ses", 1),
    }),
    run(102, "skipped", -2 * DAY, { reason: "overlap" }),
    run(103, "failed", -3 * DAY, {
      ...started(-3 * DAY),
      session: id("ses", 2),
    }),
    run(104, "cancelled", -4 * DAY, {
      ...started(-4 * DAY),
      session: id("ses", 3),
    }),
    run(105, "interrupted", -5 * DAY, {
      ...started(-5 * DAY),
      session: id("ses", 4),
    }),
  ],
  [JOB_REVIEW]: [
    run(201, "held", -2 * DAY, { missed_count: 2 }),
    run(202, "done", -9 * DAY, {
      ...started(-9 * DAY),
      instance: id("wfi", 1),
    }),
    run(203, "skipped", -16 * DAY, { reason: "person" }),
    run(204, "skipped", -23 * DAY, { reason: "superseded" }),
    run(205, "failed", -30 * DAY, {
      reason: "not_found: Workflow weekly-review was not found in Phroner.",
    }),
  ],
  [JOB_ORDERS]: [
    run(301, "running", -MIN, started(-40_000)),
    run(302, "done", -31 * MIN, started(-31 * MIN)),
    run(303, "done", -4 * HOUR, { ...started(-3 * HOUR), missed_count: 3 }),
  ],
  [JOB_BUDGET]: [
    run(401, "failed", -9 * HOUR, {
      ...started(-9 * HOUR),
      session: id("ses", 5),
    }),
    run(402, "done", -33 * HOUR, {
      ...started(-33 * HOUR),
      session: id("ses", 6),
    }),
  ],
  [JOB_BACKUP]: [
    run(501, "queued", -20_000),
    run(502, "done", -6 * HOUR, started(-6 * HOUR)),
  ],
};

export function fakeJobs(options: Partial<FakeJobsOptions> = {}) {
  const calls: unknown[][] = [];
  let jobs = options.jobs ?? JOBS;
  const runs = options.runs ?? RUNS;
  const names = options.names ?? NAMES;
  const change = (job: string, next: (one: JobView) => JobView) => {
    jobs = jobs.map((one) => (one.id === job ? next(one) : one));
    return Promise.resolve({ ok: true as const, value: null });
  };
  const source: JobsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    list() {
      calls.push(["list"]);
      return Promise.resolve({ ok: true, value: { jobs, names } });
    },
    runs(job) {
      calls.push(["runs", job]);
      return Promise.resolve({ ok: true, value: runs[job] ?? [] });
    },
    setEnabled(job, enabled) {
      calls.push(["setEnabled", job, enabled]);
      return change(job, (one) => ({ ...one, enabled }));
    },
    update(job, patch) {
      calls.push(["update", job, patch]);
      return change(job, (one) => ({ ...one, ...patch }));
    },
    remove(job) {
      calls.push(["remove", job]);
      jobs = jobs.filter((one) => one.id !== job);
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source, calls };
}
