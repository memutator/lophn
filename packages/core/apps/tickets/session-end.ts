// coding session이 끝났을 때 그 session의 claim을 반납한다. 완료 보고가 없었으면 같은 tx에서
// `CodingSessionEndedUnreported`를 낸다. 보고가 있었으면 ticket은 reported로 남아 있다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { TicketSessionEnd } from "../../../protocol/coding-agent/ticket/mod.ts";
import { codingSessionEndedUnreported } from "../../../protocol/events/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { endClaim } from "./claims.ts";
import { loadClaim, loadTicket } from "./store.ts";

export function createTicketSessionEnd(tx: Tx): TicketSessionEnd {
  function settle(
    session: string,
  ): Result<{ ticket: string | null; reported: boolean }> {
    const held = tx.sql.all(
      "SELECT ticket FROM ticket_claims WHERE session = ? ORDER BY ticket",
      [session],
    ).map((row) => String(row.ticket));
    for (const id of held) {
      const ticket = loadTicket(tx.sql, id);
      if (!ticket.ok) return ticket;
      const claim = loadClaim(tx.sql, id);
      if (ticket.value === null || claim === null) continue;
      const ended = endClaim(tx, ticket.value, claim);
      if (!ended.ok) return ended;
      tx.emit(codingSessionEndedUnreported, session, {
        app: ticket.value.app,
        ticket: id,
      });
    }
    if (held.length > 0) return ok({ ticket: held[0]!, reported: false });
    const done = tx.sql.get(
      `SELECT ticket FROM ticket_completions WHERE session = ?
       ORDER BY CAST(seq AS INTEGER) DESC LIMIT 1`,
      [session],
    );
    return ok(
      done === undefined
        ? { ticket: null, reported: false }
        : { ticket: String(done.ticket), reported: true },
    );
  }

  return {
    settle,
    // 기동 때는 살아 있는 session이 없다. claim이 남은 모든 session을 정산한다.
    settleAll(): Result<number> {
      const sessions = tx.sql.all(
        "SELECT DISTINCT session FROM ticket_claims ORDER BY session",
        [],
      ).map((row) => String(row.session));
      for (const session of sessions) {
        const settled = settle(session);
        if (!settled.ok) return err(settled.error);
      }
      return ok(sessions.length);
    },
  };
}
