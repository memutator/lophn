// 보고 검사의 core 쪽. check_work는 Reactor handler가 결과를 정하는 데 쓰는 사실을 정본 표에서
// 모아 주고, record_checks는 그 결과를 보고마다 한 줄 남긴다. 상태는 바꾸지 않는다.
import { ok } from "../../../base/mod.ts";
import {
  acceptanceCheckSchema,
  ticketRecordChecks,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  Sql,
} from "../../../protocol/server/mod.ts";
import {
  type CheckWork,
  checkWorkSchema,
  ticketCheckWork,
  type VerificationFact,
} from "./checker/mod.ts";
import {
  conflict,
  forbidden,
  invalid,
  nextRevision,
  revisionAgrees,
} from "./model.ts";
import { loadTicket } from "./store.ts";

type ReadSql = Pick<Sql, "get" | "all">;

// 다른 owner의 표가 없는 조립에서는 그 근거가 없는 것이다(없는 근거는 inconclusive).
function readIfPresent<T>(read: () => T, absent: T): T {
  try {
    return read();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("no such table")) return absent;
    throw error;
  }
}

function verificationFact(row: Record<string, unknown>): VerificationFact {
  return {
    id: String(row["id"]),
    kind: String(row["kind"]) as VerificationFact["kind"],
    app: String(row["app"]),
    result: String(row["result"]) as VerificationFact["result"],
    reason: String(row["reason"]),
    bundle_hash: String(row["target_bundle_hash"]),
    ticket: row["ticket"] === null || row["ticket"] === undefined ? null : {
      ticket: String(row["ticket"]),
      completion_seq: String(row["ticket_completion_seq"]),
    },
  };
}

// 보고된 ticket의 그 보고에 대한 사실을 한 snapshot에서 모은다. reported가 아니거나 최신 보고가
// 아니면 null이다. 다른 concern의 값은 읽기만 한다.
function loadCheckWork(
  sql: ReadSql,
  ticket: string,
  completionSeq: string,
): CheckWork | null {
  const row = sql.get(
    `SELECT app, state, revision, completion_seq, acceptance_check
     FROM tickets WHERE id = ?`,
    [ticket],
  );
  if (
    row === undefined || row["state"] !== "reported" ||
    row["completion_seq"] !== completionSeq
  ) return null;
  const completion = sql.get(
    "SELECT release FROM ticket_completions WHERE ticket = ? AND seq = ?",
    [ticket, completionSeq],
  );
  if (completion === undefined) return null;
  const app = String(row["app"]);
  const releaseId = String(completion["release"]);
  const releaseRow = readIfPresent(
    () =>
      sql.get("SELECT id, app, bundle_hash FROM releases WHERE id = ?", [
        releaseId,
      ]),
    undefined,
  );
  const release = releaseRow === undefined ? null : {
    id: String(releaseRow["id"]),
    app: String(releaseRow["app"]),
    bundle_hash: String(releaseRow["bundle_hash"]),
  };
  const verifications = release === null ? [] : readIfPresent(
    () =>
      sql.all(
        `SELECT id, kind, app, result, reason, target_bundle_hash, ticket,
           ticket_completion_seq
         FROM verifications
         WHERE app = ?
           AND ((kind = 'app_test' AND target_bundle_hash = ?)
             OR (kind = 'examples' AND ticket = ? AND ticket_completion_seq = ?))
         ORDER BY cast(recorded_seq AS integer)
         LIMIT 500`,
        [app, release.bundle_hash, ticket, completionSeq],
      ).map(verificationFact),
    [] as VerificationFact[],
  );
  return checkWorkSchema.parse({
    ticket,
    app,
    revision: String(row["revision"]),
    completion_seq: completionSeq,
    release,
    check: JSON.parse(String(row["acceptance_check"])),
    verifications,
  });
}

export function createTicketCheckReads(): {
  check_work: ReadDefinition<typeof ticketCheckWork>;
} {
  return {
    check_work: {
      route: ticketCheckWork,
      handle(snapshot, ctx, input) {
        if (ctx.actor !== "machine") return forbidden("machine only");
        return ok({
          work: loadCheckWork(snapshot.sql, input.ticket, input.completion_seq),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

export function createTicketCheckCommands(): {
  record_checks: CommandDefinition<typeof ticketRecordChecks>;
} {
  return {
    record_checks: {
      route: ticketRecordChecks,
      handle(tx, ctx, input, compare) {
        if (ctx.actor !== "machine") return forbidden("machine only");
        const loaded = loadTicket(tx.sql, input.ticket);
        if (!loaded.ok) return loaded;
        const stored = loaded.value;
        if (stored === null) return conflict("ticket cannot be checked");
        if (stored.state !== "reported") {
          return conflict("ticket is not waiting for checks");
        }
        // 늦은 옛 보고의 검사가 새 보고의 결과를 덮지 않는다.
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
        const check = acceptanceCheckSchema.parse(JSON.parse(String(
          tx.sql.get("SELECT acceptance_check FROM tickets WHERE id = ?", [
            input.ticket,
          ])!["acceptance_check"],
        )));
        if (check.kind === "text") {
          return invalid("a text check is judged by the App Engineer");
        }
        if (input.result !== "pass" && !/\S/.test(input.reason)) {
          return invalid("a result that is not pass needs a reason");
        }
        const recorded = tx.sql.get(
          "SELECT 1 AS found FROM ticket_check_results WHERE ticket = ? AND completion_seq = ?",
          [input.ticket, input.completion_seq],
        );
        if (recorded !== undefined) return conflict("checks already recorded");
        tx.sql.run(
          `INSERT INTO ticket_check_results
             (ticket, completion_seq, result, reason, verification)
           VALUES (?, ?, ?, ?, ?)`,
          [
            input.ticket,
            input.completion_seq,
            input.result,
            input.reason,
            input.verification ?? null,
          ],
        );
        tx.sql.run("UPDATE tickets SET revision = ? WHERE id = ?", [
          nextRevision(stored.revision),
          input.ticket,
        ]);
        return ok({
          ticket: input.ticket,
          state: "reported" as const,
          completion_seq: input.completion_seq,
        });
      },
    },
  };
}
