import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlRow } from "../../../contracts/platform/mod.ts";
import type { CheckViolation } from "../check/types.ts";
import { indexSchemaSteps } from "./schema.ts";
import type { IndexedEntity, IndexedFile, IndexState } from "./types.ts";

export type IndexStore = {
  sql: Sql;
  // handle 안의 쓰기는 한 SQLite transaction이다. throw하면 되돌린다.
  transaction<T>(handle: (sql: Sql) => T): T;
  close(): void;
};

// derived sqlite를 연다(`:memory:` 가능). 없으면 만들고 indexSchemaSteps를 적용한다.
// WAL, synchronous=FULL. context worker가 유일한 writer다.
export function openIndexStore(path: string): IndexStore {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    // 정본이 아니므로 migration 기록 없이, 표가 없을 때만 한 번에 만든다.
    const created = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'index_state'",
    ).get();
    if (created === undefined) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const step of indexSchemaSteps) db.exec(step.sql);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    db.close();
    throw error;
  }
  const sql: Sql = {
    run: (text, params) => db.prepare(text).run(...params),
    get: (text, params) =>
      db.prepare(text).get(...params) as SqlRow | undefined,
    all: (text, params) => db.prepare(text).all(...params) as SqlRow[],
  };
  return {
    sql,
    transaction<T>(handle: (sql: Sql) => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = handle(sql);
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
  };
}

const text = (row: SqlRow, column: string): string => String(row[column]);
const textOrNull = (row: SqlRow, column: string): string | null =>
  row[column] === null ? null : String(row[column]);
const integer = (row: SqlRow, column: string): number => Number(row[column]);

const ENTITY_COLUMNS = "type, id, path, section, fields, links, source_kind";

function entityOf(row: SqlRow): IndexedEntity {
  return {
    type: text(row, "type"),
    key: text(row, "id"),
    path: text(row, "path"),
    section: textOrNull(row, "section"),
    fields: JSON.parse(text(row, "fields")),
    links: JSON.parse(text(row, "links")),
    source_kind: text(row, "source_kind"),
  };
}

// 개체는 추출 순서(ord)로 읽는다.
export function readEntities(sql: Sql, context: string): IndexedEntity[] {
  return sql.all(
    `SELECT ${ENTITY_COLUMNS} FROM index_entities WHERE context = ? ORDER BY ord`,
    [context],
  ).map(entityOf);
}

// 한 type의 개체를 추출 순서로 읽는다(series 다음 이름이 경로를 모을 때).
export function readEntitiesOfType(
  sql: Sql,
  context: string,
  type: string,
): IndexedEntity[] {
  return sql.all(
    `SELECT ${ENTITY_COLUMNS} FROM index_entities
     WHERE context = ? AND type = ? ORDER BY ord`,
    [context, type],
  ).map(entityOf);
}

// (type, key) 개체와, 그 개체의 관계 간선이 가리키는 key를 가진 개체를 추출 순서로 읽는다. 간선은
// key만 갖고 대상 type은 계약의 관계 선언이 정하므로, 대상은 key가 같은 개체를 모두 싣고 거르는 일은
// 읽는 쪽이 한다. 같은 (type, key)가 둘이면 추출 순서의 첫 개체의 간선만 따른다.
export function readEntityWithLinks(
  sql: Sql,
  context: string,
  type: string,
  key: string,
): IndexedEntity[] {
  const own = sql.all(
    `SELECT ${ENTITY_COLUMNS} FROM index_entities
     WHERE context = ? AND type = ? AND id = ? ORDER BY ord LIMIT 1`,
    [context, type, key],
  ).map(entityOf);
  if (own.length === 0) return [];
  const targets = [...new Set(own[0]!.links.map((link) => link.target_key))];
  if (targets.length === 0) return own;
  const marks = targets.map(() => "?").join(", ");
  return sql.all(
    `SELECT ${ENTITY_COLUMNS} FROM index_entities
     WHERE context = ? AND (id IN (${marks}) OR (type = ? AND id = ?))
     ORDER BY ord`,
    [context, ...targets, type, key],
  ).map(entityOf);
}

// 위반은 scan이 정렬해 넣은 순서(ord)로 읽는다: path, kind, rule(null은 ""), section(null이 먼저).
export function readViolations(sql: Sql, context: string): CheckViolation[] {
  return sql.all(
    `SELECT kind, rule, type, path, section, target
     FROM index_violations WHERE context = ? ORDER BY ord`,
    [context],
  ).map((row) =>
    ({
      kind: text(row, "kind"),
      rule: textOrNull(row, "rule"),
      type: text(row, "type"),
      path: text(row, "path"),
      section: textOrNull(row, "section"),
      target: textOrNull(row, "target"),
    }) as CheckViolation
  );
}

// path의 code unit 순
export function readIndexedFiles(sql: Sql, context: string): IndexedFile[] {
  return sql.all(
    `SELECT path, size, mtime_ms, bundle_hash, status, reason
     FROM index_files WHERE context = ?`,
    [context],
  ).map((row) => ({
    path: text(row, "path"),
    size: integer(row, "size"),
    mtime_ms: integer(row, "mtime_ms"),
    bundle_hash: text(row, "bundle_hash"),
    status: text(row, "status") as IndexedFile["status"],
    reason: textOrNull(row, "reason"),
  })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// scan한 적이 없으면 undefined
export function readIndexState(
  sql: Sql,
  context: string,
): IndexState | undefined {
  const row = sql.get(
    `SELECT bundle_hash, scanned_at, result FROM index_state WHERE context = ?`,
    [context],
  );
  if (row === undefined) return undefined;
  return {
    bundle_hash: text(row, "bundle_hash"),
    scanned_at: text(row, "scanned_at"),
    result: text(row, "result") as IndexState["result"],
  };
}
