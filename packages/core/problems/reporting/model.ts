import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import {
  problemGroupKeySchema,
  type ProblemRecord,
  type ProblemState,
  REPORTING_LIMITS,
} from "../../../protocol/problems/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// 접수 공통 값: 재전송 비교와 접수 창.
const CONFLICT = "같은 Report ID의 원주체나 내용이 다르다";
const WINDOW = "접수 빈도 한도를 넘는다";
const BROKEN = "저장된 문제를 읽을 수 없다";

export type { ProblemState };

export type ProblemRow = {
  id: string;
  app: string;
  group_key: string;
  name: string;
  state: ProblemState;
  state_changed_at: string;
  seq: string;
  recurred_resolved_at: string | null;
  recurred_release: string | null;
};

const PROBLEM_COLUMNS =
  `id, app, group_key, name, state, state_changed_at, seq,
   recurred_resolved_at, recurred_release`;

const text = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

function problemRowOf(row: Record<string, unknown>): ProblemRow {
  return {
    id: String(row["id"]),
    app: String(row["app"]),
    group_key: String(row["group_key"]),
    name: String(row["name"]),
    state: String(row["state"]) as ProblemState,
    state_changed_at: String(row["state_changed_at"]),
    seq: String(row["seq"]),
    recurred_resolved_at: text(row["recurred_resolved_at"]),
    recurred_release: text(row["recurred_release"]),
  };
}

// (app, group_key) unique는 상태와 무관하게 같은 문제를 찾는다.
// 해결된 문제도 같은 key로 찾고 기간 상한이 없다.
export function findProblem(
  sql: Pick<Sql, "get">,
  app: string,
  key: string,
): ProblemRow | null {
  const row = sql.get(
    `select ${PROBLEM_COLUMNS} from problems where app = ? and group_key = ?`,
    [app, key],
  );
  return row === undefined ? null : problemRowOf(row);
}

export function loadProblem(
  sql: Pick<Sql, "get">,
  id: string,
): ProblemRow | null {
  const row = sql.get(`select ${PROBLEM_COLUMNS} from problems where id = ?`, [
    id,
  ]);
  return row === undefined ? null : problemRowOf(row);
}

// 저장된 행을 계약의 ProblemRecord로 옮긴다. group_key가 깨졌으면 internal이다.
export function problemRecordOf(row: ProblemRow): Result<ProblemRecord> {
  try {
    const key = problemGroupKeySchema.safeParse(JSON.parse(row.group_key));
    if (key.success) {
      return ok({
        id: row.id,
        app: row.app,
        group_key: key.data,
        name: row.name,
        state: row.state,
        state_changed_at: row.state_changed_at,
        seq: row.seq,
        recurred: row.recurred_resolved_at === null ||
            row.recurred_release === null
          ? null
          : {
            resolved_at: row.recurred_resolved_at,
            release: row.recurred_release,
          },
      } as ProblemRecord);
    }
  } catch {
    // 깨진 JSON도 같은 내부 오류다.
  }
  return err({ code: "internal", message: BROKEN });
}

type ReopenDecision = "reopen" | "accumulate";

// live 발생이 이미 있는 문제에 붙을 때 다시 열지 쌓기만 할지 정한다. 해결됨인 문제만, 그리고 발생의
// release가 해결된 뒤에 활성화됐을 때만 다시 연다. 무시 중인 문제는 재발해도 열지 않고, release를
// 모르면(null) 쌓기만 한다. 시각은 모두 같은 형식의 At이라 글자 순서가 시간 순서다.
export function reopenDecision(
  problem: { state: ProblemState; state_changed_at: string },
  releaseActivatedAt: string | null,
): ReopenDecision {
  return problem.state === "resolved" && releaseActivatedAt !== null &&
      releaseActivatedAt > problem.state_changed_at
    ? "reopen"
    : "accumulate";
}

// 같은 ID·principal·content hash 재전송은 원래 결과. 비교는 접수 행의
// content_hash와 principal 둘이다.
export function findReport(
  sql: Pick<Sql, "get">,
  report: string,
): { principal: string; content_hash: string } | null {
  const row = sql.get(
    "select principal, content_hash from reports where id = ?",
    [report],
  );
  if (row === undefined) return null;
  return {
    principal: String(row.principal),
    content_hash: String(row.content_hash),
  };
}

export function conflict(): Result<never, LophnError> {
  return err({ code: "conflict", message: CONFLICT });
}

export function windowLimit(): Result<never, LophnError> {
  return err({ code: "unavailable", message: WINDOW });
}

// event envelope 시각 기준 앱당 window_ms 안 새 Report 상한. 같은 ID
// 재전송은 세지 않고 observed_at은 이 창과 무관하다(architecture §2.3).
export function reportsInWindow(
  sql: Pick<Sql, "all">,
  app: string,
  windowMs: number,
  nowMs: number,
): string[] {
  const rows = sql.all(
    `select id from reports
     where app = ? and cast(strftime('%s', observed_at) as integer) * 1000 > ?`,
    [app, nowMs - windowMs],
  );
  return rows.map((row) => String(row.id));
}

export function windowBounds(): {
  windowMs: number;
  maxNew: number;
} {
  return {
    windowMs: REPORTING_LIMITS.window_ms,
    maxNew: REPORTING_LIMITS.new_reports_per_window,
  };
}
