import { err, ok } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { ProblemCounts } from "../ports.ts";

// 앱이 받는 열린 문제 수다. 구현은 core 조립이 apps에 끼운다.
export function problemCounts(sql: Pick<Sql, "get">): ProblemCounts {
  return {
    open(app) {
      try {
        const row = sql.get(
          "select count(*) as total from problems where app = ? and state = 'open'",
          [app],
        );
        return ok(Number(row?.["total"] ?? 0));
      } catch {
        return err({
          code: "unavailable",
          message: "열린 문제 수를 읽지 못했다",
        });
      }
    },
  };
}
