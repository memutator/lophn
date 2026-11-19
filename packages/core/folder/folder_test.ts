import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import { hlcAtMs } from "../../protocol/apps/sync/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  appFilesPath,
  appFilesSchema,
  type CarryFileEntry,
  eventFilePath,
  eventFileSchema,
  machineSigningKey,
  manifestPath,
  rosterFilePath,
  rosterFileSchema,
  signManifest,
} from "../../protocol/remote/carry.ts";
import {
  appRecordPath,
  appRecordSchema,
  dataEntryPath,
  encodeChanges,
  encodeRecord,
  machineRecordSchema,
  recordPath,
  releaseFilePath,
  releaseRecordPath,
  releaseRecordSchema,
} from "../../protocol/folder/mod.ts";
import { generateKeyPair, remoteKeyText } from "../../protocol/remote/noise.ts";
import {
  generateSigningKey,
  type RosterEntryBody,
  type RosterStatement,
  rosterView,
  signRoster,
} from "../../protocol/remote/roster.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import type { SyncLog } from "../apps/sync/log.ts";
import { SYNC_LOG_SCHEMA_STEPS } from "../apps/sync/schema.ts";
import { createFileSettingsReader } from "../config/reader.ts";
import { createSettingsRegistry } from "../config/registry.ts";
import { createSettingsStore } from "../config/store.ts";
import { createRoster } from "../remote/roster.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { carryRoutes } from "./carry-routes.ts";
import { createDestinations, destinationsSetting } from "./destinations.ts";
import { createFolderExport } from "./export/mod.ts";
import { createFolderReader, createFolderWriter } from "./fs.ts";
import { readArrivedEvents } from "./import/events.ts";
import { followAsksPerson } from "./import/follow.ts";
import { createFolderImport } from "./import/mod.ts";
import { createRosterFiles } from "./import/roster.ts";
import { createMirror } from "./mirror.ts";
import type { FolderLog } from "./ports.ts";
import { createReplica } from "./replica.ts";
import {
  FOLDER_AWAY_NOTIFIED_STEPS,
  FOLDER_CARRY_MARKS_STEPS,
  FOLDER_EVENTS_SEEN_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "./schema.ts";

// export가 기대는 sync log 면이 core의 sync log와 맞는지 type check가 본다.
void (null as unknown as SyncLog satisfies FolderLog);

const ME = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const OTHER = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;

async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "lophn-folder-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 폴더 안의 모든 file과 symlink를 bytes·대상까지.
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    const path = join(entry.parentPath, entry.name);
    const key = relative(dir, path);
    if (entry.isSymbolicLink()) out[key] = "link";
    else if (entry.isFile()) out[key] = readFileSync(path, "hex");
    else out[key] = "dir";
  }
  return out;
}

// 바깥 도구가 이 폴더를 다른 기계와 사람의 cloud로 옮긴다. 남의 file이나 폴더 밖을 고치면 다른 기계의 data나 사람의 file을 잃는다.
test("writer는 자기 하위 폴더 밖에 쓰지도 지우지도 rename하지도 않는다", async () => {
  await withTemp(async (base) => {
    const destination = join(base, "dest");
    const outside = join(base, "outside");
    mkdirSync(join(destination, "machines", ME, "apps"), { recursive: true });
    mkdirSync(join(destination, "machines", OTHER), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(destination, "keep.txt"), "person");
    writeFileSync(join(destination, "machines", OTHER, "record.json"), "other");
    writeFileSync(join(outside, "victim.txt"), "outside");
    writeFileSync(join(destination, "machines", ME, "record.json"), "mine");
    // 자기 폴더 안에서 밖을 가리키는 symlink.
    symlinkSync(outside, join(destination, "machines", ME, "apps", APP));
    symlinkSync(
      join(destination, "machines", OTHER),
      join(destination, "machines", ME, "peer"),
    );
    const before = { dest: snapshot(destination), outside: snapshot(outside) };
    const writer = createFolderWriter({
      root: destination,
      machine: ME,
      random: seededRandom(1),
    });
    const bytes = new TextEncoder().encode("x");
    const attempts = [
      writer.writeFile("../outside/new.txt", bytes),
      writer.writeFile(`machines/${ME}/../${OTHER}/record.json`, bytes),
      writer.writeFile(join(outside, "victim.txt"), bytes),
      writer.writeFile("/tmp/x", bytes),
      writer.writeFile(`machines/${OTHER}/record.json`, bytes),
      writer.writeFile("keep.txt", bytes),
      writer.writeFile(`machines/${ME}/apps/${APP}/victim.txt`, bytes),
      writer.writeFile(`machines/${ME}/apps/${APP}/data/x.changes`, bytes),
      writer.writeFile(`machines/${ME}/peer/record.json`, bytes),
      writer.remove(`machines/${OTHER}/record.json`),
      writer.remove(`machines/${OTHER}`),
      writer.remove(`machines/${ME}/apps/${APP}/victim.txt`),
      writer.remove(`machines/${ME}/peer/record.json`),
      writer.remove(`machines/${ME}`),
      writer.remove("keep.txt"),
      writer.rename(
        `machines/${ME}/record.json`,
        `machines/${OTHER}/record.json`,
      ),
      writer.rename(
        `machines/${OTHER}/record.json`,
        `machines/${ME}/taken.json`,
      ),
      writer.rename(
        `machines/${ME}/record.json`,
        `machines/${ME}/apps/${APP}/victim.txt`,
      ),
      writer.rename(`machines/${ME}/peer/record.json`, `machines/${ME}/x.json`),
    ];
    for (const [index, attempt] of attempts.entries()) {
      const result = await attempt;
      assert.ok(!result.ok, `attempt ${index} must fail`);
    }
    assert.deepStrictEqual(
      { dest: snapshot(destination), outside: snapshot(outside) },
      before,
    );

    // 자기 폴더 안은 쓰고 temp를 남기지 않는다.
    const path = dataEntryPath(
      ME,
      "app_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"app">,
      1,
      "changes",
    );
    assert.ok((await writer.writeFile(path, bytes)).ok);
    assert.equal(readFileSync(join(destination, path), "utf8"), "x");
    assert.deepStrictEqual(readdirSync(join(destination, path, "..")), [
      "000000000001.changes",
    ]);
  });
});

test("reader는 layout 꼴과 정확히 맞는 이름만 돌려주고 없는 file은 not_found다", async () => {
  await withTemp(async (destination) => {
    const data = join(destination, "machines", OTHER, "apps", APP, "data");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(destination, "machines", "laptop"));
    for (const name of [
      "000000000001.changes",
      "000000000002.snapshot",
      "000000000003 (1).changes",
      "000000000003.changes.tmp-0123456789abcdef",
      ".sync-conflict-000000000003.changes",
      "000000000000.changes",
      "1.changes",
      ".DS_Store",
    ]) {
      writeFileSync(join(data, name), "x");
    }
    const reader = createFolderReader(destination);
    assert.deepStrictEqual(await reader.listMachines(), {
      ok: true,
      value: [OTHER],
    });
    assert.deepStrictEqual(
      await reader.list(`machines/${OTHER}/apps/${APP}/data`),
      { ok: true, value: ["000000000001.changes", "000000000002.snapshot"] },
    );
    const missing = await reader.read(`machines/${OTHER}/record.json`, 10);
    assert.ok(!missing.ok);
    assert.equal(missing.error.code, "not_found");
    const large = await reader.read(
      `machines/${OTHER}/apps/${APP}/data/000000000001.changes`,
      0,
    );
    assert.ok(!large.ok);
    assert.equal(large.error.code, "too_large");
  });
});

async function withSettings(
  dataRoot: string,
  run: (
    store: ReturnType<typeof createSettingsStore>,
    file: string,
  ) => Promise<void>,
) {
  const store = createSettingsStore({
    root: dataRoot,
    registry: createSettingsRegistry([destinationsSetting(dataRoot)]),
    publish: () => {},
    log: () => {},
  });
  try {
    await run(store, join(dataRoot, "settings.json"));
  } finally {
    store.close();
  }
}

// data root가 바깥 도구가 옮기는 폴더 안에 들거나 그것을 품으면 살아 있는 ledger와 앱 DB가 기계 사이로 퍼져 깨진다.
test("data root와 겹치거나 상대이거나 다른 destination과 겹친 destination은 거절된다", async () => {
  await withTemp(async (base) => {
    const dataRoot = join(base, "home", ".lophn");
    mkdirSync(dataRoot, { recursive: true });
    const sync = join(base, "Sync");
    await withSettings(dataRoot, async (store, file) => {
      const set = (value: unknown) =>
        store.update([{ key: "folder.destinations", action: "set", value }]);
      assert.ok((await set({ personal: { path: sync } })).ok);
      const accepted = readFileSync(file, "utf8");
      for (const value of [
        { personal: { path: join(dataRoot, "sync") } },
        { personal: { path: dataRoot } },
        { personal: { path: base } },
        { personal: { path: "Sync/lophn" } },
        { personal: { path: sync }, work: { path: join(sync, "work") } },
        { personal: { path: sync }, work: { path: sync } },
        // 미리 있는 갈 곳의 이름은 사람의 폴더가 가로채지 못한다.
        { personal: { path: sync }, computers: { path: join(base, "c") } },
      ]) {
        const result = await set(value);
        assert.ok(result.ok);
        assert.equal(result.value.rejected.length, 1, JSON.stringify(value));
        assert.equal(readFileSync(file, "utf8"), accepted);
      }
      // 손으로 고친 settings.json은 check를 지나치므로 읽는 쪽도 쓰지 않는다.
      writeFileSync(
        file,
        JSON.stringify({
          "folder.destinations": {
            inside: { path: join(dataRoot, "x") },
            personal: { path: sync },
          },
        }),
      );
      const destinations = createDestinations({
        dataRoot,
        settings: createFileSettingsReader(dataRoot),
      });
      assert.equal(destinations.resolve("inside"), null);
      assert.deepStrictEqual(destinations.list(), [
        { name: "computers", path: join(dataRoot, "computers"), state: "ok" },
        { name: "personal", path: sync, state: "missing" },
      ]);
    });
  });
});

// 사람의 ledger가 이 step을 돈다. 다른 표의 행을 잃으면 안 된다.
test("folder.tables가 기존 ledger에 걸려도 다른 표의 행이 그대로다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of SYNC_LOG_SCHEMA_STEPS) db.exec(step.sql);
    db.prepare(
      "insert into app_sync_log (app, release, kind, origin, hlc, changeset_hash, changeset_size, created_at) values (?, ?, 'change', 'computer', '5', ?, 3, ?)",
    ).run(APP, "rel_1", "c".repeat(64), "2026-11-16T00:00:00.000Z");
    const rows = () => db.prepare("select * from app_sync_log").all();
    const before = rows();
    for (const step of FOLDER_SCHEMA_STEPS) db.exec(step.sql);
    assert.deepStrictEqual(rows(), before);
    assert.deepStrictEqual(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name like 'folder_%' order by name",
        )
        .all()
        .map((row) => row.name),
      [
        "folder_held",
        "folder_reads",
        "folder_records",
        "folder_streams",
        "folder_written",
      ],
    );
  } finally {
    db.close();
  }
});

// --- 기계 사이로 옮기기(`computers` 폴더) ---

const OUTSIDER = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"rel">;
const ACTIVE = "a".repeat(64);
const T0 = Date.UTC(2026, 10, 18);
const AT = new Date(T0).toISOString();
const EVENT_ID = "01hzzzzzzzzzzzzzzzzzzzzzzz";
const text = (value: string) => new TextEncoder().encode(value);
const hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const listed = (path: string, bytes: Uint8Array): CarryFileEntry => ({
  path,
  size: bytes.byteLength,
  sha256: hex(bytes),
});

const keyRandom = seededRandom(23);
let serial = 0;
function computer(machine: Id<"mch">) {
  serial += 1;
  const host = generateKeyPair(keyRandom);
  return {
    id: `dev_1${String(serial).padStart(25, "0")}`,
    machine,
    host,
    key: remoteKeyText(host.publicKey),
    signing: generateSigningKey(keyRandom),
  };
}
type Computer = ReturnType<typeof computer>;
const computerEntry = (c: Computer): RosterEntryBody => ({
  type: "entry",
  id: c.id,
  kind: "computer",
  key: c.key,
  signing_key: remoteKeyText(c.signing.publicKey),
  machine: c.machine,
  name: "computer",
  os: "linux",
  rev: 1,
  invite: null,
});
const signedBy = (body: RosterEntryBody, by: Computer): RosterStatement => ({
  body,
  by: by.id,
  signature: signRoster(body, by.signing.secretKey),
});

// 받는 컴퓨터(ME)의 명단: OTHER를 들였다. OUTSIDER는 명단에 없다.
const desk = computer(ME);
const laptop = computer(OTHER);
const stranger = computer(OUTSIDER);
const deskKey = remoteKeyText(desk.signing.publicKey);
const deskView = rosterView(
  [signedBy(computerEntry(desk), desk), signedBy(computerEntry(laptop), desk)],
  [deskKey],
  deskKey,
);

// 한 컴퓨터가 `computers`에 낸 것: 기계 기록, 앱 기록, data file 하나(그리고 더 실을 file), 앱 목록, 서명한 manifest.
async function published(
  owner: Computer,
  extra: Record<string, Uint8Array> = {},
) {
  const machine = owner.machine;
  const changes = await encodeChanges({
    machine,
    app: APP,
    n: 1,
    release: { bundle_hash: ACTIVE, data_schema: 1 },
    created_at: AT,
    changes: [
      {
        meta: {
          id: "1",
          hlc: String(hlcAtMs(T0)),
          origin: "computer",
          operation: "save",
          started_at: AT,
        },
        bytes: text("change 1"),
      },
    ],
  });
  assert.ok(changes.ok);
  const inApp: Record<string, Uint8Array> = {
    [appRecordPath(machine, APP)]: encodeRecord(appRecordSchema, {
      format: 1,
      machine,
      app: APP,
      revision: 1,
      updated_at: AT,
      slug: "notes",
      name: "Notes",
      description: "",
      sync_to: "computers",
      active_release: null,
      releases: [],
      data: { head: 1, snapshot: null },
      source: { head: 0 },
      read: {},
      settled: null,
      horizon: null,
    }),
    [dataEntryPath(machine, APP, 1, "changes")]: changes.value,
    ...extra,
  };
  const top: Record<string, Uint8Array> = {
    [recordPath(machine)]: encodeRecord(machineRecordSchema, {
      format: 1,
      machine,
      revision: 1,
      updated_at: AT,
      name: "Laptop",
      always_on: null,
      addresses: { lan: [], port: null, relay: null },
      lophn: {
        version: "0.23.0",
        protocol: { version: 4, min_version: 4 },
        folder: { version: 1, min_version: 1 },
      },
    }),
    [appFilesPath(machine, APP)]: encodeRecord(appFilesSchema, {
      format: 1,
      machine,
      app: APP,
      written_at: AT,
      files: Object.entries(inApp).map(([path, bytes]) => listed(path, bytes)),
    }),
  };
  const manifest = signManifest(
    {
      format: 1,
      machine,
      revision: 1,
      written_at: AT,
      files: Object.entries(top).map(([path, bytes]) => listed(path, bytes)),
    },
    owner.signing.secretKey,
  );
  return {
    manifest,
    files: { ...top, ...inApp, [manifestPath(machine)]: text(manifest) },
    changesPath: dataEntryPath(machine, APP, 1, "changes"),
  };
}

async function carryEnv(
  run: (env: Awaited<ReturnType<typeof carrySetup>>) => Promise<void>,
) {
  const base = await mkdtemp(join(tmpdir(), "lophn-carry-"));
  const env = await carrySetup(base);
  try {
    await run(env);
  } finally {
    env.db.close();
    await rm(base, { recursive: true, force: true });
  }
}

async function carrySetup(base: string) {
  const dataRoot = join(base, "root");
  const shared = join(base, "shared");
  mkdirSync(dataRoot);
  mkdirSync(shared);
  const computers = join(dataRoot, "computers");
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...FOLDER_SCHEMA_STEPS,
    ...FOLDER_AWAY_NOTIFIED_STEPS,
    ...FOLDER_EVENTS_SEEN_STEPS,
    ...FOLDER_CARRY_MARKS_STEPS,
  ]) {
    db.exec(step.sql);
  }
  const sql: Sql = createSql(db, () => true);
  function transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T> {
    db.exec("BEGIN");
    try {
      const done = fn({ sql });
      db.exec(done.ok ? "COMMIT" : "ROLLBACK");
      return done;
    } catch (thrown) {
      db.exec("ROLLBACK");
      throw thrown;
    }
  }
  const clock = manualClock(T0);
  const random = seededRandom(3);
  // 명단이 바뀌는 test가 고친다.
  const roster = {
    signingKey: (machine: string) => machineSigningKey(deskView, machine),
    removed: (_machine: string) => false,
  };
  const known = (machine: Id<"mch">) => roster.signingKey(machine) !== null;
  const replica = createReplica({
    dataRoot,
    machine: () => ME,
    signingKey: (machine) => roster.signingKey(machine),
    removed: (machine) => roster.removed(machine),
    sql,
    transaction,
    clock,
    random,
    manifestsChanged: () => undefined,
    filesChanged: () => undefined,
  });
  const routes = carryRoutes({ me: () => ME, known, replica, clock });
  const putRoute = routes.memory[0]![1];
  const fileRoute = routes.fileStreams[0]![1];
  const mirror = createMirror({
    me: () => ME,
    known,
    computers,
    replica,
    random,
  });
  const onlyComputers = {
    list: () => [{ name: "computers", path: computers, state: "ok" as const }],
    resolve: (name: string) =>
      name === "computers" ? { path: computers, state: "ok" as const } : null,
  };
  const applied: string[] = [];
  return {
    db,
    roster,
    fileRoute,
    putRoute,
    dataRoot,
    shared,
    computers,
    replica,
    mirror,
    applied,
    clock,
    transaction,
    onlyComputers,
    /** 연결이 가져온 file. `declared`는 나르는 쪽이 말한 크기·hash(목록의 것). */
    link: (
      machine: Id<"mch">,
      path: string,
      bytes: Uint8Array,
      declared: Uint8Array = bytes,
    ) =>
      replica.receive({
        machine,
        path,
        size: declared.byteLength,
        sha256: hex(declared),
        via: "link",
        chunks: (async function* () {
          yield bytes;
        })(),
      }),
    /** 폰이 `carry/put`으로 조각마다 넘긴다. 마지막 답. */
    async phone(
      machine: Id<"mch">,
      path: string,
      bytes: Uint8Array,
      declared: Uint8Array = bytes,
      chunk = 7,
    ) {
      let status = "";
      for (
        let offset = 0;
        offset === 0 || offset < bytes.byteLength;
        offset += chunk
      ) {
        const done = await putRoute({} as never, {
          machine,
          path,
          size: declared.byteLength,
          sha256: hex(declared),
          offset,
          bytes: Buffer.from(bytes.subarray(offset, offset + chunk)).toString(
            "base64",
          ),
        });
        assert.ok(done.ok, JSON.stringify(done));
        status = (done.value as { status: string }).status;
        if (status !== "partial") return status;
      }
      return status;
    },
    toShared(files: Record<string, Uint8Array>) {
      for (const [path, bytes] of Object.entries(files)) {
        const target = join(shared, ...path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      }
    },
    held: () => snapshot(computers),
    importer: () =>
      createFolderImport({
        machine: () => ME,
        self: () => ({ name: "Desk", lophn_version: "0.23.0" }),
        destinations: onlyComputers,
        apps: () => [
          {
            app: APP,
            sync_to: "computers",
            release: { id: REL, bundle_hash: ACTIVE, data_schema: 1 },
          },
        ],
        apply: {
          async applyChanges(input) {
            applied.push(...input.changes.map((change) => change.id));
            return ok({
              applied: input.changes.length,
              skipped: 0,
              duplicate: 0,
              held: 0,
            });
          },
          mergeSnapshot: async () => ok({ changed: true, deleted: 0 }),
        },
        exportState: () => ({ settled: null, data_head: 0, away_since: null }),
        heldRows: () => [],
        sql,
        transaction,
        clock,
        random,
        root: dataRoot,
      }),
  };
}

// 같은 file이 길마다 따로 쓰이거나 두 번 적용되면 앱 data가 두 번 바뀐다.
test("같은 file이 연결, 폰, 사람의 폴더로 다 와도 computers 폴더에 한 번 쓰이고 읽기가 한 번 적용한다", async () => {
  await carryEnv(async (env) => {
    const sent = await published(laptop);
    assert.deepEqual(
      await env.replica.offerManifest(sent.manifest, "link"),
      ok("accepted"),
    );
    for (const path of [
      recordPath(OTHER),
      appFilesPath(OTHER, APP),
      appRecordPath(OTHER, APP),
    ]) {
      assert.deepEqual(
        await env.link(OTHER, path, sent.files[path]!),
        ok("accepted"),
        path,
      );
    }
    assert.equal(
      await env.phone(OTHER, manifestPath(OTHER), text(sent.manifest)),
      "have",
    );
    assert.equal(
      await env.phone(OTHER, sent.changesPath, sent.files[sent.changesPath]!),
      "accepted",
    );
    assert.deepEqual(
      await env.link(OTHER, sent.changesPath, sent.files[sent.changesPath]!),
      ok("have"),
    );
    env.toShared(sent.files);
    const held = env.held();
    await env.mirror.takeIn(env.shared);
    assert.deepEqual(env.held(), held);

    const importer = env.importer();
    assert.ok((await importer.scan()).ok);
    assert.ok((await importer.runApp(APP)).ok);
    // 다시 와도(거울, 연결) 한 번이다.
    await env.mirror.takeIn(env.shared);
    await env.link(OTHER, sent.changesPath, sent.files[sent.changesPath]!);
    assert.ok((await importer.scan()).ok);
    assert.ok((await importer.runApp(APP)).ok);
    assert.deepEqual(env.applied, ["1"]);
    assert.deepEqual(env.held(), held);
  });
});

// 폰, 다른 컴퓨터, cloud 폴더는 믿지 않는 곳이다. 거기서 고치거나 바꿔친 file이 앱 data와 code로 들어가면 안 된다.
test("서명한 목록에 없는 file, 내용이 목록과 다른 file, 명단에 없는 컴퓨터의 manifest는 어느 길로도 받지 않는다", async () => {
  await carryEnv(async (env) => {
    const sent = await published(laptop);
    assert.deepEqual(
      await env.replica.offerManifest(sent.manifest, "link"),
      ok("accepted"),
    );
    for (const path of [
      recordPath(OTHER),
      appFilesPath(OTHER, APP),
      appRecordPath(OTHER, APP),
    ]) {
      assert.deepEqual(
        await env.link(OTHER, path, sent.files[path]!),
        ok("accepted"),
      );
    }
    const outsider = await published(stranger);
    const stray = dataEntryPath(OTHER, APP, 2, "changes");
    const strayBytes = sent.files[sent.changesPath]!;
    const original = sent.files[sent.changesPath]!;
    const tampered = original.slice();
    tampered[tampered.byteLength - 1]! ^= 1;
    const held = env.held();

    // 연결
    assert.deepEqual(
      await env.replica.offerManifest(outsider.manifest, "link"),
      ok("rejected"),
    );
    assert.deepEqual(
      await env.link(
        OUTSIDER,
        recordPath(OUTSIDER),
        outsider.files[recordPath(OUTSIDER)]!,
      ),
      ok("rejected"),
    );
    assert.deepEqual(await env.link(OTHER, stray, strayBytes), ok("rejected"));
    assert.deepEqual(
      await env.link(OTHER, sent.changesPath, tampered, original),
      ok("rejected"),
    );
    // 폰
    assert.equal(
      await env.phone(
        OUTSIDER,
        manifestPath(OUTSIDER),
        text(outsider.manifest),
      ),
      "rejected",
    );
    assert.equal(await env.phone(OTHER, stray, strayBytes), "rejected");
    assert.equal(
      await env.phone(OTHER, sent.changesPath, tampered, original),
      "rejected",
    );
    // 사람의 폴더
    env.toShared({
      ...outsider.files,
      ...sent.files,
      [stray]: strayBytes,
      [sent.changesPath]: tampered,
    });
    await env.mirror.takeIn(env.shared);

    assert.deepEqual(env.held(), held);
    assert.deepEqual(readdirSync(env.replica.stagingDir), []);
  });
});

// 앱을 사람이 이름 붙인 폴더로 맞추던 사람은 갈 곳이 더해져도 그 폴더로 그대로 주고받아야 한다(다른 기계가 그 폴더를 본다).
test("이름 붙인 폴더로 맞추던 앱은 computers가 더해져도 그 폴더로 내보내고 읽는다", async () => {
  await withTemp(async (base) => {
    const dataRoot = join(base, "root");
    const sync = join(base, "Sync");
    mkdirSync(dataRoot);
    mkdirSync(sync);
    writeFileSync(
      join(dataRoot, "settings.json"),
      JSON.stringify({ "folder.destinations": { personal: { path: sync } } }),
    );
    const destinations = createDestinations({
      dataRoot,
      settings: createFileSettingsReader(dataRoot),
    });
    assert.deepEqual(destinations.resolve("personal"), {
      path: sync,
      state: "ok",
    });
    const db = new DatabaseSync(":memory:");
    try {
      for (const step of FOLDER_SCHEMA_STEPS) db.exec(step.sql);
      const sql: Sql = createSql(db, () => true);
      const transaction = <T>(
        fn: (tx: Pick<Tx, "sql">) => Result<T>,
      ): Result<T> => {
        db.exec("BEGIN");
        const done = fn({ sql });
        db.exec(done.ok ? "COMMIT" : "ROLLBACK");
        return done;
      };
      const clock = manualClock(T0);
      const app = {
        app: APP,
        slug: "notes",
        name: "Notes",
        description: "",
        sync_to: "personal",
        release: { id: REL, bundle_hash: ACTIVE, data_schema: 1 },
      };
      const exporter = createFolderExport({
        machine: () => ({ id: ME, name: "Desk" }),
        destinations,
        apps: () => [app],
        log: {
          head: () => 0,
          page: () => [],
          readChangeset: async () => ok(new Uint8Array()),
          hold: () => ok(undefined),
          heldInData: () => 0,
        },
        releaseKey: () => ({ bundle_hash: ACTIVE, data_schema: 1 }),
        operationOf: () => null,
        async snapshotAt(_app, path) {
          writeFileSync(path, "app db");
          return ok({ seq: 0, size: 6, sha256: hex(text("app db")) });
        },
        facts: () => ({
          addresses: { lan: [], port: null, relay: null },
          alwaysOn: null,
          lophn: {
            version: "0.23.0",
            protocol: { version: 4, min_version: 4 },
          },
        }),
        readsCaughtUp: () => true,
        peerHorizons: () => [],
        sql,
        transaction,
        clock,
        random: seededRandom(5),
        dataRoot,
      });
      const ran = await exporter.runApp(APP);
      assert.ok(ran.ok && ran.value.error === null, JSON.stringify(ran));
      assert.deepEqual(
        readdirSync(join(sync, "machines", ME, "apps", APP, "data")),
        ["000000000001.snapshot"],
      );
      assert.ok(!existsSync(join(dataRoot, "computers", "machines")));

      // 다른 기계가 그 폴더에 낸 변경을 읽는다.
      const sent = await published(laptop);
      for (const [path, bytes] of Object.entries(sent.files)) {
        const target = join(sync, ...path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      }
      const applied: string[] = [];
      const importer = createFolderImport({
        machine: () => ME,
        self: () => ({ name: "Desk", lophn_version: "0.23.0" }),
        destinations,
        apps: () => [{ app: APP, sync_to: "personal", release: app.release }],
        apply: {
          async applyChanges(input) {
            applied.push(...input.changes.map((change) => change.id));
            return ok({
              applied: input.changes.length,
              skipped: 0,
              duplicate: 0,
              held: 0,
            });
          },
          mergeSnapshot: async () => ok({ changed: true, deleted: 0 }),
        },
        exportState: () => ({ settled: null, data_head: 1, away_since: null }),
        heldRows: () => [],
        sql,
        transaction,
        clock,
        random: seededRandom(6),
        root: dataRoot,
      });
      assert.ok((await importer.scan()).ok);
      assert.ok((await importer.runApp(APP)).ok);
      assert.deepEqual(applied, ["1"]);
    } finally {
      db.close();
    }
  });
});

// 폴더는 명단 밖의 누구나 쓸 수 있다. 그 file이 모르는 기기를 명단에 들이면 그 기기가 터미널과 앱을 쓴다.
test("폴더의 명단 file에 믿는 서명이 없는 항목이 있어도 읽은 기계의 명단에 기기로 들지 않는다", async () => {
  await withTemp(async (shared) => {
    const clock = manualClock(T0);
    const random = seededRandom(9);
    const roster = createRoster({
      clock,
      random,
      ids: createIdSource({ clock, random }),
      load: async () => ok({ statements: [], reach: [] }),
      store: async () => ok(undefined),
      changed: () => undefined,
    });
    assert.ok((await roster.load()).ok);
    const host = generateKeyPair(random);
    const signing = generateSigningKey(random);
    await roster.useKeys({ host, signing });
    const self = await roster.ensureSelf({
      machine: ME,
      name: () => "desk",
      os: "linux",
    });
    assert.ok(self.ok);
    const me = {
      ...desk,
      id: self.value.id,
      host,
      key: remoteKeyText(host.publicKey),
      signing,
    };
    // 그 폴더의 OTHER 명단 file: 이 컴퓨터가 서명한 OTHER 항목(믿는다)과 OUTSIDER가 스스로 서명한 항목(믿지 않는다).
    const file = encodeRecord(rosterFileSchema, {
      format: 1,
      machine: OTHER,
      written_at: AT,
      statements: [
        signedBy(computerEntry(laptop), me),
        signedBy(computerEntry(stranger), stranger),
      ],
    });
    const target = join(shared, ...rosterFilePath(OTHER).split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file);
    const files = createRosterFiles({
      me: () => ME,
      // OTHER는 명단의 컴퓨터다: 그 file 전체가 명단 규칙을 지난다.
      known: () => true,
      receive: async (statements) => {
        const done = await roster.receive({
          statements: [...statements],
          reach: [],
        });
        return done.ok ? ok(undefined) : done;
      },
      log: () => undefined,
    });
    await files.readKnown(shared);
    const keys = roster.view().devices.map((device) => device.body.key);
    assert.ok(keys.includes(laptop.key), "the trusted entry was read");
    assert.ok(!keys.includes(stranger.key));
  });
});

// 같은 event를 두 번 내면 앱이 같은 일(알림, 결제 등)을 두 번 한다.
test("다른 기계의 같은 event file이 여러 길로 와도 이 기계에서 한 번 난다", async () => {
  await carryEnv(async (env) => {
    const eventPath = eventFilePath(OTHER, APP, EVENT_ID);
    const eventBytes = encodeRecord(eventFileSchema, {
      format: 1,
      machine: OTHER,
      app: APP,
      id: EVENT_ID,
      bundle_hash: ACTIVE,
      name: "note.saved",
      payload: { note: 1 },
      at: AT,
    });
    const sent = await published(laptop, { [eventPath]: eventBytes });
    assert.deepEqual(
      await env.replica.offerManifest(sent.manifest, "link"),
      ok("accepted"),
    );
    for (const path of [appFilesPath(OTHER, APP), eventPath]) {
      assert.deepEqual(
        await env.link(OTHER, path, sent.files[path]!),
        ok("accepted"),
      );
    }
    const arrived: string[] = [];
    const read = async () => {
      const done = await readArrivedEvents({
        me: ME,
        apps: [{ app: APP, sync_to: "computers", bundle_hash: ACTIVE }],
        destinations: env.onlyComputers as never,
        transaction: env.transaction,
        clock: env.clock,
        arrived: (event) => arrived.push(`${event.origin} ${event.name}`),
      });
      assert.ok(done.ok);
    };
    await read();
    assert.equal(await env.phone(OTHER, eventPath, eventBytes), "have");
    env.toShared(sent.files);
    await env.mirror.takeIn(env.shared);
    await read();
    // 정리로 지워졌다가 다른 길로 다시 와도.
    rmSync(join(env.computers, ...eventPath.split("/")));
    assert.equal(await env.phone(OTHER, eventPath, eventBytes), "accepted");
    await read();
    assert.deepEqual(arrived, [`${OTHER} note.saved`]);
  });
});

// manifest는 내보내기마다 바뀌고 앱 목록과 snapshot은 뒤에 온다. 그 전에 옛 file을 지우면 새 것이 올 때까지 그 앱의 data가
// 없어지고 아직 적용하지 않은 변경을 버린다.
test("새 manifest를 받아도 새 앱 목록과 그것이 싣는 snapshot이 오기 전에는 앞 file을 두고, 온 뒤에는 싣지 않는 file만 지운다", async () => {
  await carryEnv(async (env) => {
    const sent = await published(laptop);
    assert.deepEqual(
      await env.replica.offerManifest(sent.manifest, "link"),
      ok("accepted"),
    );
    for (const [path, bytes] of Object.entries(sent.files)) {
      if (path !== manifestPath(OTHER)) await env.link(OTHER, path, bytes);
    }
    const first = join(env.computers, ...sent.changesPath.split("/"));
    assert.ok(existsSync(first));

    // 주인이 snapshot 2를 쓰고 1을 지웠다(compaction).
    const second = dataEntryPath(OTHER, APP, 2, "snapshot");
    const secondBytes = text("snapshot 2 bytes");
    const appJson = sent.files[appRecordPath(OTHER, APP)]!;
    const list = encodeRecord(appFilesSchema, {
      format: 1,
      machine: OTHER,
      app: APP,
      written_at: AT,
      files: [
        listed(appRecordPath(OTHER, APP), appJson),
        listed(second, secondBytes),
      ],
    });
    const next = signManifest(
      {
        format: 1,
        machine: OTHER,
        revision: 2,
        written_at: AT,
        files: [
          listed(recordPath(OTHER), sent.files[recordPath(OTHER)]!),
          listed(appFilesPath(OTHER, APP), list),
        ],
      },
      laptop.signing.secretKey,
    );
    assert.deepEqual(
      await env.replica.offerManifest(next, "phone"),
      ok("accepted"),
    );
    assert.ok(existsSync(first), "the old list still names it");
    // 옛 manifest로 돌아가지 않는다.
    assert.deepEqual(
      await env.replica.offerManifest(sent.manifest, "folder"),
      ok("have"),
    );
    assert.deepEqual(
      await env.link(OTHER, appFilesPath(OTHER, APP), list),
      ok("accepted"),
    );
    // 새 목록이 왔어도 그것이 싣는 snapshot이 오기 전에는 그 앞 번호를 둔다.
    assert.ok(existsSync(first), "snapshot 2 has not arrived yet");
    const wants = await env.replica.wants(10);
    assert.ok(wants.ok);
    assert.deepEqual(
      wants.value.map((want) => want.path),
      [second],
    );
    assert.deepEqual(
      await env.link(OTHER, second, secondBytes),
      ok("accepted"),
    );
    assert.ok(!existsSync(first));
    assert.ok(
      existsSync(join(env.computers, ...appRecordPath(OTHER, APP).split("/"))),
    );
  });
});

// 빼기 다툼이나 도둑의 빼기 하나로 정직한 컴퓨터의 사본(큰 snapshot, release)을 지우면 다시 받을 때까지 잃는다. 반대로 믿지
// 않게 된 컴퓨터의 file을 계속 내주거나 읽으면 빠진 기계의 것이 퍼진다.
test("명단에서 맞지 않게 된 컴퓨터의 사본은 두되 내주지 않고, 정해진 빼기는 7일 동안 치워 두었다가 지운다", async () => {
  await carryEnv(async (env) => {
    const sent = await published(laptop);
    assert.deepEqual(
      await env.replica.offerManifest(sent.manifest, "link"),
      ok("accepted"),
    );
    for (const [path, bytes] of Object.entries(sent.files)) {
      if (path !== manifestPath(OTHER)) await env.link(OTHER, path, bytes);
    }
    const held = env.held();
    const subtree = join(env.computers, "machines", OTHER);
    const serves = async () => {
      const wants = await env.replica.wants(10);
      const file = await env.fileRoute({} as never, {
        machine: OTHER,
        path: sent.changesPath,
        offset: 0,
        length: 10,
      });
      return {
        wants: wants.ok ? wants.value.length : -1,
        holds: await env.replica.holds(OTHER, sent.changesPath),
        manifest: await env.replica.holds(OTHER, manifestPath(OTHER)),
        file: file.ok,
      };
    };
    assert.deepEqual(await serves(), {
      wants: 0,
      holds: true,
      manifest: true,
      file: true,
    });
    const nothing = { wants: 0, holds: false, manifest: false, file: false };

    // 다툼(서명 key가 없다, 빼기는 정해지지 않음): 두고 내주지 않는다.
    env.roster.signingKey = () => null;
    await env.replica.recheck();
    assert.deepEqual(env.held(), held);
    assert.deepEqual(await serves(), nothing);
    assert.equal(
      await env
        .link(OTHER, sent.changesPath, sent.files[sent.changesPath]!)
        .then((r) => r.ok && r.value),
      "rejected",
    );

    // 정해진 빼기: 읽기가 보는 폴더에서 치우고, 풀리면 되돌린다.
    env.roster.removed = (machine) => machine === OTHER;
    await env.replica.recheck();
    assert.ok(!existsSync(subtree));
    assert.deepEqual(await serves(), nothing);
    env.roster.removed = () => false;
    await env.replica.recheck();
    assert.deepEqual(env.held(), held);

    // 다시 정해지고 7일이 지나면 지운다.
    env.roster.removed = (machine) => machine === OTHER;
    await env.replica.recheck();
    env.clock.advance(7 * 24 * 60 * 60 * 1000 - 1);
    await env.replica.recheck();
    assert.ok(existsSync(join(env.dataRoot, "carry-removed", OTHER)));
    env.clock.advance(1);
    await env.replica.recheck();
    assert.deepEqual(readdirSync(join(env.dataRoot, "carry-removed")), []);
    assert.ok(!existsSync(subtree));
  });
});

// 같은 조각을 timeout 뒤 다시 보내는 것은 흔하다. 겹친 조각이 맞는 file을 rejected로 만들면 폰은 하나뿐인 사본을 지운다.
test("carry/put의 같은 조각이 겹쳐 오거나 다시 와도 맞는 file이 rejected가 되지 않는다", async () => {
  await carryEnv(async (env) => {
    const sent = await published(laptop);
    await env.replica.offerManifest(sent.manifest, "link");
    for (const path of [recordPath(OTHER), appFilesPath(OTHER, APP)]) {
      await env.link(OTHER, path, sent.files[path]!);
    }
    const bytes = sent.files[sent.changesPath]!;
    const half = Math.floor(bytes.byteLength / 2);
    const chunk = (principal: string, offset: number, end: number) =>
      env.putRoute({ principal } as never, {
        machine: OTHER,
        path: sent.changesPath,
        size: bytes.byteLength,
        sha256: hex(bytes),
        offset,
        bytes: Buffer.from(bytes.subarray(offset, end)).toString("base64"),
      });
    const status = (done: Result<unknown>) =>
      done.ok ? (done.value as { status: string }).status : done.error.code;
    // 두 기기가 같은 file을 처음부터, 한 기기는 뒤 조각을 두 번 겹쳐 보낸다.
    assert.equal(status(await chunk("device:a", 0, half)), "partial");
    assert.equal(status(await chunk("device:b", 0, half)), "partial");
    const both = await Promise.all([
      chunk("device:a", half, bytes.byteLength),
      chunk("device:a", half, bytes.byteLength),
    ]);
    assert.deepEqual(both.map(status).sort(), ["accepted", "invalid_input"]);
    assert.equal(
      status(await chunk("device:b", half, bytes.byteLength)),
      "have",
    );
  });
});

// 다른 컴퓨터의 release를 따라가면 그 code가 이 컴퓨터에서 사람이 준 권한으로 돈다. 명단의 컴퓨터(도둑맞은 노트북 포함)가
// 그것으로 이 컴퓨터에서 code를 돌리면 안 된다. 묻지 않는 것은 이 컴퓨터에서 허락한 컴퓨터(이 컴퓨터의 표)뿐이다.
test("여기서 허락하지 않은 컴퓨터의 release는 묻고, 허락한 컴퓨터의 것과 이름 붙인 폴더로 온 것은 묻지 않고 따라간다", () => {
  const granted = (machine: Id<"mch">) => machine === OTHER;
  const cases: [
    string,
    { machine: Id<"mch">; destination: string }[],
    boolean,
  ][] = [
    [
      "허락하지 않은 컴퓨터",
      [{ machine: OUTSIDER, destination: "computers" }],
      true,
    ],
    ["허락한 컴퓨터", [{ machine: OTHER, destination: "computers" }], false],
    ["이름 붙인 폴더", [{ machine: OUTSIDER, destination: "personal" }], false],
    [
      "허락하지 않은 컴퓨터가 낸 것과 이름 붙인 폴더가 함께",
      [
        { machine: OUTSIDER, destination: "computers" },
        { machine: OUTSIDER, destination: "personal" },
      ],
      false,
    ],
    ["출처를 모름", [], true],
  ];
  for (const [label, offers, asks] of cases) {
    assert.equal(followAsksPerson(offers, granted), asks, label);
  }
});

// 새 목록 file은 다른 길로 언제든 온다. 앞 manifest의 정리가 도는 사이 그것이 오면, 옛 사슬로 정한 지우기가 새 목록이 싣는
// file을 지워 다시 받아야 한다(가진 사람이 닿지 않으면 읽기가 멈춘다).
test("앞 목록의 정리가 도는 사이 새 앱 목록이 와도 새 목록이 싣는 file은 지워지지 않는다", async () => {
  await carryEnv(async (env) => {
    const data: Record<string, Uint8Array> = {
      [dataEntryPath(OTHER, APP, 1, "snapshot")]: text("snapshot 1"),
    };
    for (let n = 2; n <= 40; n++) {
      data[dataEntryPath(OTHER, APP, n, "changes")] = text(`changes ${n}`);
    }
    const list = (at: string) =>
      encodeRecord(appFilesSchema, {
        format: 1,
        machine: OTHER,
        app: APP,
        written_at: at,
        files: Object.entries(data).map(([path, bytes]) => listed(path, bytes)),
      });
    const v1 = list(AT);
    const v2 = list("2026-11-18T00:00:05.000Z");
    const manifest = (files: Uint8Array, revision: number) =>
      signManifest(
        {
          format: 1,
          machine: OTHER,
          revision,
          written_at: AT,
          files: [listed(appFilesPath(OTHER, APP), files)],
        },
        laptop.signing.secretKey,
      );
    assert.deepEqual(
      await env.replica.offerManifest(manifest(v1, 1), "link"),
      ok("accepted"),
    );
    await env.link(OTHER, appFilesPath(OTHER, APP), v1);
    for (const [path, bytes] of Object.entries(data)) {
      await env.link(OTHER, path, bytes);
    }
    const held = env.held();

    // 정리가 명단을 다시 볼 때 다른 길(폰)이 새 앱 목록을 넘긴다.
    const plain = env.roster.signingKey;
    let deliver: Promise<unknown> | null = null;
    let armed = false;
    env.roster.signingKey = (machine) => {
      if (armed && deliver === null) {
        deliver = Promise.resolve().then(() =>
          env.link(OTHER, appFilesPath(OTHER, APP), v2),
        );
      }
      return plain(machine);
    };
    const offered = env.replica.offerManifest(manifest(v2, 2), "phone");
    await Promise.resolve();
    await Promise.resolve();
    armed = true;
    assert.deepEqual(await offered, ok("accepted"));
    assert.ok(deliver !== null, "the new list arrived during the prune");
    assert.deepEqual(await deliver, ok("accepted"));
    env.roster.signingKey = plain;

    const after = env.held();
    for (const path of Object.keys(data)) {
      const key = path.split("/").join(sep);
      assert.equal(after[key], held[key], path);
    }
    assert.deepEqual(await env.replica.wants(100), ok([]));
  });
});

// 다른 컴퓨터의 release.json에 대소문자나 NFC 정규화만 다른 path가 겹치면 받는 자리가 그 release 아래 file을 바라지도 받지도 않는다.
test("받는 자리는 대소문자나 NFC 정규화만 다른 path가 겹치는 release.json의 file 목록을 거절한다", async () => {
  await carryEnv(async (env) => {
    const bundleHash = "a".repeat(64);
    const aBytes = text("A");
    const bBytes = text("a");
    const releasePath = releaseRecordPath(OTHER, APP, bundleHash);
    const rel = encodeRecord(releaseRecordSchema, {
      format: 1,
      machine: OTHER,
      app: APP,
      bundle_hash: bundleHash,
      code_commit: "b".repeat(40),
      declaration_hash: "c".repeat(64),
      data_schema: 1,
      data_changes: [],
      created_at: AT,
      files: [
        {
          path: "A.js",
          size: aBytes.byteLength,
          sha256: createHash("sha256").update(aBytes).digest("hex"),
        },
        {
          path: "a.js",
          size: bBytes.byteLength,
          sha256: createHash("sha256").update(bBytes).digest("hex"),
        },
      ],
    });
    const appFiles = encodeRecord(appFilesSchema, {
      format: 1,
      machine: OTHER,
      app: APP,
      written_at: AT,
      files: [listed(releasePath, rel)],
    });
    const manifest = signManifest(
      {
        format: 1,
        machine: OTHER,
        revision: 1,
        written_at: AT,
        files: [listed(appFilesPath(OTHER, APP), appFiles)],
      },
      laptop.signing.secretKey,
    );
    assert.deepEqual(
      await env.replica.offerManifest(manifest, "link"),
      ok("accepted"),
    );
    assert.deepEqual(
      await env.link(OTHER, appFilesPath(OTHER, APP), appFiles),
      ok("accepted"),
    );
    assert.deepEqual(await env.link(OTHER, releasePath, rel), ok("accepted"));
    // 충돌하는 release.json 아래의 file들은 wanted 목록에도 오르지 않고 receive도 거절한다.
    assert.deepEqual(await env.replica.wants(100), ok([]));
    assert.deepEqual(
      await env.link(
        OTHER,
        releaseFilePath(OTHER, APP, bundleHash, "A.js"),
        aBytes,
      ),
      ok("rejected"),
    );
    assert.deepEqual(
      await env.link(
        OTHER,
        releaseFilePath(OTHER, APP, bundleHash, "a.js"),
        bBytes,
      ),
      ok("rejected"),
    );
  });
});
