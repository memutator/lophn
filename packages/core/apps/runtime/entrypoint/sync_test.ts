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
  applyPhoneChange,
  openSyncStore,
  type SyncStore,
  syncedWrite,
  writeSnapshot,
} from "./sync.ts";
import { ensureAppToolPort } from "./tool-port.ts";

const ULID = "01j00000000000000000000000";
const APP = `app_${ULID}`;
const REL = `rel_${ULID}`;

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

  const applied = applyPhoneChange(sync, edit);
  assert.ok(applied.ok && applied.value.status === "applied");
  const effective = readChangeset(applied.value.effective!);
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
  const skipped = applyPhoneChange(sync, clash);
  assert.ok(skipped.ok && skipped.value.status === "skipped");
  assert.ok(applyPhoneChange(sync, next).ok);
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
    const pushed = applyPhoneChange(restarted, {
      hlc: row.hlc!,
      changeset: row.changeset,
    });
    assert.ok(pushed.ok && pushed.value.status === "applied");
  }

  const computerDump = dumpData(restarted.db);
  assert.equal(computerDump, dumpData(fresh));
  assert.equal(computerDump, "# item\n'a'|'milk C'|'n P'");
  closeConnection(file);
});
