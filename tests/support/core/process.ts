import {
  coreToMainMessageSchema,
  type MainHello,
} from "../../../packages/protocol/supervision/mod.ts";
import { FrameDecoder } from "../../../packages/protocol/base/mod.ts";

export const HELLO_TIMEOUT_MS = 30_000;
const GONE_TIMEOUT_MS = 15_000;
const POLL_MS = 50;

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const MAIN = `${REPO}/packages/core/main/daemon/main.ts`;

export type Spawned = {
  hello: MainHello;
  /** stdin을 닫는다. core가 정상 종료를 시작한다. */
  closeStdin(): Promise<void>;
  signal(signal: Deno.Signal): void;
  /** daemon이 끝나고 stdout·stderr pipe가 닫힌 뒤 돌아온다. */
  exited: Promise<void>;
};

function denoDir(): string {
  const set = Deno.env.get("DENO_DIR");
  if (set) return set;
  const cache = Deno.env.get("XDG_CACHE_HOME") ??
    `${Deno.env.get("HOME")}/.cache`;
  return `${cache}/deno`;
}

async function tail(path: string): Promise<string> {
  try {
    return (await Deno.readTextFile(path)).slice(-2000);
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
): Promise<Spawned> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", MAIN, "--port=0"],
    cwd: REPO,
    clearEnv: true,
    env: {
      LOPHN_HOME: home,
      HOME: userHome,
      PATH: Deno.env.get("PATH") ?? "",
      DENO_DIR: denoDir(),
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const log = await Deno.open(logPath, {
    create: true,
    append: true,
    write: true,
    mode: 0o600,
  });
  const logged = child.stderr.pipeTo(log.writable);
  const stdin = child.stdin.getWriter();
  const reader = child.stdout.getReader();
  const decoder = new FrameDecoder();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`hello가 ${HELLO_TIMEOUT_MS}ms 안에 오지 않았다`)),
      HELLO_TIMEOUT_MS,
    );
  });
  const readHello = async (): Promise<MainHello> => {
    for (;;) {
      const next = await reader.read();
      if (next.done) throw new Error("hello 전에 core stdout이 닫혔다");
      for (const frame of decoder.push(next.value)) {
        if (frame.kind !== "json") continue;
        const message = coreToMainMessageSchema.parse(frame.payload);
        if ("user_token" in message) return message;
        if ("type" in message && message.type === "start_failed") {
          throw new Error(`core 시작 실패: ${message.reason}`);
        }
      }
    }
  };
  let hello: MainHello;
  try {
    hello = await Promise.race([readHello(), timeout]);
  } catch (error) {
    child.kill("SIGKILL");
    await child.status;
    reader.releaseLock();
    await logged.catch(() => {});
    throw new Error(
      `${
        error instanceof Error ? error.message : error
      }\n--- core.log ---\n${await tail(
        logPath,
      )}`,
    );
  } finally {
    clearTimeout(timer);
  }

  // 이후 stdout을 계속 비운다. 안 읽으면 pipe가 차서 core가 막힌다.
  const drained = (async () => {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
      }
    } catch {
      // core가 죽으면 pipe 오류로 끝난다.
    }
  })();
  const exited = (async () => {
    await child.status;
    await Promise.all([drained, logged.catch(() => {})]);
  })();
  return {
    hello,
    async closeStdin() {
      await stdin.close().catch(() => {});
    },
    signal: (signal) => child.kill(signal),
    exited,
  };
}

// LOPHN_HOME이 이 home인 process(daemon과 그 child)를 /proc에서 찾는다.
export async function processesOf(home: string): Promise<number[]> {
  const wanted = `LOPHN_HOME=${home}`;
  const found: number[] = [];
  for await (const entry of Deno.readDir("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const environ = await Deno.readFile(`/proc/${entry.name}/environ`);
      const entries = new TextDecoder().decode(environ).split("\0");
      if (entries.includes(wanted)) found.push(Number(entry.name));
    } catch {
      // 방금 끝난 process이거나 읽을 수 없는 남의 process다.
    }
  }
  return found;
}

// daemon이 끝난 뒤 그 child까지 없어지기를 기다린다. 제한 시간까지 남으면 그 pid만 SIGKILL하고 pid를 돌려준다.
export async function waitGone(home: string): Promise<number[]> {
  const deadline = Date.now() + GONE_TIMEOUT_MS;
  for (;;) {
    const left = await processesOf(home);
    if (left.length === 0) return [];
    if (Date.now() > deadline) {
      for (const pid of left) {
        try {
          Deno.kill(pid, "SIGKILL");
        } catch {
          // 그 사이 끝났다.
        }
      }
      return left;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

// agent runtime child의 pid. 권한(폴더)이 바뀌면 core가 이 child를 새 pid로 다시 띄운다.
export async function runtimePids(home: string): Promise<number[]> {
  const found: number[] = [];
  for (const pid of await processesOf(home)) {
    try {
      const argv = await Deno.readTextFile(`/proc/${pid}/cmdline`);
      if (argv.includes("agent-runtime/main.ts")) found.push(pid);
    } catch {
      // 그 사이 끝났다.
    }
  }
  return found;
}
