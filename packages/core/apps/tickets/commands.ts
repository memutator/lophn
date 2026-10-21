// ticket 만들기·고치기·확인·취소. App Engineer가 만들고 고치고 확인(verify)하고 취소하며,
// 확인됨은 App Engineer가 정한다. program은 판정하지 않는다.
import { createHash } from "node:crypto";
import { canonicalize, ok, type Result } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import {
  ticketCancel,
  ticketCreate,
  ticketUpdate,
  ticketVerify,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import type { TicketEvidence } from "../../../protocol/coding-agent/ticket/mod.ts";
import { ticketVerified } from "../../../protocol/events/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { addRef, removeRefs } from "../annotations/retention.ts";
import {
  agentActor,
  cancelActorAllowed,
  checkApp,
  conflict,
  forbidden,
  invalid,
  nextRevision,
  notFound,
  revisionAgrees,
} from "./model.ts";
import { TicketEvidenceLookup } from "./ports.ts";
import { loadTicket } from "./store.ts";

const CLOSED = ["verified", "cancelled"];

export function createTicketCommands(): {
  create: CommandDefinition<typeof ticketCreate>;
  update: CommandDefinition<typeof ticketUpdate>;
  verify: CommandDefinition<typeof ticketVerify>;
  cancel: CommandDefinition<typeof ticketCancel>;
} {
  return {
    create: {
      route: ticketCreate,
      handle(tx, ctx, input) {
        if (!agentActor(ctx.actor)) {
          return forbidden("only an App Engineer creates tickets");
        }
        const scope = checkApp(tx.port, ctx, input.app);
        if (!scope.ok) return scope;
        const registered = tx.port(appRegistrationLookup).get(input.app);
        if (!registered.ok) return registered;
        if (registered.value === null) return notFound("app does not exist");
        const evidence = input.evidence ?? [];
        const checked = checkEvidence(tx, input.app, evidence);
        if (!checked.ok) return checked;
        const id = tx.newId("tkt");
        tx.sql.run(
          `INSERT INTO tickets (id, app, state, goal, acceptance_check, revision)
           VALUES (?, ?, 'open', ?, ?, '1')`,
          [id, input.app, input.goal, JSON.stringify(input.check)],
        );
        evidence.forEach((item, position) => {
          tx.sql.run(
            `INSERT INTO ticket_references (ticket, position, kind, target)
             VALUES (?, ?, ?, ?)`,
            [
              id,
              position,
              item.kind,
              item.kind === "file" ? item.path : item.id,
            ],
          );
          // 근거 annotation은 이 ticket이 있는 동안 sweep에 지워지지 않는다.
          if (item.kind === "annotation") {
            addRef(tx.sql, item.id, "ticket", id);
          }
        });
        return ok({ ticket: id, state: "open" as const, revision: "1" });
      },
    },
    update: {
      route: ticketUpdate,
      handle(tx, ctx, input) {
        if (!agentActor(ctx.actor)) {
          return forbidden("only an App Engineer updates tickets");
        }
        const loaded = loadTicket(tx.sql, input.ticket);
        if (!loaded.ok) return loaded;
        const stored = loaded.value;
        if (stored === null) return notFound("ticket does not exist");
        const scope = checkApp(tx.port, ctx, stored.app);
        if (!scope.ok) return scope;
        if (CLOSED.includes(stored.state)) {
          return conflict("a closed ticket cannot be edited");
        }
        const revision = nextRevision(stored.revision);
        tx.sql.run(
          `UPDATE tickets SET goal = COALESCE(?, goal),
             acceptance_check = COALESCE(?, acceptance_check), revision = ?
           WHERE id = ?`,
          [
            input.goal ?? null,
            input.check === undefined ? null : JSON.stringify(input.check),
            revision,
            input.ticket,
          ],
        );
        return ok({ ticket: input.ticket, revision });
      },
    },
    verify: {
      route: ticketVerify,
      handle(tx, ctx, input, compare) {
        if (!agentActor(ctx.actor)) {
          return forbidden("only an App Engineer verifies tickets");
        }
        const loaded = loadTicket(tx.sql, input.ticket);
        if (!loaded.ok) return loaded;
        const stored = loaded.value;
        if (stored === null) return notFound("ticket does not exist");
        const scope = checkApp(tx.port, ctx, stored.app);
        if (!scope.ok) return scope;
        if (stored.state !== "reported" || stored.completion_seq === null) {
          return conflict("ticket has no report to verify");
        }
        if (stored.completion_seq !== input.completion_seq) {
          return conflict("completion changed");
        }
        if (
          !revisionAgrees(
            stored.revision,
            input.base_revision,
            compare.base_revision,
          )
        ) return conflict("ticket revision changed");
        if (input.result === "verified") {
          const gate = examplesPassed(tx, input.ticket, input.completion_seq);
          if (!gate.ok) return gate;
        }
        const revision = nextRevision(stored.revision);
        tx.sql.run(
          `INSERT INTO ticket_verdicts (ticket, completion_seq, result, note)
           VALUES (?, ?, ?, ?)`,
          [
            input.ticket,
            input.completion_seq,
            input.result,
            input.note ?? null,
          ],
        );
        tx.sql.run("UPDATE tickets SET state = ?, revision = ? WHERE id = ?", [
          input.result,
          revision,
          input.ticket,
        ]);
        // 확인됨이면 같은 tx에서 TicketVerified를 낸다. activation이 이 event로 열린다.
        if (input.result === "verified") {
          tx.emit(ticketVerified, input.ticket, { app: stored.app });
        }
        return ok({ ticket: input.ticket, state: input.result, revision });
      },
    },
    cancel: {
      route: ticketCancel,
      handle(tx, ctx, input) {
        if (!cancelActorAllowed(ctx.actor)) {
          return forbidden("actor is not allowed to cancel tickets");
        }
        const loaded = loadTicket(tx.sql, input.ticket);
        if (!loaded.ok) return loaded;
        const stored = loaded.value;
        if (stored === null) return notFound("ticket does not exist");
        const scope = checkApp(tx.port, ctx, stored.app);
        if (!scope.ok) return scope;
        if (CLOSED.includes(stored.state)) {
          return conflict("ticket is already closed");
        }
        tx.sql.run("DELETE FROM ticket_claims WHERE ticket = ?", [
          input.ticket,
        ]);
        tx.sql.run(
          `UPDATE tickets SET state = 'cancelled', cancel_reason = ?, revision = ?
           WHERE id = ?`,
          [input.reason, nextRevision(stored.revision), input.ticket],
        );
        removeRefs(tx.sql, "ticket", input.ticket);
        return ok({ ticket: input.ticket, state: "cancelled" as const });
      },
    },
  };
}

// examples check의 ticket은 그 보고의 예시가 지금 ticket의 check로 돌아 pass일 때만 verified가 된다.
// 예시를 고친 뒤의 옛 결과는 check hash가 달라 근거가 아니다.
function examplesPassed(
  tx: Pick<Tx, "sql">,
  ticket: string,
  completionSeq: string,
): Result<void> {
  const row = tx.sql.get(
    "SELECT acceptance_check FROM tickets WHERE id = ?",
    [ticket],
  );
  const check = JSON.parse(String(row!["acceptance_check"]));
  if (check.kind !== "examples") return ok(undefined);
  const hash = createHash("sha256").update(canonicalize(check), "utf8")
    .digest("hex");
  const passed = tx.sql.get(
    `SELECT 1 AS found
     FROM ticket_check_results AS result
     JOIN verifications AS verification ON verification.id = result.verification
     WHERE result.ticket = ? AND result.completion_seq = ?
       AND result.result = 'pass'
       AND verification.ticket = ? AND verification.ticket_completion_seq = ?
       AND verification.ticket_check_hash = ?`,
    [ticket, completionSeq, ticket, completionSeq, hash],
  );
  return passed === undefined
    ? conflict("the examples have not passed for this report")
    : ok(undefined);
}

// 근거는 이 앱의 것이어야 한다. annotation은 읽을 때 풀고, file은 값 모양만 본다.
function checkEvidence(
  tx: Tx,
  app: string,
  evidence: readonly TicketEvidence[],
): Result<void> {
  for (const item of evidence) {
    if (item.kind === "ticket") {
      const found = loadTicket(tx.sql, item.id);
      if (!found.ok) return found;
      if (found.value === null || found.value.app !== app) {
        return invalid("evidence ticket is not in this app");
      }
    } else if (item.kind === "release") {
      const found = tx.port(TicketEvidenceLookup).releaseApp(item.id);
      if (!found.ok) return found;
      if (found.value !== app) {
        return invalid("evidence release is not in this app");
      }
    }
  }
  return ok(undefined);
}
