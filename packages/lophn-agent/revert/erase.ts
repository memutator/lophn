import { ok, type Result } from "../../base/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";
import type { RewindStore } from "./store.ts";

// session을 delete하거나 닫을 때 그 session의 되돌리기 기록을 지운다(lophn-agent/revert R20,
// conversation#R20).

// 같은 transaction에서 네 표(revert_items·reverts·rewind_files·checkpoints)의 그 session 행을 자식부터
// 지운다. 다른 session의 행은 건드리지 않는다. 이미 복원된 문서·앱 변경은 이 기록 밖이라 남는다.
// checkpoints가 messages를 가리키므로 DeleteSession은 메시지를 지우기 전에 이것을 부른다.
export function deleteSessionReverts(tx: Tx, session: string): Result<void> {
  tx.sql.run(
    "delete from revert_items where revert in (select id from reverts where session = ?)",
    [session],
  );
  tx.sql.run(
    `delete from rewind_files
      where checkpoint in (select message from checkpoints where session = ?)`,
    [session],
  );
  tx.sql.run("delete from reverts where session = ?", [session]);
  tx.sql.run("delete from checkpoints where session = ?", [session]);
  return ok(undefined);
}

// transaction 밖의 이어 정리다. session 저장소 디렉터리를 지운다. 실패해도 던지지 않고 false를
// 돌려주며(시작 때와 주기로 다시 쓸어낸다) 없는 디렉터리는 성공(true)이다.
export function eraseSessionStore(
  store: Pick<RewindStore, "removeSession">,
  session: string,
): Promise<boolean> {
  return store.removeSession(session).then(() => true, () => false);
}
