// coding agent가 CLI로 보낸 메시지를 맡긴 App Engineer("열린 session, 없으면 새 session")에게 넣는다.
// session 기록 밖의 ledger에는 쓰지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { CallRef } from "../../../../protocol/lophn-agent/calls.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { createCallStore, routerFor } from "../../../router/mod.ts";
import { loadSession } from "./store.ts";

export function applyMessage(tx: Tx, input: {
  session: string;
  body: string;
  tickets: readonly string[];
}): Result<void> {
  const row = loadSession(tx.sql, input.session);
  if (row === null || row.ended) {
    return err({ code: "forbidden", message: "the coding session ended" });
  }
  const call = createCallStore().read(tx, row.call as never);
  if (call === null || call.from.kind !== "agent") {
    return err({
      code: "unavailable",
      message: "the assigning session is gone",
    });
  }
  const router = routerFor(tx);
  if (!router.ok) return router;
  const refs = [
    { kind: "session", session: row.session },
    ...[row.ticket, ...input.tickets].map((ticket) => ({
      kind: "ticket",
      ticket,
    })),
  ] as CallRef[];
  const routed = router.value.route(tx, {
    from: { kind: "coding_agent", session: row.session },
    to: {
      kind: "open_session_or_new",
      session: call.from.session,
      agent: { role: "app_engineer", app: row.app },
    } as never,
    reply: "none",
    body: input.body,
    refs,
    reply_to: null,
    dedup: null,
    options: null,
    kind: "call",
    delivery: "next_turn",
  });
  if (!routed.ok) return routed;
  return routed.value.state === "failed"
    ? err({ code: "unavailable", message: "the message was not delivered" })
    : ok(undefined);
}
