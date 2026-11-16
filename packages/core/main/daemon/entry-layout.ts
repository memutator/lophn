import { join } from "node:path";

// shell(Electron 앱)의 소스 folder. 개발 저장소에는 있고 설치 묶음의 platform/에는 없다(shell은 Electron 앱 쪽이다).
export const shellFolder = (platformRoot: string) =>
  join(platformRoot, "packages", "shell");

// 설치 layout인지 가르는 단 하나의 판정이다. 개발·test core는 저장소 layout이라 사람의 OS에 아무것도 등록하지 않는다.
export function installedLayout(
  platformRoot: string,
  exists: (path: string) => boolean,
): boolean {
  return !exists(shellFolder(platformRoot));
}
