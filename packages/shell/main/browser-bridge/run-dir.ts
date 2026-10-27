// 앱이 켜질 때마다 만드는 per-run 폴더. bridge socket과 `$BROWSER` shim 두 file이 여기 산다.
// shell은 core를 import하지 못해서 core `socket-dir.ts`의 자리 규칙(폴더 key, 104 byte)을 따로 적었다.
// 거기와 같은 규칙이어야 한다.
import { createHash } from "node:crypto";

// sockaddr_un의 sun_path 한도. TCP로 바꾸지 않는다.
const SOCKET_PATH_MAX_BYTES = 104;
const DIR_MODE = 0o700;

export type RunDirDeps = {
  dataRoot: string;
  env: Readonly<Record<string, string | undefined>>; // XDG_RUNTIME_DIR만 읽는다
  tmpdir: string;
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

export type RunDirResult =
  | {
      ok: true;
      value: { dir: string; socket: string; shim: string; script: string };
    }
  | {
      ok: false;
      error: { code: "invalid_input" | "unavailable"; message: string };
    };

export function prepareRunDir(deps: RunDirDeps): RunDirResult {
  const xdg = deps.env.XDG_RUNTIME_DIR;
  const base =
    xdg !== undefined && xdg !== ""
      ? `${xdg}/lophn`
      : `${deps.tmpdir}/lophn-${deps.uid}`;
  const key = createHash("sha256")
    .update(deps.dataRoot)
    .digest("hex")
    .slice(0, 12);
  const keyDir = `${base}/${key}`;
  const dir = `${keyDir}/shell-${deps.pid}`;
  const socket = `${dir}/b.sock`;
  if (new TextEncoder().encode(socket).length >= SOCKET_PATH_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "bridge socket path exceeds the byte limit",
      },
    };
  }
  try {
    // 앱이 죽어 남은 옛 실행 폴더. 다른 이름(core의 socket 폴더 등)은 건드리지 않는다.
    for (const name of deps.fs.list(keyDir)) {
      const match = /^shell-(\d+)$/.exec(name);
      if (match === null) continue;
      const pid = Number(match[1]);
      if (pid === deps.pid || !deps.isAlive(pid)) {
        deps.fs.remove(`${keyDir}/${name}`);
      }
    }
    deps.fs.mkdir(dir, DIR_MODE);
    // mkdir의 mode는 umask에 깎이고 recursive면 부모는 기본 mode로 만들어질 수 있어 chmod로 맞춘다.
    for (const path of [base, keyDir, dir]) deps.fs.chmod(path, DIR_MODE);
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `cannot prepare the run directory: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      },
    };
  }
  return {
    ok: true,
    value: { dir, socket, shim: `${dir}/browser`, script: `${dir}/browser.js` },
  };
}
