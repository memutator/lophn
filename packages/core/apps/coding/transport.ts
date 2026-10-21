// Router가 부르는 coding transport. 같은 tx 안에서 도는 동기 Result다. 터미널 요청은 commit 뒤로 보낸다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { canDeliverMessages } from "../../../protocol/coding-agent/harness-adapter.ts";
import { TERMINAL_INPUT_MAX_CHARS } from "../../../protocol/coding-agent/terminal-requests.ts";
import type {
  CodingSendRejection,
  CodingTransport,
} from "../../../protocol/coding-agent/transport.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { createCallStore } from "../../router/mod.ts";
import { revokeToken, sendTerminal } from "./events.ts";
import { deliverInput } from "./input.ts";
import { openSession, startFailure } from "./launch.ts";
import { codingLines } from "./lines.ts";
import type { CodingMemory } from "./memory.ts";
import {
  activeOf,
  activeOfCall,
  loadSession,
  pushInput,
  pushLine,
  removeLine,
  saveSession,
  stateOf,
} from "./store.ts";
import { loadTicket } from "../tickets/store.ts";

function rejected(reason: CodingSendRejection, message: string): Result<never> {
  return err({
    code: reason === "no_turn_end_signal" ? "unavailable" : "conflict",
    message,
    details: { reason },
  });
}

// `sql`은 lines()가 읽을 연결이다. 다른 메서드는 받은 tx를 쓴다.
export function createCodingTransport(
  memory: CodingMemory,
  sql: () => Pick<Sql, "get" | "all">,
): CodingTransport {
  return {
    start(tx, input) {
      const ticket = loadTicket(tx.sql, input.ticket);
      if (!ticket.ok) return ticket;
      if (
        ticket.value === null || ticket.value.app !== input.app ||
        !["open", "failed"].includes(ticket.value.state)
      ) {
        return startFailure(
          "ticket_unavailable",
          "the ticket cannot be assigned",
        );
      }
      const line = {
        call: input.call,
        app: input.app,
        ticket: input.ticket,
        options: input.options,
      };
      if (activeOf(tx.sql, input.app) !== null) {
        pushLine(tx.sql, line);
        return ok({ status: "queued" as const });
      }
      const opened = openSession(tx, memory, line);
      return opened.ok
        ? ok({ status: "started" as const, session: opened.value.session })
        : opened;
    },

    send(tx, input) {
      const row = loadSession(tx.sql, input.session);
      if (row === null || row.ended) {
        return rejected("session_ended", "the coding session ended");
      }
      if (!canDeliverMessages(row.harness)) {
        return rejected(
          "no_turn_end_signal",
          "this harness does not report when a turn ends",
        );
      }
      if (!row.heard) {
        return rejected("state_unknown", "the session state is not known yet");
      }
      if (input.text.length > TERMINAL_INPUT_MAX_CHARS) {
        return err({
          code: "invalid_input",
          message: "the message is too long",
        });
      }
      // 도는 중이거나 앞 메시지가 아직 turn으로 이어지지 않았으면 대기열에 두고 TurnEnded에 하나씩 넣는다.
      if (stateOf(row) !== "idle" || row.inflight) {
        pushInput(tx.sql, row.session, input.call, input.text);
        return ok({ status: "queued" as const });
      }
      deliverInput(tx, memory, row, input.call, input.text);
      saveSession(tx.sql, row);
      return ok({ status: "delivered" as const });
    },

    stop(tx, input) {
      // 줄에 있으면 줄에서만 뺀다.
      const waiting = removeLine(tx.sql, input.call);
      const row = waiting ? null : activeOfCall(tx.sql, input.call);
      if (!waiting && row === null) return ok(undefined);
      // ticket 취소는 Router를 거치지 않아 call을 여기서 취소한다. call cancel은 Router가 이미 했다.
      if (input.reason === "ticket_cancelled") {
        createCallStore().move(tx, input.call as never, "cancelled", null);
      }
      if (row === null) return ok(undefined);
      revokeToken(tx, row.session);
      const request = memory.request({ kind: "stop", session: row.session });
      sendTerminal(tx, { kind: "stop", request, session: row.session });
      return ok(undefined);
    },

    lines: () => codingLines(sql()),
  };
}
