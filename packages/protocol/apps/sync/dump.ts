import type { SyncDb } from "./db.ts";
import { ident } from "./sql.ts";

// replica를 견주는 text dump(test용). quote()가 storage class를 남긴다(1과 1.0, blob은 X'..').
export function dumpData(db: SyncDb): string {
  const tables = db
    .all(
      "select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' and name not glob 'lophn_*' order by name",
    )
    .map((row) => String(row["name"]));
  const out: string[] = [];
  for (const table of tables) {
    const columns = db
      .all(`pragma table_info(${ident(table)})`)
      .map((row) => `quote(${ident(String(row["name"]))})`);
    const rows = db
      .all(
        `select ${columns.join(" || '|' || ")} as r from ${ident(table)} order by r`,
      )
      .map((row) => String(row["r"]));
    out.push(`# ${table}`, ...rows);
  }
  return out.join("\n");
}

export function dumpClocks(db: SyncDb): string {
  const rows = db
    .all(
      "select tbl, hex(pk) as pk, cast(hlc as text) as hlc, deleted from lophn_sync_row order by tbl, pk",
    )
    .map((r) => `row ${r["tbl"]}|${r["pk"]}|${r["hlc"]}|${r["deleted"]}`);
  const columns = db
    .all(
      "select tbl, hex(pk) as pk, col, cast(hlc as text) as hlc from lophn_sync_col order by tbl, pk, col",
    )
    .map((r) => `col ${r["tbl"]}|${r["pk"]}|${r["col"]}|${r["hlc"]}`);
  return [...rows, ...columns].join("\n");
}
