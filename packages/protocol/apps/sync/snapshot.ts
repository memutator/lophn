import type { SyncDb } from "./db.ts";
import { SYNC_TABLES_SQL, setState } from "./tables.ts";

/**
 * 다른 replica(컴퓨터)의 snapshot file을 내 사본으로 받는다. 부르는 쪽 transaction 안에서 돈다.
 * node·cursor·release를 내 것으로 바꾸고 outbox를 비운다. clock 표와 마지막 HLC는 둔다: 사본의 data가 그
 * clock으로 이긴 값이고, 내 다음 clock이 snapshot이 본 어떤 clock보다 커야 한다.
 * release가 바뀔 때는 이것 다음에 `reexpress`로 안 보낸 변경을 다시 쓴다.
 */
export function adoptSnapshot(
  db: SyncDb,
  replica: { node: string; cursor: string; release: string },
): void {
  db.exec(SYNC_TABLES_SQL);
  setState(db, "node", replica.node);
  setState(db, "cursor", replica.cursor);
  setState(db, "release", replica.release);
  db.run("delete from lophn_sync_outbox");
}
