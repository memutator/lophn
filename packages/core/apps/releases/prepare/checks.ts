// release 준비가 그 자리에서 하는 migration 검사.
// core module graph에 넣지 않는다(mod.ts에서 내보내지 않는다). 앱 DB를 여는 data/worker/db.ts는
// core가 import하지 않는 모듈이고, 앱이 쓴 migration SQL은 release 준비 자식에서만 돈다.
// 부르는 곳은 packages/core/main/worker/release-job.ts 하나다.

import { mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { compareVersions } from "../../../../base/mod.ts";
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
import { phoneSchemaProblemsOfDatabase } from "../phone-backend/schema-read.ts";
import type { AppDeclaration } from "../../../../protocol/apps/declaration/types.ts";
import {
  sentTables,
  type SyncPlan,
  syncPlanOf,
  syncsData,
} from "../../../../protocol/apps/declaration/sync-plan.ts";

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

// data가 기계 사이를 오가는 앱의 선언(평가한 JSON, 아직 검증기를 지나지 않았을 수 있다)이 정한 길. `runs_on`에 phone이면
// 폰과, `sync`가 table을 적으면 그 table을 폴더로 다른 컴퓨터와 맞춘다. 모양이 틀린 칸은 없는 것으로 본다(검증기가 거절한다).
function planOf(declaration: unknown): SyncPlan {
  const given = (declaration ?? {}) as Record<string, unknown>;
  const sync = given["sync"];
  return syncPlanOf({
    runs_on: Array.isArray(given["runs_on"])
      ? (given["runs_on"] as AppDeclaration["runs_on"])
      : undefined,
    sync:
      sync === "local"
        ? "local"
        : sync !== null && typeof sync === "object" && !Array.isArray(sync)
          ? (sync as AppDeclaration["sync"])
          : undefined,
    // 다른 컴퓨터에서 온 옛 release(take-in·따라가기)는 이 칸으로 모든 표를 보낸다.
    sync_to:
      typeof given["sync_to"] === "string" ? given["sync_to"] : undefined,
    sdk_dependencies: Array.isArray(given["sdk_dependencies"])
      ? (given["sdk_dependencies"] as AppDeclaration["sdk_dependencies"])
      : undefined,
  });
}

// 폰에서도 도는 앱이 걸어야 하는 SDK의 하한이다. 그 밑 판에는 폰 entry(`lophn-phone`)가 없다.
const PHONE_SDK_FLOOR = {
  "@lophn/cap-store": "2.0.0",
  "@lophn/cap-tool": "2.2.0",
} as const;
// table을 폴더로만 보내는 앱은 컴퓨터에서 도는 sync 앱이라 변경을 뜨는 cap-store만 있으면 된다.
const FOLDER_SDK_FLOOR = { "@lophn/cap-store": "2.0.0" } as const;

// 선언이 SDK 하한을 걸었는지 본다. `runs_on`에 phone이 있거나 `sync`가 table을 보내는 앱만 본다. 문제가 없으면 null이다.
export function syncSdkFloorProblem(declaration: unknown): string | null {
  const plan = planOf(declaration);
  if (!syncsData(plan)) return null;
  const floors = plan.phone ? PHONE_SDK_FLOOR : FOLDER_SDK_FLOOR;
  const pinned = (declaration as { sdk_dependencies?: unknown } | null)
    ?.sdk_dependencies;
  const dependencies = Array.isArray(pinned) ? pinned : [];
  for (const [name, floor] of Object.entries(floors)) {
    const found = dependencies.find(
      (dependency) => dependency?.name === name,
    ) as { version?: unknown } | undefined;
    if (
      typeof found?.version !== "string" ||
      compareVersions(found.version, floor) < 0
    ) {
      return plan.phone
        ? "an app that runs on the phone needs @lophn/cap-store 2.0.0 and @lophn/cap-tool 2.2.0 or later"
        : "an app whose sync sends tables needs @lophn/cap-store 2.0.0 or later";
    }
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

async function bundlePlan(bundleRoot: string): Promise<SyncPlan> {
  return planOf(
    JSON.parse(await readFile(`${bundleRoot}/declaration.json`, "utf8")),
  );
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
  // data가 기계 사이를 오가는 앱(runs_on phone이나 sync)의 schema는 빈 DB에서 target까지 올린 이 DB에서 본다. 규칙은 맞추는
  // 표에만 건다: 폰 앱은 폰 길이 모든 표를 맞추고, 그 밖에는 `sync`가 보내는 표다.
  const plan = await bundlePlan(input.bundleRoot);
  if (syncsData(plan)) {
    const db = new DatabaseSync(empty.path, { readOnly: true });
    try {
      const destinationOf = new Map<string, string>();
      for (const [name, tables] of plan.destinations) {
        for (const table of tables ?? []) destinationOf.set(table, name);
      }
      const problems = phoneSchemaProblemsOfDatabase(
        db,
        plan.phone ? null : sentTables(plan),
        [...destinationOf.keys()],
        destinationOf,
      );
      if (problems.length > 0) {
        return {
          ok: false,
          reason: `An app whose data syncs (runs_on phone or sync) must follow these schema rules on the tables that sync. ${problems.join(" ")}`,
        };
      }
    } finally {
      db.close();
    }
  }

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
