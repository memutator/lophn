// job 제목 줄 draft의 fixture. run 기록(`runs/list`)의 새 칸 `job`(`sj-runs-job-origin`)과 workflow instance 요약의 새 칸
// `started_by`(`sj-workflows-job-start`)는 job id만 갖는다. 제목은 화면이 `job.list`를 읽어 job id로 붙이므로
// `JOB_TITLES`가 그 표다(`JobRecord`의 `id`·`title`). 지운 job의 id는 이 표에 없다.

export interface AgentRefView {
  readonly role: "lophn" | "project_manager" | "app_engineer" | "operator";
  readonly id?: string;
}

export type RunStateView = "running" | "done" | "failed" | "cancelled";

/** `RunRecordView`(run-list.tsx)에 `job` 칸을 더한 모양. */
export interface RunRecordView {
  readonly id: string;
  readonly kind: "agent" | "tool";
  readonly target:
    | { readonly agent: AgentRefView }
    | { readonly app: string; readonly tool: string };
  readonly session: string | null;
  readonly session_opened: boolean;
  readonly state: RunStateView;
  readonly created_at: string;
  /** job이 연 run이면 그 job id. */
  readonly job: string | null;
}

export type InstanceStartedBy =
  | { readonly kind: "user" }
  | { readonly kind: "job"; readonly job: string };

/** `WorkflowInstanceSummaryView`에 `started_by`를 더한 모양. */
export interface InstanceSummaryView {
  readonly id: string;
  readonly project: string;
  readonly workflow: string;
  readonly state: "running" | "ended" | "stopped";
  readonly current:
    | { readonly step: string; readonly human_turn: boolean }
    | null;
  readonly input: string;
  readonly started_by: InstanceStartedBy;
  readonly created_at: string;
  readonly finished_at: string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;

const GROCERY = id("prj", 1);
const ORDERS = id("app", 1);

const DIGEST = id("job", 1);
const REVIEW = id("job", 2);
const REFRESH = id("job", 3);
const BACKUPS = id("job", 5);
const METRICS = id("job", 6);
/** 지운 job. 표에 없다. */
const DELETED = id("job", 9);

export const JOB_TITLES: Readonly<Record<string, string>> = {
  [DIGEST]: "Morning digest",
  [REVIEW]: "Weekly review",
  [REFRESH]: "Refresh stale orders",
  [BACKUPS]: "Check backups",
  [METRICS]: "Nightly metrics",
};

export const OPERATOR = id("agt", 1);

export const AGENT_NAMES = {
  lophn: "lophn",
  project_manager: "Project Manager",
  app_engineer: "App Engineer",
} as const;
export const OPERATOR_NAME = "Eval analyst";

export const SESSION_TITLES: Readonly<Record<string, string>> = {
  [id("ses", 1)]: "Digest for Tuesday",
  [id("ses", 2)]: "Plan the next experiment",
  [id("ses", 3)]: "Backup check",
};

const agent = (
  n: number,
  who: AgentRefView,
  state: RunStateView,
  age: number,
  fields: Partial<RunRecordView> = {},
): RunRecordView => ({
  id: id("run", n),
  kind: "agent",
  target: { agent: who },
  session: null,
  session_opened: false,
  state,
  created_at: ago(age),
  job: null,
  ...fields,
});

const tool = (
  n: number,
  name: string,
  state: RunStateView,
  age: number,
  job: string | null,
): RunRecordView => ({
  id: id("run", n),
  kind: "tool",
  target: { app: ORDERS, tool: name },
  session: null,
  session_opened: false,
  state,
  created_at: ago(age),
  job,
});

const PM: AgentRefView = { role: "project_manager", id: GROCERY };

/** project sidebar의 Background. 새것이 앞이다. */
export const SIDEBAR_RUNS: readonly RunRecordView[] = [
  agent(1, PM, "running", 4 * MIN, {
    job: DIGEST,
    session: id("ses", 1),
    session_opened: true,
  }),
  agent(2, PM, "done", 40 * MIN),
  agent(3, { role: "operator", id: OPERATOR }, "failed", 3 * HOUR, {
    job: METRICS,
  }),
  agent(4, { role: "lophn" }, "done", 8 * HOUR, {
    session: id("ses", 2),
    session_opened: true,
  }),
  agent(5, PM, "cancelled", DAY, { job: DELETED }),
];

/** 앱 공간(Orders)의 Background. tool run과 이 앱의 App Engineer run이다. */
export const APP_RUNS: readonly RunRecordView[] = [
  tool(11, "refresh_stale", "running", 40_000, REFRESH),
  agent(12, { role: "app_engineer", id: ORDERS }, "done", 2 * HOUR, {
    job: BACKUPS,
    session: id("ses", 3),
    session_opened: true,
  }),
  tool(13, "refresh_stale", "done", 5 * HOUR, null),
  tool(14, "refresh_stale", "failed", DAY, DELETED),
];

const instance = (
  n: number,
  state: InstanceSummaryView["state"],
  age: number,
  input: string,
  started_by: InstanceStartedBy,
  current: InstanceSummaryView["current"] = null,
): InstanceSummaryView => ({
  id: id("wfi", n),
  project: GROCERY,
  workflow: "weekly-review",
  state,
  current,
  input,
  started_by,
  created_at: ago(age),
  finished_at: state === "running" ? null : ago(age - 2 * HOUR),
});

/** workflow 탭의 instance 목록. 새것이 앞이다. */
export const INSTANCES: readonly InstanceSummaryView[] = [
  instance(
    1,
    "running",
    20 * MIN,
    "Review last week's experiments and propose next steps.",
    { kind: "job", job: REVIEW },
    { step: "draft", human_turn: false },
  ),
  instance(2, "ended", 2 * DAY, "Compare the q8 and q4 runs.", {
    kind: "user",
  }),
  instance(
    3,
    "ended",
    9 * DAY,
    "Review last week's experiments and propose next steps.",
    { kind: "job", job: DELETED },
  ),
  instance(
    4,
    "stopped",
    16 * DAY,
    "Review last week's experiments and propose next steps.",
    { kind: "job", job: REVIEW },
  ),
];
