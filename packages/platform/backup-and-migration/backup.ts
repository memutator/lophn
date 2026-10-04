import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import {
  BACKUP_EXCLUSIONS,
  BACKUP_LEDGER_PATH,
  BACKUP_MANIFEST_FORMAT,
  type BackupManifest,
  backupManifestSchema,
} from "../../contracts/platform/mod.ts";
import { openConnection } from "../ledger/mod.ts";

// 하루 주기(R12: 매일 1회).
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// manifest 파일 이름. backup 폴더의 이것만 산다. 없으면 아직 만들기 중인 folder다.
export const BACKUP_MANIFEST_NAME = "manifest.json";

// 만들기가 끝나기 전 folder에 두는 표시. GC·삭제는 이것이 남아 있으면 대상에서
// 뺀다(문을 여는 것은 T44). manifest 설치와 함께 뗀다.
export const BACKUP_PENDING_NAME = "backup.pending";

// 폴더 이름 stamp. 복구본 stamp와 같은 filename-safe UTC 형식 하나다.
export const BACKUP_STAMP = /^[0-9]{8}T[0-9]{6}[0-9]{3}Z$/;

export const BACKUP_DIR_NAME = "backups";

// 최근 완료 묶음 보존 수(R12).
export const BACKUP_KEEP_COMPLETE = 7;

// clock 시각(YYYY-MM-DDTHH:mm:ss.sssZ)을 filename-safe 폴더 stamp로 바꾼다.
export function backupStamp(at: string): Result<string> {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    return err({ code: "invalid_input", message: "시각을 읽을 수 없다" });
  }
  const d = new Date(parsed);
  const pad = (n: number, width: number) => n.toString().padStart(width, "0");
  return ok(
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}${
      pad(d.getUTCDate(), 2)
    }T${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${
      pad(d.getUTCSeconds(), 2)
    }${pad(d.getUTCMilliseconds(), 3)}Z`,
  );
}

export type BackupDeps = {
  // 데이터 root. snapshot은 <root>/backups/<stamp>/ 밑에 둔다.
  root: string;
  // snapshot의 schema 판. 설치된 마지막 migration version이다.
  schemaVersion: number;
  stamp: string;
  // 완료 시각은 만들기가 끝난 시각이다. 테스트가 고정 시각을 넣는다.
  now(): string;
};

// backup blob manifest 행. hash 위치 관계는 backupBlobPath가 정한다.
export type BackupBlobCopy = { hash: string; sizeBytes: number };

// backup 폴더의 manifest를 strict하게 읽는다. 사람이 볼 상태라도 형식이 다르면
// 이 folder를 목록에서 뺀다(만들기 중·불완전 folder다).
export function readManifest(
  directory: string,
): BackupManifest | undefined {
  let text: string;
  try {
    text = Deno.readTextFileSync(`${directory}/${BACKUP_MANIFEST_NAME}`);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const checked = backupManifestSchema.safeParse(parsed);
  return checked.success ? checked.data : undefined;
}

// 밑의 폴더 중 stamp 이름만 산다. backups/migrations 같은 다른 이름은 뺀다.
function stampFolders(backupsRoot: string): string[] {
  const names: string[] = [];
  try {
    for (const entry of Deno.readDirSync(backupsRoot)) {
      if (entry.isDirectory && BACKUP_STAMP.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } catch {
    // backups/가 아직 없으면 없다고 본다.
  }
  return names.sort();
}

// /v1/backups/list. manifest이 있는 folder만 산다. 만들기 중 folder는 manifest
// 전이라 목록에 없다. 실패·미완성 manifest도 완료 것과 구별해 내놓는다(R10, R12).
export function listBackups(root: string): { backups: BackupManifest[] } {
  const backupsRoot = `${root}/${BACKUP_DIR_NAME}`;
  const found: BackupManifest[] = [];
  for (const stamp of stampFolders(backupsRoot)) {
    const manifest = readManifest(`${backupsRoot}/${stamp}`);
    if (manifest !== undefined) found.push(manifest);
  }
  found.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { backups: found };
}

// /v1/backups/get. created_at이 같은 manifest 한 개를 찾는다.
export function findBackup(
  root: string,
  createdAt: string,
): BackupManifest | undefined {
  const backupsRoot = `${root}/${BACKUP_DIR_NAME}`;
  for (const stamp of stampFolders(backupsRoot)) {
    const manifest = readManifest(`${backupsRoot}/${stamp}`);
    if (manifest?.created_at === createdAt) return manifest;
  }
  return undefined;
}

// 최근 완료 묶음 keep개를 남긴다(R12). 판정은 완료 folder뿐이다. 만들기 중·실패
// folder는 지우지 않는다: 실패 때문에 마지막 완료를 지우는 일이 없어야 한다.
export async function retainBackups(
  root: string,
  keep: number,
): Promise<Result<void>> {
  const backupsRoot = `${root}/${BACKUP_DIR_NAME}`;
  const complete: string[] = [];
  for (const stamp of stampFolders(backupsRoot)) {
    if (readManifest(`${backupsRoot}/${stamp}`)?.complete === true) {
      complete.push(stamp);
    }
  }
  if (complete.length <= keep) return ok(undefined);
  const drop = complete.slice(0, complete.length - keep);
  for (const stamp of drop) {
    try {
      await Deno.remove(`${backupsRoot}/${stamp}`, { recursive: true });
    } catch {
      return err({
        code: "unavailable",
        message: "묶음 folder를 지우지 못했다",
      });
    }
  }
  return ok(undefined);
}

// snapshot S의 blob을 <stamp>/blobs/sha256/<2>/<62>로 복사하고 실제 바이트를
// 다시 검증한다(R10). 원본 blob은 0400 파일이므로 그대로 읽어 옮긴다.
async function copyBlobs(
  root: string,
  directory: string,
  refs: readonly { hash: string; sizeBytes: number }[],
): Promise<Result<BackupBlobCopy[]>> {
  const blobs: BackupBlobCopy[] = [];
  for (const ref of refs) {
    const source = `${root}/blobs/sha256/${ref.hash.slice(0, 2)}/${
      ref.hash.slice(2)
    }`;
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(source);
    } catch {
      // blob 존재 실패다. 참조가 남아도 실제 내용이 빠진 묶음은 미완성이다(R10).
      return err({ code: "unavailable", message: "snapshot blob이 없다" });
    }
    // 실제 sha256을 다시 계산한다. 등록 hash·size와 다르면 검증 실패다(R10).
    const digest = await sha256Hex(bytes);
    if (digest !== ref.hash || bytes.length !== ref.sizeBytes) {
      return err({
        code: "unavailable",
        message: "blob 내용이 등록 hash와 다르다",
      });
    }
    const target = `${directory}/blobs/sha256/${ref.hash.slice(0, 2)}/${
      ref.hash.slice(2)
    }`;
    try {
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
        mode: 0o700,
      });
      await Deno.writeFile(target, bytes, { mode: 0o400 });
    } catch {
      return err({ code: "unavailable", message: "blob 복사에 실패했다" });
    }
    blobs.push({ hash: ref.hash, sizeBytes: bytes.length });
  }
  return ok(blobs);
}

// blob_refs와 through_seq는 snapshot S에 고정된다. 열린 원본에서 따로 읽으면
// vacuum과 시점이 어긋나므로, S를 만든 copy 안에서 읽는다(R8, R9).
function snapshotRefs(copyPath: string): Result<
  { hash: string; sizeBytes: number }[]
> {
  try {
    const db = new DatabaseSync(copyPath, { readOnly: true });
    try {
      const prepared = db.prepare(
        "select hash, size_bytes from blob_refs order by hash",
      );
      // seq는 아니지만 size가 큰 수일 수 있다. platform/ledger#R9와 같은 판정.
      prepared.setReadBigInts(true);
      return ok(
        prepared.all().map((row) => ({
          hash: String(row["hash"]),
          sizeBytes: Number(row["size_bytes"]),
        })),
      );
    } finally {
      db.close();
    }
  } catch {
    return err({
      code: "unavailable",
      message: "snapshot blob 참조를 읽지 못했다",
    });
  }
}

function snapshotThroughSeq(copyPath: string): Result<string> {
  try {
    const db = new DatabaseSync(copyPath, { readOnly: true });
    try {
      const prepared = db.prepare(
        "select coalesce(max(seq), 0) as seq from events",
      );
      // seq는 JS 안전 정수를 넘는다(platform/ledger#R9).
      prepared.setReadBigInts(true);
      const head = prepared.get();
      return ok(String(head?.["seq"] ?? "0"));
    } finally {
      db.close();
    }
  } catch {
    return err({ code: "unavailable", message: "snapshot seq를 읽지 못했다" });
  }
}

// manifest는 folder의 마지막이다. 이것 전까지 folder는 만들기 중이다(R10).
async function installManifest(
  directory: string,
  manifest: BackupManifest,
): Promise<Result<void>> {
  try {
    await Deno.writeTextFile(
      `${directory}/${BACKUP_MANIFEST_NAME}`,
      JSON.stringify(manifest, null, "  ") + "\n",
    );
  } catch {
    return err({ code: "unavailable", message: "manifest를 남기지 못했다" });
  }
  // manifest가 남았다. GC·삭제 막기가 풀린다.
  try {
    await Deno.remove(`${directory}/${BACKUP_PENDING_NAME}`);
  } catch {
    // 이미 사라진 파일
  }
  return ok(undefined);
}

// 하루 backup 만들기(R8, R9). SQLite online backup(VACUUM INTO)이 일관된
// snapshot S를 만들고, S 안의 blob_refs를 읽어 blob을 복사·검증한 뒤 manifest를
// 설치한다. 중간이 실패하면 manifest 전이므로 아무것도 complete되지 않는다.
// 만들기 중 GC·삭제 막기는 backup.pending 표시로 보인다(T44가 문을 연다).
export async function createBackup(
  ledgerPath: string,
  deps: BackupDeps,
): Promise<Result<BackupManifest>> {
  if (!BACKUP_STAMP.test(deps.stamp)) {
    return err({
      code: "invalid_input",
      message: "backup stamp가 filename-safe 형식이 아니다",
    });
  }
  const directory = `${deps.root}/${BACKUP_DIR_NAME}/${deps.stamp}`;
  try {
    await Deno.stat(directory);
    return err({ code: "unavailable", message: "같은 stamp의 backup이 있다" });
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) {
      return err({ code: "unavailable", message: "자리를 확인하지 못했다" });
    }
  }
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  } catch {
    return err({ code: "unavailable", message: "folder를 만들지 못했다" });
  }
  // 만들기가 끝나기 전 GC·삭제를 막는다(R10). 검사가 통과한 뒤 manifest 설치와
  // 같이 뗀다.
  try {
    await Deno.writeTextFile(
      `${directory}/${BACKUP_PENDING_NAME}`,
      "pending\n",
    );
  } catch {
    return err({ code: "unavailable", message: "진행 표시를 남기지 못했다" });
  }
  // SQLite online backup은 열린 WAL db에서 일관된 snapshot을 만든다(R9). 원본을
  // 쓰지 않는다. 함정: transaction 안에서는 vacuum이 실패하므로 감싸지 않는다.
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  const connection = opened.value;
  let vacuumed = false;
  let failure: Result<never> | undefined;
  try {
    connection.exec(`vacuum into '${directory}/${BACKUP_LEDGER_PATH}'`);
    vacuumed = true;
  } catch {
    failure = err({
      code: "unavailable",
      message: "snapshot을 만들지 못했다",
    });
  } finally {
    connection.close();
  }
  if (failure !== undefined) return failure;
  void vacuumed;
  // blob_refs와 through_seq는 S를 만든 copy 안에서 읽는다.
  const refs = snapshotRefs(`${directory}/${BACKUP_LEDGER_PATH}`);
  if (!refs.ok) return refs;
  const throughSeq = snapshotThroughSeq(`${directory}/${BACKUP_LEDGER_PATH}`);
  if (!throughSeq.ok) return throughSeq;
  // copy의 SQLite integrity_check를 직접 본다(R10).
  let integrity = false;
  try {
    const db = new DatabaseSync(`${directory}/${BACKUP_LEDGER_PATH}`, {
      readOnly: true,
    });
    try {
      const rows = db.prepare("pragma integrity_check").all();
      integrity = rows.length === 1 && rows[0]?.["integrity_check"] === "ok";
    } finally {
      db.close();
    }
  } catch {
    integrity = false;
  }
  if (!integrity) {
    return err({
      code: "unavailable",
      message: "snapshot 무결성 검사가 실패했다",
    });
  }
  // 완성된 SQLite snapshot 바이트의 실제 hash(domain-model BackupManifest).
  let ledgerBytes: Uint8Array;
  try {
    ledgerBytes = await Deno.readFile(`${directory}/${BACKUP_LEDGER_PATH}`);
  } catch {
    return err({ code: "unavailable", message: "snapshot을 읽지 못했다" });
  }
  const ledgerHash = await sha256Hex(ledgerBytes);
  // blob을 복사하고 존재·실제 sha256을 검증한다(R10).
  const copied = await copyBlobs(deps.root, directory, refs.value);
  if (!copied.ok) return copied;
  const manifest: BackupManifest = {
    format: BACKUP_MANIFEST_FORMAT,
    schema_version: deps.schemaVersion,
    through_seq: throughSeq.value,
    created_at: deps.now(),
    ledger_hash: ledgerHash,
    ledger_path: BACKUP_LEDGER_PATH,
    blobs: copied.value.map((blob) => ({
      hash: blob.hash,
      size_bytes: blob.sizeBytes,
      path: `blobs/sha256/${blob.hash.slice(0, 2)}/${blob.hash.slice(2)}`,
    })),
    settings: "ledger",
    integrity: "passed",
    complete: true,
    excluded: [...BACKUP_EXCLUSIONS],
  };
  // manifest 설치가 끝나야 complete다. 이것 전까지 folder는 pending이다.
  const installed = await installManifest(directory, manifest);
  if (!installed.ok) return installed;
  // 최근 완료 7개를 보존한다. 실패·pending folder는 지우지 않는다(R12).
  const kept = await retainBackups(deps.root, BACKUP_KEEP_COMPLETE);
  if (!kept.ok) return kept;
  return ok(manifest);
}

// BACKUP_BLOB_PATH와 hash의 같은 위치 관계를 만들기가 지킨다(domain-model 경로).
export function backupBlobPath(hash: string): string {
  return `blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

// 하루가 지났는지 판정한다(R12: 매일 1회). 마지막 완료 manifest의 created_at에서
// 24시간이 지났으면 만들 차례다. 완료 manifest가 없으면 처음 만든다.
export function backupDue(
  root: string,
  now: string,
  everyMs: number,
): boolean {
  const latest = listBackups(root).backups.find((entry) => entry.complete);
  if (latest === undefined) return true;
  const at = Date.parse(now);
  const then = Date.parse(latest.created_at);
  // 시각을 읽을 수 없으면 만들 차례로 본다. 실패한 만들기를 건너뛰지 않는다.
  if (Number.isNaN(at) || Number.isNaN(then)) return true;
  return at - then >= everyMs;
}
