// data worker job 진입(apps/data#R1, R6). stdin JSON 한 줄을 받아 DataResult 한 줄을
// 낸다. 한 앱 데이터 영역에서 job은 한 번에 하나이고, 경로는 데이터 영역 밖을
// 벗어나지 못한다. migration 자식은 network·secret·외부 fs·subprocess 권한이 없다.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type DataJobInput,
  decodeDataJobInput,
  encodeDataJobOutput,
} from "../../../contracts/apps/mod.ts";
import type { DataResult } from "../../../contracts/apps/mod.ts";
import { migrationFlags } from "../../permissions/mod.ts";
import { createAppBackup } from "./backup.ts";
import { databaseHash, openAppDatabase } from "./db.ts";
import { acquireDataLock } from "./lock.ts";
import { migrateAppDatabase, type MigrationScript } from "./migrate.ts";
import { contained, insideDataArea } from "./paths.ts";
import { restoreAppBackup } from "./restore.ts";

// migration 자식에 있으면 안 되는 권한(apps/permissions#R18). T3 flag를 그대로 쓴다.
const FORBIDDEN_FLAGS = [
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-ffi",
  "--allow-sys",
  "--allow-all",
  "-A",
];

export type DataJobContext = {
  // 앱 데이터 영역 루트. job이 여는 모든 경로는 이 안이어야 한다.
  dataArea: string;
  databasePath: string;
  // migration script. bundle에서 script_hash로 찾은 내용이다.
  scripts?: readonly MigrationScript[];
  appliedAt?: string;
  invocation?: string | null;
};

export type DataJobFailure = {
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
    resolved = await Deno.realPath(joined.value);
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) {
      return err({ code: "unavailable", message: "path cannot be resolved" });
    }
    // 아직 없는 파일은 부모 폴더 기준으로 확인한다.
    const parent = joined.value.slice(0, joined.value.lastIndexOf("/"));
    try {
      const parentResolved = await Deno.realPath(parent);
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

// migration 자식의 권한 경계. T3의 migrationFlags 결과에서 금지 flag를 확인한다.
export function migrationChildFlags(
  app: { bundle: string; data: string },
  protectedDenies: readonly string[],
): Result<readonly string[], DataJobFailure> {
  const flags = migrationFlags(app, protectedDenies);
  if (!flags.ok) return invalid("migration flags are unavailable");
  for (const arg of flags.value.args) {
    const name = arg.split("=", 1)[0];
    if (FORBIDDEN_FLAGS.includes(name)) {
      return invalid("migration child has a forbidden permission");
    }
  }
  return ok(flags.value.args);
}

type JobOutcome = { result: DataResult; backup_hash?: string };

const HASH_PREFIX = "sha256:";

function plainHash(hash: string): string {
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash;
}

async function runBackup(
  ctx: DataJobContext,
  input: DataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
  const name = `backup-${input.activation_seq}`;
  const created = await createAppBackup(
    ctx.dataArea,
    ctx.databasePath,
    name,
  );
  if (!created.ok) {
    return err({ code: "unavailable", message: "backup failed" });
  }
  // 보호 blob이 될 byte의 hash다. 이 hash의 byte만 나중에 복원된다.
  return ok({
    result: {
      release: input.release,
      activation_seq: input.activation_seq,
      invocation: null,
      data_schema: created.value.verified.state.dataSchema,
      integrity_ok: true,
    },
    backup_hash: plainHash(created.value.verified.databaseHash),
  });
}

// 실제 schema와 무결성만 확인한다. 데이터는 바꾸지 않는다.
async function runInspect(
  ctx: DataJobContext,
  input: DataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
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
        activation_seq: input.activation_seq,
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
  input: DataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
  if (
    ctx.scripts === undefined || ctx.appliedAt === undefined ||
    ctx.invocation === undefined
  ) {
    return invalid("migration scripts are missing");
  }
  const backup = await resolveInside(
    ctx.dataArea,
    `backups/backup-${input.activation_seq}`,
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
      activation_seq: input.activation_seq,
      invocation: ctx.invocation ?? null,
    },
  });
  if (!migrated.ok) {
    return err({ code: "unavailable", message: migrated.error.message });
  }
  return ok({ result: migrated.value.result });
}

async function runRestore(
  ctx: DataJobContext,
  input: DataJobInput,
): Promise<Result<JobOutcome, DataJobFailure>> {
  if (input.backup_hash === undefined) {
    return invalid("restore needs a backup");
  }
  const backup = await resolveInside(
    ctx.dataArea,
    `backups/backup-${input.activation_seq}`,
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
      activation_seq: input.activation_seq,
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
  let input: DataJobInput;
  try {
    input = decodeDataJobInput(line);
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
    const resolved: DataJobContext = { ...ctx, databasePath: database.value };
    const outcome = input.kind === "inspect"
      ? await runInspect(resolved, input)
      : input.kind === "backup"
      ? await runBackup(resolved, input)
      : input.kind === "migrate"
      ? await runMigrate(resolved, input)
      : input.kind === "restore"
      ? await runRestore(resolved, input)
      : invalid("test jobs are not data changes");
    if (!outcome.ok) return outcome;
    if (!outcome.value.result.integrity_ok) {
      return err({ code: "unavailable", message: "integrity check failed" });
    }
    return ok(encodeDataJobOutput(outcome.value));
  } finally {
    await locked.value.release();
  }
}

// 운영 DB를 열 수 있는지를 확인만 한다. core·supervisor 대신 data worker가 연다(R1).
export function dataWorkerCanOpen(databasePath: string): Result<true> {
  const opened = openAppDatabase(databasePath);
  if (!opened.ok) return opened;
  opened.value.close();
  return ok(true);
}
