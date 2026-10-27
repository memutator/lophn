import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import {
  fromReadable,
  toWriter,
} from "../../../packages/core/supervision/responsiveness/pipe.ts";
import { FrameDecoder } from "../../../packages/protocol/base/mod.ts";
import {
  coreToMainMessageSchema,
  type MainHello,
} from "../../../packages/protocol/supervision/mod.ts";

export const HELLO_TIMEOUT_MS = 30_000;
const GONE_TIMEOUT_MS = 15_000;
const POLL_MS = 50;

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

export type Spawned = {
  ok: true;
  hello: MainHello;
  /** stdin을 닫는다. core가 정상 종료를 시작한다. */
  closeStdin(): Promise<void>;
  signal(signal: NodeJS.Signals): void;
  /** daemon이 끝나고 stdout·stderr pipe가 닫힌 뒤 돌아온다. */
  exited: Promise<void>;
};

/** core가 시작하지 못하고 `start_failed`를 알린 때. exit는 core가 스스로 끝난 코드이고, 제한 시간 안에 안 끝나 SIGKILL했으면 null이다. */
export type SpawnFailed = {
  ok: false;
  reason: string;
  exit: number | null;
};

// 호출한 쪽이 덮지 못하게 막는 env. 격리(사람의 홈, OS keychain)를 지키는 것들이다.
const FIXED_ENV = ["LOPHN_HOME", "HOME", "PATH"];

function denoDir(): string {
  const set = process.env["DENO_DIR"];
  if (set) return set;
  const cache =
    process.env["XDG_CACHE_HOME"] ?? `${process.env["HOME"]}/.cache`;
  return `${cache}/deno`;
}

export async function tail(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).slice(-2000);
  } catch {
    return "";
  }
}

// daemon을 parent pipe로 띄우고 stdout 첫 hello frame을 읽는다. HOME을 빈 폴더로 바꾸고 DBUS를 주지 않아
// 사람의 홈과 OS keychain에 닿지 않는다.
export async function spawnCore(
  home: string,
  userHome: string,
  logPath: string,
  env: Record<string, string> = {},
  repo: string = REPO,
): Promise<Spawned | SpawnFailed> {
  for (const name of FIXED_ENV) {
    if (name in env) throw new Error(`core env ${name}는 덮을 수 없다`);
  }
  // Deno.execPath()는 자기를 다시 띄우는 자리라 node-flip 계획이 바꾼다.
  const child = spawn(
    Deno.execPath(),
    [
      "run",
      "--allow-all",
      `${repo}/packages/core/main/daemon/main.ts`,
      "--port=0",
    ],
    {
      cwd: repo,
      // Deno의 clearEnv처럼 부모 env를 물려주지 않는다. Deno의 node:child_process는 env를 줘도
      // 부모의 NODE_V8_COVERAGE를 자식에 복사해서(실측) 그 이름을 막아 둔다.
      env: {
        NODE_V8_COVERAGE: undefined,
        LOPHN_HOME: home,
        HOME: userHome,
        PATH: process.env["PATH"] ?? "",
        DENO_DIR: denoDir(),
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  // spawn 실패('error')에는 exit event가 없으니 error도 끝으로 센다.
  const exitCode = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const logged = pipeline(child.stderr!, log).catch(() => {});
  const stdin = toWriter(child.stdin!);
  // Deno 2.9.7의 node:child_process stdout은 paused mode에서 'readable'이 프로세스가 끝나야 온다.
  // fromReadable은 'data'로 받아 core가 살아 있는 동안에도 hello frame을 읽는다.
  const stdout = fromReadable(child.stdout!);
  const decoder = new FrameDecoder();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`hello가 ${HELLO_TIMEOUT_MS}ms 안에 오지 않았다`)),
      HELLO_TIMEOUT_MS,
    );
  });
  const readHello = async (): Promise<MainHello | SpawnFailed> => {
    const buffer = new Uint8Array(64 * 1024);
    for (;;) {
      const count = await stdout.read(buffer);
      if (count === null) throw new Error("hello 전에 core stdout이 닫혔다");
      for (const frame of decoder.push(buffer.subarray(0, count))) {
        if (frame.kind !== "json") continue;
        const message = coreToMainMessageSchema.parse(frame.payload);
        if ("user_token" in message) return message;
        if ("type" in message && message.type === "start_failed") {
          return { ok: false, reason: message.reason, exit: null };
        }
      }
    }
  };
  let hello: MainHello | SpawnFailed;
  try {
    hello = await Promise.race([readHello(), timeout]);
  } catch (error) {
    child.kill("SIGKILL");
    await exitCode;
    stdout.cancel();
    await logged;
    throw new Error(
      `${
        error instanceof Error ? error.message : error
      }\n--- core.log ---\n${await tail(logPath)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if ("ok" in hello) {
    // 시작에 실패한 core는 스스로 끝나야 한다. SIGKILL에 기대면 정리 경로를 못 본다.
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([
      exitCode,
      new Promise<null>((resolve) => {
        giveUp = setTimeout(() => resolve(null), GONE_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(giveUp);
    if (code === null) {
      child.kill("SIGKILL");
      await exitCode;
    }
    await stdin.close();
    stdout.cancel();
    await logged;
    return { ...hello, exit: code };
  }

  // 이후 stdout을 계속 비운다. 안 읽으면 pipe가 차서 core가 막힌다.
  const drained = (async () => {
    const buffer = new Uint8Array(64 * 1024);
    try {
      for (;;) {
        if ((await stdout.read(buffer)) === null) return;
      }
    } catch {
      // core가 죽으면 pipe 오류로 끝난다.
    }
  })();
  const exited = (async () => {
    await exitCode;
    await Promise.all([drained, logged]);
  })();
  return {
    ok: true,
    hello,
    async closeStdin() {
      await stdin.close();
    },
    signal: (signal) => {
      child.kill(signal);
    },
    exited,
  };
}

// LOPHN_HOME이 이 home인 process(daemon과 그 child)를 /proc에서 찾는다.
export async function processesOf(home: string): Promise<number[]> {
  const wanted = `LOPHN_HOME=${home}`;
  const found: number[] = [];
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const environ = await readFile(`/proc/${entry.name}/environ`);
      const entries = new TextDecoder().decode(environ).split("\0");
      if (entries.includes(wanted)) found.push(Number(entry.name));
    } catch {
      // 방금 끝난 process이거나 읽을 수 없는 남의 process다.
    }
  }
  return found;
}

// daemon이 끝난 뒤 그 child까지 없어지기를 기다린다. 제한 시간까지 남으면 그 pid만 SIGKILL하고 pid를 돌려준다.
// keep은 같은 home에서 이미 돌던 process(둘째 core가 실패한 뒤 첫째 core)라 남아 있어도 된다.
export async function waitGone(
  home: string,
  keep: number[] = [],
): Promise<number[]> {
  const deadline = Date.now() + GONE_TIMEOUT_MS;
  for (;;) {
    const left = (await processesOf(home)).filter((pid) => !keep.includes(pid));
    if (left.length === 0) return [];
    if (Date.now() > deadline) {
      for (const pid of left) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // 그 사이 끝났다.
        }
      }
      return left;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

// agent runtime child의 pid. child가 crash하면 감독이 새 pid로 다시 띄운다.
export async function runtimePids(home: string): Promise<number[]> {
  const found: number[] = [];
  for (const pid of await processesOf(home)) {
    try {
      const argv = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (argv.includes("agent-runtime/main.ts")) found.push(pid);
    } catch {
      // 그 사이 끝났다.
    }
  }
  return found;
}
