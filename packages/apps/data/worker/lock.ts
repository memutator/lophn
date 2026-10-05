// 앱 데이터 배타(apps/data 정책 "배타"). 한 앱 데이터 영역에서 job은 한 번에 하나다.
// lock은 데이터 영역 안의 디렉터리다. 만들기에 성공한 job만 잡고, 이미 있으면
// 기다리지 않고 conflict다. 잡은 쪽만 release한다.

import { err, ok, type Result } from "../../../base/mod.ts";

export const DATA_LOCK_NAME = "data.lock";

export type DataLock = {
  release(): Promise<void>;
};

export async function acquireDataLock(
  dataArea: string,
): Promise<Result<DataLock>> {
  const path = `${dataArea}/${DATA_LOCK_NAME}`;
  try {
    await Deno.mkdir(path);
  } catch (thrown) {
    if (thrown instanceof Deno.errors.AlreadyExists) {
      return err({
        code: "conflict",
        message: "another data job holds this app data",
      });
    }
    return err({ code: "unavailable", message: "data lock is unavailable" });
  }
  let released = false;
  return ok({
    async release() {
      if (released) return;
      released = true;
      await Deno.remove(path);
    },
  });
}
