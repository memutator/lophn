import { spawn as spawnNode } from "node:child_process";
import { armTimer, pause } from "./deadline.ts";

// 설치 환경의 고정 OS adapter 진입점(architecture 2.4). Deno.kill(-pid, ...)은 Deno 2.9.7에서
// scoped --allow-run으로는 NotCapable이고 unscoped --allow-run을 요구해 core의 좁힌 권한과
// 부딪힌다(실측). core의 --allow-run은 이 경로 하나만 더 연다. fallback은 없다.
const KILL_UTILITY = "/usr/bin/kill";
// procps-ng kill이 env:{}(C locale)에서 ESRCH를 알리는 문구. exit code는 ESRCH·EPERM 모두 1이라
// 이 문구가 있을 때만 "group이 없다"로 센다. EPERM 등은 확인 불가다.
const NO_SUCH_PROCESS = "No such process";
const ADAPTER_STDERR_MAX = 512;
export const ADAPTER_MS = 1_000;
export const GROUP_CONFIRM_MS = 1_000;
const GROUP_POLL_MS = 10;

// ok: 대상이 있었고 신호가 갔다. absent: 대상 process(group)가 없다. failed: 그 밖(확인 불가).
type AdapterResult = "ok" | "absent" | "failed";

function runKillUtility(args: string[]): Promise<AdapterResult> {
  return new Promise((resolve) => {
    let settled = false;
    let text = "";
    const timer = armTimer(ADAPTER_MS);
    const finish = (result: AdapterResult) => {
      if (settled) return;
      settled = true;
      timer.cancel();
      resolve(result);
    };
    let utility;
    try {
      utility = spawnNode(KILL_UTILITY, args, {
        shell: false,
        // 부모의 NODE_V8_COVERAGE도 넘기지 않는다(process.ts의 narrowEnv와 같은 이유).
        env: { NODE_V8_COVERAGE: undefined } as unknown as Record<
          string,
          string
        >,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      // NotCapable(권한 없음)과 실행 실패 모두 여기로 온다.
      finish("failed");
      return;
    }
    const running = utility;
    timer.promise.then(() => {
      finish("failed");
      try {
        running.kill("SIGKILL");
      } catch { /* adapter 자체를 못 끝내도 결과는 이미 failed다 */ }
    });
    running.stderr?.on("data", (chunk: Uint8Array) => {
      if (text.length >= ADAPTER_STDERR_MAX) return;
      text += new TextDecoder().decode(chunk).slice(
        0,
        ADAPTER_STDERR_MAX - text.length,
      );
    });
    running.stderr?.on("error", () => {});
    running.on("error", () => finish("failed"));
    // close는 adapter의 stderr까지 다 읽은 뒤에 온다.
    running.on("close", (code: number | null) => {
      if (code === 0) finish("ok");
      else if (code === 1 && text.includes(NO_SUCH_PROCESS)) finish("absent");
      else finish("failed");
    });
  });
}

// pid 1 이하(-1은 "내가 신호할 수 있는 모든 process"다)는 group 대상이 될 수 없다.
function groupTarget(pid: number): string | undefined {
  return Number.isSafeInteger(pid) && pid > 1 ? `-${pid}` : undefined;
}

export function signalGroup(pid: number): Promise<AdapterResult> {
  const target = groupTarget(pid);
  if (!target) return Promise.resolve("failed");
  return runKillUtility(["-9", "--", target]);
}

// 신호 0으로 group에 남은 process가 없음을 ms 안에 확인해야 true다. EPERM·adapter 실패는 false다.
export async function confirmGroupGone(
  pid: number,
  ms: number,
): Promise<boolean> {
  const target = groupTarget(pid);
  if (!target) return false;
  const timer = armTimer(ms);
  let expired = false;
  timer.promise.then(() => {
    expired = true;
  });
  try {
    while (true) {
      const result = await runKillUtility(["-0", "--", target]);
      if (result === "absent") return true;
      if (result === "failed" || expired) return false;
      await pause(GROUP_POLL_MS);
    }
  } finally {
    timer.cancel();
  }
}

// child를 띄우기 전에 한 번 확인한다. 추가 --allow-read 없이 core 자신의 실제 pid(Deno.pid,
// caller 값이나 PID 파일이 아니다)에 신호 0을 보내 본다. 권한이 없거나 adapter가 없으면 false다.
export async function checkKillAdapter(): Promise<boolean> {
  if (!supportsProcessGroupEnforcement(Deno.build.os)) return false;
  try {
    return (await runKillUtility(["-0", String(Deno.pid)])) === "ok";
  } catch {
    return false;
  }
}

// group 강제 종료는 Linux에서만 실측했다. 다른 OS는 보장할 수 없어 fail-closed로 막는다.
export function supportsProcessGroupEnforcement(os: string): boolean {
  return os === "linux";
}
