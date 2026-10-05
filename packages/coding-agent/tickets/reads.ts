// ticket read(coding-agent/tickets#R10, T18). list는 요약만, show는 고정 근거와
// 조건 hash까지, checks는 최신 보고의 조건별 결과를 준다. 상대 위치·조건 원문은
// 범위를 넓히지 않는다(R25).
import { err, ok, type Result } from "../../base/mod.ts";
import {
  ticketChecks,
  type TicketCondition,
  type TicketKind,
  ticketList,
  type TicketReadiness,
  type TicketReference,
  ticketShow,
  type TicketState,
} from "../../contracts/coding-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { nextCursor, pageAfter } from "./cursor.ts";

function notFound(): Result<never> {
  return err({ code: "not_found", message: "ticket not found" });
}

function kindOf(value: unknown): TicketKind {
  return value === "repair" ? "repair" : "implementation";
}

function stateOf(value: unknown): TicketState {
  const state = String(value);
  return state === "open"
    ? "open"
    : state === "claimed"
    ? "claimed"
    : state === "reported"
    ? "reported"
    : state === "confirmed"
    ? "confirmed"
    : state === "check_failed"
    ? "check_failed"
    : "cancelled";
}

function readinessOf(value: unknown): TicketReadiness {
  return value === "ready" ? "ready" : "needs_confirmation";
}

type Summary = {
  id: string;
  app: string;
  kind: TicketKind;
  title: string;
  state: TicketState;
  readiness: TicketReadiness;
  problem_count: number;
};

function summaries(sql: ReadSnapshot["sql"], filter: {
  app: string | null;
  state: string | null;
}): Result<Summary[]> {
  const rows = sql.all(
    `SELECT t.id, t.app, t.kind, t.title, t.state, t.readiness,
       (SELECT COUNT(*) FROM ticket_problems p WHERE p.ticket = t.id) AS problem_count
     FROM tickets t
     WHERE (? IS NULL OR t.app = ?)
       AND (? IS NULL OR t.state = ?)
     ORDER BY t.id`,
    [
      filter.app,
      filter.app,
      filter.state,
      filter.state,
    ],
  );
  const values: Summary[] = [];
  for (const row of rows) {
    values.push({
      id: String(row.id),
      app: String(row.app),
      kind: kindOf(row.kind),
      title: String(row.title),
      state: stateOf(row.state),
      readiness: readinessOf(row.readiness),
      problem_count: Number(row.problem_count),
    });
  }
  return ok(values);
}

// ticket read 주체와 event·cancellation 조건은 read actor 검사를 여기 남긴다.
function visible(ctx: RequestContext): Result<void> {
  void ctx;
  return ok(undefined);
}

export function createTicketReads(): {
  list: ReadDefinition<typeof ticketList>;
  show: ReadDefinition<typeof ticketShow>;
  checks: ReadDefinition<typeof ticketChecks>;
} {
  return {
    list: {
      route: ticketList,
      handle(snapshot, ctx, input) {
        const seen = visible(ctx);
        if (!seen.ok) return seen;
        const loaded = summaries(snapshot.sql, {
          app: input.app ?? null,
          state: input.state ?? null,
        });
        if (!loaded.ok) return loaded;
        const after = pageAfter(input.cursor, snapshot.as_of_seq);
        if (!after.ok) return after;
        const start = after.value === null
          ? 0
          : loaded.value.findIndex((item) => item.id === after.value) + 1;
        if (after.value !== null && start === 0) {
          return err({
            code: "invalid_input",
            message: "invalid ticket cursor",
          });
        }
        const limit = input.limit ?? 20;
        const page = loaded.value.slice(start, start + limit);
        const next = start + page.length;
        return ok({
          tickets: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < loaded.value.length
            ? nextCursor(page[page.length - 1]!.id, snapshot.as_of_seq)
            : null,
        });
      },
    },
    show: {
      route: ticketShow,
      handle(snapshot, _ctx, input) {
        const row = snapshot.sql.get(
          `SELECT id, app, kind, title, what, why, inspect, preserve, problems,
             state, readiness, needs, cancel_reason, completion_seq, revision
           FROM tickets WHERE id = ?`,
          [input.ticket],
        );
        if (row === undefined) return notFound();
        const claim = claimOf(snapshot, input.ticket);
        if (!claim.ok) return claim;
        const conditions = conditionRows(snapshot, input.ticket);
        if (!conditions.ok) return conditions;
        const references = referenceRows(snapshot, input.ticket);
        if (!references.ok) return references;
        const questions = questionRows(snapshot, input.ticket);
        if (!questions.ok) return questions;
        const ticket = {
          id: String(row.id),
          state: stateOf(row.state),
          readiness: readinessOf(row.readiness),
          needs: needsOf(row.needs),
          app: String(row.app),
          kind: kindOf(row.kind),
          title: String(row.title),
          what: String(row.what),
          why: String(row.why),
          problems: stringArray(row.problems),
          claim: claim.value,
          completion_seq: row.completion_seq === null
            ? null
            : String(row.completion_seq),
          conditions: conditions.value,
          references: references.value,
          adoption_questions: questions.value,
          inspect: stringArray(row.inspect),
          preserve: stringArray(row.preserve),
          revision: seqText(row.revision),
        };
        return ok({
          ticket,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    checks: {
      route: ticketChecks,
      handle(snapshot, _ctx, input) {
        const completion = snapshot.sql.get(
          `SELECT seq FROM ticket_completions WHERE ticket = ?
           ORDER BY seq DESC LIMIT 1`,
          [input.ticket],
        );
        if (completion === undefined) {
          return ok({
            ticket: input.ticket,
            completion_seq: null,
            checks: [],
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        }
        const rows = snapshot.sql.all(
          `SELECT condition, result, reason, verification FROM ticket_check_results
           WHERE ticket = ? AND completion_seq = ? ORDER BY condition`,
          [input.ticket, String(completion.seq)],
        );
        const checks = rows.map((row) => ({
          condition: Number(row.condition),
          result: row.result === "pass"
            ? "pass" as const
            : row.result === "fail"
            ? "fail" as const
            : "inconclusive" as const,
          reason: String(row.reason),
          verification: row.verification === null
            ? null
            : String(row.verification),
        }));
        return ok({
          ticket: input.ticket,
          completion_seq: String(completion.seq),
          checks,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

function claimOf(
  snapshot: ReadSnapshot,
  ticket: string,
): Result<
  { connection: string; claim_seq: string; expires_at: string } | null
> {
  const row = snapshot.sql.get(
    "SELECT connection, claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
    [ticket],
  );
  if (row === undefined) return ok(null);
  return ok({
    connection: String(row.connection),
    claim_seq: String(row.claim_seq),
    expires_at: String(row.expires_at),
  });
}

function conditionRows(
  snapshot: ReadSnapshot,
  ticket: string,
): Result<TicketCondition[]> {
  const rows = snapshot.sql.all(
    "SELECT position, kind, input, condition_hash FROM ticket_conditions WHERE ticket = ? ORDER BY position",
    [ticket],
  );
  const conditions: TicketCondition[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(row.input));
    } catch {
      return err({
        code: "invalid_input",
        message: "stored condition input is invalid",
      });
    }
    conditions.push({
      position: Number(row.position),
      kind: String(row.kind) as TicketCondition["kind"],
      input: parsed as TicketCondition["input"],
      condition_hash: String(row.condition_hash),
    });
  }
  return ok(conditions);
}

function referenceRows(
  snapshot: ReadSnapshot,
  ticket: string,
): Result<TicketReference[]> {
  const rows = snapshot.sql.all(
    "SELECT kind, target, address, section FROM ticket_references WHERE ticket = ? ORDER BY position",
    [ticket],
  );
  const references = rows.map((row) => {
    let address: unknown = null;
    if (row.address !== null) {
      try {
        address = JSON.parse(String(row.address));
      } catch {
        address = null;
      }
    }
    return {
      kind: String(row.kind) as TicketReference["kind"],
      target: String(row.target),
      address,
      section: row.section === null ? null : String(row.section),
    } as TicketReference;
  });
  return ok(references);
}

function questionRows(
  snapshot: ReadSnapshot,
  ticket: string,
): Result<string[]> {
  const rows = snapshot.sql.all(
    "SELECT question FROM ticket_adoption_questions WHERE ticket = ? ORDER BY position",
    [ticket],
  );
  return ok(rows.map((row) => String(row.question)));
}

function stringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function needsOf(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function seqText(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}
