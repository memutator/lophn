import assert from "node:assert/strict";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { seededRandom } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { dataEntryPath } from "../../protocol/folder/mod.ts";
import type { SyncLog } from "../apps/sync/log.ts";
import { SYNC_LOG_SCHEMA_STEPS } from "../apps/sync/schema.ts";
import { createFileSettingsReader } from "../config/reader.ts";
import { createSettingsRegistry } from "../config/registry.ts";
import { settingsUpdateHandler } from "../config/routes.ts";
import { createSettingsStore } from "../config/store.ts";
import { createDestinations, destinationsSetting } from "./destinations.ts";
import { createFolderReader, createFolderWriter } from "./fs.ts";
import type { FolderLog } from "./ports.ts";
import { FOLDER_SCHEMA_STEPS } from "./schema.ts";

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
        { name: "personal", path: sync, state: "missing" },
      ]);
    });
  });
});

// destination을 두면 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 간다. 사람의 승인 없이는 안 된다.
test("agent 자격은 destination을 두지도 지우지도 못하고 설정 file이 그대로다", async () => {
  await withTemp(async (dataRoot) => {
    const original = `${JSON.stringify({ "folder.destinations": { personal: { path: "/srv/sync" } } }, null, 2)}\n`;
    writeFileSync(join(dataRoot, "settings.json"), original);
    await withSettings(dataRoot, async (store, file) => {
      const update = settingsUpdateHandler(store);
      for (const change of [
        {
          key: "folder.destinations",
          action: "set",
          value: { personal: { path: "/srv/other" } },
        },
        { key: "folder.destinations", action: "unset" },
      ]) {
        const result = await update({ actor: "agent:agt_1" } as never, {
          changes: [change],
        });
        assert.deepStrictEqual(result, {
          ok: true,
          value: {
            changed: [],
            rejected: [{ key: "folder.destinations", reason: "locked" }],
            notes: [],
          },
        });
        assert.equal(readFileSync(file, "utf8"), original);
      }
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
