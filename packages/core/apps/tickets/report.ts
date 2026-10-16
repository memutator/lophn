// ticket 완료 보고. 보고는 현재 유효 claim과 release 역조회가 같은 transaction에서 지나고,
// 접수 때 claim을 끝낸다. 보고의 seq(completion_seq)는 `TicketCompletionReported`의 seq다.
import { ok, type Result } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import { ticketReportCompletion } from "../../../protocol/coding-agent/ticket/mod.ts";
import type { TicketReportCompletionInput } from "../../../protocol/coding-agent/ticket/mod.ts";
import { ticketCompletionReported } from "../../../protocol/events/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { currentClaim } from "./claims.ts";
import {
  conflict,
  invalid,
  nextRevision,
  notFound,
  parseTicketSource,
  releaseSourceMatches,
} from "./model.ts";

type Completion = TicketReportCompletionInput["completion"];

export function createTicketReportCommands(): {
  report_completion: CommandDefinition<typeof ticketReportCompletion>;
} {
  return {
    report_completion: {
      route: ticketReportCompletion,
      handle(tx, ctx, input, compare) {
        const held = currentClaim(
          tx,
          ctx,
          input,
          compare,
          Date.parse(tx.now()),
        );
        if (!held.ok) return held;
        const { ticket: stored, session } = held.value;
        const registered = tx.port(appRegistrationLookup).get(stored.app);
        if (!registered.ok) return registered;
        if (registered.value === null) return notFound("app does not exist");
        // 이 claim으로 같은 앱의 release가 준비돼 있어야 한다.
        const release = tx.sql.get(
          "SELECT app, ticket_source FROM releases WHERE id = ?",
          [input.completion.release],
        );
        if (release === undefined) return notFound("release does not exist");
        const source = parseTicketSource(
          release["ticket_source"] === null
            ? null
            : String(release["ticket_source"]),
        );
        if (
          !releaseSourceMatches(
            source,
            String(release["app"]),
            stored.app,
            input.ticket,
            input.claim_seq,
          )
        ) return conflict("release is not prepared through this ticket claim");
        if (input.summary_blob.hash !== input.completion.summary_hash) {
          return invalid("summary blob hash differs from summary_hash");
        }
        const references = completionReferences(
          tx,
          stored.app,
          input.completion,
        );
        if (!references.ok) return references;
        // 맡긴 App Engineer와 call을 찾는 데 필요한 칸이다.
        const seq = tx.emit(ticketCompletionReported, input.ticket, {
          app: stored.app,
          release: input.completion.release,
          session,
        });
        // 준비 증거를 본 뒤 같은 transaction에 영구 참조를 등록한다.
        const blob = tx.registerBlobRef({
          owner_kind: "ticket",
          owner_key: input.ticket,
          field: "summary",
          registered_seq: seq,
          source: { kind: "prepared", blob: { ...input.summary_blob } },
        });
        if (!blob.ok) return blob;
        tx.sql.run(
          `INSERT INTO ticket_completions
             (ticket, seq, session, claim_seq, release, summary_hash, fix_records, verifications)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.ticket,
            seq,
            session,
            input.claim_seq,
            input.completion.release,
            input.completion.summary_hash,
            JSON.stringify([...input.completion.fix_records]),
            JSON.stringify([...input.completion.verifications]),
          ],
        );
        // 접수 때 claim을 끝낸다. 확인됨은 App Engineer가 정한다.
        tx.sql.run("DELETE FROM ticket_claims WHERE ticket = ?", [
          input.ticket,
        ]);
        tx.sql.run(
          `UPDATE tickets SET state = 'reported', completion_seq = ?, revision = ?
           WHERE id = ?`,
          [seq, nextRevision(stored.revision), input.ticket],
        );
        return ok({
          ticket: input.ticket,
          state: "reported" as const,
          completion_seq: seq,
        });
      },
    },
  };
}

// 완료 보고 참조. verifications는 실제 runner 기록이다.
function completionReferences(
  tx: Tx,
  app: string,
  completion: Completion,
): Result<void> {
  if (
    new Set(completion.verifications).size !== completion.verifications.length
  ) {
    return invalid("duplicate verification");
  }
  for (const verification of completion.verifications) {
    const row = tx.sql.get("SELECT app FROM verifications WHERE id = ?", [
      verification,
    ]);
    if (row === undefined) return notFound("verification does not exist");
    if (String(row["app"]) !== app) {
      return invalid("verification belongs to another app");
    }
  }
  return ok(undefined);
}
