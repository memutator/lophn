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
  err,
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
import type { Id } from "../../../protocol/base/ids.ts";
import {
  appRecordPath,
  appRecordSchema,
  decodeRecord,
  packageFilePath,
  sourcePath,
} from "../../../protocol/folder/mod.ts";
import {
  COMPUTERS_DESTINATION,
  COMPUTERS_DIR,
  signManifest,
} from "../../../protocol/remote/carry.ts";
import { remoteKeyText } from "../../../protocol/remote/noise.ts";
import { generateSigningKey } from "../../../protocol/remote/roster.ts";
import type {
  CommandDefinition,
  RequestContext,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import { TargetAuthorization } from "../../../protocol/server/target-authorization.ts";
import type { PrepareCommitResult } from "../../apps/control.ts";
import {
  createFolderAppsHost,
  type FolderCommand,
} from "../../apps/folder-host.ts";
import { createSdkCommands } from "../../apps/packages/commands.ts";
import {
  bundleBytes,
  type PrepareBlob,
  prepareBundleBlobs,
} from "../../apps/packages/install.ts";
import { sdkSchemaSteps } from "../../apps/packages/schema.ts";
import { loadPackage } from "../../apps/packages/store.ts";
import { permissionsSchemaSteps } from "../../apps/permissions/schema.ts";
import { createAppCommands } from "../../apps/registration/commands.ts";
import { appsSchemaSteps } from "../../apps/registration/schema.ts";
import { createActivationHandlers } from "../../apps/releases/activation/handler.ts";
import { buildManifest } from "../../apps/releases/bundle/manifest.ts";
import {
  makeTreeWritable,
  sealBundle,
} from "../../apps/releases/bundle/seal.ts";
import { createReleaseCommands } from "../../apps/releases/commands.ts";
import { syncPlanOf } from "../../../protocol/apps/declaration/sync-plan.ts";
import { sdkMissingMessage } from "./sdk-missing.ts";
import { compareForActivation } from "../../apps/releases/compare.ts";
import { releasesSchemaSteps } from "../../apps/releases/schema.ts";
import {
  loadActiveRelease,
  loadRelease,
  loadStoredDeclaration,
} from "../../apps/releases/store.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import type { DestinationsView } from "../destinations.ts";
import { publishManifest } from "../export/manifest.ts";
import { createReplica } from "../replica.ts";
import {
  FOLDER_CARRY_MARKS_STEPS,
  FOLDER_CODE_COMMIT_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "../schema.ts";
import {
  createFolderApps,
  type FolderAppRecordCopy,
  type FolderApps,
  type FolderLocalApp,
} from "./mod.ts";

const A = "mch_01haaaaaaaaaaaaaaaaaaaaaaa" as Id<"mch">;
const B = "mch_01hbbbbbbbbbbbbbbbbbbbbbbb" as Id<"mch">;
const C = "mch_01hccccccccccccccccccccccc" as Id<"mch">;
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

function createMemoryBlobs() {
  const store = new Map<string, Uint8Array>();
  const prepareBlob: PrepareBlob = async ({ bytes }) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of bytes) chunks.push(chunk);
    const all = new Uint8Array(Buffer.concat(chunks));
    const hash = await sha256Hex(all);
    store.set(hash, all);
    return ok({ hash, size_bytes: all.byteLength });
  };
  const readBlob = async (hash: string): Promise<Result<Uint8Array>> => {
    const found = store.get(hash);
    return found === undefined
      ? err({ code: "not_found", message: `blob ${hash} not found` })
      : ok(found);
  };
  return { store, prepareBlob, readBlob };
}

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
    registerBlobRef: () => ok(undefined),
  } as unknown as Tx;
  const apps = createAppCommands();
  const releases = createReleaseCommands();
  const sdk = createSdkCommands();
  const table: Record<string, [CommandDefinition, RequestContext]> = {
    "app.create": [apps.create as never, machineCtx],
    "app.connect_source": [apps.connectSource as never, machineCtx],
    "release.record": [releases.record as never, machineCtx],
    "package.register_version": [sdk.registerVersion as never, machineCtx],
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

function destinations(path: string): DestinationsView {
  return {
    list: () => [{ name: DESTINATION, path, state: "ok" }],
    resolve: (name) => (name === DESTINATION ? { path, state: "ok" } : null),
  };
}

function recordsIn(
  dest: string,
  origins: readonly Id<"mch">[],
): FolderAppRecordCopy[] {
  const out: FolderAppRecordCopy[] = [];
  for (const origin of origins) {
    const path = join(dest, appRecordPath(origin, APP));
    if (!existsSync(path)) continue;
    const record = decodeRecord(appRecordSchema, readFileSync(path));
    assert.ok(record.ok);
    out.push({ origin, destination: DESTINATION, record: record.value });
  }
  return out;
}

// 이 기계에서 commit을 build·봉인·기록하는 prepareCommit 모사(외부 npm·supervisor 없이 git commit과 release.record를 쓴다).
function makeLocalPrepare(
  root: string,
  command: FolderCommand,
  prepared: { app: string; sourcePath: string; commit: string }[],
  // 선언에 더할 칸. 선언 값 추출 자식처럼 봉인한 선언으로 읽는다(옛 칸을 거절하는 것은 release.record다).
  extra: () => Record<string, unknown> = () => ({}),
) {
  let seq = 0;
  return async (input: {
    app: string;
    sourcePath: string;
    commit: string;
    createdBy: string;
  }): Promise<Result<PrepareCommitResult>> => {
    // commit이 실제 source 저장소에 있어야 한다.
    assert.equal(
      git(
        input.sourcePath,
        "rev-parse",
        "--verify",
        `${input.commit}^{commit}`,
      ),
      input.commit,
    );
    prepared.push({
      app: input.app,
      sourcePath: input.sourcePath,
      commit: input.commit,
    });
    const validated = validateDeclaration(
      {
        name: "Notes",
        description: "Keeps notes.",
        screens: [],
        operations: [],
        commands: [],
        permissions: [],
        app_connections: [],
        sdk_dependencies: [{ name: "@lophn/declaration", version: "4.9.0" }],
        ...extra(),
      },
      { sealed: true },
    );
    assert.ok(validated.ok);
    const declarationJson = canonicalJson(validated.value as never);
    const declaration = new TextEncoder().encode(declarationJson);
    const files = [
      {
        path: "main.js",
        bytes: new TextEncoder().encode(
          `export const commit = "${input.commit}";\n`,
        ),
      },
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
    const bundleHash = await sha256Hex(JSON.stringify(manifest.value));
    const sealed = await sealBundle({
      copyPath: appBundleCopy(root, input.app, bundleHash),
      manifest: manifest.value,
      declarationJson: declaration,
      bundleFiles: files.filter((file) => file.path !== "declaration.json"),
    });
    assert.ok(sealed.ok);
    const key = `prepare-${++seq}`;
    const recorded = await command({
      command: "release.record",
      input: {
        app: input.app,
        commit: input.commit,
        bundle_hash: bundleHash,
        declaration_hash: await sha256Hex(declaration),
        declaration: validated.value,
        manifest: manifest.value,
        data_schema: 1,
        data_changes: [],
        created_by: input.createdBy,
        key,
      },
      idempotency_key: key,
      compare: {},
    });
    if (!recorded.ok) return recorded;
    const { release, removed_public_tools, removed_public_skills } =
      recorded.value as {
        release: {
          id: Id<"rel">;
          number: number;
          status: "prepared";
          code_commit: string;
          bundle_hash: string;
          data_schema: number;
        };
        removed_public_tools: { tool: string }[];
        removed_public_skills: { skill: string }[];
      };
    return ok({
      status: "prepared",
      release,
      removed_public_tools,
      removed_public_skills,
    });
  };
}

type World = {
  base: string;
  dest: string;
  rootA: string;
  rootB: string;
  dbA: DatabaseSync;
  dbB: DatabaseSync;
  blobsA: ReturnType<typeof createMemoryBlobs>;
  blobsB: ReturnType<typeof createMemoryBlobs>;
  cmdA: FolderCommand;
  cmdB: FolderCommand;
  repoA: string;
  local: FolderLocalApp;
  folderA: FolderApps;
  folderB: FolderApps;
  preparedB: { app: string; sourcePath: string; commit: string }[];
  // B가 준비하는 release의 선언에 더할 칸.
  extraB: Record<string, unknown>;
  clock: ReturnType<typeof manualClock>;
};

function openLedger(full: boolean): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const steps = full
    ? [
        ...appsSchemaSteps,
        ...releasesSchemaSteps,
        ...permissionsSchemaSteps,
        ...sdkSchemaSteps,
        ...FOLDER_SCHEMA_STEPS,
        ...FOLDER_CARRY_MARKS_STEPS,
        ...FOLDER_CODE_COMMIT_STEPS,
      ]
    : [
        ...sdkSchemaSteps,
        ...FOLDER_SCHEMA_STEPS,
        ...FOLDER_CARRY_MARKS_STEPS,
        ...FOLDER_CODE_COMMIT_STEPS,
      ];
  for (const step of steps) db.exec(step.sql);
  return db;
}

async function world(): Promise<World> {
  const base = await mkdtemp(join(tmpdir(), "lophn-folder-apps-"));
  const dest = join(base, "dest");
  const rootA = join(base, "a");
  const rootB = join(base, "b");
  for (const dir of [dest, rootA, rootB]) mkdirSync(dir);
  const sdkDirB = join(rootB, "sdk", "declaration", "4.9.0");
  mkdirSync(sdkDirB, { recursive: true });
  writeFileSync(
    join(sdkDirB, "package.json"),
    JSON.stringify({ name: "@lophn/declaration", version: "4.9.0" }),
  );
  const clock = manualClock(Date.parse("2026-11-16T00:00:00.000Z"));
  const dbA = openLedger(false);
  const dbB = openLedger(true);

  const repoA = join(rootA, "apps", APP, "source");
  mkdirSync(repoA, { recursive: true });
  git(repoA, "init", "-q", "-b", "main");
  writeFileSync(
    join(repoA, "package.json"),
    JSON.stringify({
      name: "notes",
      dependencies: {
        "@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
      },
    }),
  );
  writeFileSync(join(repoA, "main.ts"), "export const v = 1;\n");
  git(repoA, "add", "-A");
  git(repoA, "commit", "-q", "-m", "first");
  const firstCommit = git(repoA, "rev-parse", "HEAD");

  const local: FolderLocalApp = {
    app: APP,
    slug: "notes",
    name: "Notes",
    description: "Keeps notes.",
    destination: DESTINATION,
    source_path: repoA,
    release: {
      id: "rel_01hzzzzzzzzzzzzzzzzzzzzz01" as Id<"rel">,
      code_commit: firstCommit,
      data_schema: 1,
      created_at: "2026-11-01T00:00:00.000Z",
    },
  };
  const progress = () => ({ read: {}, settled: null, horizon: null });
  const blobsA = createMemoryBlobs();
  const cmdA = commandPort(dbA, () => clock.now());
  const folderA = createFolderApps({
    machine: () => A,
    destinations: destinations(dest),
    apps: () => [local],
    records: () => recordsIn(dest, [B]),
    progress,
    host: createFolderAppsHost({
      sql: sqlOf(dbA),
      command: cmdA,
      prepareCommit: () => {
        throw new Error("A takes nothing in");
      },
      random: seededRandom(3),
      dataRoot: rootA,
      readBlob: blobsA.readBlob,
      prepareBlob: blobsA.prepareBlob,
      registerVersion: (input) =>
        cmdA({
          command: "package.register_version",
          input,
          idempotency_key: `pkg-a-${input.name}-${input.version}`,
          compare: {},
        }),
    }),
    sql: sqlOf(dbA),
    clock,
    random: seededRandom(1),
    dataRoot: rootA,
  });
  const preparedB: { app: string; sourcePath: string; commit: string }[] = [];
  const extraB: Record<string, unknown> = {};
  const blobsB = createMemoryBlobs();
  const cmdB = commandPort(dbB, () => clock.now());
  const folderB = createFolderApps({
    machine: () => B,
    destinations: destinations(dest),
    apps: () => [],
    records: () => recordsIn(dest, [A]),
    progress,
    host: createFolderAppsHost({
      sql: sqlOf(dbB),
      command: cmdB,
      prepareCommit: makeLocalPrepare(rootB, cmdB, preparedB, () => extraB),
      random: seededRandom(4),
      dataRoot: rootB,
      readBlob: blobsB.readBlob,
      prepareBlob: blobsB.prepareBlob,
      registerVersion: (input) =>
        cmdB({
          command: "package.register_version",
          input,
          idempotency_key: `pkg-b-${input.name}-${input.version}`,
          compare: {},
        }),
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
    blobsA,
    blobsB,
    cmdA,
    cmdB,
    repoA,
    local,
    folderA,
    folderB,
    preparedB,
    extraB,
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
test("take-in은 동의도 grant도 옮기지 않고, source bundle로 이 기계에서 release를 준비한다", async () => {
  await withWorld(async (w) => {
    assert.ok((await w.folderA.runApp(APP)).ok);
    // build된 releases/ 폴더는 내보내지 않고 source bundle만 내보낸다.
    assert.equal(
      existsSync(join(w.dest, "machines", A, "apps", APP, "releases")),
      false,
    );
    assert.equal(
      existsSync(join(w.dest, sourcePath(A, APP, 1, "bundle"))),
      true,
    );

    const taken = await w.folderB.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    assert.equal(taken.value.installed, "app_and_release");
    assert.equal(taken.value.source_path, appDefaultSource(w.rootB, APP));
    assert.deepStrictEqual(w.preparedB, [
      {
        app: APP,
        sourcePath: appDefaultSource(w.rootB, APP),
        commit: w.local.release!.code_commit,
      },
    ]);

    const sql = sqlOf(w.dbB);
    const release = loadRelease(sql, taken.value.release);
    assert.ok(release.ok && release.value !== null);
    assert.equal(release.value.status, "prepared");
    assert.equal(release.value.code_commit, w.local.release!.code_commit);
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

// 지우면 옛 release(`sync_to`로 봉인)를 켜 둔 앱을 새 컴퓨터나 다시 깐 컴퓨터가 들이지도 따라가지도 못하고, 앱 agent가 다시
// release할 때까지 그 컴퓨터에 사람의 앱과 data가 오지 않는다. 이 컴퓨터에서 새로 쓰는 release만 그 칸을 거절한다.
test("다른 컴퓨터의 옛 release가 sync_to로 봉인되었어도 take-in이 준비해 모든 표를 그 destination으로 읽고, 이 컴퓨터에서 쓰는 release는 sync_to를 거절한다", async () => {
  await withWorld(async (w) => {
    w.extraB.sync_to = DESTINATION;
    assert.ok((await w.folderA.runApp(APP)).ok);
    const taken = await w.folderB.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    const stored = loadStoredDeclaration(sqlOf(w.dbB), taken.value.release);
    assert.ok(stored.ok && stored.value !== null);
    const plan = syncPlanOf(stored.value.declaration);
    assert.deepStrictEqual(
      { destination: plan.destination, tables: plan.tables },
      { destination: DESTINATION, tables: null },
    );

    // 같은 선언을 사람이나 agent가 이 컴퓨터에서 새 commit의 release로 쓰면 거절된다.
    const source = taken.value.source_path!;
    git(
      source,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "here",
    );
    const here = git(source, "rev-parse", "HEAD");
    const authored = await makeLocalPrepare(
      w.rootB,
      w.cmdB,
      [],
      () => w.extraB,
    )({
      app: APP,
      sourcePath: source,
      commit: here,
      createdBy: "user",
    });
    assert.ok(!authored.ok);
    assert.equal(authored.error.code, "invalid_input");
    assert.match(authored.error.message, /sync_to was replaced by sync/);
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
    const first = await w.folderB.takeIn({ app: APP });
    assert.ok(first.ok, first.ok ? "" : first.error.message);
    assert.equal(first.value.installed, "release");
    assert.equal(first.value.source_path, appDefaultSource(w.rootB, APP));
    const afterFirst = rows(w.dbB, "SELECT * FROM apps");
    assert.equal(afterFirst[0]?.name, "My notes");
    assert.equal(afterFirst[0]?.description, "Mine.");

    const second = await w.folderB.takeIn({ app: APP, from: A });
    assert.ok(second.ok);
    assert.equal(second.value.installed, "existing");
    assert.equal(second.value.release, first.value.release);
    assert.deepStrictEqual(rows(w.dbB, "SELECT * FROM apps"), afterFirst);
    assert.deepStrictEqual(rows(w.dbB, "SELECT id, status FROM releases"), [
      { id: first.value.release, status: "prepared" },
    ]);
    assert.equal(w.preparedB.length, 1);
  });
});

// 폴더는 바깥 도구가 옮겨 덜 온 file이 흔하다. source bundle이 덜 왔거나 SDK·의존 package가 빠졌으면 앱이나 저장소를 남기지 않는다.
test("완전하지 않은 source나 빠진 SDK·의존 package는 아무것도 등록하지 않는다", async () => {
  await withWorld(async (w) => {
    assert.ok((await w.folderA.runApp(APP)).ok);
    const template = join(w.base, "template");
    cpSync(w.dest, template, { recursive: true });
    const cases: [string, () => void][] = [
      [
        "no source record",
        () => rmSync(join(w.dest, sourcePath(A, APP, 1, "json"))),
      ],
      [
        "no source bundle",
        () => rmSync(join(w.dest, sourcePath(A, APP, 1, "bundle"))),
      ],
      [
        "corrupted bundle bytes",
        () => {
          const path = join(w.dest, sourcePath(A, APP, 1, "bundle"));
          const bytes = readFileSync(path);
          bytes[bytes.byteLength - 1] = bytes[bytes.byteLength - 1]! ^ 1;
          writeFileSync(path, bytes);
        },
      ],
    ];
    for (const [name, corrupt] of cases) {
      rmSync(w.dest, { recursive: true });
      cpSync(template, w.dest, { recursive: true });
      corrupt();
      const taken = await w.folderB.takeIn({ app: APP });
      assert.ok(!taken.ok, name);
      assert.equal(taken.error.code, "invalid_input", name);
      assert.equal(taken.error.details?.reason, "source_incomplete", name);
      assert.deepStrictEqual(rows(w.dbB, "SELECT id FROM apps"), [], name);
      assert.deepStrictEqual(rows(w.dbB, "SELECT id FROM releases"), [], name);
      assert.equal(existsSync(join(w.rootB, "apps", APP)), false, name);
    }
  });

  // 빠진 @lophn/* SDK와 @me/* package는 저장소를 만들기 전에 conflict로 막힌다.
  for (const [dep, wantReason] of [
    [
      { "@lophn/declaration": "file:.lophn/sdk/declaration/9.9.9" },
      "sdk_missing",
    ],
    [
      { "@me/shared": "file:.lophn/sdk/@me/shared/1.0.0" },
      "dependency_missing",
    ],
  ] as const) {
    await withWorld(async (w) => {
      writeFileSync(
        join(w.repoA, "package.json"),
        JSON.stringify({ name: "notes", dependencies: dep }),
      );
      git(w.repoA, "commit", "-q", "-am", `need ${wantReason}`);
      w.local.release = {
        ...w.local.release!,
        code_commit: git(w.repoA, "rev-parse", "HEAD"),
      };
      assert.ok((await w.folderA.runApp(APP)).ok);
      const taken = await w.folderB.takeIn({ app: APP });
      assert.ok(!taken.ok, wantReason);
      assert.equal(taken.error.code, "conflict", wantReason);
      assert.equal(taken.error.details?.reason, wantReason, wantReason);
      assert.deepStrictEqual(
        rows(w.dbB, "SELECT id FROM apps"),
        [],
        wantReason,
      );
      assert.equal(existsSync(join(w.rootB, "apps", APP)), false, wantReason);
    });
  }
});

// 다른 기계의 commit을 받다가 이 기계에서 사람이 쓰던 branch나 아직 commit하지 않은 수정이 바뀌면 사람의 code를 잃는다.
// 또 A의 commit 위에 B가 commit해 증분 bundle을 냈을 때 C가 B의 release를 바로 들일 수 있어야 한다.
test("source 받기는 사람의 code를 덮지 않고, 여러 기계를 거친 증분 source bundle(A → B → C)도 따라간다", async () => {
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
    git(repoB, "commit", "-q", "-m", "mine");
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

    // 이제 B가 자기 commit을 폴더로 내보내고(A의 commit을 prerequisite으로 하는 증분 bundle), 새 기계 C가 B에서 바로 들인다.
    const commitOnB = git(repoB, "rev-parse", "mine");
    const localB: FolderLocalApp = {
      app: APP,
      slug: "notes",
      name: "Notes",
      description: "Keeps notes.",
      destination: DESTINATION,
      source_path: repoB,
      release: {
        id: "rel_01hzzzzzzzzzzzzzzzzzzzzz02" as Id<"rel">,
        code_commit: commitOnB,
        data_schema: 1,
        created_at: "2026-11-16T00:01:00.000Z",
      },
    };
    const folderBExport = createFolderApps({
      machine: () => B,
      destinations: destinations(w.dest),
      apps: () => [localB],
      records: () => recordsIn(w.dest, [A]),
      progress: () => ({ read: {}, settled: null, horizon: null }),
      host: createFolderAppsHost({
        sql: sqlOf(w.dbB),
        command: w.cmdB,
        prepareCommit: () => {
          throw new Error("unused");
        },
        random: seededRandom(5),
        dataRoot: w.rootB,
        readBlob: w.blobsB.readBlob,
        prepareBlob: w.blobsB.prepareBlob,
        registerVersion: (input) =>
          w.cmdB({
            command: "package.register_version",
            input,
            idempotency_key: `pkg-b-exp-${input.name}-${input.version}`,
            compare: {},
          }),
      }),
      sql: sqlOf(w.dbB),
      clock: w.clock,
      random: seededRandom(6),
      dataRoot: w.rootB,
    });
    assert.ok((await folderBExport.runApp(APP)).ok);

    const rootC = join(w.base, "c");
    const sdkDirC = join(rootC, "sdk", "declaration", "4.9.0");
    mkdirSync(sdkDirC, { recursive: true });
    writeFileSync(
      join(sdkDirC, "package.json"),
      JSON.stringify({ name: "@lophn/declaration", version: "4.9.0" }),
    );
    const dbC = openLedger(true);
    try {
      const preparedC: { app: string; sourcePath: string; commit: string }[] =
        [];
      const cmdC = commandPort(dbC, () => w.clock.now());
      const blobsC = createMemoryBlobs();
      const folderC = createFolderApps({
        machine: () => C,
        destinations: destinations(w.dest),
        apps: () => [],
        records: () => recordsIn(w.dest, [A, B]),
        progress: () => ({ read: {}, settled: null, horizon: null }),
        host: createFolderAppsHost({
          sql: sqlOf(dbC),
          command: cmdC,
          prepareCommit: makeLocalPrepare(rootC, cmdC, preparedC),
          random: seededRandom(8),
          dataRoot: rootC,
          readBlob: blobsC.readBlob,
          prepareBlob: blobsC.prepareBlob,
          registerVersion: (input) =>
            cmdC({
              command: "package.register_version",
              input,
              idempotency_key: `pkg-c-${input.name}-${input.version}`,
              compare: {},
            }),
        }),
        sql: sqlOf(dbC),
        clock: w.clock,
        random: seededRandom(9),
        dataRoot: rootC,
      });
      const takenC = await folderC.takeIn({ app: APP, from: B });
      assert.ok(takenC.ok, takenC.ok ? "" : takenC.error.message);
      assert.equal(takenC.value.installed, "app_and_release");
      assert.deepStrictEqual(preparedC, [
        {
          app: APP,
          sourcePath: appDefaultSource(rootC, APP),
          commit: commitOnB,
        },
      ]);
      assert.equal(
        git(takenC.value.source_path!, "rev-parse", "HEAD"),
        commitOnB,
      );
    } finally {
      dbC.close();
    }
  });
});

async function publishTestPackage(
  cmd: FolderCommand,
  blobs: ReturnType<typeof createMemoryBlobs>,
  input: {
    name: string;
    version: string;
    description: string;
    owner_app: Id<"app">;
    permissions: string[];
    files: { path: string; text: string }[];
    guide?: string;
  },
) {
  const enc = new TextEncoder();
  const bundle = bundleBytes(
    input.files.map((file) => ({
      path: file.path,
      bytes: enc.encode(file.text),
    })),
  );
  const guide = enc.encode(input.guide ?? "# Purpose\n\ntest\n");
  const prepared = await prepareBundleBlobs(
    bundle,
    guide,
    "machine:install",
    blobs.prepareBlob,
  );
  assert.ok(prepared.ok);
  const done = await cmd({
    command: "package.register_version",
    input: {
      name: input.name,
      version: input.version,
      description: input.description,
      owner_app: input.owner_app,
      permissions: input.permissions,
      bundle_hash: prepared.value.bundleHash,
      guide_hash: prepared.value.guideHash,
    },
    idempotency_key: `pub-${input.name}-${input.version}`,
    compare: {},
  });
  assert.ok(done.ok, done.ok ? "" : done.error.message);
  return {
    bundleHash: prepared.value.bundleHash,
    guideHash: prepared.value.guideHash,
  };
}

test("기계 A가 내보낸 @me/* package(의존 사슬 포함)를 기계 B가 take-in 때 자동으로 들이고 release를 준비한다", async () => {
  await withWorld(async (w) => {
    const ownerApp = "app_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"app">;
    // cap-net SDK 사본이 B에 있어야 @me/base가 요구하는 SDK 검사를 지난다.
    const capNetB = join(w.rootB, "sdk", "cap-net", "1.0.0");
    mkdirSync(capNetB, { recursive: true });
    writeFileSync(
      join(capNetB, "package.json"),
      JSON.stringify({ name: "@lophn/cap-net", version: "1.0.0" }),
    );
    const baseHashes = await publishTestPackage(w.cmdA, w.blobsA, {
      name: "@me/base",
      version: "1.0.0",
      description: "Base HTTP helper",
      owner_app: ownerApp,
      permissions: ["net.fetch"],
      files: [
        {
          path: "package.json",
          text: JSON.stringify({
            name: "@me/base",
            version: "1.0.0",
            dependencies: { "@lophn/cap-net": "1.0.0" },
          }),
        },
        { path: "index.js", text: "export const base = 1;\n" },
      ],
    });
    const utilsHashes = await publishTestPackage(w.cmdA, w.blobsA, {
      name: "@me/utils",
      version: "1.2.0",
      description: "Shared utilities",
      owner_app: ownerApp,
      permissions: ["net.fetch"],
      files: [
        {
          path: "package.json",
          text: JSON.stringify({
            name: "@me/utils",
            version: "1.2.0",
            dependencies: { "@me/base": "1.0.0" },
          }),
        },
        {
          path: "index.js",
          text: 'import { base } from "@me/base"; export const v = base + 1;\n',
        },
      ],
    });

    writeFileSync(
      join(w.repoA, "package.json"),
      JSON.stringify({
        name: "notes",
        dependencies: {
          "@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
          "@me/utils": "file:.lophn/sdk/@me/utils/1.2.0",
        },
      }),
    );
    git(w.repoA, "commit", "-q", "-am", "depend on @me/utils");
    w.local.release = {
      ...w.local.release!,
      code_commit: git(w.repoA, "rev-parse", "HEAD"),
    };

    assert.ok((await w.folderA.runApp(APP)).ok);
    assert.equal(
      existsSync(join(w.dest, packageFilePath(A, "@me/utils", "1.2.0"))),
      true,
    );
    assert.equal(
      existsSync(join(w.dest, packageFilePath(A, "@me/base", "1.0.0"))),
      true,
    );

    const taken = await w.folderB.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    assert.equal(taken.value.installed, "app_and_release");
    assert.equal(w.preparedB.length, 1);

    const sqlB = sqlOf(w.dbB);
    const loadedBase = loadPackage(sqlB, "@me/base");
    assert.ok(loadedBase.ok && loadedBase.value !== null);
    assert.equal(loadedBase.value.owner_app, ownerApp);
    assert.equal(
      loadedBase.value.versions[0]?.bundle_hash,
      baseHashes.bundleHash,
    );
    assert.deepEqual(loadedBase.value.versions[0]?.permissions, ["net.fetch"]);

    const loadedUtils = loadPackage(sqlB, "@me/utils");
    assert.ok(loadedUtils.ok && loadedUtils.value !== null);
    assert.equal(
      loadedUtils.value.versions[0]?.bundle_hash,
      utilsHashes.bundleHash,
    );
    assert.equal(
      existsSync(join(w.rootB, "sdk", "@me", "utils", "1.2.0", "index.js")),
      true,
    );
    const copiedPkg = JSON.parse(
      readFileSync(
        join(w.rootB, "sdk", "@me", "utils", "1.2.0", "package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };
    assert.equal(copiedPkg.dependencies["@me/base"], "file:../../base/1.0.0");
  });
});

test("computers carry(서명된 manifest·replica)로 @me/* package를 옮기고, 권한 누락·경로 탈출 package는 거절한다", async () => {
  await withWorld(async (w) => {
    const signingA = generateSigningKey(seededRandom(51));
    const keyA = remoteKeyText(signingA.publicKey);
    const compA = join(w.rootA, COMPUTERS_DIR);
    const compB = join(w.rootB, COMPUTERS_DIR);
    mkdirSync(compA, { recursive: true });
    mkdirSync(compB, { recursive: true });

    const capNetB = join(w.rootB, "sdk", "cap-net", "1.0.0");
    mkdirSync(capNetB, { recursive: true });
    writeFileSync(
      join(capNetB, "package.json"),
      JSON.stringify({ name: "@lophn/cap-net", version: "1.0.0" }),
    );
    await publishTestPackage(w.cmdA, w.blobsA, {
      name: "@me/shared",
      version: "1.0.0",
      description: "Carried over computers",
      owner_app: APP,
      permissions: ["net.fetch"],
      files: [
        {
          path: "package.json",
          text: JSON.stringify({
            name: "@me/shared",
            version: "1.0.0",
            dependencies: { "@lophn/cap-net": "1.0.0" },
          }),
        },
        { path: "index.js", text: "export const ok = true;\n" },
      ],
    });
    writeFileSync(
      join(w.repoA, "package.json"),
      JSON.stringify({
        name: "notes",
        dependencies: {
          "@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
          "@me/shared": "file:.lophn/sdk/@me/shared/1.0.0",
        },
      }),
    );
    git(w.repoA, "commit", "-q", "-am", "use @me/shared");
    const commit = git(w.repoA, "rev-parse", "HEAD");
    const localComp: FolderLocalApp = {
      ...w.local,
      destination: COMPUTERS_DESTINATION,
      release: { ...w.local.release!, code_commit: commit },
    };
    const compDest = (path: string): DestinationsView => ({
      list: () => [{ name: COMPUTERS_DESTINATION, path, state: "ok" }],
      resolve: (name) =>
        name === COMPUTERS_DESTINATION ? { path, state: "ok" } : null,
    });
    const folderAComp = createFolderApps({
      machine: () => A,
      destinations: compDest(compA),
      apps: () => [localComp],
      records: () => [],
      progress: () => ({ read: {}, settled: null, horizon: null }),
      host: createFolderAppsHost({
        sql: sqlOf(w.dbA),
        command: w.cmdA,
        prepareCommit: () => {
          throw new Error("A does not prepare");
        },
        random: seededRandom(12),
        dataRoot: w.rootA,
        readBlob: w.blobsA.readBlob,
        prepareBlob: w.blobsA.prepareBlob,
        registerVersion: (input) =>
          w.cmdA({
            command: "package.register_version",
            input,
            idempotency_key: `comp-a-${input.name}-${input.version}`,
            compare: {},
          }),
      }),
      sql: sqlOf(w.dbA),
      clock: w.clock,
      random: seededRandom(13),
      dataRoot: w.rootA,
    });
    assert.ok((await folderAComp.runApp(APP)).ok);

    // manifest.json을 쓰고 replica B가 manifest → wants → receive로 모든 file(packages 포함)을 받는다.
    const txA = <T>(fn: (tx: { sql: Sql }) => Result<T>) =>
      fn({ sql: sqlOf(w.dbA) });
    const published = await publishManifest({
      me: A,
      root: compA,
      sql: sqlOf(w.dbA),
      transaction: txA,
      clock: w.clock,
      random: seededRandom(14),
      sign: (body) => signManifest(body, signingA.secretKey),
    });
    assert.ok(published.ok && published.value);

    const replicaB = createReplica({
      dataRoot: w.rootB,
      machine: () => B,
      signingKey: (machine) => (machine === A ? keyA : null),
      removed: () => false,
      sql: sqlOf(w.dbB),
      transaction: (fn) => fn({ sql: sqlOf(w.dbB) }),
      clock: w.clock,
      random: seededRandom(15),
      manifestsChanged: () => {},
      filesChanged: () => {},
    });
    const manifestText = readFileSync(
      join(compA, "machines", A, "manifest.json"),
      "utf8",
    );
    const offered = await replicaB.offerManifest(manifestText, "link");
    assert.ok(offered.ok && offered.value === "accepted");

    const pkgRel = packageFilePath(A, "@me/shared", "1.0.0");
    let sawPkg = false;
    for (let pass = 0; pass < 4; pass++) {
      const wants = await replicaB.wantedOf(A);
      if (wants.length === 0) break;
      for (const want of wants) {
        if (want.path === pkgRel) sawPkg = true;
        const bytes = readFileSync(join(compA, ...want.path.split("/")));
        const rec = await replicaB.receive({
          machine: A,
          path: want.path,
          size: want.size,
          sha256: want.sha256,
          via: "link",
          chunks: (async function* () {
            yield bytes;
          })(),
        });
        assert.ok(rec.ok && rec.value === "accepted", want.path);
      }
    }
    assert.equal(sawPkg, true);
    assert.equal(await replicaB.holds(A, pkgRel), true);

    const folderBComp = createFolderApps({
      machine: () => B,
      destinations: compDest(compB),
      apps: () => [],
      records: () => {
        const record = decodeRecord(
          appRecordSchema,
          readFileSync(join(compB, appRecordPath(A, APP))),
        );
        assert.ok(record.ok);
        return [
          {
            origin: A,
            destination: COMPUTERS_DESTINATION,
            record: record.value,
          },
        ];
      },
      progress: () => ({ read: {}, settled: null, horizon: null }),
      host: createFolderAppsHost({
        sql: sqlOf(w.dbB),
        command: w.cmdB,
        prepareCommit: makeLocalPrepare(w.rootB, w.cmdB, w.preparedB),
        random: seededRandom(16),
        dataRoot: w.rootB,
        readBlob: w.blobsB.readBlob,
        prepareBlob: w.blobsB.prepareBlob,
        registerVersion: (input) =>
          w.cmdB({
            command: "package.register_version",
            input,
            idempotency_key: `comp-b-${input.name}-${input.version}`,
            compare: {},
          }),
      }),
      sql: sqlOf(w.dbB),
      clock: w.clock,
      random: seededRandom(17),
      dataRoot: w.rootB,
    });

    // 변조 검사 1: cap-net 의존인데 permissions를 비운 file은 거절된다.
    const pkgPathB = join(compB, pkgRel);
    const goodBytes = readFileSync(pkgPathB);
    const badPerm = JSON.parse(goodBytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    badPerm["permissions"] = [];
    writeFileSync(pkgPathB, JSON.stringify(badPerm));
    const deniedPerm = await folderBComp.takeIn({ app: APP });
    assert.ok(!deniedPerm.ok);
    assert.equal(deniedPerm.error.code, "conflict");
    assert.equal(deniedPerm.error.details?.reason, "dependency_missing");
    assert.deepEqual(rows(w.dbB, "SELECT id FROM packages"), []);

    // 변조 검사 2: bundle 안에 상위 경로(`../escape.js`)를 넣은 file은 거절된다.
    const evilBundle = bundleBytes([
      {
        path: "package.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({ name: "@me/shared", version: "1.0.0" }),
        ),
      },
      {
        path: "../escape.js",
        bytes: new TextEncoder().encode("pwned\n"),
      },
    ]);
    const badPath = JSON.parse(goodBytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    badPath["bundle"] = Buffer.from(evilBundle).toString("base64");
    badPath["bundle_hash"] = await sha256Hex(evilBundle);
    writeFileSync(pkgPathB, JSON.stringify(badPath));
    const deniedPath = await folderBComp.takeIn({ app: APP });
    assert.ok(!deniedPath.ok);
    assert.equal(deniedPath.error.code, "conflict");
    assert.equal(deniedPath.error.details?.reason, "dependency_missing");
    assert.equal(
      existsSync(join(w.rootB, "sdk", "@me", "shared", "escape.js")),
      false,
    );

    // 정상 file을 복원하면 take-in이 package 설치와 release 준비를 끝낸다.
    writeFileSync(pkgPathB, goodBytes);
    const taken = await folderBComp.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    assert.equal(taken.value.installed, "app_and_release");
  });
});

test("data를 보내지 않는 앱도 computers destination으로 source와 app.json을 내보내 다른 기계가 take-in할 수 있다", async () => {
  await withWorld(async (w) => {
    const comp = join(w.rootA, "computers-nosync");
    mkdirSync(comp, { recursive: true });
    const compDest: DestinationsView = {
      list: () => [{ name: COMPUTERS_DESTINATION, path: comp, state: "ok" }],
      resolve: (name) =>
        name === COMPUTERS_DESTINATION ? { path: comp, state: "ok" } : null,
    };
    const localNoSync = { ...w.local, destination: null };
    const folderANoSync = createFolderApps({
      machine: () => A,
      destinations: compDest,
      apps: () => [localNoSync],
      records: () => [],
      progress: () => ({ read: {}, settled: null, horizon: null }),
      host: createFolderAppsHost({
        sql: sqlOf(w.dbA),
        command: w.cmdA,
        prepareCommit: () => {
          throw new Error("A does not prepare");
        },
        random: seededRandom(20),
        dataRoot: w.rootA,
        readBlob: w.blobsA.readBlob,
        prepareBlob: w.blobsA.prepareBlob,
        registerVersion: (input) =>
          w.cmdA({
            command: "package.register_version",
            input,
            idempotency_key: `nosync-a-${input.name}-${input.version}`,
            compare: {},
          }),
      }),
      sql: sqlOf(w.dbA),
      clock: w.clock,
      random: seededRandom(21),
      dataRoot: w.rootA,
    });
    const ran = await folderANoSync.runApp(APP);
    assert.ok(ran.ok, ran.ok ? "" : ran.error.message);

    const decoded = decodeRecord(
      appRecordSchema,
      readFileSync(join(comp, appRecordPath(A, APP))),
    );
    assert.ok(decoded.ok);
    assert.equal(decoded.value.sync_to, null);
    assert.equal(decoded.value.data.head, 0);
    assert.equal(decoded.value.source.head, 1);

    const folderBNoSync = createFolderApps({
      machine: () => B,
      destinations: compDest,
      apps: () => [],
      records: () => [
        {
          origin: A,
          destination: COMPUTERS_DESTINATION,
          record: decoded.value,
        },
      ],
      progress: () => ({ read: {}, settled: null, horizon: null }),
      host: createFolderAppsHost({
        sql: sqlOf(w.dbB),
        command: w.cmdB,
        prepareCommit: makeLocalPrepare(w.rootB, w.cmdB, w.preparedB),
        random: seededRandom(22),
        dataRoot: w.rootB,
        readBlob: w.blobsB.readBlob,
        prepareBlob: w.blobsB.prepareBlob,
        registerVersion: (input) =>
          w.cmdB({
            command: "package.register_version",
            input,
            idempotency_key: `nosync-b-${input.name}-${input.version}`,
            compare: {},
          }),
      }),
      sql: sqlOf(w.dbB),
      clock: w.clock,
      random: seededRandom(23),
      dataRoot: w.rootB,
    });
    const avail = folderBNoSync.available();
    assert.ok(avail.ok);
    assert.equal(avail.value.length, 1);
    assert.equal(avail.value[0]?.app, APP);

    const taken = await folderBNoSync.takeIn({ app: APP });
    assert.ok(taken.ok, taken.ok ? "" : taken.error.message);
    assert.equal(taken.value.installed, "app_and_release");
  });
});

// 지우면 이 lophn보다 옛 SDK로 지은 앱을 새 컴퓨터가 들이지 못할 때 "lophn을 올려라"라고 말해, 사람이 할 수 있는 일이 없다.
test("빠진 SDK 판이 이 lophn보다 옛 것이면 앱을 지금 SDK로 옮기라고, 더 새 것이거나 없으면 lophn을 올리라고 말한다", () => {
  const older = sdkMissingMessage([
    { name: "@lophn/declaration", version: "4.13.0", installed: "5.0.0" },
  ]);
  assert.match(older, /built with @lophn\/declaration@4\.13\.0/);
  assert.match(older, /update the app to the current SDK/);
  assert.doesNotMatch(older, /update lophn/);
  for (const installed of ["4.12.0", null]) {
    const newer = sdkMissingMessage([
      { name: "@lophn/declaration", version: "4.13.0", installed },
    ]);
    assert.match(newer, /update lophn on this machine/);
    assert.doesNotMatch(newer, /current SDK/);
  }
  const both = sdkMissingMessage([
    { name: "@lophn/declaration", version: "4.13.0", installed: "5.0.0" },
    { name: "@lophn/app-ui", version: "9.0.0", installed: "2.24.2" },
  ]);
  assert.match(both, /does not have @lophn\/app-ui@9\.0\.0; update lophn/);
  assert.match(both, /built with @lophn\/declaration@4\.13\.0/);
});
