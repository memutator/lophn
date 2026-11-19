// 다른 release·다른 꼴 판의 기계에서 온 file. 적용은 sync core 위의 작은 실제 FolderApply다(앱 DB 하나).
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  applyRemote,
  dumpData,
  ensureSyncTables,
  mergeSnapshot,
  openClock,
  type Clock as SyncClock,
  type SyncDb,
  stampLocal,
} from "../../../protocol/apps/sync/mod.ts";
import { nodeSyncDb } from "../../../protocol/apps/sync/node-db.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  appRecordPath,
  containerPrefix,
  dataEntryPath,
  encodeChanges,
  recordPath,
} from "../../../protocol/folder/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { createSql } from "../../storage/ledger/sqlite.ts";
import type { FolderApply } from "../ports.ts";
import { FOLDER_CODE_COMMIT_STEPS, FOLDER_SCHEMA_STEPS } from "../schema.ts";
import { exchangeWith } from "./compat.ts";
import { createFolderImport } from "./mod.ts";

const ME = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const P = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const Q = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const R1 = {
  id: "rel_01h1111111111111111111111z" as Id<"rel">,
  commit: "1".repeat(40),
};
const R2 = {
  id: "rel_01h2222222222222222222222z" as Id<"rel">,
  commit: "2".repeat(40),
};
const R3 = {
  id: "rel_01h3333333333333333333333z" as Id<"rel">,
  commit: "3".repeat(40),
};
const T0 = Date.UTC(2026, 10, 17);
const HOUR = 60 * 60 * 1000;

type Replica = { raw: DatabaseSync; db: SyncDb; clock: SyncClock };

function replica(node: string): Replica {
  const raw = new DatabaseSync(":memory:");
  raw.exec("create table notes (id text primary key, title text)");
  raw.exec("pragma foreign_keys = off");
  const db = nodeSyncDb(raw);
  ensureSyncTables(db, node);
  return { raw, db, clock: openClock(db) };
}

// 출처 기계의 앱 write 하나: data와 changeset과 clock.
function write(r: Replica, atMs: number, sql: string) {
  r.db.exec("begin immediate");
  const session = r.db.session();
  r.db.exec(sql);
  const changeset = session.changeset();
  session.close();
  const hlc = r.clock.next(atMs);
  assert.ok(stampLocal(r.db, changeset, hlc).ok);
  r.db.exec("commit");
  return { hlc, changeset };
}

async function setup(
  run: (env: Awaited<ReturnType<typeof make>>) => Promise<void>,
) {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-held-"));
  const env = await make(base);
  try {
    await run(env);
  } finally {
    env.ledger.close();
    await rm(base, { recursive: true, force: true });
  }
}

async function make(base: string) {
  const dest = join(base, "dest");
  const root = join(base, "root");
  mkdirSync(dest);
  mkdirSync(root);
  const ledger = new DatabaseSync(":memory:");
  for (const step of [...FOLDER_SCHEMA_STEPS, ...FOLDER_CODE_COMMIT_STEPS]) {
    ledger.exec(step.sql);
  }
  const sql: Sql = createSql(ledger, () => true);
  const clock = manualClock(T0);
  const here = replica("here");
  let active = R1;
  let heldMax: number | undefined;
  // 출처와 변경 id(= file 번호). 적용한 순서.
  const applied: string[] = [];
  const failOnce = new Set<string>();
  const tag = (origin: Id<"mch">, id: string | number) =>
    `${origin === P ? "P" : "Q"}${id}`;
  const apply: FolderApply = {
    async applyChanges(input) {
      if (input.release !== active.id) {
        return err({ code: "conflict", message: "active release differs" });
      }
      const first = tag(input.origin, input.changes[0]!.id);
      if (failOnce.delete(first)) {
        return err({ code: "unavailable", message: "the app stopped" });
      }
      here.db.exec("begin immediate");
      const done = applyRemote(
        here.db,
        input.changes.map((c) => ({
          hlc: BigInt(c.hlc),
          changeset: c.changeset,
        })),
        here.clock,
      );
      here.db.exec(done.ok ? "commit" : "rollback");
      if (!done.ok) return done;
      applied.push(...input.changes.map((c) => tag(input.origin, c.id)));
      return ok({
        applied: input.changes.length,
        skipped: 0,
        duplicate: 0,
        held: 0,
      });
    },
    async mergeSnapshot(input) {
      if (input.release !== active.id) {
        return err({ code: "conflict", message: "active release differs" });
      }
      const source = new DatabaseSync(":memory:");
      source.deserialize(readFileSync(input.path));
      here.db.exec("begin immediate");
      const merged = mergeSnapshot(here.db, nodeSyncDb(source), here.clock);
      here.db.exec(merged.ok ? "commit" : "rollback");
      source.close();
      if (!merged.ok) return merged;
      applied.push(`${tag(input.origin, input.n)} snapshot`);
      return ok({ changed: true, deleted: 0 });
    },
  };
  const folder = createFolderImport({
    machine: () => ME,
    self: () => ({ name: "Desk", lophn_version: "0.23.0" }),
    destinations: {
      list: () => [{ name: "personal", path: dest, state: "ok" }],
      resolve: (name) =>
        name === "personal" ? { path: dest, state: "ok" } : null,
    },
    apps: () => [
      {
        app: APP,
        sync_to: "personal",
        release: { id: active.id, code_commit: active.commit, data_schema: 1 },
      },
    ],
    apply,
    exportState: () => ({ settled: null, data_head: 0, away_since: null }),
    heldRows: () => [],
    sql,
    transaction<T>(fn: (tx: { readonly sql: Sql }) => Result<T>): Result<T> {
      ledger.exec("BEGIN");
      try {
        const result = fn({ sql });
        ledger.exec(result.ok ? "COMMIT" : "ROLLBACK");
        return result;
      } catch (thrown) {
        ledger.exec("ROLLBACK");
        throw thrown;
      }
    },
    clock,
    random: seededRandom(11),
    root,
    get heldMaxBytes() {
      return heldMax;
    },
  });
  const put = (rel: string, bytes: Uint8Array | string) => {
    const path = join(dest, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  };
  let revision = 0;
  const putMachine = (
    origin: Id<"mch">,
    folderFormat: { version: number; min_version: number } = {
      version: 2,
      min_version: 2,
    },
  ) => {
    revision += 1;
    put(
      recordPath(origin),
      JSON.stringify({
        format: 1,
        machine: origin,
        revision,
        updated_at: clock.now(),
        name: origin === P ? "Laptop" : "Tower",
        always_on: null,
        addresses: { lan: [], port: null, relay: null },
        lophn: {
          version: "0.24.0",
          protocol: { version: 2, min_version: 1 },
          folder: folderFormat,
        },
      }),
    );
  };
  const putApp = (
    origin: Id<"mch">,
    data: { head: number; snapshot: number | null } = {
      head: 0,
      snapshot: null,
    },
  ) => {
    revision += 1;
    put(
      appRecordPath(origin, APP),
      JSON.stringify({
        format: 2,
        machine: origin,
        app: APP,
        revision,
        updated_at: clock.now(),
        slug: "notes",
        name: "Notes",
        description: "",
        sync_to: "personal",
        active_release: null,
        data,
        source: { head: 0 },
        read: {},
        settled: null,
        horizon: null,
      }),
    );
  };
  const putChanges = async (
    origin: Id<"mch">,
    n: number,
    release: { commit: string },
    change: { hlc: bigint; changeset: Uint8Array },
  ) => {
    const file = await encodeChanges({
      machine: origin,
      app: APP,
      n,
      release: { code_commit: release.commit, data_schema: 1 },
      created_at: clock.now(),
      changes: [
        {
          meta: {
            id: String(n),
            hlc: String(change.hlc),
            origin: "computer",
            operation: "save",
            started_at: clock.now(),
          },
          bytes: change.changeset,
        },
      ],
    });
    assert.ok(file.ok);
    put(dataEntryPath(origin, APP, n, "changes"), file.value);
  };
  const putSnapshot = async (
    origin: Id<"mch">,
    n: number,
    release: { commit: string },
    of: Replica,
  ) => {
    const payload = of.raw.serialize();
    const head = await containerPrefix({
      machine: origin,
      app: APP,
      n,
      kind: "snapshot",
      release: { code_commit: release.commit, data_schema: 1 },
      created_at: clock.now(),
      payload: { size: payload.byteLength, sha256: await sha256Hex(payload) },
    });
    assert.ok(head.ok);
    put(
      dataEntryPath(origin, APP, n, "snapshot"),
      Buffer.concat([head.value, payload]),
    );
  };
  const heldRows = (origin: Id<"mch">) =>
    ledger
      .prepare(
        `SELECT n FROM folder_held WHERE machine = ? AND app = ? AND origin = ? ORDER BY n`,
      )
      .all(ME, APP, origin)
      .map((row) => Number(row.n));
  const heldCopies = (origin: Id<"mch">) => {
    const dir = join(root, "folder-held", APP, origin);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  };
  const cursor = (origin: Id<"mch">) =>
    folder.status(APP).find((row) => row.machine === origin)?.cursor ?? 0;
  const run = async () => {
    const outcome = await folder.runApp(APP);
    assert.ok(outcome.ok);
    return outcome.value.streams;
  };
  return {
    ledger,
    dest,
    clock,
    here,
    applied,
    failOnce,
    folder,
    setActive: (release: typeof R1) => {
      active = release;
    },
    setHeldMax: (bytes: number) => {
      heldMax = bytes;
    },
    fileSize: (origin: Id<"mch">, n: number) =>
      readFileSync(
        join(dest, ...dataEntryPath(origin, APP, n, "changes").split("/")),
      ).byteLength,
    putMachine,
    putApp,
    putChanges,
    putSnapshot,
    heldRows,
    heldCopies,
    cursor,
    run,
  };
}

// 다른 release의 변경을 먼저 적용하면 schema가 맞지 않고, 순서를 뒤집거나 빠뜨리면 두 기계의 data가 갈린다.
test("다른 release의 held는 이 기계가 그 release가 될 때까지 적용되지 않고, 된 뒤에는 출처마다 번호 순서대로 빠짐없이 적용되며, 그 동안 그 출처의 뒤 file은 적용되지 않는다. 적용이 실패하면 그 행부터 남는다", async () => {
  await setup(async (env) => {
    const x = replica("x");
    const y = replica("y");
    env.putMachine(P);
    env.putMachine(Q);
    // 두 출처가 이 기계보다 먼저 R2가 되어 쓴다.
    await env.putChanges(
      P,
      1,
      R2,
      write(x, T0 - 9000, "insert into notes values ('a', 'one')"),
    );
    await env.putChanges(
      P,
      2,
      R2,
      write(x, T0 - 8000, "update notes set title = 'two' where id = 'a'"),
    );
    await env.putChanges(
      P,
      3,
      R2,
      write(x, T0 - 7000, "insert into notes values ('b', 'three')"),
    );
    await env.putChanges(
      Q,
      1,
      R2,
      write(y, T0 - 6500, "insert into notes values ('q', 'from tower')"),
    );
    await env.folder.scan();
    await env.run();
    await env.run();
    assert.deepEqual(env.applied, []);
    assert.deepEqual(env.heldRows(P), [1, 2, 3]);
    assert.deepEqual(env.heldRows(Q), [1]);
    assert.deepEqual(
      env.folder.exchange
        .held(APP)
        .map(({ origin, code_commit, changes, full }) => ({
          origin,
          code_commit,
          changes,
          full,
        })),
      [
        { origin: Q, code_commit: R2.commit, changes: 1, full: false },
        { origin: P, code_commit: R2.commit, changes: 3, full: false },
      ],
    );

    // 이 기계가 R2가 된다. P의 뒤 file 4가 폴더에 있고, held 2의 적용이 한 번 실패한다.
    await env.putChanges(
      P,
      4,
      R2,
      write(x, T0 - 6000, "update notes set title = 'four' where id = 'b'"),
    );
    env.setActive(R2);
    env.failOnce.add("P2");
    let streams = await env.run();
    assert.deepEqual(env.applied, ["Q1", "P1"]);
    assert.deepEqual(env.heldRows(P), [2, 3]);
    assert.deepEqual(env.heldCopies(P), [
      "000000000002.changes",
      "000000000003.changes",
    ]);
    assert.deepEqual(env.heldRows(Q), []);
    assert.deepEqual(env.heldCopies(Q), []);
    assert.equal(env.cursor(P), 3);
    assert.equal(
      streams.find((s) => s.machine === P)?.error?.code,
      "app_not_running",
    );

    // 물러남이 지나면 같은 행부터 잇고, held를 다 적용한 뒤에야 stream의 4를 읽는다.
    env.clock.advance(2 * HOUR);
    streams = await env.run();
    assert.deepEqual(env.applied, ["Q1", "P1", "P2", "P3", "P4"]);
    assert.deepEqual(env.heldRows(P), []);
    assert.deepEqual(env.heldCopies(P), []);
    assert.equal(env.cursor(P), 4);
    assert.equal(streams.find((s) => s.machine === P)?.error, null);
    const theirs = replica("both");
    theirs.raw.exec(
      "insert into notes values ('a', 'two'), ('b', 'four'), ('q', 'from tower')",
    );
    assert.equal(dumpData(env.here.db), dumpData(theirs.db));
  });
});

// snapshot m은 m 앞의 변경을 모두 담는다. 그보다 옛 held를 두면 한도와 drain에 남고, 다른 held를 지우면 변경을 잃는다.
test("출처의 snapshot m이 합쳐지거나 held가 되면 그보다 옛 held만 지워지고, 그 밖의 held는 지워지지 않는다", async () => {
  await setup(async (env) => {
    const x = replica("x");
    const y = replica("y");
    env.putMachine(P);
    env.putMachine(Q);
    await env.putChanges(
      P,
      1,
      R2,
      write(x, T0 - 9000, "insert into notes values ('a', 'one')"),
    );
    await env.putChanges(
      P,
      2,
      R2,
      write(x, T0 - 8000, "update notes set title = 'two' where id = 'a'"),
    );
    await env.putChanges(
      Q,
      1,
      R2,
      write(y, T0 - 7500, "insert into notes values ('q', 'from tower')"),
    );
    await env.folder.scan();
    await env.run();
    assert.deepEqual(env.heldRows(P), [1, 2]);

    // P가 R3로 올라 첫 file로 snapshot 3을 쓴다(이 기계는 R1): held가 되고 P의 1, 2(R2)를 담는다.
    write(x, T0 - 7000, "insert into notes values ('b', 'three')");
    await env.putSnapshot(P, 3, R3, x);
    await env.putChanges(
      P,
      4,
      R3,
      write(x, T0 - 6000, "update notes set title = 'four' where id = 'b'"),
    );
    await env.run();
    assert.deepEqual(env.heldRows(P), [3, 4]);
    assert.deepEqual(env.heldCopies(P), [
      "000000000003.snapshot",
      "000000000004.changes",
    ]);
    assert.deepEqual(env.heldRows(Q), [1]);

    // P가 이 기계의 release(R1)로 돌아와 snapshot 5를 쓴다: 합쳐지고 P의 3, 4가 지워진다. Q의 held는 남는다.
    await env.putSnapshot(P, 5, R1, x);
    await env.run();
    assert.deepEqual(env.applied, ["P5 snapshot"]);
    assert.deepEqual(env.heldRows(P), []);
    assert.deepEqual(env.heldCopies(P), []);
    assert.deepEqual(env.heldRows(Q), [1]);
    assert.deepEqual(env.heldCopies(Q), ["000000000001.changes"]);
    assert.equal(env.cursor(P), 5);
  });
});

// 모르는 꼴을 읽으면 틀리게 적용하고, 지우거나 cursor를 옮기면 그 기계가 올라온 뒤 받을 것을 잃는다.
test("폴더 꼴 판이 범위 밖인 기계의 file은 열리지도 복사되지도 지워지지도 않고 cursor가 그대로이며, 범위 안으로 돌아오면 그 cursor부터 잇는다", async () => {
  await setup(async (env) => {
    const x = replica("x");
    env.putMachine(P);
    env.putApp(P);
    await env.putChanges(
      P,
      1,
      R1,
      write(x, T0 - 9000, "insert into notes values ('a', 'one')"),
    );
    await env.folder.scan();
    await env.run();
    assert.deepEqual(env.applied, ["P1"]);
    assert.equal(env.folder.records().apps.length, 1);

    await env.putChanges(
      P,
      2,
      R1,
      write(x, T0 - 8000, "update notes set title = 'two' where id = 'a'"),
    );
    await env.putChanges(
      P,
      3,
      R2,
      write(x, T0 - 7000, "insert into notes values ('b', 'three')"),
    );
    const listing = () => {
      const dir = join(env.dest, "machines", P, "apps", APP, "data");
      return readdirSync(dir)
        .sort()
        .map((name) => [
          name,
          readFileSync(join(dir, name)).toString("base64"),
        ]);
    };
    const before = listing();
    for (const range of [
      { version: 3, min_version: 2 },
      { version: 2, min_version: 3 },
    ]) {
      env.putMachine(P, range);
      const scanned = await env.folder.scan();
      assert.ok(scanned.ok);
      assert.equal(scanned.value.errors[0]?.error.code, "newer_format");
      // 열면 깨진 file이라 invalid_file이 된다. 열지 않으면 newer_format 그대로다.
      for (const n of [2, 3]) {
        writeFileSync(
          join(env.dest, ...dataEntryPath(P, APP, n, "changes").split("/")),
          "not a folder file",
        );
      }
      const streams = await env.run();
      assert.equal(streams[0]?.error?.code, "newer_format");
      assert.deepEqual(env.applied, ["P1"]);
      assert.equal(env.cursor(P), 1);
      assert.deepEqual(env.heldRows(P), []);
      assert.equal(
        env.folder.exchange.machines().find((m) => m.machine === P)?.exchange,
        "update_this",
      );
      // 그 기계의 앱 기록으로 release·source를 읽지 않는다.
      assert.deepEqual(env.folder.records().apps, []);
      assert.deepEqual(
        listing().map(([name]) => name),
        before.map(([name]) => name),
      );
      // 깨뜨린 file을 되돌린다.
      for (const [name, bytes] of before) {
        writeFileSync(
          join(env.dest, "machines", P, "apps", APP, "data", name!),
          Buffer.from(bytes!, "base64"),
        );
      }
    }
    assert.deepEqual(listing(), before);

    env.putMachine(P);
    await env.folder.scan();
    await env.run();
    assert.deepEqual(env.applied, ["P1", "P2"]);
    assert.deepEqual(env.heldRows(P), [3]);
    assert.equal(env.cursor(P), 3);
    assert.equal(
      env.folder.exchange.machines().find((m) => m.machine === P)?.exchange,
      "ok",
    );
    assert.equal(env.folder.records().apps.length, 1);
  });
});

// 한도에서 복사하지 않은 file을 cursor가 지나치면 그 변경은 held에도 폴더 읽기에도 없어 잃고, 건너뛰지 못하면 그 출처가 영영 멈춘다.
test("held가 한도에 닿으면 넘을 file은 복사되지 않고 cursor가 그 앞에 남으며, 뒤에 출처의 snapshot이 오면 그리로 건너뛰어 옛 held를 지우고, 이 기계가 그 release가 되면 멈춘 cursor부터 폴더에서 읽는다", async () => {
  await setup(async (env) => {
    const x = replica("x");
    env.putMachine(P);
    env.putApp(P, { head: 3, snapshot: null });
    await env.putChanges(
      P,
      1,
      R2,
      write(x, T0 - 9000, "insert into notes values ('a', 'one')"),
    );
    await env.putChanges(
      P,
      2,
      R2,
      write(x, T0 - 8000, "update notes set title = 'two' where id = 'a'"),
    );
    await env.putChanges(
      P,
      3,
      R2,
      write(x, T0 - 7000, "insert into notes values ('b', 'three')"),
    );
    env.setHeldMax(env.fileSize(P, 1) + env.fileSize(P, 2));
    await env.folder.scan();
    await env.run();
    assert.deepEqual(env.heldRows(P), [1, 2]);
    assert.deepEqual(env.heldCopies(P), [
      "000000000001.changes",
      "000000000002.changes",
    ]);
    assert.equal(env.cursor(P), 2);
    assert.equal(env.folder.exchange.held(APP)[0]?.full, true);

    // 출처가 4를 쓰고 snapshot 5를 쓴다: 3에서 멈춘 stream이 5로 건너뛰고 5가 담는 1, 2를 지운다.
    await env.putChanges(
      P,
      4,
      R2,
      write(x, T0 - 6000, "update notes set title = 'four' where id = 'b'"),
    );
    await env.putSnapshot(P, 5, R2, x);
    env.putApp(P, { head: 5, snapshot: 5 });
    await env.folder.scan();
    await env.run();
    assert.deepEqual(env.heldRows(P), [5]);
    assert.deepEqual(env.heldCopies(P), ["000000000005.snapshot"]);
    assert.equal(env.cursor(P), 5);
    assert.equal(env.folder.exchange.held(APP)[0]?.full, false);

    // snapshot 뒤의 changes가 다시 한도에 닿는다.
    await env.putChanges(
      P,
      6,
      R2,
      write(x, T0 - 5000, "insert into notes values ('c', 'six')"),
    );
    await env.putChanges(
      P,
      7,
      R2,
      write(x, T0 - 4000, "update notes set title = 'seven' where id = 'c'"),
    );
    env.putApp(P, { head: 7, snapshot: 5 });
    env.setHeldMax(env.fileSize(P, 6));
    await env.folder.scan();
    await env.run();
    assert.deepEqual(env.heldRows(P), [5, 6]);
    assert.equal(env.cursor(P), 6);
    assert.deepEqual(env.applied, []);

    // 이 기계가 R2가 된다: held를 번호 순서로 적용하고 멈춘 cursor 뒤의 7을 폴더에서 읽는다.
    env.setActive(R2);
    await env.run();
    assert.deepEqual(env.applied, ["P5 snapshot", "P6", "P7"]);
    assert.deepEqual(env.heldRows(P), []);
    assert.deepEqual(env.heldCopies(P), []);
    assert.equal(env.cursor(P), 7);
    const theirs = replica("both");
    theirs.raw.exec(
      "insert into notes values ('a', 'two'), ('b', 'four'), ('c', 'seven')",
    );
    assert.equal(dumpData(env.here.db), dumpData(theirs.db));
  });
});

// 틀리면 꼴 판을 처음 올리는 판에서 옛 판 기계의 file을 틀리게 읽거나, 누가 올려야 하는지 거꾸로 말한다.
test("꼴 판 범위는 서로 읽을 수 있으면 ok, 이 기계가 상대 file을 못 읽거나 상대가 이 기계 file을 못 읽으면 누가 올릴지를 가른다", () => {
  const own = { version: 2, min_version: 1 };
  const cases: [{ version: number; min_version: number }, string][] = [
    // 같은 판.
    [{ version: 2, min_version: 1 }, "ok"],
    // 상대가 새 판을 쓴다: 이 기계가 읽지 못한다.
    [{ version: 3, min_version: 1 }, "update_this"],
    // 상대의 읽는 하한이 이 기계의 판보다 높다.
    [{ version: 2, min_version: 3 }, "update_this"],
    // 상대가 옛 판이다: 이 기계 file을 읽지 못한다.
    [{ version: 1, min_version: 1 }, "update_peer"],
    // 상대가 이 기계의 읽는 하한보다 옛 판을 쓴다.
    [{ version: 0, min_version: 0 }, "update_peer"],
  ];
  for (const [peer, want] of cases) {
    assert.equal(exchangeWith(peer, own), want, JSON.stringify(peer));
  }
  assert.equal(
    exchangeWith(
      { version: 1, min_version: 1 },
      { version: 2, min_version: 2 },
    ),
    "update_peer",
  );
});
