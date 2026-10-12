// core가 secret store를 열 때 읽는 ledger의 현재 참조(platform/secrets#R1). 이름과
// sealed_ref만 있고 값·hash·길이는 ledger에 없다. sealed_ref는 core가 keychain에서 값을
// 읽을 때만 쓰고 API·event·log로 나가지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { Sql } from "../../protocol/platform/mod.ts";
import type { SecretRecord } from "./model.ts";

export type SecretReference = Pick<SecretRecord, "name" | "sealedRef">;

// 이름 순서다. 표가 없거나 읽지 못하면 비어 있는 것으로 꾸미지 않고 unavailable이다.
export function readSecretRefs(
  sql: Pick<Sql, "all">,
): Result<SecretReference[]> {
  try {
    return ok(
      sql.all("select name, sealed_ref from secrets order by name", []).map(
        (row) => ({
          name: String(row["name"]),
          sealedRef: String(row["sealed_ref"]),
        }),
      ),
    );
  } catch {
    return err({
      code: "unavailable",
      message: "secret 참조를 읽지 못했다",
    });
  }
}
