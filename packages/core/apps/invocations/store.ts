import { err, ok, type Result } from "../../../base/mod.ts";
import type { AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import type { Sql, SqlParam, Tx } from "../../../protocol/server/mod.ts";
import type { InvocationFilter } from "../ports.ts";
import { invocationFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

export function loadInvocation(
  sql: Query,
  id: string,
): Result<AppInvocation | null> {
  const row = sql.get("SELECT * FROM invocations WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  const invocation = invocationFromRow(row);
  if (!invocation.ok) return invocation;
  if (invocation.value.id !== id) {
    return err({ code: "internal", message: "invalid stored invocation" });
  }
  return invocation;
}

export type InvocationPage = { after?: string; limit?: number };

// 새 것부터(id는 시간 순서다). limit이 없으면 전부다. `after`는 마지막으로 받은 id다.
export function listInvocations(
  sql: Query,
  filter: Omit<InvocationFilter, "cursor" | "limit">,
  page: InvocationPage = {},
): Result<AppInvocation[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  const equals = (column: string, value: string | undefined) => {
    if (value === undefined) return;
    where.push(`${column} = ?`);
    params.push(value);
  };
  equals("app", filter.app);
  equals("project", filter.project);
  equals("session", filter.session);
  equals("turn", filter.turn);
  equals("effect", filter.effect);
  equals("status", filter.status);
  equals("mode", filter.mode);
  equals("release", filter.release);
  if (filter.reverted !== undefined) {
    where.push(`reverted_by IS ${filter.reverted ? "NOT " : ""}NULL`);
  }
  if (page.after !== undefined) {
    where.push("id < ?");
    params.push(page.after);
  }
  let text = "SELECT * FROM invocations";
  if (where.length > 0) text += ` WHERE ${where.join(" AND ")}`;
  text += " ORDER BY id DESC";
  if (page.limit !== undefined) {
    text += " LIMIT ?";
    params.push(page.limit);
  }
  const invocations: AppInvocation[] = [];
  for (const row of sql.all(text, params)) {
    const invocation = invocationFromRow(row);
    if (!invocation.ok) return invocation;
    invocations.push(invocation.value);
  }
  return ok(invocations);
}

export function insertInvocation(
  tx: Pick<Tx, "sql">,
  invocation: AppInvocation,
): void {
  const caller = invocation.caller;
  tx.sql.run(
    `INSERT INTO invocations
      (id, app, release, mode, operation, caller, caller_kind, session, turn,
       project, effect, status, started_at, finished_at, input_hash, summary,
       detail_hash, changeset_hash, changeset_size, reverted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invocation.id,
      invocation.app,
      invocation.release,
      invocation.mode,
      JSON.stringify(invocation.operation),
      caller === null ? null : JSON.stringify(caller),
      caller?.kind ?? null,
      caller?.kind === "agent" ? caller.session : null,
      caller?.kind === "agent" ? caller.turn : null,
      invocation.project,
      invocation.effect,
      invocation.status,
      invocation.started_at,
      invocation.finished_at,
      invocation.input_hash,
      JSON.stringify(invocation.summary),
      invocation.detail_hash,
      invocation.changeset?.hash ?? null,
      invocation.changeset?.size_bytes ?? null,
      invocation.reverted_by,
    ],
  );
}

// 그 release에 남은 changeset 크기의 합.
export function releaseChangesetBytes(
  sql: Query,
  app: string,
  release: string,
): number {
  const row = sql.get(
    `SELECT COALESCE(SUM(changeset_size), 0) AS total FROM invocations
     WHERE app = ? AND release = ?`,
    [app, release],
  );
  return Number(row?.total ?? 0);
}

// blob 참조의 registered_seq. 이 기록은 event를 남기지 않으므로 지금까지의 마지막 seq를 쓴다.
export function headSeq(sql: Query): string {
  const row = sql.get("SELECT COALESCE(MAX(seq), 0) AS head FROM events", []);
  return String(row?.head ?? 0);
}
