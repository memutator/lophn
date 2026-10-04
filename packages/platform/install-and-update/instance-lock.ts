import { err, ok, type Result } from "../../base/mod.ts";

// 같은 H에는 플랫폼 instance 하나만 둔다(install-and-update R10).
// tryLock은 이미 잠긴 파일을 기다리지 않고 바로 false다.
// 프로세스가 죽으면 커널이 풀어 준다. PID 파일로 판단하지 않는다.
export type InstanceLock = {
  release(): Promise<void>;
};

const LOCK_NAME = "instance.lock";

type Lockable = Deno.FsFile & {
  tryLock(exclusive?: boolean): Promise<boolean>;
};

export async function acquireInstanceLock(
  runDir: string,
): Promise<Result<InstanceLock>> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(`${runDir}/${LOCK_NAME}`, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
  } catch {
    return err({
      code: "unavailable",
      message: "instance lock 파일을 열 수 없다",
    });
  }
  let locked = false;
  try {
    locked = await (file as Lockable).tryLock(true);
  } catch {
    locked = false;
  }
  if (!locked) {
    try {
      file.close();
    } catch {
      // 잠그지 못한 파일은 그대로 둔다. 다른 instance가 쥐고 있을 수 있다.
    }
    return err({
      code: "conflict",
      message: "이 데이터 폴더에는 이미 실행 중인 instance가 있다",
    });
  }
  let released = false;
  return ok({
    async release() {
      if (released) return;
      released = true;
      try {
        file.unlock();
      } finally {
        file.close();
      }
    },
  });
}
