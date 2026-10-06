// core ↔ supervisor 제어와 apps.runtime·apps.logs의 실제 source. 실제 core(임시 LOPHN_HOME)가
// platform 감독 pipe로 실제 apps supervisor를 띄우고, supervisor가 temp 폴더의 실제 앱 자식
// 프로세스를 띄워 probe·open·record_started를 마친다. 사람 데이터 root는 열지 않는다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  call,
  command,
  count,
} from "../../../apps/core/testing/approvals-fixture.ts";
import { appFlags } from "../permissions/mod.ts";
import type { DesiredApp } from "./supervisor/mod.ts";
import { createRuntimeClient } from "./client/mod.ts";
import { COMMANDS, openWorld, SCREENS, type World } from "./world_test.ts";
import { FIXTURE_RELEASE, writeFixtureBundle } from "./testing/app-process.ts";

type Prepared = { desired: DesiredApp; dir: string };

async function prepare(world: World): Promise<Prepared> {
  const dir = await Deno.makeTempDir({ prefix: "lop-b-" });
  await Deno.mkdir(`${dir}/data`);
  const bundle = await writeFixtureBundle(dir);
  const flags = appFlags(
    [],
    { bundle: dir, data: `${dir}/data` },
    { ports: [world.harness.port] },
    [],
  );
  assert(flags.ok);
  return {
    dir,
    desired: {
      app: world.app,
      release: FIXTURE_RELEASE,
      bundleHash: bundle.bundleHash,
      runEnabled: true,
      archived: false,
      commands: [...COMMANDS],
      screens: { usage: [...SCREENS.usage], overview: [...SCREENS.overview] },
      dataSchema: 0,
      flags: flags.value,
      entry: bundle.entry,
      importMap: bundle.importMap,
      dataPath: `${dir}/data`,
    },
  };
}

async function until<T>(
  what: string,
  read: () => Promise<T | undefined>,
  ms = 30_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

type RuntimeRead = {
  state: { state: string; termination_pending: boolean; reason?: unknown };
  observation: {
    release: string;
    mode: string;
    process_nonce: string;
    endpoint: string | null;
    ready: boolean;
    accepting: boolean;
    reason?: { code: string };
  } | null;
};

async function runtimeOf(world: World, token: string): Promise<RuntimeRead> {
  const read = await call(world.harness, "apps/runtime", token, {
    app: world.app,
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body as unknown as RuntimeRead;
}

async function withSupervisor(
  run: (world: World, prepared: Prepared, reader: string) => Promise<void>,
) {
  const world = await openWorld({ supervisor: true, sweepMs: 200 });
  const reader = await world.login("user", [
    "app.runtime",
    "app.logs",
    "app.connect",
    "app.disable_execution",
    "app.get",
  ]);
  const prepared = await prepare(world);
  try {
    await world.allow();
    await run(world, prepared, reader.token);
  } finally {
    await world.close();
    await Deno.remove(prepared.dir, { recursive: true }).catch(() => undefined);
  }
}

async function running(world: World, prepared: Prepared, token: string) {
  const reconciled = await world.harness.reconcileApp(prepared.desired);
  assert(reconciled.ok, reconciled.ok ? "" : reconciled.error.message);
  return await until("the app to run", async () => {
    const read = await runtimeOf(world, token);
    return read.state.state === "running" ? read : undefined;
  });
}

Deno.test("apps/runtime#R13: 실제 supervisor가 실제 앱을 띄워 probe·open·기록을 마치고 runtime read가 현재 관측을 보인다", async () => {
  await withSupervisor(async (world, prepared, token) => {
    // 관측이 없으면 과거 event로 running이라 하지 않는다.
    const before = await runtimeOf(world, token);
    assertEquals(before.state.state, "unavailable");
    assertEquals(before.observation, null);
    const read = await running(world, prepared, token);
    assertEquals(read.state.termination_pending, false);
    const observation = read.observation!;
    assertEquals(observation.mode, "live");
    assertEquals(observation.release, FIXTURE_RELEASE);
    assertEquals(observation.ready, true);
    assertEquals(observation.accepting, true);
    // 연결 주소는 인증된 connect만 받고 read는 내보내지 않는다.
    assertEquals(observation.endpoint, null);
    assertEquals(
      count(
        world.harness,
        "SELECT COUNT(*) AS n FROM events WHERE type = 'AppStarted'",
        [],
      ),
      1,
    );
    // 같은 프로세스에 사람이 연결한다. nonce가 read의 관측과 같다.
    const client = createRuntimeClient({
      core: {
        baseUrl: `http://127.0.0.1:${world.harness.port}`,
        token,
      },
    });
    const session = await client.connect({
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: { usage: ["full"] },
      commands: ["usage.read"],
    });
    assert(session.ok, session.ok ? "" : session.error.message);
    assertEquals(
      session.value.connection.process_nonce,
      observation.process_nonce,
    );
    const invoked = await session.value.invoke({ command: "usage.read" });
    assert(invoked.ok, invoked.ok ? "" : invoked.error.message);
    assertEquals(invoked.value.kind, "result");
  });
});

Deno.test("apps/runtime#R7: 자식 앱의 credential은 supervisor의 machine credential이 아니고 관측 기록·제어 connection을 못 한다", async () => {
  await withSupervisor(async (world, prepared, token) => {
    await running(world, prepared, token);
    const client = createRuntimeClient({
      core: { baseUrl: `http://127.0.0.1:${world.harness.port}`, token },
    });
    const session = await client.connect({
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: { usage: ["full"] },
      commands: ["credential"],
    });
    assert(session.ok, session.ok ? "" : session.error.message);
    const asked = await session.value.invoke({ command: "credential" });
    assert(asked.ok && asked.value.kind === "result");
    const given = (asked.value.output.result.result as {
      broker_credential: string;
    }).broker_credential;
    assert(given.length > 0);
    // core가 발급한 app credential이다(app actor가 읽는 status가 열린다).
    const status = await call(world.harness, "platform/status", given, {});
    assertEquals(status.status, 200, JSON.stringify(status.body));
    // 그러나 supervisor만 하는 일은 하지 못한다.
    const record = await call(world.harness, "apps/record_started", given, {
      input: {},
      idempotency_key: "k",
      compare: {},
      prepared: [],
    });
    assert(
      record.status === 403 || record.status === 401,
      String(record.status),
    );
    const connect = await call(world.harness, "apps/connect", given, {
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: {},
      commands: [],
    });
    assert(
      connect.status === 403 || connect.status === 404,
      String(connect.status),
    );
  });
});

Deno.test("apps/runtime#R26: apps.logs는 supervisor가 읽은 앱 log를 invocation별로 주고 credential 모양은 지운다", async () => {
  await withSupervisor(async (world, prepared, token) => {
    await running(world, prepared, token);
    const client = createRuntimeClient({
      core: { baseUrl: `http://127.0.0.1:${world.harness.port}`, token },
    });
    const session = await client.connect({
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: { usage: ["full"] },
      commands: ["leak", "usage.save"],
    });
    assert(session.ok);
    const leaked = await session.value.invoke({ command: "leak" });
    assert(leaked.ok && leaked.value.kind === "result");
    const invocation = leaked.value.output.invocation!;
    const lines = await until("the leak log line", async () => {
      const read = await call(world.harness, "apps/logs", token, {
        app: world.app,
        invocation,
        limit: 50,
      });
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const body = read.body as { state: string; lines: string[] };
      return body.lines.length > 0 ? body : undefined;
    });
    assertEquals(lines.state, "ok");
    assert(lines.lines.join("\n").includes("end"));
    assert(
      !lines.lines.join("\n").includes("ghp_abcdefghijklmnopqrstuvwxyz"),
      "a credential-shaped string must not reach apps.logs",
    );
    // invocation에 묶이지 않은 줄(시작 log)도 읽힌다.
    const unattached = await call(world.harness, "apps/logs", token, {
      app: world.app,
      limit: 50,
    });
    assertEquals(unattached.status, 200);
    assert(
      (unattached.body as { lines: string[] }).lines.includes(
        "fixture app started",
      ),
    );
    // 모르는 앱의 log는 없는 앱과 같다.
    const missing = await call(world.harness, "apps/logs", token, {
      app: "app_01arz3ndektsv4rrffq69g5faw",
    });
    assertEquals(missing.status, 404);
  });
});

Deno.test("apps/runtime#R26: problems collector(machine)는 지금 contract로는 apps.logs에 닿지 못하고 설정 read에만 닿는다", async () => {
  await withSupervisor(async (world, prepared, token) => {
    await running(world, prepared, token);
    // collector credential 모양: machine actor, operation은 app.logs와 GetSettings다.
    const collector = await world.login(
      "machine",
      ["app.logs", "GetSettings"],
      {
        targets: { task: "problems" },
        conditions: { task: "problems", process: "collector-child" },
      },
    );
    // apps.logs의 actor 목록에 machine이 없어서 operation scope에 있어도 route 입구에서 닫힌다.
    const logs = await call(world.harness, "apps/logs", collector.token, {
      app: world.app,
    });
    assertEquals(logs.status, 403, JSON.stringify(logs.body));
    // 설정 read는 machine이 닿는다. 진단 상세 수집 설정을 읽을 수 있다.
    const settings = await call(
      world.harness,
      "settings/get",
      collector.token,
      {
        keys: ["problems.diagnostics.detail_collection"],
      },
    );
    assertEquals(settings.status, 200, JSON.stringify(settings.body));
    // 사람은 같은 log를 읽는다.
    const person = await call(world.harness, "apps/logs", token, {
      app: world.app,
    });
    assertEquals(person.status, 200);
  });
});

Deno.test("apps/runtime#R15: 사람이 멈추면 새 호출부터 닫히고 종료를 확인한 뒤에야 stopped다", async () => {
  await withSupervisor(async (world, prepared, token) => {
    await running(world, prepared, token);
    // 사람이 멈춘다: ledger의 실행 허용을 끄고, 그 결과를 supervisor에 알린다.
    const got = await call(world.harness, "apps/get", token, {
      app: world.app,
    });
    assertEquals(got.status, 200, JSON.stringify(got.body));
    const disabled = await call(
      world.harness,
      "apps/disable_execution",
      token,
      command(
        { app: world.app },
        {
          compare: {
            base_revision: String(
              (got.body["app"] as { revision: string }).revision,
            ),
          },
        },
      ),
    );
    assertEquals(disabled.status, 200, JSON.stringify(disabled.body));
    const stopped = await world.harness.reconcileApp({
      ...prepared.desired,
      runEnabled: false,
    });
    assert(stopped.ok);
    // 정지를 요청했지만 OS 종료를 확인하기 전에는 종료 중이다. supervisor의 terminating 근거가
    // 관측으로 올라오고 완료로 표시하지 않는다(R15).
    const pending = await until("termination to be pending", async () => {
      const read = await runtimeOf(world, token);
      return read.state.termination_pending ? read : undefined;
    }, 8_000);
    assertEquals(pending.observation!.reason?.code, "terminating");
    assertEquals(pending.observation!.accepting, false);
    const done = await until("the app to stop", async () => {
      const read = await runtimeOf(world, token);
      return read.observation === null ? read : undefined;
    }, 40_000);
    // 종료 확인(record_stopped)이 AppStopped로 남는다.
    await until("AppStopped", () =>
      Promise.resolve(
        count(
            world.harness,
            "SELECT COUNT(*) AS n FROM events WHERE type = 'AppStopped'",
            [],
          ) === 1
          ? true
          : undefined,
      ));
    assert(done.state.state !== "running");
    // 멈춘 프로세스에는 연결하지 못한다.
    const connect = await call(world.harness, "apps/connect", token, {
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read"],
    });
    assertEquals(connect.status, 503);
  });
});

Deno.test("apps/runtime#R17: core가 끝나면 supervisor가 앱 자식을 끝낸다", async () => {
  const world = await openWorld({ supervisor: true, sweepMs: 200 });
  const prepared = await prepare(world);
  let endpoint = "";
  try {
    await world.allow();
    const token = (await world.login("user", ["app.runtime", "app.connect"]))
      .token;
    await running(world, prepared, token);
    const connected = await call(world.harness, "apps/connect", token, {
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read"],
    });
    assertEquals(connected.status, 200);
    endpoint = String(connected.body["endpoint"]);
    // 앱 socket에 닿는다.
    (await Deno.connect({ path: endpoint, transport: "unix" })).close();
  } finally {
    await world.close();
    await Deno.remove(prepared.dir, { recursive: true }).catch(() => undefined);
  }
  // core 제어가 끊기면 새 호출을 닫고 자식을 끝낸다.
  await until("the app socket to close", async () => {
    try {
      (await Deno.connect({ path: endpoint, transport: "unix" })).close();
      return undefined;
    } catch {
      return true;
    }
  }, 20_000);
});

Deno.test("apps/runtime#R9: 회수된 credential의 connection은 통로를 닫는다: 프로세스가 새 nonce로 다시 뜨고 옛 connection은 거절된다", async () => {
  await withSupervisor(async (world, prepared, token) => {
    const first = await running(world, prepared, token);
    const holder = await world.login("user", ["app.connect"]);
    const client = createRuntimeClient({
      core: {
        baseUrl: `http://127.0.0.1:${world.harness.port}`,
        token: holder.token,
      },
    });
    const session = await client.connect({
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read"],
    });
    assert(session.ok, session.ok ? "" : session.error.message);
    const before = await session.value.invoke({ command: "usage.read" });
    assert(before.ok && before.value.kind === "result");
    // 그 credential을 회수한다(시험 credential 기록의 상태를 바꾼다).
    const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare(
        "UPDATE credentials SET state = 'revoked' WHERE credential_ref = ?",
      )
        .run(holder.context.credential_ref);
    } finally {
      db.close();
    }
    // 회수 검사가 그 connection의 프로세스를 정지 확인 뒤 새 nonce로 다시 띄운다.
    const second = await until("the app to restart", async () => {
      const read = await runtimeOf(world, token);
      return read.state.state === "running" &&
          read.observation!.process_nonce !== first.observation!.process_nonce
        ? read
        : undefined;
    }, 60_000);
    assertNotEquals(
      second.observation!.process_nonce,
      first.observation!.process_nonce,
    );
    // 옛 connection은 새 프로세스가 받지 않는다(nonce 불일치 또는 socket 교체).
    const after = await session.value.invoke({ command: "usage.read" });
    assert(
      !after.ok || after.value.kind !== "result",
      "old connection must not work",
    );
    // 새 connection은 정상이다.
    const fresh = await createRuntimeClient({
      core: { baseUrl: `http://127.0.0.1:${world.harness.port}`, token },
    }).connect({
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read"],
    });
    assert(fresh.ok, fresh.ok ? "" : fresh.error.message);
    const ok = await fresh.value.invoke({ command: "usage.read" });
    assert(ok.ok && ok.value.kind === "result");
  });
});

Deno.test("apps/runtime#R17: 플랫폼 상태는 apps supervisor 감독 상태를 구성 요소로 보인다", async () => {
  await withSupervisor(async (world) => {
    const status = await world.login("user", ["platform/status"]);
    const read = await until("apps component", async () => {
      const reply = await call(
        world.harness,
        "platform/status",
        status.token,
        {},
      );
      assertEquals(reply.status, 200, JSON.stringify(reply.body));
      const components = reply.body["components"] as {
        component: string;
        available: boolean;
      }[];
      const apps = components.find((entry) => entry.component === "apps");
      return apps?.available ? apps : undefined;
    });
    assertEquals(read.component, "apps");
  });
});
