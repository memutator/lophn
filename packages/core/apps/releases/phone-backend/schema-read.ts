// sync schema 규칙(`phoneSchemaProblems`)에 줄 표·index·foreign key·trigger를 실제 DB에서 읽는다. release 준비가 빈 DB를
// target schema까지 올린 scratch DB에서 부른다(`checkMigration`과 같은 길).
import {
  type PhoneSchemaTable,
  phoneSchemaProblems,
} from "../../../../protocol/apps/activation/phone-schema.ts";
import type { TableFilter } from "../../../../protocol/apps/declaration/sync-plan.ts";
import { APP_SCHEMA_TABLE } from "../../data/worker/schema.ts";

type ReadableDb = {
  prepare(sql: string): { all(): Record<string, unknown>[] };
};

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

// `synced`는 다른 사본과 맞추는 표(null이면 모든 표), `listed`는 선언의 `sync`가 적은 표, `destinationOf`는 그 표가 가는
// destination이다.
export function phoneSchemaProblemsOfDatabase(
  db: ReadableDb,
  synced: TableFilter = null,
  listed: readonly string[] = [],
  destinationOf: ReadonlyMap<string, string> = new Map(),
): string[] {
  const tables: PhoneSchemaTable[] = db
    .prepare(
      `select name, sql from sqlite_master
       where type = 'table' and name not like 'sqlite_%' and name != '${APP_SCHEMA_TABLE}'
       order by name`,
    )
    .all()
    .map((row) => {
      const name = String(row["name"]);
      return {
        name,
        sql: String(row["sql"]),
        columns: db
          .prepare(`pragma table_info(${quoted(name)})`)
          .all()
          .map((column) => ({
            name: String(column["name"]),
            type: String(column["type"]),
            pk: Number(column["pk"]),
          })),
        indexes: db
          .prepare(`pragma index_list(${quoted(name)})`)
          .all()
          .map((index) => ({
            name: String(index["name"]),
            unique: Number(index["unique"]) === 1,
            origin: String(index["origin"]),
          })),
        foreignKeys: db
          .prepare(`pragma foreign_key_list(${quoted(name)})`)
          .all()
          .map((foreign) => ({
            table: String(foreign["table"]),
            on_delete: String(foreign["on_delete"]),
            on_update: String(foreign["on_update"]),
          })),
      };
    });
  const triggers = db
    .prepare(
      "select name, tbl_name from sqlite_master where type = 'trigger' order by name",
    )
    .all()
    .map((row) => ({
      name: String(row["name"]),
      table: String(row["tbl_name"]),
    }));
  return phoneSchemaProblems(tables, triggers, synced, listed, destinationOf);
}
