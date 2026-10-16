// ticket claim command. claim의 주인은 coding session이다. open이나 failed ticket을 claim할 수 있고,
// 같은 ticket의 동시 claim은 ticket_claims의 PK(ticket)가 하나만 남긴다. 기한은 claim·명시 갱신
// 시각부터 정확히 3,600,000ms다(expiry.ts). 시작·갱신·반납은 event가 아니고 만료만 event다.
import { ok, type Result } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import {
  ticketClaim,
  ticketExpireClaim,
  ticketRenewClaim,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import type { TicketClaimCheckResult } from "../../../protocol/coding-agent/ticket/mod.ts";
import { ticketClaimExpired } from "../../../protocol/events/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  checkClaim,
  CLAIM_DURATION_MS,
  type ClaimRow,
  expired,
} from "./expiry.ts";
import {
  checkApp,
  codingSessionOf,
  conflict,
  forbidden,
  nextRevision,
  notFound,
  revisionAgrees,
} from "./model.ts";
import { loadClaim, loadTicket, type StoredTicket } from "./store.ts";

type ClaimOutput = {
  ticket: string;
  session: string;
  claim_seq: string;
  expires_at: string;
};

export function createTicketClaimCommands(): {
  claim: CommandDefinition<typeof ticketClaim>;
  renew_claim: CommandDefinition<typeof ticketRenewClaim>;
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
        const held = currentClaim(tx, ctx, input, compare, nowMs(tx));
        if (!held.ok) return held;
        const expires = new Date(nowMs(tx) + CLAIM_DURATION_MS).toISOString();
        tx.sql.run(
          "UPDATE ticket_claims SET expires_at = ? WHERE ticket = ? AND claim_seq = ?",
          [expires, input.ticket, held.value.claim.seq],
        );
        return ok({
          ticket: input.ticket,
          session: held.value.claim.session,
          claim_seq: held.value.claim.seq,
          expires_at: expires,
        });
      },
    },
    expire_claim: {
      route: ticketExpireClaim,
      handle(tx, _ctx, input) {
        // 만료 판단은 커밋 시각이다.
        const ticket = loadTicket(tx.sql, input.ticket);
        if (!ticket.ok) return ticket;
        if (ticket.value === null) return conflict("ticket does not exist");
        const claim = loadClaim(tx.sql, input.ticket);
        if (claim === null || claim.seq !== input.claim_seq) {
          return conflict("claim changed");
        }
        if (!expired(Date.parse(claim.expires_at), nowMs(tx))) {
          return conflict("claim has not expired");
        }
        const ended = endClaim(tx, ticket.value, claim);
        if (!ended.ok) return ended;
        tx.emit(ticketClaimExpired, input.ticket, {
          app: ticket.value.app,
          session: claim.session,
        });
        return ok({ ticket: input.ticket, state: "open" as const });
      },
    },
  };
}

function claimTicket(
  tx: Tx,
  ctx: RequestContext,
  input: { ticket: string; base_revision: string },
  compare: { base_revision: string },
  at: number,
): Result<ClaimOutput> {
  const session = codingSessionOf(ctx.actor);
  if (session === undefined) return forbidden("only a coding session claims");
  const loaded = loadTicket(tx.sql, input.ticket);
  if (!loaded.ok) return loaded;
  const stored = loaded.value;
  if (stored === null) return notFound("ticket does not exist");
  const scope = checkApp(tx.port, ctx, stored.app);
  if (!scope.ok) return scope;
  if (stored.state !== "open" && stored.state !== "failed") {
    return conflict("ticket is not open for a claim");
  }
  if (
    !revisionAgrees(stored.revision, input.base_revision, compare.base_revision)
  ) return conflict("ticket revision changed");
  if (loadClaim(tx.sql, input.ticket) !== null) {
    return conflict("ticket already has a claim");
  }
  const registered = tx.port(appRegistrationLookup).get(stored.app);
  if (!registered.ok) return registered;
  if (registered.value === null) return notFound("app does not exist");
  const expires = new Date(at + CLAIM_DURATION_MS).toISOString();
  // claim_seq는 claim 때의 revision이다. ticket 안에서 겹치지 않는다.
  const seq = nextRevision(stored.revision);
  tx.sql.run(
    `INSERT INTO ticket_claims (ticket, session, claim_seq, expires_at)
     VALUES (?, ?, ?, ?)`,
    [input.ticket, session, seq, expires],
  );
  tx.sql.run(
    "UPDATE tickets SET state = 'claimed', revision = ? WHERE id = ?",
    [seq, input.ticket],
  );
  return ok({
    ticket: input.ticket,
    session,
    claim_seq: seq,
    expires_at: expires,
  });
}

type Held = { ticket: StoredTicket; claim: ClaimRow; session: string };

// 갱신과 보고가 같이 쓰는 현재 claim 검사다.
export function currentClaim(
  tx: Tx,
  ctx: RequestContext,
  input: { ticket: string; claim_seq: string; base_revision: string },
  compare: { base_revision: string },
  at: number,
): Result<Held> {
  const session = codingSessionOf(ctx.actor);
  if (session === undefined) return forbidden("only a coding session");
  const loaded = loadTicket(tx.sql, input.ticket);
  if (!loaded.ok) return loaded;
  const stored = loaded.value;
  if (stored === null) return forbidden("ticket does not exist");
  const scope = checkApp(tx.port, ctx, stored.app);
  if (!scope.ok) return scope;
  if (
    !revisionAgrees(stored.revision, input.base_revision, compare.base_revision)
  ) return conflict("ticket revision changed");
  const claim = loadClaim(tx.sql, input.ticket);
  if (claim === null) return conflict("ticket has no claim");
  if (claim.session !== session) {
    return forbidden("claim belongs to another session");
  }
  if (claim.seq !== input.claim_seq) return conflict("claim changed");
  if (expired(Date.parse(claim.expires_at), at)) {
    return conflict("claim has expired");
  }
  return ok({ ticket: stored, claim, session });
}

// 현재 claim 행을 지우고 ticket을 open으로 되돌린다. 과거 완료 보고·결과는 남는다.
export function endClaim(
  tx: Tx,
  ticket: StoredTicket,
  claim: ClaimRow,
): Result<void> {
  const removed = tx.sql.run(
    "DELETE FROM ticket_claims WHERE ticket = ? AND claim_seq = ?",
    [ticket.id, claim.seq],
  );
  if (Number(removed.changes) !== 1) return conflict("claim changed");
  tx.sql.run("UPDATE tickets SET state = 'open', revision = ? WHERE id = ?", [
    nextRevision(ticket.revision),
    ticket.id,
  ]);
  return ok(undefined);
}

// 만료 정리 후보. 감독 timer가 60초마다와 재시작 때 읽고 expire_claim을 제출한다.
export function expiredClaims(
  sql: Pick<Sql, "all">,
  now: string,
): { ticket: string; claim_seq: string }[] {
  return sql.all(
    "SELECT ticket, claim_seq FROM ticket_claims WHERE expires_at <= ? ORDER BY ticket",
    [now],
  ).map((row) => ({
    ticket: String(row.ticket),
    claim_seq: String(row.claim_seq),
  }));
}

// release 준비가 같은 transaction에서 현재 claim을 확인한다. 기한을 연장하지 않는다.
export function checkTicketClaim(
  tx: Pick<Tx, "sql">,
  input: { ticket: string; claim_seq: string; session: string; now: string },
): Result<TicketClaimCheckResult> {
  const ticket = loadTicket(tx.sql, input.ticket);
  if (!ticket.ok) return ticket;
  if (ticket.value === null) return ok({ ok: false, reason: "missing" });
  const checked = checkClaim({
    state: ticket.value.state,
    claim: loadClaim(tx.sql, input.ticket),
    session: input.session,
    claim_seq: input.claim_seq,
    now_ms: Date.parse(input.now),
  });
  return ok(checked.ok ? { ...checked, app: ticket.value.app } : checked);
}
