import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// 완료 검사. FK 위반이 없고 무결성이 통과한다.
export function verifyMigrated(sql: Sql): Result<void> {
  let violations: number;
  try {
    violations = sql.all("select * from pragma_foreign_key_check", []).length;
  } catch {
    return err({
      code: "unavailable",
      message: "foreign key 검사를 읽지 못해 migration을 거절한다",
    });
  }
  if (violations > 0) {
    return err({
      code: "unavailable",
      message: "foreign key 위반이 남아 migration을 거절한다",
    });
  }
  let integrity: string[];
  try {
    integrity = sql
      .all("select * from pragma_integrity_check", [])
      .map((row) => String(row["integrity_check"]));
  } catch {
    return err({
      code: "unavailable",
      message: "무결성 검사를 읽지 못해 migration을 거절한다",
    });
  }
  if (integrity.length !== 1 || integrity[0] !== "ok") {
    return err({
      code: "unavailable",
      message: "무결성 검사가 실패해 migration을 거절한다",
    });
  }
  return ok(undefined);
}
