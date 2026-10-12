// ticket read(coding-agent/tickets#R10, T18). list는 요약만, show는 고정 근거와
// 조건 hash까지, checks는 최신 보고의 조건별 결과를 준다. 상대 위치·조건 원문은
// 범위를 넓히지 않는다(R25).
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  repairPrepare,
  ticketChecks,
  type TicketCondition,
  type TicketKind,
  ticketList,
  type TicketNextAction,
  type TicketReadiness,
  type TicketReference,
  ticketScreenDetail,
  ticketScreenList,
  type TicketScreenState,
  type TicketScreenSummary,
  ticketShow,
  type TicketState,
} from "../../../protocol/coding-agent/mod.ts";
import {
  defineRead,
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
} from "../../../protocol/platform/mod.ts";
import { nextCursor, pageAfter } from "./cursor.ts";
import { checkTicketClaim, expiredClaims } from "./claims.ts";
import {
  prepareRepairTicket,
  REPAIR_PREPARE_SOURCE,
  type RepairPrepareSource,
} from "./prepare.ts";

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

// 사람 화면 상태. 여섯 state와 readiness가 서로 다른 값 일곱 개로 나온다(R27).
// readiness는 open일 때만 다른 화면 상태가 된다(ready 뒤 되돌림이 없어 claim 뒤 state는 모두 ready다).
export function screenStateOf(
  state: TicketState,
  readiness: TicketReadiness,
): TicketScreenState {
  switch (state) {
    case "open":
      return readiness === "ready" ? "ready" : "needs_confirmation";
    case "claimed":
      return "in_progress";
    case "reported":
      return "reported";
    case "confirmed":
      return "confirmed";
    case "check_failed":
      return "check_failed";
    case "cancelled":
      return "cancelled";
  }
}

// 다음 행동은 정확히 하나다: [Start] 가능(ready·open|check_failed), 확인 필요
// (needs_confirmation), 결과 확인(confirmed), 승인 대기(reported). 사람이 할 일이 없는
// 작업 중·취소는 null이다.
export function nextActionOf(
  state: TicketState,
  readiness: TicketReadiness,
): TicketNextAction | null {
  switch (state) {
    case "open":
    case "check_failed":
      return readiness === "ready" ? "start" : "needs_confirmation";
    case "reported":
      return "waiting_for_approval";
    case "confirmed":
      return "check_result";
    case "claimed":
    case "cancelled":
      return null;
  }
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

function pageOf<T extends { id: string }>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
  asOf: string,
): Result<{ page: T[]; next_cursor: string | null }> {
  const after = pageAfter(cursor, asOf);
  if (!after.ok) return after;
  const start = after.value === null
    ? 0
    : items.findIndex((item) => item.id === after.value) + 1;
  if (after.value !== null && start === 0) {
    return err({ code: "invalid_input", message: "invalid ticket cursor" });
  }
  const page = items.slice(start, start + limit);
  const next = start + page.length;
  return ok({
    page,
    next_cursor: next < items.length
      ? nextCursor(page[page.length - 1]!.id, asOf)
      : null,
  });
}

// ticket read 주체와 event·cancellation 조건은 read actor 검사를 여기 남긴다.
function visible(ctx: RequestContext): Result<void> {
  void ctx;
  return ok(undefined);
}

// coding agent는 연결 범위의 앱 ticket만 본다. 범위는 owner(여기)가 ticket의 앱을 target에 줘서
// 맞춘다. 범위 밖 ticket은 없는 ticket과 같은 답이다(connection#R5). 앱 하나에 묶인 agent
// (App Engineer의 `conditions.app`)도 같은 방식으로 담당 앱의 ticket만 본다(lophn-agent/roles/app-engineer#R2).
function inCodingScope(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  app: string,
): boolean {
  const kind = parseActor(ctx.actor)?.kind;
  if (
    kind !== "coding_agent" &&
    !(kind === "agent" && ctx.conditions.app !== undefined)
  ) return true;
  return snapshot.port(TargetAuthorization)(ctx, operation, { app }).ok;
}

// checkTicketClaim은 read가 아니라 같은 transaction의 검사다. release 준비와
// 완료 보고가 현재 claim·기한·연결·seq를 즉시 확인한다(R13). 기한을 연장하지 않는다.
export { checkTicketClaim };

// 만료·회수 정리 후보. 감독 timer가 60초마다와 재시작 때 읽고 expire_claim을
// 제출한다. 회수 connection은 호출자가 넘긴다(R13).
const claimSweep = defineRead({
  resource: "tickets",
  method: "claim_sweep",
  name: "TicketClaimSweep",
  input: z.strictObject({
    now: z.string(),
    revoked: z.array(z.string()),
  }),
  output: z.object({
    claims: z.array(z.object({ ticket: z.string(), claim_seq: z.string() })),
    as_of_seq: z.string(),
    next_cursor: z.string().nullable(),
  }),
  actors: ["machine"],
  errors: ["forbidden"],
});

export function createTicketReads(): {
  list: ReadDefinition<typeof ticketList>;
  show: ReadDefinition<typeof ticketShow>;
  checks: ReadDefinition<typeof ticketChecks>;
  screen_list: ReadDefinition<typeof ticketScreenList>;
  screen_detail: ReadDefinition<typeof ticketScreenDetail>;
  screen_repair_prepare: ReadDefinition<typeof repairPrepare>;
  claim_sweep: ReadDefinition<typeof claimSweep>;
} {
  return {
    list: {
      route: ticketList,
      handle(snapshot, ctx, input) {
        const seen = visible(ctx);
        if (!seen.ok) return seen;
        const found = summaries(snapshot.sql, {
          app: input.app ?? null,
          state: input.state ?? null,
        });
        if (!found.ok) return found;
        const loaded = {
          ...found,
          value: found.value.filter((item) =>
            inCodingScope(snapshot, ctx, ticketList.name, item.app)
          ),
        };
        const paged = pageOf(
          loaded.value,
          input.cursor,
          input.limit ?? 20,
          snapshot.as_of_seq,
        );
        if (!paged.ok) return paged;
        return ok({
          tickets: paged.value.page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: paged.value.next_cursor,
        });
      },
    },
    show: {
      route: ticketShow,
      handle(snapshot, ctx, input) {
        const row = snapshot.sql.get(
          `SELECT id, app, kind, title, what, why, inspect, preserve, problems,
             state, readiness, needs, cancel_reason, completion_seq, revision
           FROM tickets WHERE id = ?`,
          [input.ticket],
        );
        if (row === undefined) return notFound();
        if (!inCodingScope(snapshot, ctx, ticketShow.name, String(row.app))) {
          return notFound();
        }
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
    screen_list: {
      route: ticketScreenList,
      handle(snapshot, ctx, input) {
        const rows = snapshot.sql.all(
          `SELECT t.id, t.app, t.kind, t.title, t.what, t.state, t.readiness,
             (SELECT COUNT(*) FROM ticket_problems p WHERE p.ticket = t.id) AS problem_count
           FROM tickets t
           WHERE (? IS NULL OR t.app = ?)
           ORDER BY t.id`,
          [input.app ?? null, input.app ?? null],
        );
        const items: TicketScreenSummary[] = [];
        for (const row of rows) {
          if (
            !inCodingScope(
              snapshot,
              ctx,
              ticketScreenList.name,
              String(row.app),
            )
          ) continue;
          const summary = screenSummary(row);
          if (
            input.screen_state !== undefined &&
            summary.screen_state !== input.screen_state
          ) continue;
          items.push(summary);
        }
        const paged = pageOf(
          items,
          input.cursor,
          input.limit ?? 20,
          snapshot.as_of_seq,
        );
        if (!paged.ok) return paged;
        return ok({
          tickets: paged.value.page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: paged.value.next_cursor,
        });
      },
    },
    screen_detail: {
      route: ticketScreenDetail,
      handle(snapshot, ctx, input) {
        const row = snapshot.sql.get(
          `SELECT t.id, t.app, t.kind, t.title, t.what, t.why, t.inspect, t.preserve,
             t.problems, t.state, t.readiness, t.needs, t.completion_seq, t.revision,
             (SELECT COUNT(*) FROM ticket_problems p WHERE p.ticket = t.id) AS problem_count
           FROM tickets t WHERE t.id = ?`,
          [input.ticket],
        );
        if (row === undefined) return notFound();
        if (
          !inCodingScope(
            snapshot,
            ctx,
            ticketScreenDetail.name,
            String(row.app),
          )
        ) return notFound();
        const claim = claimOf(snapshot, input.ticket);
        if (!claim.ok) return claim;
        const conditions = conditionRows(snapshot, input.ticket);
        if (!conditions.ok) return conditions;
        const latest = row.completion_seq === null
          ? undefined
          : snapshot.sql.get(
            `SELECT seq, release, summary_hash, outputs, fix_records, verifications
           FROM ticket_completions WHERE ticket = ? AND seq = ?`,
            [input.ticket, String(row.completion_seq)],
          );
        const checks = latest === undefined ? [] : snapshot.sql.all(
          `SELECT condition, result, reason, verification FROM ticket_check_results
           WHERE ticket = ? AND completion_seq = ? ORDER BY condition`,
          [input.ticket, String(latest.seq)],
        ).map((check) => ({
          condition: Number(check.condition),
          result: check.result === "pass"
            ? "pass" as const
            : check.result === "fail"
            ? "fail" as const
            : "inconclusive" as const,
          reason: String(check.reason),
          verification: check.verification === null
            ? null
            : String(check.verification),
        }));
        const passed = new Set(
          checks.filter((check) => check.result === "pass").map((check) =>
            check.condition
          ),
        );
        const remaining = latest === undefined ? [] : conditions.value
          .map((condition) => condition.position)
          .filter((position) => !passed.has(position));
        return ok({
          ticket: {
            ...screenSummary(row),
            why: String(row.why),
            needs: stringArray(row.needs),
            problems: stringArray(row.problems),
            inspect: stringArray(row.inspect),
            preserve: stringArray(row.preserve),
            claim: claim.value,
            conditions: conditions.value,
            completion: latest === undefined ? null : {
              seq: String(latest.seq),
              release: String(latest.release),
              summary_hash: String(latest.summary_hash),
              outputs: stringArray(latest.outputs),
              fix_records: stringArray(latest.fix_records),
              verifications: stringArray(latest.verifications),
            },
            checks,
            remaining,
            revision: seqText(row.revision),
          },
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    claim_sweep: {
      route: claimSweep,
      handle(snapshot, _ctx, input) {
        // 회수 connection은 호출자가 표를 못 보는 machine이다. 이 read가
        // coding_agent_connections에서 revoked id를 읽어 후보에 더한다(R13).
        // 표가 없으면(ticket만 등록한 기동) 만료 후보만 본다.
        const revoked = [...input.revoked];
        try {
          const rows = snapshot.sql.all(
            "SELECT id FROM coding_agent_connections WHERE state = 'revoked'",
            [],
          );
          for (const row of rows) revoked.push(String(row.id));
        } catch (error) {
          // connection 등록이 없는 ledger에는 이 표가 없다. 그 밖(snapshot이
          // 닫힘, 잠금, 거절 SQL)은 만료 후보만 보는 것으로 넘기지 않는다.
          const message = error instanceof Error ? error.message : "";
          if (!message.toLowerCase().includes("no such table")) throw error;
        }
        return ok({
          claims: expiredClaims(snapshot.sql, input.now, revoked),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    screen_repair_prepare: {
      route: repairPrepare,
      handle(snapshot, ctx, input) {
        let source: RepairPrepareSource;
        try {
          source = snapshot.port(REPAIR_PREPARE_SOURCE);
        } catch {
          return err({
            code: "unavailable",
            message: "repair prepare source is not registered",
          });
        }
        const loaded = source.facts(input.problem);
        if (!loaded.ok) return loaded;
        const facts = loaded.value;
        if (facts.problem === null || facts.problem.id !== input.problem) {
          return notFound();
        }
        if (
          !inCodingScope(
            snapshot,
            ctx,
            repairPrepare.name,
            facts.problem.app,
          )
        ) return notFound();
        const prepared = prepareRepairTicket(facts, input);
        if (!prepared.ok) return prepared;
        return ok({
          outcome: prepared.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    checks: {
      route: ticketChecks,
      handle(snapshot, ctx, input) {
        const owner = snapshot.sql.get("SELECT app FROM tickets WHERE id = ?", [
          input.ticket,
        ]);
        // 범위 밖 ticket은 없는 ticket처럼 비어 있다.
        const visibleTicket = owner === undefined ||
          inCodingScope(snapshot, ctx, ticketChecks.name, String(owner.app));
        const completion = !visibleTicket ? undefined : snapshot.sql.get(
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

// 기본 data 모양. 기한·연결·조건·보고·test 원문은 이 값에 없다(R27).
function screenSummary(row: Record<string, unknown>): TicketScreenSummary {
  const state = stateOf(row.state);
  const readiness = readinessOf(row.readiness);
  return {
    id: String(row.id),
    app: String(row.app),
    kind: kindOf(row.kind),
    title: String(row.title),
    request: String(row.what),
    problem_count: Number(row.problem_count),
    screen_state: screenStateOf(state, readiness),
    next_action: nextActionOf(state, readiness),
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
