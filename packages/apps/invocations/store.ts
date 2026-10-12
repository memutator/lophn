import { err, ok, type Result } from "../../base/mod.ts";
import type { Invocation } from "../../protocol/apps/mod.ts";
import type { Sql, SqlRow, Tx } from "../../protocol/platform/mod.ts";
import { invocationFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored invocation" });
}

export function loadInvocation(
  sql: Query,
  id: string,
): Result<Invocation | null> {
  const row = sql.get("SELECT * FROM invocations WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  const invocation = invocationFromRow(row as SqlRow);
  if (!invocation.ok) return invocation;
  if (invocation.value.id !== id) return invalidStored();
  return invocation;
}

export type InvocationFilter = {
  app: string | undefined;
  status: Invocation["status"] | undefined;
};

export function loadInvocations(
  sql: Query,
  filter: InvocationFilter,
): Result<Invocation[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.app !== undefined) {
    conditions.push("app = ?");
    params.push(filter.app);
  }
  if (filter.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  const where = conditions.length > 0
    ? ` WHERE ${conditions.join(" AND ")}`
    : "";
  const rows = sql.all(
    `SELECT * FROM invocations${where} ORDER BY app, started_at, id`,
    params,
  );
  const invocations: Invocation[] = [];
  for (const row of rows) {
    const invocation = invocationFromRow(row);
    if (!invocation.ok) return invocation;
    invocations.push(invocation.value);
  }
  return ok(invocations);
}

// 종료 상태의 행은 schema trigger가 바꾸지 못하게 막는다. 전이 중인 행만 고친다.
export function insertInvocation(
  tx: Pick<Tx, "sql">,
  invocation: Invocation,
): void {
  tx.sql.run(
    `INSERT INTO invocations
      (id, app, release, mode, actor, caller, operation, trigger,
       approval, input_hash, status, started_at, finished_at, summary, detail_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invocation.id,
      invocation.app,
      invocation.release,
      invocation.mode,
      invocation.actor,
      JSON.stringify(invocation.caller),
      JSON.stringify(invocation.operation),
      JSON.stringify(invocation.trigger),
      invocation.approval,
      invocation.input_hash,
      invocation.status,
      invocation.started_at,
      invocation.finished_at,
      JSON.stringify(invocation.summary),
      invocation.detail_hash,
    ],
  );
}

export function updateInvocation(
  tx: Pick<Tx, "sql">,
  invocation: Invocation,
): Result<void> {
  const changed = tx.sql.run(
    `UPDATE invocations
     SET status = ?, started_at = ?, finished_at = ?, summary = ?, detail_hash = ?
     WHERE id = ?`,
    [
      invocation.status,
      invocation.started_at,
      invocation.finished_at,
      JSON.stringify(invocation.summary),
      invocation.detail_hash,
      invocation.id,
    ],
  );
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}
