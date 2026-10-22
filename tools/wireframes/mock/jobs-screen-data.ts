// job 화면 draft의 fixture. 칸 이름과 값은 `sj-jobs-contract`의 `JobRecord`·`JobRunRecord`와 같고 id만 문자열이다.
// 승인 뒤 `sj-shell-jobs-screen`이 이 interface를 renderer `source.ts`의 type으로 옮긴다.

export type AgentRefView =
  | { readonly role: "lophn" }
  | { readonly role: "project_manager"; readonly project: string }
  | { readonly role: "app_engineer"; readonly app: string }
  | { readonly role: "operator"; readonly agent: string };

export type PlaceView =
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "app"; readonly id: string };

export type JobActionView =
  | {
    readonly kind: "agent_run";
    readonly agent: AgentRefView;
    readonly agent_place: PlaceView | null;
    readonly prompt: string;
  }
  | {
    readonly kind: "tool_run";
    readonly app: string;
    readonly tool: string;
    readonly input?: unknown;
  }
  | {
    readonly kind: "workflow_start";
    readonly project: string;
    readonly workflow: string;
    readonly text: string;
    readonly step?: string;
  };

export const JOB_RUN_STATES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
  "held",
  "skipped",
  "interrupted",
] as const;
export type JobRunState = (typeof JOB_RUN_STATES)[number];

export interface JobView {
  readonly id: string;
  readonly title: string;
  readonly creator: AgentRefView;
  readonly every: string;
  readonly at: string | null;
  readonly action: JobActionView;
  readonly missed_policy: "run" | "hold";
  readonly enabled: boolean;
  readonly next_due_at: string | null;
  readonly last_run: {
    readonly job_run: string;
    readonly state: JobRunState;
    readonly due_at: string;
    readonly started_at: string | null;
    readonly ended_at: string | null;
  } | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface JobRunView {
  readonly id: string;
  readonly job: string;
  readonly due_at: string;
  readonly missed_count: number;
  readonly state: JobRunState;
  readonly reason: string | null;
  readonly run: string | null;
  readonly instance: string | null;
  readonly session: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
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

/** 화면이 앱·project·Operator 목록을 따로 읽어 id를 이름으로 푼다고 가정한 표. */
export const NAMES = {
  projects: { [GROCERY]: "Grocery", [PHRONER]: "Phroner" } as Record<
    string,
    string
  >,
  apps: { [ORDERS]: "Orders", [BUDGET]: "Budget" } as Record<string, string>,
  operators: { [id("agt", 1)]: "Bookkeeper" } as Record<string, string>,
};

const JOB_DIGEST = id("job", 1);
const JOB_REVIEW = id("job", 2);
const JOB_ORDERS = id("job", 3);
const JOB_BUDGET = id("job", 4);
const JOB_BACKUP = id("job", 5);

function job(
  n: number,
  fields:
    & Omit<
      JobView,
      "id" | "created_at" | "updated_at" | "enabled" | "next_due_at"
    >
    & { enabled?: boolean; next_due_at?: string | null },
): JobView {
  return {
    id: id("job", n),
    enabled: true,
    next_due_at: null,
    created_at: at(-30 * DAY),
    updated_at: at(-2 * DAY),
    ...fields,
  };
}

const last = (
  n: number,
  state: JobRunState,
  due: number,
  started: number | null,
  ended: number | null,
) => ({
  job_run: id("jbr", n),
  state,
  due_at: at(due),
  started_at: started === null ? null : at(started),
  ended_at: ended === null ? null : at(ended),
});

export const JOBS: readonly JobView[] = [
  job(1, {
    title: "Morning digest",
    creator: { role: "lophn" },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: { role: "project_manager", project: GROCERY },
      agent_place: { kind: "project", id: GROCERY },
      prompt:
        "Summarize yesterday's finished tasks and list the open questions for today.",
    },
    missed_policy: "hold",
    next_due_at: at(3 * HOUR),
    last_run: last(101, "done", -21 * HOUR, -21 * HOUR, -21 * HOUR + 4 * MIN),
  }),
  job(2, {
    title: "Weekly review",
    creator: { role: "project_manager", project: PHRONER },
    every: "7d",
    at: "10:00",
    action: {
      kind: "workflow_start",
      project: PHRONER,
      workflow: "weekly-review",
      text: "Review last week's experiments and propose next steps.",
    },
    missed_policy: "hold",
    next_due_at: at(4 * DAY),
    last_run: last(201, "held", -2 * DAY, null, null),
  }),
  job(3, {
    title: "Refresh stale orders",
    creator: { role: "app_engineer", app: ORDERS },
    every: "30m",
    at: null,
    action: {
      kind: "tool_run",
      app: ORDERS,
      tool: "refresh_stale",
      input: { limit: 50 },
    },
    missed_policy: "run",
    next_due_at: at(29 * MIN),
    last_run: last(301, "running", -MIN, -40_000, null),
  }),
  job(4, {
    title: "Bookkeeping notes",
    creator: { role: "lophn" },
    every: "1d",
    at: "23:30",
    action: {
      kind: "agent_run",
      agent: { role: "operator", agent: id("agt", 1) },
      agent_place: { kind: "app", id: BUDGET },
      prompt: "Write today's bookkeeping notes for the Budget app.",
    },
    missed_policy: "hold",
    enabled: false,
    last_run: last(401, "failed", -9 * HOUR, -9 * HOUR, -9 * HOUR + 2 * MIN),
  }),
  job(5, {
    title: "Check backups",
    creator: { role: "app_engineer", app: BUDGET },
    every: "6h",
    at: null,
    action: { kind: "tool_run", app: BUDGET, tool: "check_backups" },
    missed_policy: "run",
    next_due_at: at(6 * HOUR),
    last_run: last(501, "queued", -20_000, null, null),
  }),
];

function jobRun(
  n: number,
  job: string,
  state: JobRunState,
  due: number,
  fields: Partial<JobRunView> = {},
): JobRunView {
  const started = fields.started_at;
  return {
    id: id("jbr", n),
    job,
    due_at: at(due),
    missed_count: 0,
    state,
    reason: null,
    run: null,
    instance: null,
    session: null,
    started_at: null,
    ended_at: null,
    created_at: started ?? at(due),
    ...fields,
  };
}

const span = (from: number, length: number) => ({
  started_at: at(from),
  ended_at: at(from + length),
});

/** job id → 그 job의 job run. 새것이 앞이다(`job_run.list`). 줄을 펴면 읽는다. */
export const HISTORIES: Readonly<Record<string, readonly JobRunView[]>> = {
  [JOB_DIGEST]: [
    jobRun(101, JOB_DIGEST, "done", -21 * HOUR, {
      ...span(-21 * HOUR, 4 * MIN),
      run: id("run", 1),
      session: id("ses", 1),
    }),
    jobRun(102, JOB_DIGEST, "skipped", -2 * DAY, { reason: "overlap" }),
    jobRun(103, JOB_DIGEST, "failed", -3 * DAY, {
      ...span(-3 * DAY, 2 * MIN),
      run: id("run", 2),
      session: id("ses", 2),
    }),
    jobRun(104, JOB_DIGEST, "cancelled", -4 * DAY, {
      ...span(-4 * DAY, MIN),
      run: id("run", 3),
      session: id("ses", 3),
    }),
    jobRun(105, JOB_DIGEST, "interrupted", -5 * DAY, {
      started_at: at(-5 * DAY),
      run: id("run", 4),
      session: id("ses", 4),
    }),
  ],
  [JOB_REVIEW]: [
    jobRun(201, JOB_REVIEW, "held", -2 * DAY, { missed_count: 2 }),
    jobRun(202, JOB_REVIEW, "done", -9 * DAY, {
      ...span(-9 * DAY, 3 * DAY),
      instance: id("wfi", 1),
    }),
    jobRun(203, JOB_REVIEW, "skipped", -16 * DAY, { reason: "person" }),
    jobRun(204, JOB_REVIEW, "skipped", -23 * DAY, { reason: "superseded" }),
    jobRun(205, JOB_REVIEW, "failed", -30 * DAY, {
      reason: "not_found: Workflow weekly-review was not found in Phroner.",
      ended_at: at(-30 * DAY),
    }),
  ],
  [JOB_ORDERS]: [
    jobRun(301, JOB_ORDERS, "running", -MIN, {
      started_at: at(-40_000),
      run: id("run", 5),
    }),
    jobRun(302, JOB_ORDERS, "done", -31 * MIN, {
      ...span(-31 * MIN, MIN),
      run: id("run", 6),
    }),
    jobRun(303, JOB_ORDERS, "done", -4 * HOUR, {
      ...span(-3 * HOUR, MIN),
      missed_count: 3,
      run: id("run", 7),
    }),
  ],
  [JOB_BUDGET]: [
    jobRun(401, JOB_BUDGET, "failed", -9 * HOUR, {
      ...span(-9 * HOUR, 2 * MIN),
      run: id("run", 8),
      session: id("ses", 5),
    }),
    jobRun(402, JOB_BUDGET, "done", -33 * HOUR, {
      ...span(-33 * HOUR, 5 * MIN),
      run: id("run", 9),
      session: id("ses", 6),
    }),
  ],
  [JOB_BACKUP]: [
    jobRun(501, JOB_BACKUP, "queued", -20_000),
    jobRun(502, JOB_BACKUP, "done", -6 * HOUR, {
      ...span(-6 * HOUR, MIN),
      run: id("run", 10),
    }),
  ],
};

export { JOB_BACKUP, JOB_BUDGET, JOB_DIGEST, JOB_ORDERS, JOB_REVIEW };
