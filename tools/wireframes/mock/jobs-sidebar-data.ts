// project sidebar의 Scheduled jobs panel draft의 fixture. 칸 이름과 값은 `sj-jobs-contract`의 `JobRecord`와 같고 id만 문자열이다.
// 승인 뒤 `sj-shell-jobs-sidebar`가 이 interface를 renderer `source.ts`의 type으로 옮긴다.

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

export type JobRunState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "held"
  | "skipped"
  | "interrupted";

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

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;

/** 창이 열려 있는 project. */
export const PROJECT = { id: id("prj", 2), title: "phroner" };
const GROCERY = id("prj", 1);

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

const last = (n: number, state: JobRunState, due: number) => ({
  job_run: id("jbr", n),
  state,
  due_at: at(due),
  started_at: state === "held" ? null : at(due),
  ended_at: state === "held" ? null : at(due + 4 * MIN),
});

/** 다섯 중 넷이 phroner의 job이다. 마지막(Grocery)은 걸리지 않아 panel에 보이지 않아야 한다. */
export const JOBS: readonly JobView[] = [
  // 이 project의 PM이 만들었다(creator).
  job(1, {
    title: "Weekly review",
    creator: { role: "project_manager", project: PROJECT.id },
    every: "7d",
    at: "10:00",
    action: {
      kind: "workflow_start",
      project: PROJECT.id,
      workflow: "weekly-review",
      text: "Review last week's experiments and propose next steps.",
    },
    missed_policy: "run",
    next_due_at: at(4 * DAY),
    last_run: last(101, "done", -3 * DAY),
  }),
  // lophn이 만들고 이 project의 PM을 부른다(action.agent_place). 놓친 차례가 hold로 기다린다.
  job(2, {
    title: "Morning digest",
    creator: { role: "lophn" },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: { role: "project_manager", project: PROJECT.id },
      agent_place: { kind: "project", id: PROJECT.id },
      prompt:
        "Summarize yesterday's finished tasks and list the open questions for today.",
    },
    missed_policy: "hold",
    next_due_at: at(3 * HOUR),
    last_run: last(201, "held", -2 * HOUR),
  }),
  // 이 project의 Operator를 부른다. 꺼져 있다.
  job(3, {
    title: "Bookkeeping notes",
    creator: { role: "lophn" },
    every: "1d",
    at: "23:30",
    action: {
      kind: "agent_run",
      agent: { role: "operator", agent: id("agt", 1) },
      agent_place: { kind: "project", id: PROJECT.id },
      prompt: "Write today's bookkeeping notes for the project.",
    },
    missed_policy: "hold",
    enabled: false,
    last_run: last(301, "done", -9 * HOUR),
  }),
  // lophn이 만들고 이 project의 workflow를 시작한다(action.project). 마지막 결과가 failed다.
  job(4, {
    title: "Nightly eval run",
    creator: { role: "lophn" },
    every: "1d",
    at: "02:00",
    action: {
      kind: "workflow_start",
      project: PROJECT.id,
      workflow: "eval-run",
      text: "Run the nightly evaluation and post the scores.",
    },
    missed_policy: "run",
    next_due_at: at(11 * HOUR),
    last_run: last(401, "failed", -13 * HOUR),
  }),
  // 다른 project의 job. 어느 걸림에도 맞지 않는다.
  job(5, {
    title: "Grocery price check",
    creator: { role: "project_manager", project: GROCERY },
    every: "6h",
    at: null,
    action: {
      kind: "agent_run",
      agent: { role: "project_manager", project: GROCERY },
      agent_place: { kind: "project", id: GROCERY },
      prompt: "Compare this week's prices and flag big changes.",
    },
    missed_policy: "run",
    next_due_at: at(2 * HOUR),
    last_run: last(501, "done", -4 * HOUR),
  }),
];
