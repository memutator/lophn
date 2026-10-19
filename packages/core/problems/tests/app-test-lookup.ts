import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { AppTestVerificationFact } from "../../../protocol/problems/mod.ts";

// release 준비가 같은 transaction에서 Verification의 사실만 읽는 조회다.
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

// 같은 앱·같은 완성 bundle hash로 실제 실행해 통과로 기록된 app test의 id다. 실패·판정 불가·다른 hash는
// 근거가 아니다. 여럿이면 id가 앞선 하나다.
export function findPassedAppTest(
  sql: Pick<Sql, "get">,
  app: string,
  bundleHash: string,
): Result<string | undefined> {
  let row;
  try {
    row = sql.get(
      `select id from verifications
        where app = ? and kind = 'app_test' and result = 'pass'
          and target_bundle_hash = ?
        order by id limit 1`,
      [app, bundleHash],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "verification records are unavailable",
    });
  }
  return ok(row === undefined ? undefined : String(row.id));
}

// findPassedAppTest와 같은 기준으로 고른 app test의 pass 이유다. 증명 못 한 write tool 이름이 거기 한 줄로 남는다.
export function findPassedAppTestReason(
  sql: Pick<Sql, "get">,
  app: string,
  bundleHash: string,
): string | undefined {
  const row = sql.get(
    `select reason from verifications
      where app = ? and kind = 'app_test' and result = 'pass'
        and target_bundle_hash = ?
      order by id limit 1`,
    [app, bundleHash],
  );
  return row === undefined ? undefined : String(row.reason);
}
