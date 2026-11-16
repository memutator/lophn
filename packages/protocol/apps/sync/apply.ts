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
import { type ShapedChange, touchesClearedRow } from "./horizon.ts";
import { stampOutbox } from "./local.ts";
import {
  hiddenTable,
  ident,
  keyWhere,
  readRow,
  sqlValue,
  type TableShape,
  tableShape,
} from "./sql.ts";
import {
  columnClock,
  dropColumnClocks,
  dropKept,
  ensureKeptTable,
  keptColumns,
  laterColumnClocks,
  rowClock,
  setColumnClock,
  setKept,
  setRowClock,
} from "./tables.ts";

export type IncomingChange = { hlc: bigint; changeset: Uint8Array };

export type ApplyStats = {
  // 무엇이든 바꾼(data나 clock) row change 수와 규칙에 져서 버린 수.
  applied: number;
  skipped: number;
  // 정리된 흔적과 부딪을 수 있어 적용하지 않은 변경의 입력 안 순번. 버린 것이 아니다: 부르는 쪽이 held로 남긴다.
  held: number[];
};

// 엄격히 크다: 같은 변경을 두 번 적용해도 그대로다.
const newer = (hlc: bigint, than: bigint | null): boolean =>
  than === null || hlc > than;

/**
 * row change 하나를 칸 단위 last-write-wins로 적용한다. change의 칸 순서는 shape의 칸 순서다.
 * 쓰기는 자기 clock으로만 줄을 서고, delete는 자기보다 옛 것만 지운다. row가 있는지는 마지막 insert와 마지막
 * delete(row clock)만으로 정해지고, 칸 값은 칸마다 가장 새 clock의 것이다. 그래서 받는 순서와 상관없이 같다.
 * - UPDATE: 칸마다 들어온 clock이 그 칸 clock(없으면 row clock)보다 클 때만 쓴다. row가 없으면 그 값을 kept로
 *   둔다(같은 비교. row가 돌아오면 쓰인다).
 * - DELETE: row clock보다 새로울 때만. row clock을 그 값으로, deleted로 둔다. 그보다 새 칸 clock은 지우지 않고 그
 *   칸의 값과 같이 kept로 옮기고, 그 이하의 칸 clock과 kept는 지운다.
 * - 없는 row의 INSERT: row clock(묘비)보다 새로울 때만. 그보다 새 kept 칸은 kept의 값과 clock을 갖는다.
 * - 있는 row의 INSERT: 모든 칸의 UPDATE이고, row clock보다 새로우면 row clock을 올린다.
 * 그래서 row clock은 받은 insert·delete 중 가장 큰 clock이고, 칸 clock과 kept는 그보다 큰 것만 남는다.
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

  const keepColumns = (values: readonly ChangesetCell[]): boolean => {
    const kept = new Map(keptColumns(db, table, pk).map((k) => [k.col, k.hlc]));
    let wrote = false;
    values.forEach((value, i) => {
      if (value === undefined || shape.primaryKey[i]) return;
      const column = shape.columns[i]!;
      if (!newer(hlc, kept.get(column) ?? row)) return;
      setKept(db, table, pk, column, hlc, value);
      wrote = true;
    });
    return wrote;
  };

  if (change.op === "delete") {
    if (!newer(hlc, row)) return false;
    if (exists) {
      const later = laterColumnClocks(db, table, pk, hlc);
      if (later.length > 0) {
        const current = readRow(db, shape, record)!;
        for (const { col, hlc: at } of later) {
          setKept(db, table, pk, shape.columns[col]!, at, current[col]!);
        }
      }
      db.run(`delete from ${ident(table)} where ${where}`, whereParams);
    }
    dropColumnClocks(db, table, pk);
    dropKept(db, table, pk, hlc);
    setRowClock(db, table, pk, hlc, true);
    return true;
  }
  if (change.op === "update") {
    return exists ? updateColumns(change.new!) : keepColumns(change.new!);
  }
  if (!exists) {
    if (!newer(hlc, row)) return false;
    const values = [...change.new!] as ChangesetValue[];
    const survivors: { col: number; hlc: bigint }[] = [];
    for (const kept of keptColumns(db, table, pk)) {
      const col = shape.columns.indexOf(kept.col);
      if (col < 0 || shape.primaryKey[col] || kept.hlc <= hlc) continue;
      values[col] = kept.value;
      survivors.push({ col, hlc: kept.hlc });
    }
    const params: SqlParam[] = [];
    const literals = values.map((value) => sqlValue(value, params));
    db.run(
      `insert into ${ident(table)} (${shape.columns.map(ident).join(", ")}) values (${literals.join(", ")})`,
      params,
    );
    dropColumnClocks(db, table, pk);
    dropKept(db, table, pk);
    for (const survivor of survivors) {
      setColumnClock(db, table, pk, survivor.col, survivor.hlc);
    }
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

// 변경 하나의 row change를 표 모양과 짝짓는다. 표나 칸이 이 DB와 맞지 않으면(다른 release의 변경) conflict.
function shapeChanges(
  db: SyncDb,
  changeset: Uint8Array,
  shapes: Map<string, TableShape | null>,
): Result<ShapedChange[]> {
  const read = readChangeset(changeset);
  if (!read.ok) return read;
  const out: ShapedChange[] = [];
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
    out.push({ shape, change });
  }
  return ok(out);
}

export function requireForeignKeysOff(db: SyncDb): void {
  const fk = db.all("pragma foreign_keys")[0];
  if (fk !== undefined && Number(fk["foreign_keys"]) !== 0) {
    throw new Error("turn foreign_keys off before applying remote changes");
  }
}

/**
 * 그대로 적용하면 정리된 흔적과 부딪을 수 있는 변경인가: row change 가운데 하나라도 clock이 horizon 이하이고 그
 * row에 행도 clock 줄도 없다(지워진 row가 되살아나거나 흔적 없이 지워질 수 있다). `applyRemote`는 이런 변경을
 * 적용하지 않고 held로 돌려준다. horizon이 없으면(폰) 늘 false다. 깨졌거나 이 DB와 맞지 않는 변경도 false다
 * (`applyRemote`가 오류로 알린다).
 */
export function unsafePastHorizon(db: SyncDb, change: IncomingChange): boolean {
  const shaped = shapeChanges(db, change.changeset, new Map());
  return shaped.ok && touchesClearedRow(db, shaped.value, change.hlc);
}

/**
 * 들어온 변경을 순서대로 규칙에 맞춰 만든 SQL로 적용한다(`applyChangeset`을 쓰지 않는다).
 *
 * 부르는 쪽이 transaction을 연다. 그 transaction을 열기 전에 `pragma foreign_keys = off`로 두고 끝난 뒤 되돌린다
 * (SQLite는 transaction 안에서 foreign_keys를 바꾸지 못하고, cascade가 clock 없는 변경을 만들면 사본이 갈린다).
 * 컴퓨터 runtime은 같은 transaction 안에서 session으로 effective changeset을 뜬다.
 * 폰은 이것 대신 `applyIncoming`을 부른다(찍기가 먼저다).
 *
 * 변경 하나는 통째로 적용되거나 통째로 held다(`unsafePastHorizon`을 먼저 보고 적용한다).
 *
 * 오류면 이미 적용한 것이 있으니 부르는 쪽이 rollback한다: changeset이 깨졌으면 invalid_input, 표나 칸이 이 DB와
 * 맞지 않으면(다른 release의 변경) conflict. SQL 오류는 던진다.
 */
export function applyRemote(
  db: SyncDb,
  changes: readonly IncomingChange[],
  clock: Clock,
): Result<ApplyStats> {
  requireForeignKeysOff(db);
  ensureKeptTable(db);
  const stats: ApplyStats = { applied: 0, skipped: 0, held: [] };
  const shapes = new Map<string, TableShape | null>();
  for (let index = 0; index < changes.length; index++) {
    const incoming = changes[index]!;
    clock.observe(incoming.hlc);
    const shaped = shapeChanges(db, incoming.changeset, shapes);
    if (!shaped.ok) return shaped;
    if (touchesClearedRow(db, shaped.value, incoming.hlc)) {
      stats.held.push(index);
      continue;
    }
    for (const { shape, change } of shaped.value) {
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
