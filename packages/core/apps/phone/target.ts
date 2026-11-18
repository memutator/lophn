import { ok } from "../../../base/mod.ts";
import { appPhoneTarget } from "../../../protocol/apps/phone.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { entriesByKey, storedStatements } from "../../remote/devices.ts";

// 앱 module이 remote module의 `devices` 표를 읽는다. agent가 기기 key를 보지 못하게 필요한 칸만 고른 좁은 읽기를 앱 쪽에 둔다.
// 기준은 phone만이라 화면 칸이 있다. 이름은 명단의 이름이고(어느 컴퓨터에서 바꿔도 같다), 아직 서명한 항목이 없으면 폰이 알린 이름이다.
export const phoneTargetRead: ReadDefinition<typeof appPhoneTarget> = {
  route: appPhoneTarget,
  handle(snapshot) {
    const row = snapshot.sql.get(
      "select name, public_key, os, width, height, dpr from devices where is_primary = 1",
      [],
    );
    const key = row?.public_key as string;
    return ok({
      device:
        row === undefined
          ? null
          : {
              name:
                entriesByKey(storedStatements(snapshot.sql, key)).get(key)
                  ?.name ?? (row.name as string),
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
