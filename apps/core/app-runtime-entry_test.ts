// 운영 앱이 실제 runtime entry로 뜨는지 실제 core(임시 LOPHN_HOME)·실제 apps supervisor·실제 준비 자식·실제
// 앱 자식으로 본다(apps/releases#R1, apps/runtime#R2, R10). todo fixture를 제품 길(source 연결 → `prepare_bundle` →
// `release.prepare` → approval → activation)로 준비해 올리고, 준비한 bundle의 진입 파일이 runtime entrypoint의
// `main()`을 불러 ready 신호가 서고 앱 channel로 부른 command가 실제 결과를 낸다. bundle을 다시 봉인하거나 진입
// 파일을 끼우는 우회는 없다. 사람 데이터 root와 keychain은 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../packages/base/mod.ts";
import {
  dataChangesOf,
  readBundleCopy,
} from "../../packages/apps/releases/activation/desired.ts";
import { bundleCopyPath } from "../../packages/apps/releases/bundle/seal.ts";
import {
  prepare,
  start,
  statusOf,
  type World,
} from "../../packages/apps/releases/activation/world_test.ts";
import { createRuntimeClient } from "../../packages/apps/runtime/client/mod.ts";
import { readTemplateDirectory } from "../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { call, command } from "./testing/approvals-fixture.ts";
import { createCoreHarness } from "./testing/core.ts";

const FIXTURE = new URL("../../fixtures/apps/todo/", import.meta.url).pathname;

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

type Opened = World & {
  runtimeDir: string;
  source: string;
  commit: string;
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const documents = await import("./documents.ts");
  const apps = await import("./apps.ts");
  const fixtures = await import(
    "../../packages/apps/releases/testing/mod.ts"
  );
  const runtimeDir = await Deno.makeTempDir({ prefix: "lop-entry-" });
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
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL(
        "../../packages/apps/releases/testing/mod.ts",
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
    "app.get",
    "app.connect",
    "app.connect_source",
    "create_approval_request",
    "grant_approval_request",
    "GetApproval",
  ]);
  const machine = await login("machine", [
    "create_approval_request",
    "apply_approved_action",
    "release.prepare",
    "release.prepare_bundle",
    "release.preparation",
    "release.start_activation",
    "releases.tests.add_verification",
    "GetApproval",
  ]);
  const installed = await installedHome(["@lophn/cap-fs"]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-entry-source-" });
  const source = `${parent}/app`;
  const dispose = async () => {
    // 봉인한 bundle(0444·0555)이 core 폴더 정리를 막지 않게 먼저 쓸 수 있게 푼다.
    await new Deno.Command("chmod", {
      args: ["-R", "u+rwX", harness.dataRoot],
    }).output();
    await harness.close();
    await Deno.remove(runtimeDir, { recursive: true }).catch(() => undefined);
    await removeTree(parent);
    await installed.dispose();
  };
  try {
    const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
    assert(files.ok, files.ok ? "" : files.error.message);
    for (const file of files.value) {
      const target = `${source}/${file.path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(target, file.bytes);
    }
    await git(source, ["init", "-q"]);
    await git(source, ["config", "user.email", "dev@lophn.local"]);
    await git(source, ["config", "user.name", "dev"]);
    await git(source, ["add", "-A"]);
    await git(source, ["commit", "-q", "-m", "init"]);
    const commit = await git(source, ["rev-parse", "HEAD"]);
    // 설치 SDK 사본을 core의 data root로 옮긴다(쓸 수 있게 풀어 지울 수 있게 한다).
    const copied = await new Deno.Command("cp", {
      args: ["-r", `${installed.home}/sdk`, `${harness.dataRoot}/sdk`],
    }).output();
    assert(copied.success);
    await new Deno.Command("chmod", {
      args: ["-R", "u+rwX", `${harness.dataRoot}/sdk`],
    }).output();
    const created = await call(
      harness,
      "apps/create",
      user.token,
      command({ slug: "todo", name: "Todo", description: "a todo app" }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body["id"]);
    const got = await call(harness, "apps/get", user.token, { app });
    assertEquals(got.status, 200, JSON.stringify(got.body));
    const connected = await call(
      harness,
      "apps/connect_source",
      user.token,
      command(
        { app, source_path: source },
        {
          compare: {
            base_revision: (got.body["app"] as { revision: string }).revision,
          },
        },
      ),
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    return {
      harness,
      user,
      machine,
      app,
      next: 1,
      runtimeDir,
      source,
      commit,
      dispose,
    };
  } catch (thrown) {
    await dispose();
    throw thrown;
  }
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

// 접수한 준비가 끝나기를 기다려 bundle hash를 돌려준다.
async function prepareBundle(world: Opened): Promise<string> {
  const accepted = await call(
    world.harness,
    "releases/prepare_bundle",
    world.machine.token,
    command({ app: world.app, commit: world.commit, request_key: "entry-1" }),
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const read = await call(
      world.harness,
      "releases/preparation",
      world.machine.token,
      command({ app: world.app, request_key: "entry-1" }),
    );
    assertEquals(read.status, 200, JSON.stringify(read.body));
    if (read.body["status"] === "completed") {
      return String(read.body["bundle_hash"]);
    }
    assert(read.body["status"] === "preparing", JSON.stringify(read.body));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("preparation did not settle");
}

type Seen = { release: string | null; ready: boolean; accepting: boolean };

async function untilRunning(world: Opened, release: string): Promise<Seen> {
  const deadline = Date.now() + 60_000;
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

Deno.test("apps/releases#R1, apps/runtime#R2, R10: 제품 길로 준비한 todo 앱이 운영 자식으로 뜨면 준비한 진입 파일이 runtime main()을 불러 ready가 서고 command가 실제 결과를 낸다", async () => {
  const world = await open();
  try {
    await untilReady(world);
    const bundleHash = await prepareBundle(world);
    const copy = bundleCopyPath(world.harness.dataRoot, world.app, bundleHash);
    assert(copy.ok);
    const read = await readBundleCopy(
      world.harness.dataRoot,
      world.app,
      bundleHash,
    );
    assert(read.ok && read.value !== undefined);
    // 준비가 낸 진입 파일이 manifest의 entrypoint이고 앱의 main.ts는 `@lophn/app`이 가리키는 앱 code다.
    assertEquals(read.value.manifest.entrypoint, "lophn-entry.ts");
    assert(read.value.entry.endsWith("/lophn-entry.ts"));
    const changes = await dataChangesOf(read.value);
    assert(changes.ok, changes.ok ? "" : changes.error.message);
    const release = await prepare(world, {
      bundle_hash: bundleHash,
      blueprint_hash: await sha256Hex(
        await Deno.readTextFile(`${copy.value}/blueprint.json`),
      ),
      blueprint: JSON.parse(
        await Deno.readTextFile(`${copy.value}/blueprint.json`),
      ),
      manifest: read.value.manifest,
      data_schema: read.value.dataSchema,
      data_changes: changes.value,
    });
    const started = await start(world, release, { schema: 0 });
    assertEquals(started.reply.status, 200, JSON.stringify(started.reply.body));
    const control = world.harness.appsControl;
    await control.sweep();
    await control.activation!.settled();
    await control.sweep();
    assertEquals(statusOf(world, release), "active");
    // runtime main()이 시작 입력·command 목록·schema를 보고해 ready·accepting이 섰다.
    const seen = await untilRunning(world, release);
    assertEquals(seen.accepting, true);

    // 선언한 permission만 가진 자식이다: 사본 root·앱 data·socket만 읽고, env·run·ffi·sys·all은 없다.
    const argv = await childArgv(copy.value);
    assert(argv !== undefined, "the app child is not running");
    assertEquals(argv.at(-1), read.value.entry);
    const readFlag = argv.find((arg) => arg.startsWith("--allow-read="))!;
    assert(readFlag.includes(copy.value));
    const writeFlag = argv.find((arg) => arg.startsWith("--allow-write="))!;
    assert(
      writeFlag.includes(`${world.harness.dataRoot}/apps/${world.app}/data`),
    );
    for (const flag of argv) {
      assert(
        !/^(--allow-(all|env|run|ffi|sys)|-A)(=|$)/.test(flag),
        `forbidden flag: ${flag}`,
      );
    }

    // 앱 channel로 부른 command가 실제 앱 code(handler·DB)의 결과를 낸다.
    const client = createRuntimeClient({
      core: {
        call: (path, input) =>
          call(world.harness, path, world.user.token, input),
      },
    });
    const connected = await client.connect({
      app: world.app,
      mode: "live",
      commands: ["add_todo", "list_todos"],
      screens: ["todos"],
      screen_sizes: { todos: ["full"] },
    });
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const added = await connected.value.invoke({
      command: "add_todo",
      input: { title: "Buy milk" },
    });
    assert(added.ok, added.ok ? "" : added.error.message);
    const listed = await connected.value.invoke({ command: "list_todos" });
    assert(listed.ok, listed.ok ? "" : listed.error.message);
    assert(
      JSON.stringify(listed.value).includes("Buy milk"),
      JSON.stringify(listed.value),
    );
  } finally {
    await world.dispose();
  }
});
