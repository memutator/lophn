// 폰 schema 규칙(`phoneSchemaProblems`)에 줄 표·index·trigger를 실제 DB에서 읽는다. release 준비가 빈 DB를 target
// schema까지 올린 scratch DB에서 부른다(`checkMigration`과 같은 길).
import {
  type PhoneSchemaTable,
  phoneSchemaProblems,
} from "../../../../protocol/apps/activation/phone-schema.ts";
import { APP_SCHEMA_TABLE } from "../../data/worker/schema.ts";

type ReadableDb = {
  prepare(sql: string): { all(): Record<string, unknown>[] };
};

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

export function phoneSchemaProblemsOfDatabase(db: ReadableDb): string[] {
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
      };
    });
  const triggers = db
    .prepare(
      "select name from sqlite_master where type = 'trigger' order by name",
    )
    .all()
    .map((row) => String(row["name"]));
  return phoneSchemaProblems(tables, triggers);
}
