// 준비 증거 기록(platform/secrets#R1, R6). I/O worker가 keychain에 값을 둔 뒤 돌려준 값 없는
// SecretPreparation을 core의 writer가 ledger에 남긴다. SetSecret이 이 행을 보고 그 참조가
// 보호 입력에서 왔음을 확인한다. 값·hash·길이·일부는 이 표에 없다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type SecretPreparation,
  secretPreparationSchema,
  type Sql,
} from "../../contracts/platform/mod.ts";

export function recordSecretPreparation(
  sql: Pick<Sql, "run">,
  value: unknown,
): Result<SecretPreparation> {
  const parsed = secretPreparationSchema.safeParse(value);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "준비 증거가 schema와 다르다",
    });
  }
  const preparation = parsed.data;
  try {
    sql.run(
      "insert into secret_preparations (preparation, sealed_ref, purpose, owner) values (?, ?, ?, ?)",
      [
        preparation.preparation,
        preparation.sealed_ref,
        preparation.purpose,
        preparation.owner,
      ],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "준비 증거를 남기지 못했다",
    });
  }
  return ok(preparation);
}
