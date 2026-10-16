// 앱 DB를 여는 유일한 자리. core·supervisor는 이 모듈을 import하지
// 않는다. 운영 앱 프로세스가 자기 DB를 여는 것과 별개로, data worker만 여기서 연다.

import { backup, DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { sha256Hex } from "../../../../base/mod.ts";
import {
  MIGRATION_PRIMARY_KEY_REQUIRED,
  tablesWithoutPrimaryKey,
} from "../../../../protocol/apps/mod.ts";
import {
  APP_SCHEMA_SQL,
  APP_SCHEMA_TABLE,
  INITIAL_SCHEMA,
  type SchemaState,
} from "./schema.ts";

const HASH_PREFIX = "sha256:";

export type AppDatabase = {
  // 실제 현재 schema와 마지막 migration 결과. 표가 없으면 schema 0이다.
  schemaState(): SchemaState;
  integrityOk(): boolean;
  // SQLite backup API로 WAL까지 포함한 일관된 복사본을 만든다.
  backupTo(destination: string): Promise<Result<void>>;
  // 단계의 데이터 변경과 schema 번호 갱신을 한 transaction으로 확정한다. 단계가 만든 표에 PRIMARY KEY가
  // 없으면 rewind(changeset)가 그 표를 기록하지 못하므로 단계 전체를 되돌리고 실패한다.
  applyStep(
    sql: string,
    next: { dataSchema: number; scriptHash: string; appliedAt: string },
  ): Result<void>;
  // 복원 확인용. 열린 DB의 바이트를 바꾸지 않고 읽기만 한다.
  close(): void;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

function tableNames(db: DatabaseSync): Set<string> {
  return new Set(
    db.prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
    ).all().map((row) => String(row["name"])),
  );
}

function primaryKeyColumns(db: DatabaseSync, table: string): number {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return db.prepare(`pragma table_info(${quoted})`).all().filter((column) =>
    Number(column["pk"]) > 0
  ).length;
}

export function openAppDatabase(path: string): Result<AppDatabase> {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch {
    return unavailable("app database cannot be opened");
  }
  try {
    db.exec("pragma journal_mode = wal");
    db.exec(APP_SCHEMA_SQL);
  } catch {
    db.close();
    return unavailable("app database cannot be prepared");
  }
  return ok({
    schemaState() {
      const rows = db.prepare(
        `select data_schema, last_result, script_hash from ${APP_SCHEMA_TABLE} where id = 1`,
      ).all();
      const row = rows[0];
      if (row === undefined) return { ...INITIAL_SCHEMA };
      return {
        dataSchema: Number(row["data_schema"]),
        lastResult: row["last_result"] === "applied" ? "applied" : "none",
        scriptHash: typeof row["script_hash"] === "string"
          ? row["script_hash"]
          : null,
      };
    },
    integrityOk() {
      const rows = db.prepare("pragma integrity_check").all();
      return rows.length === 1 && rows[0]?.["integrity_check"] === "ok";
    },
    async backupTo(destination) {
      try {
        // sqlite backup API다. 본체 파일 복사와 달리 WAL의 확정 내용을 포함한다.
        await backup(db, destination);
        return ok(undefined);
      } catch {
        return unavailable("app database backup failed");
      }
    },
    applyStep(sql, next) {
      db.exec("begin immediate");
      try {
        const before = tableNames(db);
        db.exec(sql);
        const missing = tablesWithoutPrimaryKey(
          [...tableNames(db)].filter((name) => !before.has(name)).map((
            name,
          ) => ({
            name,
            primary_key_columns: primaryKeyColumns(db, name),
          })),
        );
        if (missing.length > 0) {
          db.exec("rollback");
          return err({
            code: "invalid_input",
            message: `${MIGRATION_PRIMARY_KEY_REQUIRED}: ${missing.join(", ")}`,
          });
        }
        db.prepare(
          `insert into ${APP_SCHEMA_TABLE}
             (id, data_schema, last_result, script_hash, applied_at)
           values (1, ?, 'applied', ?, ?)
           on conflict (id) do update set
             data_schema = excluded.data_schema,
             last_result = excluded.last_result,
             script_hash = excluded.script_hash,
             applied_at = excluded.applied_at`,
        ).run(next.dataSchema, next.scriptHash, next.appliedAt);
        db.exec("commit");
        return ok(undefined);
      } catch {
        try {
          db.exec("rollback");
        } catch {
          // rollback 실패도 단계를 적용된 것으로 보지 않는다.
        }
        return unavailable("migration step rolled back");
      }
    },
    close() {
      db.close();
    },
  });
}

// 일관된 backup 바이트의 hash. DataBackup.database_hash가 가리킨다.
export async function databaseHash(path: string): Promise<Result<string>> {
  try {
    const bytes = await Deno.readFile(path);
    return ok(`${HASH_PREFIX}${await sha256Hex(bytes)}`);
  } catch {
    return unavailable("backup bytes cannot be read");
  }
}

// 본체 파일 복사. backup API와 구별하기 위한 비교 대상이며 유효 backup이 아니다.
export async function copyDatabaseFile(
  source: string,
  destination: string,
): Promise<Result<void>> {
  try {
    await Deno.copyFile(source, destination);
    return ok(undefined);
  } catch {
    return unavailable("database file copy failed");
  }
}
