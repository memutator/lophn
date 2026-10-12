// activation 전체를 실제 core(임시 LOPHN_HOME)·실제 apps supervisor·실제 data worker·실제 앱 자식으로 본다
// (apps/releases#R8, R12–R16, apps/data#R4, R11). 사람 approval을 `/v1/approvals/apply`로 적용해 시작하고
// core가 단계를 진행한다: 이전 자식 종료 확인 → backup(보호 blob) → migration → 후보 준비 확인 → commit → open.
// 앱 bundle은 앱 템플릿(`packages/apps/sdk`)의 migration·command를 봉인한 사본이고, 앱 자식은 실제 runtime
// entrypoint를 쓰는 시험 자식(`runtime/testing/app-child.ts`)이다. 사람 데이터 root와 keychain은 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "../../../../base/mod.ts";
import { canonicalJson, validateBlueprint } from "../../blueprint/mod.ts";
import { manifestBytes } from "../bundle/manifest.ts";
import { bundleCopyPath, sealBundle } from "../bundle/seal.ts";
import { dataChangesOf, readBundleCopy } from "./desired.ts";
import { blueprint, command as declared } from "../testing/mod.ts";
import {
  events,
  prepare,
  releaseRow,
  start,
  startedSeq,
  statusOf,
  type World,
} from "./world_test.ts";
import { builtinFiles } from "../../packages/testing/mod.ts";
import {
  actionOf,
  call,
  command,
  createInput,
  decide,
  inspect,
} from "../../../testing/approvals-fixture.ts";
import { createRuntimeClient } from "../../runtime/client/mod.ts";
import { createCoreHarness } from "../../../testing/core.ts";

const encoder = new TextEncoder();
const CHILD = new URL(
  "../../runtime/testing/app-child.ts",
  import.meta.url,
).href;

type Opened = World & { runtimeDir: string };

async function open(): Promise<Opened> {
  const documents = await import("../../../projects/register.ts");
  const apps = await import("../../register.ts");
  const fixtures = await import(
    "../testing/mod.ts"
  );
  const runtimeDir = await Deno.makeTempDir({ prefix: "lop-act-" });
  const opened = await createCoreHarness({
    // 앱 자식은 실제 시각으로 연결 기한을 비교한다.
    nowMs: Date.now(),
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../../projects/register.ts", import.meta.url).href,
      new URL("../../register.ts", import.meta.url).href,
      new URL(
        "../testing/mod.ts",
        import.meta.url,
      ).href,
    ],
    // 진행은 시험이 sweep을 불러 돌린다.
    apps: { supervisor: { runtimeDir }, sweepMs: 3_600_000 },
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const login = async (
    actor: "user" | "machine",
    operations: string[],
  ) => {
    const issued = await harness.credential({
      actor,
      principal: `${actor}-${operations.length}`,
      scope: { operations, targets: {} },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    return issued.value;
  };
  const user = await login("user", [
    "app.create",
    "app.connect",
    "grant.create",
    "grant.revoke",
    "grants.list",
    "create_approval_request",
    "apply_approved_action",
    "release.start_activation",
    "grant_approval_request",
    "GetApproval",
  ]);
  const machine = await login("machine", [
    "create_approval_request",
    "apply_approved_action",
    "release.prepare",
    "release.start_activation",
    "releases.tests.add_verification",
    "GetApproval",
  ]);
  const created = await call(
    harness,
    "apps/create",
    user.token,
    command({ slug: "items", name: "Items", description: "an items app" }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return {
    harness,
    user,
    machine,
    app: String(created.body["id"]),
    next: 1,
    runtimeDir,
  };
}

async function close(world: Opened): Promise<void> {
  // 봉인 사본은 읽기 전용이라 쓰기를 돌려준 뒤에야 지운다.
  await new Deno.Command("chmod", {
    args: ["-R", "u+w", world.harness.dataRoot],
  }).output();
  await world.harness.close();
  await Deno.remove(world.runtimeDir, { recursive: true }).catch(() =>
    undefined
  );
}

async function untilReady(world: Opened): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (world.harness.appsControl.channel.bound) {
      const seen = await world.harness.appsControl.client.observe(world.app);
      if (seen.ok) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the apps supervisor did not become ready");
}

type Sealed = { over: Record<string, unknown>; hash: string };

// 템플릿의 migration(있으면)과 command를 봉인한 bundle 사본이다. 사본 위치는 core의 data root다.
async function sealed(
  world: Opened,
  options: {
    version: number;
    schema: number;
    migration?: string;
    readPath?: string;
  },
): Promise<Sealed> {
  const template = await builtinFiles();
  const templateSql = new TextDecoder().decode(
    template.find((file) => file.path === "migrations/0-1.sql")!.bytes,
  );
  const files = new Map<string, string>([
    ["main.ts", `import ${JSON.stringify(CHILD)};\n`],
    [
      "import-map.json",
      JSON.stringify({
        imports: {
          "@lophn/base": new URL("../../../../base/mod.ts", import.meta.url)
            .href,
          "@lophn/apps/blueprint": new URL(
            "../../blueprint/mod.ts",
            import.meta.url,
          ).href,
        },
      }),
    ],
    ["data-schema", String(options.schema)],
  ]);
  if (options.readPath) files.set("read-target", options.readPath);
  if (options.schema > 0) {
    files.set("migrations/0-1.sql", options.migration ?? templateSql);
  }
  // 준비 worker처럼 검증기를 통과한 정규형을 bundle의 blueprint.json으로 둔다.
  const validated = validateBlueprint(
    blueprint({
      name: "Items",
      description: `Keeps a list of items, version ${options.version}`,
      commands: [
        declared("list_items"),
        declared("add_item", "write"),
        ...(options.readPath ? [declared("read_file")] : []),
      ],
      ...(options.readPath
        ? {
          permissions: [{
            kind: "fs.read",
            scope: { path: options.readPath, recursive: false },
            reason: "Reads input",
          }],
        }
        : {}),
    }),
    { app: world.app },
  );
  assert(validated.ok);
  const blueprintJson = canonicalJson(validated.value as never);
  const listed: { path: string; hash: string }[] = [];
  for (const [path, text] of files) {
    listed.push({ path, hash: await sha256Hex(text) });
  }
  listed.push({ path: "blueprint.json", hash: await sha256Hex(blueprintJson) });
  const manifest = {
    entrypoint: "main.ts",
    files: listed,
    sdk_dependencies: [],
  };
  const hash = await sha256Hex(manifestBytes(manifest));
  const copy = bundleCopyPath(world.harness.dataRoot, world.app, hash);
  assert(copy.ok);
  const done = await sealBundle({
    copyPath: copy.value,
    manifest,
    blueprintJson: encoder.encode(blueprintJson),
    bundleFiles: [...files].map(([path, text]) => ({
      path,
      bytes: encoder.encode(text),
    })),
  });
  assert(done.ok, done.ok ? "" : done.error.message);
  const read = await readBundleCopy(world.harness.dataRoot, world.app, hash);
  assert(read.ok && read.value !== undefined);
  const changes = await dataChangesOf(read.value);
  assert(changes.ok);
  return {
    hash,
    over: {
      bundle_hash: hash,
      blueprint_hash: await sha256Hex(blueprintJson),
      blueprint: JSON.parse(blueprintJson),
      manifest,
      data_schema: options.schema,
      data_changes: changes.value,
    },
  };
}

// activation 진행을 core에 맡긴다: sweep이 시도를 진행하고 끝나기를 기다린다.
async function drive(world: Opened): Promise<void> {
  const control = world.harness.appsControl;
  await control.sweep();
  await control.activation!.settled();
  await control.sweep();
}

type Seen = { release: string | null; ready: boolean; accepting: boolean };

async function untilRunning(world: Opened, release: string): Promise<Seen> {
  const deadline = Date.now() + 30_000;
  let seen: Seen | undefined;
  while (Date.now() < deadline) {
    const observed = await world.harness.appsControl.client.observe(world.app);
    if (observed.ok && observed.value !== null) {
      seen = observed.value;
      if (seen.release === release && seen.ready && seen.accepting) return seen;
    }
    await world.harness.appsControl.sweep();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`release ${release} did not run: ${JSON.stringify(seen)}`);
}

// 실제 앱 자식의 argv다(`/proc`). 그 사본의 import map으로 뜬 프로세스를 찾는다.
async function childArgv(copyRoot: string): Promise<string[] | undefined> {
  for await (const entry of Deno.readDir("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const text = new TextDecoder().decode(
        await Deno.readFile(`/proc/${entry.name}/cmdline`),
      );
      const args = text.split("\0");
      if (
        args.some((arg) => arg === `--import-map=${copyRoot}/import-map.json`)
      ) {
        return args;
      }
    } catch { /* 이미 끝난 프로세스다 */ }
  }
  return undefined;
}

function dataFile(world: Opened): string {
  return `${world.harness.dataRoot}/apps/${world.app}/data/app.sqlite`;
}

function tables(world: Opened): string[] {
  const db = new DatabaseSync(dataFile(world), { readOnly: true });
  try {
    return db.prepare(
      "select name from sqlite_master where type = 'table' order by name",
    ).all().map((row) => String(row["name"]));
  } finally {
    db.close();
  }
}

// 앱이 쓴 업무 data의 대역이다. 앱 자식이 아니라 시험이 직접 쓴다.
function writeNote(world: Opened, body: string): void {
  const db = new DatabaseSync(dataFile(world));
  try {
    db.exec("create table if not exists notes (body text not null)");
    db.prepare("insert into notes (body) values (?)").run(body);
  } finally {
    db.close();
  }
}

function notes(world: Opened): string[] {
  const db = new DatabaseSync(dataFile(world), { readOnly: true });
  try {
    return db.prepare("select body from notes order by rowid").all().map((
      row,
    ) => String(row["body"]));
  } finally {
    db.close();
  }
}

// 첫 activation. 이전 release도 변경도 없고 첫 성공이 실행 허용까지 확정한다.
async function activateFirst(world: Opened): Promise<string> {
  const first = await sealed(world, { version: 1, schema: 0 });
  const release = await prepare(world, first.over);
  const started = await start(world, release, { schema: 0 });
  assertEquals(started.reply.status, 200, JSON.stringify(started.reply.body));
  await drive(world);
  assertEquals(statusOf(world, release), "active");
  await untilRunning(world, release);
  return release;
}

Deno.test("apps/releases#R8, R12–R16, apps/data#R4: 실제 core·supervisor·data worker·앱 자식으로 approval → activation → backup 보호 blob → migration 0 → 1 → active release와 bundle flag의 앱 자식이 이어진다", async () => {
  const world = await open();
  try {
    await untilReady(world);
    const first = await activateFirst(world);
    const firstApp = inspect(
      world.harness,
      "select run_enabled, active_release from apps where id = ?",
      [world.app],
    )[0];
    assertEquals(Number(firstApp["run_enabled"]), 1);
    assertEquals(firstApp["active_release"], first);
    // 첫 자식의 flag는 그 사본 root를 읽고 앱 data 영역에만 쓴다.
    writeNote(world, "kept");

    // schema 0 → 1(템플릿 migration)을 가진 두 번째 release.
    const second = await sealed(world, { version: 2, schema: 1 });
    const release = await prepare(world, second.over);
    const started = await start(world, release, { schema: 0 });
    assertEquals(started.reply.status, 200, JSON.stringify(started.reply.body));
    const seq = startedSeq(started.reply);
    await drive(world);

    // 채택됐고 이전 release는 대체됐다.
    assertEquals(statusOf(world, release), "active");
    assertEquals(statusOf(world, first), "superseded");
    assertEquals(
      inspect(world.harness, "select active_release from apps where id = ?", [
        world.app,
      ])[0]["active_release"],
      release,
    );
    // backup은 보호 blob으로 보존됐고 ledger가 가리키는 hash다. 일반 읽기는 없다.
    const activation = JSON.parse(
      String(releaseRow(world, release)["activation"]),
    );
    const refs = inspect(
      world.harness,
      "select owner_key, hash, size_bytes from blob_refs where owner_kind = 'release_backup'",
      [],
    );
    assertEquals(refs.length, 1);
    assertEquals(refs[0]["owner_key"], `${release}:${seq}`);
    assertEquals(refs[0]["hash"], activation.backup_hash);
    assert(Number(refs[0]["size_bytes"]) > 0);
    // migration이 적용됐다: 템플릿의 표가 있고 업무 data는 그대로다.
    assert(tables(world).includes("item"));
    assertEquals(notes(world), ["kept"]);
    assertEquals(events(world, "ReleaseDataChanged").length, 1);
    assertEquals(events(world, "ReleaseActivated").length, 2);

    // 새 release의 앱 자식이 열려 있고 bundle 사본 root와 data 영역만 읽고 쓰는 flag로 떴다.
    const seen = await untilRunning(world, release);
    assertEquals(seen.accepting, true);
    const copy = bundleCopyPath(world.harness.dataRoot, world.app, second.hash);
    assert(copy.ok);
    const argv = await childArgv(copy.value);
    assert(argv !== undefined, "the app child is not running");
    const read = argv.find((arg) => arg.startsWith("--allow-read="))!;
    assert(read.includes(copy.value));
    const write = argv.find((arg) => arg.startsWith("--allow-write="))!;
    assert(write.includes(`${world.harness.dataRoot}/apps/${world.app}/data`));
    assert(!argv.includes("--allow-all") && !argv.includes("-A"));
  } finally {
    await close(world);
  }
});

Deno.test("apps/data#R11, apps/releases#R15: migration이 실패하면 새 자식 없이 backup으로 복원하고 fail_activation 뒤 이전 release가 다시 뜬다", async () => {
  const world = await open();
  try {
    await untilReady(world);
    const first = await activateFirst(world);
    writeNote(world, "before");

    // 두 번째 단계에서 실패하는 migration. 중간 변경이 남으면 안 된다.
    const bad = await sealed(world, {
      version: 3,
      schema: 1,
      migration:
        "create table half (id integer);\nalter table missing add column x;",
    });
    const release = await prepare(world, bad.over);
    const started = await start(world, release, { schema: 0 });
    assertEquals(started.reply.status, 200, JSON.stringify(started.reply.body));
    const seq = startedSeq(started.reply);
    await drive(world);

    // 실패로 닫혔고 이전 release가 채택된 채다.
    assertEquals(statusOf(world, release), "failed");
    assertEquals(statusOf(world, first), "active");
    assertEquals(
      inspect(world.harness, "select active_release from apps where id = ?", [
        world.app,
      ])[0]["active_release"],
      first,
    );
    assertEquals(events(world, "ReleaseActivationFailed").length, 1);
    // backup 확정과 복원 결과가 ledger에 남았다.
    const records = inspect(
      world.harness,
      "select kind, data_schema from app_data_records where release = ? and activation_seq = ? order by kind",
      [release, seq],
    );
    assertEquals(
      records.map((row) => [row["kind"], Number(row["data_schema"])]),
      [["backup", 0], ["restore", 0]],
    );
    assertEquals(events(world, "ReleaseDataRestored").length, 1);
    // 실제 DB는 시작 때로 돌아왔다: 새 표도 중간 변경도 없고 업무 data는 그대로다.
    assert(!tables(world).includes("item"));
    assert(!tables(world).includes("half"));
    assertEquals(notes(world), ["before"]);
    // 이전 release의 앱 자식이 다시 열려 있다.
    const seen = await untilRunning(world, first);
    assertEquals(seen.release, first);
  } finally {
    await close(world);
  }
});

Deno.test("apps/permissions#R21: 사람 approval revoke는 실제 supervisor 자식을 종료하고 fs flag 없는 새 자식을 연다", async () => {
  const world = await open();
  try {
    await untilReady(world);
    const readPath = `${world.runtimeDir}/input.txt`;
    await Deno.writeTextFile(readPath, "input");
    const bundle = await sealed(world, { version: 1, schema: 0, readPath });
    const release = await prepare(world, bundle.over);
    const approved = async (
      action: Parameters<typeof createInput>[2],
      approval: string,
    ) => {
      const made = await call(
        world.harness,
        "approvals/create",
        world.user.token,
        command(createInput(approval, "user", action)),
      );
      assertEquals(made.status, 200, JSON.stringify(made.body));
      const granted = await decide(
        world.harness,
        world.user.token,
        made.body["request"] as never,
        "grant",
      );
      assertEquals(granted.status, 200, JSON.stringify(granted.body));
      return call(
        world.harness,
        "approvals/apply",
        world.user.token,
        command({ approval, action, idempotency_key: approval }),
      );
    };
    const grantApproval = "apr_01h455vb4pex5v6nkc6gd5fd01";
    const scope = { kind: "fs.read", path: readPath, recursive: false };
    const grantAction = await actionOf({
      concern: "apps/permissions",
      command: "grant.create",
      caller: "user",
      targets: [world.app],
      value: {
        app: world.app,
        kind: "fs.read",
        scope,
        approval: grantApproval,
      },
      comparison: { grants_seq: "0" },
    });
    const allowed = await approved(grantAction, grantApproval);
    assertEquals(allowed.status, 200, JSON.stringify(allowed.body));
    const activationApproval = "apr_01h455vb4pex5v6nkc6gd5fd02";
    const grantRow =
      inspect(world.harness, "select id from grants where app = ?", [
        world.app,
      ])[0];
    const seq = String(
      inspect(
        world.harness,
        "select max(seq) as seq from events where type = 'GrantCreated'",
        [],
      )[0]["seq"],
    );
    const startAction = await actionOf({
      concern: "apps/releases",
      command: "release.start_activation",
      caller: "user",
      targets: [release],
      value: {
        release,
        approval: activationApproval,
        previous_release: null,
        expected_grants_seq: Number(seq),
        expected_schema: 0,
        key: activationApproval,
      },
      comparison: {},
    });
    const activation = await approved(startAction, activationApproval);
    assertEquals(activation.status, 200, JSON.stringify(activation.body));
    await drive(world);
    await untilRunning(world, release);
    const copy = bundleCopyPath(world.harness.dataRoot, world.app, bundle.hash);
    assert(copy.ok);
    const before = await childArgv(copy.value);
    assert(
      before?.some((arg) => arg.includes(readPath)),
      JSON.stringify(before),
    );
    const client = createRuntimeClient({
      core: {
        call: (path, input) =>
          call(
            world.harness,
            path,
            world.user.token,
            input,
          ),
      },
    });
    const connected = await client.connect({
      app: world.app,
      mode: "live",
      commands: ["read_file"],
      screens: ["home"],
      screen_sizes: { home: ["full"] },
    });
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const readable = await connected.value.invoke({ command: "read_file" });
    assert(readable.ok, readable.ok ? "" : readable.error.message);
    assert(
      JSON.stringify(readable.value).includes("input"),
      JSON.stringify(readable.value),
    );
    const old = inspect(
      world.harness,
      "select payload from events where type = 'AppStarted' and subject = ? order by seq desc limit 1",
      [world.app],
    );
    const revokeApproval = "apr_01h455vb4pex5v6nkc6gd5fd03";
    const grant = String(grantRow["id"]);
    const revokeAction = await actionOf({
      concern: "apps/permissions",
      command: "grant.revoke",
      caller: "user",
      targets: [grant],
      value: {
        app: world.app,
        grant,
        process_nonce: null,
        termination_confirmed: null,
      },
      comparison: { grants_seq: seq },
    });
    const revoked = await approved(revokeAction, revokeApproval);
    assertEquals(revoked.status, 200, JSON.stringify(revoked.body));
    assertEquals(
      inspect(world.harness, "select status from grants where id = ?", [
        grant,
      ])[0]["status"],
      "revoked",
    );
    await untilRunning(world, release);
    const after = await childArgv(copy.value);
    assert(
      after && !after.some((arg) => arg.includes(readPath)),
      JSON.stringify(after),
    );
    const reconnected = await client.connect({
      app: world.app,
      mode: "live",
      commands: ["read_file"],
      screens: ["home"],
      screen_sizes: { home: ["full"] },
    });
    assert(reconnected.ok, reconnected.ok ? "" : reconnected.error.message);
    const refused = await reconnected.value.invoke({ command: "read_file" });
    assert(
      JSON.stringify(refused).includes('"denied":true'),
      JSON.stringify(refused),
    );
    const stops = inspect(
      world.harness,
      "select type from events where subject = ? and type = 'AppStopped'",
      [world.app],
    );
    assert(stops.length > 0, JSON.stringify(old));
    assertEquals(
      inspect(
        world.harness,
        "select count(*) as n from approval_uses where approval = ?",
        [revokeApproval],
      )[0]["n"],
      1,
    );
  } finally {
    await close(world);
  }
});
