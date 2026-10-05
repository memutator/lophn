// apps/data의 backup·migration·restore. 실제 파일을 temp 데이터 root에서 연다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "../../../base/mod.ts";
import {
  decodeDataJobOutput,
  encodeDataJobInput,
} from "../../../contracts/apps/mod.ts";
import type { DataChange } from "../../../contracts/apps/mod.ts";
import { migrationFlags } from "../../permissions/mod.ts";
import { appBackupNames, createAppBackup, retainAppBackups } from "./backup.ts";
import { copyDatabaseFile, databaseHash, openAppDatabase } from "./db.ts";
import { verifyDatabase } from "./integrity.ts";
import { migrationChildFlags, runDataJob } from "./job.ts";
import { acquireDataLock } from "./lock.ts";
import {
  migrateAppDatabase,
  publishedScriptChanged,
  scriptFromBundle,
} from "./migrate.ts";
import type { MigrationScript } from "./migrate.ts";
import { contained, insideDataArea } from "./paths.ts";
import { restoreAppBackup } from "./restore.ts";
import { migrationChanged, migrationPath, schemaCheck } from "./schema.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const ACTIVATION = "1";

async function tempArea(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-app-data-" });
}

function seed(path: string, rows: readonly string[]): void {
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("create table items (body text not null)");
  for (const row of rows) {
    db.prepare("insert into items (body) values (?)").run(row);
  }
  db.close();
}

function items(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare("select body from items order by rowid").all();
  db.close();
  return rows.map((row) => String(row["body"]));
}

async function change(
  from: number,
  to: number,
  sql: string,
): Promise<MigrationScript> {
  const hash = `sha256:${await sha256Hex(sql)}`;
  const dataChange: DataChange = {
    from,
    to,
    script_hash: hash,
    description: `schema ${from} to ${to}`,
  };
  return { change: dataChange, sql };
}

Deno.test(
  "apps/data#R1: 앱 DB는 앱마다 파일이 다르고 data worker만 연다",
  async () => {
    const root = await tempArea();
    const first = `${root}/apps/${APP}/data/data.db`;
    const second = `${root}/apps/app_01h455vb4pex5v6nkc6gd5fdw2/data/data.db`;
    await Deno.mkdir(`${root}/apps/${APP}/data`, { recursive: true });
    await Deno.mkdir(
      `${root}/apps/app_01h455vb4pex5v6nkc6gd5fdw2/data`,
      { recursive: true },
    );
    seed(first, ["one"]);
    seed(second, ["two"]);
    // 두 앱의 DB 파일은 물리적으로 다르다.
    assertEquals(items(first), ["one"]);
    assertEquals(items(second), ["two"]);
    // data worker 경로는 앱 데이터 영역 안에서만 파일을 연다.
    const opened = openAppDatabase(first);
    assert(opened.ok);
    opened.value.close();
  },
);

Deno.test(
  "apps/data#R2: 업무 저장과 ledger 기록은 함께 rollback됐다고 표시하지 않는다",
  async () => {
    const { boundaryFact } = await import("../commands.ts");
    // 업무 저장은 끝났는데 ledger 전달이 실패한 경계. 함께 rollback됐다고 말하지 않는다.
    const fact = boundaryFact(true, false);
    assertEquals(fact.businessSaved, true);
    assertEquals(fact.ledgerRecorded, false);
    assertEquals(fact.rolledBackTogether, false);
    // ORM을 쓰지 않은 앱도 같은 schema 규칙을 통과한다.
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["plain"]);
    const opened = openAppDatabase(path);
    assert(opened.ok);
    assertEquals(opened.value.schemaState().dataSchema, 0);
    assertEquals(opened.value.schemaState().lastResult, "none");
    opened.value.close();
  },
);

Deno.test(
  "apps/data#R3: DB 미사용 앱은 schema 0이고 사용 앱은 실제 schema와 마지막 결과를 확인한다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    const created = new DatabaseSync(path);
    created.exec("pragma journal_mode = wal");
    created.close();
    const opened = openAppDatabase(path);
    assert(opened.ok);
    assertEquals(opened.value.schemaState(), {
      dataSchema: 0,
      lastResult: "none",
      scriptHash: null,
    });
    const step = await change(0, 1, "create table items (body text not null)");
    const applied = opened.value.applyStep(step.sql, {
      dataSchema: 1,
      scriptHash: step.change.script_hash,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    assert(applied.ok);
    assertEquals(opened.value.schemaState().dataSchema, 1);
    assertEquals(opened.value.schemaState().lastResult, "applied");
    assertEquals(
      opened.value.schemaState().scriptHash,
      step.change.script_hash,
    );
    opened.value.close();
    // 확인은 다시 열어서 실제 값으로 한다.
    const verified = await verifyDatabase(path);
    assert(verified.ok);
    assertEquals(verified.value.state.dataSchema, 1);
    assertEquals(verified.value.integrityOk, true);
  },
);

Deno.test(
  "apps/data#R5: WAL의 새 항목이 backup·복구 뒤에도 남고 본체 복사는 유효 backup이 아니다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["committed"]);
    // WAL에만 있는 새 항목. checkpoint하지 않는다.
    const db = new DatabaseSync(path);
    db.exec("begin immediate");
    db.prepare("insert into items (body) values (?)").run("in wal");
    db.exec("commit");
    const backup = await createAppBackup(area, path, "backup-1");
    db.close();
    assert(backup.ok);
    const restored = `${area}/restored.db`;
    await Deno.copyFile(`${area}/backups/backup-1`, restored);
    // backup API 결과는 WAL의 확정 내용까지 담는다.
    assertEquals(items(restored), ["committed", "in wal"]);
    // 본체 파일 복사는 backup이 아니다. backup은 무결성·schema 확인을 통과한
    // backup API 결과만 남기고, 파일 복사본은 그 확인을 거치지 않는다.
    const copied = `${area}/copied.db`;
    const fileCopy = await copyDatabaseFile(path, copied);
    assert(fileCopy.ok);
    const copyHash = await databaseHash(copied);
    const backupHash = await databaseHash(`${area}/backups/backup-1`);
    assert(copyHash.ok && backupHash.ok);
    assert(copyHash.value !== backupHash.value);
    // 깨진 파일 복사본은 backup 확인을 통과하지 못한다.
    await Deno.writeTextFile(`${area}/garbage.db`, "not a database");
    const garbage = await verifyDatabase(`${area}/garbage.db`);
    assert(!garbage.ok);
  },
);

Deno.test(
  "apps/data#R6: 단계 중간 실패에서 데이터 변경과 schema 번호가 함께 rollback된다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["kept"]);
    const opened = openAppDatabase(path);
    assert(opened.ok);
    const step = await change(
      0,
      1,
      "insert into items (body) values ('added'); select raise(abort, 'stop')",
    );
    const applied = opened.value.applyStep(step.sql, {
      dataSchema: 1,
      scriptHash: step.change.script_hash,
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    assert(!applied.ok);
    assertEquals(opened.value.schemaState().dataSchema, 0);
    opened.value.close();
    assertEquals(items(path), ["kept"]);
  },
);

Deno.test(
  "apps/data#R7: 0에서 3으로 가는 변경의 두 번째 단계가 실패하면 0으로 복원된다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["original"]);
    const backup = await createAppBackup(area, path, "before");
    assert(backup.ok);
    const first = await change(
      0,
      1,
      "insert into items (body) values ('step1')",
    );
    const second = await change(
      1,
      3,
      "insert into items (body) values ('step2'); select raise(abort, 'stop')",
    );
    const migrated = await migrateAppDatabase({
      dataArea: area,
      databasePath: path,
      backupPath: `${area}/backups/before`,
      targetSchema: 3,
      scripts: [first, second],
      appliedAt: "2026-01-01T00:00:00.000Z",
      result: {
        release: RELEASE,
        activation_seq: ACTIVATION,
        invocation: null,
      },
    });
    assert(migrated.ok);
    assertEquals(migrated.value.restored, true);
    assertEquals(migrated.value.result.data_schema, 0);
    assertEquals(migrated.value.result.integrity_ok, true);
    assertEquals(items(path), ["original"]);
    const verified = await verifyDatabase(path);
    assert(verified.ok);
    assertEquals(verified.value.state.dataSchema, 0);
  },
);

Deno.test(
  "apps/data#R8: 공개한 migration script를 바꾸면 거절된다",
  async () => {
    const published = "create table items (body text not null)";
    const hash = `sha256:${await sha256Hex(published)}`;
    const changed = await publishedScriptChanged(
      { scriptHash: hash, sql: published },
      "create table items (body text not null, extra integer)",
    );
    assertEquals(changed, true);
    const same = await publishedScriptChanged(
      { scriptHash: hash, sql: published },
      published,
    );
    assertEquals(same, false);
    // 같은 from·to의 script hash가 달라지면 공개본 변경이다.
    const original: DataChange = {
      from: 0,
      to: 1,
      script_hash: hash,
      description: "first",
    };
    const rewritten: DataChange = {
      ...original,
      script_hash: "sha256:" + "a".repeat(64),
    };
    assertEquals(migrationChanged(original, rewritten), true);
    // 새 변경은 새 경로로만 추가된다.
    const added: DataChange = {
      from: 1,
      to: 2,
      script_hash: "sha256:" + "b".repeat(64),
      description: "second",
    };
    const path = migrationPath(0, 2, [original, added]);
    assert(path.ok);
    assertEquals(path.value.steps.map((step) => step.to), [1, 2]);
    // bundle 안의 script를 바꾸면 hash가 어긋나 그 release는 거절된다.
    const area = await tempArea();
    const bundle = `${area}/bundle`;
    await Deno.mkdir(`${bundle}/migrations`, { recursive: true });
    const fileHash = await sha256Hex(published);
    await Deno.writeTextFile(
      `${bundle}/migrations/${fileHash}.sql`,
      "create table items (body text not null, extra integer)",
    );
    const loaded = await scriptFromBundle(bundle, original);
    assert(!loaded.ok);
  },
);

Deno.test(
  "apps/data#R10: migration 6회 뒤 최근 5개만 남고 진행 중 복원 참조는 보존된다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["row"]);
    for (let index = 1; index <= 6; index++) {
      const created = await createAppBackup(area, path, `backup-${index}`);
      assert(created.ok);
    }
    // 가장 오래된 backup이 진행 중 복원의 참조다.
    const retained = await retainAppBackups(area, {
      protectedNames: ["backup-1"],
    });
    assert(retained.ok);
    const names = [...await appBackupNames(area)];
    assertEquals(names.includes("backup-1"), true);
    assertEquals(names.length, 6);
    // 진행이 끝나면 참조 보호가 풀리고 최근 5개만 남는다.
    const finished = await retainAppBackups(area, { protectedNames: [] });
    assert(finished.ok);
    assertEquals([...(await appBackupNames(area))], [
      "backup-2",
      "backup-3",
      "backup-4",
      "backup-5",
      "backup-6",
    ]);
  },
);

Deno.test(
  "apps/data#R14: schema 통과를 업무 정확성으로 표시하지 않는다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    const db = new DatabaseSync(path);
    db.exec("create table totals (expected integer, actual integer)");
    // 형태는 맞지만 합계가 틀리다.
    db.prepare("insert into totals (expected, actual) values (?, ?)").run(
      10,
      7,
    );
    db.close();
    const verified = await verifyDatabase(path);
    assert(verified.ok);
    assertEquals(verified.value.integrityOk, true);
    const check = schemaCheck(true);
    assertEquals(check.schemaOk, true);
    assertEquals(check.businessCorrect, null);
  },
);

Deno.test(
  "apps/data#R6: migration 자식에는 network·secret·외부 fs·subprocess 권한이 없다",
  () => {
    const flags = migrationFlags(
      { bundle: "/apps/app/bundle", data: "/apps/app/data" },
      ["/home/person"],
    );
    assert(flags.ok);
    const joined = flags.value.args.join(" ");
    for (
      const forbidden of [
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "--allow-ffi",
        "--allow-all",
      ]
    ) {
      assertEquals(joined.includes(forbidden), false);
    }
    assertEquals(joined.includes("--allow-read="), true);
    assertEquals(joined.includes("--allow-write=/apps/app/data"), true);
    const checked = migrationChildFlags(
      { bundle: "/apps/app/bundle", data: "/apps/app/data" },
      [],
    );
    assert(checked.ok);
  },
);

Deno.test(
  "apps/data#R1: 경로는 앱 데이터 영역 밖으로 벗어나지 못한다",
  async () => {
    const area = await tempArea();
    assert(!insideDataArea(area, "../outside").ok);
    assert(!insideDataArea(area, "/etc/passwd").ok);
    assert(!insideDataArea(area, "backups/../../outside").ok);
    const inside = insideDataArea(area, "backups/backup-1");
    assert(inside.ok);
    // symlink가 영역 밖을 가리키면 해석 결과가 영역 밖이다.
    const outside = await Deno.makeTempDir({ prefix: "lophn-app-outside-" });
    await Deno.mkdir(`${area}/link-parent`, { recursive: true });
    await Deno.symlink(outside, `${area}/link-parent/escape`);
    const resolved = await Deno.realPath(`${area}/link-parent/escape`);
    assertEquals(contained(area, resolved), false);
    assertEquals(contained(area, `${area}/backups/backup-1`), true);
  },
);

Deno.test(
  "apps/data#R1: 같은 앱 데이터에서 job 둘은 동시에 돌지 않는다",
  async () => {
    const area = await tempArea();
    const first = await acquireDataLock(area);
    assert(first.ok);
    const second = await acquireDataLock(area);
    assert(!second.ok);
    assertEquals(second.error.code, "conflict");
    await first.value.release();
    const third = await acquireDataLock(area);
    assert(third.ok);
    await third.value.release();
  },
);

Deno.test(
  "apps/data#R7: 복원 교체가 실패하면 원본이 그대로 남는다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["original"]);
    const backup = await createAppBackup(area, path, "before");
    assert(backup.ok);
    // 원본을 바꾼 뒤 깨진 backup으로 복원을 시도한다.
    const db = new DatabaseSync(path);
    db.prepare("insert into items (body) values (?)").run("later");
    db.close();
    await Deno.writeTextFile(`${area}/backups/broken`, "not a database");
    const restored = await restoreAppBackup(
      area,
      path,
      `${area}/backups/broken`,
    );
    assert(!restored.ok);
    assertEquals(items(path), ["original", "later"]);
    // 정상 backup 복원은 원본을 교체하고 이전 파일은 남기지 않는다.
    const ok = await restoreAppBackup(area, path, `${area}/backups/before`);
    assert(ok.ok);
    assertEquals(items(path), ["original"]);
    const previous = await Deno.stat(`${area}/restore.previous`).then(
      () => true,
      () => false,
    );
    assertEquals(previous, false);
  },
);

Deno.test(
  "apps/data#R5: data job은 stdin JSON 한 줄로 backup을 만들고 DataResult를 낸다",
  async () => {
    const area = await tempArea();
    const path = `${area}/data.db`;
    seed(path, ["job"]);
    const line = encodeDataJobInput({
      kind: "backup",
      app: APP,
      release: RELEASE,
      activation_seq: ACTIVATION,
      data_path: "data.db",
      data_schema: 0,
    });
    const outcome = await runDataJob(
      { dataArea: area, databasePath: path },
      line,
    );
    assert(outcome.ok);
    const output = decodeDataJobOutput(outcome.value);
    assertEquals(output.result.integrity_ok, true);
    assertEquals(output.result.data_schema, 0);
    assertEquals(output.result.release, RELEASE);
    const names = [...await appBackupNames(area)];
    assertEquals(names, [`backup-${ACTIVATION}`]);
  },
);
