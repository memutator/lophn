// contexts·context_items 표의 행 읽기·쓰기. command와 read가 같이 쓴다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { Context, ContextItem } from "../../contracts/documents/mod.ts";
import type { Sql, SqlRow, Tx } from "../../contracts/platform/mod.ts";
import { targetKey } from "./model.ts";

export type ContextItemRow = {
  target_key: string;
  position: number;
  target: ContextItem["target"];
  perspective: ContextItem["perspective"];
  reason: string;
};

export type ContextRow = {
  id: string;
  title: string;
  purpose: string;
  revision: string;
  status: "active" | "archived";
};

function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function integer(row: SqlRow, column: string): number | undefined {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : undefined;
}

function invalidRow(): Result<never> {
  return err({ code: "internal", message: "stored context row is invalid" });
}

// STRICT 표라서 가지 모양은 CHECK가 지킨다. row의 target_key는 믿지 않고
// 현재 target에서 다시 encoding한다(encoding이 유일한 근원이다).
function itemFromRow(row: SqlRow): Result<ContextItemRow | null> {
  const kind = text(row, "target_kind");
  const perspective = text(row, "perspective");
  const reason = text(row, "reason");
  const position = integer(row, "position");
  if (
    kind === undefined || perspective === undefined || reason === undefined ||
    position === undefined
  ) return invalidRow();
  if (kind !== "document" && kind !== "app_command") return invalidRow();
  if (!["basis", "reference", "watch"].includes(perspective)) {
    return invalidRow();
  }
  let target: ContextItem["target"];
  let key: string;
  if (kind === "document") {
    const document = text(row, "document");
    const section = text(row, "section") ?? null;
    if (document === undefined) return invalidRow();
    target = { kind, document, section };
    key = targetKey(target);
  } else {
    const app = text(row, "app");
    const command = text(row, "command");
    if (app === undefined || command === undefined) return invalidRow();
    target = { kind, app, command };
    key = targetKey(target);
  }
  return ok({
    target_key: key,
    position,
    target,
    perspective: perspective as ContextItem["perspective"],
    reason,
  });
}

const CONTEXT_COLUMNS = "id, title, purpose, revision, status";

function contextFromRow(row: SqlRow): Result<ContextRow> {
  const status = text(row, "status");
  const revision = text(row, "revision");
  if (status !== "active" && status !== "archived") return invalidRow();
  if (revision === undefined) return invalidRow();
  return ok({
    id: text(row, "id") ?? "",
    title: text(row, "title") ?? "",
    purpose: text(row, "purpose") ?? "",
    revision,
    status,
  });
}

function contextValue(
  sql: Pick<Sql, "all">,
  row: ContextRow,
): Result<Context> {
  const items = listItems(sql, row.id);
  if (!items.ok) return items;
  const value: Context = {
    id: row.id,
    title: row.title,
    purpose: row.purpose,
    items: items.value.map((item) => ({
      target: item.target,
      perspective: item.perspective,
      reason: item.reason,
    })),
    revision: row.revision,
    status: row.status,
  };
  return ok(value);
}

export function loadContext(
  sql: Sql,
  id: string,
): Result<Context | null> {
  const row = sql.get(
    `SELECT ${CONTEXT_COLUMNS} FROM contexts WHERE id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  const parsed = contextFromRow(row);
  if (!parsed.ok) return parsed;
  return contextValue(sql, parsed.value);
}

export function loadContextRow(
  sql: Sql,
  id: string,
): Result<ContextRow | null> {
  const row = sql.get(
    `SELECT ${CONTEXT_COLUMNS} FROM contexts WHERE id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  return contextFromRow(row);
}

// context의 항목이 읽기 명령으로 가리키는 앱 ID들이다. 앱 하나에 묶인 agent의 범위 판정이 쓴다
// (platform/ledger target 판정의 `context_apps`).
export function contextApps(sql: Pick<Sql, "all">, id: string): string[] {
  return sql.all(
    `SELECT DISTINCT app FROM context_items
     WHERE context = ? AND target_kind = 'app_command'`,
    [id],
  ).flatMap((row) => typeof row["app"] === "string" ? [row["app"]] : []);
}

export function listItems(
  sql: Pick<Sql, "all">,
  context: string,
): Result<ContextItemRow[]> {
  const rows = sql.all(
    `SELECT target_key, position, target_kind, document, section, app, command,
       perspective, reason
     FROM context_items WHERE context = ? ORDER BY position`,
    [context],
  );
  const items: ContextItemRow[] = [];
  for (const row of rows) {
    const parsed = itemFromRow(row);
    if (!parsed.ok) return parsed;
    if (parsed.value === null) return invalidRow();
    items.push(parsed.value);
  }
  return ok(items);
}

export type ContextListFilter = {
  status?: "active" | "archived";
  limit: number;
  offset: number;
};

export function listContexts(
  sql: Sql,
  filter: ContextListFilter,
): Result<Context[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status !== undefined) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
  const rows = sql.all(
    `SELECT ${CONTEXT_COLUMNS} FROM contexts ${clause}
     ORDER BY id LIMIT ? OFFSET ?`,
    [...params, filter.limit, filter.offset],
  );
  const contexts: Context[] = [];
  for (const row of rows) {
    const parsed = contextFromRow(row);
    if (!parsed.ok) return parsed;
    const value = contextValue(sql, parsed.value);
    if (!value.ok) return value;
    contexts.push(value.value);
  }
  return ok(contexts);
}

export function listContextsByTargetKey(
  sql: Pick<Sql, "all">,
  target_key: string,
  filter: { limit: number; offset: number },
): Result<Context[]> {
  const rows = sql.all(
    `SELECT ${CONTEXT_COLUMNS} FROM contexts
     WHERE id IN (SELECT context FROM context_items WHERE target_key = ?)
       AND status = 'active'
     ORDER BY id LIMIT ? OFFSET ?`,
    [target_key, filter.limit, filter.offset],
  );
  const contexts: Context[] = [];
  for (const row of rows) {
    const parsed = contextFromRow(row);
    if (!parsed.ok) return parsed;
    const value = contextValue(sql, parsed.value);
    if (!value.ok) return value;
    contexts.push(value.value);
  }
  return ok(contexts);
}

export function insertContext(tx: Tx, context: ContextRow): void {
  tx.sql.run(
    `INSERT INTO contexts (${CONTEXT_COLUMNS}) VALUES (?, ?, ?, ?, ?)`,
    [
      context.id,
      context.title,
      context.purpose,
      context.revision,
      context.status,
    ],
  );
}

function itemRow(
  context: string,
  target: ContextItem["target"],
  position: number,
  perspective: string,
  reason: string,
): (string | number | null)[] {
  return target.kind === "document"
    ? [
      context,
      targetKey(target),
      position,
      "document",
      target.document,
      target.section,
      null,
      null,
      perspective,
      reason,
    ]
    : [
      context,
      targetKey(target),
      position,
      "app_command",
      null,
      null,
      target.app,
      target.command,
      perspective,
      reason,
    ];
}

const ITEM_COLUMNS =
  "context, target_key, position, target_kind, document, section, app, command," +
  " perspective, reason";

export function insertItems(
  tx: Tx,
  context: string,
  items: readonly ContextItem[],
): void {
  // create는 items를 자리 번호 순서대로 심는다. position은 배열 index다.
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    tx.sql.run(
      `INSERT INTO context_items (${ITEM_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      itemRow(context, item.target, index, item.perspective, item.reason),
    );
  }
}

// 항목 교체(추가·이동·제거)는 위치 계산 뒤 한 번에 반영한다. trim과 교체는 같은
// transaction에서만 한다.
export function replaceItems(
  tx: Tx,
  context: string,
  items: readonly ContextItemRow[],
): void {
  tx.sql.run(
    "DELETE FROM context_items WHERE context = ?",
    [context],
  );
  for (const item of items) {
    tx.sql.run(
      `INSERT INTO context_items (${ITEM_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      itemRow(
        context,
        item.target,
        item.position,
        item.perspective,
        item.reason,
      ),
    );
  }
}

export function updateContext(
  tx: Tx,
  context: ContextRow,
): void {
  tx.sql.run(
    `UPDATE contexts SET title = ?, purpose = ?, revision = ?, status = ?
     WHERE id = ?`,
    [
      context.title,
      context.purpose,
      context.revision,
      context.status,
      context.id,
    ],
  );
}

export type WatchChangeRow = {
  target: { kind: "document"; document: string; section: string | null };
  change_kind: "content_changed" | "section_added" | "section_missing";
  before_version: string | null;
  after_version: string;
  source_seq: string;
};

const CHANGE_KINDS = ["content_changed", "section_added", "section_missing"];

// 기록된 확인된 watch 변화. 최근 기록부터 limit개다. target_key는 NUL에서 잘려 읽히므로
// 대상은 함께 저장한 비교 입력(comparison)에서 꺼낸다.
export function listWatchChanges(
  sql: Sql,
  contextId: string,
  limit: number,
): Result<WatchChangeRow[]> {
  const rows = sql.all(
    `SELECT comparison FROM context_watch_changes WHERE context = ?
     ORDER BY CAST(event_seq AS INTEGER) DESC LIMIT ?`,
    [contextId, limit],
  );
  const changes: WatchChangeRow[] = [];
  for (const row of rows) {
    const raw = text(row, "comparison");
    if (raw === undefined) return invalidRow();
    let value: {
      target?: { kind?: string; document?: string; section?: string | null };
      result?: string;
      before_version?: string | null;
      after_version?: string;
      source_seq?: string;
    };
    try {
      value = JSON.parse(raw);
    } catch {
      return invalidRow();
    }
    const target = value.target;
    if (
      target?.kind !== "document" || typeof target.document !== "string" ||
      typeof value.result !== "string" ||
      !CHANGE_KINDS.includes(value.result) ||
      typeof value.after_version !== "string" ||
      typeof value.source_seq !== "string"
    ) return invalidRow();
    changes.push({
      target: {
        kind: "document",
        document: target.document,
        section: target.section ?? null,
      },
      change_kind: value.result as WatchChangeRow["change_kind"],
      before_version: value.before_version ?? null,
      after_version: value.after_version,
      source_seq: value.source_seq,
    });
  }
  return ok(changes);
}
