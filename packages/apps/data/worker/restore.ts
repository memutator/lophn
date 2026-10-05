// backup 복원(apps/data#R7, R11). 실패하면 원본을 그대로 둔다.
// 복원은 임시 파일에 검증한 뒤 원본과 원자적으로 교체하고, 교체가 실패하면
// 원본을 되돌린다.

import { err, ok, type Result } from "../../../base/mod.ts";
import { type VerifiedDatabase, verifyDatabase } from "./integrity.ts";
import { contained } from "./paths.ts";

const RESTORE_TMP = "restore.tmp";
const RESTORE_PREVIOUS = "restore.previous";

export type RestoredDatabase = {
  verified: VerifiedDatabase;
};

async function removeSidecars(databasePath: string): Promise<void> {
  // 교체 뒤 옛 WAL이 새 DB에 붙으면 복원이 깨진다.
  for (const suffix of ["-wal", "-shm"]) {
    await Deno.remove(`${databasePath}${suffix}`).catch(() => {});
  }
}

// backup을 운영 DB 자리로 복원한다. backup 무결성·schema 확인 전에 원본을
// 건드리지 않는다. 교체 중 실패하면 직전 원본으로 되돌린다.
export async function restoreAppBackup(
  dataArea: string,
  databasePath: string,
  backupPath: string,
): Promise<Result<RestoredDatabase>> {
  if (
    !contained(dataArea, databasePath) || !contained(dataArea, backupPath)
  ) {
    return err({ code: "invalid_input", message: "path leaves the data area" });
  }
  const verified = await verifyDatabase(backupPath);
  if (!verified.ok) return verified;
  const tmp = `${dataArea}/${RESTORE_TMP}`;
  const previous = `${dataArea}/${RESTORE_PREVIOUS}`;
  await Deno.remove(tmp).catch(() => {});
  await Deno.copyFile(backupPath, tmp);
  const staged = await verifyDatabase(tmp);
  if (!staged.ok) {
    await Deno.remove(tmp).catch(() => {});
    return staged;
  }
  let moved = false;
  try {
    await Deno.rename(databasePath, previous);
    moved = true;
    await removeSidecars(databasePath);
    await Deno.rename(tmp, databasePath);
  } catch (thrown) {
    if (moved) {
      await Deno.rename(previous, databasePath).catch(() => {});
    }
    await Deno.remove(tmp).catch(() => {});
    return err({
      code: "unavailable",
      message: thrown instanceof Error
        ? "restore replace failed"
        : "restore replace failed",
    });
  }
  const restored = await verifyDatabase(databasePath);
  if (!restored.ok) {
    // 교체 뒤 확인이 실패하면 직전 원본으로 되돌린다. 원본이 사라지지 않는다.
    await Deno.rename(databasePath, tmp).catch(() => {});
    await Deno.rename(previous, databasePath).catch(() => {});
    await Deno.remove(tmp).catch(() => {});
    return restored;
  }
  await Deno.remove(previous).catch(() => {});
  return ok({ verified: restored.value });
}
