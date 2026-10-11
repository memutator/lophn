import type { Sql } from "../../contracts/platform/mod.ts";

// 사람이 요청한 session delete가 지운 session의 기록을 지울 때만 delete trigger를 통과시킨다
// (lophn-agent/conversation#R20). 표 이름을 연 채 transaction이 끝나지 않게 finally에서 닫는다.
// 정리·만료는 이 창을 열지 않는다. 창은 command transaction 안의 일이라 rollback하면 함께 사라진다.
export function withEraseWindow<T>(
  sql: Sql,
  tables: readonly string[],
  erase: () => T,
): T {
  for (const table of tables) {
    sql.run("insert or ignore into erase_windows (table_name) values (?)", [
      table,
    ]);
  }
  try {
    return erase();
  } finally {
    for (const table of tables) {
      sql.run("delete from erase_windows where table_name = ?", [table]);
    }
  }
}
