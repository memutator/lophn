import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
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

const REPO = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /[\\/]$/,
  "",
);
// Windows는 /proc이 없고 남의 process env를 읽지 못한다. spawnCore가 띄운 core pid를 home마다 적어 두고,
// 그 pid에서 ParentProcessId를 따라 내려간 process를 그 home의 것으로 본다. Windows는 부모가 끝나도 ParentProcessId를
// 그대로 두므로 core가 죽은 뒤에도 남은 child를 찾는다. 끝난 pid를 다른 process가 다시 받으면 잘못 셀 수 있다.
const windowsCores = new Map<string, Set<number>>();

type WindowsProcess = { pid: number; ppid: number; command: string };

function windowsProcesses(): Promise<WindowsProcess[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { maxBuffer: 64 << 20, windowsHide: true },
      (error, stdout) => {
        if (error !== null) return reject(error);
        const rows = JSON.parse(stdout) as {
          ProcessId: number;
          ParentProcessId: number;
          CommandLine: string | null;
        }[];
        resolve(
          rows.map((row) => ({
            pid: row.ProcessId,
            ppid: row.ParentProcessId,
            command: row.CommandLine ?? "",
          })),
        );
      },
    );
  });
}

async function windowsTree(home: string): Promise<WindowsProcess[]> {
  const roots = windowsCores.get(home) ?? new Set<number>();
  const all = await windowsProcesses();
  const found = new Map<number, WindowsProcess>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const one of all) {
      if (found.has(one.pid)) continue;
      if (roots.has(one.pid) || roots.has(one.ppid) || found.has(one.ppid)) {
        found.set(one.pid, one);
        grew = true;
      }
    }
  }
  return [...found.values()].sort((a, b) => a.pid - b.pid);
}

// core는 설치본에서 Electron의 Node로 돈다. test도 같은 binary로 띄워야 판이 갈리지 않는다.
const ELECTRON = createRequire(import.meta.url)("electron") as string;

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
const FIXED_ENV = ["LOPHN_HOME", "HOME", "PATH", "USERPROFILE"];
// Windows의 cmd·npm·Git Bash가 기본 명령을 돌리는 데 드는 값이다. 사람의 홈(USERPROFILE)은 넘기지 않는다.
const WINDOWS_ENV = [
  "SystemRoot",
  "ComSpec",
  "TEMP",
  "TMP",
  "PATHEXT",
  // shell tool이 Git Bash를 찾는 자리다.
  "ProgramFiles",
  "ProgramFiles(x86)",
  "LOPHN_GIT_BASH",
];

function windowsEnv(userHome: string): Record<string, string> {
  if (process.platform !== "win32") return {};
  const env: Record<string, string> = { USERPROFILE: userHome };
  for (const name of WINDOWS_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
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
  // core 자신이 lophn의 `.ts` entry라 지금 test를 도는 Electron Node로 띄운다.
  const child = spawn(
    ELECTRON,
    [`${repo}/packages/core/main/daemon/main.ts`, "--port=0"],
    {
      cwd: repo,
      // env를 주면 부모 환경을 통째로 대체한다.
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        LOPHN_HOME: home,
        HOME: userHome,
        PATH: process.env["PATH"] ?? "",
        ...windowsEnv(userHome),
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (process.platform === "win32" && child.pid !== undefined) {
    windowsCores.set(
      home,
      (windowsCores.get(home) ?? new Set()).add(child.pid),
    );
  }
  // spawn 실패('error')에는 exit event가 없으니 error도 끝으로 센다.
  const exitCode = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const logged = pipeline(child.stderr!, log).catch(() => {});
  const stdin = toWriter(child.stdin!);
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

// process마다 command line 하나(인자는 공백으로 잇는다). Windows는 `\`를 `/`로 바꿔 test가 `/`로 이은 경로와 견준다.
export async function processCommands(): Promise<
  { pid: number; command: string }[]
> {
  if (process.platform === "win32") {
    return (await windowsProcesses()).map((one) => ({
      pid: one.pid,
      command: one.command.replaceAll("\\", "/"),
    }));
  }
  const found: { pid: number; command: string }[] = [];
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const argv = await readFile(`/proc/${entry.name}/cmdline`, "utf8");
      found.push({
        pid: Number(entry.name),
        command: argv.split("\0").join(" "),
      });
    } catch {
      // 방금 끝난 process이거나 읽을 수 없는 남의 process다.
    }
  }
  return found;
}

// LOPHN_HOME이 이 home인 process(daemon과 그 child)를 /proc에서 찾는다(Windows는 위의 pid tree).
export async function processesOf(home: string): Promise<number[]> {
  if (process.platform === "win32") {
    return (await windowsTree(home)).map((one) => one.pid);
  }
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
  if (process.platform === "win32") {
    return (await windowsTree(home))
      .filter((one) => /agent-runtime[\\/]main\.ts/.test(one.command))
      .map((one) => one.pid);
  }
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
