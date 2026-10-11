import { ok, type Result } from "../../base/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";

// session을 delete할 때 그 session의 run을 되돌린(rewind) 기록을 지운다(conversation#R20). 이미
// 되돌려 복원된 문서·앱 변경은 이 기록 밖이라 그대로 남고, 지우는 것은 시도·변경 목록·원래 event와
// 보상 event를 가리키는 행뿐이다(event 자체는 ledger에 남는다). 자식 행을 먼저 지운다.
export function deleteSessionReverts(tx: Tx, session: string): Result<void> {
  const scope =
    `revert in (select v.id from reverts v join runs r on r.id = v.run
    where r.session = ?)`;
  for (
    const table of [
      "revert_change_sources",
      "revert_change_compensations",
      "revert_changes",
    ]
  ) {
    tx.sql.run(`delete from ${table} where ${scope}`, [session]);
  }
  tx.sql.run(
    "delete from reverts where run in (select id from runs where session = ?)",
    [session],
  );
  return ok(undefined);
}
