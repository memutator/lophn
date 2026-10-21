// 앱마다 줄. 앞 session이 끝나면 다음 call을 연다. 줄은 ledger 표에 있고 켤 때 recover가 비운다.
import { ok, type Result } from "../../../base/mod.ts";
import type { CodingAppLine } from "../../../protocol/coding-agent/transport.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { createCallStore } from "../../router/mod.ts";
import { closeCall } from "./close-call.ts";
import { openSession } from "./launch.ts";
import type { CodingMemory } from "./memory.ts";
import { activeOf, allLines, shiftLine } from "./store.ts";

export function codingLines(sql: Pick<Sql, "get" | "all">): CodingAppLine[] {
  const apps = new Map<string, CodingAppLine>();
  const lineOf = (app: string) => {
    let line = apps.get(app);
    if (line === undefined) {
      line = { app, active: null, waiting: [] };
      apps.set(app, line);
    }
    return line;
  };
  for (
    const row of sql.all(
      "SELECT app, session, ticket, call FROM coding_sessions WHERE ended = 0",
      [],
    )
  ) {
    lineOf(String(row.app)).active = {
      session: String(row.session),
      ticket: String(row.ticket),
      call: String(row.call) as never,
    };
  }
  for (const waiting of allLines(sql)) {
    lineOf(waiting.app).waiting.push({
      call: waiting.call as never,
      ticket: waiting.ticket,
    });
  }
  return [...apps.values()];
}

// 앞 session이 끝났다. 줄 맨 앞부터 띄우고, 못 띄우는 call은 닫고 다음 것을 본다.
export function openNext(
  tx: Tx,
  memory: CodingMemory,
  app: string,
): Result<void> {
  if (activeOf(tx.sql, app) !== null) return ok(undefined);
  for (;;) {
    const line = shiftLine(tx.sql, app);
    if (line === null) return ok(undefined);
    const record = createCallStore().read(tx, line.call as never);
    if (record === null || record.state !== "accepted") continue;
    const opened = openSession(tx, memory, line);
    if (opened.ok) {
      // 줄에서 기다리던 call이 이제 받는 session을 갖는다.
      return createCallStore().setReceiver(
        tx,
        line.call as never,
        opened.value.session as never,
      );
    }
    const closed = closeCall(tx, {
      call: line.call,
      event: "CodingSessionEndedUnreported",
      seq: "0",
      session: null,
      ticket: line.ticket,
      app,
    });
    if (!closed.ok) return closed;
  }
}
