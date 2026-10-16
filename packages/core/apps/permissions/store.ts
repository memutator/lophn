import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { type AppGrant, appGrantSchema } from "../../../protocol/apps/mod.ts";
import type { Sql, SqlRow, Tx } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored grant" });
}

function grantFromRow(row: Record<string, unknown>): Result<AppGrant> {
  let scope: unknown;
  try {
    scope = JSON.parse(String(row.scope));
  } catch {
    return invalidStored();
  }
  const parsed = appGrantSchema.safeParse({
    id: row.id,
    app: row.app,
    scope,
    status: row.status,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  });
  return parsed.success ? ok(parsed.data) : invalidStored();
}

export function loadGrant(sql: Query, id: string): Result<AppGrant | null> {
  const row = sql.get("SELECT * FROM grants WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  return grantFromRow(row as SqlRow);
}

export function loadGrants(
  sql: Query,
  filter: { app?: string; status?: "active" | "revoked" },
): Result<AppGrant[]> {
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
  const grants: AppGrant[] = [];
  for (const row of rows) {
    const grant = grantFromRow(row);
    if (!grant.ok) return grant;
    grants.push(grant.value);
  }
  return ok(grants);
}

// Grants.appGrants(app)의 근거다. 지금 active인 앱 grant만 준다.

export function insertGrant(tx: Pick<Tx, "sql">, grant: AppGrant): void {
  tx.sql.run(
    `INSERT INTO grants (id, app, kind, scope, status, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      grant.id,
      grant.app,
      grant.scope.kind,
      canonicalize(grant.scope),
      grant.status,
      grant.created_at,
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
    `UPDATE grants SET status = 'revoked', revoked_at = ?
     WHERE id = ? AND status = 'active'`,
    [revokedAt, id],
  );
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}

// 앱의 grant 집합이 바뀔 때마다 늘어나는 값이다(만든 grant 수 + 거둔 grant 수). 없으면 "0".
// releases가 승인 때 본 값으로 쓰는 동안만 남긴다.

type ProcessFact =
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
