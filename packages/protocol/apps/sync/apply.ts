import { err, ok, type Result } from "../../../base/result.ts";
import {
  type ChangesetCell,
  type ChangesetChange,
  type ChangesetValue,
  encodePk,
  readChangeset,
} from "./changeset.ts";
import type { Clock } from "./clock.ts";
import type { SqlParam, SyncDb } from "./db.ts";
import { stampOutbox } from "./local.ts";
import {
  hiddenTable,
  ident,
  keyWhere,
  sqlValue,
  type TableShape,
  tableShape,
} from "./sql.ts";
import {
  columnClock,
  dropColumnClocks,
  rowClock,
  setColumnClock,
  setRowClock,
} from "./tables.ts";

export type IncomingChange = { hlc: bigint; changeset: Uint8Array };

export type ApplyStats = {
  // 무엇이든 바꾼(data나 clock) row change 수와 규칙에 져서 버린 수.
  applied: number;
  skipped: number;
};

// 엄격히 크다: 같은 변경을 두 번 적용해도 그대로다.
const newer = (hlc: bigint, than: bigint | null): boolean =>
  than === null || hlc > than;

/**
 * row change 하나를 column 단위 last-write-wins로 적용한다. change의 칸 순서는 shape의 칸 순서다.
 * - UPDATE: 칸마다 들어온 clock이 그 칸 clock(없으면 row clock)보다 클 때만 쓴다. row가 없으면 버린다(delete가 이긴다).
 * - DELETE: row clock보다 새로울 때만. row clock을 그 값으로, deleted로 두고 칸 clock을 지운다.
 * - 없는 row의 INSERT: row clock(묘비)보다 새로울 때만.
 * - 있는 row의 INSERT: 모든 칸의 UPDATE이고, row clock보다 새로우면 row clock을 올린다.
 * 그래서 row clock은 받은 insert·delete 중 가장 큰 clock이고, 칸 clock은 그보다 큰 것만 남는다.
 */
export function applyChange(
  db: SyncDb,
  shape: TableShape,
  change: ChangesetChange,
  hlc: bigint,
): boolean {
  const table = shape.table;
  const record = change.op === "insert" ? change.new! : change.old!;
  const pk = encodePk(record, shape.primaryKey);
  const whereParams: SqlParam[] = [];
  const where = keyWhere(shape, record, whereParams);
  const exists =
    db.all(`select 1 as x from ${ident(table)} where ${where}`, whereParams)
      .length > 0;
  const row = rowClock(db, table, pk)?.hlc ?? null;

  const updateColumns = (values: readonly ChangesetCell[]): boolean => {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    values.forEach((value, i) => {
      if (value === undefined || shape.primaryKey[i]) return;
      if (!newer(hlc, columnClock(db, table, pk, i) ?? row)) return;
      sets.push(`${ident(shape.columns[i]!)} = ${sqlValue(value, params)}`);
      setColumnClock(db, table, pk, i, hlc);
    });
    if (sets.length === 0) return false;
    db.run(`update ${ident(table)} set ${sets.join(", ")} where ${where}`, [
      ...params,
      ...whereParams,
    ]);
    return true;
  };

  if (change.op === "delete") {
    if (!newer(hlc, row)) return false;
    if (exists)
      db.run(`delete from ${ident(table)} where ${where}`, whereParams);
    dropColumnClocks(db, table, pk);
    setRowClock(db, table, pk, hlc, true);
    return true;
  }
  if (change.op === "update") {
    return exists && updateColumns(change.new!);
  }
  if (!exists) {
    if (!newer(hlc, row)) return false;
    const params: SqlParam[] = [];
    const values = change.new!.map((value) =>
      sqlValue(value as ChangesetValue, params),
    );
    db.run(
      `insert into ${ident(table)} (${shape.columns.map(ident).join(", ")}) values (${values.join(", ")})`,
      params,
    );
    dropColumnClocks(db, table, pk);
    setRowClock(db, table, pk, hlc, false);
    return true;
  }
  const wrote = updateColumns(change.new!);
  if (!newer(hlc, row)) return wrote;
  setRowClock(db, table, pk, hlc, false);
  dropColumnClocks(db, table, pk, hlc);
  return true;
}

function sameShape(shape: TableShape, change: ChangesetChange): boolean {
  return (
    shape.primaryKey.length === change.primaryKey.length &&
    shape.primaryKey.every((pk, i) => pk === change.primaryKey[i])
  );
}

/**
 * 들어온 변경을 순서대로 규칙에 맞춰 만든 SQL로 적용한다(`applyChangeset`을 쓰지 않는다).
 *
 * 부르는 쪽이 transaction을 연다. 그 transaction을 열기 전에 `pragma foreign_keys = off`로 두고 끝난 뒤 되돌린다
 * (SQLite는 transaction 안에서 foreign_keys를 바꾸지 못하고, cascade가 clock 없는 변경을 만들면 사본이 갈린다).
 * 컴퓨터 runtime은 같은 transaction 안에서 session으로 effective changeset을 뜬다.
 * 폰은 이것 대신 `applyIncoming`을 부른다(찍기가 먼저다).
 *
 * 오류면 이미 적용한 것이 있으니 부르는 쪽이 rollback한다: changeset이 깨졌으면 invalid_input, 표나 칸이 이 DB와
 * 맞지 않으면(다른 release의 변경) conflict. SQL 오류는 던진다.
 */
export function applyRemote(
  db: SyncDb,
  changes: readonly IncomingChange[],
  clock: Clock,
): Result<ApplyStats> {
  const fk = db.all("pragma foreign_keys")[0];
  if (fk !== undefined && Number(fk["foreign_keys"]) !== 0) {
    throw new Error("turn foreign_keys off before applying remote changes");
  }
  const stats: ApplyStats = { applied: 0, skipped: 0 };
  const shapes = new Map<string, TableShape | null>();
  for (const incoming of changes) {
    clock.observe(incoming.hlc);
    const read = readChangeset(incoming.changeset);
    if (!read.ok) return read;
    for (const change of read.value) {
      if (hiddenTable(change.table)) continue;
      if (!shapes.has(change.table)) {
        shapes.set(change.table, tableShape(db, change.table));
      }
      const shape = shapes.get(change.table)!;
      if (shape === null || !sameShape(shape, change)) {
        return err({
          code: "conflict",
          message: `change does not match this database: ${change.table}`,
          details: { table: change.table },
        });
      }
      if (applyChange(db, shape, change, incoming.hlc)) stats.applied++;
      else stats.skipped++;
    }
  }
  return ok(stats);
}

/**
 * 폰 host가 pull한 묶음을 적용하는 길: 같은 transaction에서 outbox 찍기를 먼저 하고 그다음 적용한다.
 * 순서를 부르는 쪽에 맡기지 않으려고 둘을 묶었다(`stampOutbox`의 주석). transaction과 foreign_keys는 applyRemote와 같다.
 */
export function applyIncoming(
  db: SyncDb,
  changes: readonly IncomingChange[],
  clock: Clock,
  nowMs: number,
): Result<ApplyStats & { stamped: number }> {
  const stamped = stampOutbox(db, clock, nowMs);
  if (!stamped.ok) return stamped;
  const applied = applyRemote(db, changes, clock);
  if (!applied.ok) return applied;
  return ok({ ...applied.value, stamped: stamped.value });
}
