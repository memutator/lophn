import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// 완료 검사. FK 위반이 없고 무결성이 통과하며 불변 보호 trigger가 남아 있다.
// 표는 어떤 schema가 있는지 migration이 모르므로 검사에 넣는다. step이 부른 표의
// trigger는 사람이 migration 밖에서 해제했는지 sqlite_master로 본다.
export type MigrationVerification = {
  // 불변 보호를 검사할 표와 trigger kind. step이 만든 표를 외부에서 넣는다.
  guarded: readonly {
    table: string;
    kinds: readonly ("no_update" | "no_delete" | "no_duplicate_insert")[];
  }[];
};

const DEFAULT_KINDS = ["no_update", "no_delete"] as const;

// 완료 검사. FK 위반이 없고 무결성이 통과하며 불변 보호 trigger가 남아 있다.
export function verifyMigrated(
  sql: Sql,
  verification: MigrationVerification,
): Result<void> {
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
    integrity = sql.all("select * from pragma_integrity_check", []).map(
      (row) => String(row["integrity_check"]),
    );
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
  let triggers: string[];
  try {
    triggers = sql.all(
      "select name from sqlite_master where type = 'trigger'",
      [],
    ).map((row) => String(row["name"]));
  } catch {
    return err({
      code: "unavailable",
      message: "trigger 목록을 읽지 못해 migration을 거절한다",
    });
  }
  for (const guard of verification.guarded) {
    for (const kind of guard.kinds.length > 0 ? guard.kinds : DEFAULT_KINDS) {
      if (!triggers.includes(`${guard.table}_${kind}`)) {
        return err({
          code: "unavailable",
          message: `${guard.table}의 불변 보호가 없어 migration을 거절한다`,
        });
      }
    }
  }
  return ok(undefined);
}

// 위반 내용을 검사에 그대로 내보내지 않는다. 다만 검사 실패 자체는 본다.
