import { err, ok, type Result } from "../../../base/result.ts";
import { applyChange } from "./apply.ts";
import {
  type ChangesetCell,
  type ChangesetChange,
  readChangeset,
} from "./changeset.ts";
import { openClock } from "./clock.ts";
import type { SyncDb } from "./db.ts";
import { hiddenTable, readRow, type TableShape, tableShape } from "./sql.ts";
import { readOutbox, writeOutbox } from "./tables.ts";

export type ReexpressInput = {
  // release가 바뀌기 전 DB(backup). outbox 줄과 옛 schema의 칸 이름을 여기서 읽는다.
  old: SyncDb;
  // 같은 DB를 새 release의 migration으로 local migrate한 것. 값은 칸 이름으로 여기서 읽는다.
  migrated: SyncDb;
  // 새 release의 snapshot을 adoptSnapshot한 DB. 다시 쓴 변경을 여기 적용하고 outbox를 다시 채운다.
  snapshot: SyncDb;
};

export type ReexpressResult = {
  // snapshot의 outbox에 다시 쓴 줄 수.
  kept: number;
  // migration이 지운 표나 칸(PK 칸 포함)에 걸려 통째로 버린 row change 수. 지운 칸만 빠지고 남은 UPDATE는 세지 않는다.
  dropped: number;
};

type Shapes = { get(db: SyncDb, table: string): TableShape | null };

function shapeCache(): Shapes {
  const cache = new Map<SyncDb, Map<string, TableShape | null>>();
  return {
    get(db, table) {
      let byTable = cache.get(db);
      if (byTable === undefined) cache.set(db, (byTable = new Map()));
      if (!byTable.has(table)) byTable.set(table, tableShape(db, table));
      return byTable.get(table)!;
    },
  };
}

// 칸 이름 → 값을 shape의 칸 순서 record로 놓는다. 이름이 없는 칸은 undefined다.
function recordOf(
  shape: TableShape,
  values: ReadonlyMap<string, ChangesetCell>,
): ChangesetCell[] {
  return shape.columns.map((column) => values.get(column));
}

type Expressed =
  | { kind: "change"; shape: TableShape; change: ChangesetChange }
  | { kind: "dropped" }
  // 그 row가 migrate한 DB에 없다: 뒤의 local delete나 migration이 지웠다. 그 뒤 변경이 따로 남는다.
  | { kind: "gone" };

function expressOne(
  input: ReexpressInput,
  shapes: Shapes,
  change: ChangesetChange,
): Result<Expressed> {
  const old = shapes.get(input.old, change.table);
  const migrated = shapes.get(input.migrated, change.table);
  if (migrated === null) return ok({ kind: "dropped" });
  const target = shapes.get(input.snapshot, change.table);
  if (
    old === null ||
    target === null ||
    target.columns.some((column) => !migrated.columns.includes(column))
  ) {
    return err({
      code: "conflict",
      message: `schemas do not line up for ${change.table}`,
      details: { table: change.table },
    });
  }
  const oldKey = old.columns.filter((_, i) => change.primaryKey[i]);
  const targetKey = target.columns.filter((_, i) => target.primaryKey[i]);
  if (
    oldKey.length !== targetKey.length ||
    oldKey.some((column) => !targetKey.includes(column))
  ) {
    return ok({ kind: "dropped" });
  }
  const source = change.op === "insert" ? change.new! : change.old!;
  const keyValues = new Map<string, ChangesetCell>();
  old.columns.forEach((column, i) => {
    if (change.primaryKey[i]) keyValues.set(column, source[i]);
  });
  const key = recordOf(target, keyValues);
  const expressed = (
    op: ChangesetChange["op"],
    values: ChangesetCell[] | null,
  ) =>
    ok({
      kind: "change" as const,
      shape: target,
      change: {
        table: change.table,
        primaryKey: target.primaryKey,
        op,
        old: op === "insert" ? null : key,
        new: values,
      },
    });
  if (change.op === "delete") return expressed("delete", null);

  const changed =
    change.op === "insert"
      ? target.columns
      : old.columns.filter(
          (column, i) =>
            !change.primaryKey[i] &&
            change.new![i] !== undefined &&
            target.columns.includes(column),
        );
  if (changed.length === 0) return ok({ kind: "dropped" });
  const row = readRow(input.migrated, migrated, recordOf(migrated, keyValues));
  if (row === null) return ok({ kind: "gone" });
  const values = new Map<string, ChangesetCell>();
  migrated.columns.forEach((column, i) => {
    if (changed.includes(column)) values.set(column, row[i]);
  });
  return expressed(change.op, recordOf(target, values));
}

/**
 * release가 바뀔 때 폰의 안 보낸 변경을 새 release의 snapshot 위에 표와 칸 **이름**으로 다시 쓴다.
 * - INSERT는 migrate한 DB의 그 row 전부, UPDATE는 바뀐 칸의 migrate한 값, DELETE는 PK.
 * - migration이 지운 표·칸·PK 칸의 변경은 버린다(그 migration의 `-- loss:` 줄을 사람이 activation 때 봤다).
 * - 줄마다 받은 hlc로 last-write-wins 적용하며 session으로 새 changeset을 떠서 snapshot의 outbox에 같은 id·operation·
 *   started_at·hlc로 쓴다. 바꾼 것이 없는 줄은 쓰지 않는다.
 *
 * old의 outbox는 모두 찍혀 있어야 한다(host가 backup 전에 stampOutbox한다). snapshot에는 adoptSnapshot을 먼저 한다.
 * snapshot에 자기 transaction을 열고(foreign_keys는 그 동안 끈다), 실패하면 rollback한다. file은 옮기지 않는다.
 */
export function reexpress(input: ReexpressInput): Result<ReexpressResult> {
  const rows = readOutbox(input.old);
  if (rows.some((row) => row.hlc === null)) {
    return err({
      code: "invalid_input",
      message: "stamp the outbox before re-expressing it",
    });
  }
  const db = input.snapshot;
  const fk = Number(db.all("pragma foreign_keys")[0]?.["foreign_keys"] ?? 0);
  db.exec("pragma foreign_keys = off");
  db.exec("begin immediate");
  try {
    const result = reexpressRows(input, rows);
    db.exec(result.ok ? "commit" : "rollback");
    return result;
  } catch (thrown) {
    db.exec("rollback");
    throw thrown;
  } finally {
    if (fk !== 0) db.exec("pragma foreign_keys = on");
  }
}

function reexpressRows(
  input: ReexpressInput,
  rows: ReturnType<typeof readOutbox>,
): Result<ReexpressResult> {
  const db = input.snapshot;
  const clock = openClock(db);
  const shapes = shapeCache();
  const result: ReexpressResult = { kept: 0, dropped: 0 };
  for (const row of rows) {
    const hlc = row.hlc!;
    const read = readChangeset(row.changeset);
    if (!read.ok) return read;
    clock.observe(hlc);
    const session = db.session();
    let changeset: Uint8Array;
    try {
      for (const change of read.value) {
        if (hiddenTable(change.table)) continue;
        const one = expressOne(input, shapes, change);
        if (!one.ok) return one;
        if (one.value.kind === "dropped") result.dropped++;
        if (one.value.kind !== "change") continue;
        applyChange(db, one.value.shape, one.value.change, hlc);
      }
      changeset = session.changeset();
    } finally {
      session.close();
    }
    if (changeset.length === 0) continue;
    writeOutbox(db, { ...row, changeset, hlc });
    result.kept++;
  }
  return ok(result);
}
