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
import type { SyncLog } from "../../apps/sync/log.ts";
import type { DestinationsView } from "../destinations.ts";
import type { FolderLogRow } from "../ports.ts";
import { FOLDER_SCHEMA_STEPS } from "../schema.ts";
import { createFolderExport, type ExportLog } from "./mod.ts";

// 내보내기가 기대는 sync log 면이 core의 sync log와 맞는지 type check가 본다.
void (null as unknown as SyncLog satisfies ExportLog);

const ME = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const PEER_A = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const PEER_B = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"rel">;
const BUNDLE = "b".repeat(64);
const DAY = 24 * 60 * 60 * 1000;

function fakeLog() {
  const rows: FolderLogRow[] = [];
  const blobs = new Map<string, Uint8Array>();
  const held: { hlc: string; changeset: Uint8Array }[] = [];
  const add = (row: Omit<FolderLogRow, "seq">) => {
    rows.push({ ...row, seq: rows.length + 1 });
  };
  const log: ExportLog = {
    head: () => rows.length,
    page: (_app, after, limit) =>
      rows.filter((row) => row.seq > after).slice(0, limit),
    readChangeset: (hash) => Promise.resolve(ok(blobs.get(hash)!)),
    snapshotNeeded: (_app, after) =>
      rows.some((row) => row.seq > after && row.kind === "snapshot"),
    held(_app, release, change) {
      held.push({ hlc: change.hlc, changeset: change.changeset });
      add({
        release,
        kind: "held",
        origin: change.origin,
        hlc: change.hlc,
        changeset: put(change.changeset),
        invocation: null,
      });
      return Promise.resolve(ok(rows.length));
    },
  };
  function put(bytes: Uint8Array) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    blobs.set(hash, bytes);
    return { hash, size: bytes.byteLength };
  }
  return {
    log,
    held,
    change(hlc: number, text: string, origin = "computer") {
      add({
        release: REL,
        kind: "change",
        origin,
        hlc: String(hlc),
        changeset: put(new TextEncoder().encode(text)),
        invocation: `inv_${rows.length + 1}`,
      });
      return rows.length;
    },
    marker() {
      add({
        release: REL,
        kind: "snapshot",
        origin: "computer",
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
  for (const step of FOLDER_SCHEMA_STEPS) db.exec(step.sql);
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
        sync_to: "personal",
        release: { id: REL, bundle_hash: BUNDLE, data_schema: 1 },
      },
    ],
    log: fake.log,
    releaseKey: () => ({ bundle_hash: BUNDLE, data_schema: 1 }),
    operationOf: (invocation) => ({
      name: `op_${invocation}`,
      started_at: clock.now(),
    }),
    async snapshotAt(_app, path) {
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
      const done = await exporter.runApp(APP);
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
    const last = h.exporter.status(APP)!;
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
    assert.equal(h.exporter.settledOf(APP)?.settled, "100");

    const oldSeq = h.fake.change(150, "offline edit");
    const newSeq = h.fake.change(500, "fresh edit");
    h.knobs.horizons = [{ machine: PEER_A, horizon: "200" }];
    h.knobs.caughtUp = false;
    const outcome = await h.run();

    assert.equal(outcome.held, 1);
    assert.deepStrictEqual(
      h.fake.held.map((one) => [
        one.hlc,
        new TextDecoder().decode(one.changeset),
      ]),
      [["150", "offline edit"]],
    );
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
    assert.notEqual(h.exporter.settledOf(APP)?.away_since, null);

    // 다시 돌아도 held 줄을 내보내거나 다시 held로 옮기지 않는다.
    const files = readdirSync(h.dataFolder);
    assert.equal((await h.run()).held, 0);
    assert.deepStrictEqual(readdirSync(h.dataFolder), files);
    assert.equal(h.fake.held.length, 1);
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
    assert.equal(h.exporter.status(APP)?.head, 3);
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
      assert.equal(h.exporter.status(APP)?.error?.code, "foreign_writer");
      assert.ok(statSync(h.dataFolder).isDirectory());
    });
  }
});
