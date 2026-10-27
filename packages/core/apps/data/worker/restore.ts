// backup 복원. 실패하면 원본을 그대로 둔다.
// 복원은 임시 파일에 검증한 뒤 원본과 원자적으로 교체하고, 교체가 실패하면
// 원본을 되돌린다.

import { copyFile, rename, rm } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import { type VerifiedDatabase, verifyDatabase } from "./integrity.ts";
import { contained } from "./paths.ts";

const RESTORE_TMP = "restore.tmp";
const RESTORE_PREVIOUS = "restore.previous";

type RestoredDatabase = {
  verified: VerifiedDatabase;
};

const SIDECARS = ["-wal", "-shm"];

// 원본과 sidecar를 같이 옮긴다. 교체가 실패하면 둘 다 원래 자리로 되돌린다.
// sidecar를 먼저 지우면 rollback이 WAL에만 있던 commit을 잃는다.
async function moveAside(
  databasePath: string,
  previous: string,
): Promise<void> {
  await rename(databasePath, previous);
  for (const suffix of SIDECARS) {
    await rename(`${databasePath}${suffix}`, `${previous}${suffix}`).catch(
      (thrown: unknown) => {
        if (errorCode(thrown) === "ENOENT") return;
        throw thrown;
      },
    );
  }
}

async function moveBack(databasePath: string, previous: string): Promise<void> {
  await rename(previous, databasePath).catch(() => {});
  for (const suffix of SIDECARS) {
    await rename(`${previous}${suffix}`, `${databasePath}${suffix}`).catch(
      () => {},
    );
  }
}

// 교체가 확인된 뒤에만 치운다. 그 전에는 원본 WAL이 previous 옆에 남아 있다.
async function removeSidecars(databasePath: string): Promise<void> {
  for (const suffix of SIDECARS) {
    await rm(`${databasePath}${suffix}`).catch(() => {});
  }
}

// backup을 운영 DB 자리로 복원한다. backup 무결성·schema 확인 전에 원본을
// 건드리지 않는다. 교체 중 실패하면 직전 원본으로 되돌린다.
type RestoreHooks = {
  // 원본을 옆으로 옮긴 뒤, 새 파일을 제자리에 놓기 전에 호출한다.
  // 여기서 실패를 던지면 원본과 sidecar를 그대로 되돌린다.
  beforeReplace?: () => void;
};

export async function restoreAppBackup(
  dataArea: string,
  databasePath: string,
  backupPath: string,
  hooks: RestoreHooks = {},
): Promise<Result<RestoredDatabase>> {
  if (!contained(dataArea, databasePath) || !contained(dataArea, backupPath)) {
    return err({ code: "invalid_input", message: "path leaves the data area" });
  }
  const verified = await verifyDatabase(backupPath);
  if (!verified.ok) return verified;
  const tmp = `${dataArea}/${RESTORE_TMP}`;
  const previous = `${dataArea}/${RESTORE_PREVIOUS}`;
  await rm(tmp).catch(() => {});
  await copyFile(backupPath, tmp);
  const staged = await verifyDatabase(tmp);
  if (!staged.ok) {
    await rm(tmp).catch(() => {});
    return staged;
  }
  let moved = false;
  try {
    await moveAside(databasePath, previous);
    moved = true;
    hooks.beforeReplace?.();
    await rename(tmp, databasePath);
  } catch (thrown) {
    if (moved) await moveBack(databasePath, previous);
    await rm(tmp).catch(() => {});
    return err({
      code: "unavailable",
      message:
        thrown instanceof Error
          ? "restore replace failed"
          : "restore replace failed",
    });
  }
  const restored = await verifyDatabase(databasePath);
  if (!restored.ok) {
    // 교체 뒤 확인이 실패하면 직전 원본과 sidecar를 되돌린다.
    await rename(databasePath, tmp).catch(() => {});
    await moveBack(databasePath, previous);
    await rm(tmp).catch(() => {});
    return restored;
  }
  await rm(previous).catch(() => {});
  await removeSidecars(previous);
  return ok({ verified: restored.value });
}
