import type { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

// session이 속한 앱. 끝난 session도 앱은 그대로 답한다(token은 이미 회수됐다).
export function codingSessionLookup(
  sql: Pick<Sql, "get">,
): CodingSessionLookup {
  return {
    appOf(session) {
      const row = sql.get("SELECT app FROM coding_sessions WHERE session = ?", [
        session,
      ]);
      return row === undefined ? null : String(row.app);
    },
  };
}
