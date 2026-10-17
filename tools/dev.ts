// 실행: deno task dev, deno task dev:core, deno task dev:mock
//
// shell main(Electron)이 core를 띄우고 core가 고정 child(writer·reader·io)를 띄운다.
// 그래서 `deno task dev`는 shell main을 직접 띄우고,
// `deno task dev:core`는 core만 직접 띄운다. 둘 다 개발 데이터 root(저장소 안의
// .dev-data/)를 절대 경로로 만들어 LOPHN_HOME으로 넘긴다. 실제 ~/.lophn은 읽지도 쓰지도
// 않는다. tests/support/fake-server를 고정 port(기본 7499, LOPHN_DEV_FAKE_PORT)로 띄우고,
// 앱을 띄우기 전에 core를 pipe로 한 번 띄워 그 주소를 providers/connect로 연결해 둔 뒤
// 닫는다(shell main이 띄우는 core의 user token은 hello frame으로만 나오기 때문이다).
// 사람이 LOPHN_LIVE_PROVIDER=1을 두면 fake를 띄우지도 연결하지도 않는다.
// Ctrl+C와 SIGTERM에 띄운 프로세스를 정리한다.
//
// shell main은 renderer bundle(packages/shell/renderer/build.ts)을 읽는다. `npm run dev`는 main만
// build하므로 `dev`와 `dev:mock`은 shell을 띄우기 전에 renderer를 먼저 build한다(옛 화면이 뜨지
// 않게). `dev:mock`은 shell을 mock 주소(`?mock`)로 열어 renderer가 모든 화면을 메모리 가짜 데이터로
// 채운다. 그래서 fake를 띄우지 않고, 데이터 root는 매번 새로 만드는 .dev-data/mock이다. 터미널 탭만
// 진짜 PTY다. core가 mock project의 폴더를 모르므로 shell main이 데이터 root의 mock-terminal 폴더에서 연다.

import { providerList } from "../packages/protocol/lophn-agent/mod.ts";
import { createFakeHandler } from "../tests/support/fake-server/mod.ts";
import { bootCore } from "../tests/support/core/mod.ts";
import { connectFakeProvider } from "../tests/support/core/human.ts";

type SpawnPlan = {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
};

type Mode = "dev" | "dev:core" | "dev:mock";

/** 띄우는 대상. */
type Purpose = "core" | "shell" | "build";

const LOPHN_HOME = "LOPHN_HOME";
const LIVE = "LOPHN_LIVE_PROVIDER";
const FAKE_PORT = "LOPHN_DEV_FAKE_PORT";
// provider의 endpoint가 ledger에 남으므로 port가 실행마다 바뀌면 안 된다.
const DEFAULT_FAKE_PORT = 7499;

/**
 * 개발 데이터 root. 저장소 밖으로 가지 않는다: 항상 <root>/.dev-data.
 * core는 절대 경로가 아닌 LOPHN_HOME을 거절하므로 부르는 쪽이 절대 경로를 넣는다.
 */
function devDataRoot(root: string): string {
  return `${root}/.dev-data`;
}

/** mock 모드 데이터 root. 실행마다 비우고 새로 만든다. */
function mockDataRoot(root: string): string {
  return `${devDataRoot(root)}/mock`;
}

/** renderer bundle build 계획. shell main이 읽는 dist를 만든다. */
function planRendererBuild(root: string): SpawnPlan {
  return {
    command: Deno.execPath(),
    args: ["run", "--allow-all", `${root}/packages/shell/renderer/build.ts`],
    env: {},
  };
}

/**
 * fake server를 고정 port로 띄운다. 늘 같은 짧은 대답을 낸다. 이미 쓰는 port면 이유를 말하고
 * 실패한다(사람이 한 번에 하나만 띄우는 개발 도구라 고정 port를 쓴다).
 */
function startDevFake(portText: string | undefined) {
  const port = portText === undefined || portText === ""
    ? DEFAULT_FAKE_PORT
    : Number(portText);
  const fake = createFakeHandler({
    fallback: { kind: "text", text: "fake model: ok" },
  });
  let server: Deno.HttpServer;
  try {
    server = Deno.serve(
      { hostname: "127.0.0.1", port, onListen() {} },
      fake.handle,
    );
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      throw new Error(
        `port ${port}을 이미 쓰고 있다. 다른 deno task dev가 떠 있는지 보고, 다른 port는 ${FAKE_PORT}로 정한다`,
      );
    }
    throw error;
  }
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      fake.release();
      await server.shutdown();
    },
  };
}

/**
 * 앱을 띄우기 전에 core를 pipe로 한 번 띄워 fake를 provider로 연결해 두고 닫는다. 연결은
 * ledger에 남으므로 뒤에 뜨는 core가 시작할 때부터 쓴다. 이미 연결돼 있으면 그대로 둔다.
 */
async function plantFakeProvider(
  dataRoot: string,
  fakeUrl: string,
): Promise<void> {
  // 선언 안 된 key가 있으면 file 전체가 거절되므로 있는 JSON에 key만 더한다. bootCore는
  // 이미 있는 settings.json을 건드리지 않는다.
  const settingsPath = `${dataRoot}/settings.json`;
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await Deno.readTextFile(settingsPath));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  settings["lophn-agent.model.catalog_auto_update"] ??= false;
  await Deno.writeTextFile(settingsPath, JSON.stringify(settings), {
    create: true,
    mode: 0o600,
  });

  const dir = `${dataRoot}/dev-setup`;
  await Deno.mkdir(`${dir}/user-home`, { recursive: true });
  const core = await bootCore({
    dir,
    home: dataRoot,
    work: dir,
    remove: () => Promise.resolve(),
  });
  try {
    const known = (await core.call(providerList, {})).providers;
    if (!known.some((item) => item.endpoint === fakeUrl)) {
      await connectFakeProvider(core, { url: fakeUrl });
    }
  } catch (error) {
    await core.kill().catch(() => {});
    throw error;
  }
  await core.stop();
}

/**
 * core spawn 계획. 시작 인자: `deno run <권한> packages/core/main/daemon/main.ts
 * [--port=<n>]`, LOPHN_HOME은 데이터 root다. Electron main이 물려 준 pipe는 shell main이
 * 연다. 터미널에서 직접 띄우므로 stdin은 터미널이고 core는 신호로만 끝난다.
 */
function planCore(
  root: string,
  options: { dataRoot: string; port?: number; env?: Record<string, string> },
): SpawnPlan {
  const args = [
    "run",
    "--allow-all",
    `${root}/packages/core/main/daemon/main.ts`,
  ];
  if (options.port !== undefined) args.push(`--port=${options.port}`);
  return {
    command: Deno.execPath(),
    args,
    env: { ...options.env, [LOPHN_HOME]: options.dataRoot },
  };
}

/** `deno task dev`의 shell main spawn 계획. */
function planShell(
  root: string,
  options: { dataRoot: string; env?: Record<string, string> },
): SpawnPlan {
  return {
    command: "npm",
    args: [
      "--prefix",
      `${root}/packages/shell/main`,
      "run",
      "dev",
      "--",
      "--home",
      options.dataRoot,
    ],
    // LOPHN_HOME은 --home이 정하므로 여기서는 넣지 않는다.
    env: { ...options.env },
  };
}

/** Ctrl+C·SIGTERM이 이 프로세스에 도착하면 된다. Windows는 SIGBREAK다. */
function signalNames(os: string = Deno.build.os): Deno.Signal[] {
  return os === "windows" ? ["SIGBREAK"] : ["SIGINT", "SIGTERM"];
}

/**
 * 띄운 프로세스의 수명. add로 추적하고 stop으로 모두 끝낸다. detached로 띄우지 않으므로
 * SIGTERM이 프로세스 tree보다 좁지만 shell main은 SIGTERM를 받으면 끝나고,
 * core는 shell main의 자식이라 같이 끝난다. 이미 끝난 child의 kill은 건너뛴다.
 */
class ProcessGroup {
  readonly #children: Set<Deno.ChildProcess> = new Set();

  add(child: Deno.ChildProcess): void {
    this.#children.add(child);
    void child.status
      .then(() => this.#children.delete(child))
      .catch(() => this.#children.delete(child));
  }

  /** 띄운 것을 모두 끝낸다. 순서는 상관없다. */
  stop(): void {
    for (const child of this.#children) {
      try {
        child.kill("SIGTERM");
      } catch {
        // 이미 끝났다.
      }
    }
    this.#children.clear();
  }

  get size(): number {
    return this.#children.size;
  }
}

type DevOptions = {
  /** 저장소 루트. 개발 데이터 root는 이 안이다. */
  root: string;
  /** 사람의 env 위에 더할 값. */
  env?: Record<string, string>;
  /** 테스트가 명령을 흉내 낼 때 끼운다. 없으면 실제 프로세스를 띄운다. */
  spawn?: (plan: SpawnPlan, purpose: Purpose) => Deno.ChildProcess;
  /** 테스트가 신호를 붙이지 않을 때 끈다. */
  signals?: boolean;
};

/**
 * data root를 지운다. 없으면 조용히 지나간다.
 */
export async function removeDataRoot(dataRoot: string): Promise<void> {
  // core가 깐 sdk 사본이 읽기 전용(폴더 0555)이라 쓰기 권한을 먼저 돌려준다.
  async function open(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(dataRoot);
    await Deno.remove(dataRoot, { recursive: true });
  } catch {
    // 없는 root(첫 실행)다.
  }
}

/**
 * `deno task dev`와 `deno task dev:core`의 진행 순서다.
 *
 * 데이터 root(저장소 밖으로 가지 않는다)를 만들고(0700) → fake server를 고정 port로 띄워
 * (필요할 때만) core에 provider로 연결해 두고 → `dev`는 shell main을, `dev:core`는 core를
 * 띄운다. shell이 없는데 `dev`를 부르면 이유를 말하고 실패로 끝난다. Ctrl+C·SIGTERM에
 * 띄운 것을 모두 끝낸다.
 */
async function runDev(
  mode: Mode,
  options: DevOptions,
): Promise<{ ok: true } | { ok: false }> {
  const closers: (() => Promise<void>)[] = [];
  try {
    return await launch(mode, options, closers);
  } finally {
    for (const close of closers) await close();
  }
}

async function launch(
  mode: Mode,
  options: DevOptions,
  closers: (() => Promise<void>)[],
): Promise<{ ok: true } | { ok: false }> {
  const dataRoot = mode === "dev:mock"
    ? mockDataRoot(options.root)
    : devDataRoot(options.root);
  const group = new ProcessGroup();
  const spawn = options.spawn ?? defaultSpawn;

  if (options.signals !== false) {
    const stop = () => {
      group.stop();
      Deno.exit(0);
    };
    for (const name of signalNames()) {
      try {
        Deno.addSignalListener(name, stop);
      } catch {
        // 이 신호를 지원하지 않는 플랫폼이다.
      }
    }
  }

  try {
    // mock 모드는 이전 실행의 core 상태를 이어받지 않는다.
    if (mode === "dev:mock") {
      await removeDataRoot(dataRoot);
    }
    await Deno.mkdir(dataRoot, { recursive: true, mode: 0o700 });
  } catch (error) {
    console.error(
      `deno task ${mode}: 개발 데이터 root를 만들지 못했다: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return { ok: false };
  }

  const parentEnv = { ...Deno.env.toObject(), ...options.env };
  if (mode !== "dev:mock" && parentEnv[LIVE] !== "1") {
    try {
      const fake = startDevFake(parentEnv[FAKE_PORT]);
      closers.push(fake.close);
      await plantFakeProvider(dataRoot, fake.url);
    } catch (error) {
      console.error(
        `deno task ${mode}: fake provider를 붙이지 못했다: ${
          error instanceof Error ? error.message : error
        }`,
      );
      group.stop();
      return { ok: false };
    }
  }

  if (mode === "dev" || mode === "dev:mock") {
    if (!await hasFile(`${options.root}/packages/shell/main/package.json`)) {
      console.error(
        `deno task ${mode}: packages/shell/main이 없다. shell main이 core를 띄우므로 shell 없이는 ${mode}를 띄울 수 없다. core만 필요하면 deno task dev:core를 쓴다.`,
      );
      group.stop();
      return { ok: false };
    }
    const built = spawn(planRendererBuild(options.root), "build");
    group.add(built);
    if (!(await built.status).success) {
      console.error(
        `deno task ${mode}: renderer build가 실패했다. 옛 화면을 띄우지 않는다.`,
      );
      group.stop();
      return { ok: false };
    }
    const shellEnv = { ...parentEnv };
    if (mode === "dev:mock") shellEnv.LOPHN_DEV_MOCK = "1";
    // 이 dev 프로세스에는 LOPHN_HOME이 core를 거르는 역할이 없다. shell main에도
    // 같은 root를 넣어 두 값이 갈라지지 않게 한다.
    shellEnv[LOPHN_HOME] = dataRoot;
    const child = spawn(
      planShell(options.root, { dataRoot, env: shellEnv }),
      "shell",
    );
    group.add(child);
    await child.status;
    return { ok: true };
  }

  // dev:core는 인자의 --port=<n>을 그대로 core에 흘려 보낸다.
  const portArg = Deno.args.find((arg) => arg.startsWith("--port="));
  const port = portArg === undefined ? undefined : Number(portArg.slice(7));
  const child = spawn(
    planCore(options.root, { dataRoot, port, env: parentEnv }),
    "core",
  );
  group.add(child);
  await child.status;
  return { ok: true };
}

function defaultSpawn(plan: SpawnPlan, _purpose: Purpose): Deno.ChildProcess {
  const child = new Deno.Command(plan.command, {
    args: [...plan.args],
    env: plan.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  return child;
}

async function hasFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  // tools/의 부모가 저장소 루트다.
  const root = new URL("..", new URL("./", import.meta.url)).pathname
    .replace(/\/$/, "");
  const mode: Mode = Deno.args.includes("dev:core")
    ? "dev:core"
    : Deno.args.includes("dev:mock")
    ? "dev:mock"
    : "dev";
  const run = await runDev(mode, { root });
  if (!run.ok) Deno.exit(1);
}
