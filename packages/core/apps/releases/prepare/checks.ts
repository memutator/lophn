// release 준비가 그 자리에서 하는 migration 검사.
// core module graph에 넣지 않는다(mod.ts에서 내보내지 않는다). 앱 DB를 여는 data/worker/db.ts는
// core가 import하지 않는 모듈이고, 앱이 쓴 migration SQL은 release 준비 자식에서만 돈다.
// 부르는 곳은 packages/core/main/worker/release-job.ts 하나다.

import { mkdir } from "node:fs/promises";
import {
  type DataChange,
  rolledBackStepText,
} from "../../../../protocol/apps/mod.ts";
import { createAppBackup } from "../../data/worker/backup.ts";
import { openAppDatabase } from "../../data/worker/db.ts";
import {
  type MigrationScript,
  migrateAppDatabase,
  scriptFromBundle,
} from "../../data/worker/migrate.ts";

// 실패는 오류 code가 아니라 결과다. reason은 agent가 읽고 고칠 글이다.
export type CheckOutcome = { ok: true } | { ok: false; reason: string };

// 버리는 DB라 값에 의미가 없다.
const APPLIED_AT = "2000-01-01T00:00:00.000Z";
const RESULT = {
  release: "rel_01arz3ndektsv4rrffq69g5fav",
  attempt: "act_01arz3ndektsv4rrffq69g5fav",
  invocation: null,
} as const;

// backup을 만들고 activation과 같은 migrateAppDatabase로 target까지 올린다. 실패면 그 글을 돌려준다.
async function migrateOnce(
  dataArea: string,
  databasePath: string,
  backupName: string,
  from: number,
  target: number,
  scripts: readonly MigrationScript[],
): Promise<string | null> {
  const where = `from schema ${from} to schema ${target}`;
  const backup = await createAppBackup(dataArea, databasePath, backupName);
  if (!backup.ok) return `Migration ${where} failed: ${backup.error.message}.`;
  const migrated = await migrateAppDatabase({
    dataArea,
    databasePath,
    backupPath: `${dataArea}/backups/${backupName}`,
    targetSchema: target,
    scripts,
    appliedAt: APPLIED_AT,
    result: RESULT,
  });
  if (!migrated.ok) {
    return `Migration ${where} failed: ${migrated.error.message}.`;
  }
  if (migrated.value.restored) {
    const { failed } = migrated.value;
    return `Migration ${where} failed: ${rolledBackStepText(
      failed,
    )}. Fix that step's SQL; every new table needs a PRIMARY KEY.`;
  }
  return null;
}

async function freshDatabase(
  dataArea: string,
): Promise<{ path: string } | { error: string }> {
  await mkdir(dataArea, { recursive: true });
  const path = `${dataArea}/app.sqlite`;
  const opened = openAppDatabase(path);
  if (!opened.ok) return { error: opened.error.message };
  opened.value.close();
  return { path };
}

// 빈 DB에서 dataSchema까지, previousSchema가 있으면 그 schema의 DB에서 dataSchema까지 올라가는지 본다.
// area는 부르는 쪽이 준 빈 임시 폴더이고 지우는 것도 부르는 쪽이다.
export async function checkMigration(input: {
  bundleRoot: string;
  dataChanges: readonly DataChange[];
  dataSchema: number;
  previousSchema: number | null;
  area: string;
}): Promise<CheckOutcome> {
  const { dataSchema, previousSchema, area } = input;
  if (dataSchema === 0) return { ok: true };
  if (previousSchema !== null && previousSchema > dataSchema) {
    return {
      ok: false,
      reason: `The data schema ${dataSchema} is lower than ${previousSchema}, the schema of the active release. A data schema cannot move backward.`,
    };
  }
  const scripts: MigrationScript[] = [];
  for (const change of input.dataChanges) {
    const script = await scriptFromBundle(input.bundleRoot, change);
    if (!script.ok) {
      return {
        ok: false,
        reason: `Migration ${change.from}-${change.to} cannot be used: ${script.error.message}.`,
      };
    }
    scripts.push(script.value);
  }

  const empty = await freshDatabase(`${area}/empty`);
  if ("error" in empty) return { ok: false, reason: empty.error };
  const emptyFailed = await migrateOnce(
    `${area}/empty`,
    empty.path,
    "before",
    0,
    dataSchema,
    scripts,
  );
  if (emptyFailed !== null) return { ok: false, reason: emptyFailed };

  if (previousSchema === null || previousSchema === 0) return { ok: true };
  const upgrade = await freshDatabase(`${area}/upgrade`);
  if ("error" in upgrade) return { ok: false, reason: upgrade.error };
  const seedFailed = await migrateOnce(
    `${area}/upgrade`,
    upgrade.path,
    "seed",
    0,
    previousSchema,
    scripts,
  );
  if (seedFailed !== null) {
    return {
      ok: false,
      reason: `The migrations do not reach schema ${previousSchema}, the schema of the active release. ${seedFailed}`,
    };
  }
  const upgradeFailed = await migrateOnce(
    `${area}/upgrade`,
    upgrade.path,
    "before",
    previousSchema,
    dataSchema,
    scripts,
  );
  return upgradeFailed === null
    ? { ok: true }
    : { ok: false, reason: upgradeFailed };
}
