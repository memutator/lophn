// supervisor 조립: 실제 앱 자식 프로세스(temp 폴더)를 실제 probe·open·정지로 다룬다. core는 이
// 시험의 대역이다(서명한 제어 connection을 주고 record·보고를 받아 적는다). 대역은 core 쪽
// 규칙을 새로 정하지 않는다: connection은 supervisor가 보고한 관측 그대로 서명한다.
import { assert, assertEquals } from "@std/assert";
import { createIdSource, systemClock } from "../../packages/base/mod.ts";
import { createConnectionSigner } from "../../packages/apps/runtime/connect.ts";
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
import { assembleSupervisor, type Assembly } from "./assembly.ts";
import { spawnApp } from "./spawn.ts";

const MACHINE = "machine-credential-of-the-supervisor";

type Posted = { path: string; bearer: string; body: unknown };

type Rig = {
  assembled: Assembly;
  posted: Posted[];
  frames: unknown[];
  desired: DesiredApp;
  signer: Awaited<ReturnType<typeof createConnectionSigner>>;
  dir: string;
  issued: string[];
  stop(): Promise<void>;
};

async function rig(options: { stopGraceMs?: number } = {}): Promise<Rig> {
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
  const signer = await createConnectionSigner();
  const posted: Posted[] = [];
  const frames: unknown[] = [];
  const issued: string[] = [];
  // deno-lint-ignore prefer-const
  let assembled: Assembly;
  const fake = {
    async post(path: string, bearer: string, body: unknown) {
      posted.push({ path, bearer, body });
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
            signature: await signer.sign(connection),
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
    spawn: (launch) => spawnApp(launch),
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
        signature: await r.signer.sign(connection),
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
