import { err, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import { REPORTING_LIMITS } from "../../../protocol/problems/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// 접수 공통 값: 재전송 비교(R9)와 접수 창(R12).
const CONFLICT = "같은 Report ID의 원주체나 내용이 다르다";
const WINDOW = "접수 빈도 한도를 넘는다";

export type ProblemState = "open" | "fixing" | "closed";

export type ProblemRow = {
  id: string;
  app: string;
  group_key: string;
  status: ProblemState;
  work: string | null;
  closure: string | null;
};

// (app, group_key) unique는 상태와 무관하게 같은 문제를 찾는다(grouping#R10).
// 닫힌 문제도 같은 key로 찾고 기간 상한이 없다.
export function findProblem(
  sql: Pick<Tx["sql"], "get">,
  app: string,
  key: string,
): ProblemRow | null {
  const row = sql.get(
    `select id, app, group_key, status, work, closure
     from problems where app = ? and group_key = ?`,
    [app, key],
  );
  if (row === undefined) return null;
  return {
    id: String(row.id),
    app: String(row.app),
    group_key: String(row.group_key),
    status: String(row.status) as ProblemState,
    work: row.work === null ? null : String(row.work),
    closure: row.closure === null ? null : String(row.closure),
  };
}

// 같은 ID·principal·content hash 재전송은 원래 결과(R9). 비교는 접수 행의
// content_hash와 principal 둘이다.
export function findReport(
  sql: Pick<Tx["sql"], "get">,
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

// R12: event envelope 시각 기준 앱당 window_ms 안 새 Report 상한. 같은 ID
// 재전송은 세지 않고 observed_at은 이 창과 무관하다(architecture §2.3).
export function reportsInWindow(
  sql: Pick<Tx["sql"], "all">,
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
