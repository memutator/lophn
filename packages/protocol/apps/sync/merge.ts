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
} from "./changeset.ts";
import type { Clock } from "./clock.ts";
import type { SqlParam, SyncDb } from "./db.ts";
import { horizonOf, raiseHorizon } from "./horizon.ts";
import {
  ident,
  keyWhere,
  readRows,
  type TableShape,
  tableShape,
  userTables,
} from "./sql.ts";
import { dropColumnClocks, rowClock, setRowClock } from "./tables.ts";

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

/**
 * 다른 기계의 앱 DB 사본(`source`, 읽기 전용)을 덮지 않고 row·칸 clock으로 합친다. 기계 사이에는 hub가 없어
 * 덮으면 받는 쪽의 아직 안 간 변경이 사라진다.
 *
 * source의 상태를 변경으로 다시 짓고 `applyChange`에 그대로 넘긴다(규칙을 두 벌 두지 않는다): row마다 row
 * clock(없으면 0: sync를 켜기 전에 쓴 data라 받는 쪽에 clock이 있는 row를 이기지 못한다)의 INSERT, 칸 clock마다
 * 그 칸의 UPDATE, 흔적마다 DELETE. 그래서 그 snapshot까지의 변경을 하나씩 적용한 것과 같다.
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
): Result<ApplyStats & { deleted: number }> {
  requireForeignKeysOff(db);
  const names = userTables(db);
  const sourceNames = userTables(source);
  const shapes = new Map<string, TableShape>();
  for (const name of new Set([...names, ...sourceNames])) {
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

  const stats: ApplyStats & { deleted: number } = {
    applied: 0,
    skipped: 0,
    held: [],
    deleted: 0,
  };
  let seen = ZERO;
  const apply = (shape: TableShape, change: ChangesetChange, hlc: bigint) => {
    if (applyChange(db, shape, change, hlc)) stats.applied++;
    else stats.skipped++;
    if (hlc > seen) seen = hlc;
  };

  for (const shape of shapes.values()) {
    const table = shape.table;
    const primaryKey = shape.primaryKey;
    for (const values of readRows(source, shape)) {
      const pk = encodePk(values, primaryKey);
      const key = keyRecord(shape, values);
      apply(
        shape,
        { table, primaryKey, op: "insert", old: null, new: values },
        rowClock(source, table, pk)?.hlc ?? ZERO,
      );
      for (const { col, hlc } of columnClocks(source, table, pk)) {
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
  const tombstones = source.all(
    "select tbl, pk, cast(hlc as text) as hlc from lophn_sync_row where deleted = 1",
  );
  for (const row of tombstones) {
    const shape = shapes.get(String(row["tbl"]));
    if (shape === undefined) continue;
    const pkValues = decodePk(row["pk"] as Uint8Array);
    let next = 0;
    const key = shape.primaryKey.map((isPk) =>
      isPk ? pkValues[next++] : undefined,
    );
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

  const theirHorizon = horizonOf(source);
  if (theirHorizon !== null) raiseHorizon(db, theirHorizon);

  const absent = opts.absentDeletes;
  if (absent !== undefined) {
    for (const shape of shapes.values()) {
      stats.deleted += deleteAbsent(db, source, shape, absent);
    }
    if (stats.deleted > 0 && absent.below > seen) seen = absent.below;
  }
  clock.observe(seen);
  return ok(stats);
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
    setRowClock(db, shape.table, pk, absent.below, true);
    deleted++;
  }
  return deleted;
}
