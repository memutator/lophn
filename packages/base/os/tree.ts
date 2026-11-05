import type { OsPlatform } from "./home.ts";

export type TreeResult = "ok" | "absent" | "failed";

export type TreeDeps = {
  kill(pid: number, signal: NodeJS.Signals | 0): void;
  run(command: string, args: string[]): Promise<{ code: number | null }>;
};

const TASKKILL_NOT_FOUND = 128;
const RUN_TIMEOUT_MS = 1000;

function codeOf(thrown: unknown): unknown {
  return (thrown as { code?: unknown } | null)?.code;
}

// POSIX는 process group(pid가 group leader)에 신호를 보내고, Windows는 신호 구분 없이 taskkill로 트리를 끈다.
export async function signalTree(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
  platform: OsPlatform,
  deps: TreeDeps,
): Promise<TreeResult> {
  if (!Number.isInteger(pid) || pid <= 1) return "failed";
  if (platform === "win32") {
    const { code } = await deps.run("taskkill", [
      "/PID",
      String(pid),
      "/T",
      "/F",
    ]);
    if (code === 0) return "ok";
    return code === TASKKILL_NOT_FOUND ? "absent" : "failed";
  }
  try {
    deps.kill(-pid, signal);
    return "ok";
  } catch (thrown) {
    return codeOf(thrown) === "ESRCH" ? "absent" : "failed";
  }
}

// 신호 0으로 트리가 남았는지 본다. Windows에는 group이 없어 root pid만 본다.
export function treeGone(
  pid: number,
  platform: OsPlatform,
  deps: Pick<TreeDeps, "kill">,
): boolean {
  try {
    deps.kill(platform === "win32" ? pid : -pid, 0);
    return false;
  } catch (thrown) {
    return codeOf(thrown) === "ESRCH";
  }
}

export function nodeTreeDeps(): TreeDeps {
  const { spawn } = process.getBuiltinModule("node:child_process");
  return {
    kill: (pid, signal) => {
      process.kill(pid, signal);
    },
    run: (command, args) =>
      new Promise((resolve) => {
        const child = spawn(command, args, { stdio: "ignore" });
        const timer = setTimeout(() => {
          child.kill();
          resolve({ code: null });
        }, RUN_TIMEOUT_MS);
        child.once("error", () => {
          clearTimeout(timer);
          resolve({ code: null });
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          resolve({ code });
        });
      }),
  };
}
