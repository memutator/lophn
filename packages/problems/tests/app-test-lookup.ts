import { err, ok, type Result } from "../../base/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import type { AppTestVerificationFact } from "../../contracts/problems/mod.ts";

// release 준비가 같은 transaction에서 Verification의 사실만 읽는 조회다(apps/releases#R5).
// 쓰기는 test runner의 RecordVerification뿐이다. 표가 없으면 unavailable이다.
export function findAppTestVerification(
  sql: Pick<Sql, "get">,
  verification: string,
): Result<AppTestVerificationFact | null> {
  let row;
  try {
    row = sql.get(
      `select id, app, kind, result, target_bundle_hash
         from verifications where id = ?`,
      [verification],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "verification records are unavailable",
    });
  }
  if (row === undefined) return ok(null);
  return ok({
    id: String(row.id),
    app: String(row.app),
    kind: String(row.kind) as AppTestVerificationFact["kind"],
    result: String(row.result) as AppTestVerificationFact["result"],
    bundle_hash: String(row.target_bundle_hash),
  });
}
