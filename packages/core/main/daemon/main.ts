import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createAlwaysOnOs } from "../../always-on/os/mod.ts";
import { startFailureReason } from "../../storage/migration/mod.ts";
import { TEAM_MODULES, TEAMS, WIRINGS } from "./assembly.ts";
import { startCore } from "./core.ts";
import { installedLayout } from "./entry-layout.ts";
import { createShellLauncher } from "./shell-launcher.ts";

// core에는 시작 모드가 하나뿐이다. stdin을 수명 신호로 읽지 않고, stdout 첫 JSON 줄로만
// 시작 결과(ready 또는 start_failed)를 알린다. 종료는 control stop·idle-exit·SIGINT/SIGTERM이
// 같은 shutdown barrier로 한다.
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

const platformRoot = fileURLToPath(new URL("../../../..", import.meta.url));

// shell 없이 띄운다. 기한을 넘기면 끄고 code null, 띄우지 못하면(없는 명령) reject한다.
const exec = (file: string, args: readonly string[], timeoutMs: number) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        file,
        [...args],
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout, stderr) => {
          if (error === null) return resolve({ code: 0, stdout, stderr });
          if (error.killed) return resolve({ code: null, stdout, stderr });
          // 숫자 code는 명령이 0이 아닌 값으로 끝난 것이고, 문자열은 띄우지 못한 것이다.
          if (typeof error.code === "number") {
            return resolve({ code: error.code, stdout, stderr });
          }
          reject(error);
        },
      );
    },
  );

// child tree 전체를 끈다: POSIX는 process group(detached로 띄워 그룹 leader가 된다), Windows는 taskkill /T.
// 띄우지 못하면 onExit(null)이다.
const spawnHolder = (
  file: string,
  args: readonly string[],
  options: { windowsHide: true },
) => {
  const win = process.platform === "win32";
  const listeners: ((code: number | null) => void)[] = [];
  const child = spawn(file, [...args], {
    ...options,
    detached: !win,
    stdio: "ignore",
  });
  let exited = false;
  const done = (code: number | null) => {
    if (exited) return;
    exited = true;
    for (const listener of listeners) listener(code);
  };
  child.on("error", () => done(null));
  child.on("exit", (code) => done(code));
  return {
    onExit(listener: (code: number | null) => void) {
      listeners.push(listener);
    },
    kill() {
      if (child.pid === undefined) return;
      if (win) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("error", () => {});
        return;
      }
      try {
        process.kill(-child.pid);
      } catch {
        // 이미 끝났다.
      }
    },
  };
};

const files = {
  async read(path: string) {
    try {
      return await readFile(path, "utf8");
    } catch (thrown) {
      if ((thrown as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw thrown;
    }
  },
  async write(path: string, text: string, mode: number) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { mode });
  },
  async remove(path: string) {
    await rm(path, { force: true });
  },
};

// launcher가 stdout을 먼저 놓아도 core가 EPIPE로 죽지 않는다.
process.stdout.on("error", () => {});

const started = await startCore({
  port,
  teams: TEAMS,
  teamModules: TEAM_MODULES,
  wirings: WIRINGS,
  exit: (code) => process.exit(code),
  // 설치 layout으로 뜬 core만 OS port를 받는다. 개발·test core가 사람의 OS에 등록하지 않는다.
  alwaysOn: installedLayout(platformRoot, existsSync)
    ? ({ dataRoot, logger }) =>
        createAlwaysOnOs({
          platform: process.platform,
          dataRoot,
          execPath: process.execPath,
          coreEntry: fileURLToPath(import.meta.url),
          corePid: process.pid,
          uid: process.getuid?.() ?? 0,
          home: homedir(),
          env: process.env,
          exec,
          spawn: spawnHolder,
          files,
          hash: (text) => createHash("sha256").update(text).digest("hex"),
          logger,
        })
    : undefined,
  launchShell: createShellLauncher({
    platformRoot,
    execPath: process.execPath,
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    exec,
    spawn: (command, args, options) => spawn(command, args, options),
  }),
});
if (!started.ok) {
  // core의 logger는 startCore 안에서 만들어져 실패가 돌아온 여기서는 손에 없다. 같은 모양의 줄을 직접 쓴다.
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service_name: "lophn-core",
      component: "core",
      event: "start_failed",
      message: started.error.message,
    })}\n`,
  );
  // 화면 없이 띄운 쪽이 실패 이유를 보이게 알린다. 문장과 경로는 싣지 않는다.
  const reason = startFailureReason(started.error);
  process.stdout.write(`${JSON.stringify({ type: "start_failed", reason })}\n`);
  // OS service는 0이 아닌 끝을 crash로 보고 다시 띄운다. ready 전 실패는 다시 띄워도 같고, lock을 잃은 것(conflict)은 이미 core가 있다는 뜻이다.
  process.exit(process.env.LOPHN_SERVICE === "1" ? 0 : 1);
}
const core = started.value;
// 첫 줄만 읽고 stream을 놓는 launcher에 core가 섰음을 알린다. token은 이 줄에 없다.
process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
const exitAfterShutdown = () =>
  void core.shutdown().then(() => process.exit(0));
process.on("SIGINT", exitAfterShutdown);
process.on("SIGTERM", exitAfterShutdown);
// done은 shutdown barrier가 실제로 끝났을 때 resolve된다.
await core.done;
process.exit(0);
