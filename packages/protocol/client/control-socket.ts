import {
  err,
  ipcPath,
  ipcPathLimit,
  ok,
  type OsPlatform,
  type Result,
  socketDirectoryPath,
} from "../../base/mod.ts";

// data root 아래 core control socket의 자리. core와 그 client(shell main·CLI)가 같은 함수를 쓴다.
// POSIX는 공용 socket 자리의 `core.sock`, Windows는 data root로 나뉜 named pipe다.
export type CoreSocketPathDeps = {
  dataRoot: string;
  platform: OsPlatform;
  // XDG_RUNTIME_DIR. 없으면 사용자별 임시 디렉터리를 쓴다.
  xdgRuntimeDir: string | undefined;
  // 사용자별 임시 디렉터리의 부모(보통 OS tmp).
  tempParent: string;
  uid: number;
  // 동기 SHA-256 hex. protocol은 node를 import하지 않아 부르는 쪽이 넘긴다.
  hash(text: string): string;
};

type CoreSocketPathError = { code: "invalid_input"; message: string };

export function coreSocketPath(
  deps: CoreSocketPathDeps,
): Result<string, CoreSocketPathError> {
  const directory = socketDirectoryPath(deps);
  if (!directory.ok) return err(directory.error);
  const path = ipcPath(directory.value, "core", deps.platform);
  if (new TextEncoder().encode(path).length > ipcPathLimit(deps.platform)) {
    return err({
      code: "invalid_input",
      message: "core socket 경로가 byte 한도를 넘는다",
    });
  }
  return ok(path);
}
