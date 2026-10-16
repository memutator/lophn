// ticket 표 읽기. command와 read가 같이 쓴다.
import { ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { ClaimRow } from "./expiry.ts";

type Reader = Pick<Sql, "get">;

export type StoredTicket = {
  id: string;
  app: string;
  state: string;
  revision: string;
  completion_seq: string | null;
};

export function loadTicket(
  sql: Reader,
  id: string,
): Result<StoredTicket | null> {
  const row = sql.get(
    "SELECT id, app, state, revision, completion_seq FROM tickets WHERE id = ?",
    [id],
  );
  if (row === undefined) return ok(null);
  return ok({
    id: String(row.id),
    app: String(row.app),
    state: String(row.state),
    revision: String(row.revision),
    completion_seq: row.completion_seq === null
      ? null
      : String(row.completion_seq),
  });
}

export function loadClaim(sql: Reader, ticket: string): ClaimRow | null {
  const row = sql.get(
    "SELECT session, claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
    [ticket],
  );
  if (row === undefined) return null;
  return {
    session: String(row.session),
    seq: String(row.claim_seq),
    expires_at: String(row.expires_at),
  };
}
