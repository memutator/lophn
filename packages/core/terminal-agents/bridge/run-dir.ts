// core가 켜질 때마다 만드는 per-run 폴더. hook·bridge endpoint, `$BROWSER` shim, 시작 층 file이 여기 산다.
// POSIX는 공통 socket 자리(`socketDirectoryPath`) 아래 `core-<pid>/`, Windows는 pipe가 아니라 shim file만
// 두는 `<data root>/run/core-<pid>/`다. endpoint는 base의 `ipcPath`가 만든다(Windows는 data root로 나눈
// common namespace의 named pipe). file 폴더와 pipe의 수명은 서로 상관없다.
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import {
  err,
  ipcPath,
  ipcPathLimit,
  ok,
  type OsPlatform,
  type Result,
  socketDirectoryPath,
} from "../../../base/mod.ts";

const DIR_MODE = 0o700;

export type RunDir = {
  dir: string;
  bridgeSocket: string;
  hookSocket: string;
  shim: string;
  script: string;
};

type RunDirError = { code: "invalid_input" | "unavailable"; message: string };

export type RunDirDeps = {
  platform: OsPlatform;
  dataRoot: string;
  env: Readonly<Record<string, string | undefined>>; // XDG_RUNTIME_DIR만 읽는다
  tmpdir: string;
  // POSIX만 본다. Windows는 data root의 ACL을 믿는다.
  uid: number;
  pid: number;
  fs: {
    mkdir(path: string, mode: number): void; // recursive
    chmod(path: string, mode: number): void;
    list(path: string): string[]; // 없으면 []
    remove(path: string): void; // recursive, force
  };
  isAlive(pid: number): boolean;
};

export function prepareRunDir(deps: RunDirDeps): Result<RunDir, RunDirError> {
  const common = socketDirectoryPath({
    dataRoot: deps.dataRoot,
    xdgRuntimeDir: deps.env.XDG_RUNTIME_DIR,
    tempParent: deps.tmpdir,
    uid: deps.uid,
    platform: deps.platform,
    // base는 node를 import하지 않아 hash를 부르는 곳이 넘긴다.
    hash: (text) => createHash("sha256").update(text).digest("hex"),
  });
  if (!common.ok) return err(common.error);
  const dir =
    deps.platform === "win32"
      ? join(deps.dataRoot, "run", `core-${deps.pid}`)
      : join(common.value, `core-${deps.pid}`);
  const bridgeSocket =
    deps.platform === "win32"
      ? ipcPath(common.value, `core-${deps.pid}-b`, deps.platform)
      : ipcPath(dir, "b", deps.platform);
  const hookSocket =
    deps.platform === "win32"
      ? ipcPath(common.value, `core-${deps.pid}-h`, deps.platform)
      : ipcPath(dir, "h", deps.platform);
  // pipe는 자리만 보고 file은 아직 만들지 않는다. 넘치면 폴더를 건드리기 전에 bridge도 hook도 끈다.
  for (const path of [bridgeSocket, hookSocket]) {
    if (new TextEncoder().encode(path).length > ipcPathLimit(deps.platform)) {
      return err({
        code: "invalid_input",
        message: "socket path exceeds the byte limit",
      });
    }
  }
  // pipe 이름은 file 경로가 아니라서 mkdir·chmod·remove 대상이 아니다.
  const parent =
    deps.platform === "win32" ? join(deps.dataRoot, "run") : common.value;
  try {
    // core가 죽어 남은 옛 실행 폴더. 같은 data root의 `core-<숫자>` 중 죽은 pid만 지우고,
    // core socket, shell의 `shell-<pid>`, 살아 있는 다른 core, 다른 이름은 건드리지 않는다.
    for (const name of deps.fs.list(parent)) {
      const match = /^core-(\d+)$/.exec(name);
      if (match === null) continue;
      const pid = Number(match[1]);
      if (pid === deps.pid || !deps.isAlive(pid)) {
        deps.fs.remove(join(parent, name));
      }
    }
    deps.fs.mkdir(dir, DIR_MODE);
    if (deps.platform !== "win32") {
      // mkdir의 mode는 umask에 깎이고 recursive면 부모는 기본 mode로 만들어진다. Windows는 mode가 없다.
      for (const path of [dirname(common.value), common.value, dir]) {
        deps.fs.chmod(path, DIR_MODE);
      }
    }
  } catch (cause) {
    return err({
      code: "unavailable",
      message: `cannot prepare the run directory: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
  }
  // Windows는 이 자리를 쓰지 않고 data root의 `run/browser-<hash>/browser.exe`를 쓴다(wiring/bridge.ts).
  const shim = join(dir, "browser");
  return ok({
    dir,
    bridgeSocket,
    hookSocket,
    shim,
    script: join(dir, "browser.js"),
  });
}
