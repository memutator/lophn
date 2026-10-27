import { DatabaseSync } from "node:sqlite";
import type {
  KindsStatus,
  Violation,
} from "../../../../protocol/projects/mod.ts";
import type { Sql, SqlRow } from "../../../../protocol/server/mod.ts";
import type { FileOutcome, Item } from "../extract/items.ts";
import { indexSchemaSteps } from "./schema.ts";

export type IndexStore = {
  sql: Sql;
  // handle 안의 쓰기는 한 SQLite transaction이다. throw하면 되돌린다.
  transaction<T>(handle: (sql: Sql) => T): T;
  close(): void;
};

// derived sqlite를 연다(`:memory:` 가능). 없으면 만들고 indexSchemaSteps를 적용한다.
// WAL, synchronous=FULL. kinds worker가 유일한 writer다.
export function openIndexStore(path: string): IndexStore {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    // 정본이 아니므로 migration 기록 없이, 표가 없을 때만 한 번에 만든다.
    const created = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kinds_state'",
      )
      .get();
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

export type IndexedFile = {
  path: string;
  size: number;
  mtime_ms: number;
} & FileOutcome;

export type KindsState = {
  kinds_hash: string;
  scanned_ms: number;
  status: KindsStatus;
};

export function readState(sql: Sql, domain: string): KindsState | undefined {
  const row = sql.get(
    "SELECT kinds_hash, scanned_ms, status_json FROM kinds_state WHERE domain = ?",
    [domain],
  );
  if (row === undefined) return undefined;
  return {
    kinds_hash: text(row, "kinds_hash"),
    scanned_ms: Number(row.scanned_ms),
    status: JSON.parse(text(row, "status_json")),
  };
}

export function writeState(sql: Sql, domain: string, state: KindsState): void {
  sql.run(
    `INSERT INTO kinds_state (domain, kinds_hash, scanned_ms, status_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET
       kinds_hash = excluded.kinds_hash,
       scanned_ms = excluded.scanned_ms,
       status_json = excluded.status_json`,
    [domain, state.kinds_hash, state.scanned_ms, JSON.stringify(state.status)],
  );
}

// 앞에 맞던 kinds 파일 글. 없으면 undefined.
export function readApplied(
  sql: Sql,
  domain: string,
): { hash: string; text: string } | undefined {
  const row = sql.get("SELECT hash, text FROM kinds_applied WHERE domain = ?", [
    domain,
  ]);
  return row === undefined
    ? undefined
    : { hash: text(row, "hash"), text: text(row, "text") };
}

export function writeApplied(
  sql: Sql,
  domain: string,
  applied: { hash: string; text: string } | null,
): void {
  if (applied === null) {
    sql.run("DELETE FROM kinds_applied WHERE domain = ?", [domain]);
    return;
  }
  sql.run(
    `INSERT INTO kinds_applied (domain, hash, text) VALUES (?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET hash = excluded.hash, text = excluded.text`,
    [domain, applied.hash, applied.text],
  );
}

export function readIndexedFiles(sql: Sql, domain: string): IndexedFile[] {
  return sql
    .all(
      "SELECT path, size, mtime_ms, kind, status FROM kinds_files WHERE domain = ?",
      [domain],
    )
    .map((row) => ({
      path: text(row, "path"),
      size: Number(row.size),
      mtime_ms: Number(row.mtime_ms),
      kind: textOrNull(row, "kind"),
      status: text(row, "status") as FileOutcome["status"],
    }));
}

// kind의 item을 추출 순서(ord)로 읽는다.
export function readItems(sql: Sql, domain: string, kind: string): Item[] {
  return sql
    .all(
      `SELECT kind, key, path, file, fields FROM kinds_items
     WHERE domain = ? AND kind = ? ORDER BY ord`,
      [domain, kind],
    )
    .map((row) => ({
      kind: text(row, "kind"),
      key: text(row, "key"),
      path: text(row, "path"),
      file: text(row, "file"),
      fields: JSON.parse(text(row, "fields")),
    }));
}

// index에서 빠진(읽지 못했거나 type이 맞지 않은) 문서 수
export function countSkipped(sql: Sql, domain: string, kind: string): number {
  const row = sql.get(
    `SELECT COUNT(*) AS n FROM kinds_files
     WHERE domain = ? AND kind = ? AND status = 'skipped'`,
    [domain, kind],
  );
  return Number(row?.n ?? 0);
}

// 위반은 scan이 정렬해 넣은 순서(ord)로 읽는다. kind를 주면 그 kind의 것만.
export function readViolations(
  sql: Sql,
  domain: string,
  options: { kind?: string; limit?: number } = {},
): Violation[] {
  const rows = sql.all(
    `SELECT source, kind, path, field, rule, message FROM kinds_violations
     WHERE domain = ? AND (? IS NULL OR kind = ?) ORDER BY ord LIMIT ?`,
    [domain, options.kind ?? null, options.kind ?? null, options.limit ?? -1],
  );
  return rows.map(
    (row) =>
      ({
        source: text(row, "source"),
        rule: text(row, "rule"),
        kind: textOrNull(row, "kind"),
        path: textOrNull(row, "path"),
        field: textOrNull(row, "field"),
        message: text(row, "message"),
      }) as Violation,
  );
}

// scan이 file·item·위반 행을 통째로 바꾸는 쓰기. 한 transaction 안에서 부른다.
export function replaceRows(
  sql: Sql,
  domain: string,
  rows: {
    files: IndexedFile[];
    items: Item[];
    violations: readonly Violation[];
  },
): void {
  for (const table of ["kinds_files", "kinds_items", "kinds_violations"]) {
    sql.run(`DELETE FROM ${table} WHERE domain = ?`, [domain]);
  }
  for (const file of rows.files) {
    sql.run(
      `INSERT INTO kinds_files (domain, path, size, mtime_ms, kind, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [domain, file.path, file.size, file.mtime_ms, file.kind, file.status],
    );
  }
  rows.items.forEach((item, ord) => {
    sql.run(
      `INSERT INTO kinds_items (domain, ord, kind, key, path, file, fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        domain,
        ord,
        item.kind,
        item.key,
        item.path,
        item.file,
        JSON.stringify(item.fields),
      ],
    );
  });
  rows.violations.forEach((violation, ord) => {
    sql.run(
      `INSERT INTO kinds_violations
         (domain, ord, source, kind, path, field, rule, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        domain,
        ord,
        violation.source,
        violation.kind,
        violation.path,
        violation.field,
        violation.rule,
        violation.message,
      ],
    );
  });
}
