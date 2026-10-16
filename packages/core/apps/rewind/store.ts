import { err, ok, type Result } from "../../../base/mod.ts";
import type { Actor } from "../../../protocol/base/actor.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { At } from "../../../protocol/base/values.ts";
import { type Rewind, rewindSchema } from "../../../protocol/apps/calls/mod.ts";
import type { Sql, SqlRow } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;
type Reason = NonNullable<Rewind["reason"]>;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored rewind" });
}

function fromRow(row: SqlRow): Result<Rewind> {
  let invocations: unknown;
  try {
    invocations = JSON.parse(String(row.invocations));
  } catch {
    return invalidStored();
  }
  const parsed = rewindSchema.safeParse({
    id: row.id,
    app: row.app,
    release: row.release,
    from_invocation: row.from_invocation,
    requested_by: row.requested_by,
    status: row.status,
    reason: row.reason_code === null
      ? null
      : { code: row.reason_code, message: row.reason_message },
    invocations,
    started_at: row.started_at,
    finished_at: row.finished_at,
  });
  return parsed.success ? ok(parsed.data) : invalidStored();
}

function loadRewind(sql: Query, id: Id<"rwd">): Result<Rewind | null> {
  const row = sql.get("SELECT * FROM app_rewinds WHERE id = ?", [id]);
  return row === undefined ? ok(null) : fromRow(row);
}

export function loadApplyingRewind(
  sql: Query,
  app: Id<"app">,
): Result<Rewind | null> {
  const row = sql.get(
    "SELECT * FROM app_rewinds WHERE app = ? AND status = 'applying'",
    [app],
  );
  return row === undefined ? ok(null) : fromRow(row);
}

// 새 것부터. cursor는 마지막으로 준 rewind id다.
export function loadRewinds(
  sql: Query,
  filter: {
    app: Id<"app">;
    invocation?: Id<"inv">;
    after?: Id<"rwd">;
    limit: number;
  },
): Result<Rewind[]> {
  const where = ["app = ?"];
  const params: (string | number)[] = [filter.app];
  if (filter.after !== undefined) {
    where.push("id < ?");
    params.push(filter.after);
  }
  if (filter.invocation !== undefined) {
    where.push(
      `(from_invocation = ? OR EXISTS (
        SELECT 1 FROM json_each(app_rewinds.invocations) WHERE value = ?
      ))`,
    );
    params.push(filter.invocation, filter.invocation);
  }
  params.push(filter.limit);
  const rows = sql.all(
    `SELECT * FROM app_rewinds WHERE ${
      where.join(" AND ")
    } ORDER BY id DESC LIMIT ?`,
    params,
  );
  const rewinds: Rewind[] = [];
  for (const row of rows) {
    const rewind = fromRow(row);
    if (!rewind.ok) return rewind;
    rewinds.push(rewind.value);
  }
  return ok(rewinds);
}

export function insertApplyingRewind(
  sql: Sql,
  row: {
    id: Id<"rwd">;
    app: Id<"app">;
    release: string;
    from_invocation: string;
    requested_by: Actor;
    invocations: readonly string[];
    started_at: At;
  },
): void {
  sql.run(
    `INSERT INTO app_rewinds
      (id, app, release, from_invocation, requested_by, status, invocations, started_at)
     VALUES (?, ?, ?, ?, ?, 'applying', ?, ?)`,
    [
      row.id,
      row.app,
      row.release,
      row.from_invocation,
      row.requested_by,
      JSON.stringify(row.invocations),
      row.started_at,
    ],
  );
}

// applying인 행만 끝낸다. 이미 끝난 행은 trigger가 막는다.
export function finishRewind(
  sql: Sql,
  id: Id<"rwd">,
  outcome:
    | { status: "applied"; invocations: readonly string[] }
    | { status: "cancelled"; reason: Reason },
  finishedAt: At,
): Result<Rewind> {
  const applied = outcome.status === "applied";
  const changed = sql.run(
    `UPDATE app_rewinds
     SET status = ?, reason_code = ?, reason_message = ?, invocations = ?, finished_at = ?
     WHERE id = ? AND status = 'applying'`,
    [
      outcome.status,
      applied ? null : outcome.reason.code,
      applied ? null : outcome.reason.message,
      JSON.stringify(applied ? outcome.invocations : []),
      finishedAt,
      id,
    ],
  );
  if (Number(changed.changes) !== 1) return invalidStored();
  const rewind = loadRewind(sql, id);
  if (!rewind.ok) return rewind;
  return rewind.value === null ? invalidStored() : ok(rewind.value);
}

// core가 rewind 도중 죽어 applying으로 남은 행. 접수 닫힘은 메모리라 재시작하면 저절로 열린다.
export function closeInterruptedRewinds(
  deps: { sql: Sql; now(): At },
): number {
  const changed = deps.sql.run(
    `UPDATE app_rewinds
     SET status = 'cancelled', reason_code = 'core_restarted',
         reason_message = 'core restarted while the rewind was applying',
         invocations = '[]', finished_at = ?
     WHERE status = 'applying'`,
    [deps.now()],
  );
  return Number(changed.changes);
}
