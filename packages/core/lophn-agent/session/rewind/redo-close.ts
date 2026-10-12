import { ok, type Result } from "../../../../base/mod.ts";
import { revertClosed } from "../../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";

// 다음 사람 메시지를 접수하면 같은 session의 `redo=available`인 Revert가 확정된다(conversation#R25,
// lophn-agent/revert R16). ReceiveMessage가 메시지를 쓰는 같은 transaction에서 부르므로 거절된 접수는 닫지
// 않는다. 이미 쓴(done) redo와 처음부터 redo가 없던 Revert는 그대로다. 닫힌 redo의 복원 직전 내용은
// 저장소 쓸기(sweep.ts)가 지운다.
export function closeAvailableRedo(tx: Tx, session: string): Result<void> {
  const open = tx.sql.all(
    "select id from reverts where session = ? and redo = 'available' order by rowid",
    [session],
  );
  for (const row of open) {
    const id = String(row["id"]);
    tx.sql.run("update reverts set redo = 'closed' where id = ?", [id]);
    tx.emit(revertClosed, id, { session, closed_at: tx.now() });
  }
  return ok(undefined);
}
