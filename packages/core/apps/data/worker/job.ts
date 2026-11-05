// data worker job 진입. stdin JSON 한 줄을 받아 DataResult 한 줄을
// 낸다. 한 앱 데이터 영역에서 job은 한 번에 하나이고, 경로는 데이터 영역 밖을
// 벗어나지 못한다.

import { realpath } from "node:fs/promises";

import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import {
  type ActivationDataJobInput,
  type ActivationDataResult,
  decodeActivationDataJobInput,
  encodeActivationDataJobOutput,
} from "../../../../protocol/apps/mod.ts";
import { createAppBackup, retainAppBackups } from "./backup.ts";
import { databaseHash, openAppDatabase } from "./db.ts";
import { acquireDataLock } from "./lock.ts";
import { migrateAppDatabase, type MigrationScript } from "./migrate.ts";
import { contained, insideDataArea } from "./paths.ts";
import { recoverRestoreLeftovers, restoreAppBackup } from "./restore.ts";

type DataJobContext = {
  // 앱 데이터 영역 루트. job이 여는 모든 경로는 이 안이어야 한다.
  dataArea: string;
  databasePath: string;
  // migration script. bundle에서 script_hash로 찾은 내용이다.
  scripts?: readonly MigrationScript[];
  appliedAt?: string;
  invocation?: string | null;
};

type DataJobFailure = {
  code: "invalid_input" | "conflict" | "unavailable";
  message: string;
};

function invalid(message: string): Result<never, DataJobFailure> {
  return err({ code: "invalid_input", message });
}

// 데이터 영역 상대 경로를 실제 경로로 푼 뒤 영역 안인지 확인한다.
async function resolveInside(
  dataArea: string,
  relative: string,
): Promise<Result<string, DataJobFailure>> {
  const joined = insideDataArea(dataArea, relative);
  if (!joined.ok) return invalid(joined.error.message);
  let resolved: string;
  try {
    resolved = await realpath(joined.value);
  } catch (thrown) {
    if (errorCode(thrown) !== "ENOENT") {
      return err({ code: "unavailable", message: "path cannot be resolved" });
    }
    // 아직 없는 파일은 부모 폴더 기준으로 확인한다.
    const parent = joined.value.slice(0, joined.value.lastIndexOf("/"));
    try {
      const parentResolved = await realpath(parent);
      const name = joined.value.slice(parent.length + 1);
      resolved = `${parentResolved}/${name}`;
    } catch {
      return err({ code: "unavailable", message: "path cannot be resolved" });
    }
  }
  return contained(dataArea, resolved)
    ? ok(resolved)
    : invalid("path leaves the data area");
}

type JobOutcome = {
  result: ActivationDataResult;
  backup_hash?: string;
  failed?: { step: string; message: string };
};

const HASH_PREFIX = "sha256:";

function plainHash(hash: string): string {
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash;
}

async function runBackup(
  ctx: DataJobContext,
  input: ActivationDataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
  const name = `backup-${input.attempt}`;
  const created = await createAppBackup(ctx.dataArea, ctx.databasePath, name);
  if (!created.ok) {
    return err({ code: "unavailable", message: "backup failed" });
  }
  // 복구본은 앱마다 가장 최근 하나다. 이전 시도의 파일은 지운다.
  await retainAppBackups(ctx.dataArea, { protectedNames: [name] });
  // 보호 blob이 될 byte의 hash다. 이 hash의 byte만 나중에 복원된다.
  return ok({
    result: {
      release: input.release,
      attempt: input.attempt,
      invocation: null,
      data_schema: created.value.verified.state.dataSchema,
      integrity_ok: true,
    },
    backup_hash: plainHash(created.value.verified.databaseHash),
  });
}

// 실제 schema와 무결성만 확인한다. 데이터는 바꾸지 않는다.
function runInspect(
  ctx: DataJobContext,
  input: ActivationDataJobInput,
): Result<JobOutcome, DataJobFailure> {
  const opened = openAppDatabase(ctx.databasePath);
  if (!opened.ok) {
    return err({
      code: "unavailable",
      message: "app database cannot be opened",
    });
  }
  const db = opened.value;
  try {
    const integrity = db.integrityOk();
    return ok({
      result: {
        release: input.release,
        attempt: input.attempt,
        invocation: null,
        data_schema: db.schemaState().dataSchema,
        integrity_ok: integrity,
      },
    });
  } finally {
    db.close();
  }
}

async function runMigrate(
  ctx: DataJobContext,
  input: ActivationDataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
  if (
    ctx.scripts === undefined ||
    ctx.appliedAt === undefined ||
    ctx.invocation === undefined
  ) {
    return invalid("migration scripts are missing");
  }
  const backup = await resolveInside(
    ctx.dataArea,
    `backups/backup-${input.attempt}`,
  );
  if (!backup.ok) return backup;
  const migrated = await migrateAppDatabase({
    dataArea: ctx.dataArea,
    databasePath: ctx.databasePath,
    backupPath: backup.value,
    targetSchema: input.data_schema,
    scripts: ctx.scripts,
    appliedAt: ctx.appliedAt,
    result: {
      release: input.release,
      attempt: input.attempt,
      invocation: ctx.invocation ?? null,
    },
  });
  if (!migrated.ok) {
    return err({ code: "unavailable", message: migrated.error.message });
  }
  return ok(
    migrated.value.restored
      ? { result: migrated.value.result, failed: migrated.value.failed }
      : { result: migrated.value.result },
  );
}

async function runRestore(
  ctx: DataJobContext,
  input: ActivationDataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
  if (input.backup_hash === undefined) {
    return invalid("restore needs a backup");
  }
  const backup = await resolveInside(
    ctx.dataArea,
    `backups/backup-${input.attempt}`,
  );
  if (!backup.ok) return backup;
  // 복원은 ledger가 확정하고 보호 blob으로 보존한 그 byte만 쓴다. 영역의 파일이 그 hash와 다르면
  // (바뀌었거나 다른 파일이면) 복원하지 않고 운영 DB를 건드리지 않는다.
  const present = await databaseHash(backup.value);
  if (!present.ok || plainHash(present.value) !== input.backup_hash) {
    return err({
      code: "unavailable",
      message: "backup does not match the preserved backup",
    });
  }
  const restored = await restoreAppBackup(
    ctx.dataArea,
    ctx.databasePath,
    backup.value,
  );
  if (!restored.ok) {
    return err({ code: "unavailable", message: "restore failed" });
  }
  return ok({
    result: {
      release: input.release,
      attempt: input.attempt,
      invocation: ctx.invocation ?? null,
      data_schema: restored.value.verified.state.dataSchema,
      integrity_ok: true,
    },
  });
}

// job 하나. 배타 lock을 잡고 데이터 영역 안에서만 일한다.
export async function runDataJob(
  ctx: DataJobContext,
  line: string,
): Promise<Result<string, DataJobFailure>> {
  let input: ActivationDataJobInput;
  try {
    input = decodeActivationDataJobInput(line);
  } catch {
    return invalid("data job input is invalid");
  }
  const database = await resolveInside(
    ctx.dataArea,
    ctx.databasePath.startsWith(`${ctx.dataArea}/`)
      ? ctx.databasePath.slice(ctx.dataArea.length + 1)
      : ctx.databasePath,
  );
  if (!database.ok) return database;
  const locked = await acquireDataLock(ctx.dataArea);
  if (!locked.ok) {
    const code = locked.error.code === "conflict" ? "conflict" : "unavailable";
    return err({ code, message: locked.error.message });
  }
  try {
    // 어떤 job이든 DB를 열기 전에 끊긴 restore를 먼저 정리한다.
    await recoverRestoreLeftovers(ctx.dataArea, database.value);
    const resolved: DataJobContext = { ...ctx, databasePath: database.value };
    const outcome =
      input.kind === "inspect"
        ? runInspect(resolved, input)
        : input.kind === "backup"
          ? await runBackup(resolved, input)
          : input.kind === "migrate"
            ? await runMigrate(resolved, input)
            : await runRestore(resolved, input);
    if (!outcome.ok) return outcome;
    if (!outcome.value.result.integrity_ok) {
      return err({ code: "unavailable", message: "integrity check failed" });
    }
    return ok(encodeActivationDataJobOutput(outcome.value));
  } finally {
    await locked.value.release();
  }
}

// 운영 DB를 열 수 있는지를 확인만 한다. core·supervisor 대신 data worker가 연다.
