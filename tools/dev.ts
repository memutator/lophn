// 실행: npm run dev, npm run dev:core, npm run dev:mock
//
// shell main(Electron)이 core를 띄우고 core가 고정 child(writer·reader·io)를 띄운다.
// 그래서 `npm run dev`는 shell main을 직접 띄우고,
// `npm run dev:core`는 core만 직접 띄운다. 둘 다 개발 데이터 root(저장소 안의
// .dev-data/)를 절대 경로로 만들어 LOPHN_HOME으로 넘긴다. 실제 ~/.lophn은 읽지도 쓰지도
// 않는다. LOPHN_DEV_HOME을 주면 그 root(eval이 남긴 world)를 열고 fake를 심지 않는다. tests/support/fake-server를 고정 port(기본 7499, LOPHN_DEV_FAKE_PORT)로 띄우고,
// 앱을 띄우기 전에 core를 pipe로 한 번 띄워 그 주소를 providers/connect로 연결해 둔 뒤
// 닫는다(shell main이 띄우는 core의 user token은 hello frame으로만 나오기 때문이다).
// 사람이 LOPHN_LIVE_PROVIDER=1을 두면 fake를 띄우지도 연결하지도 않는다.
// Ctrl+C와 SIGTERM에 띄운 프로세스를 정리한다.
//
// shell main은 renderer bundle(packages/shell/renderer/build.ts)을 읽는다. `dev`와 `dev:mock`은
// renderer와 shell main을 build한 뒤(옛 화면이 뜨지 않게) electron을 `npm run` 없이 바로 띄운다. `dev:mock`은 shell을 mock 주소(`?mock`)로 열어 renderer가 모든 화면을 메모리 가짜 데이터로
// 채운다. 그래서 fake를 띄우지 않고, 데이터 root는 매번 새로 만드는 .dev-data/mock이다. 터미널 탭만
// 진짜 PTY다. core가 mock project의 폴더를 모르므로 shell main이 데이터 root의 mock-terminal 폴더에서 연다.

import { type ChildProcess, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { normalize } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { devCliLauncher } from "../packages/base/install/linux-install.ts";
import { winDevCliLauncher } from "../packages/base/install/win-install.ts";
import { errorCode } from "../packages/base/mod.ts";
import { type ServeHandle, serve } from "../packages/core/server/serve.ts";
import { hookStdoutRows } from "../packages/protocol/coding-agent/mod.ts";
import { providerList } from "../packages/protocol/lophn-agent/mod.ts";
import { connectFakeProvider } from "../tests/support/core/human.ts";
import { bootCore } from "../tests/support/core/mod.ts";
import { createFakeHandler } from "../tests/support/fake-server/mod.ts";

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
// core는 Temporal을 쓰는데 기계의 node에는 없다. production과 같은 Electron의 Node로 띄운다.
const ELECTRON = createRequire(import.meta.url)("electron") as string;
// provider의 endpoint가 ledger에 남으므로 port가 실행마다 바뀌면 안 된다.
const DEFAULT_FAKE_PORT = 7499;

/**
 * 개발 데이터 root. 저장소 밖으로 가지 않는다: 항상 <root>/.dev-data.
 * core는 절대 경로가 아닌 LOPHN_HOME을 거절하므로 부르는 쪽이 절대 경로를 넣는다.
 */
function devDataRoot(root: string): string {
  return `${root}/.dev-data`;
}

// eval이 남긴 world(`npm run eval -- --keep`)를 데스크톱 앱으로 열 때 그 data root를 절대 경로로 준다.
const KEPT_HOME = "LOPHN_DEV_HOME";

/**
 * `dev`·`dev:core`가 여는 데이터 root. LOPHN_DEV_HOME이 있으면 그 root이고 없으면 <root>/.dev-data다.
 * 사람의 ~/.lophn과 그 아래는 받지 않는다.
 */
export function devHomeOf(
  root: string,
  env: Record<string, string | undefined>,
): { ok: true; path: string } | { ok: false; message: string } {
  const kept = env[KEPT_HOME];
  if (kept === undefined || kept === "") {
    return { ok: true, path: devDataRoot(root) };
  }
  const path = kept.replace(/\/+$/, "");
  if (!path.startsWith("/")) {
    return { ok: false, message: `${KEPT_HOME}는 절대 경로여야 한다` };
  }
  const real = env["HOME"] ? `${env["HOME"].replace(/\/+$/, "")}/.lophn` : "";
  if (real !== "" && (path === real || path.startsWith(`${real}/`))) {
    return {
      ok: false,
      message: `${KEPT_HOME}로 사람의 ~/.lophn을 열지 않는다`,
    };
  }
  return { ok: true, path };
}

/** mock 모드 데이터 root. 실행마다 비우고 새로 만든다. */
function mockDataRoot(root: string): string {
  return `${devDataRoot(root)}/mock`;
}

/** renderer bundle build 계획. shell main이 읽는 dist를 만든다. esbuild라 node로 바로 돈다. */
function planRendererBuild(root: string): SpawnPlan {
  return {
    command: "node",
    args: [`${root}/packages/shell/renderer/build.ts`],
    // dev build만 dev mock(`?mock`, dev seed)을 싣는다. 기본 build는 prod라 싣지 않는다.
    env: { LOPHN_RENDERER_DEV: "1" },
  };
}

/**
 * fake server를 고정 port로 띄운다. 늘 같은 짧은 대답을 낸다. 이미 쓰는 port면 이유를 말하고
 * 실패한다(사람이 한 번에 하나만 띄우는 개발 도구라 고정 port를 쓴다).
 */
async function startDevFake(portText: string | undefined) {
  const port =
    portText === undefined || portText === ""
      ? DEFAULT_FAKE_PORT
      : Number(portText);
  const fake = createFakeHandler({
    fallback: { kind: "text", text: "fake model: ok" },
  });
  let server: ServeHandle;
  try {
    server = await serve({ hostname: "127.0.0.1", port }, fake.handle);
  } catch (error) {
    if (errorCode(error) === "EADDRINUSE") {
      throw new Error(
        `port ${port}을 이미 쓰고 있다. 다른 npm run dev가 떠 있는지 보고, 다른 port는 ${FAKE_PORT}로 정한다`,
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
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  settings["lophn-agent.model.catalog_auto_update"] ??= false;
  await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 });

  const dir = `${dataRoot}/dev-setup`;
  await mkdir(`${dir}/user-home`, { recursive: true });
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
 * core spawn 계획. 시작 인자: `packages/core/main/daemon/main.ts [--port=<n>]`.
 * Electron binary를 ELECTRON_RUN_AS_NODE로 띄우고 LOPHN_HOME은 데이터 root다. Electron main이
 * 물려 준 pipe는 shell main이 연다. 터미널에서 직접 띄우므로 stdin은 터미널이고 core는 신호로만
 * 끝난다. 자식 process가 PATH의 npm을 찾으므로 PATH를 지우지 않는다.
 */
function planCore(
  root: string,
  options: { dataRoot: string; port?: number; env?: Record<string, string> },
): SpawnPlan {
  const args = [`${root}/packages/core/main/daemon/main.ts`];
  if (options.port !== undefined) args.push(`--port=${options.port}`);
  return {
    command: ELECTRON,
    args,
    env: {
      ...options.env,
      ELECTRON_RUN_AS_NODE: "1",
      [LOPHN_HOME]: options.dataRoot,
    },
  };
}

/**
 * 개발 실행의 `lophn` launcher를 쓰고 경로를 돌려준다. 전역 hook 설정(~/.claude/settings.json 등)에 이
 * 경로가 command로 남으므로 .dev-data(schema가 바뀌면 지운다)가 아니라 저장소의 .cache/에 둔다.
 * 실행마다 다시 쓰고 rename으로 바꿔, 돌고 있는 hook이 반쯤 쓴 file을 읽지 않는다.
 */
async function writeDevCli(root: string): Promise<string> {
  // 설치본과 같이 shell main이 도는 Electron binary를 Node로 쓴다.
  const electron = createRequire(import.meta.url)("electron") as string;
  const dir = `${root}/.cache/dev-cli`;
  const path = `${dir}/lophn`;
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${path}.tmp`,
    devCliLauncher({ electron, platform: root }, hookStdoutRows()),
    { mode: 0o755 },
  );
  await rename(`${path}.tmp`, path);
  // Windows의 cmd·PowerShell 터미널과 harness 감지(execFile)는 sh launcher를 못 돌린다. 같은 폴더에 .cmd를 같이 두고
  // shell main에는 그 경로를 준다. Git Bash 터미널은 확장자 없는 sh launcher를 쓴다.
  if (process.platform !== "win32") return path;
  const cmd = `${path}.cmd`;
  await writeFile(
    `${cmd}.tmp`,
    winDevCliLauncher({ electron, platform: normalize(root) }),
  );
  await rename(`${cmd}.tmp`, cmd);
  return cmd;
}

/** shell main bundle build 계획. */
function planShellBuild(root: string): SpawnPlan {
  return {
    command: "node",
    args: [`${root}/packages/shell/main/build.ts`],
    env: {},
  };
}

/**
 * `npm run dev`의 shell main spawn 계획. `npm run`을 거치지 않고 electron을 바로 띄운다.
 * npm이 넣는 `npm_*` 변수와 `node_modules/.bin` PATH가 terminal 탭의 shell까지 물려 내려가
 * nvm 같은 도구가 경고하기 때문이다.
 */
function planShell(
  root: string,
  options: { dataRoot: string; env?: Record<string, string> },
): SpawnPlan {
  const main = `${root}/packages/shell/main`;
  const extra =
    process.argv.includes("--no-sandbox") ||
    process.env.ELECTRON_NO_SANDBOX === "1"
      ? ["--no-sandbox"]
      : [];
  return {
    // Windows의 `.bin/electron`은 .cmd shim이라 shell 없이 못 띄운다. Electron binary를 바로 띄운다.
    command:
      process.platform === "win32"
        ? ELECTRON
        : `${root}/node_modules/.bin/electron`,
    args: [...extra, `${main}/dist/main.cjs`, "--home", options.dataRoot],
    // LOPHN_HOME은 --home이 정하므로 여기서는 넣지 않는다.
    env: { ...options.env },
  };
}

/** Ctrl+C·SIGTERM이 이 프로세스에 도착하면 된다. Windows는 SIGBREAK다. */
function signalNames(os: string = process.platform): NodeJS.Signals[] {
  return os === "win32" ? ["SIGBREAK"] : ["SIGINT", "SIGTERM"];
}

// node child에는 기다릴 수 있는 status가 없어 close를 Promise로 감싼다. stdio가 inherit이라
// close는 프로세스가 끝나면 온다.
function exitStatus(child: ChildProcess): Promise<{ success: boolean }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ success: code === 0 }));
  });
}

/**
 * 띄운 프로세스의 수명. add로 추적하고 stop으로 모두 끝낸다. detached로 띄우지 않으므로
 * SIGTERM이 프로세스 tree보다 좁지만 shell main은 SIGTERM를 받으면 끝나고,
 * core는 shell main의 자식이라 같이 끝난다. 이미 끝난 child의 kill은 건너뛴다.
 */
class ProcessGroup {
  readonly #children: Set<ChildProcess> = new Set();

  add(child: ChildProcess): void {
    this.#children.add(child);
    void exitStatus(child)
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
  spawn?: (plan: SpawnPlan, purpose: Purpose) => ChildProcess;
  /** 테스트가 신호를 붙이지 않을 때 끈다. */
  signals?: boolean;
};

/**
 * data root를 지운다. 없으면 조용히 지나간다.
 */
export async function removeDataRoot(dataRoot: string): Promise<void> {
  // core가 깐 sdk 사본이 읽기 전용(폴더 0555)이라 쓰기 권한을 먼저 돌려준다.
  async function open(directory: string): Promise<void> {
    await chmod(directory, 0o755);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(dataRoot);
    await rm(dataRoot, { recursive: true });
  } catch {
    // 없는 root(첫 실행)다.
  }
}

/**
 * `npm run dev`와 `npm run dev:core`의 진행 순서다.
 *
 * 데이터 root(저장소 밖으로 가지 않는다. 예외는 LOPHN_DEV_HOME)를 만들고(0700) → fake server를 고정 port로 띄워
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

/** process.env 복사본. 값이 없는 key는 뺀다. */
function envObject(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function launch(
  mode: Mode,
  options: DevOptions,
  closers: (() => Promise<void>)[],
): Promise<{ ok: true } | { ok: false }> {
  const parentEnv = { ...envObject(), ...options.env };
  const home = devHomeOf(options.root, parentEnv);
  if (!home.ok) {
    console.error(`npm run ${mode}: ${home.message}`);
    return { ok: false };
  }
  const kept = mode !== "dev:mock" && home.path !== devDataRoot(options.root);
  const dataRoot = mode === "dev:mock" ? mockDataRoot(options.root) : home.path;
  const group = new ProcessGroup();
  const spawn = options.spawn ?? defaultSpawn;

  if (options.signals !== false) {
    const stop = () => {
      group.stop();
      process.exit(0);
    };
    for (const name of signalNames()) {
      process.on(name, stop);
    }
  }

  try {
    // mock 모드는 이전 실행의 core 상태를 이어받지 않는다.
    if (mode === "dev:mock") {
      await removeDataRoot(dataRoot);
    }
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    // 다른 도구가 `mkdir -p .dev-data/<하위>`로 먼저 만들면 775로 남는다. core는 0700이 아니면 뜨지 않는다.
    await chmod(dataRoot, 0o700);
  } catch (error) {
    console.error(
      `npm run ${mode}: 개발 데이터 root를 만들지 못했다: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return { ok: false };
  }

  // 남긴 eval world는 그 run의 provider를 그대로 쓴다. fake를 심으면 world가 바뀐다.
  if (mode !== "dev:mock" && !kept && parentEnv[LIVE] !== "1") {
    try {
      const fake = await startDevFake(parentEnv[FAKE_PORT]);
      closers.push(fake.close);
      await plantFakeProvider(dataRoot, fake.url);
    } catch (error) {
      console.error(
        `npm run ${mode}: fake provider를 붙이지 못했다: ${
          error instanceof Error ? error.message : error
        }`,
      );
      group.stop();
      return { ok: false };
    }
  }

  if (mode === "dev" || mode === "dev:mock") {
    if (!(await hasFile(`${options.root}/packages/shell/main/package.json`))) {
      console.error(
        `npm run ${mode}: packages/shell/main이 없다. shell main이 core를 띄우므로 shell 없이는 ${mode}를 띄울 수 없다. core만 필요하면 npm run dev:core를 쓴다.`,
      );
      group.stop();
      return { ok: false };
    }
    for (const [plan, what] of [
      [planRendererBuild(options.root), "renderer"],
      [planShellBuild(options.root), "shell main"],
    ] as const) {
      const built = spawn(plan, "build");
      group.add(built);
      if (!(await exitStatus(built)).success) {
        console.error(
          `npm run ${mode}: ${what} build가 실패했다. 옛 화면을 띄우지 않는다.`,
        );
        group.stop();
        return { ok: false };
      }
    }
    const shellEnv = { ...parentEnv };
    if (mode === "dev:mock") shellEnv.LOPHN_DEV_MOCK = "1";
    // 이 dev 프로세스에는 LOPHN_HOME이 core를 거르는 일이 없다. shell main에도
    // 같은 root를 넣어 두 값이 갈라지지 않게 한다.
    shellEnv[LOPHN_HOME] = dataRoot;
    // shell main은 이 경로로 harness 감지·hook 설치를 하고, 설치된 hook command가 된다.
    shellEnv["LOPHN_CLI"] = await writeDevCli(options.root);
    const child = spawn(
      planShell(options.root, { dataRoot, env: shellEnv }),
      "shell",
    );
    group.add(child);
    await exitStatus(child);
    return { ok: true };
  }

  // dev:core는 인자의 --port=<n>을 그대로 core에 흘려 보낸다.
  const portArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--port="));
  const port = portArg === undefined ? undefined : Number(portArg.slice(7));
  const child = spawn(
    planCore(options.root, { dataRoot, port, env: parentEnv }),
    "core",
  );
  group.add(child);
  await exitStatus(child);
  return { ok: true };
}

function defaultSpawn(plan: SpawnPlan, _purpose: Purpose): ChildProcess {
  return spawn(plan.command, [...plan.args], {
    env: { ...process.env, ...plan.env },
    stdio: "inherit",
  });
}

async function hasFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "실행: node tools/dev.ts [dev|dev:core|dev:mock] [--port=<n>]\n" +
        "  dev: shell과 core를 띄운다\n" +
        "  dev:core: core만 띄운다\n" +
        "  dev:mock: 가짜 데이터로 shell을 띄운다",
    );
    process.exit(0);
  }
  // tools/의 부모가 저장소 루트다.
  const root = fileURLToPath(new URL("..", import.meta.url)).replace(
    /[\\/]$/,
    "",
  );
  const mode: Mode = args.includes("dev:core")
    ? "dev:core"
    : args.includes("dev:mock")
      ? "dev:mock"
      : "dev";
  const run = await runDev(mode, { root });
  if (!run.ok) process.exit(1);
}
