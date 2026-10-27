// 앱 socket 디렉터리. slug는 경로에 넣지 않고 무작위 파일 이름만 쓴다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  APP_SOCKET_SLOTS,
  appBrokerSocketPath,
  appDirectSocketPath,
  SOCKET_PATH_MAX_BYTES,
} from "../../../../protocol/apps/mod.ts";

type SocketDirError = { code: "invalid_input"; message: string };

type SocketDirectory = {
  directory: string;
  brokerSocket: string;
  controlSocket: string;
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
  randomName: () => string;
};

const MODE = 0o700;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(message: string): Result<never, SocketDirError> {
  return err({ code: "invalid_input", message });
}

// data root 절대 경로의 짧은 hash. socket 폴더 이름이다.
function socketRootKey(dataRoot: string): string {
  return createHash("sha256").update(dataRoot).digest("hex").slice(0, 12);
}

// XDG runtime이 있으면 거기를, 없으면 사용자별 0700 임시 디렉터리를 쓴다.
// 어느 쪽이든 경로가 104byte를 넘으면 거절한다. TCP로 바꾸지 않는다.
export function createSocketDirectory(
  deps: SocketDirDeps,
): Result<SocketDirectory, SocketDirError> {
  if (!Number.isSafeInteger(deps.uid) || deps.uid < 0) {
    return fail("uid is not valid");
  }
  const base =
    deps.xdgRuntimeDir && deps.xdgRuntimeDir.length > 0
      ? `${deps.xdgRuntimeDir}/lophn`
      : `${deps.tempParent}/lophn-${deps.uid}`;
  const directory = `${base}/${socketRootKey(deps.dataRoot)}`;
  const brokerSocket = `${directory}/b-${deps.randomName()}.sock`;
  const controlSocket = `${directory}/a-${deps.randomName()}.sock`;
  for (const path of [directory, brokerSocket, controlSocket]) {
    if (byteLength(path) >= SOCKET_PATH_MAX_BYTES) {
      return fail("socket path exceeds the byte limit");
    }
  }
  deps.ensureDir(directory, MODE);
  return ok({ directory, brokerSocket, controlSocket });
}

// 앱 socket 자리의 수. 앱 하나는 자리 하나를 계속 써서 같은 앱이 다시 떠도 socket 경로가 같다.
// 그러면 이전 자식이 남긴 파일을 새 자식 전에 같은 경로에서 지울 수 있고, 자리마다 경로가 짧아
// 104byte 한도 안에 든다(slug를 경로에 넣지 않는다). 자리가 다 차면 새 앱은 시작하지 않는다.
export const SOCKET_SLOTS = APP_SOCKET_SLOTS;

export function slotSockets(
  directory: string,
  slot: number,
): Result<{ brokerSocket: string; controlSocket: string }, SocketDirError> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SOCKET_SLOTS) {
    return fail("socket slot is out of range");
  }
  const brokerSocket = appBrokerSocketPath(directory, slot);
  const controlSocket = appDirectSocketPath(directory, slot);
  for (const path of [brokerSocket, controlSocket]) {
    if (byteLength(path) >= SOCKET_PATH_MAX_BYTES) {
      return fail("socket path exceeds the byte limit");
    }
  }
  return ok({ brokerSocket, controlSocket });
}
