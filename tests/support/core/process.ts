import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { cliDial } from "../../../packages/cli/connection/client/node.ts";
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  controlConnect,
  controlIdentify,
  controlStop,
} from "../../../packages/protocol/client/mod.ts";

const STARTUP_TIMEOUT_MS = 30_000;
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
  /** 이 test가 직접 띄운 detached core의 pid. crash 흉내는 이 pid에만 SIGKILL한다. */
  pid: number;
  /** control `connect {client: cli}`가 준 user token. shell capability는 받지 않는다. */
  token: string;
  /** control `connect`가 준 API 주소(`http://127.0.0.1:<port>`). */
  apiUrl: string;
  signal(signal: NodeJS.Signals): void;
  /** control stop을 보내 core가 스스로 끝나기를 기다린다. 제한 시간에 안 끝나면 SIGKILL한다. */
  stop(): Promise<void>;
  /** core가 끝나고 stderr log가 닫힌 뒤 돌아온다. 값은 core의 exit code이고, signal로 끝났으면 null이다. */
  exited: Promise<number | null>;
};

/** core가 시작하지 못하고 `start_failed`를 알린 때. exit는 core가 스스로 끝난 코드이고, spawn 자체가 실패했으면 null이다. */
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

// core의 stdout 첫 줄 하나만 읽고 stream을 놓는다. core는 그 줄 뒤에 stdout에 쓰지 않는다.
function readStartLine(stream: Readable): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let data = "";
  stream.setEncoding("utf8");
  const done = () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("error", onError);
    // pipe를 놓은 뒤의 오류(core가 쓴 뒤 닫힘)로 process가 죽지 않게 한다.
    stream.on("error", () => {});
  };
  const onData = (text: string | Buffer) => {
    data += text.toString();
    const end = data.indexOf("\n");
    if (end < 0) return;
    done();
    resolve(data.slice(0, end));
  };
  const onEnd = () => {
    done();
    reject(new Error("core가 첫 줄을 쓰기 전에 stdout을 닫았다"));
  };
  const onError = (error: Error) => {
    done();
    reject(error);
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);
  return promise;
}

type StartLine = { kind: "ready" } | { kind: "start_failed"; reason: string };

function parseStartLine(line: string): StartLine | undefined {
  try {
    const parsed = JSON.parse(line) as { type?: unknown; reason?: unknown };
    if (parsed.type === "ready") return { kind: "ready" };
    if (parsed.type === "start_failed" && typeof parsed.reason === "string") {
      return { kind: "start_failed", reason: parsed.reason };
    }
  } catch {
    // 계약 밖 줄이다. 옛 core처럼 첫 줄이 다른 모양이면 시작 실패로 본다.
  }
  return undefined;
}

// core를 detached로 띄우고 stdout 첫 줄을 읽는다. `ready`면 control identify·connect로 API 주소와
// user token을 받는다. HOME을 빈 폴더로 바꾸고 DBUS를 주지 않아 사람의 홈과 OS keychain에 닿지 않는다.
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
      // core는 launcher의 child 수명에 묶이지 않는다. 정리는 이 test가 아는 자기 pid로만 한다.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (child.pid === undefined) throw new Error("core process를 띄우지 못했다");
  const pid = child.pid;
  if (process.platform === "win32") {
    windowsCores.set(home, (windowsCores.get(home) ?? new Set()).add(pid));
  }
  // spawn 실패('error')에는 exit event가 없으니 error도 끝으로 센다.
  const exitCode = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  // stderr는 자기 log file로만 간다. launcher의 읽기 pipe에 묶이면 launcher가 죽을 때 core도 막힌다.
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const logged = pipeline(child.stderr!, log).catch(() => {});

  async function waitExit(): Promise<number | null> {
    const { promise: timedOut, resolve: giveUp } =
      Promise.withResolvers<"timeout">();
    const timer = setTimeout(() => giveUp("timeout"), GONE_TIMEOUT_MS);
    const code = await Promise.race([exitCode, timedOut]);
    clearTimeout(timer);
    if (code !== "timeout") return code;
    child.kill("SIGKILL");
    await exitCode;
    throw new Error(`${GONE_TIMEOUT_MS}ms 안에 core가 끝나지 않아 SIGKILL했다`);
  }

  // 이 시도가 띄운 process만 회수하고 이유를 던진다. stdout pipe는 첫 줄 뒤 놓는다.
  async function discard(message: string): Promise<never> {
    child.kill("SIGKILL");
    await exitCode;
    child.stdout!.destroy();
    await logged;
    throw new Error(`${message}\n--- core.log ---\n${await tail(logPath)}`);
  }

  const { promise: timeout, reject: timeOut } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () =>
      timeOut(
        new Error(`core가 ${STARTUP_TIMEOUT_MS}ms 안에 첫 줄을 쓰지 않았다`),
      ),
    STARTUP_TIMEOUT_MS,
  );
  let line: string;
  try {
    line = await Promise.race([readStartLine(child.stdout!), timeout]);
  } catch (error) {
    return discard(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
  // 여기서부터 core는 stdout에 쓰지 않는다. pipe를 놓아 core가 우리 읽기에 묶이지 않게 한다.
  child.stdout!.destroy();
  const started = parseStartLine(line);
  if (started === undefined) {
    // 줄 내용은 남기지 않는다. 계약 밖 첫 줄에는 credential이 섞여 있을 수 있다.
    return discard(
      "core 시작 첫 줄이 계약과 다르다(ready도 start_failed도 아니다)",
    );
  }
  if (started.kind === "start_failed") {
    // 시작에 실패한 core는 스스로 끝나야 한다. SIGKILL에 기대면 정리 경로를 못 본다.
    let code: number | null = null;
    try {
      code = await waitExit();
    } finally {
      await logged;
    }
    return { ok: false, reason: started.reason, exit: code };
  }

  const dial = cliDial({
    dataRoot: home,
    platform: process.platform,
    // core의 socket 자리는 core process의 XDG_RUNTIME_DIR을 따른다. spawnCore는 넘긴 env만 core에 준다.
    xdgRuntimeDir: env["XDG_RUNTIME_DIR"],
  });
  if (!dial.ok) {
    return discard(
      `control socket 경로를 구하지 못했다: ${dial.error.message}`,
    );
  }
  const deps = { dial: dial.value, timeoutMs: CONTROL_REQUEST_TIMEOUT_MS };
  // ready 줄은 control이 ready가 된 뒤에 온다. 붙는 사이의 starting만 잠깐 기다린다.
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    const identified = await controlIdentify(deps);
    if (!identified.ok) {
      if (identified.error.code !== "unavailable") {
        return discard(
          `core control identify: ${identified.error.code}: ${identified.error.message}`,
        );
      }
    } else if (identified.value.state === "ready") {
      break;
    } else if (identified.value.state === "stopping") {
      return discard("core가 시작하자마자 끝나는 중이다");
    }
    if (Date.now() > deadline) {
      return discard("core control이 ready가 되지 않는다");
    }
    await sleep(POLL_MS);
  }
  const connected = await controlConnect(deps, "cli");
  if (!connected.ok) {
    return discard(
      `core control connect: ${connected.error.code}: ${connected.error.message}`,
    );
  }

  const exited = (async () => {
    const code = await exitCode;
    await logged;
    return code;
  })();
  return {
    ok: true,
    pid,
    token: connected.value.user_token,
    apiUrl: connected.value.api_url,
    signal: (signal) => {
      child.kill(signal);
    },
    async stop() {
      const stopped = await controlStop(deps);
      if (!stopped.ok) {
        // control이 답하지 않는 core를 남기지 않는다. 실패는 던져 알린다.
        child.kill("SIGKILL");
        await exitCode;
        throw new Error(
          `core control stop: ${stopped.error.code}: ${stopped.error.message}`,
        );
      }
      await waitExit();
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
