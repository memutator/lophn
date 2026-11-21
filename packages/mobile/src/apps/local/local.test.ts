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
  migrate,
  openClock,
  readOutbox,
  stampLocal,
  type SyncDb,
} from "../../../../protocol/apps/sync/mod.ts";
import { nodeSyncDb } from "../../../../protocol/apps/sync/node-db.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import {
  migrateLegacyFolders,
  paths,
  readInstalled,
  writeInstalled,
} from "./folder.ts";
import { type Ctx, install } from "./install.ts";
import type { HostDb, LocalDeps, LocalFiles, Remote } from "./ports.ts";
import { fakeFiles } from "../files/fake-computer.ts";
import { createFilePlace } from "../files/place.ts";
import type { AppFileHandle } from "../../../../protocol/apps/app-file-values.ts";
import { pruneApp } from "./prune.ts";
import { missingFor } from "./held.ts";
import { switchRelease } from "./release.ts";
import { createLocalApps } from "./store.ts";
import { applyBatch, cursorKey, pull, push, readCursor } from "./sync.ts";
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
    readRange: (path, offset, length) =>
      new Uint8Array(readFileSync(at(path)).subarray(offset, offset + length)),
    async copyIn(source, path) {
      copyFileSync(source, made(path));
    },
    uri: (path) => `file://${at(path)}`,
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

const COMMIT_1 = "1".repeat(40);
const COMMIT_2 = "2".repeat(40);
const COMMIT_3 = "3".repeat(40);

type Release = {
  id: string;
  code_commit?: string;
  bundle_hash?: string;
  data_schema: number;
  migrations: { from: number; to: number; sql: string }[];
};

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

async function fakeComputer(
  dir: string,
  first: Release,
  runsOn: ("computer" | "phone")[] = ["computer", "phone"],
  name = "computer",
) {
  const dbPath = join(dir, `${name}.sqlite`);
  const raw = new DatabaseSync(dbPath);
  const db = nodeSyncDb(raw);
  await migrated(db, first);
  ensureSyncTables(db, name);
  const clock = openClock(db);
  const log: { seq: number; release: string; hlc: bigint; changeset: Uint8Array; device: string }[] = [];
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

  const commitOf = (release: Release) => release.code_commit ?? COMMIT_1;

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
      phone_capabilities: [],
      code_commit: commitOf(release),
      bundle_hash: release.bundle_hash ?? sha(screen),
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
            return fail("conflict", "the release is not active", {
              active_release: state.release.id,
              active_code_commit: commitOf(state.release),
            });
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
            log.push({ seq: log.length + 1, release: state.release.id, hlc: BigInt(change.hlc), changeset, device: "phone" });
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
                .filter((row) => row.release === state.release.id && row.seq > after && row.device !== "phone")
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
      log.push({ seq: log.length + 1, release: state.release.id, hlc, changeset, device: "computer" });
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
  const at = paths(APP);
  return {
    dir,
    deps,
    files,
    computer,
    ctx,
    rel1,
    at,
    dbPath: files.absolute(at.db),
    installed: () => readInstalled(files, APP)!,
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
  assert.equal(await pruneApp(t.deps, APP), false);
  assert.ok(t.files.exists(t.at.db));

  t.computer.state.pushFailsAfter = null;
  const sent = await push(t.ctx, t.installed());
  assert.ok(sent.ok);
  assert.deepEqual(sent.value, { pushed: 2, left: 0 });
  assert.deepEqual(t.computer.items(), ["a:phone a", "b:phone b", "c:phone c"]);
  assert.equal(await pruneApp(t.deps, APP), true);
  assert.equal(t.files.exists(t.at.dir), false);

  // A standalone app: its own empty database, migrated on the phone, and never pruned.
  const alone = await setup(["phone"]);
  const installed = await alone.install();
  assert.equal(installed.kind, "standalone");
  localWrite(alone.dbPath, "insert into item values ('x', 'only here')", false);
  assert.equal(await pruneApp(alone.deps, APP), false);
  assert.deepEqual(items(alone.dbPath), ["x:only here"]);
});

// A photo taken in a phone-run sync app is the app's data until every computer of the app has it. What a computer lacks is the
// files folder minus that computer's record, so each computer gets each file once, a record that cannot be read costs a cheap
// `have` and not a file, a file one computer refuses for good blocks no rows, and the folder is kept while a computer lacks one.
test("each computer gets the files it lacks before any row; a lost record offers again; a refused file blocks nothing; prune waits", async () => {
  const t = await setup();
  await t.install();
  let n = 0;
  const place = createFilePlace({
    files: t.files,
    dir: t.at.files,
    app: APP,
    keeping: () => ({ kind: "sync", changed: () => {}, acked: () => {} }),
    links: () => [],
    target: () => ({ mode: "live", app: APP, release: null }),
    newName: () => `n${++n}`,
    now: Date.now,
    sleep: async () => {},
  });
  const handles: AppFileHandle[] = [];
  for (const text of ["first photo", "second photo"]) {
    t.files.write("picked/p", text);
    const added = await place.add({ uri: t.files.absolute("picked/p"), type: "image/jpeg" });
    assert.ok(added.ok);
    handles.push(added.value);
  }
  const [first, second] = handles as [AppFileHandle, AppFileHandle];
  const installed = () => ({ ...t.installed(), computers: ["c1", "c2"] });
  writeInstalled(t.files, installed());

  // c1 is away for the files: no row goes (files before rows) and nothing is acknowledged.
  const c1 = fakeFiles(t.computer.remote);
  c1.breaks = 100;
  localWrite(t.dbPath, "insert into item values ('p1', 'names a photo')");
  assert.equal((await push({ ...t.ctx, remote: c1.remote }, installed())).ok, false);
  assert.deepEqual(t.computer.items(), []);
  assert.equal(missingFor(t.files, APP, "c1").length, 2);

  // c1 takes both files, then the rows. c2 has none of them in its record: it gets them too (a file added once).
  c1.breaks = 0;
  assert.ok((await push({ ...t.ctx, remote: c1.remote }, installed())).ok);
  assert.deepEqual([...c1.files.keys()].sort(), [first.file, second.file].sort());
  assert.deepEqual(t.computer.items(), ["p1:names a photo"]);
  const c2 = fakeFiles(t.computer.remote);
  assert.ok((await push({ ...t.ctx, computer: "c2", remote: c2.remote }, installed())).ok);
  assert.deepEqual([...c2.files.keys()].sort(), [first.file, second.file].sort());

  // c1's record is lost: both files are offered again and answered `have` after an empty piece, no bytes are sent again.
  t.files.write(t.at.held("c1"), "{not json");
  c1.puts.length = 0;
  assert.ok((await push({ ...t.ctx, remote: c1.remote }, installed())).ok);
  assert.deepEqual(c1.puts, [[0, 0], [0, 0]]);
  assert.equal(missingFor(t.files, APP, "c1").length, 0);

  // A third file that c1 refuses for good: it is remembered, the rows still go, and it is not pending nor offered again.
  t.files.write("picked/p", "a file c1 cannot take");
  const third = await place.add({ uri: t.files.absolute("picked/p"), type: "image/jpeg" });
  assert.ok(third.ok);
  c1.refuse.add(third.value.file);
  localWrite(t.dbPath, "insert into item values ('p2', 'after the refusal')");
  const sent = await push({ ...t.ctx, remote: c1.remote }, installed());
  assert.ok(sent.ok);
  assert.ok(t.computer.items().includes("p2:after the refusal"));
  assert.equal(missingFor(t.files, APP, "c1").length, 0);
  c1.puts.length = 0;
  assert.ok((await push({ ...t.ctx, remote: c1.remote }, installed())).ok);
  assert.deepEqual(c1.puts, []);

  // c2 has not taken the third file: the app's folder stays even with no row left to send.
  assert.equal(await pruneApp(t.deps, APP), false);
  assert.ok(t.files.exists(t.at.db));
  assert.ok((await push({ ...t.ctx, computer: "c2", remote: c2.remote }, installed())).ok);
  assert.equal(await pruneApp(t.deps, APP), true);
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
    code_commit: COMMIT_2,
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
    code_commit: COMMIT_3,
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
  const store = createLocalApps({ ...t.deps, node: async () => "dev_phone" });
  store.connect(COMPUTER, t.computer.remote);
  localWrite(t.dbPath, "insert into item values ('p1', 'before report')");

  let sent: string[] | null = null;
  const send = async () => {
    sent = t.computer.items();
    return { ok: true as const, value: { sent: true } };
  };
  t.computer.state.pushFailsAfter = 0;
  const refused = await store.external(COMPUTER, APP, send);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.error.code, "unavailable");
  assert.equal(sent, null);
  assert.equal(t.outbox().length, 1);

  t.computer.state.pushFailsAfter = null;
  const outcome = await store.external(COMPUTER, APP, send);
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
    const result = applyBatch(
      t.deps,
      db,
      [good, { hlc: good.hlc + BigInt(1), changeset: foreign }],
      9,
      COMPUTER,
    );
    assert.equal(result.ok, false);
    assert.equal(readCursor(db, COMPUTER), 0);
    assert.equal(readOutbox(db)[0]?.hlc, null);
  } finally {
    db.close();
  }
  assert.deepEqual(items(t.dbPath), ["p1:mine"]);

  const pulled = await pull(t.ctx, t.installed());
  assert.ok(pulled.ok);
  assert.deepEqual(items(t.dbPath), ["c1:one", "c2:two", "p1:mine"]);
  read(t.dbPath, (db) => {
    assert.equal(readCursor(db, COMPUTER), 2);
    assert.notEqual(readOutbox(db)[0]?.hlc, null);
  });
});

async function waitFor(check: () => boolean, limitMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > limitMs) throw new Error("timed out waiting for local store");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("multiple paired computers share one phone DB with per-computer cursors, same-commit cross-machine identity, serialized sync, lag skipping, and newest-release upgrade", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-local-multi-"));
  dirs.push(dir);
  const files = nodeFiles(join(dir, "apps"));
  const deps: LocalDeps = { files, open: openDb, now: Date.now };
  // c1 and c2 built the same commit locally on different OSes: distinct local rel_* ULIDs and bundle_hashes.
  const rel1a: Release = {
    id: "rel_1_a",
    code_commit: COMMIT_1,
    bundle_hash: "a".repeat(64),
    data_schema: 1,
    migrations: [{ from: 0, to: 1, sql: ITEM }],
  };
  const rel1b: Release = {
    id: "rel_1_b",
    code_commit: COMMIT_1,
    bundle_hash: "b".repeat(64),
    data_schema: 1,
    migrations: [{ from: 0, to: 1, sql: ITEM }],
  };
  const c1 = await fakeComputer(dir, rel1a, ["computer", "phone"], "c1");
  const c2 = await fakeComputer(dir, rel1b, ["computer", "phone"], "c2");
  c1.write("insert into item values ('a1', 'from c1')");
  c2.write("insert into item values ('b1', 'from c2')");

  const store = createLocalApps({ ...deps, node: async () => "dev_phone" });
  store.connect("c1", c1.remote);
  store.connect("c2", c2.remote);
  store.list("c1", [c1.entry(rel1a)], () => {});
  store.list("c2", [c2.entry(rel1b)], () => {});

  const dbPath = files.absolute(paths(APP).db);
  await waitFor(
    () =>
      store.installed(APP) !== null &&
      files.exists(paths(APP).db) &&
      items(dbPath).length === 2,
  );
  // One shared DB holds rows from both computers, with independent per-computer cursors and release tokens.
  assert.deepEqual(files.list(""), [APP]);
  assert.deepEqual(items(dbPath), ["a1:from c1", "b1:from c2"]);
  assert.deepEqual([...store.installed(APP)!.computers].sort(), ["c1", "c2"]);
  assert.equal(store.installed(APP)!.code_commit, COMMIT_1);
  assert.deepEqual(store.installed(APP)!.computer_releases, { c1: "rel_1_a", c2: "rel_1_b" });
  // Same commit on c2 must not trigger a reinstall or bundle download from c2.
  assert.equal(c2.state.calls.includes("apps/phone_file"), false);
  read(dbPath, (db) => {
    assert.equal(readCursor(db, "c1"), 1);
    assert.equal(readCursor(db, "c2"), 1);
  });

  // Concurrent AppSyncChanged from both computers serializes cleanly on the single DB.
  c1.write("insert into item values ('a2', 'c1 second')");
  c2.write("insert into item values ('b2', 'c2 second')");
  store.changed("c1", APP);
  store.changed("c2", APP);
  await waitFor(() => items(dbPath).length === 4);
  assert.deepEqual(items(dbPath), ["a1:from c1", "a2:c1 second", "b1:from c2", "b2:c2 second"]);
  read(dbPath, (db) => {
    assert.equal(readCursor(db, "c1"), 2);
    assert.equal(readCursor(db, "c2"), 2);
  });

  // With c1 offline, a phone write pushes to c2 using c2's own rel_1_b token and clears the acked outbox row.
  store.connect("c1", null);
  localWrite(dbPath, "insert into item values ('p1', 'from phone')");
  store.localChange(APP);
  await waitFor(() => c2.items().includes("p1:from phone") && read(dbPath, readOutbox).length === 0);
  assert.equal(read(dbPath, readOutbox).length, 0);

  // c1 upgrades to COMMIT_2 (rel_2_a) while c2 lags at COMMIT_1 (rel_1_b): phone upgrades and skips c2.
  const rel2a: Release = {
    id: "rel_2_a",
    code_commit: COMMIT_2,
    bundle_hash: "c".repeat(64),
    data_schema: 2,
    migrations: [...rel1a.migrations, { from: 1, to: 2, sql: "alter table item add column note text;" }],
  };
  await c1.activate(rel2a);
  c1.write("insert into item (id, title) values ('a3', 'on rel2')");
  store.connect("c1", c1.remote);
  store.list("c1", [c1.entry(rel2a)], () => {});
  await waitFor(() => store.installed(APP)?.code_commit === COMMIT_2);

  // c2 (still on COMMIT_1) triggers list & changed: must be skipped, phone stays on COMMIT_2 and ready.
  const c2CallsBefore = c2.state.calls.length;
  store.list("c2", [c2.entry(rel1b)], () => {});
  store.changed("c2", APP);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(store.installed(APP)?.code_commit, COMMIT_2);
  assert.equal(store.get().find((one) => one.app === APP)?.state, "ready");
  assert.equal(c2.state.calls.length, c2CallsBefore);

  // Once c2 catches up to COMMIT_2 with its own local rel_2_b, phone syncs with c2 without reinstalling.
  const rel2b: Release = {
    id: "rel_2_b",
    code_commit: COMMIT_2,
    bundle_hash: "d".repeat(64),
    data_schema: 2,
    migrations: [...rel1b.migrations, { from: 1, to: 2, sql: "alter table item add column note text;" }],
  };
  await c2.activate(rel2b);
  c2.write("insert into item (id, title) values ('b3', 'c2 on rel2')");
  store.list("c2", [c2.entry(rel2b)], () => {});
  await waitFor(() => items(dbPath).includes("b3:c2 on rel2"));
  assert.equal(c2.state.calls.includes("apps/phone_file"), false);
  assert.deepEqual(store.installed(APP)!.computer_releases, { c1: "rel_2_a", c2: "rel_2_b" });
  assert.ok(items(dbPath).includes("a3:on rel2"));
  assert.ok(items(dbPath).includes("b3:c2 on rel2"));
});

test("legacy <computer>/<app> folders migrate seamlessly into <app> preserving legacy cursor for that computer and standalone data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-local-migrate-"));
  dirs.push(dir);
  const files = nodeFiles(join(dir, "apps"));
  const deps: LocalDeps = { files, open: openDb, now: Date.now };
  const rel1: Release = { id: "rel_1", data_schema: 1, migrations: [{ from: 0, to: 1, sql: ITEM }] };
  const c1 = await fakeComputer(dir, rel1, ["computer", "phone"], "c1");
  const c2 = await fakeComputer(dir, rel1, ["computer", "phone"], "c2");
  c1.write("insert into item values ('old', 'already on phone')");
  c2.write("insert into item values ('c2_only', 'from c2')");

  // Simulate legacy layout files/apps/c1/<APP>/ with only the legacy single `cursor` key ("1").
  const installed = await install({ deps, remote: c1.remote, computer: "c1", node: "dev_phone" }, [c1.entry(rel1)]);
  assert.ok(installed.ok);
  read(files.absolute(paths(APP).db), (db) => {
    db.run("delete from lophn_sync_state where key = ?", [cursorKey("c1")]);
  });
  const legacyRecord = { ...installed.value, computers: [] };
  writeInstalled(files, legacyRecord);
  files.move(paths(APP).dir, `c1/${APP}`);
  assert.equal(files.exists(paths(APP).dir), false);
  assert.equal(files.exists(`c1/${APP}/installed.json`), true);

  // Also simulate a legacy standalone app under c1/app_alone/.
  const aloneDir = "c1/app_alone";
  files.write(
    `${aloneDir}/installed.json`,
    JSON.stringify({ ...installed.value, app: "app_alone", kind: "standalone", computers: [] }),
  );
  files.write(`${aloneDir}/marker.txt`, "keep me");

  migrateLegacyFolders(deps);
  assert.equal(files.exists("c1"), false);
  assert.equal(files.exists(paths(APP).installed), true);
  assert.equal(readInstalled(files, APP)?.migrated_from, "c1");
  assert.deepEqual(readInstalled(files, APP)?.computers, ["c1"]);
  assert.equal(files.readText("app_alone/marker.txt"), "keep me");
  assert.equal(readInstalled(files, "app_alone")?.kind, "standalone");

  // Pull from c1 falls back to legacy cursor ("1"), so only seq 2 is fetched; pull from c2 starts at 0.
  c1.write("insert into item values ('new_c1', 'after migrate')");
  const pulled1 = await pull({ deps, remote: c1.remote, computer: "c1" }, readInstalled(files, APP)!);
  assert.ok(pulled1.ok);
  assert.equal(pulled1.value.applied, 1);
  const pulled2 = await pull({ deps, remote: c2.remote, computer: "c2" }, readInstalled(files, APP)!);
  assert.ok(pulled2.ok);
  assert.equal(pulled2.value.applied, 1);
  assert.deepEqual(items(files.absolute(paths(APP).db)), [
    "c2_only:from c2",
    "new_c1:after migrate",
    "old:already on phone",
  ]);
});

// An app that lives only on the phone keeps its data and opens after an update of the phone app: a record written before
// screens carried `phone_capabilities` loads (with none), and a later list of the same release carries the grants in.
test("an install record written before phone capabilities loads, and a list of the same release updates its capabilities", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-local-caps-"));
  dirs.push(dir);
  const files = nodeFiles(join(dir, "apps"));
  const deps: LocalDeps = { files, open: openDb, now: Date.now };
  const rel1: Release = { id: "rel_1", data_schema: 1, migrations: [{ from: 0, to: 1, sql: ITEM }] };
  const c1 = await fakeComputer(dir, rel1, ["phone"], "c1");
  const installed = await install({ deps, remote: c1.remote, computer: "c1", node: "dev_phone" }, [c1.entry(rel1)]);
  assert.ok(installed.ok);
  const old = JSON.parse(JSON.stringify(installed.value));
  for (const screen of old.screens) delete screen.phone_capabilities;
  files.write(paths(APP).installed, JSON.stringify(old));
  assert.deepEqual(readInstalled(files, APP)?.screens.map((s) => s.phone_capabilities), [[]]);
  assert.equal(files.exists(paths(APP).db), true);

  const store = createLocalApps({ ...deps, node: async () => "dev_phone" });
  store.list("c1", [{ ...c1.entry(rel1), phone_capabilities: ["network.get"] }], () => {});
  assert.deepEqual(store.installed(APP)?.screens.map((s) => s.phone_capabilities), [["network.get"]]);
  store.list("c1", [c1.entry(rel1)], () => {});
  assert.deepEqual(store.installed(APP)?.screens.map((s) => s.phone_capabilities), [[]]);
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
