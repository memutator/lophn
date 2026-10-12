import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { RepairTicketFact } from "../../../protocol/problems/mod.ts";

// 문제 상세가 읽는 지금 수리 ticket의 사실이다(problems/grouping#R12, problems#T22). core 조립이
// `ProblemWorkPort`로 reader에 등록한다. 문제에 걸린 끝나지 않은 repair ticket은
// `ticket_open_repair_problems` 예약이 하나로 정한다(claim 전 open ticket 포함). 예약이 없으면 문제의
// `work` ticket을 읽고, 그것도 없으면 null이다. claim·기한·연결 식별자는 싣지 않는다.
const STATES: readonly RepairTicketFact["state"][] = [
  "open",
  "claimed",
  "reported",
  "confirmed",
  "check_failed",
  "cancelled",
];

export function problemWorkLookup(
  sql: Pick<Sql, "get" | "all">,
  problem: string,
  work: string | null,
): Result<RepairTicketFact | null> {
  try {
    const reserved = sql.get(
      `select ticket from ticket_open_repair_problems where problem = ?`,
      [problem],
    );
    const ticket = reserved === undefined ? work : String(reserved.ticket);
    if (ticket === null) return ok(null);
    const row = sql.get(
      `select state, readiness, needs from tickets where id = ? and kind = 'repair'`,
      [ticket],
    );
    if (row === undefined) return ok(null);
    const state = STATES.find((value) => value === row.state);
    const needs = JSON.parse(String(row.needs)) as unknown;
    if (
      state === undefined ||
      (row.readiness !== "ready" && row.readiness !== "needs_confirmation") ||
      !Array.isArray(needs) || !needs.every((item) => typeof item === "string")
    ) {
      return unreadable();
    }
    return ok({ state, readiness: row.readiness, needs });
  } catch {
    return unreadable();
  }
}

const unreadable = (): Result<never> =>
  err({ code: "unavailable", message: "repair ticket could not be read" });
