// Tasks 탭 테스트의 가짜 통로. core·main을 부르지 않고 부른 것을 기록한다. 상태·다음 행동은 coding-agent가
// 정한 값 그대로이고 화면은 이것을 wording key 문구로 바꿔 보여야 한다.
import type {
  SourceResult,
  StartChoices,
  StartOutcome,
  StartPress,
  TaskDetail,
  TaskDraft,
  TaskRow,
  TasksSource,
  TuiSession,
} from "../source.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
export const TKT_READY = "tkt_01h455vb4pex5v6nkc6gd5fd01";
export const TKT_WORKING = "tkt_01h455vb4pex5v6nkc6gd5fd02";
export const TKT_REPORTED = "tkt_01h455vb4pex5v6nkc6gd5fd03";
export const TKT_CONFIRMED = "tkt_01h455vb4pex5v6nkc6gd5fd04";
export const TKT_FAILED = "tkt_01h455vb4pex5v6nkc6gd5fd05";
export const TKT_CANCELLED = "tkt_01h455vb4pex5v6nkc6gd5fd06";
export const TKT_PREPARING = "tkt_01h455vb4pex5v6nkc6gd5fd07";
export const CAC_DESK = "cac_01h455vb4pex5v6nkc6gd5fd01";
export const PRJ = "prj_01h455vb4pex5v6nkc6gd5fd01";

export const NOW = new Date("2026-10-07T12:00:00Z");
export const now = () => NOW;

export function row(
  over: Partial<TaskRow> & Pick<TaskRow, "id" | "state">,
): TaskRow {
  return {
    app: APP,
    kind: "implementation",
    title: "Add a receipt filter",
    request: "Let me filter receipts by month.",
    problemCount: 0,
    next: null,
    ...over,
  };
}

export const ROWS: readonly TaskRow[] = [
  row({ id: TKT_READY, state: "ready", next: "start" }),
  row({
    id: TKT_PREPARING,
    state: "needs_confirmation",
    next: "needs_confirmation",
    title: "Export totals",
  }),
  row({ id: TKT_WORKING, state: "in_progress", title: "Fix the totals" }),
  row({
    id: TKT_REPORTED,
    state: "reported",
    next: "waiting_for_approval",
    title: "Add dark mode",
  }),
  row({
    id: TKT_CONFIRMED,
    state: "confirmed",
    next: "check_result",
    title: "Rename categories",
  }),
  row({
    id: TKT_FAILED,
    state: "check_failed",
    next: "start",
    title: "Sort by date",
  }),
  row({ id: TKT_CANCELLED, state: "cancelled", title: "Old idea" }),
];

export function detail(
  over: Partial<TaskDetail> & Pick<TaskDetail, "id" | "state">,
): TaskDetail {
  return {
    ...row(over),
    why: "I keep scrolling too much.",
    needs: [],
    revision: "12",
    heldUntil: null,
    conditions: [
      { position: 0, kind: "app_test" },
      { position: 1, kind: "human_confirmation" },
    ],
    reported: false,
    checks: [],
    remaining: [],
    ...over,
  };
}

export const STARTABLE: StartChoices = {
  harnesses: [{ id: "claude", profile: null }],
  connections: [{ id: CAC_DESK, label: "Desk Claude" }],
  folders: [{
    project: PRJ,
    project_name: "Notes",
    folder_ref: `${PRJ}_0`,
    path: "/work/notes",
  }],
};

export interface FakeTasksOptions {
  list?: SourceResult<readonly TaskRow[]>;
  details?: Record<string, SourceResult<TaskDetail>>;
  choices?: SourceResult<StartChoices>;
  sessions?: SourceResult<readonly TuiSession[]>;
  start?: SourceResult<StartOutcome>;
  cancel?: SourceResult<null>;
  create?: SourceResult<{ ticket: string }>;
}

export interface FakeTasks {
  readonly source: TasksSource;
  readonly calls: {
    list: string[];
    get: string[];
    start: StartPress[];
    cancel: { ticket: string; revision: string; reason: string }[];
    create: { app: string; draft: TaskDraft }[];
  };
  /** 다음 sessions 읽기가 돌려줄 값을 바꾼다. */
  setSessions(next: readonly TuiSession[]): void;
}

export function fakeTasks(options: FakeTasksOptions = {}): FakeTasks {
  const calls: FakeTasks["calls"] = {
    list: [],
    get: [],
    start: [],
    cancel: [],
    create: [],
  };
  let sessions: SourceResult<readonly TuiSession[]> = options.sessions ??
    { ok: true, value: [] };
  const source: TasksSource = {
    list(app) {
      calls.list.push(app);
      return Promise.resolve(options.list ?? { ok: true, value: ROWS });
    },
    get(ticket) {
      calls.get.push(ticket);
      const found = options.details?.[ticket];
      if (found !== undefined) return Promise.resolve(found);
      const base = ROWS.find((item) => item.id === ticket);
      return Promise.resolve(
        base === undefined
          ? { ok: false, code: "not_found" }
          : { ok: true, value: detail({ ...base }) },
      );
    },
    startChoices: () =>
      Promise.resolve(options.choices ?? { ok: true, value: STARTABLE }),
    sessions: () => Promise.resolve(sessions),
    start(press) {
      calls.start.push(press);
      return Promise.resolve(
        options.start ?? { ok: true, value: { ok: true } },
      );
    },
    cancel(ticket, revision, reason) {
      calls.cancel.push({ ticket, revision, reason });
      return Promise.resolve(options.cancel ?? { ok: true, value: null });
    },
    create(app, draft) {
      calls.create.push({ app, draft });
      return Promise.resolve(
        options.create ?? { ok: true, value: { ticket: TKT_PREPARING } },
      );
    },
  };
  return {
    source,
    calls,
    setSessions: (next) => {
      sessions = { ok: true, value: next };
    },
  };
}
