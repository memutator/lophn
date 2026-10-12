// 앱 데이터 배타(apps/data 정책 "배타"). 한 앱 데이터 영역에서 job은 한 번에 하나다.
// lock은 데이터 영역 안의 디렉터리고, 잡은 시각을 남긴다. job 자식이 죽으면
// 그 시각이 한도를 넘긴 뒤에야 다음 job이 회수한다. pid 확인은 signal 권한이
// 필요해서 migration 자식 flag 밖이다.

import { err, ok, type Result } from "../../../../base/mod.ts";

export const DATA_LOCK_NAME = "data.lock";
const OWNER_FILE = "owner";

// 정상 job은 이보다 훨씬 짧다. 한도를 넘긴 owner는 죽은 자식이 남긴 것으로 본다.
export const DATA_LOCK_STALE_MS = 10 * 60 * 1000;

export type DataLock = {
  release(): Promise<void>;
};

type LockOwner = {
  at: string;
};

async function readOwner(path: string): Promise<LockOwner | null> {
  try {
    const text = await Deno.readTextFile(`${path}/${OWNER_FILE}`);
    const parsed = JSON.parse(text) as Partial<LockOwner>;
    if (typeof parsed.at !== "string") return null;
    return { at: parsed.at };
  } catch {
    return null;
  }
}

function stale(owner: LockOwner | null, now: number): boolean {
  if (owner === null) return true;
  const at = Date.parse(owner.at);
  if (Number.isNaN(at)) return true;
  return now - at >= DATA_LOCK_STALE_MS;
}

export async function acquireDataLock(
  dataArea: string,
  now: number = Date.now(),
): Promise<Result<DataLock>> {
  const path = `${dataArea}/${DATA_LOCK_NAME}`;
  try {
    await Deno.mkdir(path);
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.AlreadyExists)) {
      return err({ code: "unavailable", message: "data lock is unavailable" });
    }
    if (!stale(await readOwner(path), now)) {
      return err({
        code: "conflict",
        message: "another data job holds this app data",
      });
    }
    // 한도를 넘긴 lock이다. 죽은 자식이 남긴 것으로 보고 회수한다.
    await Deno.remove(path, { recursive: true }).catch(() => {});
    try {
      await Deno.mkdir(path);
    } catch {
      return err({
        code: "conflict",
        message: "another data job holds this app data",
      });
    }
  }
  try {
    const owner: LockOwner = { at: new Date(now).toISOString() };
    await Deno.writeTextFile(`${path}/${OWNER_FILE}`, JSON.stringify(owner));
  } catch {
    await Deno.remove(path, { recursive: true }).catch(() => {});
    return err({ code: "unavailable", message: "data lock is unavailable" });
  }
  let released = false;
  return ok({
    async release() {
      if (released) return;
      released = true;
      await Deno.remove(path, { recursive: true });
    },
  });
}
