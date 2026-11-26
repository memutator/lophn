import type { Clock, LophnError, Result } from "../../../base/mod.ts";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import type { START_FAILURE_REASONS } from "../../../protocol/supervision/mod.ts";
import type { SchemaStep, Sql } from "../../../protocol/server/mod.ts";
import { type LedgerConnection, openConnection } from "../ledger/mod.ts";
import { createRecoveryCopy, recoveryStamp } from "./recovery.ts";
import { verifyMigrated } from "./verification.ts";

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

type PlannedStep = {
  step: SchemaStep;
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

type Recorded = { version: number; stepId: string; contentHash: string };

function readRecorded(sql: Sql): Recorded[] {
  const exists = sql.get(
    "select 1 as present from sqlite_master where type = 'table' and name = 'schema_migrations'",
    [],
  );
  if (exists === undefined) return [];
  return sql
    .all(
      "select version, step_id, content_hash from schema_migrations order by version",
      [],
    )
    .map((row) => ({
      version: Number(row["version"]),
      stepId: String(row["step_id"]),
      contentHash: String(row["content_hash"]),
    }));
}

type StartFailureReason = (typeof START_FAILURE_REASONS)[number];

// migration이 시작하지 못하는 세 경우를 구별한다. 그 밖은 other다.
export function startFailureReason(error: LophnError): StartFailureReason {
  const reason = error.details?.["start_failure"];
  return reason === "newer_schema" ||
    reason === "history_mismatch" ||
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

// 적용 여부는 step id로 본다. 목록의 위치로 보면 앞쪽 module에 step 하나를 더할 때 뒤 step이 모두 어긋난다.
// 지금 목록에 없는 id가 적용돼 있으면 더 새 판이 연 ledger다. 같은 id의 SQL이 다르면 적용한 내용과 설치본이 다르다.
// 어느 쪽이든 아무것도 쓰지 않고 거절한다.
function unappliedSteps(
  recorded: Recorded[],
  planned: readonly PlannedStep[],
): Result<PlannedStep[]> {
  const known = new Map(
    planned.map((entry) => [entry.step.id, entry.contentHash]),
  );
  const applied = new Set<string>();
  for (const row of recorded) {
    const hash = known.get(row.stepId);
    if (hash === undefined) {
      return startFailure(
        "newer_schema",
        "설치된 schema보다 높은 판이라 정상 시작을 거절한다",
      );
    }
    if (hash !== row.contentHash) {
      return startFailure(
        "history_mismatch",
        "적용된 schema 내용이 설치본과 달라 정상 시작을 거절한다",
      );
    }
    applied.add(row.stepId);
  }
  return ok(planned.filter((entry) => !applied.has(entry.step.id)));
}

// 데이터베이스 파일이 아니면 검사 자체가 던진다. 둘 다 손상이다.
function integrityPassed(connection: LedgerConnection): boolean {
  try {
    return connection.integrityOk();
  } catch {
    return false;
  }
}

function quickCheckPassed(connection: LedgerConnection): boolean {
  try {
    return connection.quickCheckOk();
  } catch {
    return false;
  }
}

// hash가 보는 step의 내용이다. FK를 끄고 도는 step은 그 사실이 실행 방식을 바꾸므로 hash에 든다(낸 step의 flag를 조용히 바꾸지 못한다).
export function stepContent(step: SchemaStep): string {
  return step.foreignKeys === "off"
    ? `-- foreign_keys=off\n${step.sql}`
    : step.sql;
}

// 적용한 step 수를 돌려준다.
export async function applyMigrations(
  path: string,
  steps: readonly SchemaStep[],
  deps: MigrationDeps,
): Promise<Result<number>> {
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      return err({
        code: "internal",
        message: `schema step id가 겹친다: ${step.id}`,
      });
    }
    ids.add(step.id);
  }
  const planned: PlannedStep[] = await Promise.all(
    steps.map(async (step) => ({
      step,
      contentHash: await sha256Hex(stepContent(step)),
    })),
  );
  const opened = openConnection(path);
  if (!opened.ok) {
    return startFailure("damaged_original", opened.error.message);
  }
  const connection = opened.value;
  try {
    let recorded: Recorded[];
    try {
      recorded = readRecorded(connection.sql);
    } catch {
      return startFailure(
        "damaged_original",
        "ledger 무결성 검사가 실패해 정상 시작을 거절한다",
      );
    }
    const unapplied = unappliedSteps(recorded, planned);
    if (!unapplied.ok) return unapplied;
    if (unapplied.value.length === 0) {
      // 적용할 schema step이 없는 정상 기동에서는 전체 integrity_check 두 번과 FK 전체 scan을
      // 돌리지 않고 quick_check 한 번으로 B-tree 손상을 확인한다.
      if (!quickCheckPassed(connection)) {
        return startFailure(
          "damaged_original",
          "ledger 무결성 검사가 실패해 정상 시작을 거절한다",
        );
      }
      return ok(0);
    }
    if (!integrityPassed(connection)) {
      return startFailure(
        "damaged_original",
        "ledger 무결성 검사가 실패해 정상 시작을 거절한다",
      );
    }
    if (
      deps.recovery !== undefined &&
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
    // version은 적용한 차례다. 목록 위치와 다를 수 있다.
    let version = recorded.reduce((top, row) => Math.max(top, row.version), 0);
    for (const entry of unapplied.value) {
      version += 1;
      const stepped = applyStep(connection, entry, version, deps.clock);
      if (!stepped.ok) return stepped;
    }
    // 완료 뒤 FK·무결성을 검사한다. 실패면 원본이 이미 rollback됐다.
    const verified = verifyMigrated(connection.sql);
    if (!verified.ok) return verified;
    return ok(unapplied.value.length);
  } finally {
    connection.close();
  }
}

// 변환과 이력은 한 transaction이다. 실패하면 그 단계 전체가 rollback된다.
function applyStep(
  connection: LedgerConnection,
  entry: PlannedStep,
  version: number,
  clock: Clock,
): Result<void> {
  // FK 자식이 있는 표를 다시 짜는 step은 FK를 끈 채 돌고 commit 전에 위반이 없음을 확인한다(transaction 안에서는 끌 수 없어 앞에서 끈다).
  const foreignKeysOff = entry.step.foreignKeys === "off";
  const failed = (message: string): Result<void> =>
    err({ code: "unavailable", message });
  if (foreignKeysOff) {
    try {
      connection.exec("pragma foreign_keys=OFF");
    } catch {
      return failed("FK를 끄지 못해 그 단계를 거절한다");
    }
  }
  const applied = applyStepInTransaction(
    connection,
    entry,
    version,
    clock,
    foreignKeysOff,
  );
  if (foreignKeysOff) {
    // 다시 켜지 못하면 FK 없이 도는 connection이 남으므로 단계가 성공했어도 오류로 올린다.
    try {
      connection.exec("pragma foreign_keys=ON");
    } catch {
      return failed("FK를 다시 켜지 못해 migration을 거절한다");
    }
  }
  return applied;
}

function applyStepInTransaction(
  connection: LedgerConnection,
  entry: PlannedStep,
  version: number,
  clock: Clock,
  checkForeignKeys: boolean,
): Result<void> {
  connection.exec("begin immediate");
  try {
    connection.exec(MIGRATIONS_TABLE);
    connection.exec(entry.step.sql);
    if (
      checkForeignKeys &&
      connection.sql.all("select * from pragma_foreign_key_check", []).length >
        0
    ) {
      throw new Error("foreign key violation after the step");
    }
    // step이 commit이나 rollback을 하면 적용기의 transaction이 끝난다.
    if (!connection.inTransaction()) {
      return err({
        code: "unavailable",
        message: "schema step이 transaction을 끝내 그 단계를 거절한다",
      });
    }
    connection.sql.run(
      "insert into schema_migrations (version, step_id, content_hash, applied_at) values (?, ?, ?, ?)",
      [version, entry.step.id, entry.contentHash, clock.now()],
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
