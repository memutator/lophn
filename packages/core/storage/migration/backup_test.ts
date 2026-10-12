// backup 만들기·검증·보존의 실제 파일 테스트(platform/backup-and-migration#R8,
// R9, R10, R11, R12). 실제 SQLite ledger와 blob directory를 temp dir에서 띄운다.

import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, sha256Hex } from "../../../base/mod.ts";
import {
  BACKUP_EXCLUSIONS,
  BACKUP_MANIFEST_FORMAT,
} from "../../../protocol/platform/mod.ts";
import {
  applyMigrations,
  BACKUP_INTERVAL_MS,
  BACKUP_KEEP_COMPLETE,
  BACKUP_MANIFEST_NAME,
  BACKUP_PENDING_NAME,
  backupDue,
  backupStamp,
  createBackup,
  listBackups,
  retainBackups,
} from "./mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../ledger/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../config/mod.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");

async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-backup-" });
}

// schema를 적용한 실제 ledger를 만든다. 설정 표는 ledger 안에 있으므로 core와 같이
// ledger·settings 단계를 합쳐 적용한다. 설치된 마지막 migration version도 돌려준다.
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

// snapshot S를 계속 가지고 있는 다른 연결 모형이다. 운영 중 원본이 열려 있다.
function openExtra(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("select count(*) from events");
  return db;
}

// 실제 blob 파일을 원본 자리에 남기고 blob_refs에 등록한다(R8). size는 실제
// 바이트 길이다. 등록값과 다르면 만들기가 검증에 실패한다(R10).
async function seedBlob(
  root: string,
  body: string,
  registeredSize?: number,
): Promise<string> {
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
    ).run(
      "document_version",
      "doc_1",
      "file",
      hash,
      registeredSize ?? bytes.length,
      head.seq,
    );
  } finally {
    db.close();
  }
  return hash;
}

// stamp folder의 manifest.json을 그대로 읽는다(R8).
async function manifestOf(
  root: string,
  stamp: string,
): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(
    `${root}/backups/${stamp}/${BACKUP_MANIFEST_NAME}`,
  );
  return JSON.parse(text);
}

Deno.test(
  "platform/backup-and-migration#R8 #R9: 운영 중 backup은 snapshot S의 blob과 설정을 함께 담는다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const extra = openExtra(path);
    const first = await seedBlob(dir, "blob body one");
    const stamp = backupStamp("2026-01-02T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-02T03:04:06.000Z",
    });
    assert(backup.ok);
    const manifest = backup.value;
    // snapshot S의 마지막 seq다. extra 연결이 열려 있어도 snapshot은 일관됐다.
    assertEquals(manifest.through_seq, "1");
    assertEquals(manifest.schema_version, version);
    assertEquals(manifest.format, BACKUP_MANIFEST_FORMAT);
    assertEquals(manifest.settings, "ledger");
    assertEquals(manifest.blobs.length, 1);
    assertEquals(manifest.blobs[0]["hash"], first);
    assertEquals(
      manifest.blobs[0]["path"],
      `blobs/sha256/${first.slice(0, 2)}/${first.slice(2)}`,
    );
    // S 안의 setting_choices도 안에 있다. settings 표는 ledger 안에 있다.
    const copy = new DatabaseSync(
      `${dir}/backups/${stamp.value}/ledger.db`,
      { readOnly: true },
    );
    const settingsTable = copy.prepare(
      "select count(*) as n from sqlite_master where type = 'table' and name = 'setting_choices'",
    ).get() as { n: number };
    copy.close();
    // settings 표가 ledger 안에 있으므로 snapshot도 설정 선택을 담는다.
    assertEquals(settingsTable.n, 1);
    // backup 중 새 blob을 등록해도 snapshot S의 blob은 그대로다.
    const second = await seedBlob(dir, "blob body two");
    const stampManifest = await manifestOf(dir, stamp.value);
    assertEquals((stampManifest["blobs"] as unknown[]).length, 1);
    extra.close();
    void second;
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R10: blob 누락·변조·무결성 실패는 complete=false로 남는다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const hash = await seedBlob(dir, "blob body");
    const stamp = backupStamp("2026-01-02T03:04:05.678Z");
    assert(stamp.ok);
    // blob 바이트를 바꾼다(R10 확인). hash가 등록 값과 달라진다. 원본은 0400이므로
    // 권한을 연 뒤 쓴다.
    const blobPath = `${dir}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
    await Deno.chmod(blobPath, 0o600);
    await Deno.writeFile(blobPath, new TextEncoder().encode("blob bodi"));
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-02T03:04:06.000Z",
    });
    assert(!backup.ok);
    if (!backup.ok) assertEquals(backup.error.code, "unavailable");
    // manifest 전이므로 이 folder는 목록에 없다.
    const listed = await listBackups(dir);
    assertEquals(listed.backups.length, 0);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R10: blob 파일이 없으면 미완성이고 pending 표시가 남는다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const hash = await seedBlob(dir, "blob body");
    const stamp = backupStamp("2026-01-02T03:04:05.678Z");
    assert(stamp.ok);
    await Deno.remove(
      `${dir}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
    );
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-02T03:04:06.000Z",
    });
    assert(!backup.ok);
    // manifest 전이고 pending 표시가 남아 T44의 GC가 대상에서 뺀다.
    const pending = await Deno.stat(
      `${dir}/backups/${stamp.value}/${BACKUP_PENDING_NAME}`,
    );
    assert(pending.isFile);
    const listed = await listBackups(dir);
    assertEquals(listed.backups.length, 0);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R11: manifest에 제외 자료 안내가 있고 원문이 없다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const stamp = backupStamp("2026-01-03T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-03T03:04:06.000Z",
    });
    assert(backup.ok);
    const manifest = backup.value;
    assertEquals(new Set(manifest.excluded), new Set(BACKUP_EXCLUSIONS));
    assertEquals(
      [...manifest.excluded],
      ["app_db", "external_source", "keychain", "credential"],
    );
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R12: 8회 성공하면 최근 7개가 남는다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    for (let index = 0; index < 8; index++) {
      const stamp = backupStamp(
        `2026-01-${String(index + 1).padStart(2, "0")}T03:04:05.678Z`,
      );
      assert(stamp.ok);
      const backup = await createBackup(path, {
        root: dir,
        schemaVersion: version,
        stamp: stamp.value,
        now: () =>
          `2026-01-${String(index + 1).padStart(2, "0")}T03:04:06.000Z`,
      });
      assert(backup.ok);
    }
    const listed = await listBackups(dir);
    assertEquals(listed.backups.length, BACKUP_KEEP_COMPLETE);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R12: 실패·미완성 새 묶음 때문에 마지막 완료를 지우지 않는다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    // 완료 묶음을 7개 만든다.
    for (let index = 0; index < 7; index++) {
      const stamp = backupStamp(
        `2026-01-${String(index + 1).padStart(2, "0")}T03:04:05.678Z`,
      );
      assert(stamp.ok);
      const backup = await createBackup(path, {
        root: dir,
        schemaVersion: version,
        stamp: stamp.value,
        now: () =>
          `2026-01-${String(index + 1).padStart(2, "0")}T03:04:06.000Z`,
      });
      assert(backup.ok);
    }
    // 실패 묶음을 하나 만든다(blob을 누락한다).
    const missing = await seedBlob(dir, "will be removed");
    const stamp = backupStamp("2026-01-08T03:04:05.678Z");
    assert(stamp.ok);
    await Deno.remove(
      `${dir}/blobs/sha256/${missing.slice(0, 2)}/${missing.slice(2)}`,
    );
    const failed = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-08T03:04:06.000Z",
    });
    assert(!failed.ok);
    // 마지막 완료 7개는 그대로다(R12).
    const listed = await listBackups(dir);
    assertEquals(listed.backups.length, BACKUP_KEEP_COMPLETE);
    // 실패 folder는 남고, pending 표시가 붙어 GC가 대상에서 뺀다.
    const pending = await Deno.stat(
      `${dir}/backups/${stamp.value}/${BACKUP_PENDING_NAME}`,
    );
    assert(pending.isFile);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R12: retainBackups는 완료 folder만 보존 대상으로 산다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    // 완료 8개 + 실패 folder 하나를 만들고, 실패 folder는 retention 대상이 아니다.
    for (let index = 0; index < 8; index++) {
      const stamp = backupStamp(
        `2026-01-${String(index + 1).padStart(2, "0")}T03:04:05.678Z`,
      );
      assert(stamp.ok);
      const backup = await createBackup(path, {
        root: dir,
        schemaVersion: version,
        stamp: stamp.value,
        now: () =>
          `2026-01-${String(index + 1).padStart(2, "0")}T03:04:06.000Z`,
      });
      assert(backup.ok);
    }
    // 실패 folder를 직접 만든다(manifest 없음).
    await Deno.mkdir(`${dir}/backups/20260201T000000000Z`, {
      recursive: true,
      mode: 0o700,
    });
    const kept = await retainBackups(dir, BACKUP_KEEP_COMPLETE);
    assert(kept.ok);
    // 완료 7개만 남는다. 실패 folder는 그대로다.
    const listed = await listBackups(dir);
    assertEquals(listed.backups.length, BACKUP_KEEP_COMPLETE);
    const pending = await Deno.stat(`${dir}/backups/20260201T000000000Z`);
    assert(pending.isDirectory);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R9: 같은 stamp가 있으면 거절하고 원본을 건드리지 않는다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const stamp = backupStamp("2026-01-05T03:04:05.678Z");
    assert(stamp.ok);
    const first = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-05T03:04:06.000Z",
    });
    assert(first.ok);
    const again = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-05T03:04:07.000Z",
    });
    assert(!again.ok);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R9: 실제 검증 복원이 무결성 검사를 통과한다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    await seedBlob(dir, "blob body");
    const stamp = backupStamp("2026-01-04T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-04T03:04:06.000Z",
    });
    assert(backup.ok);
    // backup의 ledger 파일을 integrity 검사로 직접 본다(R9 확인).
    const copy = new DatabaseSync(
      `${dir}/backups/${stamp.value}/ledger.db`,
      { readOnly: true },
    );
    const rows = copy.prepare("pragma integrity_check").all() as {
      integrity_check: string;
    }[];
    copy.close();
    assertEquals(rows.length, 1);
    assertEquals(rows[0]["integrity_check"], "ok");
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R8: snapshot S의 blob_refs blob이 모두 manifest에 있다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const one = await seedBlob(dir, "blob one");
    const two = await seedBlob(dir, "blob two");
    const stamp = backupStamp("2026-01-09T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-09T03:04:06.000Z",
    });
    assert(backup.ok);
    assertEquals(backup.value.blobs.length, 2);
    assertEquals(
      new Set(backup.value.blobs.map((blob) => blob.hash)),
      new Set([one, two]),
    );
    // 복사한 blob 파일이 실제로 있고 내용이 같다(R10).
    for (const blob of backup.value.blobs) {
      const bytes = await Deno.readFile(
        `${dir}/backups/${stamp.value}/blobs/sha256/${blob.hash.slice(0, 2)}/${
          blob.hash.slice(2)
        }`,
      );
      assertEquals(await sha256Hex(bytes), blob.hash);
    }
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R12: 하루가 지나야 만들 차례다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    // 완료 묶음이 없으면 처음 만든다.
    assertEquals(
      await backupDue(
        dir,
        "2026-01-01T00:00:00.000Z",
        BACKUP_INTERVAL_MS,
      ),
      true,
    );
    const stamp = backupStamp("2026-01-01T00:00:00.000Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-01-01T00:00:01.000Z",
    });
    assert(backup.ok);
    // 같은 날에는 차례가 아니다.
    assertEquals(
      await backupDue(
        dir,
        "2026-01-01T12:00:00.000Z",
        BACKUP_INTERVAL_MS,
      ),
      false,
    );
    // 24시간이 지났으면 차례다.
    assertEquals(
      await backupDue(
        dir,
        "2026-01-02T00:00:02.000Z",
        BACKUP_INTERVAL_MS,
      ),
      true,
    );
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R8 #R10: event와 blob이 있는 ledger의 manifest가 seqSchema를 통과하고 기록된다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    // event 두 개 + blob 두 개의 실제 원본이다. 빈 ledger가 아니다.
    const one = await seedBlob(dir, "event body one");
    const two = await seedBlob(dir, "event body two");
    const stamp = backupStamp("2026-02-01T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-02-01T03:04:06.000Z",
    });
    assert(backup.ok);
    const manifest = backup.value;
    // events seq는 bigint로 읽힌다. manifest는 십진 문자열로 남는다(seqSchema).
    assertEquals(manifest.through_seq, "2");
    // size_bytes도 oracle 대로가 아니라 실제 바이트 길이다.
    assertEquals(manifest.blobs.length, 2);
    for (const blob of manifest.blobs) {
      assertEquals(typeof blob.size_bytes, "number");
      assert(Number.isSafeInteger(blob.size_bytes));
      assert(blob.size_bytes > 0);
    }
    // manifest.json 파일이 실제로 남는다. JSON.parse도 bigint 예외 없이 통과한다.
    const written = await manifestOf(dir, stamp.value);
    assertEquals(written["through_seq"], "2");
    // 원본 events seq와 같다. bigint -> string 변환을 명시히 좁힌 결과다.
    const db = new DatabaseSync(
      `${dir}/backups/${stamp.value}/ledger.db`,
      { readOnly: true },
    );
    const copySeq = db.prepare(
      "select max(seq) as seq from events",
    ).get() as { seq: number | bigint };
    db.close();
    assertEquals(String(copySeq["seq"]), manifest.through_seq);
    void one;
    void two;
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R10: 같은 blob을 가리키는 참조가 여러 개면 한 번만 복사한다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    const hash = await seedBlob(dir, "shared blob body");
    // 같은 hash를 두 번째 참조로 다시 등록한다. hash는 PK에 있으므로 다른 owner다.
    const db = new DatabaseSync(`${dir}/lophn.db`);
    try {
      db.prepare(
        "insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq) values (?, ?, ?, ?, ?, ?)",
      ).run(
        "document_version",
        "doc_2",
        "file",
        hash,
        new TextEncoder().encode("shared blob body").length,
        1,
      );
    } finally {
      db.close();
    }
    const stamp = backupStamp("2026-02-02T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-02-02T03:04:06.000Z",
    });
    assert(backup.ok);
    // 중복 참조도 manifest blob은 하나다(이미 등록된 원본 blob이 1개라서도 아니다).
    assertEquals(backup.value.blobs.length, 1);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R10: 등록 size가 실제와 달라도 hash가 맞으면 담고 manifest에는 실제 길이를 둔다",
  async () => {
    const dir = await tempDir();
    const { path, version } = await ledger(dir);
    // documents의 files 목록 blob은 size_bytes 0으로 등록된다. 내용 손상이 아니다.
    await seedBlob(dir, "files listing blob", 0);
    const stamp = backupStamp("2026-02-03T03:04:05.678Z");
    assert(stamp.ok);
    const backup = await createBackup(path, {
      root: dir,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2026-02-03T03:04:06.000Z",
    });
    assert(backup.ok, backup.ok ? "" : backup.error.message);
    assertEquals(backup.value.complete, true);
    assertEquals(
      backup.value.blobs.map((blob) => blob.size_bytes),
      [new TextEncoder().encode("files listing blob").length],
    );
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R9: root 경로에 quote가 있어도 snapshot을 만든다",
  async () => {
    // temp dir 이름에 곧은 quote를 넣는다. 사람이 준 home이 이런 값을 가질 수 있으므로
    // path를 SQL literal에 직접 넣지 않는다.
    const base = await tempDir();
    const dir = `${base}/quo'te-root`;
    await Deno.mkdir(dir, { recursive: true });
    try {
      const { path, version } = await ledger(dir);
      const stamp = backupStamp("2026-02-03T03:04:05.678Z");
      assert(stamp.ok);
      const backup = await createBackup(path, {
        root: dir,
        schemaVersion: version,
        stamp: stamp.value,
        now: () => "2026-02-03T03:04:06.000Z",
      });
      assert(backup.ok);
      // 경로에 quote가 있어도 snapshot이 실제로 남는다.
      const copy = new DatabaseSync(
        `${dir}/backups/${stamp.value}/ledger.db`,
        { readOnly: true },
      );
      const rows = copy.prepare(
        "select count(*) as n from sqlite_master",
      ).get() as { n: number };
      copy.close();
      assert(rows.n > 0);
      await Deno.remove(base, { recursive: true });
    } catch (error) {
      await Deno.remove(base, { recursive: true }).catch(() => {});
      throw error;
    }
  },
);

Deno.test(
  "platform/backup-and-migration#R9: 권한을 제한한 I/O worker 모양의 프로세스에서도 snapshot을 만든다",
  async () => {
    const dir = await tempDir();
    const { version } = await ledger(dir);
    await seedBlob(dir, "blob body");
    const repo = new URL("../../../../", import.meta.url).pathname;
    const script = new URL("./testdata/restricted-backup.ts", import.meta.url)
      .pathname;
    // 데이터 root 밖은 코드와 deno 캐시만 읽고 쓰기는 데이터 root뿐이다(platformIoSpec과 같다).
    const home = Deno.env.get("HOME");
    const outcome = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${dir},${repo}${home ? `,${home}/.cache/deno` : ""}`,
        `--allow-write=${dir}`,
        "--no-prompt",
        script,
        dir,
        String(version),
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = new TextDecoder().decode(outcome.stdout) +
      new TextDecoder().decode(outcome.stderr);
    assert(outcome.success, out);
    const listed = await listBackups(dir);
    assertEquals(listed.backups.length, 1);
    assertEquals(listed.backups[0].complete, true);
    await Deno.remove(dir, { recursive: true });
  },
);
