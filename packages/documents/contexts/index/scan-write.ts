// scan이 개체·위반·파일 행을 통째로 바꾸는 쓰기. 한 transaction 안에서 부른다.
import type { Sql } from "../../../protocol/platform/mod.ts";
import type { CheckViolation } from "../check/types.ts";
import type { IndexedEntity, IndexedFile, IndexState } from "./types.ts";

export type IndexRows = {
  files: IndexedFile[];
  entities: IndexedEntity[];
  violations: CheckViolation[];
  state: IndexState;
};

export function replaceIndexRows(
  sql: Sql,
  context: string,
  rows: IndexRows,
): void {
  for (const table of ["index_files", "index_entities", "index_violations"]) {
    sql.run(`DELETE FROM ${table} WHERE context = ?`, [context]);
  }
  for (const file of rows.files) {
    sql.run(
      `INSERT INTO index_files
         (context, path, size, mtime_ms, bundle_hash, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        context,
        file.path,
        file.size,
        file.mtime_ms,
        file.bundle_hash,
        file.status,
        file.reason,
      ],
    );
  }
  rows.entities.forEach((entity, ord) => {
    sql.run(
      `INSERT INTO index_entities
         (context, ord, type, id, path, section, fields, links, source_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        context,
        ord,
        entity.type,
        entity.key,
        entity.path,
        entity.section,
        JSON.stringify(entity.fields),
        JSON.stringify(entity.links),
        entity.source_kind,
      ],
    );
  });
  rows.violations.forEach((violation, ord) => {
    sql.run(
      `INSERT INTO index_violations
         (context, ord, kind, rule, type, path, section, target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        context,
        ord,
        violation.kind,
        violation.rule,
        violation.type,
        violation.path,
        violation.section,
        violation.target,
      ],
    );
  });
  writeIndexState(sql, context, rows.state);
}

export function writeIndexState(
  sql: Sql,
  context: string,
  state: IndexState,
): void {
  sql.run(
    `INSERT INTO index_state (context, bundle_hash, scanned_at, result)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (context) DO UPDATE SET
       bundle_hash = excluded.bundle_hash,
       scanned_at = excluded.scanned_at,
       result = excluded.result`,
    [context, state.bundle_hash, state.scanned_at, state.result],
  );
}
