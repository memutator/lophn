import { err, ok, type Result } from "../../../base/result.ts";
import type { SyncDb } from "./db.ts";
import { ident } from "./sql.ts";

// 폰 host의 migrator. 컴퓨터 data worker의 migrateAppDatabase와 같은 규칙을 SyncDb 위에서 한다:
// 단계마다 한 transaction, 실패하면 그 단계만 rollback, lophn_data_schema에 `sha256:` hash와 같이 남김,
// PRIMARY KEY 없는 새 표 거절. backup과 복원은 부르는 쪽(host)이 한다.
// 표 SQL과 PK 오류 글은 core·cap-store와 같아야 한다. 그 file들은 node: module을 끌어와 폰이 import하지 못해 여기 다시 둔다.
const SCHEMA_TABLE = "lophn_data_schema";
const SCHEMA_SQL = [
  `create table if not exists ${SCHEMA_TABLE} (`,
  "  id integer primary key check (id = 1),",
  "  data_schema integer not null check (data_schema >= 0),",
  "  last_result text not null check (last_result in ('applied', 'none')),",
  "  script_hash text,",
  "  applied_at text,",
  "  check (data_schema = 0 or script_hash is not null)",
  ")",
].join("\n");
const PRIMARY_KEY_REQUIRED = "migration creates a table without PRIMARY KEY";
const HASH_PREFIX = "sha256:";

export type MigrationStep = {
  from: number;
  to: number;
  sql: string;
  // release가 기록한 그 단계 file bytes의 sha256(hex). "sha256:" 접두는 있어도 같다.
  sha256: string;
};

export type MigrateOptions = {
  steps: readonly MigrationStep[];
  target: number;
  // 폰에 crypto.subtle이 없을 수 있어 부르는 쪽이 준다. text의 UTF-8 bytes의 sha256 hex.
  sha256: (text: string) => Promise<string>;
  appliedAt: string;
};

const plain = (hash: string): string =>
  hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash;

function tables(db: SyncDb): string[] {
  return db
    .all(
      "select name from sqlite_master where type = 'table' and name not glob 'sqlite_*'",
    )
    .map((row) => String(row["name"]));
}

function schemaOf(db: SyncDb): number {
  const row = db.all(
    `select cast(data_schema as text) as n from ${SCHEMA_TABLE} where id = 1`,
  )[0];
  return row === undefined ? 0 : Number(row["n"]);
}

function stepPath(
  current: number,
  target: number,
  steps: readonly MigrationStep[],
): Result<MigrationStep[]> {
  const invalid = (message: string) =>
    err({ code: "invalid_input" as const, message });
  if (target < current) return invalid("data schema does not move backward");
  const byFrom = new Map<number, MigrationStep>();
  for (const step of steps) {
    if (byFrom.has(step.from)) return invalid("data change path branches");
    byFrom.set(step.from, step);
  }
  const path: MigrationStep[] = [];
  for (let cursor = current; cursor < target; ) {
    const step = byFrom.get(cursor);
    if (step === undefined || step.to > target) {
      return invalid("data change path is not continuous");
    }
    path.push(step);
    cursor = step.to;
  }
  return ok(path);
}

/**
 * DB를 target schema까지 올리고 그 schema를 돌려준다. 단계 SQL의 hash가 하나라도 맞지 않으면 아무것도 하지 않는다.
 * 실패한 단계는 rollback되고 앞 단계는 남는다(오류 details.step). 되돌리기는 host의 backup이 한다.
 */
export async function migrate(
  db: SyncDb,
  options: MigrateOptions,
): Promise<Result<number>> {
  for (const step of options.steps) {
    if ((await options.sha256(step.sql)) !== plain(step.sha256)) {
      return err({
        code: "invalid_input",
        message: "published migration script changed",
        details: { step: `${step.from}-${step.to}` },
      });
    }
  }
  db.exec(SCHEMA_SQL);
  const path = stepPath(schemaOf(db), options.target, options.steps);
  if (!path.ok) return path;
  for (const step of path.value) {
    const name = `${step.from}-${step.to}`;
    db.exec("begin immediate");
    try {
      const before = new Set(tables(db));
      db.exec(step.sql);
      const missing = tables(db).filter(
        (table) =>
          !before.has(table) &&
          !db
            .all(`pragma table_info(${ident(table)})`)
            .some((column) => Number(column["pk"]) > 0),
      );
      if (missing.length > 0) {
        db.exec("rollback");
        return err({
          code: "invalid_input",
          message: `${PRIMARY_KEY_REQUIRED}: ${missing.join(", ")}`,
          details: { step: name },
        });
      }
      db.run(
        `insert into ${SCHEMA_TABLE} (id, data_schema, last_result, script_hash, applied_at)
         values (1, ${step.to}, 'applied', ?, ?)
         on conflict (id) do update set
           data_schema = excluded.data_schema,
           last_result = excluded.last_result,
           script_hash = excluded.script_hash,
           applied_at = excluded.applied_at`,
        [`${HASH_PREFIX}${plain(step.sha256)}`, options.appliedAt],
      );
      db.exec("commit");
    } catch (error) {
      try {
        db.exec("rollback");
      } catch {
        // 이미 끝난 transaction이다. 단계는 적용되지 않은 것으로 본다.
      }
      return err({
        code: "unavailable",
        message: `migration step rolled back: ${error instanceof Error ? error.message : String(error)}`,
        details: { step: name },
      });
    }
  }
  return ok(options.target);
}
