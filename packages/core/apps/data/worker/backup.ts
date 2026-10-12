// migration 전 보호 backup. SQLite backup API로 WAL까지 포함한
// 일관된 복사본을 만들고 무결성·schema를 확인한 뒤에만 backup으로 남긴다.
// 본체 파일 복사는 유효 backup이 아니다. 최근 5개를 유지하되 진행 중 복원이
// 참조하는 backup은 보존 한도 때문에 없애지 않는다.

import { err, ok, type Result } from "../../../../base/mod.ts";
import { openAppDatabase } from "./db.ts";
import { type VerifiedDatabase, verifyDatabase } from "./integrity.ts";
import { contained } from "./paths.ts";

export const BACKUP_KEEP = 5;
const BACKUP_DIR = "backups";
const PENDING_SUFFIX = ".pending";

export type AppBackup = {
  // 데이터 영역 상대 경로. ledger가 가리키는 보호 참조의 로컬 자리다.
  name: string;
  verified: VerifiedDatabase;
};

export type RetainInput = {
  // 진행 중 복원이 참조하는 backup 이름. 완료 전에는 삭제하지 않는다.
  protectedNames: readonly string[];
};

function backupDir(dataArea: string): string {
  return `${dataArea}/${BACKUP_DIR}`;
}

async function listBackupNames(dataArea: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(backupDir(dataArea))) {
      if (!entry.isFile) continue;
      if (entry.name.endsWith(PENDING_SUFFIX)) continue;
      names.push(entry.name);
    }
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
  }
  return names.sort();
}

// 일관된 backup을 만든다. 확인 전에는 pending 파일이라 backup이 아니다.
// 확인이 실패하면 pending을 지우고 아무것도 backup으로 남기지 않는다.
export async function createAppBackup(
  dataArea: string,
  databasePath: string,
  name: string,
): Promise<Result<AppBackup>> {
  if (!contained(dataArea, databasePath)) {
    return err({
      code: "invalid_input",
      message: "database leaves the data area",
    });
  }
  const destination = `${backupDir(dataArea)}/${name}`;
  if (!contained(backupDir(dataArea), destination)) {
    return err({
      code: "invalid_input",
      message: "backup leaves the data area",
    });
  }
  await Deno.mkdir(backupDir(dataArea), { recursive: true });
  const pending = `${destination}${PENDING_SUFFIX}`;
  const opened = openAppDatabase(databasePath);
  if (!opened.ok) return opened;
  const db = opened.value;
  const copied = await db.backupTo(pending);
  db.close();
  if (!copied.ok) return copied;
  const verified = await verifyDatabase(pending);
  if (!verified.ok) {
    await Deno.remove(pending).catch(() => {});
    return verified;
  }
  await Deno.rename(pending, destination);
  return ok({ name, verified: verified.value });
}

// 보존 한도. 진행 중 참조는 한도 밖이어도 남긴다.
export async function retainAppBackups(
  dataArea: string,
  input: RetainInput,
): Promise<Result<readonly string[]>> {
  const names = await listBackupNames(dataArea);
  const keep = new Set<string>(input.protectedNames);
  for (const name of names.slice(-BACKUP_KEEP)) keep.add(name);
  const removed: string[] = [];
  for (const name of names) {
    if (keep.has(name)) continue;
    await Deno.remove(`${backupDir(dataArea)}/${name}`);
    removed.push(name);
  }
  const retained = names.filter((name) => keep.has(name));
  return ok(retained.filter((name) => !removed.includes(name)));
}

export async function appBackupNames(
  dataArea: string,
): Promise<readonly string[]> {
  return await listBackupNames(dataArea);
}
