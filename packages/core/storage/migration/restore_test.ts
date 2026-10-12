// restore의 실제 파일 테스트(platform/backup-and-migration#R13, R14, platform/ledger#R19). 실제
// SQLite ledger와 blob directory를 temp dir에서 띄우고, 사람 data root는 열지 않는다.

import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, sha256Hex } from "../../../base/mod.ts";
import {
  applyMigrations,
  BACKUP_PENDING_NAME,
  backupStamp,
  createBackup,
  ensureLedgerId,
  isLedgerId,
  LEDGER_ID_FILE,
  planRestore,
  readLedgerId,
  restoreBinding,
  restoreFromBackup,
  type RestoreStopped,
  writeLedgerId,
} from "./mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../ledger/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../config/mod.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const STOPPED: RestoreStopped = {
  preparationsBlocked: true,
  commandsBlocked: true,
  writerStopped: true,
};

async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-restore-" });
}

async function ledger(
  root: string,
): Promise<{ path: string; version: number }> {
  const path = `${root}/lophn.db`;
  const steps = [...LEDGER_SCHEMA_STEPS, ...SETTINGS_SCHEMA_STEPS];
  const applied = await applyMigrations(path, steps, {
    clock: manualClock(START),
  });
  assert(applied.ok);
  return { path, version: steps.length };
}

// 실제 blob 파일을 원본 자리에 남기고 blob_refs에 등록한다.
async function seedBlob(root: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const hash = await sha256Hex(bytes);
  const directory = `${root}/blobs/sha256/${hash.slice(0, 2)}`;
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeFile(`${directory}/${hash.slice(2)}`, bytes, { mode: 0o400 });
  const db = new DatabaseSync(`${root}/lophn.db`);
  try {
    db.prepare(
      "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
    ).run("BlobAttached", "doc_1", "user", "{}", "2026-01-01T00:00:00.000Z");
    const head = db.prepare("select last_insert_rowid() as seq").get() as {
      seq: number;
    };
    db.prepare(
      "insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq) values (?, ?, ?, ?, ?, ?)",
    ).run("document_version", "doc_1", "file", hash, bytes.length, head.seq);
  } finally {
    db.close();
  }
  return hash;
}

function addEvents(root: string, count: number): void {
  const db = new DatabaseSync(`${root}/lophn.db`);
  try {
    for (let index = 0; index < count; index++) {
      db.prepare(
        "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
      ).run("Later", "doc_1", "user", "{}", "2026-01-02T00:00:00.000Z");
    }
  } finally {
    db.close();
  }
}

function headOf(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(
      (db.prepare("select coalesce(max(seq), 0) as seq from events").get() as {
        seq: number | bigint;
      }).seq,
    );
  } finally {
    db.close();
  }
}

type Fixture = {
  root: string;
  path: string;
  version: number;
  createdAt: string;
  backupFolder: string;
  keptBlob: string;
  lostBlob: string;
  oldId: string;
};

// seq 1 + blob 하나를 backup하고 그 뒤 seq 2(blob)·3·4를 더한다. backup 뒤 기록 3개가 잃을 범위다.
async function fixture(): Promise<Fixture> {
  const root = await tempDir();
  const { path, version } = await ledger(root);
  const keptBlob = await seedBlob(root, "kept blob");
  const stamp = backupStamp("2026-01-02T03:04:05.678Z");
  assert(stamp.ok);
  const created = await createBackup(path, {
    root,
    schemaVersion: version,
    stamp: stamp.value,
    now: () => "2026-01-02T03:04:06.000Z",
  });
  assert(created.ok);
  const lostBlob = await seedBlob(root, "lost blob");
  addEvents(root, 2);
  const oldId = await ensureLedgerId(root, false);
  assert(oldId.ok);
  return {
    root,
    path,
    version,
    createdAt: created.value.created_at,
    backupFolder: `${root}/backups/${stamp.value}`,
    keptBlob,
    lostBlob,
    oldId: oldId.value,
  };
}

function deps(
  f: Fixture,
  over: Partial<Parameters<typeof restoreFromBackup>[0]>,
) {
  return {
    root: f.root,
    ledgerPath: f.path,
    stamp: "20260103T000000000Z",
    createdAt: f.createdAt,
    supportedSchema: f.version,
    expectedCurrentSeq: "4",
    conditions: STOPPED,
    now: () => "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

const blobAt = (root: string, hash: string) =>
  `${root}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;

Deno.test("platform/backup-and-migration#R13: 계획은 묶음 뒤 현재 끝까지 잃을 기록 범위를 보인다", async () => {
  const f = await fixture();
  try {
    const planned = await planRestore(f.root, f.path, f.createdAt, f.version);
    assert(planned.ok, planned.ok ? "" : planned.error.message);
    assertEquals(planned.value.manifest.through_seq, "1");
    assertEquals(planned.value.current_through_seq, "4");
    assertEquals(planned.value.lost, {
      from_seq: "2",
      through_seq: "4",
      events: 3,
    });
    // 확인 기준은 잃을 범위에 묶인다. 현재 끝이 자라면 다른 값이라 옛 확인을 쓸 수 없다.
    const before = await restoreBinding(planned.value);
    addEvents(f.root, 1);
    const grown = await planRestore(f.root, f.path, f.createdAt, f.version);
    assert(grown.ok);
    const after = await restoreBinding(grown.value);
    assertEquals(before.target, after.target);
    assert(before.content !== after.content);
    // 잃을 것이 없는 묶음은 범위가 null이다.
    const unseeded = await planRestore(
      f.root,
      `${f.root}/missing.db`,
      f.createdAt,
      f.version,
    );
    assert(unseeded.ok);
    assertEquals(unseeded.value.lost, null);
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R13: 정지를 확인하지 못했거나 사람이 본 끝과 다르면 아무것도 바꾸지 않는다", async () => {
  const f = await fixture();
  try {
    const rootEntries = async () =>
      (await Array.fromAsync(Deno.readDir(f.root))).map((e) => e.name)
        .filter((name) => !name.startsWith("lophn.db-")).sort();
    const before = await rootEntries();
    for (
      const conditions of [
        { ...STOPPED, writerStopped: false },
        { ...STOPPED, commandsBlocked: false },
        { ...STOPPED, preparationsBlocked: false },
      ]
    ) {
      const refused = await restoreFromBackup(deps(f, { conditions }));
      assert(!refused.ok);
      assertEquals(headOf(f.path), 4);
    }
    // 사람이 본 끝(4) 뒤에 기록이 더 생겼다. 확인하지 않은 기록은 잃지 않는다.
    addEvents(f.root, 1);
    const stale = await restoreFromBackup(deps(f, {}));
    assert(!stale.ok);
    if (!stale.ok) assertEquals(stale.error.code, "conflict");
    assertEquals(headOf(f.path), 5);
    assertEquals(
      await Deno.readTextFile(`${f.root}/${LEDGER_ID_FILE}`),
      `${f.oldId}\n`,
    );
    // 보존본·staging 자리를 만들지 않았다.
    assertEquals(await rootEntries(), [...before].sort());
    await assertRejectsMissing(`${f.root}/backups/restore`);
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

async function assertRejectsMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
  } catch (thrown) {
    assert(thrown instanceof Deno.errors.NotFound);
    return;
  }
  throw new Error(`${path}가 있다`);
}

Deno.test("platform/backup-and-migration#R13 #R14: 복원은 현재 자료를 따로 남기고 검증한 묶음으로 바꾸며 새 ledger 식별을 정한다", async () => {
  const f = await fixture();
  try {
    const restored = await restoreFromBackup(deps(f, {}));
    assert(restored.ok, restored.ok ? "" : restored.error.message);
    const outcome = restored.value;
    assertEquals(outcome.restored_through_seq, "1");
    assertEquals(outcome.previous_through_seq, "4");
    // 새 ledger는 묶음의 끝이다. 묶음 뒤 기록은 현재 ledger에 없다.
    assertEquals(headOf(f.path), 1);
    // 이전 현재 자료는 따로 남았다: ledger 끝과 backup 뒤에 등록한 blob까지.
    assertEquals(headOf(`${outcome.previous_directory}/ledger.db`), 4);
    const preservedBlob = await Deno.readTextFile(
      `${outcome.previous_directory}/blobs/sha256/${f.lostBlob.slice(0, 2)}/${
        f.lostBlob.slice(2)
      }`,
    );
    assertEquals(preservedBlob, "lost blob");
    const note = JSON.parse(
      await Deno.readTextFile(`${outcome.previous_directory}/previous.json`),
    );
    assertEquals(note.through_seq, "4");
    assertEquals(note.ledger_id, f.oldId);
    assertEquals(note.missing_blobs, 0);
    // 묶음 blob은 store에 있고 내용이 같다.
    assertEquals(
      await Deno.readTextFile(blobAt(f.root, f.keptBlob)),
      "kept blob",
    );
    // 새 식별은 옛 값과 다르다(R14).
    assert(isLedgerId(outcome.ledger_id));
    assert(outcome.ledger_id !== f.oldId);
    assertEquals(await readLedgerId(f.root), outcome.ledger_id);
    // 복원한 ledger는 통상 무결성·FK 검사를 통과한다.
    const db = new DatabaseSync(f.path, { readOnly: true });
    assertEquals(
      db.prepare("select count(*) as n from pragma_foreign_key_check").get()?.n,
      0,
    );
    db.close();
    // 묶음 folder는 그대로다(복원이 묶음을 소비하지 않는다).
    const again = await planRestore(f.root, f.path, f.createdAt, f.version);
    assert(again.ok);
    // 같은 시각에 다시 복원해도 앞선 보존본을 덮지 않는다.
    const second = await restoreFromBackup(
      deps(f, { expectedCurrentSeq: "1" }),
    );
    assert(second.ok, second.ok ? "" : second.error.message);
    assert(second.value.previous_directory !== outcome.previous_directory);
    assertEquals(headOf(`${outcome.previous_directory}/ledger.db`), 4);
    assert(second.value.ledger_id !== outcome.ledger_id);
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R13: 만들기 중·검증 실패·변조·새 schema 묶음은 복원하지 않고 현재 자료를 그대로 둔다", async () => {
  const f = await fixture();
  try {
    // 만들기 중 표시가 남은 묶음.
    await Deno.writeTextFile(`${f.backupFolder}/${BACKUP_PENDING_NAME}`, "x");
    const pending = await restoreFromBackup(deps(f, {}));
    assert(!pending.ok);
    await Deno.remove(`${f.backupFolder}/${BACKUP_PENDING_NAME}`);
    // 이 설치보다 새 schema.
    const newer = await restoreFromBackup(
      deps(f, { supportedSchema: f.version - 1 }),
    );
    assert(!newer.ok);
    // 없는 묶음.
    const missing = await restoreFromBackup(
      deps(f, { createdAt: "2030-01-01T00:00:00.000Z" }),
    );
    assert(!missing.ok);
    if (!missing.ok) assertEquals(missing.error.code, "not_found");
    // backup ledger 변조: manifest의 hash와 달라진다.
    const ledgerFile = `${f.backupFolder}/ledger.db`;
    const original = await Deno.readFile(ledgerFile);
    const tampered = original.slice();
    tampered[tampered.length - 1] ^= 0xff;
    await Deno.writeFile(ledgerFile, tampered);
    const badLedger = await restoreFromBackup(deps(f, {}));
    assert(!badLedger.ok);
    await Deno.writeFile(ledgerFile, original);
    // backup blob 변조.
    const blobFile = `${f.backupFolder}/blobs/sha256/${
      f.keptBlob.slice(0, 2)
    }/${f.keptBlob.slice(2)}`;
    await Deno.chmod(blobFile, 0o600);
    await Deno.writeTextFile(blobFile, "kept blob?");
    const badBlob = await restoreFromBackup(deps(f, {}));
    assert(!badBlob.ok);
    // 어느 경우에도 현재 ledger와 식별은 그대로다.
    assertEquals(headOf(f.path), 4);
    assertEquals(await readLedgerId(f.root), f.oldId);
    assertEquals(
      await Deno.readTextFile(blobAt(f.root, f.lostBlob)),
      "lost blob",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R14: ledger 식별은 만들 때 새로 정하고 있으면 그대로 두며 읽을 수 없으면 새로 정한다", async () => {
  const root = await tempDir();
  try {
    // 새 ledger를 만드는 기동.
    const created = await ensureLedgerId(root, false);
    assert(created.ok);
    assert(isLedgerId(created.value));
    // 있는 ledger와 있는 식별은 그대로다.
    const kept = await ensureLedgerId(root, true);
    assert(kept.ok);
    assertEquals(kept.value, created.value);
    // ledger를 새로 만들면(옛 파일이 남았어도) 새 값이다.
    const recreated = await ensureLedgerId(root, false);
    assert(recreated.ok);
    assert(recreated.value !== created.value);
    // 식별 파일이 읽히지 않으면 새 값이다. 틀린 형식을 식별로 쓰지 않는다.
    await Deno.writeTextFile(`${root}/${LEDGER_ID_FILE}`, "not-an-id\n");
    assertEquals(await readLedgerId(root), undefined);
    const replaced = await ensureLedgerId(root, true);
    assert(replaced.ok);
    assert(isLedgerId(replaced.value));
    const invalid = await writeLedgerId(root, "bad");
    assert(!invalid.ok);
    // 임시 파일이 남지 않는다.
    assertEquals(
      (await Array.fromAsync(Deno.readDir(root))).map((e) => e.name),
      [LEDGER_ID_FILE],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
