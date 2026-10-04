// 앱 socket 디렉터리. slug는 경로에 넣지 않고 무작위 파일 이름만 쓴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { SOCKET_PATH_MAX_BYTES } from "../../../contracts/apps/mod.ts";

export type SocketDirError = { code: "invalid_input"; message: string };

export type SocketDirectory = {
  directory: string;
  brokerSocket: string;
  directSocket: string;
};

export type SocketDirDeps = {
  xdgRuntimeDir: string | undefined;
  uid: number;
  // 0700 디렉터리를 만든다. 이미 있으면 그대로 둔다.
  ensureDir: (path: string, mode: number) => void;
  // 사용자별 임시 디렉터리의 부모(보통 OS tmp).
  tempParent: string;
  randomName: () => string;
};

const MODE = 0o700;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(message: string): Result<never, SocketDirError> {
  return err({ code: "invalid_input", message });
}

// XDG runtime이 있으면 거기를, 없으면 사용자별 0700 임시 디렉터리를 쓴다.
// 어느 쪽이든 경로가 104byte를 넘으면 거절한다. TCP로 바꾸지 않는다.
export function createSocketDirectory(
  deps: SocketDirDeps,
): Result<SocketDirectory, SocketDirError> {
  if (!Number.isSafeInteger(deps.uid) || deps.uid < 0) {
    return fail("uid is not valid");
  }
  const directory = deps.xdgRuntimeDir && deps.xdgRuntimeDir.length > 0
    ? `${deps.xdgRuntimeDir}/lophn`
    : `${deps.tempParent}/lophn-${deps.uid}`;
  const brokerSocket = `${directory}/b-${deps.randomName()}.sock`;
  const directSocket = `${directory}/a-${deps.randomName()}.sock`;
  for (const path of [directory, brokerSocket, directSocket]) {
    if (byteLength(path) >= SOCKET_PATH_MAX_BYTES) {
      return fail("socket path exceeds the byte limit");
    }
  }
  deps.ensureDir(directory, MODE);
  return ok({ directory, brokerSocket, directSocket });
}
