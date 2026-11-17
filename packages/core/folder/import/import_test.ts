import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  manualClock,
  ok,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  dropTombstones,
  ensureSyncTables,
  hlcAtMs,
  mergeSnapshot,
  openClock,
  type Clock as SyncClock,
  type SyncDb,
  setState,
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
import { FOLDER_SCHEMA_STEPS } from "../schema.ts";
import { createFolderImport, type FolderImportDeps } from "./mod.ts";

const ME = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const PEER = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"rel">;
const ACTIVE = "a".repeat(64);
const OTHER = "b".repeat(64);
const T0 = Date.UTC(2026, 10, 16);

type Call =
  | { kind: "changes"; ids: string[] }
  | { kind: "snapshot"; n: number; payload: string; absentDeletes?: unknown };

async function setup(
  run: (env: Awaited<ReturnType<typeof make>>) => Promise<void>,
) {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-import-"));
  const env = await make(base);
  try {
    await run(env);
  } finally {
    env.db.close();
    await rm(base, { recursive: true, force: true });
  }
}

async function make(base: string) {
  const dest = join(base, "dest");
  const root = join(base, "root");
  mkdirSync(dest);
  mkdirSync(root);
  const db = new DatabaseSync(":memory:");
  for (const step of FOLDER_SCHEMA_STEPS) db.exec(step.sql);
  const sql: Sql = createSql(db, () => true);
  const clock = manualClock(T0);
  const calls: Call[] = [];
  const exportState = {
    settled: null as string | null,
    data_head: 0,
    away_since: null as string | null,
  };
  const apply: FolderApply = {
    async applyChanges(input) {
      calls.push({ kind: "changes", ids: input.changes.map((c) => c.id) });
      return ok({
        applied: input.changes.length,
        skipped: 0,
        duplicate: 0,
        held: 0,
      });
    },
    async mergeSnapshot(input) {
      calls.push({
        kind: "snapshot",
        n: input.n,
        payload: readFileSync(input.path, "utf8"),
        ...(input.absentDeletes === undefined
          ? {}
          : { absentDeletes: input.absentDeletes }),
      });
      return ok({ changed: true, deleted: 0 });
    },
  };
  const deps: FolderImportDeps = {
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
        release: { id: REL, bundle_hash: ACTIVE, data_schema: 1 },
      },
    ],
    apply,
    exportState: () => exportState,
    heldRows: () => [{ table: "notes", pk: "01" }],
    sql,
    transaction<T>(fn: (tx: { readonly sql: Sql }) => Result<T>): Result<T> {
      db.exec("BEGIN");
      try {
        const result = fn({ sql });
        db.exec(result.ok ? "COMMIT" : "ROLLBACK");
        return result;
      } catch (thrown) {
        db.exec("ROLLBACK");
        throw thrown;
      }
    },
    clock,
    random: seededRandom(7),
    root,
  };
  const folder = createFolderImport(deps);
  const put = (rel: string, bytes: Uint8Array | string) => {
    const path = join(dest, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  };
  const machineRecord = (revision: number, name = "Laptop") => ({
    format: 1,
    machine: PEER,
    revision,
    updated_at: clock.now(),
    name,
    always_on: null,
    addresses: { lan: [], port: null, relay: null },
    lophn: {
      version: "0.23.0",
      protocol: { version: 2, min_version: 1 },
      folder: { version: 1, min_version: 1 },
    },
  });
  const appRecord = (
    revision: number,
    extra: Record<string, unknown> = {},
  ) => ({
    format: 1,
    machine: PEER,
    app: APP,
    revision,
    updated_at: clock.now(),
    slug: "notes",
    name: "Notes",
    description: "",
    sync_to: "personal",
    active_release: null,
    releases: [],
    data: { head: 0, snapshot: null },
    source: { head: 0 },
    read: {},
    settled: null,
    horizon: null,
    ...extra,
  });
  const putRecords = (revision: number, app: Record<string, unknown> = {}) => {
    put(recordPath(PEER), JSON.stringify(machineRecord(revision)));
    put(appRecordPath(PEER, APP), JSON.stringify(appRecord(revision, app)));
  };
  const changesFile = async (
    n: number,
    opts: { bundle?: string; aheadMs?: number } = {},
  ) => {
    const file = await encodeChanges({
      machine: PEER,
      app: APP,
      n,
      release: { bundle_hash: opts.bundle ?? ACTIVE, data_schema: 1 },
      created_at: clock.now(),
      changes: [
        {
          meta: {
            id: String(n),
            hlc: String(hlcAtMs(clock.nowMs() + (opts.aheadMs ?? 0))),
            origin: "computer",
            operation: "save",
            started_at: clock.now(),
          },
          bytes: new TextEncoder().encode(`change ${n}`),
        },
      ],
    });
    assert.ok(file.ok);
    return file.value;
  };
  const snapshotFile = async (
    n: number,
    payloadText: string | Uint8Array,
    bundle = ACTIVE,
  ) => {
    const payload =
      typeof payloadText === "string"
        ? new TextEncoder().encode(payloadText)
        : payloadText;
    const head = await containerPrefix({
      machine: PEER,
      app: APP,
      n,
      kind: "snapshot",
      release: { bundle_hash: bundle, data_schema: 1 },
      created_at: clock.now(),
      payload: { size: payload.byteLength, sha256: await sha256Hex(payload) },
    });
    assert.ok(head.ok);
    const file = new Uint8Array(head.value.byteLength + payload.byteLength);
    file.set(head.value);
    file.set(payload, head.value.byteLength);
    return file;
  };
  const putChanges = async (
    n: number,
    opts?: { bundle?: string; aheadMs?: number },
  ) => {
    const bytes = await changesFile(n, opts);
    put(dataEntryPath(PEER, APP, n, "changes"), bytes);
    return bytes;
  };
  const cursor = () =>
    Number(
      db
        .prepare(
          `SELECT cursor FROM folder_reads WHERE machine = ? AND app = ? AND origin = ?`,
        )
        .get(ME, APP, PEER)?.cursor ?? 0,
    );
  const run = async () => {
    const outcome = await folder.runApp(APP);
    assert.ok(outcome.ok);
    return outcome.value.streams[0];
  };
  return {
    db,
    dest,
    root,
    clock,
    calls,
    exportState,
    apply,
    // 같은 ledger로 새로 만든 읽기(core 재시작).
    restart: () => createFolderImport(deps),
    folder,
    put,
    putRecords,
    changesFile,
    snapshotFile,
    putChanges,
    cursor,
    run,
  };
}

const appliedIds = (calls: Call[]) =>
  calls.flatMap((call) =>
    call.kind === "changes" ? call.ids : [`snapshot ${call.n}`],
  );

// 반만 옮겨진 file이나 깨진 file을 적용하면 앱 data가 망가진다. 아무것도 적용하지 않고 그 번호에서 기다려야 한다.
test("깨지거나 반만 온 file은 아무것도 적용하지 않고 stream이 그 번호에서 기다린다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 1, snapshot: null } });
    await env.folder.scan();
    const good = await env.changesFile(1);
    const flipped = good.slice();
    flipped[flipped.byteLength - 1]! ^= 1;
    const wrongNumber = await env.changesFile(2);
    for (const [label, bytes] of [
      ["truncated", good.subarray(0, good.byteLength - 3)],
      ["flipped", flipped],
      ["other number", wrongNumber],
    ] as const) {
      env.put(dataEntryPath(PEER, APP, 1, "changes"), bytes);
      const stream = await env.run();
      assert.equal(env.calls.length, 0, label);
      assert.equal(env.cursor(), 0, label);
      assert.equal(stream?.error?.code, "invalid_file", label);
      assert.equal(
        env.folder.status(APP)[0]?.error?.code,
        "invalid_file",
        label,
      );
      // backoff가 지나 다음 번에 다시 본다.
      env.clock.advance(2 * 60 * 60 * 1000);
    }
    env.put(dataEntryPath(PEER, APP, 1, "changes"), good);
    const stream = await env.run();
    assert.deepEqual(appliedIds(env.calls), ["1"]);
    assert.equal(env.cursor(), 1);
    assert.equal(stream?.error, null);
  });
});

// 다른 release의 변경을 적용하면 schema가 맞지 않고, 버리면 사람이 쓴 것을 잃는다.
test("다른 release의 file은 적용되지 않고 data root에 같은 bytes로 남는다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 3, snapshot: 1 } });
    await env.folder.scan();
    const first = await env.snapshotFile(1, "other release db", OTHER);
    env.put(dataEntryPath(PEER, APP, 1, "snapshot"), first);
    const second = await env.putChanges(2, { bundle: OTHER });
    const third = await env.putChanges(3, { bundle: OTHER });
    const stream = await env.run();
    assert.equal(env.calls.length, 0);
    assert.equal(env.cursor(), 3);
    assert.equal(stream?.held_files, 3);
    const held = env.db
      .prepare(
        `SELECT n, path, bundle_hash, sha256, size FROM folder_held WHERE machine = ? ORDER BY n`,
      )
      .all(ME);
    assert.deepEqual(
      held.map((row) => [row.n, row.bundle_hash]),
      [
        [1, OTHER],
        [2, OTHER],
        [3, OTHER],
      ],
    );
    // 출처가 compaction으로 폴더의 file을 지워도 사본은 남는다.
    rmSync(join(env.dest, "machines"), { recursive: true });
    for (const [row, bytes] of [
      [held[0]!, first],
      [held[1]!, second],
      [held[2]!, third],
    ] as const) {
      const copy = readFileSync(
        join(env.root, ...(row.path as string).split("/")),
      );
      assert.deepEqual(new Uint8Array(copy), bytes);
      assert.equal(row.sha256, await sha256Hex(bytes));
    }
    assert.equal(env.folder.status(APP)[0]?.held, 3);
  });
});

// 바깥 도구는 충돌 사본과 temp를 남기고 file을 순서 없이 옮긴다.
test("충돌 사본과 temp는 읽지 않고, 늦게 온 번호를 기다려 순서대로 한 번만 적용한다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 4, snapshot: null } });
    await env.folder.scan();
    await env.putChanges(1);
    await env.putChanges(2);
    const three = await env.changesFile(3);
    const dir = dirname(
      join(env.dest, ...dataEntryPath(PEER, APP, 3, "changes").split("/")),
    );
    writeFileSync(join(dir, "000000000003 (1).changes"), three);
    writeFileSync(
      join(dir, "000000000003.sync-conflict-20261116-120000-ABCDEFG.changes"),
      three,
    );
    writeFileSync(
      join(dir, "000000000003.changes.tmp-0123456789abcdef"),
      three,
    );
    await env.putChanges(4);
    let stream = await env.run();
    assert.deepEqual(appliedIds(env.calls), ["1", "2"]);
    assert.equal(stream?.waiting_for, 3);
    assert.equal(stream?.error, null);
    env.put(dataEntryPath(PEER, APP, 3, "changes"), three);
    stream = await env.run();
    assert.deepEqual(appliedIds(env.calls), ["1", "2", "3", "4"]);
    stream = await env.run();
    assert.deepEqual(appliedIds(env.calls), ["1", "2", "3", "4"]);
    assert.equal(env.cursor(), 4);
    assert.equal(stream?.waiting_for, null);
  });
});

// 폴더가 비거나 기록이 깨진 것은 "모름"이지 "없어짐"이 아니다.
test("실패한 읽기는 기록 사본도 local data도 지우지 않는다", async () => {
  await setup(async (env) => {
    env.putRecords(3, { data: { head: 1, snapshot: null } });
    await env.putChanges(1, { bundle: OTHER });
    await env.folder.scan();
    await env.run();
    const before = env.folder.records();
    assert.equal(before.machines.length, 1);
    assert.equal(before.apps.length, 1);
    const heldCopy = join(
      env.root,
      "folder-held",
      APP,
      PEER,
      "000000000001.changes",
    );
    assert.ok(existsSync(heldCopy));

    // 기록 file이 깨졌다: 그 기계의 오류이고 사본은 그대로다.
    env.put(recordPath(PEER), "{ not json");
    let scanned = await env.folder.scan();
    assert.ok(scanned.ok);
    assert.equal(scanned.value.errors[0]?.machine, PEER);
    assert.deepEqual(env.folder.records(), before);
    // 앱 기록만 깨져도 그 기계의 어느 행도 바꾸지 않는다.
    env.put(recordPath(PEER), JSON.stringify(machineRecordOf(env, 9)));
    env.put(
      appRecordPath(PEER, APP),
      JSON.stringify({ format: 1, machine: PEER }),
    );
    scanned = await env.folder.scan();
    assert.ok(scanned.ok);
    assert.equal(scanned.value.errors[0]?.error.code, "invalid_file");
    assert.deepEqual(env.folder.records(), before);
    // 출처 기계의 폴더가 비었다.
    rmSync(join(env.dest, "machines", PEER), { recursive: true });
    mkdirSync(join(env.dest, "machines", PEER));
    scanned = await env.folder.scan();
    assert.ok(scanned.ok);
    assert.deepEqual(env.folder.records(), before);
    await env.run();
    assert.equal(env.cursor(), 1);
    assert.ok(existsSync(heldCopy));
    assert.equal(env.folder.status(APP)[0]?.held, 1);
  });
});

function machineRecordOf(env: { clock: { now(): string } }, revision: number) {
  return {
    format: 1,
    machine: PEER,
    revision,
    updated_at: env.clock.now(),
    name: "Laptop",
    always_on: null,
    addresses: { lan: [], port: null, relay: null },
    lophn: {
      version: "0.23.0",
      protocol: { version: 2, min_version: 1 },
      folder: { version: 1, min_version: 1 },
    },
  };
}

// 출처가 이 기계의 변경을 다 받기 전에 "snapshot에 없음"을 "지워짐"으로 읽으면 이 기계가 쓴 row를 잃고, 다 받은 뒤에도
// 지우지 않으면 다른 곳에서 지워진 row가 이 기계에만 되살아 남는다.
test("horizon 밖에서 돌아온 기계는 출처가 다 받은 뒤의 snapshot으로 다른 곳에서 지워진 row만 지운다", async () => {
  await setup(async (env) => {
    const DAY = 24 * 60 * 60 * 1000;
    const start = syncDb("base");
    writeRows(start, T0 - 100 * DAY, [
      "insert into notes values ('old', 'deleted elsewhere'), ('mine', 'edited here'), ('kept', 'everywhere')",
    ]);
    const source = syncDb("x", start.raw.serialize());
    const here = syncDb("n", start.raw.serialize());
    // 출처에서 지워지고 흔적이 정리됐다. 이 기계는 떨어져 있는 동안 'mine'을 고쳤다.
    writeRows(source, T0 - 95 * DAY, [
      "delete from notes where id in ('old', 'mine')",
    ]);
    const horizon = hlcAtMs(T0 - 91 * DAY);
    source.db.exec("begin");
    assert.equal(dropTombstones(source.db, horizon), 2);
    source.db.exec("commit");
    writeRows(here, T0 - DAY, [
      "update notes set title = 'edited away' where id = 'mine'",
    ]);
    env.apply.mergeSnapshot = async (input) => {
      const raw = new DatabaseSync(":memory:");
      raw.deserialize(readFileSync(input.path));
      const absent = input.absentDeletes;
      here.db.exec("begin immediate");
      const merged = mergeSnapshot(here.db, nodeSyncDb(raw), here.clock, {
        ...(absent === undefined
          ? {}
          : {
              absentDeletes: {
                below: BigInt(absent.below),
                keep: (table, pk) =>
                  absent.keep.some(
                    (one) =>
                      one.table === table &&
                      one.pk === Buffer.from(pk).toString("hex"),
                  ),
              },
            }),
      });
      here.db.exec(merged.ok ? "commit" : "rollback");
      raw.close();
      return merged.ok
        ? ok({ changed: true, deleted: merged.value.deleted })
        : merged;
    };
    const ids = () =>
      here.db
        .all("select id, title from notes order by id")
        .map((row) => `${row.id}:${row.title}`);

    env.exportState.away_since = env.clock.now();
    env.exportState.data_head = 3;
    // 1. 출처는 아직 이 기계의 3번까지 받지 않았다: 지우기 없이 합치고 빚을 남긴다.
    env.putRecords(1, {
      data: { head: 1, snapshot: 1 },
      horizon: String(horizon),
      read: { [ME]: { n: 1, at: env.clock.now() } },
    });
    await env.folder.scan();
    env.put(
      dataEntryPath(PEER, APP, 1, "snapshot"),
      await env.snapshotFile(1, source.raw.serialize()),
    );
    await env.run();
    assert.deepEqual(ids(), [
      "kept:everywhere",
      "mine:edited away",
      "old:deleted elsewhere",
    ]);
    assert.equal(env.folder.status(APP)[0]?.owes_absent_pass, true);

    // 2. 재시작 뒤 출처가 다 받았다고 알리지만, 그 뒤에 만든 snapshot이 아직 없다: 오류 없이 기다린다.
    env.clock.advance(60 * 60 * 1000);
    env.putRecords(2, {
      data: { head: 1, snapshot: 1 },
      horizon: String(horizon),
      read: { [ME]: { n: 3, at: env.clock.now() } },
    });
    const again = env.restart();
    await again.scan();
    env.clock.advance(60 * 60 * 1000);
    assert.ok((await again.runApp(APP)).ok);
    assert.equal(ids().length, 3);
    assert.equal(again.status(APP)[0]?.owes_absent_pass, true);
    assert.equal(again.status(APP)[0]?.error, null);

    // 3. 출처가 다 받은 뒤의 snapshot이 오면 그것으로 다시 합친다.
    env.put(
      dataEntryPath(PEER, APP, 2, "snapshot"),
      await env.snapshotFile(2, source.raw.serialize()),
    );
    env.putRecords(3, {
      data: { head: 2, snapshot: 2 },
      horizon: String(horizon),
      read: { [ME]: { n: 3, at: env.clock.now() } },
    });
    await again.scan();
    assert.ok((await again.runApp(APP)).ok);
    assert.deepEqual(ids(), ["kept:everywhere", "mine:edited away"]);
    assert.equal(again.status(APP)[0]?.owes_absent_pass, false);
    assert.equal(again.status(APP)[0]?.cursor, 2);
    // 풀어 둔 임시 file은 남지 않는다.
    assert.deepEqual(readdirSync(join(env.root, "folder-tmp", APP)), []);
  });
});

type Replica = { raw: DatabaseSync; db: SyncDb; clock: SyncClock };

function syncDb(node: string, bytes?: Uint8Array): Replica {
  const raw = new DatabaseSync(":memory:");
  if (bytes === undefined) {
    raw.exec("create table notes (id text primary key, title text)");
  } else {
    raw.deserialize(bytes);
  }
  raw.exec("pragma foreign_keys = off");
  const db = nodeSyncDb(raw);
  if (bytes === undefined) ensureSyncTables(db, node);
  else setState(db, "node", node);
  return { raw, db, clock: openClock(db) };
}

// 앱 runtime의 write: write, changeset, clock 찍기가 한 transaction.
function writeRows(r: Replica, atMs: number, statements: string[]) {
  r.db.exec("begin immediate");
  const session = r.db.session();
  for (const statement of statements) r.db.exec(statement);
  const changeset = session.changeset();
  session.close();
  assert.ok(stampLocal(r.db, changeset, r.clock.next(atMs)).ok);
  r.db.exec("commit");
}

test("지운 기계는 알려진 기계에서 빠지지만 행과 data는 남고, 새 기록을 쓰면 돌아온다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 1, snapshot: null }, horizon: "5" });
    await env.putChanges(1, { bundle: OTHER });
    await env.folder.scan();
    await env.run();
    assert.ok(env.folder.forgetMachine(PEER).ok);
    assert.equal(env.folder.isForgotten(PEER), true);
    assert.deepEqual(env.folder.records(), { machines: [], apps: [] });
    assert.deepEqual(env.folder.peerHorizons(APP), []);
    assert.deepEqual(env.folder.status(APP), []);
    assert.equal(env.folder.readsCaughtUp(APP), true);
    assert.equal(
      Number(
        env.db.prepare(`SELECT count(*) AS n FROM folder_records`).get()!.n,
      ),
      2,
    );
    assert.equal(
      Number(env.db.prepare(`SELECT count(*) AS n FROM folder_held`).get()!.n),
      1,
    );
    assert.ok(
      existsSync(
        join(env.root, "folder-held", APP, PEER, "000000000001.changes"),
      ),
    );
    // 같은 revision을 다시 읽어도 돌아오지 않는다.
    await env.folder.scan();
    assert.equal(env.folder.isForgotten(PEER), true);
    env.putRecords(2, { data: { head: 1, snapshot: null }, horizon: "6" });
    await env.folder.scan();
    assert.equal(env.folder.isForgotten(PEER), false);
    assert.deepEqual(env.folder.peerHorizons(APP), [
      { machine: PEER, settled: null, horizon: "6" },
    ]);
  });
});

test("주인이 compaction한 뒤에 온 기계는 가장 큰 맞는 snapshot으로 따라온다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 5, snapshot: 5 } });
    await env.folder.scan();
    // 1~2는 지워졌고 3은 snapshot, 4는 변경, 5는 반만 온 snapshot이다.
    env.put(
      dataEntryPath(PEER, APP, 3, "snapshot"),
      await env.snapshotFile(3, "db three"),
    );
    await env.putChanges(4);
    const broken = await env.snapshotFile(5, "db five");
    env.put(
      dataEntryPath(PEER, APP, 5, "snapshot"),
      broken.subarray(0, broken.byteLength - 1),
    );
    const stream = await env.run();
    assert.deepEqual(appliedIds(env.calls), ["snapshot 3", "4"]);
    assert.equal(env.cursor(), 4);
    assert.equal(stream?.error?.code, "invalid_file");
    assert.equal(env.folder.readsCaughtUp(APP), false);
  });
});

// 앞선 clock을 그대로 적용하면 그 칸은 시계가 따라올 때까지 이 기계의 새 쓰기를 이긴다.
test("clock이 5분 넘게 앞선 file은 시각이 따라올 때까지 적용하지 않는다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 1, snapshot: null } });
    await env.folder.scan();
    await env.putChanges(1, { aheadMs: 10 * 60 * 1000 });
    const stream = await env.run();
    assert.equal(env.calls.length, 0);
    assert.equal(env.cursor(), 0);
    assert.equal(stream?.error?.code, "clock_ahead");
    assert.equal(
      stream?.error?.message,
      "The clock of Laptop is 10 minutes ahead",
    );
    assert.deepEqual(stream?.error?.details, {
      machine: PEER,
      machine_name: "Laptop",
      ahead_ms: 600000,
    });
    env.clock.advance(6 * 60 * 1000);
    await env.run();
    assert.deepEqual(appliedIds(env.calls), ["1"]);
    assert.equal(env.folder.readsCaughtUp(APP), true);
  });
});

// snapshot 합치기는 source의 가장 큰 clock을 이 기계의 clock으로 받는다. 미루지 않으면 이 기계의 뒤 쓰기가 모두 앞선 clock을 단다.
test("clock이 5분 넘게 앞선 snapshot은 시각이 따라올 때까지 합치지 않는다", async () => {
  await setup(async (env) => {
    env.putRecords(1, { data: { head: 1, snapshot: 1 } });
    await env.folder.scan();
    const raw = new DatabaseSync(":memory:");
    const db = nodeSyncDb(raw);
    ensureSyncTables(db, "peer");
    setState(db, "hlc", String(hlcAtMs(T0 + 10 * 60 * 1000)));
    env.put(
      dataEntryPath(PEER, APP, 1, "snapshot"),
      await env.snapshotFile(1, raw.serialize()),
    );
    raw.close();
    const stream = await env.run();
    assert.equal(env.calls.length, 0);
    assert.equal(env.cursor(), 0);
    assert.equal(stream?.error?.code, "clock_ahead");
    assert.equal(stream?.error?.details?.["ahead_ms"], 600000);
    env.clock.advance(6 * 60 * 1000);
    await env.run();
    assert.deepEqual(appliedIds(env.calls), ["snapshot 1"]);
  });
});
