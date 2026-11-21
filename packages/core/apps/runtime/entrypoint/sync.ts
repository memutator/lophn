// sync 앱(선언 `runs_on`에 phone이 있거나 `sync`가 table을 보냄, `syncPlanOf`)의 컴퓨터 쪽 일. 앱과 같은 cap-store 연결에서
// 돈다:
// - 컴퓨터의 write는 data, changeset, clock 찍기를 한 transaction으로 commit한다(handler가 던져도 바뀐 것과 clock을 같이).
//   clock은 clock을 다는 표(폰 앱은 모두, 그 밖에는 보내는 표)만 찍는다.
// - 폰이나 다른 기계에서 온 변경 묶음을 한 transaction에서 변경마다 칸 단위 last-write-wins로 적용하고 실제로 바뀐 것
//   (effective)을 session으로 뜬다.
// - 폰이 처음 받을 snapshot을 `VACUUM INTO`로 뜨고, 폴더로 갈 snapshot은 보내는 표만 새 file에 복사한다. 다른 기계의
//   snapshot은 보내는 표만 row·칸 clock으로 합친다.
// - rewind 적용과 held 변경 다시 적용도 한 transaction 안에서 effective를 뜨고 새 clock을 찍는다.
// - core가 정한 clock보다 옛 흔적을 지운다.
// 모두 runtime의 `exclusive` 문 안에서 부른다. 같은 연결의 session이 겹치면 한 changeset에 섞이기 때문이다.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../../../base/result.ts";
import {
  clockedTables,
  sentTables,
  type SyncPlan,
  type TableFilter,
} from "../../../../protocol/apps/declaration/sync-plan.ts";
import {
  applyRemote,
  type ApplyStats,
  type Clock,
  dropTombstones,
  ensureSyncTables,
  getState,
  type HeldRow,
  type IncomingChange,
  maxHlc,
  mergeSnapshot,
  openClock,
  stampLocal,
  setState,
  SYNC_TABLES_SQL,
  type SyncDb,
} from "../../../../protocol/apps/sync/mod.ts";
import { MERGE_HELD_MAX_BYTES } from "./limits.ts";
import {
  type NodeDatabase,
  nodeSyncDb,
} from "../../../../protocol/apps/sync/node-db.ts";
import {
  encodePk,
  readChangeset,
  rowChangeset,
} from "../../../../protocol/apps/sync/changeset.ts";
import { setRowClock } from "../../../../protocol/apps/sync/tables.ts";
import {
  hiddenTable,
  ident,
  readRow,
  readRows,
  tableShape,
} from "../../../../protocol/apps/sync/sql.ts";

// session 구간. runtime에서는 cap-store hook을 부르는 StoreAccess다. 바뀐 것이 없으면 null이다.
export type Recorder = { begin(): void; end(): Uint8Array | null };

export type SyncStore = {
  db: SyncDb;
  clock: Clock;
  record: Recorder;
  nowMs: () => number;
  // 이 release의 선언이 정한 길. 어느 표에 clock을 찍고 어느 표를 폴더로 보내는지 정한다.
  plan: SyncPlan;
};

// 표마다 마지막으로 본 칸 이름 목록. column clock이 칸 번호로 적혀서, 목록이 바뀐 표를 알아야 한다.
const COLUMNS_SQL =
  "create table if not exists lophn_sync_columns (tbl text primary key, columns text not null)";

function rollback(db: SyncDb): void {
  try {
    db.exec("rollback");
  } catch {
    // 열린 transaction이 없다.
  }
}

function inTransaction<T>(db: SyncDb, work: () => T): T {
  db.exec("begin immediate");
  try {
    const result = work();
    db.exec("commit");
    return result;
  } catch (error) {
    rollback(db);
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 이 replica의 새 clock 하나로 changeset을 찍는다. 부르는 쪽 transaction 안에서.
function stamp(sync: SyncStore, changeset: Uint8Array): bigint {
  const hlc = sync.clock.next(sync.nowMs());
  const stamped = stampLocal(
    sync.db,
    changeset,
    hlc,
    clockedTables(sync.plan) ?? undefined,
  );
  if (!stamped.ok) throw new Error(stamped.error.message);
  return hlc;
}

// column clock은 칸 번호로 적힌다. migration이 칸을 더하거나 지우거나 순서를 바꾸면 옛 번호가 다른 칸을 가리키므로,
// 칸 목록이 바뀐 표의 column clock을 옛 칸 이름 목록과 지금 목록으로 옮긴다. 이름이 없어진 칸(이름을 바꾼 칸도)과
// 없어진 표의 clock만 지운다: 그 row는 다음 고침까지 row clock으로 견준다. 지우지 않고 옮겨야 늦게 올라온 기계가
// 옛 release에서 한 칸 고침이 그 기계의 다음 snapshot을 합칠 때 이긴다. 폰은 release가 바뀔 때 이 DB의 snapshot을
// 받으니 같은 clock이 된다. live는 schema를 바꾸지 않으니 activation이 migration을 돌린 뒤 새 release의 첫 시작이
// 이것을 한다. `clocked`가 있으면 clock을 다는 표만 본다(그 밖의 표는 기록에서 빠져 칸 clock이 지워진다).
export function remapColumnClocks(
  db: SyncDb,
  clocked: TableFilter = null,
): void {
  db.exec(COLUMNS_SQL);
  const recorded = new Map(
    db
      .all("select tbl, columns from lophn_sync_columns")
      .map((row) => [String(row["tbl"]), String(row["columns"])]),
  );
  const tables = db
    .all(
      "select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' and name not glob 'lophn_*'",
    )
    .map((row) => String(row["name"]))
    .filter((table) => clocked === null || clocked(table));
  for (const table of tables) {
    const names = db
      .all(`pragma table_info(${ident(table)})`)
      .map((row) => String(row["name"]));
    const columns = JSON.stringify(names);
    const before = recorded.get(table);
    recorded.delete(table);
    if (before === columns) continue;
    if (before !== undefined)
      moveColumnClocks(db, table, JSON.parse(before), names);
    db.run(
      "insert into lophn_sync_columns (tbl, columns) values (?, ?) on conflict (tbl) do update set columns = excluded.columns",
      [table, columns],
    );
  }
  for (const table of recorded.keys()) {
    db.run("delete from lophn_sync_col where tbl = ?", [table]);
    db.run("delete from lophn_sync_columns where tbl = ?", [table]);
  }
}

// 옛 번호 i의 칸이 지금 j면 i → j. (tbl, pk, col) 열쇠가 옮기는 도중 겹치지 않게 먼저 음수 -1 - j로 두었다가 뒤집는다.
// 제자리인 칸(i = j)은 두고, 지금 목록에 이름이 없는 칸은 지운다.
function moveColumnClocks(
  db: SyncDb,
  table: string,
  before: readonly string[],
  after: readonly string[],
): void {
  for (let i = 0; i < before.length; i++) {
    const j = after.indexOf(before[i]!);
    if (j === i) continue;
    if (j === -1) {
      db.run("delete from lophn_sync_col where tbl = ? and col = ?", [
        table,
        i,
      ]);
    } else {
      db.run("update lophn_sync_col set col = ? where tbl = ? and col = ?", [
        -1 - j,
        table,
        i,
      ]);
    }
  }
  db.run("delete from lophn_sync_col where tbl = ? and col >= ?", [
    table,
    before.length,
  ]);
  db.run("update lophn_sync_col set col = -1 - col where tbl = ? and col < 0", [
    table,
  ]);
}

// clock을 다는 표에서 빠진 표(선언의 sync에서 지운 표)의 row·칸 clock과 kept를 지운다. 그 표는 이제 이 기계를 떠나지 않아
// clock이 더 찍히지 않으니 옛 clock은 그 사이의 로컬 고침을 말하지 못한다. 그 표를 다시 보내게 되면 `stampUnclockedRows`가
// 그때 이 기계에 있는 row를 그 순간의 로컬 write로 찍는다(clock 없는 row는 어떤 clock에도 지므로 그대로 두면 안 된다).
export function dropUnclockedClocks(db: SyncDb, clocked: TableFilter): void {
  if (clocked === null) return;
  for (const hidden of [
    "lophn_sync_row",
    "lophn_sync_col",
    "lophn_sync_kept",
  ]) {
    for (const row of db.all(`select distinct tbl from ${hidden}`)) {
      const table = String(row["tbl"]);
      if (!clocked(table))
        db.run(`delete from ${hidden} where tbl = ?`, [table]);
    }
  }
}

/**
 * 보내는 표의 row 가운데 row clock이 없는 것(처음 보내게 된 표나 빠졌다 다시 보내는 표의 row)에 이 기계의 새 clock 하나를
 * 찍는다. 그 row는 그 순간 이 기계가 쓴 것으로 센다: clock이 없는 row는 받는 변경과 snapshot의 어떤 clock에도 져서, 다른
 * 기계의 옛 값이나 옛 흔적이 이 기계의 data를 덮거나 지운다. 두 기계가 같은 key의 row를 찍으면 나중 찍은 쪽으로 같아진다.
 * 옛 release(모든 표, `tables` null)는 지금까지처럼 두고, 다른 사본(폰, 폴더)은 release가 바뀐 뒤의 snapshot으로 이 clock을 받는다.
 */
export function stampUnclockedRows(sync: SyncStore): number {
  const tables = sync.plan.tables;
  if (tables === null) return 0;
  const db = sync.db;
  let hlc: bigint | null = null;
  let stamped = 0;
  for (const table of tables) {
    const shape = tableShape(db, table);
    if (shape === null || !shape.primaryKey.some(Boolean)) continue;
    const clocked = new Set(
      db
        .all("select hex(pk) as pk from lophn_sync_row where tbl = ?", [table])
        .map((row) => String(row["pk"])),
    );
    for (const values of readRows(db, shape)) {
      const pk = encodePk(values, shape.primaryKey);
      if (clocked.has(Buffer.from(pk).toString("hex").toUpperCase())) continue;
      hlc ??= sync.clock.next(sync.nowMs());
      // 칸 clock과 kept는 row clock보다 커야만 뜻이 있다. 새 row clock 아래의 것은 지운다(clock 없는 row에는 보통 없다).
      db.run("delete from lophn_sync_col where tbl = ? and pk = ?", [
        table,
        pk,
      ]);
      db.run("delete from lophn_sync_kept where tbl = ? and pk = ?", [
        table,
        pk,
      ]);
      setRowClock(db, table, pk, hlc, false);
      stamped++;
    }
  }
  return stamped;
}

// DB에 node를 처음 적은 기계의 id다. 컴퓨터만 쓴다(폰은 이 key를 모른다). 다른 기계에서 온 DB(복제된 data root)면 node를 새것으로
// 바꾼다: 두 기계가 같은 node로 clock을 찍으면 서로의 변경을 같은 replica의 것으로 본다. 표지가 없는 DB는 이 판 전에 이 기계에서
// 만든 것이라 지금 id를 적고 node를 지킨다(앱 DB는 앱 process가 열 때만 고칠 수 있어 data step으로 옮기지 않는다).
function claimNode(db: SyncDb, machine: string, node: string): void {
  const row = db.all(
    "select value from lophn_sync_state where key = 'machine'",
  )[0];
  const before = row === undefined ? null : String(row["value"]);
  if (before === machine) return;
  if (before !== null) setState(db, "node", node);
  db.run(
    "insert into lophn_sync_state (key, value) values ('machine', ?) on conflict (key) do update set value = excluded.value",
    [machine],
  );
}

/**
 * sync 앱 process가 시작할 때 한 번. 숨은 표를 만들고(node는 처음 한 번만 적히고 다른 기계의 DB면 바뀐다), clock을 달지 않게
 * 된 표의 clock을 지우고, 칸이 바뀐 표의 column clock을 칸 이름으로 옮기고, 보내는 표의 clock 없는 row를 지금 찍고, 앱 시작(등록 code)이 DB를 바꿨으면 그 changeset을
 * 찍는다. 시작 code는 transaction으로 감싸지 않아 그 변경과 clock은 따로 commit된다. `startHlc`는 그 찍은 clock이다: ready
 * 통보에 실어 core가 sync log에 남긴다.
 */
export function openSyncStore(input: {
  database: NodeDatabase;
  node: string;
  machine: string;
  record: Recorder;
  nowMs: () => number;
  startChangeset: Uint8Array | null;
  plan: SyncPlan;
}): SyncStore & { startHlc: bigint | null } {
  const db = nodeSyncDb(input.database);
  const sync: SyncStore = {
    db,
    clock: openClock(db),
    record: input.record,
    nowMs: input.nowMs,
    plan: input.plan,
  };
  const clocked = clockedTables(input.plan);
  const startHlc = inTransaction(db, () => {
    ensureSyncTables(db, input.node);
    claimNode(db, input.machine, input.node);
    dropUnclockedClocks(db, clocked);
    remapColumnClocks(db, clocked);
    stampUnclockedRows(sync);
    return input.startChangeset === null
      ? null
      : stamp(sync, input.startChangeset);
  });
  return { ...sync, startHlc };
}

export type SyncedWrite<T> = {
  value: T;
  changeset: Uint8Array | null;
  // changeset이 있을 때만. 그 변경과 같은 transaction으로 commit된 clock이다.
  hlc: bigint | null;
};

/**
 * write·external 호출 하나: `begin immediate` → session → work → changeset이 있으면 새 clock으로 찍기 → commit.
 * work는 던지지 않아야 한다(handler 실패도 값으로 돌려준다). 그래야 실패한 호출도 바뀐 것과 clock이 같이 남는다.
 * transaction을 열지 못하면 unavailable(work는 돌지 않았다), commit까지 가지 못하면 rollback하고 internal이다.
 */
export async function syncedWrite<T>(
  sync: SyncStore,
  work: () => Promise<T>,
): Promise<Result<SyncedWrite<T>>> {
  try {
    sync.db.exec("begin immediate");
  } catch (error) {
    return err({
      code: "unavailable",
      message: `app database is busy: ${errorMessage(error)}`,
    });
  }
  try {
    sync.record.begin();
    let value: T;
    try {
      value = await work();
    } catch (error) {
      sync.record.end();
      throw error;
    }
    const changeset = sync.record.end();
    const hlc = changeset === null ? null : stamp(sync, changeset);
    sync.db.exec("commit");
    return ok({ value, changeset, hlc });
  } catch {
    rollback(sync.db);
    return err({ code: "internal", message: "the write was not committed" });
  }
}

// node:sqlite는 SQLite 결과 code를 `errcode`에 싣는다. 확장 code의 아래 8 bit가 SQLITE_CONSTRAINT(19)다.
function constraintError(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && (code & 0xff) === 19;
}

export type ChangeApplied =
  | { status: "applied"; effective: Uint8Array | null }
  | { status: "skipped"; message: string }
  | { status: "held" };

// SQLite는 transaction 안에서 foreign_keys를 바꾸지 못한다. 적용 중 cascade가 clock 없는 변경을 만들면 사본이 갈린다.
function foreignKeysOff<T>(db: SyncDb, work: () => T): T {
  const fk = Number(db.all("pragma foreign_keys")[0]?.["foreign_keys"] ?? 0);
  if (fk !== 0) db.exec("pragma foreign_keys = off");
  try {
    return work();
  } finally {
    if (fk !== 0) db.exec("pragma foreign_keys = on");
  }
}

/**
 * 폰이나 다른 기계에서 온 변경들을 받은 hlc 그대로 한 transaction에서 칸 단위 last-write-wins로 적용하고, 변경마다 실제로
 * 바뀐 것을 session으로 뜬다. 변경마다 SAVEPOINT다.
 * - 제약(UNIQUE·CHECK·NOT NULL)에 걸린 변경은 그것만 되돌리고 skipped다. 맞추기가 같은 변경에 영영 막히지 않게 한다.
 * - 정리된 흔적과 안전하게 합칠 수 없는 변경은 적용하지 않고 held다(부르는 쪽이 bytes를 held 줄로 남긴다).
 * - 표나 칸이 이 DB와 맞지 않는 변경(다른 release)이 하나라도 있으면 전부 rollback하고 conflict, changeset이 깨졌으면
 *   invalid_input이다. 그 밖의 SQL 오류는 rollback하고 던진다.
 */
export function applyRemoteChanges(
  sync: SyncStore,
  changes: readonly IncomingChange[],
): Result<ChangeApplied[]> {
  const db = sync.db;
  return foreignKeysOff(db, () => {
    db.exec("begin immediate");
    try {
      const results: ChangeApplied[] = [];
      for (const change of changes) {
        db.exec("savepoint lophn_change");
        let applied: Result<ApplyStats>;
        sync.record.begin();
        try {
          applied = applyRemote(db, [change], sync.clock);
        } catch (error) {
          sync.record.end();
          db.exec("rollback to lophn_change");
          db.exec("release lophn_change");
          if (!constraintError(error)) throw error;
          results.push({ status: "skipped", message: errorMessage(error) });
          continue;
        }
        const effective = sync.record.end();
        if (!applied.ok) {
          rollback(db);
          return applied;
        }
        db.exec("release lophn_change");
        results.push(
          applied.value.held.length > 0
            ? { status: "held" }
            : { status: "applied", effective },
        );
      }
      db.exec("commit");
      return ok(results);
    } catch (error) {
      rollback(db);
      throw error;
    }
  });
}

export type LocalApplied =
  | { ok: true; effective: Uint8Array | null; hlc: bigint | null }
  | { ok: false; message: string };

/**
 * core가 준 changeset의 적용(`apply`, cap-store의 SAVEPOINT 적용: rewind의 뒤집은 것, 사람이 다시 적용하는 held 변경)을
 * 바깥 transaction 하나로 감싸 effective를 뜨고 이 기계의 새 clock으로 찍는다. 충돌이면 하나도 적용하지 않는다.
 */
export function applyAsLocalWrite(
  sync: SyncStore,
  apply: () => { ok: true } | { ok: false; message: string },
): LocalApplied {
  sync.db.exec("begin immediate");
  try {
    sync.record.begin();
    let outcome: { ok: true } | { ok: false; message: string };
    let effective: Uint8Array | null;
    try {
      outcome = apply();
    } finally {
      effective = sync.record.end();
    }
    if (!outcome.ok) {
      rollback(sync.db);
      return outcome;
    }
    const hlc = effective === null ? null : stamp(sync, effective);
    sync.db.exec("commit");
    return { ok: true, effective, hlc };
  } catch (error) {
    rollback(sync.db);
    throw error;
  }
}

/**
 * 이 기계가 낸 변경 가운데 horizon 밖이라 내보내지 않고 held로 둔 것을 사람의 apply로 내보내기에 돌려보낸다. 그 변경은 이미
 * 이 DB에 있어 다시 적용하지 않는다(다시 넣으면 있는 row와 부딪는다). 그 변경이 건드린 row·칸의 지금 값을 이 기계의 새
 * clock으로 찍고 그 changeset을 돌려준다: insert는 row 전부, update는 그 칸, delete는 아직 없는 row의 delete다. 그 사이
 * 사라졌거나 되살아난 row는 뒤의 변경이 맡으니 뺀다. 옛 clock 그대로 보내면 받는 쪽 horizon의 그물에 다시 걸린다.
 * data는 바뀌지 않는다. 표가 맞지 않으면 아무것도 찍지 않고 conflict다.
 */
export function releaseLocalChange(
  sync: SyncStore,
  changeset: Uint8Array,
): Result<{ changeset: Uint8Array | null; hlc: bigint | null }> {
  const read = readChangeset(changeset);
  if (!read.ok) return read;
  const db = sync.db;
  return inTransaction(db, () => {
    const pieces: Uint8Array[] = [];
    for (const change of read.value) {
      if (hiddenTable(change.table)) continue;
      const shape = tableShape(db, change.table);
      if (shape === null || shape.columns.length !== change.primaryKey.length) {
        return err({
          code: "conflict" as const,
          message: `the held change no longer fits the table ${change.table}`,
        });
      }
      const record = (change.op === "insert" ? change.new : change.old)!;
      const key = shape.primaryKey.map((pk, i) => (pk ? record[i] : undefined));
      const current = readRow(db, shape, key);
      const order = db
        .all(`pragma table_info(${ident(change.table)})`)
        .map((row) => Number(row["pk"]));
      if (change.op === "insert" && current !== null) {
        pieces.push(
          rowChangeset(change.table, order, {
            op: "insert",
            old: null,
            new: current,
          }),
        );
      } else if (change.op === "update" && current !== null) {
        const cells = change.new!.map((value, i) =>
          value !== undefined && !shape.primaryKey[i] ? current[i] : undefined,
        );
        if (cells.some((value) => value !== undefined)) {
          pieces.push(
            rowChangeset(change.table, order, {
              op: "update",
              old: key,
              new: cells,
            }),
          );
        }
      } else if (change.op === "delete" && current === null) {
        pieces.push(
          rowChangeset(change.table, order, {
            op: "delete",
            old: change.old,
            new: null,
          }),
        );
      }
    }
    if (pieces.length === 0) return ok({ changeset: null, hlc: null });
    const released = new Uint8Array(Buffer.concat(pieces));
    return ok({ changeset: released, hlc: stamp(sync, released) });
  });
}

/**
 * 앱 DB의 사본을 core가 준 절대 path에 쓴다(`VACUUM INTO`). 이미 file이 있으면 conflict다. 숨은 sync 표도 같이
 * 간다: 폰이 adoptSnapshot으로 node·cursor를 자기 것으로 바꾼다.
 */
export function writeSnapshot(
  db: SyncDb,
  path: string,
): Result<{ size: number; sha256: string }> {
  if (!isAbsolute(path)) {
    return err({
      code: "invalid_input",
      message: "snapshot path is not absolute",
    });
  }
  if (existsSync(path)) {
    return err({ code: "conflict", message: "snapshot file already exists" });
  }
  db.run("vacuum into ?", [path]);
  const bytes = readFileSync(path);
  return ok({
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

// 폴더 snapshot을 뜨는 동안 붙이는 schema 이름. 앱 표 이름과 겹치지 않게 lophn_으로 시작한다.
const SNAPSHOT_SCHEMA = "lophn_snapshot";

/**
 * 폴더로 갈 snapshot을 core가 준 절대 path에 쓴다. 옛 release(모든 표를 보내는 선언)는 `VACUUM INTO`로 DB 통째다. 그 밖에는
 * 새 DB file을 앱 연결에 ATTACH해 보내는 표(앱이 쓴 CREATE TABLE 그대로)와 그 표의 clock·kept 줄, sync 상태를 한
 * transaction으로 복사한다. 보내지 않는 표는 이 기계를 떠나지 않는다. 1 GiB 한도는 이 file이 잰다.
 */
export function writeFolderSnapshot(
  sync: SyncStore,
  path: string,
): Result<{ size: number; sha256: string }> {
  const sent = sentTables(sync.plan);
  if (sent === null) return writeSnapshot(sync.db, path);
  if (!isAbsolute(path)) {
    return err({
      code: "invalid_input",
      message: "snapshot path is not absolute",
    });
  }
  if (existsSync(path)) {
    return err({ code: "conflict", message: "snapshot file already exists" });
  }
  const db = sync.db;
  const tables = db
    .all("select name, sql from sqlite_master where type = 'table'")
    .map((row) => ({ name: String(row["name"]), sql: String(row["sql"]) }))
    .filter((table) => !hiddenTable(table.name) && sent(table.name));
  const into = (sql: string) =>
    sql.replace(/^CREATE TABLE /i, `CREATE TABLE ${SNAPSHOT_SCHEMA}.`);
  const names = tables.map((table) => table.name);
  const marks = names.map(() => "?").join(", ");
  // ATTACH는 transaction 밖에서만 된다. 복사하는 동안 foreign_keys를 끈다: 표를 아무 순서로나 채운다.
  db.run(`attach database ? as ${SNAPSHOT_SCHEMA}`, [path]);
  try {
    foreignKeysOff(db, () =>
      inTransaction(db, () => {
        for (const table of tables) {
          db.exec(into(table.sql));
          // 쓸 수 있는 칸만 옮긴다: 생성 칸(table_xinfo의 hidden 2·3)은 새 file이 자기 식으로 다시 만든다.
          const columns = db
            .all(`pragma main.table_xinfo(${ident(table.name)})`)
            .filter((column) => Number(column["hidden"]) === 0)
            .map((column) => ident(String(column["name"])))
            .join(", ");
          db.exec(
            `insert into ${SNAPSHOT_SCHEMA}.${ident(table.name)} (${columns}) select ${columns} from main.${ident(table.name)}`,
          );
        }
        db.exec(
          SYNC_TABLES_SQL.replaceAll(
            "create table if not exists lophn_",
            `create table if not exists ${SNAPSHOT_SCHEMA}.lophn_`,
          ),
        );
        for (const hidden of [
          "lophn_sync_row",
          "lophn_sync_col",
          "lophn_sync_kept",
        ]) {
          if (names.length === 0) break;
          db.run(
            `insert into ${SNAPSHOT_SCHEMA}.${hidden} select * from main.${hidden} where tbl in (${marks})`,
            names,
          );
        }
        db.exec(
          `insert into ${SNAPSHOT_SCHEMA}.lophn_sync_state select * from main.lophn_sync_state`,
        );
      }),
    );
  } catch (error) {
    // 반만 쓴 file은 남기지 않는다. 사본을 뜨지 못한 까닭은 내보내기의 오류로 보인다.
    db.exec(`detach database ${SNAPSHOT_SCHEMA}`);
    rmSync(path, { force: true });
    return err({
      code: "internal",
      message: `the folder snapshot could not be copied: ${errorMessage(error)}`,
    });
  }
  db.exec(`detach database ${SNAPSHOT_SCHEMA}`);
  const bytes = readFileSync(path);
  return ok({
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

export type SnapshotMerged = {
  effective: Uint8Array | null;
  deleted: number;
  held: HeldRow[];
};

/**
 * 다른 기계의 snapshot file(core가 풀어 둔 SQLite)을 읽기 전용으로 열어 한 transaction에서 row·칸 clock으로 합치고 실제로
 * 바뀐 것을 session으로 뜬다. 보내는 표만 합친다: 보내지 않는 표는 snapshot에 없고 그 표의 이 기계 row는 이 기계에만 있다.
 * 보내는 표 가운데 모양이 다른 것이 있으면 아무것도 쓰지 않고 conflict다. 정리된 흔적과 부딪을 수 있는 source
 * row는 적용하지 않고 `held`로 돌려준다. 그 합이 응답에 담기지 않을 만큼 크면 합치지 않는다(held를 잃는다).
 * `absentDeletes`의 keep pk는 `lophn_sync_row.pk` bytes다.
 */
export function mergeSnapshotFile(
  sync: SyncStore,
  input: {
    path: string;
    absentDeletes?: {
      below: bigint;
      keep: readonly { table: string; pk: Uint8Array }[];
    };
  },
): Result<SnapshotMerged> {
  if (!isAbsolute(input.path) || !existsSync(input.path)) {
    return err({
      code: "invalid_input",
      message: "snapshot path is not an absolute path to a file",
    });
  }
  const keyOf = (table: string, pk: Uint8Array) =>
    `${table}\0${Buffer.from(pk).toString("hex")}`;
  const absent = input.absentDeletes;
  const keep = new Set(absent?.keep.map((row) => keyOf(row.table, row.pk)));
  const source = new DatabaseSync(input.path, { readOnly: true });
  const db = sync.db;
  try {
    return foreignKeysOff(db, () => {
      db.exec("begin immediate");
      try {
        let merged: ReturnType<typeof mergeSnapshot>;
        let effective: Uint8Array | null;
        sync.record.begin();
        try {
          const tables = sentTables(sync.plan);
          merged = mergeSnapshot(db, nodeSyncDb(source), sync.clock, {
            ...(tables === null ? {} : { tables }),
            ...(absent === undefined
              ? {}
              : {
                  absentDeletes: {
                    below: absent.below,
                    keep: (table, pk) => keep.has(keyOf(table, pk)),
                  },
                }),
          });
        } finally {
          effective = sync.record.end();
        }
        if (!merged.ok) {
          rollback(db);
          return merged;
        }
        const held = merged.value.heldRows;
        if (
          held.reduce((sum, row) => sum + row.changeset.byteLength, 0) >
          MERGE_HELD_MAX_BYTES
        ) {
          rollback(db);
          return err({
            code: "conflict",
            message: "the snapshot has too many rows past the horizon to hold",
          });
        }
        db.exec("commit");
        return ok({ effective, deleted: merged.value.deleted, held });
      } catch (error) {
        rollback(db);
        throw error;
      }
    });
  } finally {
    source.close();
  }
}

/**
 * clock이 `before`보다 작은 흔적을 지운다(경계는 core가 정한다). 지운 row 수, 올라간 horizon, 이 DB가 내거나 본 가장 큰
 * clock을 돌려준다.
 */
export function cleanupTombstones(
  sync: SyncStore,
  before: bigint,
): { dropped: number; horizon: bigint | null; maxHlc: bigint } {
  return inTransaction(sync.db, () => {
    const dropped = dropTombstones(sync.db, before);
    const horizon = getState(sync.db, "horizon");
    return {
      dropped,
      horizon: horizon === null ? null : BigInt(horizon),
      maxHlc: maxHlc(sync.db),
    };
  });
}
