import { type ChangesetChange, encodePk } from "./changeset.ts";
import type { SqlParam, SyncDb } from "./db.ts";
import { hlcLiteral, ident, keyWhere, type TableShape } from "./sql.ts";
import { getState, rowClock, setState } from "./tables.ts";

// 흔적(tombstone) 정리와 horizon. 흔적을 지우면 그보다 옛 변경이 지워진 row를 되살리거나 흔적 없이 지울 수 있다.
// 그래서 정리한 가장 큰 clock을 horizon으로 두고, 그 이하 clock으로 row도 흔적도 없는 row를 건드리는 변경은
// 적용하지 않고 부르는 쪽에 held로 돌려준다(버리지 않는다). 언제 지울지는 부르는 쪽(core)이 정한다.

export function horizonOf(db: SyncDb): bigint | null {
  const value = getState(db, "horizon");
  return value === null ? null : BigInt(value);
}

export function raiseHorizon(db: SyncDb, hlc: bigint): void {
  const now = horizonOf(db);
  if (now === null || hlc > now) setState(db, "horizon", String(hlc));
}

/**
 * clock이 `beforeHlc`보다 작은 흔적을 지우고 지운 수를 돌려준다. 지운 가장 큰 clock으로 horizon을 올린다(내려가지
 * 않는다). 부르는 쪽 transaction 안에서 돈다.
 */
export function dropTombstones(db: SyncDb, beforeHlc: bigint): number {
  const where = `deleted = 1 and hlc < ${hlcLiteral(beforeHlc)}`;
  const found = db.all(
    `select count(*) as n, cast(max(hlc) as text) as top from lophn_sync_row where ${where}`,
  )[0]!;
  const count = Number(found["n"]);
  if (count === 0) return 0;
  db.run(`delete from lophn_sync_row where ${where}`);
  raiseHorizon(db, BigInt(String(found["top"])));
  return count;
}

export type ShapedChange = { shape: TableShape; change: ChangesetChange };

// 한 변경(row change 여럿) 가운데 하나라도 horizon 이하 clock으로 row도 흔적도 없는 row를 건드리는가.
export function touchesClearedRow(
  db: SyncDb,
  changes: readonly ShapedChange[],
  hlc: bigint,
): boolean {
  const horizon = horizonOf(db);
  if (horizon === null || hlc > horizon) return false;
  return changes.some(({ shape, change }) => {
    const record = change.op === "insert" ? change.new! : change.old!;
    if (rowClock(db, shape.table, encodePk(record, shape.primaryKey))) {
      return false;
    }
    const params: SqlParam[] = [];
    const where = keyWhere(shape, record, params);
    return (
      db.all(`select 1 as x from ${ident(shape.table)} where ${where}`, params)
        .length === 0
    );
  });
}
