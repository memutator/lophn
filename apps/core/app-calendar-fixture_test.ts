// 캘린더 fixture 앱(apps#T24, fixtures/apps/calendar). 템플릿에서 시작한 앱이 자기 test·type 검사를 지나고, T6
// release 준비로 봉인 bundle이 되고, problems app test의 선언 검사를 지나는지 보고, 그 선언(권한·automation·
// command)을 실제 broker 서비스와 fake 외부 캘린더 HTTP server에 걸어 본다. 외부 캘린더 service와 사람 데이터
// root는 열지 않고 temp lophn home과 local fake만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { ok, sha256Hex } from "../../packages/base/mod.ts";
import { appList } from "../../packages/protocol/apps/mod.ts";
import { createAutomationPermits } from "../../packages/core/apps/automations/permits.ts";
import {
  type Blueprint,
  validateBlueprint,
} from "../../packages/core/apps/blueprint/mod.ts";
import { createAutomationBroker } from "../../packages/core/apps/permissions/broker/automations.ts";
import { createNetFetchService } from "../../packages/core/apps/permissions/broker/net-fetch.ts";
import {
  createSecretUseService,
  type SecretDeliveryRequest,
} from "../../packages/core/apps/permissions/broker/secrets.ts";
import {
  APP,
  child,
  createAccessFixture,
  RELEASE,
  withChild,
} from "../../packages/core/apps/permissions/testing/broker.ts";
import { effectiveScope } from "../../packages/core/apps/permissions/mod.ts";
import { prepareFromSource } from "../../packages/core/apps/releases/prepare/from-source.ts";
import {
  declarationsOfBlueprint,
  verifySealedPermissions,
} from "../../packages/core/apps/releases/mod.ts";
import { createAppCommandTools } from "../../packages/coding-agent/mcp-server/tools/app-commands.ts";
import {
  generateAppTestChecks,
  loadSources,
  scanCodeUsage,
  sdkDependenciesHash,
} from "../../packages/core/problems/tests/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/core/apps/packages/mod.ts";
import {
  APP_TEST_ARGS,
  deno,
  installedHome,
  removeTree,
} from "../../packages/core/apps/packages/testing/mod.ts";
import {
  FAKE_EXTERNAL_HOST,
  FAKE_EXTERNAL_PORT,
  serveFakeExternal,
} from "../../fixtures/apps/calendar/fake-external/server.ts";

const FIXTURE = new URL("../../fixtures/apps/calendar/", import.meta.url)
  .pathname;
const IMPORT_MAP = "--import-map=.lophn/import-map.json";
const TOKEN = "calendar.external-token";

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

type Made = {
  parent: string;
  dir: string;
  home: string;
  sdkRoot: string;
  dispose(): Promise<void>;
};

// 저장소의 fixture 원본(`.tmpl`)을 앱 폴더로 풀고 개발용 import map을 쓴다. cap-net·cap-secret을 더한 설치 SDK를 쓴다.
async function madeApp(): Promise<Made> {
  const installed = await installedHome([
    "@lophn/cap-net",
    "@lophn/cap-secret",
  ]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-calendar-app-" });
  const dir = `${parent}/app`;
  const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
  assert(files.ok, files.ok ? "" : files.error.message);
  for (const file of files.value) {
    const target = `${dir}/${file.path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeFile(target, file.bytes);
  }
  const config = JSON.parse(await Deno.readTextFile(`${dir}/deno.json`)) as {
    imports: Record<string, string>;
  };
  await Deno.mkdir(`${dir}/.lophn`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/.lophn/import-map.json`,
    JSON.stringify(devImportMap(config.imports, installed.sdkRoot, dir)),
  );
  return {
    parent,
    dir,
    home: installed.home,
    sdkRoot: installed.sdkRoot,
    async dispose() {
      await removeTree(parent);
      await installed.dispose();
    },
  };
}

// 준비한 bundle 사본의 고정 blueprint.
async function bundleBlueprint(copyPath: string): Promise<Blueprint> {
  return JSON.parse(
    await Deno.readTextFile(`${copyPath}/blueprint.json`),
  ) as Blueprint;
}

// 앱 source의 blueprint.ts가 정본이다. 권한을 좁힌 평가는 T6 준비가 하고, 여기서는 변형 선언을 만들 값만 읽는다.
async function evaluatedBlueprint(dir: string): Promise<Blueprint> {
  const evaluated = await deno(dir, [
    "eval",
    IMPORT_MAP,
    "--allow-read",
    `import b from "file://${dir}/blueprint.ts"; console.log(JSON.stringify(b));`,
  ]);
  assertEquals(evaluated.code, 0, evaluated.stderr);
  return JSON.parse(evaluated.stdout) as Blueprint;
}

const effects = (blueprint: Blueprint) =>
  Object.fromEntries(
    blueprint.commands.map((
      item,
    ) => [item.key, [item.effect, item.confirm, item.revert.supported]]),
  );

Deno.test("apps/blueprint#R5 apps/blueprint#R6 apps/automations#R13 apps/permissions#R8 apps/permissions#R14: 캘린더 앱은 자기 test와 type 검사, T6 준비, problems 선언 검사를 지난다", async () => {
  const made = await madeApp();
  try {
    const check = await deno(made.dir, [
      "check",
      IMPORT_MAP,
      "--frozen-lockfile",
      "--cached-only",
      "main.ts",
      "blueprint.ts",
      "src",
      "scripts",
      "tests",
      "fake-external",
    ]);
    assertEquals(check.code, 0, check.stderr);
    const tests = await deno(made.dir, APP_TEST_ARGS);
    assertEquals(tests.code, 0, tests.stderr + tests.stdout);
    for (
      const name of [
        "blueprint: the declaration is valid",
        "apps/blueprint#R5: sync_events는",
        "failure_path:store_unavailable list_events",
        "failure_path:external_calendar_unavailable sync_events",
        "wording: placeholders.ts is generated",
      ]
    ) assert(tests.stdout.includes(name), `${name} did not run`);

    // source commit에서 봉인 bundle까지. 앱의 build script는 실행되지 않고 src/screens/<key>/main.tsx가 build된다.
    await git(made.dir, ["init", "-q"]);
    await git(made.dir, ["config", "user.email", "dev@lophn.local"]);
    await git(made.dir, ["config", "user.name", "dev"]);
    await git(made.dir, ["add", "-A"]);
    await git(made.dir, ["commit", "-q", "-m", "init"]);
    const commit = await git(made.dir, ["rev-parse", "HEAD"]);
    const prepared = await prepareFromSource({
      dataRoot: made.home,
      app: APP,
      sourceRoot: made.dir,
      commit,
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const sealed = await verifySealedPermissions(prepared.value.copyPath);
    assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
    const paths = prepared.value.manifest.files.map((file) => file.path);
    for (
      const path of [
        "main.ts",
        "migrations/0-1.sql",
        "screens/events/main.js",
        "screens/events/index.html",
        "sdk/cap-net/1.0.0/mod.ts",
        "sdk/cap-secret/1.0.0/mod.ts",
      ]
    ) assert(paths.includes(path), `${path} is not in the bundle`);

    // 고정 blueprint의 command 효과·확인·revert(R5, R6). 외부를 부르는 command도 confirm=false다.
    const blueprint = await bundleBlueprint(prepared.value.copyPath);
    assertEquals(effects(blueprint), {
      add_event: ["write", false, true],
      create_external_event: ["external", false, false],
      delete_all_events: ["write", true, false],
      list_events: ["read", false, false],
      revert_event: ["write", false, false],
      send_to_todo: ["external", false, false],
      sync_events: ["write", false, false],
    });
    assertEquals(
      blueprint.commands.find((item) => item.key === "add_event")?.revert,
      { supported: true, command: "revert_event" },
    );
    // 선언한 net.fetch는 fake 외부 캘린더의 정확한 host·port 하나, secret.use는 이름 하나다(R8, R14).
    assertEquals(
      blueprint.permissions.map((item) => [item.kind, item.scope]),
      [
        ["net.fetch", { host: FAKE_EXTERNAL_HOST, port: FAKE_EXTERNAL_PORT }],
        ["secret.use", { name: TOKEN }],
      ],
    );
    assertEquals(
      blueprint.automatic_tasks.map((task) => [task.key, task.when]),
      [
        ["external_sync", { kind: "interval", interval_ms: 3600000 }],
        ["sync_every_minute", { kind: "interval", interval_ms: 60000 }],
        ["sync_on_start", { kind: "on_start" }],
      ],
    );

    // problems app test의 선언 검사.
    const failureTest = await sha256Hex("failure_path:store_unavailable");
    const plan = generateAppTestChecks({
      bundle_hash: prepared.value.bundleHash,
      test_hash: failureTest,
      blueprint: blueprint as never,
      data: { schema: 1, previous_schema: null },
      blueprint_hash: prepared.value.blueprintHash,
      frozen: {
        blueprint: prepared.value.blueprintHash,
        sdk_dependencies: sdkDependenciesHash(blueprint.sdk_dependencies),
        failure_paths: blueprint.problem_codes.map((item) => ({
          code: item.code,
          test_hash: failureTest,
        })),
      },
      fixed_sdk: blueprint.sdk_dependencies,
      previous_declarations: null,
    });
    const precomputed = plan.checks.filter((item) => item.precomputed);
    assertEquals(
      precomputed.map((item) => item.name).sort(),
      ["declarations", "failure_path_coverage", "fixed_sdk"],
    );
    for (const item of precomputed) {
      assertEquals(item.precomputed?.status, "pass", item.precomputed?.reason);
    }
    assert(plan.harness.has_view);
    const usage = scanCodeUsage(await loadSources(made.dir));
    assertEquals(
      [...new Set(usage.literals.map((use) => use.code))].sort(),
      blueprint.problem_codes.map((item) => item.code).sort(),
    );
    assertEquals(usage.dynamic, []);
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/permissions#R8: 선언 범위가 정확한 host·port뿐이라 wildcard·port 0 선언은 거절되고 grant한 fake 외부 캘린더에만 연결한다", async () => {
  const made = await madeApp();
  const served = serveFakeExternal({
    seed: [{ id: "ext-1", title: "A", starts_at: "2026-02-01T09:00:00.000Z" }],
  });
  try {
    const blueprint = await evaluatedBlueprint(made.dir);
    assertEquals(validateBlueprint(blueprint).ok, true);
    // 선언 단계: wildcard·port 0·전체 port는 선언 자체가 거절된다.
    for (
      const scope of [
        { host: "*.example.com", port: FAKE_EXTERNAL_PORT },
        { host: FAKE_EXTERNAL_HOST, port: 0 },
        { host: FAKE_EXTERNAL_HOST, port: 65536 },
        { host: "*", port: FAKE_EXTERNAL_PORT },
      ]
    ) {
      const widened = structuredClone(blueprint);
      widened.permissions[0] = { ...widened.permissions[0], scope };
      assertEquals(validateBlueprint(widened).ok, false, JSON.stringify(scope));
    }

    // 전송 단계: 선언했어도 grant가 있어야 연결하고 다른 port와 회수 뒤는 거절한다.
    const declarations = declarationsOfBlueprint(RELEASE, blueprint)!;
    const access = createAccessFixture({
      permissions: declarations.permissions,
      commands: declarations.commands,
    });
    const net = createNetFetchService({
      access,
      scheme: "http",
      platformPorts: [],
    });
    const get = (port: number) =>
      net.request(
        child(),
        withChild({
          invocation: null,
          command: "sync_events",
          host: FAKE_EXTERNAL_HOST,
          port,
          method: "GET",
          path: "/events",
        }),
      );
    const declaredOnly = await get(FAKE_EXTERNAL_PORT);
    assert(!declaredOnly.ok);
    assertEquals(declaredOnly.error.code, "forbidden");
    assertEquals(served.fake.seen.length, 0);
    const grant = access.grant({
      kind: "net.fetch",
      host: FAKE_EXTERNAL_HOST,
      port: FAKE_EXTERNAL_PORT,
    });
    const fetched = await get(FAKE_EXTERNAL_PORT);
    assert(fetched.ok);
    assertEquals(fetched.value, {
      status: 200,
      body: { events: served.fake.events },
    });
    const elsewhere = await get(FAKE_EXTERNAL_PORT + 1);
    assert(!elsewhere.ok);
    assertEquals(elsewhere.error.code, "forbidden");
    access.revoke(grant);
    const revoked = await get(FAKE_EXTERNAL_PORT);
    assert(!revoked.ok);
    assertEquals(served.fake.seen.length, 1);
  } finally {
    await served.stop();
    await made.dispose();
  }
});

Deno.test("apps/permissions#R14 apps/automations#R13: grant가 있는 secret은 호출자 구분 없이 확인 없이 쓰이고 회수하면 거절되며, 시작·주기 동기화는 승인 없이 돌고 external 동기화는 켜는 승인이 있어야 돈다", async () => {
  const made = await madeApp();
  try {
    const blueprint = await evaluatedBlueprint(made.dir);
    const declarations = declarationsOfBlueprint(RELEASE, blueprint)!;
    assertEquals(
      declarations.automations.map((item) => [item.key, item.external]),
      [
        ["external_sync", true],
        ["sync_every_minute", false],
        ["sync_on_start", false],
      ],
    );
    const access = createAccessFixture({
      permissions: declarations.permissions,
      commands: declarations.commands,
      automations: declarations.automations,
    });

    // secret 사용. 누가 command를 불렀는지는 요청에 없고 grant가 있으면 쓴다.
    const delivered: SecretDeliveryRequest[] = [];
    const secrets = createSecretUseService({
      access,
      platformPorts: [],
      redaction: { ensure: () => ok(undefined) },
      delivery: {
        use: (request) => {
          delivered.push(request);
          return Promise.resolve(ok({ sent: true as const }));
        },
      },
    });
    const use = () =>
      secrets.use(
        child(),
        withChild({
          release: RELEASE,
          invocation: null,
          command: "sync_events",
          input_hash: "ab".repeat(32),
          name: TOKEN,
          destination: {
            scheme: "https",
            host: FAKE_EXTERNAL_HOST,
            port: FAKE_EXTERNAL_PORT,
          },
        }),
      );
    const ungranted = await use();
    assert(!ungranted.ok);
    assertEquals(ungranted.error.code, "forbidden");
    access.grant({
      kind: "net.fetch",
      host: FAKE_EXTERNAL_HOST,
      port: FAKE_EXTERNAL_PORT,
    });
    const secretGrant = access.grant({ kind: "secret.use", name: TOKEN });
    const used = await use();
    assert(used.ok);
    assertEquals(delivered.length, 1);
    access.revoke(secretGrant);
    const revoked = await use();
    assert(!revoked.ok);
    assertEquals(delivered.length, 1);

    // automation. 시작·주기 동기화(write)는 승인 없이 돌고 external 동기화는 켜는 승인 전에는 permit이 없다.
    const broker = createAutomationBroker({
      access,
      permits: createAutomationPermits(),
    });
    const acquire = (key: string) =>
      broker.tryAcquire(child(), withChild({ release: RELEASE, key }));
    const started = await acquire("sync_on_start");
    assert(started.ok && started.value.permit);
    const periodic = await acquire("sync_every_minute");
    assert(periodic.ok && periodic.value.permit);
    const before = await acquire("external_sync");
    assert(!before.ok);
    assertEquals(before.error.code, "forbidden");
    const fact = declarations.automations.find((item) =>
      item.key === "external_sync"
    )!;
    const approval = access.grant({
      kind: "automation.run",
      automation: fact.key,
      command: fact.command,
      input_hash: fact.input_hash,
      when: fact.when,
    });
    const approved = await acquire("external_sync");
    assert(approved.ok && approved.value.permit);
    // 끄면(승인 회수) 다음 회차부터 다시 승인이 필요하다.
    access.revoke(approval);
    await broker.release(
      child(),
      withChild({
        release: RELEASE,
        key: "external_sync",
        invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      }),
    );
    const off = await acquire("external_sync");
    assert(!off.ok);
    assertEquals(off.error.code, "forbidden");

    // confirm=true command는 automation으로 선언할 수 없다.
    const confirming = structuredClone(blueprint);
    confirming.automatic_tasks[0] = {
      ...confirming.automatic_tasks[0],
      command: "delete_all_events",
    };
    assertEquals(validateBlueprint(confirming).ok, false);
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/connections#R3 apps/blueprint#R20: 다른 앱·agent가 부르는 command는 같은 선언에서 나오고 확인 필요 command는 confirm=true로 구별되며 blueprint만으로 read tool 정의가 나온다", async () => {
  const made = await madeApp();
  try {
    const blueprint = await evaluatedBlueprint(made.dir);
    const keys = blueprint.commands.map((item) => item.key);
    const confirmRequired = blueprint.commands.filter((item) => item.confirm)
      .map((item) => item.key);
    // 다른 앱이 부를 add_event는 입력 검사와 효과가 선언돼 있고 확인이 필요 없다. 지우기만 확인이 필요하다.
    assertEquals(confirmRequired, ["delete_all_events"]);
    const add = blueprint.commands.find((item) => item.key === "add_event")!;
    assertEquals([add.effect, add.confirm], ["write", false]);
    assertEquals(add.input?.required, ["starts_at", "title"]);

    // 다른 앱(할 일)과 agent 호출의 허락은 현재 선언한 command 안으로만 좁혀진다.
    const todo = "app_01bryz6s41s4z4k7p41s4z4k7p";
    const grants = createAccessFixture();
    grants.grant({ kind: "app.call", app: APP, commands: ["add_event"] }, todo);
    grants.grant({
      kind: "agent.commands",
      commands: ["add_event", "list_events", "not_a_command"],
    });
    const fromTodo = effectiveScope({
      app: todo,
      declarations: {
        release: RELEASE,
        permissions: [],
        app_connections: [{
          app: APP,
          commands: ["add_event", "delete_all_events"],
        }],
        commands: ["add_todo"],
        automations: [],
      },
      grants: grants.grants.filter((grant) => grant.app === todo),
      targetCommands: (target) => target === APP ? keys : undefined,
    });
    assertEquals(fromTodo.app_calls, [{ app: APP, commands: ["add_event"] }]);
    const forAgent = effectiveScope({
      app: APP,
      declarations: declarationsOfBlueprint(RELEASE, blueprint)!,
      grants: grants.grants.filter((grant) => grant.app === APP),
      targetCommands: () => undefined,
    });
    assertEquals(forAgent.agent_commands, ["add_event", "list_events"]);

    // blueprint만으로 만든 tool 목록에서 read command의 목적·효과를 찾는다(R20). write·external·confirm은
    // 목록에 없고 고정 `lophn_app command`로 부른다.
    const view = {
      release: RELEASE,
      blueprint_hash: "a".repeat(64),
      commands: blueprint.commands,
    };
    const tools = createAppCommandTools({
      client: {
        read: (route: unknown) => {
          assertEquals(route, appList);
          return Promise.resolve(ok({
            apps: [{ id: APP, name: blueprint.name, active_release: RELEASE }],
            next_cursor: null,
          }));
        },
      },
      blueprint: () => Promise.resolve(ok(view)),
    } as never);
    const listed = await tools.list();
    assert(listed.ok);
    assertEquals(listed.value.length, 1);
    const entry = listed.value[0];
    const listEvents = blueprint.commands.find((item) =>
      item.key === "list_events"
    )!;
    assert(entry.description.includes("list_events"));
    assert(entry.description.includes(listEvents.description));
    assertEquals(entry.readOnlyHint, true);
  } finally {
    await made.dispose();
  }
});
