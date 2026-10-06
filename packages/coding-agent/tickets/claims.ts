// ticket claim command(coding-agent/tickets#R11–R14, R16). claim은 범위 안
// coding_agent connection만, readiness ready·state open|check_failed·claim 없음·
// base_revision 일치일 때만 성공한다. 같은 ticket의 동시 claim은 ticket_claims의
// PK(ticket) unique가 하나만 남긴다. 한 connection의 여러 ticket claim은 막지 않는다.
// 기한은 claim·명시 갱신 시각부터 정확히 3,600,000ms다(expiry.ts).
import { err, ok, type Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../contracts/apps/mod.ts";
import {
  type CodingAgentConnectionAuthResult,
  ticketClaim,
  ticketClaimed,
  ticketClaimReleased,
  ticketClaimRenewed,
  ticketExpireClaim,
  ticketReleaseClaim,
  ticketRenewClaim,
} from "../../contracts/coding-agent/mod.ts";
import { connectionAuthSyncPort } from "../connection/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";

type TicketClaimInput = { ticket: string; base_revision: string };
type TicketSeqInput = TicketClaimInput & { claim_seq: string };
type TicketRenewClaimInput = TicketSeqInput;
type TicketReleaseClaimInput = TicketSeqInput;
type TicketExpireClaimInput = { ticket: string; claim_seq: string };
import {
  checkClaim,
  CLAIM_DURATION_MS,
  type ClaimCheck,
  type ClaimReject,
  type ClaimRow,
  expired,
} from "./expiry.ts";

type ConnectionAuth = CodingAgentConnectionAuthResult;

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

function unauthorized(message: string): Result<never> {
  return err({ code: "unauthorized", message });
}

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

type StoredTicket = {
  app: string;
  state: string;
  readiness: string;
  problems: string[];
  revision: string;
  completion_seq: string | null;
};

function loadTicket(tx: Tx, id: string): Result<StoredTicket | null> {
  const row = tx.sql.get(
    `SELECT app, state, readiness, problems, revision, completion_seq
     FROM tickets WHERE id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  const problems = JSON.parse(String(row.problems)) as unknown;
  return ok({
    app: String(row.app),
    state: String(row.state),
    readiness: String(row.readiness),
    problems: Array.isArray(problems) ? problems.map(String) : [],
    revision: String(row.revision),
    completion_seq: row.completion_seq === null
      ? null
      : String(row.completion_seq),
  });
}

function loadClaim(tx: Tx, ticket: string): ClaimRow | null {
  const row = tx.sql.get(
    "SELECT connection, claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
    [ticket],
  );
  if (row === undefined) return null;
  return {
    connection: String(row.connection),
    seq: String(row.claim_seq),
    expires_at: String(row.expires_at),
  };
}

// 회수 credential은 인증 port가 revoked로 답한다. command handler는 동기라
// port도 동기여야 한다. 제품 등록은 connection 표의 동기 lookup을 이 port에 건다.
function connectionOf(
  tx: Tx,
  principal: string,
): Result<ConnectionAuth | null> {
  const auth = tx.port(connectionAuthSyncPort) as (
    principal: string,
  ) => ConnectionAuth | undefined;
  const found = auth(principal);
  if (found instanceof Promise) {
    return unauthorized("connection auth is not available in this transaction");
  }
  return ok(found ?? null);
}

function revisionAgrees(
  stored: string,
  base: string,
  compare: string,
): boolean {
  return stored === base && base === compare;
}

// 범위 안 connection만 claim한다. all은 모든 앱, app은 그 앱 하나다(R11).
function inScope(auth: ConnectionAuth, app: string): boolean {
  return auth.scope.kind === "all" || auth.scope.app === app;
}

// 다음 event seq. events는 삭제 trigger가 있어 seq가 비지 않는다.
// claim_seq는 이어지는 TicketClaimed의 seq와 같아야 한다(domain model).
function nextEventSeq(tx: Tx): string {
  const row = tx.sql.get("SELECT MAX(seq) AS seq FROM events", []);
  const current = row?.seq;
  const n = typeof current === "bigint"
    ? current
    : typeof current === "number"
    ? BigInt(current)
    : 0n;
  return (n + 1n).toString(10);
}

type ClaimOutput = {
  ticket: string;
  connection: string;
  claim_seq: string;
  expires_at: string;
};

export function createTicketClaimCommands(): {
  claim: CommandDefinition<typeof ticketClaim>;
  renew_claim: CommandDefinition<typeof ticketRenewClaim>;
  release_claim: CommandDefinition<typeof ticketReleaseClaim>;
  expire_claim: CommandDefinition<typeof ticketExpireClaim>;
} {
  const nowMs = (tx: Tx) => Date.parse(tx.now());
  return {
    claim: {
      route: ticketClaim,
      handle(tx, ctx, input, compare) {
        return claimTicket(tx, ctx, input, compare, nowMs(tx));
      },
    },
    renew_claim: {
      route: ticketRenewClaim,
      handle(tx, ctx, input, compare) {
        return renewClaim(tx, ctx, input, compare, nowMs(tx));
      },
    },
    release_claim: {
      route: ticketReleaseClaim,
      handle(tx, ctx, input, compare) {
        return releaseClaim(tx, ctx, input, compare, nowMs(tx));
      },
    },
    expire_claim: {
      route: ticketExpireClaim,
      handle(tx, _ctx, input) {
        // 만료 판단은 커밋 시각이다. writer clock이 그 시각을 따라간다.
        return expireClaim(tx, input, nowMs(tx));
      },
    },
  };
}

function claimTicket(
  tx: Tx,
  ctx: RequestContext,
  input: TicketClaimInput,
  compare: { base_revision: string },
  at: number,
): Result<ClaimOutput> {
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
  if (stored.readiness !== "ready") {
    return conflict("ticket is not ready");
  }
  if (stored.state !== "open" && stored.state !== "check_failed") {
    return conflict("ticket is not open for a claim");
  }
  if (
    !revisionAgrees(stored.revision, input.base_revision, compare.base_revision)
  ) {
    return conflict("ticket revision changed");
  }
  if (loadClaim(tx, input.ticket) !== null) {
    return conflict("ticket already has a claim");
  }
  const registered = tx.port(appRegistrationLookup).get(stored.app);
  if (!registered.ok) return registered;
  if (registered.value === null) return notFound("app does not exist");
  const expires = new Date(at + CLAIM_DURATION_MS).toISOString();
  // claim_seq는 이번 TicketClaimed의 seq다(domain model). events는 불변이라
  // payload에 자기 seq를 미리 넣고, emit이 그 다음 rowid를 쓴다.
  const seq = nextEventSeq(tx);
  const emitted = tx.emit(ticketClaimed, input.ticket, {
    app: stored.app,
    problems: stored.problems,
    connection: auth.value.connection,
    claim_seq: seq,
    expires_at: expires,
  });
  if (emitted !== seq) return conflict("claim seq does not match the event");
  tx.sql.run(
    `INSERT INTO ticket_claims (ticket, connection, claim_seq, expires_at)
     VALUES (?, ?, ?, ?)`,
    [input.ticket, auth.value.connection, seq, expires],
  );
  tx.sql.run(
    "UPDATE tickets SET state = 'claimed', revision = ? WHERE id = ?",
    [seq, input.ticket],
  );
  return ok({
    ticket: input.ticket,
    connection: auth.value.connection,
    claim_seq: seq,
    expires_at: expires,
  });
}

function renewClaim(
  tx: Tx,
  ctx: RequestContext,
  input: TicketRenewClaimInput,
  compare: { base_revision: string },
  at: number,
): Result<ClaimOutput> {
  const held = currentClaim(tx, ctx, input, compare, at);
  if (!held.ok) return held;
  const expires = new Date(at + CLAIM_DURATION_MS).toISOString();
  const seq = tx.emit(ticketClaimRenewed, input.ticket, {
    connection: held.value.claim.connection,
    claim_seq: held.value.claim.seq,
    before_expires_at: held.value.claim.expires_at,
    expires_at: expires,
  });
  tx.sql.run(
    "UPDATE ticket_claims SET expires_at = ? WHERE ticket = ? AND claim_seq = ?",
    [expires, input.ticket, held.value.claim.seq],
  );
  tx.sql.run("UPDATE tickets SET revision = ? WHERE id = ?", [
    seq,
    input.ticket,
  ]);
  return ok({
    ticket: input.ticket,
    connection: held.value.claim.connection,
    claim_seq: held.value.claim.seq,
    expires_at: expires,
  });
}

function releaseClaim(
  tx: Tx,
  ctx: RequestContext,
  input: TicketReleaseClaimInput,
  compare: { base_revision: string },
  at: number,
): Result<{ ticket: string; state: "open" }> {
  const held = currentClaim(tx, ctx, input, compare, at);
  if (!held.ok) return held;
  return endClaim(tx, held.value, "returned");
}

function expireClaim(
  tx: Tx,
  input: TicketExpireClaimInput,
  at: number,
): Result<{ ticket: string; state: "open" }> {
  const ticket = loadTicket(tx, input.ticket);
  if (!ticket.ok) return ticket;
  if (ticket.value === null) return conflict("ticket does not exist");
  const claim = loadClaim(tx, input.ticket);
  if (claim === null || claim.seq !== input.claim_seq) {
    return conflict("claim changed");
  }
  const auth = connectionOf(tx, `coding_agent:${claim.connection}`);
  if (!auth.ok) return conflict("connection auth is not available");
  const revoked = auth.value !== null && auth.value.state === "revoked";
  const due = Date.parse(claim.expires_at);
  if (!revoked && !expired(due, at)) {
    return conflict("claim has not expired");
  }
  return endClaim(
    tx,
    { ticket: { ...ticket.value, id: input.ticket }, claim },
    revoked ? "connection_revoked" : "expired",
  );
}

type Held = { ticket: StoredTicket & { id: string }; claim: ClaimRow };

function currentClaim(
  tx: Tx,
  ctx: RequestContext,
  input: { ticket: string; claim_seq: string; base_revision: string },
  compare: { base_revision: string },
  at: number,
): Result<Held> {
  const auth = connectionOf(tx, ctx.principal);
  if (!auth.ok) return auth;
  if (auth.value === null) return unauthorized("connection does not exist");
  if (auth.value.state !== "active") {
    return unauthorized("connection is revoked");
  }
  const ticket = loadTicket(tx, input.ticket);
  if (!ticket.ok) return ticket;
  if (ticket.value === null) return forbidden("ticket does not exist");
  const stored = ticket.value;
  if (!inScope(auth.value, stored.app)) {
    return forbidden("ticket is outside the connection scope");
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
  if (expired(Date.parse(claim.expires_at), at)) {
    return conflict("claim has expired");
  }
  return ok({ ticket: { ...stored, id: input.ticket }, claim });
}

function endClaim(
  tx: Tx,
  held: { ticket: StoredTicket & { id: string }; claim: ClaimRow },
  reason: "returned" | "expired" | "connection_revoked",
): Result<{ ticket: string; state: "open" }> {
  const seq = tx.emit(ticketClaimReleased, held.ticket.id, {
    app: held.ticket.app,
    problems: held.ticket.problems,
    connection: held.claim.connection,
    claim_seq: held.claim.seq,
    reason,
  });
  // 현재 claim 행만 지운다. 과거 완료 보고·check·completion_seq는 남긴다(R14).
  const removed = tx.sql.run(
    "DELETE FROM ticket_claims WHERE ticket = ? AND claim_seq = ?",
    [held.ticket.id, held.claim.seq],
  );
  if (Number(removed.changes) !== 1) return conflict("claim changed");
  tx.sql.run(
    "UPDATE tickets SET state = 'open', revision = ? WHERE id = ?",
    [seq, held.ticket.id],
  );
  return ok({ ticket: held.ticket.id, state: "open" });
}

// 정리 후보. 만료됐거나 회수된 connection의 현재 claim이다. 감독 timer와 재시작이
// 이 목록을 읽고 ticket.expire_claim을 제출한다. timer 자체는 표를 쓰지 않는다.
export function expiredClaims(
  sql: Pick<Tx["sql"], "all">,
  now: string,
  revoked: readonly string[],
): { ticket: string; claim_seq: string }[] {
  const rows = sql.all(
    `SELECT ticket, claim_seq, connection FROM ticket_claims
     WHERE expires_at <= ? OR connection IN (${
      revoked.map(() => "?").join(", ") || "''"
    })
     ORDER BY ticket`,
    [now, ...revoked],
  );
  return rows.map((row) => ({
    ticket: String(row.ticket),
    claim_seq: String(row.claim_seq),
  }));
}

// checkTicketClaim. 같은 transaction의 다른 command가 현재 claim을 확인한다.
// 읽기·준비는 claim 기한을 연장하지 않는다(R12, R13).
export function checkTicketClaim(
  tx: Tx,
  input: {
    ticket: string;
    claim_seq: string;
    connection: string;
    now: string;
  },
): Result<ClaimCheck> {
  const ticket = loadTicket(tx, input.ticket);
  if (!ticket.ok) return ticket;
  if (ticket.value === null) return ok({ ok: false, reason: "missing" });
  const claim = loadClaim(tx, input.ticket);
  const auth = connectionOf(tx, `coding_agent:${input.connection}`);
  if (!auth.ok) return auth;
  const reason = checkClaim({
    state: ticket.value.state,
    readiness: ticket.value.readiness,
    claim,
    connection: input.connection,
    claim_seq: input.claim_seq,
    connection_revoked: auth.value !== null && auth.value.state === "revoked",
    now_ms: Date.parse(input.now),
    expires_at_ms: claim === null ? null : Date.parse(claim.expires_at),
  });
  return ok(reason.ok ? { ...reason, app: ticket.value.app } : reason);
}

export type { ClaimReject };
