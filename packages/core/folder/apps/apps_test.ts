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
import type { Id } from "../../../protocol/base/ids.ts";
import {
  appRecordPath,
  appRecordSchema,
  decodeRecord,
  sourcePath,
} from "../../../protocol/folder/mod.ts";
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
import { sdkSchemaSteps } from "../../apps/packages/schema.ts";
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
import { compareForActivation } from "../../apps/releases/compare.ts";
import { releasesSchemaSteps } from "../../apps/releases/schema.ts";
import {
  loadActiveRelease,
  loadRelease,
  loadStoredDeclaration,
} from "../../apps/releases/store.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import type { DestinationsView } from "../destinations.ts";
import { FOLDER_CODE_COMMIT_STEPS, FOLDER_SCHEMA_STEPS } from "../schema.ts";
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
  repoA: string;
  local: FolderLocalApp;
  folderA: FolderApps;
  folderB: FolderApps;
  preparedB: { app: string; sourcePath: string; commit: string }[];
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
        ...FOLDER_CODE_COMMIT_STEPS,
      ]
    : [...FOLDER_SCHEMA_STEPS, ...FOLDER_CODE_COMMIT_STEPS];
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
    sync_to: DESTINATION,
    source_path: repoA,
    release: {
      id: "rel_01hzzzzzzzzzzzzzzzzzzzzz01" as Id<"rel">,
      code_commit: firstCommit,
      data_schema: 1,
      created_at: "2026-11-01T00:00:00.000Z",
    },
  };
  const progress = () => ({ read: {}, settled: null, horizon: null });
  const folderA = createFolderApps({
    machine: () => A,
    destinations: destinations(dest),
    apps: () => [local],
    records: () => recordsIn(dest, [B]),
    progress,
    host: createFolderAppsHost({
      sql: sqlOf(dbA),
      command: () => {
        throw new Error("A takes nothing in");
      },
      prepareCommit: () => {
        throw new Error("A takes nothing in");
      },
      random: seededRandom(3),
    }),
    sql: sqlOf(dbA),
    clock,
    random: seededRandom(1),
    dataRoot: rootA,
  });
  const preparedB: { app: string; sourcePath: string; commit: string }[] = [];
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
      prepareCommit: makeLocalPrepare(rootB, cmdB, preparedB),
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
    preparedB,
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
      sync_to: DESTINATION,
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
        command: commandPort(w.dbB, () => w.clock.now()),
        prepareCommit: () => {
          throw new Error("unused");
        },
        random: seededRandom(5),
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
