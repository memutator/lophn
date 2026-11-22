import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  changesOf,
  decodeContainer,
  dataEntryPath,
} from "../../../protocol/folder/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { heldInData, type SyncLog } from "../../apps/sync/log.ts";
import type { DestinationsView } from "../destinations.ts";
import type { FolderLogRow } from "../ports.ts";
import {
  FOLDER_CODE_COMMIT_STEPS,
  FOLDER_DESTINATION_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "../schema.ts";
import { createFolderExport, type ExportLog } from "./mod.ts";
import type { AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import {
  sendsTo,
  sentTables,
  type SyncPlan,
  syncPlanOf,
  type TableFilter,
} from "../../../protocol/apps/declaration/sync-plan.ts";
import { readChangeset } from "../../../protocol/apps/sync/changeset.ts";
import { createSyncLog } from "../../apps/sync/log.ts";
import {
  SYNC_LOG_DESTINATION_STEPS,
  SYNC_LOG_MACHINE_STEPS,
  SYNC_LOG_SCHEMA_STEPS,
} from "../../apps/sync/schema.ts";
import { LEDGER_SCHEMA_STEPS } from "../../storage/ledger/schema.ts";
import { applyMigrations } from "../../storage/migration/migrations.ts";

// 내보내기가 기대는 sync log 면이 core의 sync log와 맞는지 type check가 본다.
void (null as unknown as SyncLog satisfies ExportLog);

const ME = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const PEER_A = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const PEER_B = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"rel">;
const COMMIT = "b".repeat(40);
const DAY = 24 * 60 * 60 * 1000;
// folder 표 step이 기대는 release 표(활성 release의 선언에서 destination을 채운다). 이 test의 ledger에는 그 표만 있으면 된다.
const RELEASES =
  "create table releases (id text, app text, status text, declaration text)";
const FOLDER_STEPS = [
  ...FOLDER_SCHEMA_STEPS,
  ...FOLDER_CODE_COMMIT_STEPS,
  ...FOLDER_DESTINATION_STEPS,
];

function fakeLog() {
  const rows: (FolderLogRow & { resolved: boolean })[] = [];
  const blobs = new Map<string, Uint8Array>();
  const add = (row: Omit<FolderLogRow, "seq">) => {
    rows.push({ ...row, seq: rows.length + 1, resolved: false });
  };
  const log: ExportLog = {
    head: () => rows.length,
    page: (_app, after, limit) =>
      rows.filter((row) => row.seq > after).slice(0, limit),
    readChangeset: (hash) => Promise.resolve(ok(blobs.get(hash)!)),
    hold(seq) {
      const row = rows[seq - 1]!;
      if (row.kind === "change") row.kind = "held";
      return ok(undefined);
    },
    heldInData: () =>
      Promise.resolve(
        ok(
          rows.filter(
            (row) => row.kind === "held" && !row.resolved && heldInData(row),
          ).length,
        ),
      ),
  };
  function put(bytes: Uint8Array) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    blobs.set(hash, bytes);
    return { hash, size: bytes.byteLength };
  }
  return {
    log,
    rows,
    // 풀리지 않은 held 줄의 [hlc, bytes 글].
    held: () =>
      rows
        .filter((row) => row.kind === "held" && !row.resolved)
        .map((row) => [
          row.hlc,
          new TextDecoder().decode(blobs.get(row.changeset!.hash)),
        ]),
    change(hlc: number, text: string, origin = "computer") {
      add({
        release: REL,
        destination: null,
        kind: "change",
        origin,
        hlc: String(hlc),
        changeset: put(new TextEncoder().encode(text)),
        invocation: `inv_${rows.length + 1}`,
      });
      return rows.length;
    },
    marker(origin = "computer") {
      add({
        release: REL,
        destination: null,
        kind: "snapshot",
        origin,
        hlc: null,
        changeset: null,
        invocation: null,
      });
    },
  };
}

async function harness(
  run: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-export-"));
  try {
    await run(await setup(base));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function setup(base: string) {
  const dataRoot = join(base, "root");
  const destination = join(base, "dest");
  mkdirSync(dataRoot);
  mkdirSync(destination);
  const db = new DatabaseSync(":memory:");
  db.exec(RELEASES);
  for (const step of FOLDER_STEPS) db.exec(step.sql);
  const sql: Sql = {
    run: (text, params) => db.prepare(text).run(...params),
    get: (text, params) => db.prepare(text).get(...params) as never,
    all: (text, params) => db.prepare(text).all(...params) as never,
  };
  function transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T> {
    db.exec("begin immediate");
    const done = fn({ sql });
    db.exec(done.ok ? "commit" : "rollback");
    return done;
  }
  const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
  const fake = fakeLog();
  const destinations: DestinationsView = {
    list: () => [{ name: "personal", path: destination, state: "ok" }],
    resolve: (name) =>
      name === "personal" ? { path: destination, state: "ok" } : null,
  };
  const knobs = {
    name: "Studio",
    caughtUp: true,
    horizons: [] as { machine: Id<"mch">; horizon: string }[],
    // 앱 DB 사본에 넣을 사람의 data.
    rows: ["first note"],
  };
  const exporter = createFolderExport({
    machine: () => ({ id: ME, name: knobs.name }),
    destinations,
    apps: () => [
      {
        app: APP,
        slug: "notes",
        name: "Notes",
        description: "",
        destinations: ["personal"],
        release: { id: REL, code_commit: COMMIT, data_schema: 1 },
      },
    ],
    log: fake.log,
    releaseKey: () => ({ code_commit: COMMIT, data_schema: 1 }),
    sentOf: () => null,
    operationOf: (invocation) => ({
      name: `op_${invocation}`,
      started_at: clock.now(),
    }),
    async snapshotAt(_app, _destination, path) {
      const copy = new DatabaseSync(path);
      copy.exec("create table notes (id integer primary key, body text)");
      for (const body of knobs.rows) {
        copy.prepare("insert into notes (body) values (?)").run(body);
      }
      copy.close();
      const bytes = readFileSync(path);
      return ok({
        seq: fake.log.head(APP),
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
    facts: () => ({
      addresses: { lan: [], port: null, relay: null },
      alwaysOn: null,
      projects: [],
      lophn: { version: "0.23.0", protocol: { version: 2, min_version: 2 } },
    }),
    readsCaughtUp: () => knobs.caughtUp,
    peerHorizons: () => knobs.horizons,
    sql,
    transaction,
    clock,
    random: seededRandom(7),
    dataRoot,
  });
  const own = join(destination, "machines", ME);
  const dataFolder = join(own, "apps", APP, "data");
  return {
    dataRoot,
    destination,
    own,
    dataFolder,
    db,
    sql,
    clock,
    fake,
    knobs,
    exporter,
    async run() {
      const done = await exporter.runStream(APP, "personal");
      assert.ok(done.ok, JSON.stringify(done));
      return done.value;
    },
    file(n: number, kind: "changes" | "snapshot") {
      return join(destination, dataEntryPath(ME, APP, n, kind));
    },
    async decode(n: number, kind: "changes" | "snapshot") {
      const rel = dataEntryPath(ME, APP, n, kind);
      const decoded = await decodeContainer(
        readFileSync(join(destination, rel)),
        rel,
      );
      assert.ok(decoded.ok);
      return decoded.value;
    },
  };
}

// 폴더 안의 모든 file을 bytes까지.
function tree(dir: string, skip?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    const path = join(entry.parentPath, entry.name);
    if (skip !== undefined && (path === skip || path.startsWith(`${skip}/`))) {
      continue;
    }
    out[relative(dir, path)] = entry.isFile()
      ? readFileSync(path, "hex")
      : "dir";
  }
  return out;
}

// 바깥 도구가 이 폴더를 다른 기계로 옮긴다. 남의 하위 폴더를 고치면 그 기계의 data를 잃는다.
test("기계는 자기 하위 폴더 밖에 쓰지 않는다", async () => {
  await harness(async (h) => {
    for (const peer of [PEER_A, PEER_B]) {
      const data = join(h.destination, "machines", peer, "apps", APP, "data");
      mkdirSync(data, { recursive: true });
      writeFileSync(join(h.destination, "machines", peer, "record.json"), peer);
      writeFileSync(
        join(h.destination, "machines", peer, "apps", APP, "app.json"),
        peer,
      );
      for (const name of [
        "000000000001.snapshot",
        "000000000002.changes",
        "000000000003.changes",
        "000000000004.snapshot",
      ]) {
        writeFileSync(join(data, name), `${peer} ${name}`);
      }
    }
    writeFileSync(join(h.destination, "notes.txt"), "the person's file");
    const before = tree(h.destination);

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++)
        h.fake.change(1000 + round * 10 + i, `r${round} c${i}`);
      await h.run();
      h.knobs.name = `Studio ${round}`;
      assert.ok((await h.exporter.publishRecords()).ok);
      // 다음 snapshot과 compaction.
      h.clock.advance(31 * DAY);
      h.fake.marker();
      await h.run();
      assert.ok((await h.exporter.publishRecords()).ok);
    }

    assert.deepStrictEqual(tree(h.destination, h.own), before);
    // compaction이 자기 옛 file을 지웠고 마지막 snapshot은 남았다.
    assert.ok(!existsSync(h.file(1, "snapshot")));
    const last = h.exporter.status(APP, "personal")!;
    assert.ok(existsSync(h.file(last.head, "snapshot")));
    assert.equal(last.error, null);
  });
});

// 바깥 도구가 폴더를 사람의 cloud로 올린다. 기계 id file이나 자격이 실리면 남이 이 기계로 행세하거나 계정에 닿는다.
test("기계 id file과 자격은 폴더에 나오지 않는다", async () => {
  await harness(async (h) => {
    const secrets = [
      "BINDING-7f3a9c",
      "APP-SECRET-55e1d2",
      "HOSTKEY-PRIVATE-c0ffee",
    ];
    writeFileSync(
      join(h.dataRoot, "machine.json"),
      JSON.stringify({ id: ME, binding: secrets[0] }),
    );
    writeFileSync(
      join(h.dataRoot, "secrets.json"),
      JSON.stringify({ [`app.${APP}.token`]: secrets[1] }),
    );
    mkdirSync(join(h.dataRoot, "remote"));
    writeFileSync(
      join(h.dataRoot, "remote", "host-key.json"),
      JSON.stringify({ publicKey: "pub", privateKey: secrets[2] }),
    );
    h.knobs.rows = ["groceries", "call mom"];
    h.fake.change(10, "insert groceries");
    h.fake.change(11, "insert call mom");
    await h.run();
    h.fake.change(12, "update call mom");
    await h.run();
    assert.ok((await h.exporter.publishRecords()).ok);

    const files = tree(h.destination);
    assert.ok(Object.keys(files).some((path) => path.endsWith(".snapshot")));
    assert.ok(Object.keys(files).some((path) => path.endsWith(".changes")));
    assert.ok(Object.keys(files).some((path) => path.endsWith("record.json")));
    for (const [path, hex] of Object.entries(files)) {
      const bytes = Buffer.from(hex, "hex");
      for (const secret of [...secrets, h.dataRoot]) {
        assert.ok(!bytes.includes(secret), `${path} carries ${secret}`);
      }
    }
  });
});

// horizon 밖에서 돌아온 기계의 옛 변경을 내보내면 다른 기계에서 이미 정리된 흔적을 되살리거나 지운 row를 틀리게 남긴다.
// 버리면 사람이 쓴 것을 잃는다.
test("horizon 밖의 기계는 정리된 흔적과 부딪힐 자기 변경을 버리지도 내보내지도 않는다", async () => {
  await harness(async (h) => {
    h.fake.change(100, "early");
    await h.run();
    assert.equal(h.exporter.settledOf(APP, "personal")?.settled, "100");

    const oldSeq = h.fake.change(150, "offline edit");
    const newSeq = h.fake.change(500, "fresh edit");
    h.knobs.horizons = [{ machine: PEER_A, horizon: "200" }];
    h.knobs.caughtUp = false;
    const outcome = await h.run();

    assert.equal(outcome.held, 1);
    assert.deepStrictEqual(h.fake.held(), [["150", "offline edit"]]);
    const ids: string[] = [];
    for (const name of readdirSync(h.dataFolder).filter((n) =>
      n.endsWith(".changes"),
    )) {
      const decoded = await h.decode(Number(name.slice(0, 12)), "changes");
      ids.push(
        ...changesOf(decoded.header, decoded.payload).map((one) => one.meta.id),
      );
      assert.ok(!Buffer.from(decoded.payload).includes("offline edit"));
    }
    assert.ok(ids.includes(String(newSeq)));
    assert.ok(!ids.includes(String(oldSeq)));
    assert.notEqual(h.exporter.settledOf(APP, "personal")?.away_since, null);

    // 다시 돌아도 held 줄을 내보내거나 다시 held로 옮기지 않는다.
    const files = readdirSync(h.dataFolder);
    assert.equal((await h.run()).held, 0);
    assert.deepStrictEqual(readdirSync(h.dataFolder), files);
    assert.equal(h.fake.held().length, 1);
  });
});

// 지우면 horizon 밖의 기계가 held로 둔 자기 변경이 snapshot(30일 compaction, 필요한 snapshot, 첫 file)에 실려 사람이 풀기
// 전에 다른 기계로 나가거나, 반대로 held가 snapshot을 영영 막아 stream이 멈춘 채 아무도 모른다.
test("horizon 밖에서 held로 둔 자기 변경은 사람이 풀기 전에는 어떤 snapshot에도 실려 나가지 않고, 풀면 stream이 이어진다", async () => {
  // 이미 있는 stream: compaction snapshot은 미루고 changes는 이어 가며, snapshot이 꼭 필요하면 까닭을 보이고 멈춘다.
  await harness(async (h) => {
    h.fake.change(100, "early");
    await h.run();
    h.clock.advance(31 * DAY);
    const offline = h.fake.change(150, "offline edit");
    h.fake.change(500, "fresh edit");
    h.knobs.horizons = [{ machine: PEER_A, horizon: "200" }];
    h.knobs.caughtUp = false;
    // snapshot 사본은 앱 DB 그대로다: held 변경도 들어 있다.
    h.knobs.rows = ["early", "offline edit", "fresh edit"];

    const first = await h.run();
    assert.equal(first.held, 1);
    assert.equal(first.error, null);
    const snapshots = () =>
      readdirSync(h.dataFolder).filter((name) => name.endsWith(".snapshot"));
    assert.deepStrictEqual(snapshots(), ["000000000001.snapshot"]);

    h.fake.marker();
    const blocked = await h.run();
    assert.equal(blocked.error?.code, "away_too_long");
    assert.deepStrictEqual(snapshots(), ["000000000001.snapshot"]);
    assert.notEqual(h.exporter.settledOf(APP, "personal")?.away_since, null);

    // 사람이 풀었다(apply는 새 change 줄로, discard는 풀기만).
    h.fake.rows[offline - 1]!.resolved = true;
    const resumed = await h.run();
    assert.equal(resumed.error, null);
    assert.equal(snapshots().length, 2);
  });
  // 첫 file(snapshot)도 같다. 걸리는 것이 없으면 horizon 밖에서도 바로 쓴다.
  await harness(async (h) => {
    h.knobs.horizons = [{ machine: PEER_A, horizon: "200" }];
    const offline = h.fake.change(150, "offline edit");
    const blocked = await h.run();
    assert.equal(blocked.held, 1);
    assert.equal(blocked.error?.code, "away_too_long");
    assert.ok(!existsSync(h.dataFolder));
    h.fake.rows[offline - 1]!.resolved = true;
    h.fake.change(500, "fresh edit");
    const resumed = await h.run();
    assert.equal(resumed.error, null);
    assert.ok(existsSync(h.file(1, "snapshot")));
    // 내보낼 것이 없고 다 받았으니 settled가 horizon을 넘어 더는 떨어져 있지 않다.
    assert.equal(h.exporter.settledOf(APP, "personal")?.away_since, null);
  });
});

// 번호 붙은 file은 다시 쓰지 않는다. 다시 쓰면 이미 읽은 기계와 아직 안 읽은 기계가 다른 bytes를 본다.
test("rename 뒤 기록 전에 죽어도 번호를 다시 쓰지 않고 남의 writer로 오인하지 않는다", async () => {
  await harness(async (h) => {
    h.fake.change(10, "a");
    await h.run();
    const saved = h.db
      .prepare("select * from folder_streams where stream = 'data'")
      .get()!;
    h.fake.change(11, "b");
    h.fake.change(12, "c");
    await h.run();
    const written = readFileSync(h.file(2, "changes"));
    // 2.changes를 rename한 뒤 stream 행을 고치기 전에 죽은 상태.
    h.db
      .prepare(
        "update folder_streams set next_n = ?, last_seq = ?, written_at = ? where stream = 'data'",
      )
      .run(saved["next_n"]!, saved["last_seq"]!, saved["written_at"]!);

    h.fake.change(13, "d");
    const outcome = await h.run();

    assert.equal(outcome.error, null);
    assert.deepStrictEqual(readFileSync(h.file(2, "changes")), written);
    const third = await h.decode(3, "changes");
    assert.deepStrictEqual(
      changesOf(third.header, third.payload).map((one) => one.meta.id),
      ["4"],
    );
    assert.equal(h.exporter.status(APP, "personal")?.head, 3);
  });
});

// 알아채지 못한 복제가 같은 하위 폴더에 쓰고 있다. 같이 쓰면 같은 번호에 다른 bytes가 생긴다.
test("남이 쓴 번호를 보면 쓰지 않고 foreign_writer다", async () => {
  for (const intrude of ["new number", "changed bytes"] as const) {
    await harness(async (h) => {
      h.fake.change(10, "a");
      await h.run();
      if (intrude === "new number") {
        writeFileSync(h.file(2, "changes"), "someone else");
      } else {
        writeFileSync(h.file(1, "snapshot"), "someone else");
      }
      const before = tree(h.destination);
      h.fake.change(11, "b");

      const outcome = await h.run();
      assert.equal(outcome.error?.code, "foreign_writer", intrude);
      assert.equal(outcome.files, 0);
      // 사람이 볼 때까지 멈춘 채다.
      assert.equal((await h.run()).error?.code, "foreign_writer");
      assert.deepStrictEqual(tree(h.destination), before);
      assert.equal(
        h.exporter.status(APP, "personal")?.error?.code,
        "foreign_writer",
      );
      assert.ok(statSync(h.dataFolder).isDirectory());
    });
  }
});

// 진짜 sync log(임시 ledger file)와 그 위의 내보내기. 앱의 write·rewind changeset은 scratch DB의 session으로 뜬다.
async function realExport(
  base: string,
  plan: SyncPlan,
  sentOf: (release: string, destination: string) => TableFilter,
  horizons: Record<string, { machine: Id<"mch">; horizon: string }[]> = {},
) {
  const ledger = join(base, "ledger.sqlite");
  const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
  assert.ok(
    (
      await applyMigrations(
        ledger,
        [
          ...LEDGER_SCHEMA_STEPS,
          ...SYNC_LOG_SCHEMA_STEPS,
          ...SYNC_LOG_MACHINE_STEPS,
        ],
        { clock },
      )
    ).ok,
  );
  const db = new DatabaseSync(ledger);
  db.exec(RELEASES);
  for (const step of [...SYNC_LOG_DESTINATION_STEPS, ...FOLDER_STEPS]) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (text, params) => db.prepare(text).run(...params),
    get: (text, params) => db.prepare(text).get(...params) as never,
    all: (text, params) => db.prepare(text).all(...params) as never,
  };
  // 활성 release와 release마다의 선언, core가 뜰 때 메우기가 읽는 live invocation, 그리고 n번째 log 줄을 넣을 때 core가
  // 죽는 것(던지고 transaction은 commit되지 않는다).
  const knobs = {
    active: REL as string,
    plans: new Map<string, SyncPlan>([[REL, plan]]),
    live: [] as unknown[],
    dieAtInsert: null as number | null,
  };
  const tx = {
    sql: {
      ...sql,
      run(text: string, params: never[]) {
        if (
          knobs.dieAtInsert !== null &&
          text.includes("INSERT INTO app_sync_log") &&
          --knobs.dieAtInsert === 0
        ) {
          throw new Error("core died");
        }
        return sql.run(text, params);
      },
    },
    now: () => clock.now(),
    registerBlobRef: () => ok(undefined),
  } as unknown as Tx;
  function transaction<T>(fn: (tx: Tx) => Result<T>): Result<T> {
    db.exec("begin immediate");
    try {
      const done = fn(tx);
      db.exec(done.ok ? "commit" : "rollback");
      return done;
    } catch (thrown) {
      db.exec("rollback");
      throw thrown;
    }
  }
  const stored = new Map<string, Uint8Array>();
  const log = createSyncLog({
    sql,
    transaction,
    blobs: {
      async prepare(stream) {
        const parts: Uint8Array[] = [];
        for await (const part of stream) parts.push(part);
        const bytes = new Uint8Array(Buffer.concat(parts));
        const hash = createHash("sha256").update(bytes).digest("hex");
        stored.set(hash, bytes);
        return ok({
          preparation: "p",
          principal: "core",
          purpose: "app_changeset",
          hash,
          size_bytes: bytes.byteLength,
        });
      },
      read: (hash, offset, length) =>
        Promise.resolve(
          ok({
            hash,
            sizeBytes: stored.get(hash)!.byteLength,
            bytes: stored.get(hash)!.slice(offset, offset + length),
          }),
        ),
    },
    ledger: { list: () => ok(knobs.live as never) },
    activeRelease: () => ok(knobs.active as Id<"rel">),
    plan: (_app, release) => knobs.plans.get(release) ?? null,
    now: () => clock.now(),
    changed: () => {},
  });
  // destination마다 폴더 하나.
  const names = sendsTo(plan);
  const folderOf = (name: string) => join(base, `dest-${name}`);
  for (const name of names) mkdirSync(folderOf(name));
  const dataRoot = join(base, "root");
  mkdirSync(dataRoot);
  const exporter = createFolderExport({
    machine: () => ({ id: ME, name: "Studio" }),
    destinations: {
      list: () =>
        names.map((name) => ({
          name,
          path: folderOf(name),
          state: "ok" as const,
        })),
      resolve: (name) =>
        names.includes(name) ? { path: folderOf(name), state: "ok" } : null,
    },
    apps: () => [
      {
        app: APP,
        slug: "notes",
        name: "Notes",
        description: "",
        destinations: names,
        release: {
          id: knobs.active as Id<"rel">,
          code_commit: COMMIT,
          data_schema: 1,
        },
      },
    ],
    log,
    releaseKey: () => ({ code_commit: COMMIT, data_schema: 1 }),
    sentOf,
    operationOf: () => null,
    async snapshotAt(_app, _destination, path) {
      new DatabaseSync(path).close();
      const bytes = readFileSync(path);
      return ok({
        seq: log.head(APP),
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
    facts: () => ({
      addresses: { lan: [], port: null, relay: null },
      alwaysOn: null,
      projects: [],
      lophn: { version: "0.23.0", protocol: { version: 2, min_version: 2 } },
    }),
    readsCaughtUp: () => true,
    peerHorizons: (_app, destination) => horizons[destination] ?? [],
    sql,
    transaction,
    clock,
    random: seededRandom(7),
    dataRoot,
  });
  // 앱의 표 셋: item과 note는 보내고(plan이 고른 destination으로) cache는 이 기계에만 둔다.
  const app = new DatabaseSync(":memory:");
  app.exec(
    "create table item (id text primary key, title text); create table note (id text primary key, body text); create table cache (id text primary key, body text)",
  );
  const changeset = (text: string) => {
    const session = app.createSession();
    app.exec(text);
    const bytes = session.changeset();
    session.close();
    return bytes;
  };
  const inv = (id: string, release: string = REL) =>
    ({
      id,
      app: APP,
      release,
      effect: "write",
      caller: null,
    }) as unknown as AppInvocation;
  return {
    log,
    knobs,
    changeset,
    inv,
    exporter,
    async run(name = "personal") {
      const done = await exporter.runStream(APP, name);
      assert.ok(done.ok, JSON.stringify(done));
      assert.equal(done.value.error, null);
    },
    // 그 destination의 이 기계 data file 이름.
    files: (name: string) =>
      readdirSync(join(folderOf(name), "machines", ME, "apps", APP, "data")),
    // 내보낸 changes file 하나의 변경마다 [id, 담은 표].
    async exported(n: number, name = "personal") {
      const rel = dataEntryPath(ME, APP, n, "changes");
      const decoded = await decodeContainer(
        readFileSync(join(folderOf(name), rel)),
        rel,
      );
      assert.ok(decoded.ok);
      return changesOf(decoded.value.header, decoded.value.payload).map(
        ({ meta, bytes }) => {
          const read = readChangeset(bytes);
          assert.ok(read.ok);
          return [meta.id, [...new Set(read.value.map((c) => c.table))]];
        },
      );
    },
    close: () => db.close(),
  };
}

// 지우면 이 기계에만 두기로 한 표의 row가 changes file에 실려 다른 기계로 나가거나, 그런 write의 log 줄이 없어 core가 뜰 때마다
// '다시 snapshot'이 되거나, 그 표만 되돌린 rewind가 폰과 폴더로 나간다.
test("보내는 표와 이 기계에만 있는 표를 같이 바꾼 write와 rewind는 changes file에 보내는 표만 싣고, 이 기계에만 있는 표만 바꾼 write는 skipped 줄이다(폰 밖 앱). 폰 앱은 log에 모든 표를 두고 내보낼 때 거른다", async () => {
  for (const [label, plan, kinds, exported] of [
    [
      "computer",
      syncPlanOf({ sync: { item: "personal" } }),
      [
        ["change", "computer", ["item"]],
        ["skipped", "computer", []],
        ["change", "rewind", ["item"]],
      ],
      [
        ["1", ["item"]],
        ["3", ["item"]],
      ],
    ],
    [
      "phone",
      syncPlanOf({
        runs_on: ["computer", "phone"],
        sync: { item: "personal" },
      }),
      [
        ["change", "computer", ["cache", "item"]],
        ["change", "computer", ["cache"]],
        ["change", "rewind", ["cache"]],
        ["change", "rewind", ["cache", "item"]],
      ],
      [
        ["1", ["item"]],
        ["4", ["item"]],
      ],
    ],
  ] as const) {
    const base = await mkdtemp(join(tmpdir(), "lophn-folder-sent-"));
    const e = await realExport(base, plan, (_release, destination) =>
      sentTables(plan, destination),
    );
    try {
      await e.run(); // 첫 file은 snapshot이다.
      await e.log.written(
        e.inv("inv_1"),
        "100",
        e.changeset(
          "insert into item values ('a', 'milk'); insert into cache values ('c', 'local')",
        ),
      );
      await e.log.written(
        e.inv("inv_2"),
        "101",
        e.changeset("update cache set body = 'again'"),
      );
      await e.log.rewound(APP, REL, e.changeset("delete from cache"), "102");
      await e.log.rewound(
        APP,
        REL,
        e.changeset(
          "update item set title = 'tea'; insert into cache values ('d', 'x')",
        ),
        "103",
      );
      const rows = e.log.page(APP, 0, 10);
      const tablesOf = async (row: (typeof rows)[number]) => {
        if (row.changeset === null) return [];
        const bytes = await e.log.readChangeset(
          row.changeset.hash,
          row.changeset.size,
        );
        assert.ok(bytes.ok);
        const read = readChangeset(bytes.value);
        assert.ok(read.ok);
        return [...new Set(read.value.map((c) => c.table))].sort();
      };
      assert.deepEqual(
        await Promise.all(
          rows.map(async (row) => [row.kind, row.origin, await tablesOf(row)]),
        ),
        kinds,
        label,
      );
      await e.run();
      assert.deepEqual(await e.exported(2), exported, label);
    } finally {
      e.close();
      await rm(base, { recursive: true, force: true });
    }
  }
});

// 지우면 release가 바뀌기 전 줄이 지금 release의 표 집합으로 걸러져, 그 release에서는 이 기계에만 있던 표가 옛 release의 줄로 나간다.
test("내보내기는 log 줄마다 그 줄의 release가 보내는 표로 거른다", async () => {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-sent-release-"));
  const OLD = "rel_01hyyyyyyyyyyyyyyyyyyyyyyy";
  const plan = syncPlanOf({
    runs_on: ["computer", "phone"],
    sync: { item: "personal" },
  });
  const e = await realExport(base, plan, (release) =>
    release === OLD
      ? (table) => table === "item"
      : (table) => table === "item" || table === "cache",
  );
  try {
    await e.run();
    const both =
      "insert into item values ('a', 'milk'); insert into cache values ('c', 'local')";
    await e.log.written(e.inv("inv_1", OLD), "100", e.changeset(both));
    await e.log.written(
      e.inv("inv_2"),
      "101",
      e.changeset(
        "insert into item values ('b', 'tea'); insert into cache values ('d', 'x')",
      ),
    );
    await e.run();
    // release마다 file이 나뉜다.
    assert.deepEqual(await e.exported(2), [["1", ["item"]]]);
    assert.deepEqual(await e.exported(3), [["2", ["item", "cache"]]]);
  } finally {
    e.close();
    await rm(base, { recursive: true, force: true });
  }
});

// 지우면 폰 앱이 다른 기계의 horizon 밖에 있을 때 이 기계에만 있는 표만 바꾼 줄이 held가 되어, 폴더로 갈 것도 없는데 사람에게
// 보이고 snapshot을 막는다(away_too_long).
test("horizon 밖에서도 보내는 표가 없는 줄은 held로 붙들지 않고 snapshot이 나간다", async () => {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-sent-held-"));
  const plan = syncPlanOf({
    runs_on: ["computer", "phone"],
    sync: { item: "personal" },
  });
  const horizons: Record<string, { machine: Id<"mch">; horizon: string }[]> = {
    personal: [],
  };
  const e = await realExport(
    base,
    plan,
    (_release, destination) => sentTables(plan, destination),
    horizons,
  );
  try {
    await e.run();
    // 결과를 모르는 write: '다시 snapshot' 줄. 그 뒤에 이 기계에만 있는 표만 바꾼 write.
    await e.log.unknown(e.inv("inv_1"));
    await e.log.written(
      e.inv("inv_2"),
      "100",
      e.changeset("insert into cache values ('c', 'local')"),
    );
    horizons.personal!.push({ machine: PEER_A, horizon: "1000" });
    await e.run();
    assert.deepEqual(e.log.heldList(APP), []);
  } finally {
    e.close();
    await rm(base, { recursive: true, force: true });
  }
});

// 지우면 한 앱이 표마다 다른 destination으로 보낼 때 한 destination의 hold가 섞인 줄째로 다른 destination의 변경까지 붙들거나
// (그 destination으로 가지 않고 사람이 풀 때까지 갇힌다), 한 destination의 held가 다른 destination의 snapshot을 막는다.
test("한 destination에서 held가 된 변경은 같은 앱의 다른 destination 변경을 붙들지도 그 snapshot을 막지도 않는다", async () => {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-held-split-"));
  const plan = syncPlanOf({ sync: { item: "personal", note: "drive" } });
  const horizons: Record<string, { machine: Id<"mch">; horizon: string }[]> =
    {};
  const e = await realExport(
    base,
    plan,
    (_release, destination) => sentTables(plan, destination),
    horizons,
  );
  try {
    await e.run("personal");
    await e.run("drive");
    // write 하나가 두 destination의 표와 이 기계에만 있는 표를 같이 바꾼다: destination마다 줄 하나.
    await e.log.written(
      e.inv("inv_1"),
      "100",
      e.changeset(
        "insert into item values ('a', 'milk'); insert into note values ('n', 'call'); insert into cache values ('c', 'x')",
      ),
    );
    const lines = e.log.page(APP, 0, 10);
    assert.deepEqual(
      lines.map((row) => [row.kind, row.destination]),
      [
        ["change", "drive"],
        ["change", "personal"],
      ],
    );
    // personal의 상대만 흔적을 정리했다: 이 기계는 personal에서만 떨어져 있다.
    horizons.personal = [{ machine: PEER_A, horizon: "1000" }];
    await e.run("personal");
    await e.run("drive");
    assert.deepEqual(
      e.log.heldList(APP).map((row) => [row.seq, row.destination]),
      [[lines[1]!.seq, "personal"]],
    );
    // drive 쪽 변경은 붙들리지 않고 그 표만 나갔다.
    assert.deepEqual(await e.exported(2, "drive"), [
      [String(lines[0]!.seq), ["note"]],
    ]);
    // 결과를 모르는 write는 두 stream 모두 snapshot을 부른다: personal은 held인 자기 변경 때문에 멈추고 drive는 쓴다.
    await e.log.unknown(e.inv("inv_2"));
    const personal = await e.exporter.runStream(APP, "personal");
    assert.ok(personal.ok);
    assert.equal(personal.value.error?.code, "away_too_long");
    await e.run("drive");
    assert.deepEqual(e.files("drive"), [
      "000000000001.snapshot",
      "000000000002.changes",
      "000000000003.snapshot",
    ]);
    assert.deepEqual(e.files("personal"), ["000000000001.snapshot"]);
  } finally {
    e.close();
    await rm(base, { recursive: true, force: true });
  }
});

// 지우면 write 하나를 destination마다 나눈 줄의 앞쪽만 log에 들고 core가 죽을 수 있다. 메우기는 줄이 하나도 없는 invocation만
// 채우므로 빠진 destination의 변경은 영영 내보내지지 않고, 그 stream의 흔적 정리가 그 변경의 지우기 흔적을 지울 수 있다.
test("destination마다 나눈 write의 줄은 같이 들거나 하나도 들지 않아, 사이에서 죽으면 메우기가 모든 destination에 '다시 snapshot'을 남긴다", async () => {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-split-crash-"));
  const plan = syncPlanOf({ sync: { item: "personal", note: "drive" } });
  const e = await realExport(base, plan, (_release, destination) =>
    sentTables(plan, destination),
  );
  try {
    await e.run("personal");
    await e.run("drive");
    const both =
      "insert into item values ('a', 'milk'); insert into note values ('n', 'call')";
    // 첫 줄을 넣은 뒤 둘째 줄을 넣다 죽는다.
    e.knobs.dieAtInsert = 2;
    await assert.rejects(
      e.log.written(e.inv("inv_1"), "100", e.changeset(both)),
    );
    assert.deepEqual(e.log.page(APP, 0, 10), []);

    // 다시 뜬 core가 메운다: 그 invocation은 줄이 없으니 모든 destination의 '다시 snapshot' 줄 하나다.
    e.knobs.dieAtInsert = null;
    e.knobs.live = [
      {
        id: "inv_1",
        app: APP,
        release: REL,
        caller: null,
        effect: "write",
        status: "succeeded",
        changeset: { hash: "h", size: 1 },
      },
    ];
    const filled = await e.log.backfill(APP);
    assert.ok(filled.ok && filled.value === 1);
    assert.deepEqual(
      e.log.page(APP, 0, 10).map((row) => [row.kind, row.destination]),
      [["snapshot", null]],
    );
    await e.run("personal");
    await e.run("drive");
    for (const name of ["personal", "drive"]) {
      assert.deepEqual(e.files(name), [
        "000000000001.snapshot",
        "000000000002.snapshot",
      ]);
    }

    // 죽지 않으면 destination마다 한 줄씩 한 번 든다.
    await e.log.written(
      e.inv("inv_2"),
      "101",
      e.changeset(
        "update item set title = 'tea'; update note set body = 'text'",
      ),
    );
    assert.deepEqual(
      e.log
        .page(APP, 1, 10)
        .map((row) => [row.kind, row.destination, row.invocation]),
      [
        ["change", "drive", "inv_2"],
        ["change", "personal", "inv_2"],
      ],
    );
  } finally {
    e.close();
    await rm(base, { recursive: true, force: true });
  }
});

// 지우면 release가 표를 다른 destination으로 옮긴 뒤 이 기계의 held 변경이 줄에 적힌 옛 destination에만 걸려, 새 destination의
// snapshot에 사람이 아직 정하지 않은 그 변경이 실려 나간다.
test("이 기계의 held 변경은 지금 release가 그 표를 보내는 destination의 snapshot을 막는다: 표를 옮긴 release 뒤에는 새 destination이 막힌다", async () => {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-held-moved-"));
  const plan = syncPlanOf({ sync: { item: "personal", note: "drive" } });
  const REL2 = "rel_01hyyyyyyyyyyyyyyyyyyyyyyy";
  const horizons: Record<string, { machine: Id<"mch">; horizon: string }[]> =
    {};
  const e = await realExport(
    base,
    plan,
    (release, destination) =>
      sentTables(e.knobs.plans.get(release)!, destination),
    horizons,
  );
  try {
    await e.run("personal");
    await e.run("drive");
    // personal에서 떨어져 있는 동안 item을 고쳤다: personal의 held 줄이다.
    horizons.personal = [{ machine: PEER_A, horizon: "1000" }];
    await e.log.written(
      e.inv("inv_1"),
      "100",
      e.changeset("insert into item values ('a', 'milk')"),
    );
    await e.run("personal");
    const [held] = e.log.heldList(APP);
    assert.equal(held?.destination, "personal");

    // 새 release가 item을 drive로, note를 personal로 옮긴다.
    e.knobs.plans.set(
      REL2,
      syncPlanOf({ sync: { item: "drive", note: "personal" } }),
    );
    e.knobs.active = REL2;
    await e.log.unknown(e.inv("inv_2", REL2));
    const drive = await e.exporter.runStream(APP, "drive");
    assert.ok(drive.ok);
    assert.equal(drive.value.error?.code, "away_too_long");
    assert.deepEqual(e.files("drive"), ["000000000001.snapshot"]);
    // personal은 이제 item을 보내지 않아 그 held가 막지 않는다.
    await e.run("personal");
    assert.deepEqual(e.files("personal"), [
      "000000000001.snapshot",
      "000000000002.snapshot",
    ]);

    // 사람이 풀면 drive도 snapshot을 쓴다.
    assert.ok(e.log.resolve(held!.seq, "2026-11-16T00:00:00.000Z").ok);
    await e.run("drive");
    assert.deepEqual(e.files("drive"), [
      "000000000001.snapshot",
      "000000000002.snapshot",
    ]);
  } finally {
    e.close();
    await rm(base, { recursive: true, force: true });
  }
});
