// ledger events 표(platform)에서 읽기가 쓰는 event를 읽는다. context 표가 아니라 읽기 전용이다.
import type { Sql } from "../../../contracts/platform/mod.ts";
import type { EmittedEvent } from "../api/state.ts";

type Reader = Pick<Sql, "get" | "all">;

// context가 위반을 Context Engineer에게 넘긴 event들(오래된 것부터). context.violations가
// handed_off를 정한다.
export function loadHandedOffEvents(
  sql: Reader,
  context: string,
): EmittedEvent[] {
  return sql.all(
    `SELECT seq, type, subject, actor, payload, at FROM events
      WHERE type = 'ContextViolationsHandedOff' AND subject = ? ORDER BY seq`,
    [context],
  ).map((row) => ({
    seq: String(row.seq),
    type: String(row.type),
    subject: String(row.subject),
    actor: String(row.actor),
    at: String(row.at),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
  }));
}
