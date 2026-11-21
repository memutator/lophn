import { err, ok, type Result } from "../../../base/result.ts";
import { encodePk, readChangeset } from "./changeset.ts";
import type { Clock } from "./clock.ts";
import type { SyncDb } from "./db.ts";
import { hiddenTable, hlcLiteral } from "./sql.ts";
import {
  dropColumnClocks,
  dropKept,
  ensureKeptTable,
  readOutbox,
  setColumnClock,
  setRowClock,
} from "./tables.ts";

/**
 * 이 replica가 한 변경의 clock을 쓴다. 부르는 쪽이 그 write와 같은 transaction에서 부른다(컴퓨터 runtime).
 * hlc는 이 replica의 Clock이 낸 값이라 이미 본 어떤 clock보다 커서 비교 없이 쓴다. `clocked`가 있으면 그 표만 찍는다
 * (다른 기계로 보내지 않는 표의 clock은 아무도 읽지 않는다). 없으면 모든 표다(폰).
 */
export function stampLocal(
  db: SyncDb,
  changeset: Uint8Array,
  hlc: bigint,
  clocked?: (table: string) => boolean,
): Result<void> {
  const changes = readChangeset(changeset);
  if (!changes.ok) return changes;
  for (const change of changes.value) {
    if (hiddenTable(change.table)) continue;
    if (clocked !== undefined && !clocked(change.table)) continue;
    const record = change.op === "insert" ? change.new! : change.old!;
    const pk = encodePk(record, change.primaryKey);
    if (change.op === "update") {
      change.new!.forEach((value, i) => {
        if (value !== undefined && !change.primaryKey[i]) {
          setColumnClock(db, change.table, pk, i, hlc);
        }
      });
    } else {
      // insert와 delete는 row의 존재 clock을 바꾸고 칸 clock과 kept를 지운다(이 clock이 이 replica가 본 어떤
      // clock보다 커서 그 row의 칸 clock은 이제 row clock이다).
      dropColumnClocks(db, change.table, pk);
      dropKept(db, change.table, pk);
      setRowClock(db, change.table, pk, hlc, change.op === "delete");
    }
  }
  return ok(undefined);
}

/**
 * outbox에서 clock이 없는 줄을 commit된 순서로 찍는다(폰 host).
 *
 * 들어온 변경을 적용하는 transaction의 맨 앞에서 불러야 한다(`applyIncoming`이 그렇게 한다). guest의 write는
 * outbox 줄과 같이 commit되고 clock은 나중에 찍힌다. 찍기 전에 원격 변경을 적용하면 그 변경이 옛 칸 clock과
 * 비교되어 local 값을 덮고, 뒤에 찍은 local clock이 그 칸을 local이 이긴 것으로 적어 사본이 갈린다.
 * push 앞에서도 부른다.
 */
export function stampOutbox(
  db: SyncDb,
  clock: Clock,
  nowMs: number,
): Result<number> {
  ensureKeptTable(db);
  let stamped = 0;
  for (const row of readOutbox(db)) {
    if (row.hlc !== null) continue;
    const hlc = clock.next(nowMs);
    const done = stampLocal(db, row.changeset, hlc);
    if (!done.ok) {
      return err({
        ...done.error,
        message: `outbox ${row.id}: ${done.error.message}`,
      });
    }
    db.run(
      `update lophn_sync_outbox set hlc = ${hlcLiteral(hlc)} where id = ?`,
      [row.id],
    );
    stamped++;
  }
  return ok(stamped);
}
