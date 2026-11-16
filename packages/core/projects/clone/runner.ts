// 사람의 git 설정(credential helper, ssh)을 그대로 쓰는 git clone이다. 묻는 창이 뜨면 기다리다 멈추므로
// 묻지 않고 바로 실패하게 env를 막는다.
import { spawn } from "node:child_process";
import process from "node:process";

export const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

export type CloneRun =
  | { kind: "done"; code: number | null; stderr: string }
  | { kind: "not_found" }
  | { kind: "timeout" };

export type CloneRunner = (args: {
  argv: readonly string[];
  timeoutMs: number;
}) => Promise<CloneRun>;

// stderr는 끝 줄만 쓰므로 뒤쪽 일부만 모은다.
const STDERR_MAX = 16 * 1024;

export function cloneEnv(
  parent: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const ssh = parent["GIT_SSH_COMMAND"];
  return {
    ...parent,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    GIT_SSH_COMMAND:
      ssh === undefined || ssh === ""
        ? "ssh -o BatchMode=yes"
        : `${ssh} -o BatchMode=yes`,
  };
}

export const gitCloneRunner: CloneRunner = ({ argv, timeoutMs }) => {
  const child = spawn("git", [...argv], {
    env: cloneEnv(process.env),
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_MAX);
  });
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(
        error.code === "ENOENT"
          ? { kind: "not_found" }
          : { kind: "done", code: null, stderr: error.message },
      );
    });
    // exit가 아니라 close를 기다려 stderr를 다 받은 뒤에 판정한다.
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(timedOut ? { kind: "timeout" } : { kind: "done", code, stderr });
    });
  });
};
