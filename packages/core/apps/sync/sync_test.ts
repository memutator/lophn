import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
// 앱 bundle이 싣는 cap-store처럼 전역 STORE_HOOKS를 설치한다. runtime은 그 hook으로 앱과 같은 연결을 쓴다.
import {
  closeConnection,
  openConnection,
} from "../../../sdk/cap-store/connection.node.ts";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import {
  adoptSnapshot,
  applyIncoming,
  dumpData,
  ensureSyncTables,
  openClock,
  stampLocal,
  type SyncDb,
} from "../../../protocol/apps/sync/mod.ts";
import { readChangeset } from "../../../protocol/apps/sync/changeset.ts";
import { hlcAtMs } from "../../../protocol/apps/sync/clock.ts";
import { nodeSyncDb } from "../../../protocol/apps/sync/node-db.ts";
import type { ProcessCallResponse } from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../storage/ledger/schema.ts";
import { applyMigrations } from "../../storage/migration/migrations.ts";
import { createAppCalls } from "../calls/service.ts";
import { createInvocationLedger } from "../invocations/ledger.ts";
import { invocationsSchemaSteps } from "../invocations/schema.ts";
import type { AppProcessLink } from "../ports.ts";
import { createAppRewind } from "../rewind/run.ts";
import { rewindSchemaSteps } from "../rewind/schema.ts";
import { handleApply } from "../runtime/entrypoint/apply.ts";
import {
  handleSnapshot,
  handleSnapshotMerge,
  handleSyncApply,
  handleSyncCleanup,
} from "../runtime/entrypoint/control-server.ts";
import { createStoreAccess } from "../runtime/entrypoint/cap-host.ts";
import { handleCall } from "../runtime/entrypoint/invoke.ts";
import { createRuntimeState } from "../runtime/entrypoint/state.ts";
import { openSyncStore, syncedWrite } from "../runtime/entrypoint/sync.ts";
import { ensureAppToolPort } from "../runtime/entrypoint/tool-port.ts";
import { createSyncLog } from "./log.ts";
import {
  type SyncPlan,
  syncPlanOf,
} from "../../../protocol/apps/declaration/sync-plan.ts";

const PHONE_APP = syncPlanOf({ runs_on: ["computer", "phone"] });
import {
  SYNC_LOG_DESTINATION_STEPS,
  SYNC_LOG_MACHINE_STEPS,
  SYNC_LOG_SCHEMA_STEPS,
} from "./schema.ts";
import { createAppSync } from "./service.ts";
import { createSnapshots } from "./snapshots.ts";

const START = Date.parse("2026-11-16T00:00:00.000Z");
const clock = manualClock(START);
const ids = createIdSource({ clock, random: seededRandom(11) });
const APP = ids.newId("app") as Id<"app">;
const REL = ids.newId("rel") as Id<"rel">;

// 앱 code의 write handler. 지금 test의 앱 DB에 받은 SQL을 돈다.
let appDb: DatabaseSync | null = null;
ensureAppToolPort().register({
  name: "run_sql",
  handle: (input) => {
    appDb!.exec((input as { sql: string }).sql);
    return null;
  },
});

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

function reply<T>(done: { status: number; body: unknown }): Result<T> {
  if (done.status === 200) return ok(done.body as T);
  const error = (done.body as { error: { code: "conflict"; message: string } })
    .error;
  return err(error);
}

// 컴퓨터 한 대: 앱 process(같은 thread의 runtime handler)와 진짜 SQLite ledger 위의 invocation·sync log·호출 길.
function computer(plan: SyncPlan = PHONE_APP) {
  const dir = mkdtempSync(join(tmpdir(), "lophn-app-sync-"));
  const file = join(dir, "app.sqlite");
  const raw = openConnection(file);
  raw.exec("create table item (id text primary key, title text, done integer)");
  appDb = raw;
  const store = createStoreAccess();
  const state = createRuntimeState({
    identity: {
      app: APP,
      release: REL,
      bundleHash: "hash",
      mode: "live",
      processNonce: "nonce",
    },
    declaration: {
      operations: [{ name: "run_sql", effect: "write" }],
      commands: [],
    } as never,
    broker: {} as never,
    store,
    dataSchema: 1,
    controlSocket: "socket",
  });
  state.ready = true;
  state.accepting = true;
  state.sync = openSyncStore({
    database: store.database() as DatabaseSync,
    node: "computer",
    machine: "mch_00000000000000000000000000",
    record: store,
    nowMs: () => clock.nowMs(),
    startChangeset: null,
    plan,
  });

  const ledgerDb = new DatabaseSync(":memory:");
  // events(registered_seq의 근원)와 blob_refs만 쓴다.
  const ledgerSteps = LEDGER_SCHEMA_STEPS.filter((step) =>
    ["common-tables", "erase-windows", "blob-refs"].includes(step.id),
  );
  for (const step of [
    ...ledgerSteps,
    ...invocationsSchemaSteps,
    ...rewindSchemaSteps,
    ...SYNC_LOG_SCHEMA_STEPS,
    ...SYNC_LOG_MACHINE_STEPS,
  ]) {
    ledgerDb.exec(step.sql);
  }
  // sync log의 destination step은 release 선언을 읽는다. 이 ledger에는 그 열만 둔다.
  ledgerDb.exec(
    "create table releases (id text, app text, status text, declaration text)",
  );
  for (const step of SYNC_LOG_DESTINATION_STEPS) ledgerDb.exec(step.sql);
  const sql: Sql = {
    run: (text, params) => ledgerDb.prepare(text).run(...params),
    get: (text, params) => ledgerDb.prepare(text).get(...params) as never,
    all: (text, params) => ledgerDb.prepare(text).all(...params) as never,
  };
  const tx = {
    sql,
    now: () => clock.now(),
    registerBlobRef: (ref: {
      owner_kind: string;
      owner_key: string;
      field: string;
      registered_seq: string;
      source: { blob: { hash: string; size_bytes: number } };
    }) => {
      sql.run(
        `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
         values (?, ?, ?, ?, ?, ?)`,
        [
          ref.owner_kind,
          ref.owner_key,
          ref.field,
          ref.source.blob.hash,
          ref.source.blob.size_bytes,
          BigInt(ref.registered_seq),
        ],
      );
      return ok({} as never);
    },
  } as unknown as Tx;
  function transaction<T>(fn: (tx: Tx) => Result<T>): Result<T> {
    ledgerDb.exec("begin immediate");
    const done = fn(tx);
    ledgerDb.exec(done.ok ? "commit" : "rollback");
    return done;
  }
  const stored = new Map<string, Uint8Array>();
  const blobs = {
    async prepare(stream: ReadableStream<Uint8Array>) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      stored.set(hash, bytes);
      return ok({
        preparation: "prep",
        principal: "machine:test",
        purpose: "app_changeset",
        hash,
        size_bytes: bytes.length,
      });
    },
    read(hash: string, offset: number, length: number) {
      const bytes = stored.get(hash)!;
      return Promise.resolve(
        ok({
          hash,
          sizeBytes: bytes.length,
          bytes: bytes.slice(offset, offset + length),
        }),
      );
    },
  };
  const ledger = createInvocationLedger({
    sql,
    transaction,
    blobs,
    changed: () => {},
  });

  // snapshot을 뜨기 직전에 멈춰 둘 수 있다.
  const hold: { reached?: () => void; gate?: Promise<void> } = {};
  const link: AppProcessLink = {
    async call(_target, request) {
      const done = await handleCall(state, encode(request));
      return { sent: true, response: done.body as ProcessCallResponse };
    },
    apply: async (_app, request) =>
      reply(await handleApply(state, encode(request))),
    syncApply: async (_app, request) =>
      reply(await handleSyncApply(state, encode(request))),
    async snapshot(_app, request) {
      hold.reached?.();
      await hold.gate;
      return reply(await handleSnapshot(state, encode(request)));
    },
    snapshotMerge: async (_app, request) =>
      reply(await handleSnapshotMerge(state, encode(request))),
    syncCleanup: async (_app, request) =>
      reply(await handleSyncCleanup(state, encode(request))),
    syncReapply: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
  };

  const activeRelease = () => ok(REL);
  const log = createSyncLog({
    sql,
    transaction,
    blobs,
    ledger,
    activeRelease,
    plan: () => plan,
    now: () => clock.now(),
    changed: () => {},
  });
  const dataChangedApps: Id<"app">[] = [];
  const calls = createAppCalls({
    callers: { agentToolCall: () => ok(null) },
    lookup: {
      find: () => ok({ release: REL, effect: "write", public: true }),
      findPreview: () => Promise.resolve(ok(null)),
    },
    apps: { activeRelease, archived: () => ok(false) },
    ledger,
    link,
    assignmentOf: () => err({ code: "internal", message: "unused" }),
    appGrantsOf: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    isPrivate: () => false,
    clock,
    ids,
    forward: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    sync: log,
    dataChanged: (app) => dataChangedApps.push(app),
  });
  const appSync = createAppSync({
    log,
    phone: calls.phone,
    activeRelease,
    runsOnPhone: () => true,
  });
  const snapshots = createSnapshots({
    dataRoot: dir,
    log,
    exclusive: calls.phone.exclusive,
    link,
    activeRelease,
    runsOnPhone: () => true,
    clock,
    ids,
    later: () => {},
  });
  const rewind = createAppRewind({
    ledger,
    link,
    intake: calls.intake,
    signal: { changed: () => {} },
    sql,
    activeRelease,
    now: () => clock.now() as never,
    newId: () => ids.newId("rwd") as Id<"rwd">,
    sync: log,
  });

  async function write(text: string) {
    clock.advance(1000);
    const done = await calls.path.call(
      {
        target: { mode: "live", app: APP, release: null },
        kind: "operation",
        name: "run_sql",
        input: { sql: text },
        caller: { kind: "person", view_session: "view" },
      },
      { actor: "user" },
    );
    assert.ok(done.ok && done.value.outcome.status === "succeeded");
    return done.value.invocation as Id<"inv">;
  }

  // 폰 한 대: snapshot을 받아 사본을 열고, 자기 write를 찍고, push·pull한다.
  async function phone(name: string) {
    const device = ids.newId("dev") as Id<"dev">;
    const principal = `device:${device}`;
    const replica = { db: null as unknown as SyncDb, cursor: 0 };

    async function adopt(snapshot: {
      snapshot: string;
      size: number;
      seq: number;
    }) {
      const bytes = new Uint8Array(snapshot.size);
      let offset = 0;
      while (offset < snapshot.size) {
        const part = await snapshots.read(principal, {
          snapshot: snapshot.snapshot,
          offset,
          length: 1024 * 1024,
        });
        assert.ok(part.ok);
        bytes.set(part.value, offset);
        offset += part.value.length;
      }
      const path = join(dir, `${name}-${snapshot.seq}.sqlite`);
      writeFileSync(path, bytes);
      const opened = new DatabaseSync(path);
      opened.exec("pragma foreign_keys = off");
      replica.db = nodeSyncDb(opened);
      adoptSnapshot(replica.db, {
        node: name,
        cursor: String(snapshot.seq),
        release: REL,
      });
      replica.cursor = snapshot.seq;
    }

    async function resnapshot() {
      const taken = await snapshots.take(principal, { app: APP });
      assert.ok(taken.ok);
      await adopt(taken.value);
    }

    await resnapshot();
    return {
      device,
      principal,
      replica,
      adopt,
      resnapshot,
      dump: () => dumpData(replica.db),
      // 폰 앱의 write 하나: session으로 뜬 changeset을 폰 clock으로 찍는다.
      write(atMs: number, text: string) {
        const db = replica.db;
        db.exec("begin immediate");
        const session = db.session();
        db.exec(text);
        const changeset = session.changeset();
        session.close();
        const hlc = openClock(db).next(atMs);
        assert.ok(stampLocal(db, changeset, hlc).ok);
        db.exec("commit");
        return {
          id: ids.newId("chg").slice("chg_".length),
          operation: "edit",
          started_at: new Date(atMs).toISOString(),
          hlc: String(hlc),
          changeset: Buffer.from(changeset).toString("base64"),
        };
      },
      push(changes: { id: string; hlc: string; changeset: string }[]) {
        return appSync.push(principal, {
          app: APP,
          release: REL,
          changes: changes as never,
        });
      },
      async pull() {
        const pulled = await appSync.pull(principal, {
          app: APP,
          release: REL,
          after: replica.cursor,
        });
        assert.ok(pulled.ok);
        const db = replica.db;
        db.exec("begin immediate");
        const applied = applyIncoming(
          db,
          pulled.value.changes.map((change) => ({
            hlc: BigInt(change.hlc),
            changeset: new Uint8Array(Buffer.from(change.changeset, "base64")),
          })),
          openClock(db),
          clock.nowMs(),
        );
        db.exec(applied.ok ? "commit" : "rollback");
        assert.ok(applied.ok);
        replica.cursor = pulled.value.next;
        return pulled.value;
      },
    };
  }

  const logRows = () =>
    sql.all("select * from app_sync_log order by seq", []).map((row) => ({
      ...row,
    }));

  return {
    raw,
    state,
    link,
    sql,
    ledger,
    log,
    calls,
    snapshots,
    rewind,
    hold,
    write,
    phone,
    logRows,
    dataChangedApps,
    dump: () => dumpData(state.sync!.db),
    close: () => closeConnection(file),
  };
}

// 지우면 다시 보낸 push가 앱 DB에 두 번 적용되고 Activity에 같은 변경이 둘 남거나, 다른 폰이 컴퓨터가 실제로
// 바꾼 것(effective)만 받아 clock이 어긋난다.
test("같은 변경 id를 두 번 push하면 invocation 하나와 log 줄 하나만 생기고 둘째는 duplicate와 같은 seq를 받는다. invocation의 changeset은 effective이고 다른 폰은 원래 changeset을 받는다", async () => {
  const pc = computer();
  try {
    await pc.write("insert into item values ('a', 'milk', 0)");
    const phoneA = await pc.phone("a");
    const phoneB = await pc.phone("b");

    // 폰이 먼저 title과 done을 고치고, 컴퓨터가 더 늦게 title을 고친다.
    const change = phoneA.write(
      clock.nowMs() + 10,
      "update item set title = 'milk P', done = 1 where id = 'a'",
    );
    await pc.write("update item set title = 'milk C' where id = 'a'");

    const first = await phoneA.push([change]);
    const again = await phoneA.push([change]);
    assert.ok(first.ok && again.ok);
    assert.equal(first.value.results[0]!.status, "applied");
    assert.deepEqual(again.value.results[0], {
      id: change.id,
      status: "duplicate",
      seq: first.value.results[0]!.seq,
    });

    const fromPhone = pc.ledger.list({ app: APP, release: REL, mode: "live" });
    assert.ok(fromPhone.ok);
    const invocations = fromPhone.value.filter(
      (one) => one.caller?.kind === "person" && one.caller.device !== undefined,
    );
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0]!.caller, {
      kind: "person",
      view_session: change.id,
      device: phoneA.device,
    });
    assert.equal(invocations[0]!.started_at, change.started_at);
    assert.equal(
      pc.logRows().filter((row) => row["device"] === phoneA.device).length,
      1,
    );

    // invocation의 changeset은 컴퓨터에서 실제로 바뀐 done뿐이다(title은 컴퓨터가 더 늦게 썼다).
    const effective = await pc.ledger.changesetOf(
      invocations[0]!.id as Id<"inv">,
    );
    assert.ok(effective.ok && effective.value !== null);
    const read = readChangeset(effective.value);
    assert.ok(read.ok);
    assert.deepEqual(
      read.value.map((one) => one.new),
      [[undefined, undefined, BigInt(1)]],
    );

    // 다른 폰은 폰 A가 보낸 원래 changeset과 hlc를 받는다.
    const pulled = await phoneB.pull();
    const relayed = pulled.changes.find((one) => one.origin === "device");
    assert.deepEqual(
      relayed && { hlc: relayed.hlc, changeset: relayed.changeset },
      { hlc: change.hlc, changeset: change.changeset },
    );
    await phoneA.pull();
    assert.equal(phoneB.dump(), pc.dump());
    assert.equal(phoneA.dump(), pc.dump());
    assert.match(pc.dump(), /'a'\|'milk C'\|1/);
  } finally {
    pc.close();
  }
});

// 지우면 폰에서 온 변경을 되돌려도 다른 폰에는 옛 clock이 남아 되돌림이 그 폰에서 지거나 아예 가지 않는다.
test("폰 변경을 덮는 rewind는 sync 전의 row로 돌리고 rewind log 줄을 남기며, 그 줄은 이미 그 변경을 받은 다른 폰의 pull에서 이긴다", async () => {
  const pc = computer();
  try {
    await pc.write("insert into item values ('a', 'milk', 0)");
    const before = pc.dump();
    const phoneA = await pc.phone("a");
    const phoneB = await pc.phone("b");

    const change = phoneA.write(
      clock.nowMs() + 10,
      "update item set title = 'milk P' where id = 'a'",
    );
    const pushed = await phoneA.push([change]);
    assert.ok(pushed.ok && pushed.value.results[0]!.status === "applied");
    await phoneB.pull();
    assert.match(phoneB.dump(), /'milk P'/);

    // 폰에서 온 invocation도 다른 live write처럼 rewind 범위에 든다.
    const listed = pc.ledger.list({ app: APP, release: REL, mode: "live" });
    assert.ok(listed.ok);
    const fromPhone = listed.value.find(
      (one) => one.caller?.kind === "person" && one.caller.device !== undefined,
    )!;
    const rewound = await pc.rewind.apply(
      APP,
      fromPhone.id as Id<"inv">,
      "user",
    );
    assert.ok(rewound.ok && rewound.value.status === "applied");
    assert.deepEqual(rewound.value.invocations, [fromPhone.id]);
    assert.equal(pc.dump(), before);

    const pulledB = await phoneB.pull();
    assert.deepEqual(
      pulledB.changes.map((one) => one.origin),
      ["rewind"],
    );
    await phoneA.pull();
    assert.equal(phoneB.dump(), before);
    assert.equal(phoneA.dump(), before);
  } finally {
    pc.close();
  }
});

// 지우면 snapshot을 뜨는 사이에 든 write가 사본에도 들고 seq 뒤에도 남거나, 어느 쪽에도 없어 그 폰이 영영 받지 못한다.
test("snapshot은 그 seq와 맞는다: 뜨는 동안 온 push와 write는 snapshot 뒤에만 들고, seq N의 snapshot에 N 뒤의 pull을 적용하면 컴퓨터 DB와 같다", async () => {
  const pc = computer();
  try {
    await pc.write("insert into item values ('a', 'milk', 0)");
    const phoneB = await pc.phone("b");
    const late = await pc.phone("c");

    let open!: () => void;
    pc.hold.gate = new Promise((resolve) => (open = resolve));
    const reached = new Promise<void>((resolve) => (pc.hold.reached = resolve));
    const taking = pc.snapshots.take(late.principal, { app: APP });
    await reached;
    pc.hold.reached = undefined;
    const pushing = phoneB.push([
      phoneB.write(
        clock.nowMs() + 10,
        "update item set done = 1 where id = 'a'",
      ),
    ]);
    const writing = pc.write("insert into item values ('b', 'eggs', 0)");
    await new Promise((resolve) => setImmediate(resolve));
    open();
    const [taken, pushed] = await Promise.all([taking, pushing, writing]);
    assert.ok(taken.ok && pushed.ok);
    assert.ok(pushed.value.results[0]!.seq > taken.value.seq);

    await late.adopt(taken.value);
    assert.doesNotMatch(late.dump(), /eggs|'milk'\|1/);
    await late.pull();
    assert.equal(late.dump(), pc.dump());
    assert.match(pc.dump(), /'a'\|'milk'\|1\n'b'\|'eggs'\|0/);
  } finally {
    pc.close();
  }
});

// 지우면 core가 앱 commit과 log 줄 사이에서 죽은 변경이 어느 폰에도 가지 않아 두 기기가 조용히 갈라진다.
test("log 줄 없이 끝난 컴퓨터 write는 core가 다시 뜰 때 채워져 폰이 다음 pull에서 새 snapshot으로 받는다", async () => {
  const pc = computer();
  try {
    await pc.write("insert into item values ('a', 'milk', 0)");
    const phone = await pc.phone("a");

    // 앱은 commit했고 invocation도 끝났지만 core가 log 줄을 쓰기 전에 죽었다.
    const sync = pc.state.sync!;
    const done = await syncedWrite(sync, () =>
      Promise.resolve(pc.raw.exec("update item set title = 'milk C'")),
    );
    assert.ok(done.ok);
    const id = ids.newId("inv") as Id<"inv">;
    assert.ok(
      pc.ledger.begin({
        id,
        app: APP,
        release: REL,
        mode: "live",
        operation: { kind: "operation", name: "run_sql" },
        caller: { kind: "person", view_session: "view" },
        effect: "write",
        input_hash: null,
        started_at: clock.now(),
      }).ok,
    );
    assert.ok(
      (
        await pc.ledger.finish(id, {
          status: "succeeded",
          finished_at: clock.now(),
          summary: {},
          detail_hash: null,
          changeset: done.value.changeset,
        })
      ).ok,
    );
    assert.equal((await phone.pull()).snapshot_needed, false);

    const filled = await pc.log.backfill(APP);
    assert.ok(filled.ok && filled.value === 1);
    const again = await pc.log.backfill(APP);
    assert.ok(again.ok && again.value === 0);

    assert.equal((await phone.pull()).snapshot_needed, true);
    await phone.resnapshot();
    assert.equal((await phone.pull()).snapshot_needed, false);
    assert.equal(phone.dump(), pc.dump());
    assert.match(pc.dump(), /'milk C'/);
  } finally {
    pc.close();
  }
});

// 표마다 행 전체(schema 이력 표는 빼고). 새 step이 더하는 표도 뺀다.
function dumpTables(db: DatabaseSync): [string, string[]][] {
  return db
    .prepare(
      "select name from sqlite_master where type = 'table' and name not in ('app_sync_log', 'schema_migrations') and name not glob 'sqlite_*' order by name",
    )
    .all()
    .map((row) => String(row["name"]))
    .map((table) => [
      table,
      db
        .prepare(`select * from "${table}" order by rowid`)
        .all()
        .map((row) =>
          JSON.stringify(row, (_key, value: unknown) =>
            typeof value === "bigint" ? String(value) : value,
          ),
        ),
    ]);
}

// 지우면 새 step이 기존 표를 고치거나 지워 사람이 쓰던 ledger의 기록이 사라진다.
test("schema step apps.sync-log가 기존 ledger에 걸려도 다른 표의 행이 그대로다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-sync-step-"));
  const path = join(dir, "ledger.sqlite");
  const before = [
    ...LEDGER_SCHEMA_STEPS,
    ...invocationsSchemaSteps,
    ...rewindSchemaSteps,
  ];
  assert.ok((await applyMigrations(path, before, { clock })).ok);
  const db = new DatabaseSync(path);
  db.exec(`
    insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
      values ('app_invocation', 'inv_1', 'changeset', '${"a".repeat(64)}', 3, 0);
    insert into app_rewinds (id, app, release, from_invocation, requested_by, status, invocations, started_at)
      values ('rwd_1', 'app_1', 'rel_1', 'inv_1', 'user', 'applying', '[]', '2026-11-16T00:00:00.000Z');
  `);
  const kept = dumpTables(db);
  db.close();

  const applied = await applyMigrations(
    path,
    [...before, ...SYNC_LOG_SCHEMA_STEPS],
    { clock },
  );
  assert.deepEqual(applied.ok && applied.value, 1);
  const after = new DatabaseSync(path);
  assert.deepEqual(dumpTables(after), kept);
  assert.equal(
    after.prepare("select count(*) as n from app_sync_log").get()!["n"],
    0,
  );
  after.close();
});

const bytesOf = (change: { changeset: string }) =>
  new Uint8Array(Buffer.from(change.changeset, "base64"));
// 기계에서 온 변경을 적용한 invocation. 적용 길은 이 test 밖이라 log에는 id만 남는다.
const machineInvocation = (n: number) =>
  ({ id: `inv_m${n}`, app: APP, release: REL }) as never;

// 지우면 다른 기계에서 온 변경이 폰에 가지 않아 폰이 조용히 갈라지거나, 같은 file을 다시 읽을 때 같은 변경이 두 번
// 적용되거나, 기기의 변경 id와 섞여 다른 변경을 이미 받은 것으로 건너뛴다.
test("다른 기계에서 온 줄은 폰 pull에 원래 changeset과 hlc로 나오고, 같은 기계의 같은 변경 id는 한 줄이며 기기의 같은 id와 섞이지 않는다", async () => {
  const pc = computer();
  try {
    await pc.write("insert into item values ('a', 'milk', 0)");
    const other = await pc.phone("other");
    const phone = await pc.phone("b");
    // 다른 기계의 앱 DB가 낸 변경 대신 폰 사본이 뜬 changeset을 쓴다(그 사본은 push하지 않는다).
    const change = other.write(
      clock.nowMs() + 10,
      "update item set title = 'milk M' where id = 'a'",
    );
    const machineA = ids.newId("mch") as Id<"mch">;
    const machineB = ids.newId("mch") as Id<"mch">;
    const first = await pc.log.machine(
      machineInvocation(1),
      {
        machine: machineA,
        destination: "computers",
        id: "7",
        hlc: change.hlc,
        changeset: bytesOf(change),
      },
      "applied",
    );
    assert.ok(first.ok);

    const pulled = await phone.pull();
    assert.deepEqual(pulled.changes, [
      {
        seq: first.value,
        origin: "machine",
        hlc: change.hlc,
        changeset: change.changeset,
      },
    ]);
    assert.match(phone.dump(), /'milk M'/);

    assert.deepEqual(pc.log.duplicateFrom(machineA, "7"), ok(first.value));
    assert.deepEqual(pc.log.duplicateFrom(machineB, "7"), ok(null));
    assert.throws(
      () =>
        pc.sql.run(
          `insert into app_sync_log (app, release, kind, origin, machine, change_id, hlc, created_at)
           values (?, ?, 'skipped', 'machine', ?, '7', '1', '2026-11-16T00:00:00.000Z')`,
          [APP, REL, machineA],
        ),
      /UNIQUE/,
    );
    const fromB = await pc.log.machine(
      machineInvocation(2),
      {
        machine: machineB,
        destination: "computers",
        id: "7",
        hlc: change.hlc,
        changeset: bytesOf(change),
      },
      "skipped",
    );
    const fromDevice = await pc.log.phone(
      machineInvocation(3),
      {
        device: phone.device,
        id: "7",
        hlc: change.hlc,
        changeset: bytesOf(change),
      },
      "skipped",
    );
    assert.ok(fromB.ok && fromDevice.ok);
    assert.deepEqual(pc.log.duplicateFrom(machineA, "7"), ok(first.value));
    assert.deepEqual(pc.log.duplicateFrom(machineB, "7"), ok(fromB.value));
    assert.deepEqual(pc.log.duplicate(phone.device, "7"), ok(fromDevice.value));
    assert.deepEqual(pc.log.duplicate(machineA, "7"), ok(null));
  } finally {
    pc.close();
  }
});

// 지우면 정리된 흔적과 부딪는 사람의 변경이 풀거나 release가 바뀔 때 사라지거나, 폰에 가서 지운 row를 되살린다.
test("held 줄의 bytes는 풀어도, release가 바뀌어도 남고 폰 pull에 나오지 않는다", async () => {
  const pc = computer();
  try {
    await pc.write("insert into item values ('a', 'milk', 0)");
    const other = await pc.phone("other");
    const phone = await pc.phone("b");
    const change = other.write(
      clock.nowMs() + 10,
      "update item set title = 'milk H' where id = 'a'",
    );
    const held = await pc.log.held(
      APP,
      REL,
      [
        {
          origin: "machine",
          machine: ids.newId("mch") as Id<"mch">,
          destination: "personal",
          id: "9",
          hlc: change.hlc,
          changeset: bytesOf(change),
        },
      ],
      "past_horizon",
    );
    assert.ok(held.ok);
    assert.deepEqual(
      pc.log.heldList(APP).map((row) => row.seq),
      [held.value],
    );

    const before = phone.dump();
    const pulled = await phone.pull();
    assert.deepEqual(pulled.changes, []);
    assert.equal(pulled.next, held.value);
    assert.equal(phone.dump(), before);

    assert.ok(pc.log.resolve(held.value, clock.now()).ok);
    assert.deepEqual(pc.log.heldList(APP), []);
    const otherRelease = ids.newId("rel") as Id<"rel">;
    assert.ok((await pc.log.prune(APP, otherRelease)).ok);

    const row = pc.sql.get("select * from app_sync_log where seq = ?", [
      held.value,
    ])!;
    assert.equal(row["kind"], "held");
    assert.equal(row["resolved_at"], clock.now());
    const read = await pc.log.readChangeset(
      String(row["changeset_hash"]),
      Number(row["changeset_size"]),
    );
    assert.deepEqual(read.ok && read.value, bytesOf(change));
    assert.ok(
      pc.sql.get(
        "select 1 from blob_refs where owner_kind = 'app_sync_log' and owner_key = ? and hash = ?",
        [String(held.value), row["changeset_hash"]],
      ) !== undefined,
    );
  } finally {
    pc.close();
  }
});

test("폰 push가 변경을 적용하면 dataChanged가 한 번 불리고 duplicate에는 다시 불리지 않는다", async () => {
  const pc = computer();
  try {
    const phoneA = await pc.phone("evt");
    const change = phoneA.write(
      clock.nowMs() + 10,
      "insert into item values ('e1', 'eggs', 0)",
    );
    const first = await phoneA.push([change]);
    assert.ok(first.ok);
    assert.equal(first.value.results[0]!.status, "applied");
    assert.deepEqual(pc.dataChangedApps, [APP]);

    const duplicate = await phoneA.push([change]);
    assert.ok(duplicate.ok);
    assert.equal(duplicate.value.results[0]!.status, "duplicate");
    assert.deepEqual(pc.dataChangedApps, [APP]);
  } finally {
    pc.close();
  }
});

// 지우면 합치기에서 나온 held 줄이 id 없이 들어가 sync log의 CHECK에 걸려, 읽기가 그 출처의 snapshot을 끝없이 다시 합치며
// 그 stream 전체가 멈춘다(앱은 도는데 app_not_running으로 보였다). 다시 합칠 때 같은 held 줄이 둘 생겨도 안 된다.
test("다른 기계의 snapshot 합치기가 정리된 흔적과 부딪는 row를 held로 내면 진짜 sync log에 한 번만 남고 합치기는 끝난다. 같은 snapshot을 다시 합쳐도 줄이 늘지 않는다", async () => {
  const pc = computer(syncPlanOf({ sync: { item: "personal" } }));
  try {
    await pc.write("insert into item values ('x', 'mine', 0)");
    await pc.write("delete from item where id = 'x'");
    const cleaned = await pc.link.syncCleanup(APP, {
      before: String(hlcAtMs(clock.nowMs() + 1)),
    });
    assert.ok(cleaned.ok && cleaned.value.status === "cleaned");
    assert.equal(cleaned.value.dropped, 1);

    // 다른 기계가 그 사이(horizon 이하 clock) x를 넣은 사본.
    const dir = mkdtempSync(join(tmpdir(), "lophn-sync-merge-held-"));
    const path = join(dir, "4.sqlite");
    const raw = new DatabaseSync(path);
    raw.exec(
      "create table item (id text primary key, title text, done integer)",
    );
    const other = nodeSyncDb(raw);
    ensureSyncTables(other, "other");
    other.exec("begin immediate");
    const session = other.session();
    other.exec("insert into item values ('x', 'theirs', 0)");
    const changeset = session.changeset();
    session.close();
    assert.ok(
      stampLocal(other, changeset, openClock(other).next(START + 1500)).ok,
    );
    other.exec("commit");
    raw.close();

    const OTHER = ids.newId("mch") as Id<"mch">;
    const merge = () =>
      pc.calls.folder.mergeSnapshot({
        app: APP,
        release: REL,
        origin: OTHER,
        destination: "personal",
        n: 4,
        path,
      });
    const first = await merge();
    assert.ok(first.ok, JSON.stringify(first));
    const held = () =>
      pc.log
        .heldList(APP)
        .map((row) => [row.origin, row.machine, row.destination]);
    assert.deepEqual(held(), [["machine", OTHER, "personal"]]);
    assert.doesNotMatch(pc.dump(), /theirs/);

    const again = await merge();
    assert.ok(again.ok, JSON.stringify(again));
    assert.deepEqual(held(), [["machine", OTHER, "personal"]]);
  } finally {
    pc.close();
  }
});
