import { err, ok, type Result } from "../../../base/result.ts";
import {
  type ChangesetCell,
  type ChangesetChange,
  type ChangesetValue,
  encodePk,
  readChangeset,
  utf8Encode,
} from "./changeset.ts";
import { type Clock, nodeOfHlc } from "./clock.ts";
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

export type ConflictPolicy = "lww" | "keep_both";
export type ConflictResolver = (table: string) => ConflictPolicy;
export type ApplyOptions = {
  conflict?: ConflictResolver;
};

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

const SHIFT32 = BigInt(32);
const ONE = BigInt(1);
const MASK20 = 0xfffff;

function sameValue(a: ChangesetCell, b: ChangesetCell): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

// TEXT affinity 칸(또는 선언 type이 없는 string 값)만 keep_both 대상이다. 숫자/flag/blob은 LWW를 유지한다.
function isTextColumn(
  declaredType: string,
  a: ChangesetValue,
  b: ChangesetValue,
): boolean {
  const upper = declaredType.toUpperCase();
  if (
    upper.includes("TEXT") ||
    upper.includes("CHAR") ||
    upper.includes("CLOB")
  ) {
    return typeof a === "string" || typeof b === "string";
  }
  return upper === "" && typeof a === "string" && typeof b === "string";
}

function fnv1a32(bytes: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function conflictHash(
  table: string,
  pk: Uint8Array,
  loserHlc: bigint,
): { hi: number; lo: number; hex12: string } {
  const prefix = utf8Encode(`${table}\0${String(loserHlc)}\0`);
  const combined = new Uint8Array(prefix.length + pk.length);
  combined.set(prefix, 0);
  combined.set(pk, prefix.length);
  const hi = fnv1a32(combined, 0x811c9dc5);
  const lo = fnv1a32(combined, (0x9e3779b9 ^ hi) >>> 0);
  const hex12 =
    hi.toString(16).padStart(8, "0") +
    (lo >>> 16).toString(16).padStart(4, "0");
  return { hi, lo, hex12 };
}

function hashBytes8(hi: number, lo: number): Uint8Array {
  return new Uint8Array([
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  ]);
}

function conflictInt64(hi: number, lo: number, avoid: bigint | null): bigint {
  // JS safe integer 안의 결정론적 음수 52-bit 정수(양수 id와 겹치지 않는다).
  const mag = (BigInt(hi & MASK20) << SHIFT32) | BigInt(lo >>> 0) | ONE;
  const candidate = -mag;
  return candidate === avoid ? candidate - ONE : candidate;
}

/**
 * keep_both 충돌 사본의 결정론적 PK를 만든다. 원본 PK bytes와 패자 HLC에서 파생하므로 모든 replica(Node·폰)가
 * 적용 순서와 상관없이 같은 PK로 수렴한다. text·integer·real·blob·복합 PK를 각 schema type에 맞게 변환한다.
 */
export function deriveConflictRow(
  shape: TableShape,
  values: readonly ChangesetValue[],
  loserHlc: bigint,
): ChangesetValue[] {
  const pkCols: number[] = [];
  for (let i = 0; i < shape.primaryKey.length; i++) {
    if (shape.primaryKey[i]) pkCols.push(i);
  }
  const targetCol =
    pkCols.find((i) => typeof values[i] === "string") ??
    pkCols.find((i) => {
      const upper = shape.types[i]!.toUpperCase();
      return (
        upper.includes("TEXT") ||
        upper.includes("CHAR") ||
        upper.includes("CLOB")
      );
    }) ??
    pkCols[0]!;
  const origPk = encodePk(values, shape.primaryKey);
  const { hi, lo, hex12 } = conflictHash(shape.table, origPk, loserHlc);
  const out = [...values];
  const val = values[targetCol]!;
  if (typeof val === "string") {
    out[targetCol] = `${val}~conflict-${hex12}`;
  } else if (typeof val === "bigint") {
    out[targetCol] = conflictInt64(hi, lo, val);
  } else if (val instanceof Uint8Array) {
    const suffix = hashBytes8(hi, lo);
    const next = new Uint8Array(val.length + suffix.length);
    next.set(val, 0);
    next.set(suffix, val.length);
    out[targetCol] = next;
  } else if (typeof val === "number") {
    const candidate = -(1_000_000_000 + (hi >>> 0) / 1000);
    out[targetCol] = candidate === val ? candidate - 1 : candidate;
  } else {
    const upper = shape.types[targetCol]!.toUpperCase();
    if (upper.includes("INT")) {
      out[targetCol] = conflictInt64(hi, lo, null);
    } else if (upper.includes("BLOB")) {
      out[targetCol] = hashBytes8(hi, lo);
    } else if (
      upper.includes("REAL") ||
      upper.includes("FLOA") ||
      upper.includes("DOUB")
    ) {
      out[targetCol] = -(1_000_000_000 + (hi >>> 0) / 1000);
    } else {
      out[targetCol] = `~conflict-${hex12}`;
    }
  }
  return out;
}

// keep_both 표에서 동시 텍스트 충돌을 찾는다. 패자 HLC별로 패자 칸 값들을 묶어 돌려준다.
function collectTextConflicts(
  db: SyncDb,
  shape: TableShape,
  pk: Uint8Array,
  rowHlc: bigint | null,
  current: readonly ChangesetValue[],
  oldValues: readonly ChangesetCell[] | null,
  newValues: readonly ChangesetCell[],
  hlc: bigint,
): Map<bigint, { col: number; value: ChangesetValue }[]> {
  const losers = new Map<bigint, { col: number; value: ChangesetValue }[]>();
  const incomingNode = nodeOfHlc(hlc);
  for (let i = 0; i < newValues.length; i++) {
    const incoming = newValues[i];
    if (incoming === undefined || shape.primaryKey[i]) continue;
    const existingHlc = columnClock(db, shape.table, pk, i) ?? rowHlc;
    if (existingHlc === null || existingHlc === hlc) continue;
    if (nodeOfHlc(existingHlc) === incomingNode) continue;
    const existing = current[i]!;
    if (sameValue(existing, incoming)) continue;
    if (!isTextColumn(shape.types[i]!, existing, incoming)) continue;
    // UPDATE의 old는 보낸 쪽이 고치기 전 값이다. 현재 값과 같으면 인과적(순차) 수정이지 동시 수정이 아니다.
    // old 칸이 없으면(snapshot 합치기) 순차 수정 오탐을 피하려고 건너뛴다.
    if (oldValues !== null) {
      const before = oldValues[i];
      if (before === undefined || sameValue(before, existing)) continue;
    }
    const incomingWins = newer(hlc, existingHlc);
    const loserHlc = incomingWins ? existingHlc : hlc;
    const loserValue = incomingWins ? existing : incoming;
    const group = losers.get(loserHlc) ?? [];
    group.push({ col: i, value: loserValue });
    losers.set(loserHlc, group);
  }
  return losers;
}

function insertConflictCopies(
  db: SyncDb,
  shape: TableShape,
  winnerRow: readonly ChangesetValue[],
  losers: ReadonlyMap<bigint, { col: number; value: ChangesetValue }[]>,
): boolean {
  let created = false;
  for (const [loserHlc, cols] of losers) {
    const copy = [...winnerRow];
    for (const { col, value } of cols) copy[col] = value;
    const dupRow = deriveConflictRow(shape, copy, loserHlc);
    const dupPk = encodePk(dupRow, shape.primaryKey);
    // 이미 사본이 있거나 사용자가 사본을 지운 묘비가 있으면 덮거나 되살리지 않는다.
    if (rowClock(db, shape.table, dupPk) !== null) continue;
    if (readRow(db, shape, dupRow) !== null) continue;
    const params: SqlParam[] = [];
    const literals = dupRow.map((value) => sqlValue(value, params));
    db.run(
      `insert into ${ident(shape.table)} (${shape.columns.map(ident).join(", ")}) values (${literals.join(", ")})`,
      params,
    );
    setRowClock(db, shape.table, dupPk, loserHlc, false);
    created = true;
  }
  return created;
}

/**
 * row change 하나를 칸 단위 last-write-wins(또는 `keep_both` 표의 동시 텍스트 충돌 사본 보존)로 적용한다.
 * change의 칸 순서는 shape의 칸 순서다.
 * 쓰기는 자기 clock으로만 줄을 서고, delete는 자기보다 옛 것만 지운다. row가 있는지는 마지막 insert와 마지막
 * delete(row clock)만으로 정해지고, 칸 값은 칸마다 가장 새 clock의 것이다. 그래서 받는 순서와 상관없이 같다.
 * - UPDATE: 칸마다 들어온 clock이 그 칸 clock(없으면 row clock)보다 클 때만 쓴다. row가 없으면 그 값을 kept로
 *   둔다(같은 비교. row가 돌아오면 쓰인다). `keep_both` 표에서 다른 기기의 동시 텍스트 수정이 부딪히면 승자 row는
 *   원래 PK로 유지하고 패자 텍스트는 결정론적 `dupPk` 사본 row로 INSERT한다(기존 `lophn_sync_row`에 패자 HLC 기록).
 * - DELETE: row clock보다 새로울 때만. row clock을 그 값으로, deleted로 둔다. 그보다 새 칸 clock은 지우지 않고 그
 *   칸의 값과 같이 kept로 옮기고, 그 이하의 칸 clock과 kept는 지운다.
 * - 없는 row의 INSERT: row clock(묘비)보다 새로울 때만. 그보다 새 kept 칸은 kept의 값과 clock을 갖는다.
 * - 있는 row의 INSERT: 모든 칸의 UPDATE이고, row clock보다 새로우면 row clock을 올린다. `keep_both` 표에서 다른 기기와
 *   동시 INSERT 텍스트 충돌이면 패자 사본을 결정론적 `dupPk`로 남긴다.
 * 그래서 row clock은 받은 insert·delete 중 가장 큰 clock이고, 칸 clock과 kept는 그보다 큰 것만 남는다.
 */
export function applyChange(
  db: SyncDb,
  shape: TableShape,
  change: ChangesetChange,
  hlc: bigint,
  conflict: ConflictPolicy = "lww",
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
    if (!exists) return keepColumns(change.new!);
    if (conflict !== "keep_both") return updateColumns(change.new!);
    const current = readRow(db, shape, record)!;
    const losers = collectTextConflicts(
      db,
      shape,
      pk,
      row,
      current,
      change.old,
      change.new!,
      hlc,
    );
    const updated = updateColumns(change.new!);
    if (losers.size === 0) return updated;
    const winner = updated ? readRow(db, shape, record)! : current;
    const copied = insertConflictCopies(db, shape, winner, losers);
    return updated || copied;
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
  const current = conflict === "keep_both" ? readRow(db, shape, record)! : null;
  const losers =
    current === null
      ? null
      : collectTextConflicts(
          db,
          shape,
          pk,
          row,
          current,
          null,
          change.new!,
          hlc,
        );
  let wrote = updateColumns(change.new!);
  if (newer(hlc, row)) {
    setRowClock(db, table, pk, hlc, false);
    dropColumnClocks(db, table, pk, hlc);
    wrote = true;
  }
  if (losers !== null && losers.size > 0) {
    const winner = wrote ? readRow(db, shape, record)! : current!;
    if (insertConflictCopies(db, shape, winner, losers)) wrote = true;
  }
  return wrote;
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
  options?: ApplyOptions,
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
      const policy = options?.conflict?.(shape.table) ?? "lww";
      if (applyChange(db, shape, change, incoming.hlc, policy)) stats.applied++;
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
  options?: ApplyOptions,
): Result<ApplyStats & { stamped: number }> {
  const stamped = stampOutbox(db, clock, nowMs);
  if (!stamped.ok) return stamped;
  const applied = applyRemote(db, changes, clock, options);
  if (!applied.ok) return applied;
  return ok({ ...applied.value, stamped: stamped.value });
}
