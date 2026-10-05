import { dueTimes, formatAt, ok, type Result } from "../../base/mod.ts";
import type {
  Schedule,
  ScheduleOccurrence,
} from "../../contracts/lophn-agent/mod.ts";
import type { SqlParams, SqlRow } from "../../contracts/platform/mod.ts";

// 회차 계산과 기록 row의 화면 값. 순수 함수와 읽기 조회만 있다. 예정 시점 산술은
// 앱 runtime scheduler와 같은 packages/base의 dueTimes 하나를 쓴다(R2).

// 지금 처리할 회차와 그 앞에서 몰아 접수하지 않은 구간(R6).
export type Round = {
  due_at: string;
  missed_first_at: string | null;
  missed_last_at: string | null;
  missed_count: number;
};

// now까지 미처리 예정 시점 중 가장 최근 하나와 그 앞 놓친 구간. 처리할 회차가 없으면
// null이다. 모델도 시계도 부르지 않고 시각은 인자로 받는다.
export function roundFor(
  schedule: Schedule,
  lastDueAt: string | null,
  now: string,
): Result<Round | null> {
  const due = dueTimes({
    first_at: schedule.first_at,
    every_ms: schedule.every_ms,
    last_due_at: lastDueAt,
    now,
  });
  if (!due.ok) return due;
  const latest = due.value.latest_due_at;
  if (latest === null) return ok(null);
  const missed = due.value.missed_count;
  // 놓친 회차는 직전 처리 시점 다음부터 이번 회차 바로 앞까지 연속이다.
  const first = missed === 0
    ? null
    : lastDueAt === null
    ? schedule.first_at
    : formatAt(Date.parse(lastDueAt) + schedule.every_ms);
  const last = missed === 0
    ? null
    : formatAt(Date.parse(latest) - schedule.every_ms);
  return ok({
    due_at: latest,
    missed_first_at: first,
    missed_last_at: last,
    missed_count: missed,
  });
}

// now 뒤 첫 예정 시점. 시계가 다음에 깨어날 시각이다.
export function nextDueAt(
  schedule: Schedule,
  lastDueAt: string | null,
  now: string,
): Result<string> {
  const due = dueTimes({
    first_at: schedule.first_at,
    every_ms: schedule.every_ms,
    last_due_at: lastDueAt,
    now,
  });
  return due.ok ? ok(due.value.next_due_at) : due;
}

export function sameRound(a: Round, b: Round): boolean {
  return a.due_at === b.due_at && a.missed_first_at === b.missed_first_at &&
    a.missed_last_at === b.missed_last_at && a.missed_count === b.missed_count;
}

// 끝나지 않은 run(R5). 질문·approval 대기(waiting_user)도 겹침이다.
export const UNFINISHED_RUN_STATES = [
  "accepted",
  "running",
  "waiting_user",
] as const;

export const OCCURRENCE_COLUMNS =
  `assignment_id, assignment_revision, due_at, previous_due_at, outcome, run_id,
  skip_reason, blocking_runs, missed_first_at, missed_last_at, missed_count,
  event_seq`;

export type OccurrenceRow = {
  assignment_id: string;
  assignment_revision: number;
  due_at: string;
  previous_due_at: string | null;
  outcome: "accepted" | "skipped";
  run_id: string | null;
  skip_reason: "unfinished_run" | null;
  blocking_runs: string;
  missed_first_at: string | null;
  missed_last_at: string | null;
  missed_count: number;
  event_seq: string;
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function rowOf(row: SqlRow): OccurrenceRow {
  return {
    assignment_id: String(row["assignment_id"]),
    assignment_revision: Number(row["assignment_revision"]),
    due_at: String(row["due_at"]),
    previous_due_at: text(row["previous_due_at"]),
    outcome: String(row["outcome"]) as OccurrenceRow["outcome"],
    run_id: text(row["run_id"]),
    skip_reason: text(row["skip_reason"]) as OccurrenceRow["skip_reason"],
    blocking_runs: String(row["blocking_runs"]),
    missed_first_at: text(row["missed_first_at"]),
    missed_last_at: text(row["missed_last_at"]),
    missed_count: Number(row["missed_count"]),
    event_seq: String(row["event_seq"]),
  };
}

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

export function loadOccurrence(
  lookup: Lookup,
  assignment: string,
  revision: number,
  dueAt: string,
): OccurrenceRow | undefined {
  const row = lookup.sql.get(
    `select ${OCCURRENCE_COLUMNS} from assignment_schedule_occurrences
     where assignment_id = ? and assignment_revision = ? and due_at = ?`,
    [assignment, revision, dueAt],
  );
  return row === undefined ? undefined : rowOf(row);
}

export function recordOf(row: OccurrenceRow): ScheduleOccurrence {
  return {
    assignment: row.assignment_id,
    assignment_revision: row.assignment_revision,
    previous_due_at: row.previous_due_at,
    due_at: row.due_at,
    missed_first_at: row.missed_first_at,
    missed_last_at: row.missed_last_at,
    missed_count: row.missed_count,
    outcome: row.outcome,
    run: row.run_id,
    skip_reason: row.skip_reason,
    blocking_runs: JSON.parse(row.blocking_runs) as string[],
  };
}
