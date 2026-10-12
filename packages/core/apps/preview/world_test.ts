// 시험 전용: 실제 앱 자식 프로세스를 launcher로 띄우는 준비. mod.ts에서 내보내지 않는다.
// 앱 진입 파일·blueprint·import map은 temp 폴더에 쓰고, 자식은 운영 앱과 같은 Deno flag 계산
// (`appFlags` + supervisor가 더하는 socket flag)으로 뜬다. 서명 key는 시험이 만든 Ed25519 key이고
// core·keychain·네트워크·사람 데이터 root는 열지 않는다.
import { manualClock, systemClock } from "../../../base/mod.ts";
import type { AppConnection } from "../../../protocol/apps/mod.ts";
import { appFlags, type FlagSet, socketFlags } from "../permissions/mod.ts";
import {
  appArgv,
  type AppChild,
  appEnv,
  type CoreSigner,
  createCoreSigner,
  type PreviewLaunch,
} from "../runtime/mod.ts";
import {
  FIXTURE_APP,
  FIXTURE_RELEASE,
  fixtureBlueprint,
  writeFixtureBundle,
} from "../runtime/testing/mod.ts";
import {
  createPreviewLauncher,
  type PreviewLauncher,
  type PreviewLauncherDeps,
  type PreviewSpawnRequest,
} from "./mod.ts";

export { FIXTURE_APP, FIXTURE_RELEASE, fixtureBlueprint };

export const LIVE_DATA = "LIVE-DATA-MUST-STAY";

export type PreviewWorld = {
  root: string;
  signer: CoreSigner;
  launcher: PreviewLauncher;
  spawns: PreviewSpawnRequest[];
  // 자식 stdout·stderr(nonce별).
  output(nonce: string): string;
  // 운영 앱의 data 파일. preview가 읽거나 쓰지 못해야 하는 값이다.
  liveData: string;
  // bundle과 disposable 영역을 만들고 시작 입력을 돌려준다.
  launch(
    options?: {
      app?: string;
      release?: string | null;
      blueprint?: Record<string, unknown>;
      nonce?: string;
    },
  ): Promise<PreviewLaunch>;
  connection(
    launch: PreviewLaunch,
    overrides?: Partial<AppConnection>,
  ): Promise<string>;
  call(
    launch: PreviewLaunch,
    method: "GET" | "POST",
    path: string,
    authorization: string | null,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
};

export async function directCall(
  endpoint: string,
  method: "GET" | "POST",
  path: string,
  authorization: string | null,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: endpoint },
  });
  try {
    const response = await fetch(`http://lophn.invalid${path}`, {
      client,
      method,
      headers: {
        ...(authorization === null ? {} : { authorization }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json = response.headers.get("content-type")?.includes("json");
    return {
      status: response.status,
      body: text.length === 0 ? null : json ? JSON.parse(text) : text,
    };
  } finally {
    client.close();
  }
}

export function environmentOfTest() {
  return {
    ...(Deno.env.get("HOME") ? { home: Deno.env.get("HOME")! } : {}),
    ...(Deno.env.get("PATH") ? { path: Deno.env.get("PATH")! } : {}),
    ...(Deno.env.get("DENO_DIR") ? { denoDir: Deno.env.get("DENO_DIR")! } : {}),
  };
}

export type FakeChild = AppChild & {
  killed: boolean;
  exit(code: number | null): void;
};

// 프로세스 없이 수명만 흉내 내는 자식이다. terminate 결과와 종료 시점을 시험이 정한다.
export function fakeChild(
  request: PreviewSpawnRequest,
  options: { confirm?: boolean } = {},
): FakeChild {
  let resolve!: (code: number | null) => void;
  const exited = new Promise<number | null>((done) => {
    resolve = done;
  });
  const child: FakeChild = {
    identity: {
      pid: 4242,
      startedAtMs: request.identity.startedAtMs,
      processNonce: request.nonce,
    },
    exited,
    killed: false,
    terminate() {
      if (options.confirm === false) return Promise.resolve(false);
      child.killed = true;
      resolve(null);
      return Promise.resolve(true);
    },
    exit(code) {
      resolve(code);
    },
  };
  return child;
}

// 시계와 대기를 즉시로 바꾼 launcher 의존. 프로세스는 만들지 않는다.
export function fakeDeps(
  overrides: Partial<PreviewLauncherDeps> = {},
): { deps: PreviewLauncherDeps; spawns: PreviewSpawnRequest[] } {
  const spawns: PreviewSpawnRequest[] = [];
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const deps: PreviewLauncherDeps = {
    clock,
    deno: () => "deno",
    environment: {},
    socketPaths: (app) => ({
      broker: `/tmp/${app}-b.sock`,
      direct: `/tmp/${app}-a.sock`,
    }),
    credential: () => "local-credential",
    verifyKey: () => "A".repeat(43),
    spawn(request) {
      spawns.push(request);
      return Promise.resolve(fakeChild(request));
    },
    probe: (_child, _direct, launch) => ({
      ok: true,
      commands: [...launch.commands],
      dataSchema: launch.dataSchema,
      bundleHash: launch.bundleHash,
    }),
    open: () => Promise.resolve(true),
    wait: () => Promise.resolve(),
    ...overrides,
  };
  return { deps, spawns };
}

let counter = 0;

export async function openPreviewWorld(
  options: { readyTimeoutMs?: number } = {},
): Promise<PreviewWorld> {
  const root = await Deno.makeTempDir({ prefix: "lop-pv-" });
  const signer = await createCoreSigner();
  const spawns: PreviewSpawnRequest[] = [];
  const outputs = new Map<string, string>();
  const children = new Set<AppChild>();
  const bundles = new Map<string, string>();
  const liveApp = `${root}/live`;
  await Deno.mkdir(liveApp, { recursive: true });
  const liveData = `${liveApp}/app.sqlite`;
  await Deno.writeTextFile(liveData, LIVE_DATA);

  const socketsOf = (app: string) => ({
    broker: `${root}/b-${app.slice(-6)}.sock`,
    direct: `${root}/a-${app.slice(-6)}.sock`,
  });
  const world: PreviewWorld = {
    root,
    signer,
    spawns,
    liveData,
    output: (nonce) => outputs.get(nonce) ?? "",
    launcher: undefined as unknown as PreviewLauncher,
    async launch(launchOptions = {}) {
      counter += 1;
      const app = launchOptions.app ?? FIXTURE_APP;
      const nonce = launchOptions.nonce ??
        `nonce-${counter}-${crypto.randomUUID().slice(0, 8)}`;
      const bundleDir = `${root}/bundle-${counter}`;
      await Deno.mkdir(bundleDir);
      const written = await writeFixtureBundle(
        bundleDir,
        launchOptions.blueprint ?? fixtureBlueprint(),
      );
      const dataPath = `${root}/apps/${app}/preview/${nonce}`;
      await Deno.mkdir(dataPath, { recursive: true });
      const flags = appFlags(
        [],
        { bundle: bundleDir, data: dataPath },
        { ports: [] },
        [],
      );
      if (!flags.ok) throw new Error(flags.error.message);
      bundles.set(nonce, bundleDir);
      const blueprint = launchOptions.blueprint ?? fixtureBlueprint();
      const commands = (blueprint["commands"] as { key: string }[]).map((c) =>
        c.key
      );
      return {
        app,
        nonce,
        release: launchOptions.release === undefined
          ? null
          : launchOptions.release,
        bundleHash: written.bundleHash,
        commands,
        screens: { usage: ["full", "panel"] },
        dataSchema: 0,
        flags: { args: [...flags.value.args], limits: [...flags.value.limits] },
        entry: written.entry,
        importMap: written.importMap,
        dataPath,
      };
    },
    async connection(launch, overrides = {}) {
      const payload: AppConnection = {
        app: launch.app,
        release: launch.release,
        bundle_hash: launch.bundleHash,
        mode: "preview",
        process_nonce: launch.nonce,
        actor: "user",
        credential_ref: "cred-1",
        screens: ["usage"],
        screen_sizes: { usage: ["full", "panel"] },
        caller: null,
        commands: launch.commands,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      } as AppConnection;
      return JSON.stringify(await signer.signConnection(payload));
    },
    // 자식이 끝나도 같은 socket 자리로 부른다. 끝난 preview는 연결이 거절된다.
    call: (launch, method, path, authorization, body) =>
      directCall(
        socketsOf(launch.app).direct,
        method,
        path,
        authorization,
        body,
      ),
    async close() {
      await world.launcher.stopAll();
      for (const child of children) await child.terminate();
      await Deno.remove(root, { recursive: true }).catch(() => undefined);
    },
  };

  const spawnReal = async (request: PreviewSpawnRequest) => {
    spawns.push(request);
    // 이전 자식이 남긴 socket 파일은 종료 확인 뒤에 지운다(apps/app-supervisor/main.ts와 같다).
    for (const path of Object.values(request.sockets)) {
      await Deno.remove(path).catch(() => undefined);
    }
    const sockets = socketFlags(request.sockets);
    if (!sockets.ok) throw new Error(sockets.error.message);
    const flags: FlagSet = {
      ...request.flags,
      args: [...request.flags.args, ...sockets.value],
    };
    const process = new Deno.Command(request.deno, {
      args: appArgv({
        deno: request.deno,
        entry: request.entry,
        flags,
        importMap: request.importMap,
        environment: request.environment,
        startLine: request.startLine,
      }),
      clearEnv: true,
      env: appEnv(request.environment),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const decoder = new TextDecoder();
    const collect = async (stream: ReadableStream<Uint8Array>) => {
      for await (const chunk of stream) {
        outputs.set(
          request.nonce,
          (outputs.get(request.nonce) ?? "") + decoder.decode(chunk),
        );
      }
    };
    const reading = Promise.all([
      collect(process.stdout),
      collect(process.stderr),
    ]);
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(`${request.startLine}\n`));
    await writer.close();
    const status = process.status;
    const child: AppChild = {
      identity: {
        pid: process.pid,
        startedAtMs: request.identity.startedAtMs,
        processNonce: request.nonce,
      },
      exited: status.then((s) => s.code),
      async terminate() {
        try {
          process.kill("SIGKILL");
        } catch { /* 이미 끝났다 */ }
        await status;
        await reading.catch(() => undefined);
        return true;
      },
    };
    children.add(child);
    return child;
  };

  // 제어 경로(probe·open·close·shutdown)는 machine connection으로 부른다.
  async function control(
    launch: PreviewLaunch,
    direct: string,
    path: string,
    body: unknown,
  ) {
    const authorization = await world.connection(launch, {
      actor: "machine",
      screens: ["control"],
      screen_sizes: {},
      commands: [],
    });
    try {
      return await directCall(direct, "POST", path, authorization, body);
    } catch {
      return { status: 503, body: null };
    }
  }

  world.launcher = createPreviewLauncher({
    clock: systemClock,
    deno: () => Deno.execPath(),
    environment: environmentOfTest(),
    socketPaths: socketsOf,
    credential: () => "local-preview-credential",
    verifyKey: () => signer.verifyKey,
    spawn: spawnReal,
    async probe(child, direct, launch) {
      let exited = false;
      void child.exited.then(() => {
        exited = true;
      });
      for (let attempt = 0; attempt < 400; attempt++) {
        if (exited) return { ok: false, reason: "exited before ready" };
        const answered = await control(
          launch,
          direct,
          "/_lophn/control/probe",
          { process_nonce: launch.nonce },
        );
        if (answered.status === 200) {
          const body = answered.body as {
            commands: string[];
            data_schema: number;
            bundle_hash: string;
          };
          return {
            ok: true,
            commands: body.commands,
            dataSchema: body.data_schema,
            bundleHash: body.bundle_hash,
          };
        }
        if (answered.status !== 503) {
          return { ok: false, reason: `rejected ${answered.status}` };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { ok: false, reason: "timeout" };
    },
    async open(child, direct, launch) {
      const answered = await control(launch, direct, "/_lophn/control/open", {
        process_nonce: child.identity.processNonce,
        release: launch.release,
      });
      return answered.status === 200;
    },
    async requestStop(child, direct, launch) {
      await control(launch, direct, "/_lophn/control/close", {
        process_nonce: child.identity.processNonce,
        reason: "stop",
      });
      await control(launch, direct, "/_lophn/control/shutdown", {
        process_nonce: child.identity.processNonce,
        grace_ms: 1000,
      });
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readyTimeoutMs: options.readyTimeoutMs ?? 20_000,
    stopGraceMs: 2_000,
  });
  return world;
}

// 준비될 때까지 기다린다.
export async function untilReady(
  world: PreviewWorld,
  launch: PreviewLaunch,
): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt++) {
    const seen = world.launcher.observation(launch.app, launch.nonce);
    if (seen?.ready && seen.accepting) return;
    if (seen?.reason && seen.reason.code !== "starting") {
      throw new Error(`preview did not start: ${JSON.stringify(seen.reason)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("preview never became ready");
}
