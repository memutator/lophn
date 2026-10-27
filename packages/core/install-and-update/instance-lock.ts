import { chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";

// 같은 data root에는 플랫폼 instance 하나만 둔다.
// Node에는 flock이 없어 SQLite의 exclusive lock을 쓴다. SQLite의 잠금은 file의 POSIX
// lock이라 프로세스가 죽으면 커널이 풀어 준다. PID file로 판단하지 않는다.
export type InstanceLock = {
  release(): Promise<void>;
};

export const INSTANCE_LOCK_NAME = "instance.lock";

export async function acquireInstanceLock(
  runDir: string,
): Promise<Result<InstanceLock>> {
  const opened = await openExclusive(`${runDir}/${INSTANCE_LOCK_NAME}`);
  if (!opened.ok) return opened;
  const db = opened.value;
  let released = false;
  return ok({
    release(): Promise<void> {
      if (released) return Promise.resolve();
      released = true;
      db.close();
      return Promise.resolve();
    },
  });
}

async function openExclusive(path: string): Promise<Result<DatabaseSync>> {
  let db: DatabaseSync | undefined;
  try {
    // 예전 flock이 남긴 0바이트 file도 빈 SQLite db로 그대로 열린다. 옮길 것은 없다.
    db = new DatabaseSync(path);
    // SQLite는 umask대로 file을 만든다. 잠금 file은 소유자만 다룬다.
    await chmod(path, 0o600);
    // 잠금은 exclusive mode에서 연결이 닫힐 때까지 유지된다.
    db.exec("PRAGMA locking_mode=EXCLUSIVE");
    // 기다리지 않는다. 이미 잠긴 file은 바로 SQLITE_BUSY다.
    db.exec("PRAGMA busy_timeout=0");
    db.exec("BEGIN EXCLUSIVE");
    return ok(db);
  } catch (thrown) {
    try {
      db?.close();
    } catch {
      // 열지 못한 연결은 그대로 둔다. 다른 instance가 file을 쥐고 있을 수 있다.
    }
    // errcode는 Node에만 있다. 두 runtime이 같이 주는 message로 가른다.
    if (thrown instanceof Error && thrown.message === "database is locked") {
      return err({
        code: "conflict",
        message: "이 데이터 폴더에는 이미 실행 중인 instance가 있다",
      });
    }
    return err({
      code: "unavailable",
      message: "instance lock 파일을 열 수 없다",
    });
  }
}
