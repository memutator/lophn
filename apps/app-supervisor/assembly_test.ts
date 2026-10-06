// supervisor 조립: 실제 앱 자식 프로세스(temp 폴더)를 실제 probe·open·정지로 다룬다. core는 이
// 시험의 대역이다(서명한 제어 connection을 주고 record·보고를 받아 적는다). 대역은 core 쪽
// 규칙을 새로 정하지 않는다: connection은 supervisor가 보고한 관측 그대로 서명한다.
import { assert, assertEquals } from "@std/assert";
import { createIdSource, systemClock } from "../../packages/base/mod.ts";
import { createCoreSigner } from "../../packages/apps/runtime/signing.ts";
import { unixDirectTransport } from "../../packages/apps/runtime/client/mod.ts";
import { procRssReader } from "../../packages/apps/runtime/observations/memory.ts";
import { slotSockets } from "../../packages/apps/runtime/processes/mod.ts";
import type { DesiredApp } from "../../packages/apps/runtime/supervisor/mod.ts";
import { appFlags } from "../../packages/apps/permissions/mod.ts";
import {
  COMMANDS,
  FIXTURE_APP,
  FIXTURE_RELEASE,
  SCREENS,
  writeFixtureBundle,
} from "../../packages/apps/runtime/testing/app-process.ts";
import {
  assembleSupervisor,
  type Assembly,
  type SupervisorIo,
} from "./assembly.ts";
import { spawnApp } from "./spawn.ts";

const MACHINE = "machine-credential-of-the-supervisor";

type Posted = { path: string; bearer: string; body: unknown };

type Rig = {
  assembled: Assembly;
  posted: Posted[];
  frames: unknown[];
  desired: DesiredApp;
  signer: Awaited<ReturnType<typeof createCoreSigner>>;
  dir: string;
  issued: string[];
  stop(): Promise<void>;
};

type RigOptions = {
  stopGraceMs?: number;
  // core 대역의 답을 시험이 정한다. undefined면 기본 대역이 답한다.
  answer?: (
    path: string,
    bearer: string,
    body: unknown,
  ) => { status: number; body: unknown } | undefined;
  adapters?: SupervisorIo["brokerAdapters"];
  invocations?: SupervisorIo["invocations"];
  directSocketOf?: SupervisorIo["directSocketOf"];
  // 띄운 자식의 실행 인자를 시험이 본다.
  launched?: { flags: { args: string[] } }[];
};

async function rig(options: RigOptions = {}): Promise<Rig> {
  const dir = await Deno.makeTempDir({ prefix: "lop-s-" });
  const bundleDir = `${dir}/bundle`;
  await Deno.mkdir(`${bundleDir}/data`, { recursive: true });
  const socketDir = `${dir}/s`;
  await Deno.mkdir(socketDir);
  const bundle = await writeFixtureBundle(bundleDir);
  const flags = appFlags(
    [],
    {
      bundle: bundleDir,
      data: `${bundleDir}/data`,
    },
    { ports: [] },
    [],
  );
  assert(flags.ok);
  const signer = await createCoreSigner();
  const posted: Posted[] = [];
  const frames: unknown[] = [];
  const issued: string[] = [];
  // deno-lint-ignore prefer-const
  let assembled: Assembly;
  const fake = {
    async post(path: string, bearer: string, body: unknown) {
      posted.push({ path, bearer, body });
      const answered = options.answer?.(path, bearer, body);
      if (answered !== undefined) return answered;
      if (path === "apps/connect") {
        const request = body as { app: string };
        const observation = assembled.supervisor.observation(request.app);
        if (!observation || observation.processNonce === "") {
          return { status: 503, body: { error: { code: "unavailable" } } };
        }
        const connection = {
          app: request.app,
          release: observation.release,
          bundle_hash: observation.bundleHash,
          mode: "live" as const,
          process_nonce: observation.processNonce,
          actor: "machine" as const,
          credential_ref: "machine-1",
          screens: [],
          screen_sizes: {},
          caller: null,
          commands: [],
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        };
        return {
          status: 200,
          body: {
            endpoint: observation.endpoint,
            connection,
            signature: (await signer.signConnection(connection)).signature,
          },
        };
      }
      if (path.startsWith("apps/record_")) {
        return {
          status: 200,
          body: {
            app: (body as { input: { app: string } }).input.app,
            state: { state: "running", termination_pending: false },
          },
        };
      }
      return { status: 200, body: {} };
    },
  };
  assembled = assembleSupervisor({
    clock: systemClock,
    ids: createIdSource({
      clock: systemClock,
      random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
    }),
    deno: () => Deno.execPath(),
    environment: {
      ...(Deno.env.get("HOME") ? { home: Deno.env.get("HOME") } : {}),
      ...(Deno.env.get("PATH") ? { path: Deno.env.get("PATH") } : {}),
    },
    socketPaths: () => {
      const made = slotSockets(socketDir, 0);
      assert(made.ok);
      for (const path of [made.value.brokerSocket, made.value.directSocket]) {
        try {
          Deno.removeSync(path);
        } catch { /* 처음이다 */ }
      }
      return {
        broker: made.value.brokerSocket,
        direct: made.value.directSocket,
      };
    },
    nonce: () => crypto.randomUUID(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    spawn: (launch) => {
      options.launched?.push(launch);
      return spawnApp(launch);
    },
    ...(options.directSocketOf === undefined
      ? {}
      : { directSocketOf: options.directSocketOf }),
    post: fake.post,
    direct: (endpoint, request) => unixDirectTransport(endpoint, request),
    send(message) {
      frames.push(message);
      const request = message as {
        type?: string;
        request_id?: string;
        app?: string;
      };
      if (request.type === "app_credential_request") {
        // core가 자식마다 새 app credential을 발급한다.
        const credential = `app-credential-${issued.length + 1}`;
        issued.push(credential);
        queueMicrotask(() =>
          assembled.onCredential({
            request_id: request.request_id!,
            credential,
          })
        );
      }
    },
    rss: procRssReader(),
    stopGraceMs: options.stopGraceMs ?? 300,
    ...(options.adapters === undefined
      ? {}
      : { brokerAdapters: options.adapters }),
    ...(options.invocations === undefined
      ? {}
      : { invocations: options.invocations }),
  });
  assembled.onHello({
    credential: MACHINE,
    apiPort: 1,
    verifyKey: signer.verifyKey,
  });
  const desired: DesiredApp = {
    app: FIXTURE_APP,
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
    dataPath: `${bundleDir}/data`,
  };
  return {
    assembled,
    posted,
    frames,
    desired,
    signer,
    dir,
    issued,
    async stop() {
      await assembled.supervisor.stop();
      assembled.shutdown();
      await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    },
  };
}

async function until<T>(
  what: string,
  read: () => T | undefined | Promise<T | undefined>,
  ms = 20_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function readyOf(rig: Rig) {
  const observation = rig.assembled.supervisor.observation(FIXTURE_APP);
  return observation?.ready && observation.accepting ? observation : undefined;
}

Deno.test("apps/runtime#R2: 조립한 supervisor가 실제 앱을 띄워 probe·open·record_started를 마친다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const observation = await until("ready", () => readyOf(r));
    assertEquals(observation.release, FIXTURE_RELEASE);
    assertEquals(observation.mode, "live");
    assertEquals(observation.commands.slice().sort(), [...COMMANDS].sort());
    // 제어 요청은 machine credential로만 core에 간다. 앱은 supervisor credential을 받지 않는다.
    const connects = r.posted.filter((entry) => entry.path === "apps/connect");
    assert(
      connects.length >= 2,
      "probe and open each ask for a signed connection",
    );
    for (const entry of r.posted) assertEquals(entry.bearer, MACHINE);
    const started = r.posted.filter((entry) =>
      entry.path === "apps/record_started"
    );
    assertEquals(started.length, 1);
    // 앱 자식에게 간 credential은 core가 이 자식에게 발급한 것이다.
    assertEquals(r.issued.length, 1);
    const request = r.frames.find((frame) =>
      (frame as { type?: string }).type === "app_credential_request"
    ) as { app: string; process: string; mode: string };
    assertEquals(request.app, FIXTURE_APP);
    assertEquals(request.process, observation.processNonce);
    assertEquals(request.mode, "live");
  } finally {
    await r.stop();
  }
});

Deno.test("apps/runtime#R7: 자식이 받는 broker credential은 supervisor의 machine credential이 아니다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const observation = await until("ready", () => readyOf(r));
    // 사람 connection을 서명해 앱에 "credential" command를 보낸다.
    const connection = {
      app: FIXTURE_APP,
      release: FIXTURE_RELEASE,
      bundle_hash: observation.bundleHash,
      mode: "live" as const,
      process_nonce: observation.processNonce,
      actor: "user" as const,
      credential_ref: "user-1",
      screens: [],
      screen_sizes: {},
      caller: null,
      commands: ["credential"],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const answered = await unixDirectTransport(observation.endpoint, {
      method: "POST",
      path: "/_lophn/commands/invoke",
      authorization: JSON.stringify({
        payload: connection,
        signature: (await r.signer.signConnection(connection)).signature,
      }),
      body: {
        request_key: "credential-1",
        release: FIXTURE_RELEASE,
        command: "credential",
      },
    });
    assertEquals(answered.status, 200, JSON.stringify(answered.body));
    const given = (answered.body as {
      result: { result: { broker_credential: string } };
    }).result.result.broker_credential;
    assertEquals(given, r.issued[0]);
    assert(given !== MACHINE);
  } finally {
    await r.stop();
  }
});

Deno.test("apps/runtime#R25: 메모리 표본기는 띄운 실제 자식의 신원으로 RSS를 읽는다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const sample = await r.assembled.memory(FIXTURE_APP)!.sample();
    if (Deno.build.os === "linux") {
      assert(sample !== undefined, "Linux measures VmRSS");
      assert(sample.rss_bytes > 0);
      assertEquals(sample.app, FIXTURE_APP);
      // 측정한 pid는 그 프로세스다: 표본 신원의 nonce가 현재 관측과 같다.
      assertEquals(
        sample.child.processNonce,
        r.assembled.supervisor.observation(FIXTURE_APP)!.processNonce,
      );
    } else {
      // 다른 OS는 측정하지 않은 값을 0으로 채우지 않는다.
      assertEquals(sample, undefined);
    }
  } finally {
    await r.stop();
  }
});

Deno.test("apps/runtime#R28: 앱 프로세스가 예상 밖으로 죽으면 그 자식의 credential로 process_exit 근거를 보내고 다시 띄운다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const first = await until("ready", () => readyOf(r));
    const sample = await r.assembled.memory(FIXTURE_APP)!.sample();
    assert(sample !== undefined);
    Deno.kill(sample.child.pid, "SIGKILL");
    const reported = await until(
      "the exit report",
      () =>
        r.posted.find((entry) => entry.path === "problems/observe-exception"),
    );
    // 어느 앱·release인지는 본문이 아니라 그 자식의 app credential이 정한다.
    assertEquals(reported.bearer, r.issued[0]);
    const body = reported.body as {
      observation: string;
      error: { name: string };
    };
    assertEquals(body.observation, "process_exit");
    assertEquals(body.error.name, "unexpected_exit");
    // backoff 뒤 새 자식이 같은 socket 자리에서 새 nonce로 뜬다.
    const second = await until("restart", () => {
      const next = readyOf(r);
      return next && next.processNonce !== first.processNonce
        ? next
        : undefined;
    }, 30_000);
    assertEquals(second.endpoint, first.endpoint);
    assertEquals(r.issued.length, 2);
  } finally {
    await r.stop();
  }
});

Deno.test("apps/runtime#R28: 사람이 멈춘 정지는 crash로 보내지 않고 종료 확인을 record_stopped로 남긴다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    await r.assembled.supervisor.reconcile({ ...r.desired, runEnabled: false });
    await until(
      "record_stopped",
      () => r.posted.find((entry) => entry.path === "apps/record_stopped"),
    );
    assertEquals(
      r.posted.filter((entry) => entry.path === "problems/observe-exception")
        .length,
      0,
    );
    // 정지는 새 호출·clock을 먼저 닫는 close와 shutdown 요청을 거쳤다.
    const asked = r.posted.filter((entry) => entry.path === "apps/connect");
    assert(asked.length >= 4, "probe, open, close, shutdown sign a connection");
    assertEquals(r.assembled.supervisor.observation(FIXTURE_APP)!.ready, false);
  } finally {
    await r.stop();
  }
});

Deno.test("apps/runtime#R26: 앱 log는 supervisor 메모리에서 읽고 버린 줄은 안전한 진단 frame으로 core에 간다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const read = await r.assembled.ops["apps.logs"]({
      app: FIXTURE_APP,
      limit: 50,
    }) as { state: string; lines: string[] };
    // 살아 있는 자식의 조회는 stream 끝을 기다리지 않아 ok다.
    assertEquals(read.state, "ok");
    assert(read.lines.includes("fixture app started"));
    r.assembled.logs(FIXTURE_APP)!.addUnsafeDrop();
    const diagnostic = r.frames.find((frame) =>
      (frame as { type?: string }).type === "diagnostic"
    ) as { kind: string; payload: { app: string; reason: string } };
    assertEquals(diagnostic.kind, "app_log_line_loss");
    assertEquals(diagnostic.payload.app, FIXTURE_APP);
    assertEquals(diagnostic.payload.reason, "unsafe_truncation");
  } finally {
    await r.stop();
  }
});

Deno.test("apps/runtime#R17: core 제어가 끊기면 새 호출을 닫고 자식을 끝내며 종료 통보를 남기지 않는다", async () => {
  const r = await rig();
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const observation = await until("ready", () => readyOf(r));
    await r.assembled.supervisor.coreClosed();
    // 소켓이 닫혔다.
    await until("the socket to close", async () => {
      try {
        (await Deno.connect({
          path: observation.endpoint,
          transport: "unix",
        })).close();
        return undefined;
      } catch {
        return true;
      }
    });
    assertEquals(
      r.posted.filter((entry) => entry.path === "apps/record_stopped").length,
      0,
    );
  } finally {
    await r.stop();
  }
});

// ---- broker: 자식마다 socket과 서비스 어댑터(apps/permissions#R19, apps/runtime#R6) ----

const GRANT = (kind: string, scope: Record<string, unknown>, n: number) => ({
  id: `grt_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`,
  app: FIXTURE_APP,
  kind,
  scope: { kind, ...scope },
  approval: `apr_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`,
  status: "active",
  created_by: "user",
  created_at: "2026-10-06T00:00:00.000Z",
  revoked_by: null,
  revoked_at: null,
});

const NET = { host: "api.example.com", port: 443 };

// core의 apps/blueprint·grants/list·problems/report 대역이다. 시험이 선언과 grant를 바꾼다.
function coreWorld() {
  const world = {
    grants: [] as ReturnType<typeof GRANT>[],
    release: FIXTURE_RELEASE as string | null,
    declarations: {
      permissions: [] as unknown[],
      app_connections: [] as { app: string; commands: string[] }[],
      commands: [...COMMANDS],
      automations: [] as unknown[],
      problem_codes: [] as string[],
      documents: [] as unknown[],
    },
    reports: [] as { bearer: string; body: unknown }[],
    answer(path: string, bearer: string, body: unknown) {
      if (path === "apps/blueprint") {
        if (world.release === null) {
          return { status: 404, body: { error: { code: "not_found" } } };
        }
        return {
          status: 200,
          body: {
            app: FIXTURE_APP,
            release: world.release,
            blueprint_hash: "ab".repeat(32),
            name: "Fixture",
            description: "a fixture app",
            commands: [],
            screens: [],
            automations: [],
            declarations: world.declarations,
            evidence: {
              description: { complete: true, gaps: [] },
              structure: { validated: true },
              test: { passed: true, verifications: [] },
            },
            as_of_seq: "1",
            next_cursor: null,
          },
        };
      }
      if (path === "grants/list") {
        return {
          status: 200,
          body: {
            grants: world.grants,
            display: null,
            as_of_seq: "1",
            next_cursor: null,
          },
        };
      }
      if (path === "problems/report") {
        world.reports.push({ bearer, body });
        return {
          status: 200,
          body: {
            report: "rpt_01h455vb4pex5v6nkc6gd5fdw1",
            snapshot: "snp_01h455vb4pex5v6nkc6gd5fdw1",
            problem: "prb_01h455vb4pex5v6nkc6gd5fdw1",
            diagnostic_scope: null,
          },
        };
      }
      return undefined;
    },
  };
  return world;
}

async function onBroker(
  r: Rig,
  path: string,
  body: Record<string, unknown>,
  credential?: string,
) {
  const observation = r.assembled.supervisor.observation(FIXTURE_APP)!;
  const made = slotSockets(`${r.dir}/s`, 0);
  assert(made.ok);
  return await unixDirectTransport(made.value.brokerSocket, {
    method: "POST",
    path,
    authorization: `Bearer ${credential ?? r.issued[0]}`,
    body: {
      process_nonce: observation.processNonce,
      mode: "live",
      ...body,
    },
  });
}

Deno.test("apps/permissions#R19, apps/runtime#R6: 자식마다 broker socket이 서고 그 자식의 credential만 받고 자식이 끝나면 닫힌다", async () => {
  const world = coreWorld();
  const r = await rig({ answer: (p, b, body) => world.answer(p, b, body) });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    // 서비스가 올라 있다: 모르는 경로는 없는 경로와 같다.
    const unknown = await onBroker(r, "/_lophn/broker/nothing", {});
    assertEquals(unknown.status, 404);
    // 다른 credential(supervisor의 machine credential 포함)은 거절한다.
    for (const bearer of [MACHINE, "app-credential-99"]) {
      const refused = await onBroker(
        r,
        "/_lophn/broker/automations/try_acquire",
        { release: FIXTURE_RELEASE, key: "x" },
        bearer,
      );
      assertEquals(refused.status, 401);
    }
    const made = slotSockets(`${r.dir}/s`, 0);
    assert(made.ok);
    await r.assembled.supervisor.stop();
    await until("the broker socket to close", async () => {
      try {
        (await Deno.connect({
          path: made.value.brokerSocket,
          transport: "unix",
        })).close();
        return undefined;
      } catch {
        return true;
      }
    });
  } finally {
    await r.stop();
  }
});

Deno.test("apps/permissions#R14: broker는 요청마다 선언과 grant를 다시 읽어 회수는 다음 사용부터 거절한다", async () => {
  const world = coreWorld();
  world.declarations.permissions = [{
    kind: "net.fetch",
    scope: NET,
    reason: "reads usage",
  }];
  world.grants = [GRANT("net.fetch", NET, 1)];
  const seen: string[] = [];
  const r = await rig({
    answer: (p, b, body) => world.answer(p, b, body),
    adapters: {
      netScheme: "http",
      netTransport: (input) => {
        seen.push(String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ rows: 3 }), {
            headers: { "content-type": "application/json" },
          }),
        );
      },
    },
  });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const request = {
      invocation: null,
      command: "usage.read",
      host: NET.host,
      port: NET.port,
      method: "GET",
      path: "/usage",
    };
    const allowed = await onBroker(r, "/_lophn/broker/net/fetch", request);
    assertEquals(allowed.status, 200, JSON.stringify(allowed.body));
    assertEquals(allowed.body, { status: 200, body: { rows: 3 } });
    assertEquals(seen, ["http://api.example.com:443/usage"]);
    // 사람이 회수하면 다음 요청부터 거절이다. 프로세스를 다시 띄우지 않았다.
    world.grants = [];
    const refused = await onBroker(r, "/_lophn/broker/net/fetch", request);
    assertEquals(refused.status, 403);
    assertEquals(seen.length, 1);
    // 선언 밖 host는 grant가 있어도 거절이다.
    world.grants = [GRANT("net.fetch", NET, 1)];
    const outside = await onBroker(r, "/_lophn/broker/net/fetch", {
      ...request,
      host: "other.example.com",
    });
    assertEquals(outside.status, 403);
    // 선언과 grant 조회는 supervisor의 machine credential이다.
    for (
      const entry of r.posted.filter((e) =>
        e.path === "apps/blueprint" || e.path === "grants/list"
      )
    ) assertEquals(entry.bearer, MACHINE);
    // 교체된 release의 옛 자식은 새 선언으로 접근을 얻지 못한다.
    world.release = "rel_01h455vb4pex5v6nkc6gd5fdw9";
    const replaced = await onBroker(r, "/_lophn/broker/net/fetch", request);
    assertEquals(replaced.status, 403);
    // active release가 없으면 실행 범위도 없다.
    world.release = null;
    assertEquals(
      (await onBroker(r, "/_lophn/broker/net/fetch", request)).status,
      403,
    );
  } finally {
    await r.stop();
  }
});

Deno.test("apps/automations#R6: automation permit은 supervisor 하나가 쥐고 자식 종료를 확인하면 돌려받는다", async () => {
  const world = coreWorld();
  const r = await rig({ answer: (p, b, body) => world.answer(p, b, body) });
  world.declarations.automations = [{
    key: "nightly",
    command: "usage.read",
    external: false,
    input_hash: "ab".repeat(32),
    when: { kind: "interval", interval_ms: 60_000 },
  }];
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const acquire = await onBroker(
      r,
      "/_lophn/broker/automations/try_acquire",
      { release: FIXTURE_RELEASE, key: "nightly" },
    );
    assertEquals(acquire.status, 200, JSON.stringify(acquire.body));
    assertEquals((acquire.body as { permit: boolean }).permit, true);
    assertEquals(r.assembled.permits.inUse, 1);
    // 선언하지 않은 automation은 permit이 없다.
    const unknown = await onBroker(
      r,
      "/_lophn/broker/automations/try_acquire",
      { release: FIXTURE_RELEASE, key: "other" },
    );
    assert(unknown.status >= 400);
    assertEquals(r.assembled.permits.inUse, 1);
    // 자식 종료를 확인하면 그 자식의 점유를 모두 돌려받는다.
    await r.assembled.supervisor.stop();
    await until(
      "the permit to return",
      () => r.assembled.permits.inUse === 0 ? true : undefined,
    );
  } finally {
    await r.stop();
  }
});

Deno.test("apps/sdk#R26: 문제 보고는 그 자식의 app credential로 core에 가고 선언하지 않은 code는 core에 닿지 않는다", async () => {
  const world = coreWorld();
  world.declarations.problem_codes = ["usage_sync_failed"];
  const r = await rig({ answer: (p, b, body) => world.answer(p, b, body) });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const reported = await onBroker(r, "/_lophn/broker/problems/report", {
      code: "usage_sync_failed",
    });
    assertEquals(reported.status, 200, JSON.stringify(reported.body));
    assertEquals(reported.body, {
      report_id: "rpt_01h455vb4pex5v6nkc6gd5fdw1",
    });
    assertEquals(world.reports.length, 1);
    // supervisor의 machine credential이 아니라 이 자식의 app credential이다.
    assertEquals(world.reports[0].bearer, r.issued[0]);
    assertEquals(
      (world.reports[0].body as { code: string }).code,
      "usage_sync_failed",
    );
    const undeclared = await onBroker(r, "/_lophn/broker/problems/report", {
      code: "made_up_code",
    });
    assertEquals(undeclared.status, 400);
    assertEquals(world.reports.length, 1);
  } finally {
    await r.stop();
  }
});

Deno.test("apps/invocations#R1: 앱이 보낸 기록은 자식 연결의 신원으로 전달 목록에 들어간다", async () => {
  const world = coreWorld();
  const submitted: { child: unknown; body: unknown }[] = [];
  const r = await rig({
    answer: (p, b, body) => world.answer(p, b, body),
    invocations: {
      submit(child, body) {
        submitted.push({ child, body });
        return { ok: true as const, value: { accepted: true as const } };
      },
    },
  });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const observation = await until("ready", () => readyOf(r));
    const reply = await onBroker(r, "/_lophn/broker/invocations/submit", {
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      fact: "start",
      summary: {},
    });
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assertEquals(submitted.length, 1);
    assertEquals(submitted[0].child, {
      app: FIXTURE_APP,
      release: FIXTURE_RELEASE,
      mode: "live",
      processNonce: observation.processNonce,
    });
  } finally {
    await r.stop();
  }
});

Deno.test("apps/permissions#R13: 아직 이어지지 않은 외부 통로는 서비스 검사를 지난 요청만 unavailable로 닫고 성공을 꾸미지 않는다", async () => {
  const world = coreWorld();
  world.declarations.permissions = [{
    kind: "document.save",
    scope: { key: "report" },
    reason: "saves the report",
  }];
  const r = await rig({ answer: (p, b, body) => world.answer(p, b, body) });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const save = {
      key: "report",
      base_version: null,
      idempotency_key: "save-1",
    };
    // grant가 없으면 평소와 같은 forbidden이다.
    assertEquals(
      (await onBroker(r, "/_lophn/broker/documents/save", save)).status,
      403,
    );
    world.grants = [GRANT("document.save", { key: "report" }, 2)];
    const closed = await onBroker(r, "/_lophn/broker/documents/save", save);
    assertEquals(closed.status, 503, JSON.stringify(closed.body));
  } finally {
    await r.stop();
  }
});

// ---- 앱 쌍 연결 준비·confirm: 신원은 자식 연결이 정하고 core가 서명한다 ----

const PEER = "app_01h455vb4pex5v6nkc6gd5fdw8";

function pairConnection(source: { release: string }) {
  return {
    app: PEER,
    release: "rel_01h455vb4pex5v6nkc6gd5fdw8",
    bundle_hash: "ab".repeat(32),
    mode: "live",
    process_nonce: "peer-nonce",
    actor: `app:${FIXTURE_APP}`,
    credential_ref: "app-call:source",
    screens: [],
    screen_sizes: {},
    caller: {
      kind: "app",
      app: FIXTURE_APP,
      release: source.release,
      process_nonce: "source-nonce",
      grant: "grt_01h455vb4pex5v6nkc6gd5fd01",
      parent_invocation: null,
      path: [FIXTURE_APP],
    },
    commands: ["usage.read"],
    expires_at: "2026-10-06T00:10:00.000Z",
  };
}

Deno.test("apps/connections#R1, apps/connections#R4: 다른 앱 연결 준비는 자식 연결의 신원을 붙여 machine credential로 core에 보내고 core의 서명을 그대로 돌려준다", async () => {
  const world = coreWorld();
  const sent: { path: string; bearer: string; body: unknown }[] = [];
  const r = await rig({
    answer: (path, bearer, body) => {
      if (path === "apps/pair_prepare") {
        sent.push({ path, bearer, body });
        return {
          status: 200,
          body: {
            endpoint: "/tmp/peer.sock",
            connection: pairConnection({ release: FIXTURE_RELEASE }),
            signature: "A".repeat(86),
          },
        };
      }
      return world.answer(path, bearer, body);
    },
  });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const observation = await until("ready", () => readyOf(r));
    const reply = await onBroker(r, "/_lophn/broker/apps/connect", {
      app: PEER,
      commands: ["usage.read"],
      parent_invocation: null,
    });
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    assertEquals(
      (reply.body as { connection: { app: string } }).connection.app,
      PEER,
    );
    assertEquals(sent.length, 1);
    assertEquals(sent[0].bearer, MACHINE);
    // 요청한 앱·release·mode·nonce는 본문이 아니라 이 자식 연결이 정했다.
    assertEquals((sent[0].body as { source: unknown }).source, {
      app: FIXTURE_APP,
      release: FIXTURE_RELEASE,
      mode: "live",
      process_nonce: observation.processNonce,
    });
    // 본문이 다른 앱·nonce를 말하면 core에 닿지 않고 거절한다.
    const forged = await onBroker(r, "/_lophn/broker/apps/connect", {
      app: PEER,
      commands: ["usage.read"],
      parent_invocation: null,
      process_nonce: "forged",
    });
    assertEquals(forged.status, 401);
    assertEquals(sent.length, 1);
  } finally {
    await r.stop();
  }
});

Deno.test("apps/connections#R3: core가 거절한 준비는 그 오류 code 그대로 앱에 돌아가고 성공을 꾸미지 않는다", async () => {
  const world = coreWorld();
  const r = await rig({
    answer: (path, bearer, body) =>
      path === "apps/pair_prepare"
        ? { status: 404, body: { error: { code: "not_found", message: "x" } } }
        : path === "apps/pair_confirm_request"
        ? { status: 503, body: { error: { code: "unavailable" } } }
        : world.answer(path, bearer, body),
  });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const connect = await onBroker(r, "/_lophn/broker/apps/connect", {
      app: PEER,
      commands: ["usage.read"],
      parent_invocation: null,
    });
    assertEquals(connect.status, 404);
    const confirm = await onBroker(
      r,
      "/_lophn/broker/apps/confirm/request",
      {
        app: PEER,
        command: "usage.admin",
        target_release: "rel_01h455vb4pex5v6nkc6gd5fdw8",
        target_process_nonce: "peer-nonce",
        parent_invocation: null,
      },
    );
    assertEquals(confirm.status, 503);
  } finally {
    await r.stop();
  }
});

Deno.test("apps/connections#R7: 호출의 start 사실은 core의 경로 장부에 알려지고 자식 종료는 그 자식의 기억을 비운다", async () => {
  const world = coreWorld();
  const observed: unknown[] = [];
  const r = await rig({
    answer: (path, bearer, body) => {
      if (path === "apps/pair_observe") {
        observed.push(body);
        return { status: 200, body: { accepted: true } };
      }
      return world.answer(path, bearer, body);
    },
    invocations: {
      submit: () => ({ ok: true as const, value: { accepted: true as const } }),
    },
  });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    const observation = await until("ready", () => readyOf(r));
    const caller = {
      kind: "app",
      app: PEER,
      release: "rel_01h455vb4pex5v6nkc6gd5fdw8",
      parent_invocation: null,
    };
    const reply = await onBroker(r, "/_lophn/broker/invocations/submit", {
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      fact: "start",
      summary: { caller },
    });
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    await until(
      "the start to be told",
      () => observed.length >= 1 ? true : undefined,
    );
    assertEquals(observed[0], {
      event: "start",
      process_nonce: observation.processNonce,
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      caller,
    });
    await r.assembled.supervisor.stop();
    await until(
      "the exit to be told",
      () =>
        observed.some((entry) => (entry as { event: string }).event === "exit")
          ? true
          : undefined,
    );
  } finally {
    await r.stop();
  }
});

Deno.test("apps/permissions#R20: block 요청은 그 앱의 broker 연결을 새 요청부터 막고 이미 열린 자식은 건드리지 않는다", async () => {
  const world = coreWorld();
  world.declarations.automations = [{
    key: "nightly",
    command: "usage.read",
    external: false,
    input_hash: "ab".repeat(32),
    when: { kind: "interval", interval_ms: 60_000 },
  }];
  const r = await rig({ answer: (p, b, body) => world.answer(p, b, body) });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    const acquire = {
      release: FIXTURE_RELEASE,
      key: "nightly",
    };
    const first = await onBroker(
      r,
      "/_lophn/broker/automations/try_acquire",
      acquire,
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const blocked = await r.assembled.ops["apps.block"]({ app: FIXTURE_APP });
    assertEquals(blocked, { blocked: 1 });
    // 새 요청부터 거절이다. 자식 프로세스는 그대로 살아 있다(종료 확인은 따로다).
    const after = await onBroker(
      r,
      "/_lophn/broker/automations/release",
      { ...acquire, invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1" },
    );
    assertEquals(after.status, 503);
    assert(r.assembled.supervisor.observation(FIXTURE_APP)!.ready);
    // 다른 앱은 막히지 않는다. 모르는 앱은 막은 연결이 0이다.
    assertEquals(
      await r.assembled.ops["apps.block"]({
        app: "app_01h455vb4pex5v6nkc6gd5fdw9",
      }),
      { blocked: 0 },
    );
  } finally {
    await r.stop();
  }
});

Deno.test("apps/connections#R4: 사람이 허락한 app.call 대상의 direct socket만 앱 자식의 Deno 허락에 더해진다", async () => {
  const world = coreWorld();
  const targetDirect = "/run/lophn/a7.sock";
  world.declarations.app_connections = [
    { app: PEER, commands: ["usage.read"] },
    // 선언했지만 grant가 없는 앱, grant는 있지만 선언하지 않은 command는 허락이 아니다.
    { app: "app_01h455vb4pex5v6nkc6gd5fdw7", commands: ["usage.read"] },
  ];
  world.grants = [
    {
      ...GRANT("app.call", { app: PEER, commands: ["usage.read"] }, 3),
      id: "grt_01h455vb4pex5v6nkc6gd5fd03",
    },
    {
      ...GRANT(
        "app.call",
        { app: "app_01h455vb4pex5v6nkc6gd5fdw7", commands: ["other.cmd"] },
        4,
      ),
      id: "grt_01h455vb4pex5v6nkc6gd5fd04",
    },
  ];
  const launched: { flags: { args: string[] } }[] = [];
  const asked: string[] = [];
  const r = await rig({
    answer: (p, b, body) => world.answer(p, b, body),
    launched,
    directSocketOf: (app) => {
      asked.push(app);
      return app === PEER ? targetDirect : `/run/lophn/other-${app}.sock`;
    },
  });
  try {
    await r.assembled.supervisor.reconcile(r.desired);
    await until("ready", () => readyOf(r));
    assertEquals(asked, [PEER]);
    const args = launched[0].flags.args;
    assert(args.includes(`--allow-net=unix:${targetDirect}`));
    assert(
      args.some((arg) =>
        arg.startsWith("--allow-read=") && arg.includes(targetDirect)
      ),
    );
    assert(
      args.some((arg) =>
        arg.startsWith("--allow-write=") && arg.includes(targetDirect)
      ),
    );
    // 그 허락은 대상의 direct socket 하나뿐이고 외부 host는 없다.
    for (
      const arg of args.filter((entry) => entry.startsWith("--allow-net="))
    ) {
      assert(!arg.includes("*"));
    }
    assert(!args.some((arg) => arg.includes("other-")));
  } finally {
    await r.stop();
  }
});
