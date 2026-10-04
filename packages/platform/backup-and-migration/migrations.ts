import type { Clock, Result } from "../../base/mod.ts";
import { err, ok, sha256Hex } from "../../base/mod.ts";
import type { SchemaStep, Sql } from "../../contracts/platform/mod.ts";
import { type LedgerConnection, openConnection } from "../ledger/mod.ts";

export type MigrationDeps = {
  clock: Clock;
};

export type AppliedMigration = {
  version: number;
  contentHash: string;
};

// schema_migrations는 적용기가 처음 transaction에서 만든다(domain-model backup-and-migration).
const MIGRATIONS_TABLE = `
create table if not exists schema_migrations (
  version integer primary key,
  step_id text not null,
  content_hash text not null,
  applied_at text not null
);
create trigger if not exists schema_migrations_no_duplicate_insert
before insert on schema_migrations
when exists (select 1 from schema_migrations where version = new.version)
begin
  select raise(abort, 'immutable');
end;
create trigger if not exists schema_migrations_no_update
before update on schema_migrations
begin
  select raise(abort, 'immutable');
end;
create trigger if not exists schema_migrations_no_delete
before delete on schema_migrations
begin
  select raise(abort, 'immutable');
end;`;

type Recorded = { version: number; contentHash: string };

function readRecorded(sql: Sql): Recorded[] {
  const exists = sql.get(
    "select 1 as present from sqlite_master where type = 'table' and name = 'schema_migrations'",
    [],
  );
  if (exists === undefined) return [];
  return sql.all(
    "select version, content_hash from schema_migrations order by version",
    [],
  ).map((row) => ({
    version: Number(row["version"]),
    contentHash: String(row["content_hash"]),
  }));
}

// 지원보다 높은 schema·다른 hash·손상은 아무것도 쓰지 않고 거절한다(b&m R6).
function checkHistory(
  recorded: Recorded[],
  steps: readonly AppliedMigration[],
): Result<void> {
  if (recorded.length > steps.length) {
    return err({
      code: "unavailable",
      message: "설치된 schema보다 높은 판이라 정상 시작을 거절한다",
    });
  }
  for (const [index, row] of recorded.entries()) {
    const step = steps[index];
    if (
      row.version !== step.version || row.contentHash !== step.contentHash
    ) {
      return err({
        code: "unavailable",
        message: "적용된 schema 내용이 설치본과 달라 정상 시작을 거절한다",
      });
    }
  }
  return ok(undefined);
}

export async function applyMigrations(
  path: string,
  steps: readonly SchemaStep[],
  deps: MigrationDeps,
): Promise<Result<void>> {
  const planned: AppliedMigration[] = [];
  for (const [index, step] of steps.entries()) {
    planned.push({
      version: index + 1,
      contentHash: await sha256Hex(step.sql),
    });
  }
  const opened = openConnection(path);
  if (!opened.ok) return opened;
  const connection = opened.value;
  try {
    if (!connection.integrityOk()) {
      return err({
        code: "unavailable",
        message: "ledger 무결성 검사가 실패해 정상 시작을 거절한다",
      });
    }
    const recorded = readRecorded(connection.sql);
    const checked = checkHistory(recorded, planned);
    if (!checked.ok) return checked;
    for (let index = recorded.length; index < steps.length; index++) {
      const applied = applyStep(
        connection,
        steps[index],
        planned[index],
        deps.clock,
      );
      if (!applied.ok) return applied;
    }
    return ok(undefined);
  } finally {
    connection.close();
  }
}

// 변환과 이력은 한 transaction이다. 실패하면 그 단계 전체가 rollback된다(b&m R4).
function applyStep(
  connection: LedgerConnection,
  step: SchemaStep,
  planned: AppliedMigration,
  clock: Clock,
): Result<void> {
  connection.exec("begin immediate");
  try {
    connection.exec(MIGRATIONS_TABLE);
    connection.exec(step.sql);
    // step이 commit이나 rollback을 하면 적용기의 transaction이 끝난다.
    if (!connection.inTransaction()) {
      return err({
        code: "unavailable",
        message: "schema step이 transaction을 끝내 그 단계를 거절한다",
      });
    }
    connection.sql.run(
      "insert into schema_migrations (version, step_id, content_hash, applied_at) values (?, ?, ?, ?)",
      [planned.version, step.id, planned.contentHash, clock.now()],
    );
    connection.exec("commit");
    return ok(undefined);
  } catch {
    if (connection.inTransaction()) connection.exec("rollback");
    return err({
      code: "unavailable",
      message: "schema 적용이 실패해 그 단계를 되돌렸다",
    });
  }
}
