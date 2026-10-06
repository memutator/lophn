// ticket 완료 보고·취소 command(coding-agent/tickets#R15, R17, R22, R23,
// connection#R18). 보고는 현재 유효 claim과 release 역조회가 같은 transaction에서
// 지나고, 접수 때 claim을 끝낸다(R17). 취소는 user라면 확인 창 없이, revert 적용
// machine이라면 외부 claim·보고·결과가 한 번도 없을 때만 성공한다(R22).
// 취소 직후 옛 claim의 갱신·보고는 claim 행 삭제와 state 전이로 거절된다(R23).
import { err, ok, type Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../contracts/apps/mod.ts";
import {
  type TicketCancelInput,
  type TicketReportCompletionInput,
  ticketCancel,
  ticketCancelled,
  ticketCompletionReported,
  ticketReportCompletion,
} from "../../contracts/coding-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import {
  type StoredTicket,
  connectionOf,
  inScope,
  loadClaim,
  loadTicket,
  nextEventSeq,
  revisionAgrees,
} from "./claims.ts";
import {
  cancelActorAllowed,
  parseTicketSource,
  releaseSourceMatches,
} from "./model.ts";

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

function unauthorized(message: string): Result<never> {
  return err({ code: "unauthorized", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

// 완료 보고 값. release·참조 검사가 읽는다.
type Completion = TicketReportCompletionInput["completion"];

export function createTicketFinishCommands(): {
  report_completion: CommandDefinition<typeof ticketReportCompletion>;
  cancel: CommandDefinition<typeof ticketCancel>;
} {
  const nowMs = (tx: Tx) => Date.parse(tx.now());
  return {
    report_completion: {
      route: ticketReportCompletion,
      handle(tx, ctx, input, compare) {
        return reportCompletion(tx, ctx, input, compare, nowMs(tx));
      },
    },
    cancel: {
      route: ticketCancel,
      handle(tx, ctx, input, compare) {
        return cancelTicket(tx, ctx, input, compare);
      },
    },
  };
}

// 보고 접수는 claim을 끝낸다. 관계 검사와 새 event·표 갱신은 한 transaction이다(R17).
function reportCompletion(
  tx: Tx,
  ctx: RequestContext,
  input: TicketReportCompletionInput,
  compare: { base_revision: string },
  at: number,
): Result<{ ticket: string; state: "reported"; completion_seq: string }> {
  const auth = connectionOf(tx, ctx.principal);
  if (!auth.ok) return auth;
  if (auth.value === null) return unauthorized("connection does not exist");
  if (auth.value.state !== "active") {
    return unauthorized("connection is revoked");
  }
  const ticket = loadTicket(tx, input.ticket);
  if (!ticket.ok) return ticket;
  if (ticket.value === null) return notFound("ticket does not exist");
  const stored = ticket.value;
  if (!inScope(auth.value, stored.app)) {
    return forbidden("ticket is outside the connection scope");
  }
  // 접수·반납 뒤의 state다. 기한 전 현재 claim이 있어야 보고한다.
  if (stored.state !== "claimed") {
    return conflict("ticket has no claim");
  }
  if (
    !revisionAgrees(stored.revision, input.base_revision, compare.base_revision)
  ) {
    return conflict("ticket revision changed");
  }
  const claim = loadClaim(tx, input.ticket);
  if (claim === null) return conflict("ticket has no claim");
  if (claim.connection !== auth.value.connection) {
    return forbidden("claim belongs to another connection");
  }
  if (claim.seq !== input.claim_seq) return conflict("claim changed");
  if (Date.parse(claim.expires_at) <= at) return conflict("claim has expired");
  const registered = tx.port(appRegistrationLookup).get(stored.app);
  if (!registered.ok) return registered;
  if (registered.value === null) return notFound("app does not exist");
  // 검사한 claim에 같은 앱의 release가 준비돼 있어야 한다(R15).
  const source = releaseSource(tx.sql, input.completion.release);
  if (source === null) return notFound("release does not exist");
  if (
    !releaseSourceMatches(
      source.ticket_source,
      source.app,
      stored.app,
      input.ticket,
      input.claim_seq,
    )
  ) {
    return conflict("release is not prepared through this ticket claim");
  }
  // 입력 refine이 hash를 검사하지만 handler도 같은 준비를 본다(contracts#T40 선례).
  if (input.summary_blob.hash !== input.completion.summary_hash) {
    return invalid("summary blob hash가 summary_hash와 다르다");
  }
  const references = completionReferences(
    tx,
    input.ticket,
    stored,
    stored.kind,
    input.completion,
  );
  if (!references.ok) return references;
  // 준비 증거를 본 뒤 같은 transaction에 영구 참조를 등록한다(저장되지 않은
  // blob의 hash는 참조가 되지 못한다).
  const seq = nextEventSeq(tx);
  const emitted = tx.emit(ticketCompletionReported, input.ticket, {
    app: stored.app,
    problems: stored.problems,
    completion_seq: seq,
    claim_seq: input.claim_seq,
    release: input.completion.release,
    fix_records: [...input.completion.fix_records],
    summary_hash: input.completion.summary_hash,
    outputs: [...input.completion.outputs],
    verifications: [...input.completion.verifications],
  });
  if (emitted !== seq) {
    return conflict("completion seq does not match the event");
  }
  const registeredRef = tx.registerBlobRef({
    owner_kind: "ticket",
    owner_key: input.ticket,
    field: "summary",
    registered_seq: seq,
    source: { kind: "prepared", blob: { ...input.summary_blob } },
  });
  if (!registeredRef.ok) return registeredRef;
  tx.sql.run(
    `INSERT INTO ticket_completions
       (ticket, seq, claim_seq, release, summary_hash, outputs, fix_records, verifications)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ticket,
      seq,
      input.claim_seq,
      input.completion.release,
      input.completion.summary_hash,
      JSON.stringify(input.completion.outputs),
      JSON.stringify([...input.completion.fix_records]),
      JSON.stringify(input.completion.verifications),
    ],
  );
  // 접수 때 claim을 끝낸다(R17). ticket은 reported로 남고 machine 검사 전까지
  // confirmed가 되지 않는다.
  tx.sql.run(
    "DELETE FROM ticket_claims WHERE ticket = ? AND claim_seq = ?",
    [input.ticket, input.claim_seq],
  );
  tx.sql.run(
    `UPDATE tickets SET state = 'reported', completion_seq = ?, revision = ?
     WHERE id = ?`,
    [seq, seq, input.ticket],
  );
  return ok({
    ticket: input.ticket,
    state: "reported",
    completion_seq: seq,
  });
}

type ReleaseSourceRow = {
  app: string;
  ticket_source: { ticket: string; claim_seq: string } | null;
};

// release 역조회. ticket_source는 claim 출처의 사본이 아니라 원 seq다(R15).
function releaseSource(
  sql: Pick<Tx["sql"], "get">,
  release: string,
): ReleaseSourceRow | null {
  const row = sql.get(
    "SELECT app, ticket_source FROM releases WHERE id = ?",
    [release],
  );
  if (row === undefined) return null;
  return {
    app: String(row["app"]),
    ticket_source: parseTicketSource(
      row["ticket_source"] === null ? null : String(row["ticket_source"]),
    ),
  };
}

// 완료 보고 참조. outputs는 문서 version, verifications는 실제 runner 기록이고
// fix_records는 이 ticket claim의 고친 기록이다(R17, R15).
function completionReferences(
  tx: Tx,
  ticket: string,
  stored: StoredTicket,
  kind: "implementation" | "repair",
  completion: Completion,
): Result<void> {
  const outputs = new Set(completion.outputs);
  if (outputs.size !== completion.outputs.length) {
    return invalid("duplicate output");
  }
  for (const version of completion.outputs) {
    const row = tx.sql.get(
      "SELECT id FROM versions WHERE id = ?",
      [version],
    );
    if (row === undefined) return notFound("version does not exist");
  }
  const verifications = new Set(completion.verifications);
  if (verifications.size !== completion.verifications.length) {
    return invalid("duplicate verification");
  }
  for (const verification of completion.verifications) {
    const row = tx.sql.get(
      "SELECT app FROM verifications WHERE id = ?",
      [verification],
    );
    if (row === undefined) return notFound("verification does not exist");
    if (String(row["app"]) !== stored.app) {
      return invalid("verification belongs to another app");
    }
  }
  const seen = new Set<string>();
  for (const seq of completion.fix_records) {
    if (seen.has(seq)) return invalid("duplicate fix record");
    seen.add(seq);
    const row = tx.sql.get(
      `SELECT subject, payload FROM events
       WHERE seq = ? AND type = 'ProblemFixRecorded'`,
      [Number(seq)],
    );
    if (row === undefined) return notFound("fix record does not exist");
    const payload = JSON.parse(String(row["payload"])) as {
      ticket?: string | null;
      after?: string;
    };
    if (payload.ticket !== ticket) {
      return notFound("fix record does not belong to this ticket");
    }
    if (payload.after !== completion.release) {
      return invalid("fix record after release differs");
    }
    const problem = String(row["subject"]);
    if (!stored.problems.includes(problem)) {
      return invalid("fix record problem is not in this ticket");
    }
  }
  // repair는 대상 문제 각각의 고친 기록이 필수다(R17).
  if (kind === "repair") {
    for (const problem of stored.problems) {
      const covered = completion.fix_records.some((seq) => {
        const row = tx.sql.get(
          `SELECT 1 AS found FROM events
           WHERE seq = ? AND type = 'ProblemFixRecorded' AND subject = ?`,
          [Number(seq), problem],
        );
        return row !== undefined;
      });
      if (!covered) {
        return conflict("problem has no fix record");
      }
    }
  }
  return ok(undefined);
}

function cancelTicket(
  tx: Tx,
  ctx: RequestContext,
  input: TicketCancelInput,
  compare: { base_revision: string },
): Result<{ ticket: string; state: "cancelled" }> {
  if (!cancelActorAllowed(ctx.actor)) {
    return forbidden("actor is not allowed to cancel tickets");
  }
  const row = loadTicket(tx, input.ticket);
  if (!row.ok) return row;
  if (row.value === null) return notFound("ticket does not exist");
  const stored = row.value;
  // 종료된 ticket은 다시 취소하지 않는다(R19).
  if (stored.state === "confirmed" || stored.state === "cancelled") {
    return conflict("ticket is already ended");
  }
  if (
    !revisionAgrees(stored.revision, input.base_revision, compare.base_revision)
  ) {
    return conflict("ticket revision changed");
  }
  // revert 적용 machine은 외부 claim·보고·결과가 한 번도 없을 때만 취소한다(R22).
  const parts = parseActorKind(ctx.actor);
  if (parts === "machine") {
    if (externalHistory(tx.sql, input.ticket)) {
      return forbidden(
        "a revert cancel needs a ticket without external history",
      );
    }
  }
  const claim = loadClaim(tx, input.ticket);
  const seq = tx.emit(ticketCancelled, input.ticket, {
    app: stored.app,
    problems: stored.problems,
    reason: input.reason,
    released_claim: claim === null ? null : claim.seq,
    completion_seq: stored.completion_seq,
    fix_records: completionFixRecords(tx.sql, input.ticket),
  });
  // 종료 전 현재 claim을 반납한다. 과거 완료 보고·check는 남는다(R23).
  tx.sql.run(
    "DELETE FROM ticket_claims WHERE ticket = ?",
    [input.ticket],
  );
  tx.sql.run(
    `UPDATE tickets SET state = 'cancelled', cancel_reason = ?, revision = ?
     WHERE id = ?`,
    [input.reason, seq, input.ticket],
  );
  // confirmed·cancelled가 된 ticket만 예약 행이 제거된다(OPEN_REPAIR_GUARD).
  tx.sql.run(
    "DELETE FROM ticket_open_repair_problems WHERE ticket = ?",
    [input.ticket],
  );
  return ok({ ticket: input.ticket, state: "cancelled" });
}

// 과거 완료 보고가 가리킨 고친 기록. 취소에도 보존 사실을 남긴다(R23).
function completionFixRecords(
  sql: Pick<Tx["sql"], "get">,
  ticket: string,
): string[] {
  const row = sql.get(
    "SELECT fix_records FROM ticket_completions WHERE ticket = ?",
    [ticket],
  );
  if (row === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row["fix_records"]));
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

// 취소할 수 없는 외부 이력. claim·보고·결과 중 하나라도 있으면 있다(R22).
function externalHistory(
  sql: Pick<Tx["sql"], "get">,
  ticket: string,
): boolean {
  const claimed = sql.get(
    `SELECT 1 AS found FROM events
     WHERE subject = ? AND type = 'TicketClaimed' LIMIT 1`,
    [ticket],
  );
  const reported = sql.get(
    `SELECT 1 AS found FROM events
     WHERE subject = ? AND type = 'TicketCompletionReported' LIMIT 1`,
    [ticket],
  );
  const completed = sql.get(
    "SELECT 1 AS found FROM ticket_completions WHERE ticket = ? LIMIT 1",
    [ticket],
  );
  const checks = sql.get(
    "SELECT 1 AS found FROM ticket_check_results WHERE ticket = ? LIMIT 1",
    [ticket],
  );
  return claimed !== undefined || reported !== undefined ||
    completed !== undefined || checks !== undefined;
}

function parseActorKind(actor: string): string | undefined {
  const match = /^([a-z_]+):/.exec(actor);
  const plain = actor === "user" || actor === "machine";
  return plain ? actor : match === null ? undefined : match[1];
}
