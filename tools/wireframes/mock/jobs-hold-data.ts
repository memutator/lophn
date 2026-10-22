// hold card draft의 fixture. 칸 이름과 값은 `sj-jobs-contract`의 `JobHold`(`{job: JobRecord, job_run: JobRunRecord}`)와 같고
// id만 문자열이다. 승인 뒤 `sj-shell-hold-card`가 protocol `JobHold` type으로 바꿔도 값이 그대로 맞는다.
// 대기 목록은 앱·project 이름을 모르므로 카드는 짧은 id를 그린다.

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

export interface JobHoldView {
  readonly job: JobView;
  readonly job_run: JobRunView;
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

function hold(
  n: number,
  due: number,
  missed: number,
  job: Pick<
    JobView,
    "title" | "creator" | "every" | "at" | "action" | "next_due_at"
  >,
): JobHoldView {
  const jobId = id("job", n);
  const jobRunId = id("jbr", n);
  return {
    job: {
      id: jobId,
      ...job,
      missed_policy: "hold",
      enabled: true,
      last_run: {
        job_run: jobRunId,
        state: "held",
        due_at: at(due),
        started_at: null,
        ended_at: null,
      },
      created_at: at(-30 * DAY),
      updated_at: at(-2 * DAY),
    },
    job_run: {
      id: jobRunId,
      job: jobId,
      due_at: at(due),
      missed_count: missed,
      state: "held",
      reason: null,
      run: null,
      instance: null,
      session: null,
      started_at: null,
      ended_at: null,
      created_at: at(due + 5 * MIN),
    },
  };
}

/** lophn이 만든 agent 호출. 한 번 놓쳤다. */
export const HOLD_AGENT = hold(11, -9 * HOUR, 1, {
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
  next_due_at: at(15 * HOUR),
});

/** Project Manager가 만든 workflow 시작. 세 번 놓쳤다. */
export const HOLD_WORKFLOW = hold(12, -2 * DAY, 3, {
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
  next_due_at: at(4 * DAY),
});

/** App Engineer가 만든 앱 tool 호출. 한 번 놓쳤다. */
export const HOLD_TOOL = hold(13, -6 * HOUR, 1, {
  title: "Archive old orders",
  creator: { role: "app_engineer", app: ORDERS },
  every: "12h",
  at: null,
  action: {
    kind: "tool_run",
    app: ORDERS,
    tool: "archive_old",
    input: { older_than_days: 90 },
  },
  next_due_at: at(6 * HOUR),
});
