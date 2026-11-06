// 앱 socket 자리(고정 slot)의 이름이다. 앱 socket은 시작마다 새 이름이 아니라 이 고정 자리이고, runtime(앱
// 시작)과 MCP 실행 권한(앱 direct socket 연결)이 같은 이름을 쓴다. 이름 규칙은 이 한 곳에만 둔다.
// POSIX는 `<dir>/b0.sock`, Windows는 named pipe다(base의 ipcPath).
import { ipcPath, type OsPlatform } from "../../base/mod.ts";

export const APP_SOCKET_SLOTS = 64;

export function appBrokerSocketPath(
  directory: string,
  slot: number,
  platform: OsPlatform,
): string {
  return ipcPath(directory, `b${slot}`, platform);
}

export function appDirectSocketPath(
  directory: string,
  slot: number,
  platform: OsPlatform,
): string {
  return ipcPath(directory, `a${slot}`, platform);
}

// 모든 자리의 direct socket 경로다. MCP 실행 권한이 이 경로 각각만 허락한다.
export function appDirectSocketPaths(
  directory: string,
  platform: OsPlatform,
): string[] {
  return Array.from({ length: APP_SOCKET_SLOTS }, (_, slot) =>
    appDirectSocketPath(directory, slot, platform),
  );
}
