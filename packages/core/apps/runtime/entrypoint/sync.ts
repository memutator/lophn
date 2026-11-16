// sync 앱(선언 `runs_on`에 phone이 있거나 `sync_to`가 있음)의 컴퓨터 쪽 일. 앱과 같은 cap-store 연결에서 돈다:
// - 컴퓨터의 write는 data, changeset, clock 찍기를 한 transaction으로 commit한다(handler가 던져도 바뀐 것과 clock을 같이).
// - 폰이나 다른 기계에서 온 변경 묶음을 한 transaction에서 변경마다 칸 단위 last-write-wins로 적용하고 실제로 바뀐 것
//   (effective)을 session으로 뜬다.
// - 폰이 처음 받을 snapshot을 `VACUUM INTO`로 뜨고, 다른 기계의 snapshot을 row·칸 clock으로 합친다.
// - rewind 적용과 held 변경 다시 적용도 한 transaction 안에서 effective를 뜨고 새 clock을 찍는다.
// - core가 정한 clock보다 옛 흔적을 지운다.
// 모두 runtime의 `exclusive` 문 안에서 부른다. 같은 연결의 session이 겹치면 한 changeset에 섞이기 때문이다.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../../../base/result.ts";
import type { AppDeclaration } from "../../../../protocol/apps/declaration/mod.ts";
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
  type SyncDb,
} from "../../../../protocol/apps/sync/mod.ts";
import { MERGE_HELD_MAX_BYTES } from "./limits.ts";
import {
  type NodeDatabase,
  nodeSyncDb,
} from "../../../../protocol/apps/sync/node-db.ts";
import { ident } from "../../../../protocol/apps/sync/sql.ts";

/** 선언의 `runs_on`에 `"phone"`이 있으면 폰에도 도는 앱이다. 없으면 `["computer"]`와 같다. */
export function runsOnPhone(declaration: AppDeclaration): boolean {
  return declaration.runs_on?.includes("phone") ?? false;
}

/**
 * data를 다른 replica와 맞추는 앱인가: 폰에도 돌거나 폴더로 다른 기계에 보낸다(`sync_to`). 컴퓨터에서 sync 앱이다(clock
 * 표, sync log).
 */
export function syncsData(declaration: AppDeclaration): boolean {
  return runsOnPhone(declaration) || declaration.sync_to !== undefined;
}

// session 구간. runtime에서는 cap-store hook을 부르는 StoreAccess다. 바뀐 것이 없으면 null이다.
export type Recorder = { begin(): void; end(): Uint8Array | null };

export type SyncStore = {
  db: SyncDb;
  clock: Clock;
  record: Recorder;
  nowMs: () => number;
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
  const stamped = stampLocal(sync.db, changeset, hlc);
  if (!stamped.ok) throw new Error(stamped.error.message);
  return hlc;
}

// column clock은 칸 번호로 적힌다. migration이 칸을 지우거나 순서를 바꾸면 옛 clock이 다른 칸을 가리키므로, 칸
// 목록이 바뀐 표(와 없어진 표)의 column clock을 지운다. row clock은 남아 그 row들은 다음 고침까지 row 단위로
// 견준다. 폰은 release가 바뀔 때 이 DB의 snapshot을 받으니 같은 clock이 된다. live는 schema를 바꾸지 않으니
// activation이 migration을 돌린 뒤 새 release의 첫 시작이 이것을 한다.
export function forgetMovedColumns(db: SyncDb): void {
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
    .map((row) => String(row["name"]));
  for (const table of tables) {
    const columns = JSON.stringify(
      db
        .all(`pragma table_info(${ident(table)})`)
        .map((row) => String(row["name"])),
    );
    const before = recorded.get(table);
    recorded.delete(table);
    if (before === columns) continue;
    if (before !== undefined) {
      db.run("delete from lophn_sync_col where tbl = ?", [table]);
    }
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
 * sync 앱 process가 시작할 때 한 번. 숨은 표를 만들고(node는 처음 한 번만 적히고 다른 기계의 DB면 바뀐다), 칸이 바뀐 표의 column clock을
 * 지우고, 앱 시작(등록 code)이 DB를 바꿨으면 그 changeset을 찍는다. 시작 code는 transaction으로 감싸지 않아 그
 * 변경과 clock은 따로 commit된다. `startHlc`는 그 찍은 clock이다: ready 통보에 실어 core가 sync log에 남긴다.
 */
export function openSyncStore(input: {
  database: NodeDatabase;
  node: string;
  machine: string;
  record: Recorder;
  nowMs: () => number;
  startChangeset: Uint8Array | null;
}): SyncStore & { startHlc: bigint | null } {
  const db = nodeSyncDb(input.database);
  const sync: SyncStore = {
    db,
    clock: openClock(db),
    record: input.record,
    nowMs: input.nowMs,
  };
  const startHlc = inTransaction(db, () => {
    ensureSyncTables(db, input.node);
    claimNode(db, input.machine, input.node);
    forgetMovedColumns(db);
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

export type SnapshotMerged = {
  effective: Uint8Array | null;
  deleted: number;
  held: HeldRow[];
};

/**
 * 다른 기계의 snapshot file(core가 풀어 둔 SQLite)을 읽기 전용으로 열어 한 transaction에서 row·칸 clock으로 합치고 실제로
 * 바뀐 것을 session으로 뜬다. 모양이 다른 표가 있으면 아무것도 쓰지 않고 conflict다. 정리된 흔적과 부딪을 수 있는 source
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
          merged = mergeSnapshot(
            db,
            nodeSyncDb(source),
            sync.clock,
            absent === undefined
              ? {}
              : {
                  absentDeletes: {
                    below: absent.below,
                    keep: (table, pk) => keep.has(keyOf(table, pk)),
                  },
                },
          );
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
