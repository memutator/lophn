import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { type Grant, grantSchema } from "../../../protocol/apps/mod.ts";
import type { Sql, SqlRow, Tx } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored grant" });
}

export function grantFromRow(row: Record<string, unknown>): Result<Grant> {
  let scope: unknown;
  try {
    scope = JSON.parse(String(row.scope));
  } catch {
    return invalidStored();
  }
  const parsed = grantSchema.safeParse({
    id: row.id,
    app: row.app,
    kind: row.kind,
    scope,
    approval: row.approval,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    revoked_by: row.revoked_by,
    revoked_at: row.revoked_at,
  });
  return parsed.success ? ok(parsed.data) : invalidStored();
}

export function loadGrant(sql: Query, id: string): Result<Grant | null> {
  const row = sql.get("SELECT * FROM grants WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  return grantFromRow(row as SqlRow);
}

export function loadGrants(
  sql: Query,
  filter: { app?: string; status?: "active" | "revoked" },
): Result<Grant[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.app !== undefined) {
    where.push("app = ?");
    params.push(filter.app);
  }
  if (filter.status !== undefined) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const rows = sql.all(
    `SELECT * FROM grants ${
      where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`
    } ORDER BY id`,
    params,
  );
  const grants: Grant[] = [];
  for (const row of rows) {
    const grant = grantFromRow(row);
    if (!grant.ok) return grant;
    grants.push(grant.value);
  }
  return ok(grants);
}

export function insertGrant(tx: Pick<Tx, "sql">, grant: Grant): void {
  tx.sql.run(
    `INSERT INTO grants
      (id, app, kind, scope, approval, status, created_by, created_at,
       revoked_by, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      grant.id,
      grant.app,
      grant.kind,
      canonicalize(grant.scope),
      grant.approval,
      grant.status,
      grant.created_by,
      grant.created_at,
      grant.revoked_by,
      grant.revoked_at,
    ],
  );
}

export function markRevoked(
  tx: Pick<Tx, "sql">,
  id: string,
  revokedAt: string,
): Result<void> {
  const changed = tx.sql.run(
    `UPDATE grants SET status = 'revoked', revoked_by = 'user', revoked_at = ?
     WHERE id = ? AND status = 'active'`,
    [revokedAt, id],
  );
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}

// 앱의 grant 집합이 마지막으로 바뀐 event seq다. 없으면 "0".
// create·revoke의 비교 기준이고 activation이 시작 때 같은 값을 고정한다.
export function grantsSeq(sql: Query, app: string): string {
  const row = sql.get(
    `SELECT MAX(e.seq) AS seq FROM events e
     JOIN grants g ON g.id = e.subject
     WHERE g.app = ? AND e.type IN ('GrantCreated', 'GrantRevoked')`,
    [app],
  );
  const value = row?.seq;
  return value === null || value === undefined ? "0" : String(value);
}

// 앱에 activation이 진행 중이면 true. 시작 event는 있고 그 seq를 started_seq로 가리키는 성공·실패 event가
// 아직 없는 경우다(apps/releases#R13). release 표가 아니라 ledger event를 근거로 본다.
export function activationInProgress(sql: Query, app: string): boolean {
  return sql.get(
    `SELECT 1 AS found FROM events s
     WHERE s.type = 'ReleaseActivationStarted'
       AND json_extract(s.payload, '$.app') = ?
       AND NOT EXISTS (
         SELECT 1 FROM events e
         WHERE e.type IN ('ReleaseActivated', 'ReleaseActivationFailed')
           AND json_extract(e.payload, '$.started_seq') = CAST(s.seq AS TEXT)
       )
     LIMIT 1`,
    [app],
  ) !== undefined;
}

export type ProcessFact =
  | { kind: "none" }
  | { kind: "started"; nonce: string }
  | { kind: "stopped"; nonce: string };

// 마지막 프로세스 사실. supervisor가 남긴 AppStarted·AppStopped만 본다.
export function lastProcessFact(sql: Query, app: string): ProcessFact {
  const row = sql.get(
    `SELECT type, json_extract(payload, '$.process_nonce') AS nonce
     FROM events
     WHERE subject = ? AND type IN ('AppStarted', 'AppStopped')
     ORDER BY seq DESC LIMIT 1`,
    [app],
  );
  if (row === undefined) return { kind: "none" };
  const nonce = String(row.nonce);
  return row.type === "AppStarted"
    ? { kind: "started", nonce }
    : { kind: "stopped", nonce };
}
