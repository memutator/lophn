import { err, ok, type Result } from "../../../../base/mod.ts";
import type { Connection } from "../../../../protocol/coding-agent/mod.ts";
import type { Sql, Tx } from "../../../../protocol/server/mod.ts";
import { connectionFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored connection" });
}

export function loadConnection(
  sql: Query,
  id: string,
): Result<Connection | null> {
  const row = sql.get(
    "SELECT id, label, scope_kind, scope_app, principal, state, revision FROM coding_agent_connections WHERE id = ?",
    [id],
  );
  if (row === undefined) return ok(null);
  return connectionFromRow(row);
}

export function loadByPrincipal(
  sql: Query,
  principal: string,
): Result<{ connection: Connection; token_hash: string } | null> {
  const row = sql.get(
    "SELECT id, label, scope_kind, scope_app, principal, token_hash, state, revision FROM coding_agent_connections WHERE principal = ?",
    [principal],
  );
  if (row === undefined) return ok(null);
  const connection = connectionFromRow(row);
  if (!connection.ok) return connection;
  if (typeof row.token_hash !== "string") return invalidStored();
  return ok({ connection: connection.value, token_hash: row.token_hash });
}

export function listConnections(
  sql: Query,
  filter: {
    state?: string;
    scope_kind?: string;
    scope_app?: string | null;
  },
): Result<Connection[]> {
  const rows = sql.all(
    `SELECT id, label, scope_kind, scope_app, principal, state, revision
     FROM coding_agent_connections
     WHERE (? IS NULL OR state = ?)
       AND (? IS NULL OR scope_kind = ?)
       AND (? IS NULL OR scope_app IS ?)
     ORDER BY id`,
    [
      filter.state ?? null,
      filter.state ?? null,
      filter.scope_kind ?? null,
      filter.scope_kind ?? null,
      filter.scope_app === undefined ? null : filter.scope_app,
      filter.scope_app === undefined ? null : filter.scope_app,
    ],
  );
  const connections: Connection[] = [];
  for (const row of rows) {
    const connection = connectionFromRow(row);
    if (!connection.ok) return connection;
    connections.push(connection.value);
  }
  return ok(connections);
}

export function insertConnection(
  tx: Pick<Tx, "sql">,
  connection: Connection,
  tokenHash: string,
): void {
  const scopeApp = connection.scope.kind === "app"
    ? connection.scope.app
    : null;
  tx.sql.run(
    `INSERT INTO coding_agent_connections
      (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      connection.id,
      connection.label,
      connection.scope.kind,
      scopeApp,
      connection.principal,
      tokenHash,
      connection.state,
      connection.revision,
    ],
  );
}

export function markRevoked(
  tx: Pick<Tx, "sql">,
  connection: Connection,
): Result<void> {
  const changed = tx.sql.run(
    `UPDATE coding_agent_connections
     SET state = ?, revision = ?
     WHERE id = ? AND state = 'active'`,
    [connection.state, connection.revision, connection.id],
  );
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}
