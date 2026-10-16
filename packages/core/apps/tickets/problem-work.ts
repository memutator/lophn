import { err, ok, type Result } from "../../../base/mod.ts";
import type { TicketState } from "../../../protocol/coding-agent/ticket/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// 문제 상세가 읽는 문제의 지금 work ticket의 사실이다. state만 싣는다. claim·기한·session은
// 싣지 않는다. 없으면 null이다.
export function problemWorkLookup(
  sql: Pick<Sql, "get">,
  work: string | null,
): Result<{ state: TicketState } | null> {
  if (work === null) return ok(null);
  try {
    const row = sql.get("select state from tickets where id = ?", [work]);
    return ok(
      row === undefined ? null : { state: String(row.state) as TicketState },
    );
  } catch {
    return err({
      code: "unavailable",
      message: "work ticket could not be read",
    });
  }
}
