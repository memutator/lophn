import process from "node:process";
import { signalTree, type TreeResult, treeGone } from "../../../base/mod.ts";
import { treeDeps } from "../security/tree-kill.ts";
import { armTimer, pause } from "./deadline.ts";

// Windows의 taskkill 한 번이 base에서 갖는 기한(RUN_TIMEOUT_MS)이다. POSIX 신호는 바로 끝난다.
export const SIGNAL_MS = 1_000;
export const GROUP_CONFIRM_MS = 1_000;
const GROUP_POLL_MS = 10;

// pid 1 이하(-1은 "내가 신호할 수 있는 모든 process"다)는 group 대상이 될 수 없다. base의 signalTree가 failed로 막는다.
export function signalGroup(
  pid: number,
  platform: string = process.platform,
): Promise<TreeResult> {
  return signalTree(pid, "SIGKILL", platform, treeDeps);
}

// 신호 0으로 group에 남은 process가 없음을 ms 안에 확인해야 true다. EPERM 등 확인 불가는 false다.
export async function confirmGroupGone(
  pid: number,
  ms: number,
  platform: string = process.platform,
): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  const timer = armTimer(ms);
  let expired = false;
  timer.promise.then(() => {
    expired = true;
  });
  try {
    while (true) {
      if (treeGone(pid, platform, treeDeps)) return true;
      if (expired) return false;
      await pause(GROUP_POLL_MS);
    }
  } finally {
    timer.cancel();
  }
}
