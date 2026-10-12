// 앱 socket 디렉터리. slug는 경로에 넣지 않고 무작위 파일 이름만 쓴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  APP_SOCKET_SLOTS,
  appBrokerSocketPath,
  appDirectSocketPath,
  SOCKET_PATH_MAX_BYTES,
} from "../../../protocol/apps/mod.ts";

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

// 앱 socket 자리의 수. Deno의 net 허락은 `unix:<정확한 경로>`뿐이라(폴더 prefix도 와일드카드도
// 없다) supervisor가 앱 socket에 연결하려면 경로를 시작 전에 허락 목록에 넣어야 한다. 그래서
// 앱 socket은 시작마다 새 무작위 이름이 아니라 이 고정 자리의 경로이고, 앱 하나는 자리 하나를
// 계속 쓴다(slug를 경로에 넣지 않는다, R6). 자리가 다 차면 새 앱은 시작하지 않는다.
export const SOCKET_SLOTS = APP_SOCKET_SLOTS;

export function slotSockets(
  directory: string,
  slot: number,
): Result<{ brokerSocket: string; directSocket: string }, SocketDirError> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SOCKET_SLOTS) {
    return fail("socket slot is out of range");
  }
  const brokerSocket = appBrokerSocketPath(directory, slot);
  const directSocket = appDirectSocketPath(directory, slot);
  for (const path of [brokerSocket, directSocket]) {
    if (byteLength(path) >= SOCKET_PATH_MAX_BYTES) {
      return fail("socket path exceeds the byte limit");
    }
  }
  return ok({ brokerSocket, directSocket });
}

// 허락 목록용: 모든 자리의 socket 경로.
export function allSlotSockets(directory: string): string[] {
  const paths: string[] = [];
  for (let slot = 0; slot < SOCKET_SLOTS; slot++) {
    const made = slotSockets(directory, slot);
    if (made.ok) paths.push(made.value.brokerSocket, made.value.directSocket);
  }
  return paths;
}
