import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../../../../base/mod.ts";
import { createAppBackup } from "./backup.ts";
import { openAppDatabase } from "./db.ts";
import { runDataJob } from "./job.ts";
import { migrateAppDatabase } from "./migrate.ts";

async function withArea(run: (dataArea: string) => Promise<void>) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lophn-data-")));
  try {
    const dataArea = join(parent, "data").replaceAll("\\", "/");
    await mkdir(dataArea);
    await run(dataArea);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function dataSchemaOf(path: string): number {
  const opened = openAppDatabase(path);
  assert.ok(opened.ok);
  try {
    return opened.value.schemaState().dataSchema;
  } finally {
    opened.value.close();
  }
}

// restore가 live DB를 restore.previous로 옮긴 뒤 새 DB가 들어오기 전에 멈춘 상태다.
test("data worker는 끊긴 restore의 원래 DB를 되돌려 놓고 시작한다", async () => {
  await withArea(async (dataArea) => {
    const databasePath = `${dataArea}/app.sqlite`;
    const opened = openAppDatabase(databasePath);
    assert.ok(opened.ok);
    assert.ok(
      opened.value.applyStep("create table t (id integer primary key)", {
        dataSchema: 1,
        scriptHash: "sha256:x",
        appliedAt: "2000-01-01T00:00:00.000Z",
      }).ok,
    );
    opened.value.close();
    await rename(databasePath, `${dataArea}/restore.previous`);
    await writeFile(`${dataArea}/restore.tmp`, "half copied");
    const line = JSON.stringify({
      kind: "inspect",
      app: "app_01arz3ndektsv4rrffq69g5fav",
      release: "rel_01arz3ndektsv4rrffq69g5fav",
      attempt: "act_01arz3ndektsv4rrffq69g5fav",
      data_path: "app.sqlite",
      data_schema: 1,
    });
    const done = await runDataJob({ dataArea, databasePath }, `${line}\n`);
    assert.ok(done.ok);
    assert.equal(dataSchemaOf(databasePath), 1);
    await assert.rejects(rm(`${dataArea}/restore.tmp`, { force: false }));
  });
});

// 단계는 다 적용됐지만 사후 검사(target schema)가 실패하는 script다. trigger가 schema 번호를 바꾼다.
const SKEW_SQL = [
  "create table t (id integer primary key);",
  "create trigger skew_insert after insert on lophn_data_schema begin update lophn_data_schema set data_schema = 99; end;",
].join("\n");

test("migrate 뒤 검사가 실패하면 DB가 migrate 전 상태로 돌아간다", async () => {
  await withArea(async (dataArea) => {
    const databasePath = `${dataArea}/app.sqlite`;
    const opened = openAppDatabase(databasePath);
    assert.ok(opened.ok);
    opened.value.close();
    const backup = await createAppBackup(dataArea, databasePath, "backup-1");
    assert.ok(backup.ok);
    const migrated = await migrateAppDatabase({
      dataArea,
      databasePath,
      backupPath: `${dataArea}/backups/backup-1`,
      targetSchema: 1,
      scripts: [
        {
          change: {
            from: 0,
            to: 1,
            script_hash: await sha256Hex(SKEW_SQL),
            description: "skew",
          },
          sql: SKEW_SQL,
        },
      ],
      appliedAt: "2000-01-01T00:00:00.000Z",
      result: {
        release: "rel_01arz3ndektsv4rrffq69g5fav",
        attempt: "act_01arz3ndektsv4rrffq69g5fav",
        invocation: null,
      },
    });
    assert.ok(migrated.ok);
    assert.ok(migrated.value.restored);
    assert.equal(migrated.value.result.data_schema, 0);
    assert.equal(dataSchemaOf(databasePath), 0);
  });
});
