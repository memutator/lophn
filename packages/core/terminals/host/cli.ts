// PTY host process의 시작점. core가 자기 Electron Node(ELECTRON_RUN_AS_NODE)로 이 file을 띄우고 stdin·stdout pipe로만 말한다.
// 테스트는 serve.ts를 바로 쓰고 이 file은 process의 stdin·stdout·신호만 꽂는다.
import { lstatSync, statSync } from "node:fs";
import { release } from "node:os";
import process from "node:process";
import { systemClock } from "../../../base/clock.ts";
import { createIdSource } from "../../../base/id.ts";
import { cryptoRandom } from "../../../base/random.ts";
import { windowsBuildNumber } from "./conpty-sync.ts";
import { serveHost } from "./serve.ts";
import { createWinForegroundReader } from "./win-foreground.ts";

const served = serveHost({
  deps: {
    ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
    // core가 사람의 login env로 띄운다. 터미널 env는 host가 이것을 걸러 만든다.
    env: process.env,
    platform: process.platform,
    ...(process.platform === "win32"
      ? {
          windowsBuildNumber: windowsBuildNumber(release()),
          winForeground: createWinForegroundReader(),
        }
      : {}),
    // 앱 실행 alias(WindowsApps\pwsh.exe)는 stat이 EACCES라 existsSync가 false다. 자리만 본다.
    exists: (file) => {
      try {
        lstatSync(file);
        return true;
      } catch {
        return false;
      }
    },
    checkFolder: (path) => {
      try {
        const stat = statSync(path);
        if (!stat.isDirectory()) return { ok: false, reason: "not_directory" };
        return { ok: true, path };
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    },
    schedule: (done) => setImmediate(done),
  },
  input: process.stdin,
  write: (line) => process.stdout.write(`${JSON.stringify(line)}\n`),
  exit: (code) => process.exit(code),
});

process.on("SIGTERM", () => served.exit("SIGTERM", 0));
// 요청 밖의 예외는 상태를 믿을 수 없어 정리하고 끝난다.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error) => {
    console.error(`terminal host ${event}:`, error);
    served.exit(event, 1);
  });
}
// core가 사라지면 EPIPE가 난다.
process.stdout.on("error", () => served.exit("stdout closed", 0));
