import { spawn } from "node:child_process";
import process from "node:process";
import { nodeTreeDeps, signalTree } from "../../../base/mod.ts";

// 신호와 확인이 같은 deps를 쓴다(responsiveness/group.ts).
export const treeDeps = nodeTreeDeps(spawn);

// 트리를 끝내려는 child의 spawn option이다. POSIX는 detached로 group leader(pid=pgid)가 되고,
// Windows의 detached는 새 console을 열 뿐이라 쓰지 않는다(트리는 taskkill이 끈다).
export function treeSpawnOptions(platform: string = process.platform): {
  detached: boolean;
  windowsHide: true;
} {
  return { detached: platform !== "win32", windowsHide: true };
}

// `treeSpawnOptions`로 띄운 child의 트리를 SIGKILL한다. 이미 끝났어도 던지지 않는다.
export function killTree(
  child: { pid?: number | undefined },
  platform: string = process.platform,
): void {
  if (child.pid === undefined) return;
  void signalTree(child.pid, "SIGKILL", platform, treeDeps);
}
