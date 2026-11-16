import { err, ok, type Result } from "../../../base/result.ts";
import {
  type ApplyStats,
  applyChange,
  requireForeignKeysOff,
} from "./apply.ts";
import {
  type ChangesetCell,
  type ChangesetChange,
  decodePk,
  encodePk,
  insertChangeset,
} from "./changeset.ts";
import type { Clock } from "./clock.ts";
import type { SqlParam, SyncDb } from "./db.ts";
import { horizonOf, raiseHorizon } from "./horizon.ts";
import {
  ident,
  keyWhere,
  readRow,
  readRows,
  storedValue,
  type TableShape,
  tableShape,
  userTables,
} from "./sql.ts";
import {
  dropColumnClocks,
  dropKept,
  ensureKeptTable,
  rowClock,
  setRowClock,
} from "./tables.ts";

export type AbsentDeletes = {
  // 이 clock 이하만 가진 row만 지운다(source의 horizon).
  below: bigint;
  // true면 지우지 않는다(이 기계의 held 변경이 건드리는 row). pk는 `encodePk` bytes다.
  keep: (table: string, pk: Uint8Array) => boolean;
};

const ZERO = BigInt(0);

function sameTableShape(a: TableShape, b: TableShape): boolean {
  return (
    a.columns.length === b.columns.length &&
    a.columns.every((column, i) => column === b.columns[i]) &&
    a.primaryKey.every((pk, i) => pk === b.primaryKey[i])
  );
}

function columnClocks(
  db: SyncDb,
  table: string,
  pk: Uint8Array,
): { col: number; hlc: bigint }[] {
  return db
    .all(
      "select col, cast(hlc as text) as hlc from lophn_sync_col where tbl = ? and pk = ? order by col",
      [table, pk],
    )
    .map((row) => ({
      col: Number(row["col"]),
      hlc: BigInt(String(row["hlc"])),
    }));
}

// PK 칸만 채운 record(나머지는 undefined). update와 delete의 old 자리다.
function keyRecord(
  shape: TableShape,
  values: readonly ChangesetCell[],
): ChangesetCell[] {
  return shape.columns.map((_, i) =>
    shape.primaryKey[i] ? values[i] : undefined,
  );
}

// 적용하지 않고 돌려준 source row. 그대로 적용하면 받는 쪽이 지우고 흔적을 정리한 row가 되살아날 수 있고, 버리면
// source에만 남는다. `changeset`은 그 row 전부의 INSERT이고 `hlc`는 그 row의 가장 새 clock이다.
export type HeldRow = {
  table: string;
  pk: Uint8Array;
  hlc: bigint;
  changeset: Uint8Array;
};

export type MergeStats = ApplyStats & { deleted: number; heldRows: HeldRow[] };

/**
 * 다른 기계의 앱 DB 사본(`source`, 읽기 전용)을 덮지 않고 row·칸 clock으로 합친다. 기계 사이에는 hub가 없어
 * 덮으면 받는 쪽의 아직 안 간 변경이 사라진다.
 *
 * source의 상태를 변경으로 다시 짓고 `applyChange`에 그대로 넘긴다(규칙을 두 벌 두지 않는다): row마다 row
 * clock(없으면 0: sync를 켜기 전에 쓴 data라 받는 쪽에 clock이 있는 row를 이기지 못한다)의 INSERT, 칸 clock마다
 * 그 칸의 UPDATE, 흔적마다 DELETE, 없는 row의 kept 칸마다 UPDATE. 그래서 그 snapshot까지의 변경을 하나씩 적용한
 * 것과 같다.
 *
 * 받는 쪽 horizon의 그물(`applyRemote`의 held와 같은 뜻): row clock이 받는 쪽 horizon 이하인 source row인데 받는
 * 쪽에 그 row도 row clock 줄도 없으면, 받는 쪽이 지우고 흔적을 정리했을 수 있다. 그 row는 적용하지 않고
 * `heldRows`로 돌려준다(부르는 쪽이 held로 남긴다).
 *
 * 부르는 쪽 transaction 안에서 돈다(`applyRemote`와 같이 foreign_keys를 끄고 연다). 앱 표 하나라도 두 DB의
 * 모양(칸 이름과 순서, PK)이 다르면 아무것도 쓰지 않고 conflict다. 칸 clock은 칸 번호로 적혀 있어 모양이 같을
 * 때만 뜻이 있다.
 *
 * `absentDeletes`(horizon 밖에서 돌아온 기계): 받는 쪽 row 가운데 source에 없고 모든 clock이 `below` 이하이고
 * `keep`이 false인 것을 지운다. 그 사이 다른 곳에서 지워지고 흔적이 정리된 row다. 흔적은 `below`로 둔다.
 */
export function mergeSnapshot(
  db: SyncDb,
  source: SyncDb,
  clock: Clock,
  opts: { absentDeletes?: AbsentDeletes } = {},
): Result<MergeStats> {
  requireForeignKeysOff(db);
  const shapes = new Map<string, TableShape>();
  for (const name of new Set([...userTables(db), ...userTables(source)])) {
    const mine = tableShape(db, name);
    const theirs = tableShape(source, name);
    if (mine === null || theirs === null || !sameTableShape(mine, theirs)) {
      return err({
        code: "conflict",
        message: `snapshot does not match this database: ${name}`,
        details: { table: name },
      });
    }
    // PK가 없는 표는 session이 기록하지 않아 sync하지 않는다.
    if (mine.primaryKey.some(Boolean)) shapes.set(name, mine);
  }
  ensureKeptTable(db);

  const stats: MergeStats = {
    applied: 0,
    skipped: 0,
    held: [],
    deleted: 0,
    heldRows: [],
  };
  const horizon = horizonOf(db);
  let seen = ZERO;
  const see = (hlc: bigint) => {
    if (hlc > seen) seen = hlc;
  };
  const apply = (shape: TableShape, change: ChangesetChange, hlc: bigint) => {
    if (applyChange(db, shape, change, hlc)) stats.applied++;
    else stats.skipped++;
    see(hlc);
  };

  for (const shape of shapes.values()) {
    const table = shape.table;
    const primaryKey = shape.primaryKey;
    for (const values of readRows(source, shape)) {
      const pk = encodePk(values, primaryKey);
      const key = keyRecord(shape, values);
      const rowHlc = rowClock(source, table, pk)?.hlc ?? ZERO;
      const columns = columnClocks(source, table, pk);
      if (
        horizon !== null &&
        rowHlc <= horizon &&
        rowClock(db, table, pk) === null &&
        readRow(db, shape, key) === null
      ) {
        const hlc = columns.reduce(
          (top, c) => (c.hlc > top ? c.hlc : top),
          rowHlc,
        );
        see(hlc);
        stats.heldRows.push({
          table,
          pk,
          hlc,
          changeset: insertChangeset(
            table,
            primaryKeyOrder(source, table),
            values,
          ),
        });
        continue;
      }
      apply(
        shape,
        { table, primaryKey, op: "insert", old: null, new: values },
        rowHlc,
      );
      for (const { col, hlc } of columns) {
        const cells = [...key];
        cells[col] = values[col];
        apply(
          shape,
          { table, primaryKey, op: "update", old: key, new: cells },
          hlc,
        );
      }
    }
  }
  const keyOf = (shape: TableShape, pk: Uint8Array): ChangesetCell[] => {
    const pkValues = decodePk(pk);
    let next = 0;
    return shape.primaryKey.map((isPk) =>
      isPk ? pkValues[next++] : undefined,
    );
  };
  const tombstones = source.all(
    "select tbl, pk, cast(hlc as text) as hlc from lophn_sync_row where deleted = 1",
  );
  for (const row of tombstones) {
    const shape = shapes.get(String(row["tbl"]));
    if (shape === undefined) continue;
    const key = keyOf(shape, row["pk"] as Uint8Array);
    apply(
      shape,
      {
        table: shape.table,
        primaryKey: shape.primaryKey,
        op: "delete",
        old: key,
        new: null,
      },
      BigInt(String(row["hlc"])),
    );
  }
  // 이 판 전의 lophn이 쓴 snapshot에는 kept 표가 없다.
  const sourceKept =
    source.all(
      "select 1 as x from sqlite_master where type = 'table' and name = 'lophn_sync_kept'",
    ).length === 0
      ? []
      : source.all(
          "select tbl, pk, col, cast(hlc as text) as hlc, typeof(value) as t, case typeof(value) when 'integer' then cast(value as text) else value end as v from lophn_sync_kept",
        );
  for (const row of sourceKept) {
    const shape = shapes.get(String(row["tbl"]));
    const col = shape?.columns.indexOf(String(row["col"])) ?? -1;
    if (shape === undefined || col < 0 || shape.primaryKey[col]) continue;
    const key = keyOf(shape, row["pk"] as Uint8Array);
    const cells = [...key];
    cells[col] = storedValue(row["t"], row["v"]);
    apply(
      shape,
      {
        table: shape.table,
        primaryKey: shape.primaryKey,
        op: "update",
        old: key,
        new: cells,
      },
      BigInt(String(row["hlc"])),
    );
  }

  const theirHorizon = horizonOf(source);
  if (theirHorizon !== null) raiseHorizon(db, theirHorizon);

  const absent = opts.absentDeletes;
  if (absent !== undefined) {
    for (const shape of shapes.values()) {
      stats.deleted += deleteAbsent(db, source, shape, absent);
    }
    if (stats.deleted > 0) see(absent.below);
  }
  clock.observe(seen);
  return ok(stats);
}

// 칸마다 PK 안의 순번(PK가 아니면 0). changeset header가 이것을 싣는다.
function primaryKeyOrder(db: SyncDb, table: string): number[] {
  return db
    .all(`pragma table_info(${ident(table)})`)
    .map((row) => Number(row["pk"]));
}

function deleteAbsent(
  db: SyncDb,
  source: SyncDb,
  shape: TableShape,
  absent: AbsentDeletes,
): number {
  const table = ident(shape.table);
  let deleted = 0;
  for (const values of readRows(db, shape)) {
    const params: SqlParam[] = [];
    const where = keyWhere(shape, values, params);
    if (
      source.all(`select 1 as x from ${table} where ${where}`, params).length >
      0
    ) {
      continue;
    }
    const pk = encodePk(values, shape.primaryKey);
    const clocks = [
      rowClock(db, shape.table, pk)?.hlc ?? ZERO,
      ...columnClocks(db, shape.table, pk).map((c) => c.hlc),
    ];
    if (clocks.some((hlc) => hlc > absent.below)) continue;
    if (absent.keep(shape.table, pk)) continue;
    db.run(`delete from ${table} where ${where}`, params);
    dropColumnClocks(db, shape.table, pk);
    dropKept(db, shape.table, pk);
    setRowClock(db, shape.table, pk, absent.below, true);
    deleted++;
  }
  return deleted;
}
