import { ok } from "../../../base/mod.ts";
import { appPhoneTarget } from "../../../protocol/apps/phone.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";

// 앱 module이 remote module의 `devices` 표를 읽는다. agent가 기기 key를 보지 못하게 필요한 칸만 고른 좁은 읽기를 앱 쪽에 둔다.
export const phoneTargetRead: ReadDefinition<typeof appPhoneTarget> = {
  route: appPhoneTarget,
  handle(snapshot) {
    const row = snapshot.sql.get(
      "select name, os, width, height, dpr from devices where is_primary = 1",
      [],
    );
    return ok({
      device:
        row === undefined
          ? null
          : {
              name: row.name as string,
              os: row.os as "ios" | "android",
              width: Number(row.width),
              height: Number(row.height),
              dpr: Number(row.dpr),
            },
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
