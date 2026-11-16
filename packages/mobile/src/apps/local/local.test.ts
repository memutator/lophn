import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import {
  applyRemote,
  dumpData,
  ensureSyncTables,
  getState,
  migrate,
  openClock,
  readOutbox,
  stampLocal,
  type SyncDb,
} from "../../../../protocol/apps/sync/mod.ts";
import { nodeSyncDb } from "../../../../protocol/apps/sync/node-db.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import { paths, readInstalled } from "./folder.ts";
import { type Ctx, install } from "./install.ts";
import type { HostDb, LocalDeps, LocalFiles, Remote } from "./ports.ts";
import { pruneApp } from "./prune.ts";
import { switchRelease } from "./release.ts";
import { createLocalApps } from "./store.ts";
import { applyBatch, pull, push } from "./sync.ts";
import { toBase64 } from "./transfer.ts";

// The phone side on node: app folders on disk, the app database on node:sqlite (the sync core's driver), and a fake
// computer that keeps an app database and a sync log the way core does (push applies and logs, pull skips the
// phone's own rows, a snapshot is VACUUM INTO).

const COMPUTER = "c1";
const APP = "app_local";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function nodeFiles(root: string): LocalFiles {
  const at = (path: string) => join(root, path);
  const made = (path: string) => {
    mkdirSync(dirname(at(path)), { recursive: true });
    return at(path);
  };
  return {
    exists: (path) => existsSync(at(path)),
    readText: (path) => (existsSync(at(path)) ? readFileSync(at(path), "utf8") : null),
    write: (path, content) => writeFileSync(made(path), content),
    append: (path, bytes) => writeFileSync(made(path), bytes, { flag: "a" }),
    remove: (path) => rmSync(at(path), { recursive: true, force: true }),
    list: (path) => (existsSync(at(path)) ? readdirSync(at(path)) : []),
    copy: (from, to) => copyFileSync(at(from), made(to)),
    move: (from, to) => renameSync(at(from), made(to)),
    async digest(path) {
      if (!existsSync(at(path))) return null;
      const bytes = readFileSync(at(path));
      return { size: bytes.byteLength, sha256: sha(bytes) };
    },
    absolute: at,
  };
}

// The same connection settings as the phone's database module.
function openDb(path: string): HostDb {
  const raw = new DatabaseSync(path);
  raw.exec("pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on");
  return { ...nodeSyncDb(raw), close: () => raw.close() };
}

let ids = 0;
const changeId = () => `01${String(++ids).padStart(24, "0")}`;

/** A guest's local call: the write and its outbox row (no clock yet) in one transaction. */
function localWrite(path: string, sql: string, record = true) {
  const raw = new DatabaseSync(path);
  raw.exec("pragma busy_timeout = 5000");
  raw.exec("begin immediate");
  const session = raw.createSession({ table: "item" });
  raw.exec(sql);
  const changeset = session.changeset();
  session.close();
  if (record) {
    raw
      .prepare(
        "insert into lophn_sync_outbox (id, operation, started_at, changeset, hlc) values (?, 'add_item', ?, ?, null)",
      )
      .run(changeId(), new Date().toISOString(), changeset);
  }
  raw.exec("commit");
  raw.close();
}

function read<T>(path: string, work: (db: SyncDb) => T): T {
  const db = openDb(path);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

const items = (path: string) =>
  read(path, (db) => db.all("select id, title from item order by id").map((row) => `${row["id"]}:${row["title"]}`));

const ITEM = "create table item (id text primary key, title text not null);";

type Release = { id: string; data_schema: number; migrations: { from: number; to: number; sql: string }[] };

// The computer's data worker migrates the app database the same way (lophn_data_schema rides in the snapshot).
async function migrated(db: SyncDb, release: Release) {
  const done = await migrate(db, {
    steps: release.migrations.map((step) => ({ ...step, sha256: sha(step.sql) })),
    target: release.data_schema,
    sha256: async (text) => sha(text),
    appliedAt: new Date().toISOString(),
  });
  assert.ok(done.ok, done.ok ? "" : done.error.message);
}

async function fakeComputer(dir: string, first: Release, runsOn: ("computer" | "phone")[] = ["computer", "phone"]) {
  const dbPath = join(dir, "computer.sqlite");
  const raw = new DatabaseSync(dbPath);
  const db = nodeSyncDb(raw);
  await migrated(db, first);
  ensureSyncTables(db, "computer");
  const clock = openClock(db);
  const log: { seq: number; hlc: bigint; changeset: Uint8Array; device: string }[] = [];
  const blobs = new Map<string, Uint8Array>();
  const snapshots = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  const state = {
    release: first,
    // push: apply this many changes, then answer unavailable (what was applied rides in details.results).
    pushFailsAfter: null as number | null,
    calls: [] as string[],
  };
  const backend = new TextEncoder().encode("globalThis.__backend = 1;");
  const screen = new TextEncoder().encode("globalThis.__lophnMount(function(){return null});");

  function entry(release: Release): PhoneScreen {
    for (const step of release.migrations) {
      blobs.set(`${release.id}/migrations/${step.from}-${step.to}.sql`, new TextEncoder().encode(step.sql));
    }
    blobs.set(`${release.id}/phone/backend.js`, backend);
    blobs.set(`${release.id}/screen`, screen);
    return {
      app: APP,
      app_name: "Local items",
      icon: null,
      screen: "home",
      label: "Home",
      release: release.id,
      bundle_hash: sha(screen),
      manifest: {
        format: 1,
        entry: "phone.js",
        size: screen.byteLength,
        sha256: sha(screen),
        base: 2,
        kit: { "@lophn/ui-native": "0.1.0", "@lophn/app-ui-native": "0.1.0" },
        modules: ["react"],
      },
      runs_on: runsOn,
      backend: {
        format: 1,
        entry: "backend.js",
        size: backend.byteLength,
        sha256: sha(backend),
        data_schema: release.data_schema,
        migrations: release.migrations.map((step) => ({
          from: step.from,
          to: step.to,
          file: `migrations/${step.from}-${step.to}.sql`,
          sha256: sha(step.sql),
        })),
        operations: { list_items: "read", add_item: "write", send_report: "external" },
        sdk: { "@lophn/cap-store": "2.0.0", "@lophn/cap-tool": "2.2.0" },
      },
      running: true,
    } as PhoneScreen;
  }

  const fail = (code: string, message: string, details?: Record<string, unknown>) => ({
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });
  const file = (bytes: Uint8Array | undefined) =>
    bytes === undefined ? fail("not_found", "no such file") : { ok: true, value: { base64: toBase64(bytes) } };

  const remote: Remote = {
    async call({ resource, method, body }) {
      const input = body as Record<string, unknown>;
      state.calls.push(`${resource}/${method}`);
      switch (`${resource}/${method}`) {
        case "apps/phone_file":
          return file(blobs.get(`${input["release"]}/${input["path"]}`));
        case "apps/screen_file":
          return file(blobs.get(`${(input["target"] as { release: string }).release}/screen`));
        case "app_sync/snapshot": {
          const out = join(dir, `snapshot-${snapshots.size}.sqlite`);
          raw.exec(`vacuum into '${out}'`);
          const bytes = new Uint8Array(readFileSync(out));
          const id = `snp_${snapshots.size}`;
          snapshots.set(id, bytes);
          return {
            ok: true,
            value: {
              snapshot: id,
              release: state.release.id,
              seq: log.length,
              size: bytes.byteLength,
              sha256: sha(bytes),
              expires_at: new Date().toISOString(),
            },
          };
        }
        case "app_sync/snapshot_file": {
          const bytes = snapshots.get(String(input["snapshot"]));
          const offset = Number(input["offset"]);
          return file(bytes?.subarray(offset, offset + Number(input["length"])));
        }
        case "app_sync/push": {
          if (input["release"] !== state.release.id) {
            return fail("conflict", "the release is not active", { active_release: state.release.id });
          }
          const results: { id: string; status: string; seq: number }[] = [];
          for (const change of input["changes"] as { id: string; hlc: string; changeset: string }[]) {
            if (state.pushFailsAfter !== null && results.length >= state.pushFailsAfter) {
              return fail("unavailable", "the app stopped", { results });
            }
            if (seen.has(change.id)) {
              results.push({ id: change.id, status: "duplicate", seq: log.length });
              continue;
            }
            const changeset = new Uint8Array(Buffer.from(change.changeset, "base64"));
            raw.exec("pragma foreign_keys = off");
            raw.exec("begin immediate");
            const done = applyRemote(db, [{ hlc: BigInt(change.hlc), changeset }], clock);
            assert.ok(done.ok);
            raw.exec("commit");
            seen.add(change.id);
            log.push({ seq: log.length + 1, hlc: BigInt(change.hlc), changeset, device: "phone" });
            results.push({ id: change.id, status: "applied", seq: log.length });
          }
          return { ok: true, value: { results, seq: log.length } };
        }
        case "app_sync/pull": {
          if (input["release"] !== state.release.id) {
            return { ok: true, value: { changes: [], next: input["after"], more: false, snapshot_needed: true } };
          }
          const after = Number(input["after"]);
          return {
            ok: true,
            value: {
              changes: log
                .filter((row) => row.seq > after && row.device !== "phone")
                .map((row) => ({
                  seq: row.seq,
                  origin: "computer",
                  hlc: String(row.hlc),
                  changeset: toBase64(row.changeset),
                })),
              next: log.length,
              more: false,
              snapshot_needed: false,
            },
          };
        }
        default:
          return fail("not_found", "no such route");
      }
    },
  };

  return {
    remote,
    state,
    entry,
    /** A write on the computer: stamped and logged like the app runtime and core do. */
    write(sql: string) {
      raw.exec("begin immediate");
      const session = raw.createSession({ table: "item" });
      raw.exec(sql);
      const changeset = session.changeset();
      session.close();
      const hlc = clock.next(Date.now());
      assert.ok(stampLocal(db, changeset, hlc).ok);
      raw.exec("commit");
      log.push({ seq: log.length + 1, hlc, changeset, device: "computer" });
    },
    /** Activates a release: the computer migrates its own database (unless told not to) and old log rows no longer pull. */
    async activate(release: Release, run = true) {
      if (run) await migrated(db, release);
      state.release = release;
    },
    items: () => db.all("select id, title from item order by id").map((row) => `${row["id"]}:${row["title"]}`),
  };
}

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function setup(runsOn?: ("computer" | "phone")[]) {
  const dir = mkdtempSync(join(tmpdir(), "lophn-local-"));
  dirs.push(dir);
  const files = nodeFiles(join(dir, "apps"));
  const deps: LocalDeps = { files, open: openDb, now: Date.now };
  const rel1: Release = { id: "rel_1", data_schema: 1, migrations: [{ from: 0, to: 1, sql: ITEM }] };
  const computer = await fakeComputer(dir, rel1, runsOn);
  const ctx: Ctx = { deps, remote: computer.remote, computer: COMPUTER, node: "dev_phone" };
  const at = paths(COMPUTER, APP);
  return {
    dir,
    deps,
    files,
    computer,
    ctx,
    rel1,
    at,
    dbPath: files.absolute(at.db),
    installed: () => readInstalled(files, COMPUTER, APP)!,
    async install(release = rel1) {
      const done = await install(ctx, [computer.entry(release)]);
      assert.ok(done.ok, done.ok ? "" : done.error.message);
      return done.value;
    },
    outbox: () => read(files.absolute(at.db), (db) => readOutbox(db)),
  };
}

test("outbox rows leave only when the computer answered for them; unsent data and standalone data are not pruned", async () => {
  const t = await setup();
  await t.install();
  for (const id of ["a", "b", "c"]) localWrite(t.dbPath, `insert into item values ('${id}', 'phone ${id}')`);

  // The computer takes one change, then stops: that row leaves, the other two stay.
  t.computer.state.pushFailsAfter = 1;
  const stopped = await push(t.ctx, t.installed());
  assert.equal(stopped.ok, false);
  assert.deepEqual(t.outbox().length, 2);
  assert.deepEqual(t.computer.items(), ["a:phone a"]);

  // The computer does not answer at all: nothing leaves.
  const away: Ctx = { ...t.ctx, remote: { call: () => Promise.reject(new Error("closed")) } };
  assert.equal((await push(away, t.installed())).ok, false);
  assert.equal(t.outbox().length, 2);

  // The app left the computer's list with changes still to send: its folder stays.
  assert.equal(await pruneApp(t.deps, COMPUTER, APP), false);
  assert.ok(t.files.exists(t.at.db));

  t.computer.state.pushFailsAfter = null;
  const sent = await push(t.ctx, t.installed());
  assert.ok(sent.ok);
  assert.deepEqual(sent.value, { pushed: 2, left: 0 });
  assert.deepEqual(t.computer.items(), ["a:phone a", "b:phone b", "c:phone c"]);
  assert.equal(await pruneApp(t.deps, COMPUTER, APP), true);
  assert.equal(t.files.exists(t.at.dir), false);

  // A standalone app: its own empty database, migrated on the phone, and never pruned.
  const alone = await setup(["phone"]);
  const installed = await alone.install();
  assert.equal(installed.kind, "standalone");
  localWrite(alone.dbPath, "insert into item values ('x', 'only here')", false);
  assert.equal(await pruneApp(alone.deps, COMPUTER, APP), false);
  assert.deepEqual(items(alone.dbPath), ["x:only here"]);
});

test("a release change that fails leaves app.sqlite and its outbox as they were; the backup stays until the first push on the new release", async () => {
  const t = await setup();
  await t.install();
  t.computer.write("insert into item values ('c1', 'from computer')");
  localWrite(t.dbPath, "insert into item values ('p1', 'pending')");
  const before = read(t.dbPath, (db) => dumpData(db));
  const outbox = t.outbox().map((row) => row.id);

  // The new release's migration fails on the phone.
  const broken: Release = {
    id: "rel_2",
    data_schema: 2,
    migrations: [...t.rel1.migrations, { from: 1, to: 2, sql: "alter table missing add column note text;" }],
  };
  await t.computer.activate(broken, false);
  const failed = await switchRelease(t.ctx, t.installed(), [t.computer.entry(broken)]);
  assert.equal(failed.ok, false);
  assert.deepEqual(read(t.dbPath, (db) => dumpData(db)), before);
  assert.deepEqual(
    t.outbox().map((row) => row.id),
    outbox,
  );
  assert.equal(t.installed().release, "rel_1");
  assert.deepEqual(t.files.list(t.at.releases), ["rel_1"]);

  // A good one: the pending change is re-expressed on the new release's snapshot.
  const good: Release = {
    id: "rel_3",
    data_schema: 2,
    migrations: [...t.rel1.migrations, { from: 1, to: 2, sql: "alter table item add column note text;" }],
  };
  await t.computer.activate(good);
  const switched = await switchRelease(t.ctx, t.installed(), [t.computer.entry(good)]);
  assert.ok(switched.ok, switched.ok ? "" : switched.error.message);
  assert.equal(t.installed().release, "rel_3");
  assert.equal(t.installed().backup, "rel_3");
  assert.deepEqual(items(t.dbPath), ["c1:from computer", "p1:pending"]);
  assert.equal(t.outbox().length, 1);
  assert.ok(t.files.exists(t.at.backup("rel_3")));

  // The first push fails: the backup stays. Once it goes through, the backup goes.
  t.computer.state.pushFailsAfter = 0;
  assert.equal((await push(t.ctx, t.installed())).ok, false);
  assert.ok(t.files.exists(t.at.backup("rel_3")));
  t.computer.state.pushFailsAfter = null;
  assert.ok((await push(t.ctx, t.installed())).ok);
  assert.equal(t.files.exists(t.at.backup("rel_3")), false);
  assert.equal(t.installed().backup, null);
  assert.deepEqual(t.computer.items(), ["c1:from computer", "p1:pending"]);
});

test("an external call goes to the computer only after the outbox reached it; otherwise it is unavailable and not sent", async () => {
  const t = await setup();
  await t.install();
  const store = createLocalApps({ ...t.deps, computer: COMPUTER, node: async () => "dev_phone" });
  store.connect(t.computer.remote);
  localWrite(t.dbPath, "insert into item values ('p1', 'before report')");

  let sent: string[] | null = null;
  const send = async () => {
    sent = t.computer.items();
    return { ok: true as const, value: { sent: true } };
  };
  t.computer.state.pushFailsAfter = 0;
  const refused = await store.external(APP, send);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.error.code, "unavailable");
  assert.equal(sent, null);
  assert.equal(t.outbox().length, 1);

  t.computer.state.pushFailsAfter = null;
  const outcome = await store.external(APP, send);
  assert.ok(outcome.ok);
  assert.deepEqual(sent, ["p1:before report"]);
  assert.equal(t.outbox().length, 0);
});

test("a pulled batch is stamped, applied and moves the cursor in one transaction", async () => {
  const t = await setup();
  await t.install();
  t.computer.write("insert into item values ('c1', 'one')");
  t.computer.write("insert into item values ('c2', 'two')");
  localWrite(t.dbPath, "insert into item values ('p1', 'mine')");

  // A batch whose second change does not fit this database (another release's table): nothing of it stays.
  const other = new DatabaseSync(":memory:");
  other.exec("create table other (id text primary key)");
  const session = other.createSession({ table: "other" });
  other.exec("insert into other values ('x')");
  const foreign = session.changeset();
  const good = await pullOne(t);
  const db = openDb(t.dbPath);
  try {
    const result = applyBatch(t.deps, db, [good, { hlc: good.hlc + BigInt(1), changeset: foreign }], 9);
    assert.equal(result.ok, false);
    assert.equal(getState(db, "cursor"), "0");
    assert.equal(readOutbox(db)[0]?.hlc, null);
  } finally {
    db.close();
  }
  assert.deepEqual(items(t.dbPath), ["p1:mine"]);

  const pulled = await pull(t.ctx, t.installed());
  assert.ok(pulled.ok);
  assert.deepEqual(items(t.dbPath), ["c1:one", "c2:two", "p1:mine"]);
  read(t.dbPath, (db) => {
    assert.equal(getState(db, "cursor"), "2");
    assert.notEqual(readOutbox(db)[0]?.hlc, null);
  });
});

// The computer's first logged change, as pull hands it over (the install's snapshot was taken before it).
async function pullOne(t: Awaited<ReturnType<typeof setup>>) {
  const reply = await t.computer.remote.call({
    kind: "read",
    resource: "app_sync",
    method: "pull",
    body: { app: APP, release: "rel_1", after: 0 },
  });
  const change = (reply.value as { changes: { hlc: string; changeset: string }[] }).changes[0]!;
  return { hlc: BigInt(change.hlc), changeset: new Uint8Array(Buffer.from(change.changeset, "base64")) };
}
