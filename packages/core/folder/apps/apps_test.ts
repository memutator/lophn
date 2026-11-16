import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  appBundleCopy,
  appDefaultSource,
} from "../../../protocol/apps/app-storage.ts";
import {
  canonicalJson,
  validateDeclaration,
} from "../../../protocol/apps/declaration/mod.ts";
import { TargetAuthorization } from "../../../protocol/server/target-authorization.ts";
import type {
  CommandDefinition,
  RequestContext,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  appRecordPath,
  appRecordSchema,
  decodeRecord,
  encodeRecord,
  releaseDir,
  releaseRecordSchema,
} from "../../../protocol/folder/mod.ts";
import { sdkSchemaSteps } from "../../apps/packages/schema.ts";
import { permissionsSchemaSteps } from "../../apps/permissions/schema.ts";
import {
  createFolderAppsHost,
  type FolderCommand,
} from "../../apps/folder-host.ts";
import { createAppCommands } from "../../apps/registration/commands.ts";
import { FOLDER_APPS_CONTEXT } from "../../apps/registration/folder-take-in.ts";
import { appsSchemaSteps } from "../../apps/registration/schema.ts";
import { createActivationHandlers } from "../../apps/releases/activation/handler.ts";
import { buildManifest } from "../../apps/releases/bundle/manifest.ts";
import {
  makeTreeWritable,
  sealBundle,
} from "../../apps/releases/bundle/seal.ts";
import { createReleaseCommands } from "../../apps/releases/commands.ts";
import { compareForActivation } from "../../apps/releases/compare.ts";
import { releasesSchemaSteps } from "../../apps/releases/schema.ts";
import {
  loadActiveRelease,
  loadRelease,
  loadStoredDeclaration,
} from "../../apps/releases/store.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import type { DestinationsView } from "../destinations.ts";
import { FOLDER_SCHEMA_STEPS } from "../schema.ts";
import {
  createFolderApps,
  type FolderAppRecordCopy,
  type FolderApps,
  type FolderLocalApp,
} from "./mod.ts";

const A = "mch_01haaaaaaaaaaaaaaaaaaaaaaa" as Id<"mch">;
const B = "mch_01hbbbbbbbbbbbbbbbbbbbbbbb" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const DESTINATION = "shared";

function sqlOf(db: DatabaseSync): Sql {
  return {
    run: (text, params) => db.prepare(text).run(...(params as never[])),
    get: (text, params) =>
      db.prepare(text).get(...(params as never[])) as never,
    all: (text, params) =>
      db.prepare(text).all(...(params as never[])) as never,
  };
}

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
    encoding: "utf8",
  }).trim();
}

const machineCtx: RequestContext = {
  principal: "machine:folder-apps",
  actor: "machine",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "machine:folder-apps",
};
// app.create는 아직 사람 자격만 id를 정한다(보고의 계약 바꾸기 요청). 그때까지 등록만 사람 자격으로 부른다.
const userCtx: RequestContext = {
  ...machineCtx,
  principal: "user",
  actor: "user",
};

// B 기계의 ledger에서 command 하나 = transaction 하나로 실제 handler를 부른다.
function commandPort(db: DatabaseSync, now: () => string): FolderCommand {
  const ids = createIdSource({
    clock: { now, nowMs: () => Date.parse(now()) },
    random: seededRandom(7),
  });
  let seq = 0;
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [afterCommit, { push: () => {} }],
  ]);
  const tx = {
    sql: sqlOf(db),
    newId: (prefix: string) => ids.newId(prefix as never),
    now,
    emit: () => String(++seq),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const apps = createAppCommands();
  const releases = createReleaseCommands();
  const table: Record<string, [CommandDefinition, RequestContext]> = {
    "app.create": [apps.create as never, machineCtx],
    "app.connect_source": [apps.connectSource as never, machineCtx],
    "release.record": [releases.record as never, machineCtx],
  };
  return async (envelope) => {
    const [definition, ctx] = table[envelope.command]!;
    db.exec("BEGIN");
    const done = definition.handle(
      tx,
      ctx,
      definition.route.input.parse(envelope.input),
      envelope.compare as never,
    ) as Result<unknown>;
    db.exec(done.ok ? "COMMIT" : "ROLLBACK");
    return done;
  };
}

type World = {
  base: string;
  dest: string;
  rootA: string;
  rootB: string;
  dbA: DatabaseSync;
  dbB: DatabaseSync;
  repoA: string;
  local: FolderLocalApp;
  folderA: FolderApps;
  folderB: FolderApps;
  clock: ReturnType<typeof manualClock>;
};

function destinations(path: string): DestinationsView {
  return {
    list: () => [{ name: DESTINATION, path, state: "ok" }],
    resolve: (name) => (name === DESTINATION ? { path, state: "ok" } : null),
  };
}

// 다른 기계의 앱 기록 사본(folder-import가 둔다)을 폴더에서 바로 읽는다.
function recordsIn(dest: string, origin: Id<"mch">): FolderAppRecordCopy[] {
  const path = join(dest, appRecordPath(origin, APP));
  if (!existsSync(path)) return [];
  const record = decodeRecord(appRecordSchema, readFileSync(path));
  assert.ok(record.ok);
  return [{ origin, destination: DESTINATION, record: record.value }];
}

async function sealedRelease(root: string, commit: string) {
  // release 준비처럼 검증한 선언의 정규 JSON이다.
  const validated = validateDeclaration({
    name: "Notes",
    description: "Keeps notes.",
    screens: [],
    operations: [],
    commands: [],
    permissions: [],
    app_connections: [],
    sdk_dependencies: [{ name: "@lophn/declaration", version: "4.9.0" }],
  });
  assert.ok(validated.ok);
  const declaration = new TextEncoder().encode(
    canonicalJson(validated.value as never),
  );
  const files = [
    { path: "main.js", bytes: new TextEncoder().encode("export {};\n") },
    { path: "declaration.json", bytes: declaration },
    {
      path: "migrations/0-1.sql",
      bytes: new TextEncoder().encode(
        "CREATE TABLE notes (id INTEGER PRIMARY KEY);\n",
      ),
    },
  ];
  const manifest = buildManifest({
    entrypoint: "main.js",
    files: await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        hash: await sha256Hex(file.bytes),
      })),
    ),
    dependencies: [
      { name: "@lophn/declaration", version: "4.9.0", source: "sdk" },
    ],
  });
  assert.ok(manifest.ok);
  const hash = await sha256Hex(JSON.stringify(manifest.value));
  const sealed = await sealBundle({
    copyPath: appBundleCopy(root, APP, hash),
    manifest: manifest.value,
    declarationJson: declaration,
    bundleFiles: files.filter((file) => file.path !== "declaration.json"),
  });
  assert.ok(sealed.ok);
  return {
    id: "rel_01hzzzzzzzzzzzzzzzzzzzzz01" as Id<"rel">,
    bundle_hash: hash,
    code_commit: commit,
    data_schema: 1,
    data_changes: [],
    created_at: "2026-11-01T00:00:00.000Z",
  };
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-apps-"));
  const dest = join(base, "dest");
  const rootA = join(base, "a");
  const rootB = join(base, "b");
  for (const dir of [dest, rootA, rootB]) mkdirSync(dir);
  // B의 lophn이 가진 SDK 판.
  mkdirSync(join(rootB, "sdk", "declaration", "4.9.0"), { recursive: true });
  const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
  const dbA = new DatabaseSync(":memory:");
  for (const step of FOLDER_SCHEMA_STEPS) dbA.exec(step.sql);
  const dbB = new DatabaseSync(":memory:");
  for (const step of [
    ...appsSchemaSteps,
    ...releasesSchemaSteps,
    ...permissionsSchemaSteps,
    ...sdkSchemaSteps,
    ...FOLDER_SCHEMA_STEPS,
  ]) {
    dbB.exec(step.sql);
  }
  const repoA = join(rootA, "apps", APP, "source");
  mkdirSync(repoA, { recursive: true });
  git(repoA, "init", "-q", "-b", "main");
  writeFileSync(join(repoA, "main.ts"), "export const v = 1;\n");
  git(repoA, "add", "-A");
  git(repoA, "commit", "-q", "-m", "first");
  const local: FolderLocalApp = {
    app: APP,
    slug: "notes",
    name: "Notes",
    description: "Keeps notes.",
    sync_to: DESTINATION,
    source_path: repoA,
    release: await sealedRelease(rootA, git(repoA, "rev-parse", "HEAD")),
  };
  const progress = () => ({ read: {}, settled: null, horizon: null });
  const folderA = createFolderApps({
    machine: () => A,
    destinations: destinations(dest),
    apps: () => [local],
    records: () => recordsIn(dest, B),
    progress,
    host: createFolderAppsHost({
      sql: sqlOf(dbA),
      dataRoot: rootA,
      command: () => {
        throw new Error("A takes nothing in");
      },
      random: seededRandom(3),
    }),
    sql: sqlOf(dbA),
    clock,
    random: seededRandom(1),
    dataRoot: rootA,
  });
  const folderB = createFolderApps({
    machine: () => B,
    destinations: destinations(dest),
    apps: () => [],
    records: () => recordsIn(dest, A),
    progress,
    host: createFolderAppsHost({
      sql: sqlOf(dbB),
      dataRoot: rootB,
      command: commandPort(dbB, () => clock.now()),
      random: seededRandom(4),
    }),
    sql: sqlOf(dbB),
    clock,
    random: seededRandom(2),
    dataRoot: rootB,
  });
  return {
    base,
    dest,
    rootA,
    rootB,
    dbA,
    dbB,
    repoA,
    local,
    folderA,
    folderB,
    clock,
  };
}

async function withWorld(run: (w: World) => Promise<void>) {
  const w = await world();
  try {
    await run(w);
  } finally {
    w.dbA.close();
    w.dbB.close();
    // 봉인 사본은 읽기 전용이다.
    await makeTreeWritable(w.base);
    await rm(w.base, { recursive: true, force: true });
  }
}

const rows = (db: DatabaseSync, sql: string) =>
  db
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }));

// 동의와 grant는 그 기계의 사람이 준다. 다른 기계에서 켜졌다고 이 기계에서 묻지 않고 켜면 사람이 허락하지 않은 권한이 돈다.
test("take-in은 동의도 grant도 옮기지 않는다", async () => {
  await withWorld(async (w) => {
    assert.ok((await w.folderA.runApp(APP)).ok);
    const taken = await w.folderB.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    assert.equal(taken.value.installed, "app_and_release");
    const sql = sqlOf(w.dbB);
    const release = loadRelease(sql, taken.value.release);
    assert.ok(release.ok && release.value !== null);
    assert.equal(release.value.status, "prepared");
    assert.equal(release.value.bundle_hash, w.local.release!.bundle_hash);
    assert.deepStrictEqual(rows(w.dbB, "SELECT * FROM grants"), []);
    assert.deepStrictEqual(
      rows(w.dbB, "SELECT * FROM activation_consents"),
      [],
    );
    assert.deepStrictEqual(
      rows(w.dbB, "SELECT active_release, run_enabled FROM apps"),
      [{ active_release: null, run_enabled: 0 }],
    );

    // release.activate의 판정(driver와 같은 비교): 이 기계의 grant와 활성 release로 견주면 사람의 동의를 기다린다.
    const asked: string[] = [];
    const handlers = createActivationHandlers({
      releases: {
        get: (id) => loadRelease(sql, id),
        async comparison(target) {
          const stored = loadStoredDeclaration(sql, target.id);
          const active = loadActiveRelease(sql, target.app);
          assert.ok(stored.ok && stored.value !== null && active.ok);
          return ok(
            compareForActivation({
              previous: active.value,
              grants: [],
              facts: stored.value.facts,
              next: { data_changes: target.data_changes },
            }),
          );
        },
      },
      consents: {
        async ask(target) {
          asked.push(target.id);
          return ok(undefined);
        },
      },
      enqueue: () => {
        throw new Error("started without consent");
      },
    });
    const judged = await handlers.activate(release.value);
    assert.ok(judged.ok);
    assert.equal(judged.value, "waiting_consent");
    assert.deepStrictEqual(asked, [taken.value.release]);
  });
});

// 따라가기(machine-update)가 같은 함수를 부른다. 두 번 부르거나 사람이 이 기계에서 고친 앱에 부르면 앱 행을 덮거나 release가 늘면 안 된다.
test("take-in을 두 번 부르거나 이미 들인 앱에 부르면 앱 행은 그대로이고 release는 하나다", async () => {
  await withWorld(async (w) => {
    assert.ok((await w.folderA.runApp(APP)).ok);
    // 이 기계에 이미 있는 같은 id의 앱(사람이 이름을 바꿨고 source가 없다).
    const port = commandPort(w.dbB, () => w.clock.now());
    assert.ok(
      (
        await port({
          command: "app.create",
          input: {
            id: APP,
            slug: "notes",
            name: "My notes",
            description: "Mine.",
          },
          idempotency_key: "k-create",
          compare: {},
        })
      ).ok,
    );
    const before = rows(w.dbB, "SELECT * FROM apps");
    const first = await w.folderB.takeIn({ app: APP });
    assert.ok(first.ok, first.ok ? "" : first.error.message);
    assert.equal(first.value.installed, "release");
    const second = await w.folderB.takeIn({ app: APP, from: A });
    assert.ok(second.ok);
    assert.equal(second.value.installed, "existing");
    assert.equal(second.value.release, first.value.release);
    assert.deepStrictEqual(rows(w.dbB, "SELECT * FROM apps"), before);
    assert.deepStrictEqual(rows(w.dbB, "SELECT id, status FROM releases"), [
      { id: first.value.release, status: "prepared" },
    ]);
    assert.equal(existsSync(appDefaultSource(w.rootB, APP)), false);
  });
});

// 폴더는 바깥 도구가 옮겨 덜 온 file이 흔하다. 덜 온 release를 들이면 봉인 사본과 release가 틀린 code를 가리킨다.
test("완전하지 않은 release는 아무것도 등록하지 않는다", async () => {
  await withWorld(async (w) => {
    assert.ok((await w.folderA.runApp(APP)).ok);
    const hash = w.local.release!.bundle_hash;
    const dir = join(w.dest, releaseDir(A, APP, hash));
    const template = join(w.base, "template");
    cpSync(w.dest, template, { recursive: true });
    const listing = () => {
      const record = decodeRecord(
        releaseRecordSchema,
        readFileSync(join(dir, "release.json")),
      );
      assert.ok(record.ok);
      return record.value;
    };
    const cases: [string, () => Promise<void> | void][] = [
      ["no release.json", () => rmSync(join(dir, "release.json"))],
      ["a file is missing", () => rmSync(join(dir, "files", "main.js"))],
      [
        "a file differs by one byte",
        () => {
          const path = join(dir, "files", "main.js");
          const bytes = readFileSync(path);
          bytes[0] = bytes[0]! ^ 1;
          writeFileSync(path, bytes);
        },
      ],
      [
        "the manifest hash differs from the folder name",
        async () => {
          // 목록은 맞게 고쳐서 file 검사는 지나고 manifest hash만 어긋난다.
          const path = join(dir, "files", "manifest.json");
          const bytes = Buffer.concat([readFileSync(path), Buffer.from(" ")]);
          writeFileSync(path, bytes);
          const record = listing();
          const files = record.files.map((file) =>
            file.path === "manifest.json"
              ? { ...file, size: bytes.byteLength, sha256: "" }
              : file,
          );
          files.find((file) => file.path === "manifest.json")!.sha256 =
            await sha256Hex(bytes);
          writeFileSync(
            join(dir, "release.json"),
            encodeRecord(releaseRecordSchema, { ...record, files }),
          );
        },
      ],
    ];
    for (const [name, corrupt] of cases) {
      rmSync(w.dest, { recursive: true });
      cpSync(template, w.dest, { recursive: true });
      await corrupt();
      const taken = await w.folderB.takeIn({ app: APP });
      assert.ok(!taken.ok, name);
      assert.equal(taken.error.details?.reason, "release_incomplete", name);
      assert.deepStrictEqual(rows(w.dbB, "SELECT id FROM apps"), [], name);
      assert.deepStrictEqual(rows(w.dbB, "SELECT id FROM releases"), [], name);
      assert.equal(existsSync(join(w.rootB, "apps", APP)), false, name);
    }
  });
});

// 다른 기계의 commit을 받다가 이 기계에서 사람이 쓰던 branch나 아직 commit하지 않은 수정이 바뀌면 사람의 code를 잃는다.
test("source 받기는 사람의 code를 덮지 않는다", async () => {
  await withWorld(async (w) => {
    assert.ok((await w.folderA.runApp(APP)).ok);
    const taken = await w.folderB.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    const repoB = taken.value.source_path;
    assert.equal(repoB, appDefaultSource(w.rootB, APP));
    assert.ok(repoB !== null);
    assert.equal(git(repoB, "rev-parse", "main"), w.local.release!.code_commit);

    // B의 사람: 다른 branch의 commit과 commit하지 않은 수정.
    git(repoB, "checkout", "-q", "-b", "mine");
    writeFileSync(join(repoB, "mine.ts"), "export const mine = 1;\n");
    git(repoB, "add", "mine.ts");
    git(
      repoB,
      "-c",
      "user.name=p",
      "-c",
      "user.email=p@p",
      "commit",
      "-q",
      "-m",
      "mine",
    );
    writeFileSync(
      join(repoB, "main.ts"),
      "export const v = 'not committed';\n",
    );
    const state = () => ({
      head: git(repoB, "symbolic-ref", "HEAD"),
      heads: git(
        repoB,
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/heads/",
      ),
      status: git(repoB, "status", "--porcelain"),
      main: readFileSync(join(repoB, "main.ts"), "utf8"),
      mine: readFileSync(join(repoB, "mine.ts"), "utf8"),
    });
    const before = state();

    // A의 새 commit은 앞서 낸 것을 뺀 증분 bundle로 나간다.
    writeFileSync(join(w.repoA, "main.ts"), "export const v = 2;\n");
    git(w.repoA, "commit", "-q", "-am", "second");
    const second = git(w.repoA, "rev-parse", "HEAD");
    w.clock.advance(1000);
    assert.ok((await w.folderA.runApp(APP)).ok);
    const imported = await w.folderB.importSource(APP);
    assert.ok(imported.ok, imported.ok ? "" : imported.error.message);

    assert.deepStrictEqual(state(), before);
    assert.equal(git(repoB, "rev-parse", `refs/remotes/${A}/main`), second);
    assert.equal(
      git(repoB, "for-each-ref", "--format=%(refname)", "refs/remotes/"),
      `refs/remotes/${A}/main`,
    );
  });
});
