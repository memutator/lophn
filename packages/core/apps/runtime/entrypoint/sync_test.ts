import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
// 앱 bundle이 싣는 cap-store처럼 전역 STORE_HOOKS를 설치한다. runtime은 그 hook으로 앱과 같은 연결을 쓴다.
import {
  closeConnection,
  openConnection,
} from "../../../../sdk/cap-store/connection.node.ts";
import {
  adoptSnapshot,
  dumpClocks,
  dumpData,
  openClock,
  readOutbox,
  reexpress,
  stampLocal,
  type SyncDb,
} from "../../../../protocol/apps/sync/mod.ts";
import { readChangeset } from "../../../../protocol/apps/sync/changeset.ts";
import { filterChangeset } from "../../../../base/mod.ts";
import {
  type SyncPlan,
  syncPlanOf,
  syncsData,
} from "../../../../protocol/apps/declaration/sync-plan.ts";
import { nodeSyncDb } from "../../../../protocol/apps/sync/node-db.ts";
import { createStoreAccess } from "./cap-host.ts";
import { handleCall } from "./invoke.ts";
import { BROKER_PATHS } from "./limits.ts";
import { initializeAppRuntime } from "./main.ts";
import { createRuntimeState } from "./state.ts";
import {
  applyRemoteChanges,
  mergeSnapshotFile,
  openSyncStore,
  type SyncStore,
  syncedWrite,
  writeFolderSnapshot,
  writeSnapshot,
} from "./sync.ts";
import { ensureAppToolPort } from "./tool-port.ts";

const ULID = "01j00000000000000000000000";
const APP = `app_${ULID}`;
const REL = `rel_${ULID}`;
const MACHINE = `mch_${ULID}`;
// 폰에서도 도는 앱: 모든 표에 clock을 단다.
const PHONE_APP = syncPlanOf({ runs_on: ["computer", "phone"] });

// 컴퓨터 app process의 앱 DB: cap-store가 연 연결 하나와 그 위의 sync store.
function computer(
  schema: string,
  now: { ms: number },
  plan: SyncPlan = PHONE_APP,
) {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-"));
  const file = join(dir, "app.sqlite");
  const raw = openConnection(file);
  raw.exec(schema);
  const store = createStoreAccess();
  const open = (next: SyncPlan = plan) =>
    openSyncStore({
      database: store.database() as DatabaseSync,
      node: "computer",
      machine: MACHINE,
      record: store,
      nowMs: () => now.ms,
      startChangeset: null,
      plan: next,
    });
  return { dir, file, raw, store, sync: open(), reopen: open };
}

async function write(sync: SyncStore, raw: DatabaseSync, sql: string) {
  const done = await syncedWrite(sync, () => Promise.resolve(raw.exec(sql)));
  assert.ok(done.ok);
  return done.value;
}

// 폰 사본: 컴퓨터 snapshot을 받은 DB. host처럼 foreign_keys를 끄고 쓴다.
function phoneFrom(sync: SyncStore, path: string): SyncDb {
  assert.ok(writeSnapshot(sync.db, path).ok);
  const raw = new DatabaseSync(path);
  raw.exec("pragma foreign_keys = off");
  const db = nodeSyncDb(raw);
  adoptSnapshot(db, { node: "phone", cursor: "0", release: REL });
  return db;
}

// 폰의 write 하나: session으로 뜬 changeset을 폰 clock으로 찍는다.
function phoneWrite(db: SyncDb, at: number, sql: string) {
  db.exec("begin immediate");
  const session = db.session();
  db.exec(sql);
  const changeset = session.changeset();
  session.close();
  const hlc = openClock(db).next(at);
  assert.ok(stampLocal(db, changeset, hlc).ok);
  db.exec("commit");
  return { hlc, changeset };
}

function readOnly(file: string) {
  return new DatabaseSync(file, { readOnly: true });
}

// 지우면 handler가 던진 write의 변경이 clock 없이 남거나(폰 값이 그 변경을 덮는다), 끊긴 호출의 clock만 남는다.
test("sync 앱의 write는 data와 그 clock이 늘 같이 commit된다: handler가 던진 호출도 바뀐 것과 clock이 같이 남고, commit 전에 끊긴 호출은 data도 clock도 남지 않는다", async () => {
  const { file, raw, store, sync } = computer(
    "create table item (id text primary key, title text)",
    { ms: 1000 },
  );
  const state = createRuntimeState({
    identity: {
      app: APP,
      release: REL,
      bundleHash: "hash",
      mode: "live",
      processNonce: "nonce",
    },
    declaration: {
      operations: [
        { name: "add_then_throw", effect: "write" },
        { name: "add_then_hang", effect: "write" },
      ],
      commands: [],
    } as never,
    broker: {} as never,
    store,
    dataSchema: 1,
    controlSocket: "socket",
  });
  state.accepting = true;
  state.sync = sync;
  const port = ensureAppToolPort();
  port.register({
    name: "add_then_throw",
    handle: () => {
      raw.exec("insert into item values ('a', 'milk')");
      throw new Error("boom");
    },
  });
  let reached!: () => void;
  const hanging = new Promise<void>((resolve) => (reached = resolve));
  port.register({
    name: "add_then_hang",
    handle: () => {
      raw.exec("insert into item values ('b', 'eggs')");
      reached();
      return new Promise(() => {});
    },
  });
  const call = (name: string) =>
    handleCall(
      state,
      new TextEncoder().encode(
        JSON.stringify({
          invocation: `inv_${ULID}`,
          kind: "operation",
          name,
          context: {
            app: APP,
            release: REL,
            mode: "live",
            effect: "write",
            caller: null,
          },
        }),
      ),
    );

  const thrown = (await call("add_then_throw")).body as {
    status: string;
    changeset: string | null;
    hlc?: string;
  };
  assert.equal(thrown.status, "error");
  assert.ok(thrown.changeset !== null && thrown.hlc !== undefined);
  const after = readOnly(file);
  assert.deepEqual(
    after
      .prepare("select id from item")
      .all()
      .map((row) => row["id"]),
    ["a"],
  );
  assert.deepEqual(
    after
      .prepare("select tbl, cast(hlc as text) as hlc from lophn_sync_row")
      .all()
      .map((row) => ({ ...row })),
    [{ tbl: "item", hlc: thrown.hlc }],
  );
  after.close();

  void call("add_then_hang");
  await hanging;
  // 프로세스가 commit 전에 죽는다: 연결이 닫히며 열린 transaction이 사라진다.
  closeConnection(file);
  store.end();
  const crashed = readOnly(file);
  assert.deepEqual(
    crashed
      .prepare("select id from item")
      .all()
      .map((row) => row["id"]),
    ["a"],
  );
  assert.equal(
    crashed.prepare("select count(*) as n from lophn_sync_row").get()!["n"],
    1,
  );
  crashed.close();
});

// 지우면 폰의 옛 값이 컴퓨터의 새 값을 덮거나, 그 덮지 않은 값이 effective로 Activity·rewind에 실린다.
test("apps.sync_apply의 effective changeset은 실제로 바뀐 column만 담는다: 컴퓨터가 더 새 clock으로 쓴 column은 폰의 값으로 덮이지 않고 effective에도 없다", async () => {
  const now = { ms: 1000 };
  const { dir, file, raw, sync } = computer(
    "create table item (id text primary key, title text, done integer, code text unique)",
    now,
  );
  await write(
    sync,
    raw,
    "insert into item values ('a', 'milk', 0, 'x'); insert into item values ('b', 'eggs', 0, 'z')",
  );
  const phone = phoneFrom(sync, join(dir, "phone.sqlite"));

  const edit = phoneWrite(
    phone,
    2000,
    "update item set title = 'milk P', done = 1 where id = 'a'",
  );
  now.ms = 3000;
  await write(sync, raw, "update item set title = 'milk C' where id = 'a'");

  const applied = applyRemoteChanges(sync, [edit]);
  assert.ok(applied.ok && applied.value[0]!.status === "applied");
  const effective = readChangeset(applied.value[0]!.effective!);
  assert.ok(effective.ok);
  assert.deepEqual(
    effective.value.map((change) => [change.op, change.new]),
    [["update", [undefined, undefined, BigInt(1), undefined]]],
  );
  assert.deepEqual(
    { ...raw.prepare("select title, done from item where id = 'a'").get() },
    { title: "milk C", done: 1 },
  );

  // 제약에 걸린 변경은 그 하나만 건너뛰고 다음 변경은 적용된다.
  const clash = phoneWrite(
    phone,
    4000,
    "update item set code = 'y' where id = 'a'",
  );
  const next = phoneWrite(
    phone,
    4001,
    "update item set done = 2 where id = 'b'",
  );
  now.ms = 5000;
  await write(sync, raw, "update item set code = 'y' where id = 'b'");
  const applied2 = applyRemoteChanges(sync, [clash, next]);
  assert.ok(applied2.ok);
  assert.deepEqual(
    applied2.value.map((result) => result.status),
    ["skipped", "applied"],
  );
  assert.deepEqual(
    raw
      .prepare("select id, code, done from item order by id")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "a", code: "x", done: 1 },
      { id: "b", code: "y", done: 2 },
    ],
  );
  closeConnection(file);
});

// 지우면 migration이 칸을 지운 뒤 옛 column clock이 옆 칸을 가리켜, 폰의 정당한 고침이 두 사본 모두에서 버려진다.
test("column을 지운 migration 뒤 두 사본이 같은 줄을 고쳐도 같아진다", async () => {
  const now = { ms: 1000 };
  const { dir, file, raw, reopen, sync } = computer(
    "create table item (id text primary key, legacy text, title text, note text)",
    now,
  );
  await write(sync, raw, "insert into item values ('a', 'l', 'milk', 'n')");
  const phoneFile = join(dir, "phone.sqlite");
  const phone = phoneFrom(sync, phoneFile);

  // 폰이 note를 고쳤지만 아직 보내지 못했다(찍힌 outbox 줄).
  const pending = phoneWrite(
    phone,
    2000,
    "update item set note = 'n P' where id = 'a'",
  );
  phone.run(
    `insert into lophn_sync_outbox (id, operation, started_at, changeset, hlc) values ('chg_1', 'edit', '2026-11-15T00:00:00Z', ?, ${pending.hlc})`,
    [pending.changeset],
  );
  // 컴퓨터가 더 늦게 title(옛 칸 번호 2)을 고친다.
  now.ms = 5000;
  await write(sync, raw, "update item set title = 'milk C' where id = 'a'");

  // 새 release: activation이 legacy를 지우는 migration을 돌리고 process가 다시 뜬다. note가 칸 2가 된다.
  const migration = "alter table item drop column legacy";
  raw.exec(migration);
  const restarted = reopen();

  // 폰: 자기 사본을 local migrate하고, 새 snapshot 위에 안 보낸 변경을 칸 이름으로 다시 쓴 뒤 보낸다.
  const migratedRaw = new DatabaseSync(":memory:");
  migratedRaw.deserialize(new DatabaseSync(phoneFile).serialize());
  migratedRaw.exec(migration);
  const fresh = phoneFrom(restarted, join(dir, "phone-2.sqlite"));
  const carried = reexpress({
    old: phone,
    migrated: nodeSyncDb(migratedRaw),
    snapshot: fresh,
  });
  assert.ok(carried.ok);
  for (const row of readOutbox(fresh)) {
    const pushed = applyRemoteChanges(restarted, [
      { hlc: row.hlc!, changeset: row.changeset },
    ]);
    assert.ok(pushed.ok && pushed.value[0]!.status === "applied");
  }

  const computerDump = dumpData(restarted.db);
  assert.equal(computerDump, dumpData(fresh));
  assert.equal(computerDump, "# item\n'a'|'milk C'|'n P'");
  closeConnection(file);
});

// 지우면 늦게 올라온 기계가 옛 release에서 한 칸 고침의 clock을 migration이 지워, 먼저 올라간 기계에 그 기계의 snapshot을
// 합쳐도 row clock끼리 비겨 고침이 사라진다.
test("옛 release에서 한 칸 고침은 칸 하나를 더한 migration 뒤에도 그 칸의 clock을 지켜, 먼저 올라간 기계에 그 기계의 새 snapshot을 합치면 그 고침이 남는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-moved-"));
  const now = { ms: 1000 };
  const silent = { begin() {}, end: () => null };
  const open = (raw: DatabaseSync, machine: string) =>
    openSyncStore({
      database: raw,
      node: machine,
      machine,
      record: silent,
      nowMs: () => now.ms,
      startChangeset: null,
      // 기계 사이 snapshot은 보내는 표만 합친다.
      plan: syncPlanOf({ sync: { item: "computers" } }),
    });
  const local = (sync: SyncStore, at: number, sql: string) => {
    sync.db.exec("begin immediate");
    const session = sync.db.session();
    sync.db.exec(sql);
    const changeset = session.changeset();
    session.close();
    assert.ok(stampLocal(sync.db, changeset, sync.clock.next(at)).ok);
    sync.db.exec("commit");
  };
  // 새 칸 tag를 title 앞에 넣는다: title과 note의 칸 번호가 하나씩 밀린다.
  const migration = [
    "create table item_new (id text primary key, tag text, title text, note text)",
    "insert into item_new (id, title, note) select id, title, note from item",
    "drop table item",
    "alter table item_new rename to item",
  ].join(";");

  const rawA = new DatabaseSync(":memory:");
  rawA.exec("create table item (id text primary key, title text, note text)");
  const a = open(rawA, "mch_a");
  local(a, 1000, "insert into item values ('x', 'milk', 'n')");
  const rawB = new DatabaseSync(":memory:");
  rawB.deserialize(rawA.serialize());
  let b = open(rawB, "mch_b");

  // A가 먼저 새 release가 되어 title을 고친다. B는 옛 release에서 note를 고친다.
  rawA.exec(migration);
  const a2 = open(rawA, "mch_a");
  local(a2, 3000, "update item set title = 'milk A' where id = 'x'");
  local(b, 2000, "update item set note = 'n B' where id = 'x'");
  // B가 올라오고 첫 시작 뒤 snapshot을 낸다.
  rawB.exec(migration);
  b = open(rawB, "mch_b");
  const path = join(dir, "b.sqlite");
  assert.ok(writeSnapshot(b.db, path).ok);

  const merged = mergeSnapshotFile(a2, { path });
  assert.ok(merged.ok);
  assert.equal(dumpData(a2.db), "# item\n'x'|NULL|'milk A'|'n B'");
});

// 지우면 복제한 data root의 두 기계가 같은 node로 clock을 찍어 서로의 변경을 같은 replica의 것으로 보고 건너뛴다.
test("sync DB의 machine이 다르면 node가 새것이 되고, machine이 없으면 지금 id를 적고 node를 지킨다: 둘 다 data와 clock 표는 그대로다", async () => {
  const now = { ms: 1000 };
  const { file, raw, sync, store } = computer(
    "create table item (id text primary key, title text)",
    now,
  );
  await write(sync, raw, "insert into item values ('a', 'milk')");
  const state = () => {
    const db = readOnly(file);
    const read = (sql: string) =>
      db
        .prepare(sql)
        .all()
        .map((row) => ({ ...row }));
    const snapshot = {
      sync: Object.fromEntries(
        read("select key, value from lophn_sync_state")
          .filter((row) =>
            ["node", "machine", "hlc"].includes(String(row["key"])),
          )
          .map((row) => [row["key"], row["value"]]),
      ),
      data: read("select * from item"),
      rows: read("select tbl, cast(hlc as text) as hlc from lophn_sync_row"),
    };
    db.close();
    return snapshot;
  };
  const reopen = (machine: string, node: string) =>
    openSyncStore({
      database: store.database() as DatabaseSync,
      node,
      machine,
      record: store,
      nowMs: () => now.ms,
      startChangeset: null,
      plan: PHONE_APP,
    });

  // 같은 기계가 다시 열면 그대로다.
  const first = state();
  assert.equal(first.sync["machine"], MACHINE);
  reopen(MACHINE, "nod_other");
  assert.deepEqual(state(), first);

  // 이 판 전에 만든 DB: machine 표지가 없다. node를 지키고 지금 id를 적는다.
  raw.exec("delete from lophn_sync_state where key = 'machine'");
  reopen(MACHINE, "nod_other");
  assert.deepEqual(state(), first);

  // 다른 기계에서 온 DB: node만 새것이 되고 clock과 data는 그대로다.
  const other = `mch_${"1".repeat(26)}`;
  reopen(other, "nod_fresh");
  const moved = state();
  assert.deepEqual(moved.sync, {
    ...first.sync,
    node: "nod_fresh",
    machine: other,
  });
  assert.deepEqual(moved.data, first.data);
  assert.deepEqual(moved.rows, first.rows);
  closeConnection(file);
});

// 지우면 file 하나를 적용하다 앱 process가 죽었을 때 앞 변경만 남아 사람의 data가 반쯤 바뀌고, 그 file을 다시 읽어도 맞지 않는다.
test("변경 묶음을 적용하는 도중 앱 process가 죽으면 DB는 data도 clock도 묶음 앞과 같다", async () => {
  const now = { ms: 1000 };
  const { dir, file, raw, sync } = computer(
    "create table item (id text primary key, title text)",
    now,
  );
  await write(sync, raw, "insert into item values ('a', 'milk')");
  const other = phoneFrom(sync, join(dir, "other.sqlite"));
  const batch = [
    phoneWrite(other, 2000, "update item set title = 'milk 2' where id = 'a'"),
    phoneWrite(other, 2001, "insert into item values ('b', 'eggs')"),
    phoneWrite(other, 2002, "insert into item values ('c', 'tea')"),
  ];
  const dump = () => {
    const db = nodeSyncDb(readOnly(file));
    return `${dumpData(db)}\n${dumpClocks(db)}`;
  };
  const before = dump();
  // 둘째 변경을 쓰는 중에 연결이 닫힌다: 열린 transaction이 commit되지 않은 채 사라진다.
  let runs = 0;
  const dying: SyncDb = {
    ...sync.db,
    run(sql, params) {
      runs += 1;
      if (runs === 8) {
        closeConnection(file);
        throw new Error("killed");
      }
      sync.db.run(sql, params);
    },
  };
  assert.throws(() =>
    applyRemoteChanges({ ...sync, db: dying, clock: openClock(dying) }, batch),
  );
  assert.ok(runs >= 8);
  assert.equal(dump(), before);
});

// 앱 process 없이 연 컴퓨터 sync DB 하나. 앱의 write는 연결 전체에 건 session으로 뜬다.
function machineDb(
  path: string,
  schema: string,
  plan: SyncPlan,
  now = { ms: 1000 },
) {
  const raw = new DatabaseSync(path);
  raw.exec(schema);
  let session: ReturnType<DatabaseSync["createSession"]> | null = null;
  const sync = openSyncStore({
    database: raw,
    node: path,
    machine: MACHINE,
    record: {
      begin() {
        session = raw.createSession();
      },
      end() {
        const changeset = session!.changeset();
        session!.close();
        session = null;
        return changeset.length > 0 ? changeset : null;
      },
    },
    nowMs: () => now.ms,
    startChangeset: null,
    plan,
  });
  return { raw, sync };
}

const rowsOf = (db: DatabaseSync, sql: string) =>
  db
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }));

// 지우면 sync에 적은 표만 내보내는 앱의 write가 clock 없이 남아 폴더로 나가지 못하거나, 옛 release(`sync_to`)의 앱이 말없이
// clock을 찍지 않아 다시 맞출 때 그 사이 고친 것이 다른 기계의 옛 값에 덮이거나, 폴더 snapshot에 보내지 않는 표가 실려 나간다.
test("sync가 표를 적은 앱은 컴퓨터에서 sync 앱이라 write가 그 표에만 clock을 달고 폴더 snapshot은 그 표만 담으며, 옛 release의 sync_to는 모든 표를 그렇게 한다", async () => {
  const schema =
    "create table item (id text primary key, title text); create table cache (id text primary key, body text)";
  const declaration = {
    runs_on: ["computer"],
    sync: { item: "personal" },
    operations: [{ name: "add", effect: "write" }],
    commands: [],
  } as never;
  const plan = syncPlanOf(declaration);
  assert.equal(syncsData(plan), true);
  assert.equal(plan.phone, false);
  assert.equal(syncsData(syncPlanOf({ runs_on: ["computer"] })), false);

  const { dir, file, raw, store, sync } = computer(schema, { ms: 1000 }, plan);
  const state = createRuntimeState({
    identity: {
      app: APP,
      release: REL,
      bundleHash: "hash",
      mode: "live",
      processNonce: "nonce",
    },
    declaration,
    broker: {} as never,
    store,
    dataSchema: 1,
    controlSocket: "socket",
  });
  state.accepting = true;
  state.sync = sync;
  ensureAppToolPort().register({
    name: "add",
    handle: () => {
      raw.exec("insert into item values ('a', 'milk')");
      raw.exec("insert into cache values ('c', 'local only')");
      return null;
    },
  });
  const done = await handleCall(
    state,
    new TextEncoder().encode(
      JSON.stringify({
        invocation: `inv_${ULID}`,
        kind: "operation",
        name: "add",
        context: {
          app: APP,
          release: REL,
          mode: "live",
          effect: "write",
          caller: null,
        },
      }),
    ),
  );
  const body = done.body as {
    status: string;
    changeset: string | null;
    hlc?: string;
  };
  assert.equal(body.status, "ok");
  assert.ok(body.changeset !== null && body.hlc !== undefined);
  assert.deepEqual(rowsOf(raw, "select distinct tbl from lophn_sync_row"), [
    { tbl: "item" },
  ]);
  const snapshotPath = join(dir, "folder.sqlite");
  assert.ok(writeFolderSnapshot(sync, snapshotPath).ok);
  const snapshot = readOnly(snapshotPath);
  assert.deepEqual(
    rowsOf(
      snapshot,
      "select name from sqlite_master where type = 'table' and name not glob 'lophn_*' order by name",
    ),
    [{ name: "item" }],
  );
  assert.deepEqual(rowsOf(snapshot, "select * from item"), [
    { id: "a", title: "milk" },
  ]);
  assert.deepEqual(
    rowsOf(snapshot, "select distinct tbl from lophn_sync_row"),
    [{ tbl: "item" }],
  );
  snapshot.close();
  closeConnection(file);

  // 옛 release: 봉인한 선언의 sync_to는 모든 표를 그 destination으로 보낸다(지금까지와 같다).
  const legacy = syncPlanOf({ sync_to: "personal" });
  assert.deepEqual(
    { destination: legacy.destination, tables: legacy.tables },
    { destination: "personal", tables: null },
  );
  const old = machineDb(join(dir, "legacy.sqlite"), schema, legacy);
  const written = await syncedWrite(old.sync, () =>
    Promise.resolve(
      old.raw.exec(
        "insert into item values ('a', 'milk'); insert into cache values ('c', 'x')",
      ),
    ),
  );
  assert.ok(written.ok && written.value.hlc !== null);
  assert.deepEqual(
    rowsOf(old.raw, "select distinct tbl from lophn_sync_row order by tbl"),
    [{ tbl: "cache" }, { tbl: "item" }],
  );
  const full = join(dir, "legacy-folder.sqlite");
  assert.ok(writeFolderSnapshot(old.sync, full).ok);
  const fullDb = readOnly(full);
  assert.deepEqual(rowsOf(fullDb, "select * from cache"), [
    { id: "c", body: "x" },
  ]);
  fullDb.close();
  old.raw.close();
});

// 지우면 폴더로 가는 changeset에 보내지 않는 표를 빼는 일이 bytes를 깨뜨려, 받는 기계가 그 변경을 적용하지 못하거나 다른 값을
// 적용한다.
test("filterChangeset을 거친 changeset은 남긴 표의 변경을 그대로 담아 SQLite와 칸 단위 적용 모두에서 그대로 적용된다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-filter-"));
  const schema =
    "create table item (id text primary key, title text, n integer); create table cache (id text primary key, body blob)";
  const plan = syncPlanOf({ sync: { item: "computers" } });
  const a = machineDb(join(dir, "a.sqlite"), schema, plan);
  a.raw.exec(
    "insert into item values ('old', 'x', 1); insert into cache values ('k0', x'00')",
  );
  const written = await syncedWrite(a.sync, () =>
    Promise.resolve(
      a.raw.exec(
        [
          "insert into cache values ('k1', x'0102')",
          "insert into item values ('a', 'milk', 2)",
          "update item set title = 'y' where id = 'old'",
          "delete from cache where id = 'k0'",
          "insert into item values ('b', 'bread', null)",
        ].join(";"),
      ),
    ),
  );
  assert.ok(written.ok && written.value.changeset !== null);
  const whole = written.value.changeset;
  const filtered = filterChangeset(whole, (table) => table === "item");
  assert.ok(filtered.ok);
  const original = readChangeset(whole);
  const kept = readChangeset(filtered.value);
  assert.ok(original.ok && kept.ok);
  assert.deepEqual(
    kept.value,
    original.value.filter((change) => change.table === "item"),
  );
  assert.ok(kept.value.length === 3);

  // SQLite가 bytes 그대로 받는다.
  const copy = new DatabaseSync(":memory:");
  copy.exec(schema);
  copy.exec("insert into item values ('old', 'x', 1)");
  assert.equal(copy.applyChangeset(filtered.value), true);
  assert.deepEqual(rowsOf(copy, "select * from item order by id"), [
    { id: "a", title: "milk", n: 2 },
    { id: "b", title: "bread", n: null },
    { id: "old", title: "y", n: 1 },
  ]);
  assert.deepEqual(rowsOf(copy, "select * from cache"), []);

  // 다른 기계의 칸 단위 적용도 그대로다.
  const b = machineDb(join(dir, "b.sqlite"), schema, plan);
  b.raw.exec("insert into item values ('old', 'x', 1)");
  const applied = applyRemoteChanges(b.sync, [
    { hlc: written.value.hlc!, changeset: filtered.value },
  ]);
  assert.ok(applied.ok && applied.value[0]!.status === "applied");
  assert.deepEqual(
    rowsOf(b.raw, "select * from item order by id"),
    rowsOf(copy, "select * from item order by id"),
  );
  assert.deepEqual(rowsOf(b.raw, "select * from cache"), []);
  a.raw.close();
  b.raw.close();
});

// 지우면 보내지 않는 표가 없는 다른 기계의 snapshot을 합칠 때 그 표의 이 기계 row를 "없으니 지워진 것"으로 지우거나, 모양이
// 다르다며 합치기가 영영 멈춘다.
test("보내지 않는 표가 없는 snapshot을 합쳐도 이 기계에만 있는 표의 row는 그대로 남는다(없는 row 지우기를 걸어도)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-local-"));
  const schema =
    "create table item (id text primary key, title text); create table cache (id text primary key, body text)";
  const plan = syncPlanOf({ sync: { item: "computers" } });
  const a = machineDb(join(dir, "a.sqlite"), schema, plan);
  const fromA = await syncedWrite(a.sync, () =>
    Promise.resolve(
      a.raw.exec(
        "insert into item values ('a', 'milk'); insert into cache values ('ca', 'A only')",
      ),
    ),
  );
  assert.ok(fromA.ok);
  const path = join(dir, "a-folder.sqlite");
  assert.ok(writeFolderSnapshot(a.sync, path).ok);

  const b = machineDb(join(dir, "b.sqlite"), schema, plan, { ms: 5000 });
  const mine = await syncedWrite(b.sync, () =>
    Promise.resolve(
      b.raw.exec(
        "insert into cache values ('cb', 'B only'); insert into item values ('b', 'bread')",
      ),
    ),
  );
  assert.ok(mine.ok);
  const merged = mergeSnapshotFile(b.sync, {
    path,
    absentDeletes: { below: BigInt(2) ** BigInt(62), keep: [] },
  });
  assert.ok(merged.ok, JSON.stringify(merged));
  assert.deepEqual(rowsOf(b.raw, "select * from cache"), [
    { id: "cb", body: "B only" },
  ]);
  // 보내는 표는 합쳐진다(없는 row 지우기는 그 표에만 걸린다).
  assert.deepEqual(rowsOf(b.raw, "select * from item order by id"), [
    { id: "a", title: "milk" },
  ]);
  a.raw.close();
  b.raw.close();
});

// 지우면 sync에서 뺀 표의 옛 clock이 남아, 그 표를 다시 보낼 때 그 사이 이 기계에서 다시 넣은 row를 옛 흔적이 지우거나 다른
// 기계의 옛 값이 이 기계의 고침을 덮는다.
test("선언의 sync에서 빠진 표의 row·칸 clock과 kept는 앱 process가 뜰 때 지워지고 남은 표의 clock은 그대로다", async () => {
  const now = { ms: 1000 };
  const two = syncPlanOf({ sync: { item: "computers", note: "computers" } });
  const { file, raw, sync, reopen } = computer(
    "create table item (id text primary key, title text); create table note (id text primary key, body text, tag text)",
    now,
    two,
  );
  await write(
    sync,
    raw,
    "insert into item values ('a', 'milk'); insert into note values ('n1', 'x', 't'); insert into note values ('n2', 'y', 't')",
  );
  now.ms = 2000;
  await write(sync, raw, "update note set body = 'x2' where id = 'n1'");
  await write(sync, raw, "delete from note where id = 'n2'");
  sync.db.run(
    "insert into lophn_sync_kept (tbl, pk, col, hlc, value) values ('note', x'00', 'body', 1, 'kept')",
  );
  const count = (table: string) =>
    rowsOf(
      raw,
      `select tbl, count(*) as n from ${table} group by tbl order by tbl`,
    );
  assert.deepEqual(count("lophn_sync_row"), [
    { tbl: "item", n: 1 },
    { tbl: "note", n: 2 },
  ]);
  assert.deepEqual(count("lophn_sync_col"), [{ tbl: "note", n: 1 }]);
  const itemClock = rowsOf(
    raw,
    "select * from lophn_sync_row where tbl = 'item'",
  );

  reopen(syncPlanOf({ sync: { item: "computers" } }));
  assert.deepEqual(count("lophn_sync_row"), [{ tbl: "item", n: 1 }]);
  assert.deepEqual(count("lophn_sync_col"), []);
  assert.deepEqual(count("lophn_sync_kept"), []);
  assert.deepEqual(count("lophn_sync_columns"), [{ tbl: "item", n: 1 }]);
  assert.deepEqual(
    rowsOf(raw, "select * from lophn_sync_row where tbl = 'item'"),
    itemClock,
  );
  // data는 그대로다.
  assert.deepEqual(rowsOf(raw, "select * from note"), [
    { id: "n1", body: "x2", tag: "t" },
  ]);
  closeConnection(file);
});

// 지우면 main.ts의 sync store 시작 경로(예: IdSource node prefix 규칙이나 ready 통보의 시작 changeset·HLC)가 깨져도 check가 놓친다.
test("컴퓨터 sync 앱 시작 경로(initializeAppRuntime)가 실제 IdSource로 node id를 만들고 시작 write의 HLC와 changeset을 ready로 보내며, preview에서는 sync store를 열지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-startup-"));
  const dataPath = join(dir, "app.sqlite");
  const appModule = pathToFileURL(join(dir, "main.js")).href;
  const clock = manualClock(Date.parse("2026-11-18T00:00:00.000Z"));
  const ids = createIdSource({ clock, random: seededRandom(19) });
  const declaration = {
    runs_on: ["computer", "phone"],
    operations: [{ name: "add_startup", effect: "write" }],
    commands: [],
  } as never;
  const readyCalls: { path: string; body: Record<string, unknown> }[] = [];
  const broker = async (req: {
    path: string;
    credential: string;
    body: unknown;
  }) => {
    readyCalls.push({
      path: req.path,
      body: req.body as Record<string, unknown>,
    });
    return { status: 200, body: { ok: true } };
  };
  const startLine = (mode: "live" | "preview") =>
    JSON.stringify({
      app: APP,
      release: mode === "live" ? REL : null,
      bundle_hash: "a".repeat(64),
      mode,
      process_nonce: "nonce-1",
      broker_socket: join(dir, "broker.sock"),
      control_socket: join(dir, "control.sock"),
      data_path: dataPath,
      broker_credential: "cred-1",
      machine: MACHINE,
    });

  // activation migration처럼 앱 시작 전에 schema가 이미 있다.
  const migrated = new DatabaseSync(dataPath);
  migrated.exec("create table item (id text primary key, title text)");
  migrated.close();

  const live = await initializeAppRuntime({
    line: startLine("live"),
    appModule,
    declaration,
    broker,
    dataSchema: 1,
    clock,
    ids,
    importModule: async () => {
      const db = openConnection(dataPath);
      db.exec("insert into item values ('boot', 'seeded')");
      ensureAppToolPort().register({
        name: "add_startup",
        handle: () => {
          db.exec("insert into item values ('a', 'milk')");
          return null;
        },
      });
    },
  });

  try {
    assert.ok(live.started.state.sync !== null);
    assert.ok(live.startChangeset !== null);
    assert.ok(live.startHlc !== null);
    assert.equal(readyCalls.length, 1);
    assert.equal(readyCalls[0]!.path, BROKER_PATHS.ready);
    assert.equal(readyCalls[0]!.body["start_hlc"], String(live.startHlc));
    assert.equal(typeof readyCalls[0]!.body["start_changeset"], "string");

    const check = readOnly(dataPath);
    try {
      const syncState = Object.fromEntries(
        check
          .prepare("select key, value from lophn_sync_state")
          .all()
          .map((row) => [String(row["key"]), String(row["value"])]),
      );
      assert.match(syncState["node"] ?? "", /^nod_[0-9a-hjkmnp-tv-z]{26}$/);
      assert.equal(syncState["machine"], MACHINE);
    } finally {
      check.close();
    }

    live.started.state.accepting = true;
    const call = await handleCall(
      live.started.state,
      new TextEncoder().encode(
        JSON.stringify({
          invocation: `inv_${ULID}`,
          kind: "operation",
          name: "add_startup",
          context: {
            app: APP,
            release: REL,
            mode: "live",
            effect: "write",
            caller: null,
          },
        }),
      ),
    );
    const body = call.body as {
      status: string;
      changeset: string | null;
      hlc?: string;
    };
    assert.equal(body.status, "ok");
    assert.ok(body.changeset !== null && body.hlc !== undefined);
  } finally {
    closeConnection(dataPath);
  }

  // preview 모드에서는 sync store를 열지 않는다.
  const previewPath = join(dir, "preview.sqlite");
  const preview = await initializeAppRuntime({
    line: JSON.stringify({
      app: APP,
      release: null,
      bundle_hash: "a".repeat(64),
      mode: "preview",
      process_nonce: "nonce-2",
      broker_socket: join(dir, "broker.sock"),
      control_socket: join(dir, "control2.sock"),
      data_path: previewPath,
      broker_credential: "cred-2",
      machine: MACHINE,
    }),
    appModule,
    declaration,
    broker,
    dataSchema: 1,
    clock,
    ids,
    importModule: async () => {
      const db = openConnection(previewPath);
      db.exec("create table item (id text primary key, title text)");
    },
  });
  try {
    assert.equal(preview.started.state.sync, null);
  } finally {
    closeConnection(previewPath);
  }
});
