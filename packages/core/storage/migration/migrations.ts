import type { Clock, LophnError, Result } from "../../../base/mod.ts";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import type { START_FAILURE_REASONS } from "../../../protocol/supervision/mod.ts";
import type { SchemaStep, Sql } from "../../../protocol/server/mod.ts";
import { type LedgerConnection, openConnection } from "../ledger/mod.ts";
import { createRecoveryCopy, recoveryStamp } from "./recovery.ts";
import { type MigrationVerification, verifyMigrated } from "./verification.ts";

type MigrationDeps = {
  clock: Clock;
  // 없으면 복구본을 만들지 않는다(테스트 harness가 쓴다). 있으면 미적용 step이
  // 있을 때 변환 전 schema가 있으면 반드시 만들고 무결성 검사를 통과한 뒤에만
  // 변환을 시작한다. 변환 전 schema 0인 새 설치는 복구본 대상이 없다.
  recovery?: {
    // 복구본 폴더의 밑. <root>/recovery/ 밑으로 둔다.
    root: string;
  };
};

type AppliedMigration = {
  version: number;
  contentHash: string;
};

// schema_migrations는 적용기가 처음 transaction에서 만든다.
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

type StartFailureReason = (typeof START_FAILURE_REASONS)[number];

// migration이 시작하지 못하는 세 경우를 구별한다. 그 밖은 other다.
export function startFailureReason(error: LophnError): StartFailureReason {
  const reason = error.details?.["start_failure"];
  return reason === "newer_schema" || reason === "history_mismatch" ||
      reason === "damaged_original"
    ? reason
    : "other";
}

function startFailure(
  reason: Exclude<StartFailureReason, "other">,
  message: string,
): Result<never> {
  return err({
    code: "unavailable",
    message,
    details: { start_failure: reason },
  });
}

// 지원보다 높은 schema·다른 hash·손상은 아무것도 쓰지 않고 거절한다.
function checkHistory(
  recorded: Recorded[],
  steps: readonly AppliedMigration[],
): Result<void> {
  if (recorded.length > steps.length) {
    return startFailure(
      "newer_schema",
      "설치된 schema보다 높은 판이라 정상 시작을 거절한다",
    );
  }
  for (const [index, row] of recorded.entries()) {
    const step = steps[index];
    if (
      row.version !== step.version || row.contentHash !== step.contentHash
    ) {
      return startFailure(
        "history_mismatch",
        "적용된 schema 내용이 설치본과 달라 정상 시작을 거절한다",
      );
    }
  }
  return ok(undefined);
}

// 데이터베이스 파일이 아니면 검사 자체가 던진다. 둘 다 손상이다.
function integrityPassed(connection: LedgerConnection): boolean {
  try {
    return connection.integrityOk();
  } catch {
    return false;
  }
}

// 적용한 step 수를 돌려준다.
export async function applyMigrations(
  path: string,
  steps: readonly SchemaStep[],
  deps: MigrationDeps,
): Promise<Result<number>> {
  const planned: AppliedMigration[] = [];
  for (const [index, step] of steps.entries()) {
    planned.push({
      version: index + 1,
      contentHash: await sha256Hex(step.sql),
    });
  }
  const opened = openConnection(path);
  if (!opened.ok) {
    return startFailure("damaged_original", opened.error.message);
  }
  const connection = opened.value;
  try {
    if (!integrityPassed(connection)) {
      return startFailure(
        "damaged_original",
        "ledger 무결성 검사가 실패해 정상 시작을 거절한다",
      );
    }
    const recorded = readRecorded(connection.sql);
    const checked = checkHistory(recorded, planned);
    if (!checked.ok) return checked;
    const unapplied = steps.length - recorded.length;
    if (
      unapplied > 0 && deps.recovery !== undefined &&
      // 새 설치(변환 전 schema 0)는 남길 변환 전 자료가 없어 복구본을 만들지 않는다.
      recorded.length > 0
    ) {
      // 복구본은 변환 전 schema 순번과 시각을 name에 넣는다.
      const stamp = recoveryStamp(deps.clock.now());
      if (!stamp.ok) return stamp;
      const recovery = await createRecoveryCopy(path, {
        root: deps.recovery.root,
        schemaVersion: recorded.length,
        stamp: stamp.value,
      });
      // 복구본 만들기나 검사가 실패하면 원본을 변환하지 않고 시작을 거절한다.
      if (!recovery.ok) return recovery;
    }
    const applied = steps.length - recorded.length;
    for (let index = recorded.length; index < steps.length; index++) {
      const stepped = applyStep(
        connection,
        steps[index],
        planned[index],
        deps.clock,
      );
      if (!stepped.ok) return stepped;
    }
    // 완료 뒤 FK·무결성·불변 보호를 검사한다. 실패면 원본이 이미 rollback됐다.
    const verified = verifyMigrated(connection.sql, {
      guarded: guardedTables(steps),
    });
    if (!verified.ok) return verified;
    return ok(applied);
  } finally {
    connection.close();
  }
}

// step SQL이 만드는 trigger를 sqlite_master에서 읽을 표로 모은다. trigger가 없는
// step은 건너뛴다. IMMUTABLE 표는 no_update·no_delete·insert guard가 있어야 한다.
function guardedTables(
  steps: readonly SchemaStep[],
): MigrationVerification["guarded"] {
  const guarded: {
    table: string;
    kinds: readonly ("no_update" | "no_delete" | "no_duplicate_insert")[];
  }[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const table of guardedTablesOf(step.sql)) {
      if (seen.has(table)) continue;
      seen.add(table);
      guarded.push({ table, kinds: ["no_update", "no_delete"] });
    }
  }
  return guarded;
}

// trigger 본문의 표 이름은 sqlite_master query로만 확실하다. 여기서는 step SQL의
// create trigger <table>_no_update를 읽는다.
function guardedTablesOf(step: string): string[] {
  const tables: string[] = [];
  const trigger =
    /create\s+trigger\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][A-Za-z0-9_]*)_no_update/g;
  let match: RegExpExecArray | null;
  while ((match = trigger.exec(step)) !== null) {
    tables.push(match[1]);
  }
  return tables;
}

// 변환과 이력은 한 transaction이다. 실패하면 그 단계 전체가 rollback된다.
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
