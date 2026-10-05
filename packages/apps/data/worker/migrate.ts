// migration(apps/data#R6, R7, R8). 각 단계의 데이터 변경과 schema 번호 갱신은
// 한 transaction이고, 중간 단계가 실패하면 첫 변경 전 backup으로 복원한다.
// migration script는 bundle 안의 고정 파일에서 script_hash로만 찾는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import { sha256Hex } from "../../../base/mod.ts";
import type { DataChange, DataResult } from "../../../contracts/apps/mod.ts";
import { openAppDatabase } from "./db.ts";
import { migrationPath } from "./schema.ts";
import { restoreAppBackup } from "./restore.ts";

const HASH_PREFIX = "sha256:";

export type MigrationScript = {
  change: DataChange;
  // bundle 안에 고정된 script 바이트. hash가 script_hash와 같아야 한다(R8).
  sql: string;
};

export type MigrateInput = {
  dataArea: string;
  databasePath: string;
  // 첫 변경 전 backup. 중간 실패의 복원 근거다(R7).
  backupPath: string;
  targetSchema: number;
  scripts: readonly MigrationScript[];
  appliedAt: string;
  result: Pick<DataResult, "release" | "activation_seq" | "invocation">;
};

export type MigrateOutcome = {
  result: DataResult;
  // 중간 실패로 첫 변경 전 backup을 복원했으면 true.
  restored: boolean;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// bundle 안에서 script_hash와 같은 파일을 찾는다. hash가 같은 파일이 없으면
// 그 release의 migration은 준비되지 않은 것이다(R8).
export async function scriptFromBundle(
  bundlePath: string,
  change: DataChange,
): Promise<Result<MigrationScript>> {
  const hash = change.script_hash.startsWith("sha256:")
    ? change.script_hash.slice("sha256:".length)
    : change.script_hash;
  const file = `${bundlePath}/migrations/${hash}.sql`;
  let sql: string;
  try {
    sql = await Deno.readTextFile(file);
  } catch {
    return err({
      code: "invalid_input",
      message: "migration script is not in the bundle",
    });
  }
  const actual = await sha256Hex(sql);
  if (actual !== hash) {
    return err({
      code: "invalid_input",
      message: "published migration script changed",
    });
  }
  return ok({ change, sql });
}

// 공개한 script 내용이 hash와 다르면 그 release 준비는 거절한다(R8).
export async function publishedScriptChanged(
  published: { scriptHash: string; sql: string },
  candidateSql: string,
): Promise<boolean> {
  const candidate = `${HASH_PREFIX}${await sha256Hex(candidateSql)}`;
  return published.scriptHash !== candidate;
}

async function scriptMatches(script: MigrationScript): Promise<boolean> {
  const hash = `${HASH_PREFIX}${await sha256Hex(script.sql)}`;
  return hash === script.change.script_hash;
}

// 연속 경로를 순서대로 적용한다. 단계 실패는 그 단계 transaction rollback에 더해
// 첫 변경 전 backup으로 전체를 되돌린다(R7).
export async function migrateAppDatabase(
  input: MigrateInput,
): Promise<Result<MigrateOutcome>> {
  for (const script of input.scripts) {
    if (!await scriptMatches(script)) {
      return err({
        code: "invalid_input",
        message: "published migration script changed",
      });
    }
  }
  const opened = openAppDatabase(input.databasePath);
  if (!opened.ok) return opened;
  const db = opened.value;
  const current = db.schemaState().dataSchema;
  const path = migrationPath(
    current,
    input.targetSchema,
    input.scripts.map((script) => script.change),
  );
  if (!path.ok) {
    db.close();
    return path;
  }
  const byKey = new Map(
    input.scripts.map((script) =>
      [`${script.change.from}:${script.change.to}`, script] as const
    ),
  );
  let failed = false;
  try {
    for (const step of path.value.steps) {
      const script = byKey.get(`${step.from}:${step.to}`);
      if (script === undefined) {
        failed = true;
        break;
      }
      const applied = db.applyStep(script.sql, {
        dataSchema: step.to,
        scriptHash: step.script_hash,
        appliedAt: input.appliedAt,
      });
      if (!applied.ok) {
        failed = true;
        break;
      }
    }
  } finally {
    db.close();
  }
  if (failed) {
    const restored = await restoreAppBackup(
      input.dataArea,
      input.databasePath,
      input.backupPath,
    );
    if (!restored.ok) return restored;
    return ok({
      result: {
        ...input.result,
        data_schema: restored.value.verified.state.dataSchema,
        integrity_ok: true,
      },
      restored: true,
    });
  }
  const after = openAppDatabase(input.databasePath);
  if (!after.ok) return after;
  try {
    if (!after.value.integrityOk()) {
      return unavailable("integrity check failed");
    }
    const state = after.value.schemaState();
    if (state.dataSchema !== input.targetSchema) {
      return unavailable("data schema does not match the target");
    }
    return ok({
      result: {
        ...input.result,
        data_schema: state.dataSchema,
        integrity_ok: true,
      },
      restored: false,
    });
  } finally {
    after.value.close();
  }
}
