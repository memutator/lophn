// ticket machine check(coding-agent/tickets#R7, R8, R18, R19, R20). record_checks는
// checker machine이 낸 조건별 결과를 최신 completion에만 남기고, 전부 pass면 confirmed,
// 실제 fail이 있으면 check_failed, 나머지는 reported로 둔다. 결과는 handler가 같은
// transaction의 정본 사실로 다시 판정해 같을 때만 받는다: machine이 낸 pass도 근거가
// 없으면 받지 않는다. check_work는 checker가 판정에 쓰는 사실을 정본 표에서 모아 준다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  ticketCheckFailed,
  ticketChecksRecorded,
  type TicketCondition,
  ticketConfirmed,
  ticketRecordChecks,
} from "../../contracts/coding-agent/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  Tx,
} from "../../contracts/platform/mod.ts";
import { revisionAgrees } from "./claims.ts";
import { nextCursor, pageAfter } from "./cursor.ts";
import {
  CHECK_WORK_PAGE,
  type CheckWork,
  judgeTicket,
  outcomeOf,
  ticketCheckWork,
  type VerificationFact,
} from "./checker/mod.ts";

type ReadSql = Pick<Tx["sql"], "get" | "all">;

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 다른 concern의 표가 없는 조립에서는 그 근거가 없는 것이다(없는 근거는 inconclusive).
function readIfPresent<T>(read: () => T, absent: T): T {
  try {
    return read();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("no such table")) return absent;
    throw error;
  }
}

function parseList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function failureSummary(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = JSON.parse(String(value)) as { summary?: unknown };
    return typeof parsed.summary === "string" ? parsed.summary : null;
  } catch {
    return null;
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
      check_index: Number(row["ticket_check_index"]),
      check_hash: String(row["ticket_check_hash"]),
      completion_seq: String(row["ticket_completion_seq"]),
    },
  };
}

// 보고된 ticket의 최신 completion 사실을 한 snapshot에서 모은다. reported가 아니거나
// completion이 없으면 null이다. 다른 concern의 값은 읽기만 하며 그 concern의 판정을 대신하지
// 않는다(release 상태·active release·Verification 결과 그대로).
export function loadCheckWork(sql: ReadSql, ticket: string): CheckWork | null {
  const row = sql.get(
    `SELECT app, state, revision, completion_seq FROM tickets WHERE id = ?`,
    [ticket],
  );
  if (
    row === undefined || row["state"] !== "reported" ||
    row["completion_seq"] === null
  ) return null;
  const app = String(row["app"]);
  const seq = String(row["completion_seq"]);
  const completion = sql.get(
    "SELECT release, verifications FROM ticket_completions WHERE ticket = ? AND seq = ?",
    [ticket, seq],
  );
  if (completion === undefined) return null;
  const conditions: TicketCondition[] = sql.all(
    `SELECT position, kind, input, condition_hash FROM ticket_conditions
     WHERE ticket = ? ORDER BY position`,
    [ticket],
  ).map((item) => ({
    position: Number(item["position"]),
    kind: String(item["kind"]) as TicketCondition["kind"],
    input: JSON.parse(String(item["input"])) as TicketCondition["input"],
    condition_hash: String(item["condition_hash"]),
  }));
  const recorded = sql.all(
    `SELECT condition, result FROM ticket_check_results
     WHERE ticket = ? AND completion_seq = ? ORDER BY condition`,
    [ticket, seq],
  ).map((item) => ({
    condition: Number(item["condition"]),
    result: String(item["result"]) as "pass" | "fail" | "inconclusive",
  }));
  const releaseId = String(completion["release"]);
  const releaseRow = readIfPresent(
    () =>
      sql.get(
        "SELECT id, app, bundle_hash, status, failure FROM releases WHERE id = ?",
        [releaseId],
      ),
    undefined,
  );
  const release = releaseRow === undefined ? null : {
    id: String(releaseRow["id"]),
    app: String(releaseRow["app"]),
    bundle_hash: String(releaseRow["bundle_hash"]),
    status: String(releaseRow["status"]) as NonNullable<
      CheckWork["release"]
    >["status"],
    failure: failureSummary(releaseRow["failure"]),
  };
  const appRow = readIfPresent(
    () =>
      sql.get("SELECT revision, active_release FROM apps WHERE id = ?", [app]),
    undefined,
  );
  const verifications = release === null ? [] : readIfPresent(
    () =>
      sql.all(
        `SELECT id, kind, app, result, reason, target_bundle_hash, ticket,
           ticket_check_index, ticket_check_hash, ticket_completion_seq
         FROM verifications
         WHERE app = ?
           AND ((kind = 'app_test' AND target_bundle_hash = ?)
             OR (kind = 'test_command' AND ticket = ? AND ticket_completion_seq = ?))
         ORDER BY cast(recorded_seq AS integer)
         LIMIT 500`,
        [app, release.bundle_hash, ticket, seq],
      ).map(verificationFact),
    [] as VerificationFact[],
  );
  return {
    ticket,
    app,
    revision: String(row["revision"]),
    completion: {
      seq,
      release: releaseId,
      verifications: parseList(completion["verifications"]),
    },
    conditions,
    recorded,
    release,
    app_state: appRow === undefined ? null : {
      revision: String(appRow["revision"]),
      active_release: appRow["active_release"] === null
        ? null
        : String(appRow["active_release"]),
    },
    verifications,
  } as CheckWork;
}

export function createTicketCheckReads(): {
  check_work: ReadDefinition<typeof ticketCheckWork>;
} {
  return {
    check_work: {
      route: ticketCheckWork,
      handle(snapshot, ctx, input) {
        if (ctx.actor !== "machine") {
          return err({ code: "forbidden", message: "machine only" });
        }
        const after = pageAfter(input.cursor, snapshot.as_of_seq);
        if (!after.ok) return after;
        const ids = snapshot.sql.all(
          `SELECT id FROM tickets
           WHERE state = 'reported' AND completion_seq IS NOT NULL
             AND (? IS NULL OR id = ?) AND (? IS NULL OR id > ?)
           ORDER BY id LIMIT ?`,
          [
            input.ticket ?? null,
            input.ticket ?? null,
            after.value,
            after.value,
            CHECK_WORK_PAGE + 1,
          ],
        ).map((row) => String(row["id"]));
        const page = ids.slice(0, CHECK_WORK_PAGE);
        const works: CheckWork[] = [];
        for (const id of page) {
          const work = loadCheckWork(snapshot.sql, id);
          if (work !== null) works.push(work);
        }
        return ok({
          works,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: ids.length > CHECK_WORK_PAGE
            ? nextCursor(page[page.length - 1]!, snapshot.as_of_seq)
            : null,
        });
      },
    },
  };
}

type RecordInput = {
  ticket: string;
  completion_seq: string;
  base_revision: string;
  checks: {
    condition: number;
    result: "pass" | "fail" | "inconclusive";
    reason: string;
    verification: string | null;
    targets: {
      concern: string;
      id: string;
      revision: string;
      release: string | null;
    }[];
  }[];
};

function sameTargets(
  left: RecordInput["checks"][number]["targets"],
  right: RecordInput["checks"][number]["targets"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createTicketCheckCommands(): {
  record_checks: CommandDefinition<typeof ticketRecordChecks>;
} {
  return {
    record_checks: {
      route: ticketRecordChecks,
      handle(tx, ctx, raw, compare) {
        if (ctx.actor !== "machine") {
          return err({ code: "forbidden", message: "machine only" });
        }
        const input = raw as RecordInput;
        const row = tx.sql.get(
          "SELECT state, revision, completion_seq FROM tickets WHERE id = ?",
          [input.ticket],
        );
        if (row === undefined) return conflict("ticket cannot be checked");
        if (row["state"] !== "reported") {
          return conflict("ticket is not waiting for checks");
        }
        // 늦은 옛 completion의 검사가 새 보고의 결과를 덮지 않는다(R20).
        if (String(row["completion_seq"]) !== input.completion_seq) {
          return conflict("completion changed");
        }
        if (
          !revisionAgrees(
            String(row["revision"]),
            input.base_revision,
            compare.base_revision,
          )
        ) return conflict("ticket revision changed");
        const work = loadCheckWork(tx.sql, input.ticket);
        if (work === null) return conflict("completion cannot be checked");
        const expected = new Map(
          judgeTicket(work).map((decision) =>
            [decision.condition, decision] as const
          ),
        );
        const seen = new Set<number>();
        for (const check of input.checks) {
          if (seen.has(check.condition)) return invalid("duplicate condition");
          seen.add(check.condition);
          const current = expected.get(check.condition);
          if (current === undefined) return invalid("unknown condition");
          if (check.result !== "pass" && !/\S/.test(check.reason)) {
            return invalid("a result that is not pass needs a reason");
          }
          // 같은 근거로 다시 판정한 값과 같아야 받는다. 그 사이 근거나 대상 revision이
          // 바뀌었으면 conflict라서 낡은 결과가 최신 상태를 덮지 못한다.
          if (
            check.result !== current.result ||
            check.verification !== current.verification ||
            !sameTargets(check.targets, current.targets)
          ) return conflict("evidence changed since it was read");
        }
        // 이번 completion의 기록에 이번 결과를 덧씌운 전체로 상태를 정한다.
        const merged = new Map<number, "pass" | "fail" | "inconclusive">(
          work.recorded.map((item) => [item.condition, item.result]),
        );
        const changed = input.checks.filter((check) =>
          merged.get(check.condition) !== check.result
        );
        for (const check of input.checks) {
          merged.set(check.condition, check.result);
        }
        const results = work.conditions.map((condition) =>
          merged.get(condition.position) ?? "inconclusive"
        );
        const outcome = outcomeOf(results);
        const state = outcome === "confirmed"
          ? "confirmed"
          : outcome === "check_failed"
          ? "check_failed"
          : "reported";
        // 새 사실이 없으면 쓰지 않는다. 같은 결과를 다시 받아도 event가 쌓이지 않는다.
        if (changed.length === 0) {
          return ok({
            ticket: input.ticket,
            state: "reported" as const,
            completion_seq: input.completion_seq,
          });
        }
        for (const check of changed) {
          tx.sql.run(
            `INSERT INTO ticket_check_results
               (ticket, completion_seq, condition, result, reason, verification)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (ticket, completion_seq, condition) DO UPDATE SET
               result = excluded.result, reason = excluded.reason,
               verification = excluded.verification`,
            [
              input.ticket,
              input.completion_seq,
              check.condition,
              check.result,
              check.reason,
              check.verification,
            ],
          );
        }
        const stored = tx.sql.get(
          "SELECT problems FROM tickets WHERE id = ?",
          [input.ticket],
        );
        const problems = parseList(stored?.["problems"]);
        const completion = tx.sql.get(
          "SELECT fix_records FROM ticket_completions WHERE ticket = ? AND seq = ?",
          [input.ticket, input.completion_seq],
        );
        const fixRecords = parseList(completion?.["fix_records"]);
        let revision = tx.emit(ticketChecksRecorded, input.ticket, {
          completion_seq: input.completion_seq,
          checks: changed.map((check) => ({
            condition: check.condition,
            result: check.result,
          })),
        });
        if (outcome === "confirmed") {
          revision = tx.emit(ticketConfirmed, input.ticket, {
            app: work.app,
            problems,
            completion_seq: input.completion_seq,
            release: work.completion.release,
            fix_records: fixRecords,
          });
        } else if (outcome === "check_failed") {
          revision = tx.emit(ticketCheckFailed, input.ticket, {
            app: work.app,
            problems,
            completion_seq: input.completion_seq,
            release: work.completion.release,
            fix_records: fixRecords,
            failed_conditions: work.conditions.flatMap((condition) =>
              merged.get(condition.position) === "fail"
                ? [condition.position]
                : []
            ),
          });
        }
        tx.sql.run(
          "UPDATE tickets SET state = ?, revision = ? WHERE id = ?",
          [state, revision, input.ticket],
        );
        // confirmed가 된 ticket만 repair 문제 예약이 풀린다(OPEN_REPAIR_GUARD).
        if (state === "confirmed") {
          tx.sql.run(
            "DELETE FROM ticket_open_repair_problems WHERE ticket = ?",
            [input.ticket],
          );
        }
        return ok({
          ticket: input.ticket,
          state,
          completion_seq: input.completion_seq,
        });
      },
    },
  };
}
