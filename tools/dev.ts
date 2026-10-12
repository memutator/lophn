// docs/dev/stack.md "개발 환경", docs/plan/contracts.md의 `deno task dev`.
// 실행: deno task dev, deno task dev:core, deno task dev:mock
//
// shell main(Electron)이 core를 띄우고 core가 고정 child(writer·reader·io)를 띄운다.
// 그래서 `deno task dev`는 shell main을 직접 띄우고,
// `deno task dev:core`는 core만 직접 띄운다. 둘 다 개발 데이터 root(저장소 안의
// .dev-data/)를 절대 경로로 만들어 LOPHN_HOME으로 넘긴다. 실제 ~/.lophn은 읽지도 쓰지도
// 않는다. tools/fake-provider를 함께 띄워 그 loopback 주소를 LOPHN_FAKE_PROVIDER_URL로
// core에 넘긴다(그 값으로 개발 provider를 seed하는 일은 lophn-agent가 한다). 사람이
// LOPHN_LIVE_PROVIDER=1을 두면 fake provider를 띄우지 않는다. Ctrl+C와 SIGTERM에 띄운
// 프로세스를 정리한다.
//
// shell main은 renderer bundle(packages/shell/renderer/build.ts)을 읽는다. `npm run dev`는 main만
// build하므로 `dev`와 `dev:mock`은 shell을 띄우기 전에 renderer를 먼저 build한다(옛 화면이 뜨지
// 않게). `dev:mock`은 shell을 mock 주소(`?mock`)로 열어 renderer가 모든 화면을 메모리 가짜 데이터로
// 채운다. 그래서 fake provider를 띄우지 않고, 데이터 root는 매번 새로 만드는 .dev-data/mock이다.

export type SpawnPlan = {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
};

export type Mode = "dev" | "dev:core" | "dev:mock";

/** 띄우는 대상. fake provider는 stdout을 읽어 ready를 기다린다. */
export type Purpose = "fake" | "core" | "shell" | "build";

/** fake provider ready 한 줄의 모양. */
export type FakeProviderReady = { ready: boolean; url: string };

const LOPHN_HOME = "LOPHN_HOME";
const FAKE_URL = "LOPHN_FAKE_PROVIDER_URL";
const LIVE = "LOPHN_LIVE_PROVIDER";

/**
 * 개발 데이터 root. 저장소 밖으로 가지 않는다: 항상 <root>/.dev-data.
 * core는 절대 경로가 아닌 LOPHN_HOME을 거절하므로 부르는 쪽이 절대 경로를 넣는다.
 */
export function devDataRoot(root: string): string {
  return `${root}/.dev-data`;
}

/** mock 모드 데이터 root. 실행마다 비우고 새로 만든다. */
export function mockDataRoot(root: string): string {
  return `${devDataRoot(root)}/mock`;
}

/** renderer bundle build 계획. shell main이 읽는 dist를 만든다. */
export function planRendererBuild(root: string): SpawnPlan {
  return {
    command: Deno.execPath(),
    args: ["run", "--allow-all", `${root}/packages/shell/renderer/build.ts`],
    env: {},
  };
}

/**
 * 사람의 LOPHN_LIVE_PROVIDER가 live면 fake provider를 건너뛴다.
 * 이미 주소가 있으면 같은 server를 다시 띄우지 않는다.
 */
export function shouldStartFakeProvider(
  env: { [LIVE]?: string; [FAKE_URL]?: string },
): boolean {
  if (env[LIVE] === "1") return false;
  return env[FAKE_URL] === undefined || env[FAKE_URL] === "";
}

/** fake provider spawn 계획. loopback 빈 포트로 뜨고 ready 한 줄을 쓴다. */
export function planFakeProvider(root: string): SpawnPlan {
  return {
    command: Deno.execPath(),
    args: ["run", "--allow-net", `${root}/tools/fake-provider/main.ts`],
    env: {},
  };
}

/**
 * core spawn 계획. 시작 인자: `deno run <권한> packages/core/main/daemon/main.ts
 * [--port=<n>]`, LOPHN_HOME은 데이터 root다. Electron main이 물려 준 pipe는 shell main이
 * 연다. 터미널에서 직접 띄우므로 stdin은 터미널이고 core는 신호로만 끝난다.
 */
export function planCore(
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
export function planShell(
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
    // fake provider 주소는 이 env로 core까지 흘러 간다. shell main이 core를 띄울 때
    // 자기 프로세스 env를 바탕으로 child env를 만든다(supervise.ts coreLaunch).
    // LOPHN_HOME은 --home이 정하므로 여기서는 넣지 않는다.
    env: { ...options.env },
  };
}

/** fake provider ready 한 줄을 읽는다. 끊기거나 JSON이 아니면 null이다. */
export async function fakeProviderReady(
  stream: ReadableStream<Uint8Array>,
): Promise<FakeProviderReady | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let line = "";
  try {
    while (!line.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) return null;
      line += decoder.decode(chunk.value);
    }
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(line) as FakeProviderReady;
    return value.ready === true && typeof value.url === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Ctrl+C·SIGTERM이 이 프로세스에 도착하면 된다. Windows는 SIGBREAK다. */
export function signalNames(os: string = Deno.build.os): Deno.Signal[] {
  return os === "windows" ? ["SIGBREAK"] : ["SIGINT", "SIGTERM"];
}

/**
 * 띄운 프로세스의 수명. add로 추적하고 stop으로 모두 끝낸다. detached로 띄우지 않으므로
 * SIGTERM이 프로세스 tree보다 좁지만 fake provider·shell main은 SIGTERM를 받으면 끝나고,
 * core는 shell main의 자식이라 같이 끝난다. 이미 끝난 child의 kill은 건너뛴다.
 */
export class ProcessGroup {
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

export type DevOptions = {
  /** 저장소 루트. 개발 데이터 root는 이 안이다. */
  root: string;
  /** 사람의 env 위에 더할 값. 테스트가 fake provider 주소를 미리 넣을 때 쓴다. */
  env?: Record<string, string>;
  /** 테스트가 명령을 흉내 낼 때 끼운다. 없으면 실제 프로세스를 띄운다. */
  spawn?: (plan: SpawnPlan, purpose: Purpose) => Deno.ChildProcess;
  /** 테스트가 신호를 붙이지 않을 때 끈다. */
  signals?: boolean;
};

/**
 * `deno task dev`와 `deno task dev:core`의 진행 순서다.
 *
 * 데이터 root(저장소 밖으로 가지 않는다)를 만들고(0700) → fake provider를 먼저 띄워
 * (필요할 때만) 그 loopback 주소를 env에 넣고 → `dev`는 shell main을, `dev:core`는 core를
 * 띄운다. shell이 없는데 `dev`를 부르면 이유를 말하고 실패로 끝난다. Ctrl+C·SIGTERM에
 * 띄운 것을 모두 끝낸다.
 */
export async function runDev(
  mode: Mode,
  options: DevOptions,
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
      await Deno.remove(dataRoot, { recursive: true }).catch(() => {});
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
  if (mode !== "dev:mock" && shouldStartFakeProvider(parentEnv)) {
    const fake = spawn(planFakeProvider(options.root), "fake");
    group.add(fake);
    const ready = await fakeProviderReady(fake.stdout);
    if (ready === null) {
      console.error(
        `deno task ${mode}: fake provider가 ready 한 줄을 쓰지 않았다`,
      );
      group.stop();
      return { ok: false };
    }
    parentEnv[FAKE_URL] = ready.url;
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

function defaultSpawn(plan: SpawnPlan, purpose: Purpose): Deno.ChildProcess {
  const child = new Deno.Command(plan.command, {
    args: [...plan.args],
    env: plan.env,
    stdin: "inherit",
    // fake provider의 ready 한 줄을 읽어야 하므로 pipe다. 그 밖은 log를 그대로 본다.
    stdout: purpose === "fake" ? "piped" : "inherit",
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
