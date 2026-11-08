// 앱 socket 디렉터리. slug는 경로에 넣지 않는다. Windows는 디렉터리 없이 pipe 이름만 낸다.
import { createHash } from "node:crypto";
import process from "node:process";
import {
  err,
  ipcPathLimit,
  ok,
  type Result,
  socketDirectoryPath,
} from "../../../../base/mod.ts";
import {
  APP_SOCKET_SLOTS,
  appBrokerSocketPath,
  appDirectSocketPath,
} from "../../../../protocol/apps/mod.ts";

type SocketDirError = { code: "invalid_input"; message: string };

type SocketDirectory = {
  // POSIX는 만든 디렉터리, Windows는 pipe 이름을 가르는 key(data root)다.
  directory: string;
};

type SocketDirDeps = {
  // data root마다 폴더를 나눈다. 같은 계정에서 lophn이 여럿 떠도 서로의 socket을 지우지 않는다.
  dataRoot: string;
  xdgRuntimeDir: string | undefined;
  uid: number;
  // 0700 디렉터리를 만든다. 이미 있으면 그대로 둔다.
  ensureDir: (path: string, mode: number) => void;
  // 사용자별 임시 디렉터리의 부모(보통 OS tmp).
  tempParent: string;
  platform?: string;
};

const MODE = 0o700;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(message: string): Result<never, SocketDirError> {
  return err({ code: "invalid_input", message });
}

// data root의 자리 규칙은 base에 있다. 여기서는 Node hash와 0700 폴더 만들기를 연결한다.
export function createSocketDirectory(
  deps: SocketDirDeps,
): Result<SocketDirectory, SocketDirError> {
  const platform = deps.platform ?? process.platform;
  const directory = socketDirectoryPath({
    dataRoot: deps.dataRoot,
    xdgRuntimeDir: deps.xdgRuntimeDir,
    tempParent: deps.tempParent,
    uid: deps.uid,
    platform,
    hash: (text) => createHash("sha256").update(text).digest("hex"),
  });
  if (!directory.ok) return err(directory.error);
  if (platform !== "win32") deps.ensureDir(directory.value, MODE);
  return ok({ directory: directory.value });
}

// 앱 socket 자리의 수. 앱 하나는 자리 하나를 계속 써서 같은 앱이 다시 떠도 socket 경로가 같다.
// 그러면 이전 자식이 남긴 파일을 새 자식 전에 같은 경로에서 지울 수 있고, 자리마다 경로가 짧아
// socket 경로 한도 안에 든다(slug를 경로에 넣지 않는다). 자리가 다 차면 새 앱은 시작하지 않는다.
export const SOCKET_SLOTS = APP_SOCKET_SLOTS;

export function slotSockets(
  directory: string,
  slot: number,
  platform: string = process.platform,
): Result<{ brokerSocket: string; controlSocket: string }, SocketDirError> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SOCKET_SLOTS) {
    return fail("socket slot is out of range");
  }
  const brokerSocket = appBrokerSocketPath(directory, slot, platform);
  const controlSocket = appDirectSocketPath(directory, slot, platform);
  for (const path of [brokerSocket, controlSocket]) {
    if (byteLength(path) > ipcPathLimit(platform)) {
      return fail("socket path exceeds the byte limit");
    }
  }
  return ok({ brokerSocket, controlSocket });
}
