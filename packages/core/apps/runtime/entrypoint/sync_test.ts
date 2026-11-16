import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
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
import { nodeSyncDb } from "../../../../protocol/apps/sync/node-db.ts";
import { createStoreAccess } from "./cap-host.ts";
import { handleCall } from "./invoke.ts";
import { createRuntimeState } from "./state.ts";
import {
  applyRemoteChanges,
  mergeSnapshotFile,
  openSyncStore,
  runsOnPhone,
  type SyncStore,
  syncedWrite,
  syncsData,
  writeSnapshot,
} from "./sync.ts";
import { ensureAppToolPort } from "./tool-port.ts";

const ULID = "01j00000000000000000000000";
const APP = `app_${ULID}`;
const REL = `rel_${ULID}`;
const MACHINE = `mch_${ULID}`;

// 컴퓨터 app process의 앱 DB: cap-store가 연 연결 하나와 그 위의 sync store.
function computer(schema: string, now: { ms: number }) {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-"));
  const file = join(dir, "app.sqlite");
  const raw = openConnection(file);
  raw.exec(schema);
  const store = createStoreAccess();
  const open = () =>
    openSyncStore({
      database: store.database() as DatabaseSync,
      node: "computer",
      machine: MACHINE,
      record: store,
      nowMs: () => now.ms,
      startChangeset: null,
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

// 지우면 sync_to만 있는 앱의 컴퓨터 write가 clock 없이 남아 폴더로 나가지 못하거나, 폰 route가 폰에 없는 앱을 받는다.
test("runs_on이 computer뿐이고 sync_to가 있는 앱도 컴퓨터에서 sync 앱이라 write가 clock을 싣고, 폰 route의 검사는 그 앱을 받지 않는다", async () => {
  const declaration = {
    runs_on: ["computer"],
    sync_to: "personal",
    operations: [{ name: "add", effect: "write" }],
    commands: [],
  } as never;
  assert.equal(syncsData(declaration), true);
  assert.equal(runsOnPhone(declaration), false);
  assert.equal(syncsData({ runs_on: ["computer"] } as never), false);

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
  closeConnection(file);
});
