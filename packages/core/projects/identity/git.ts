// project 폴더의 git을 읽기만 한다. 이 type에 쓰기 동작을 두지 않는다: lophn은 사람의 저장소에 add·commit·checkout을 하지 않는다.
import { spawn } from "node:child_process";
import process from "node:process";

import type { Logger } from "../../../base/mod.ts";

export type GitReader = {
  // work tree의 맨 위. work tree가 아니거나 git이 없으면 null이다.
  topLevel(dir: string): Promise<string | null>;
  // fetch remote만.
  remotes(dir: string): Promise<{ name: string; url: string }[]>;
  // 지금 branch와 HEAD commit. git이 아니거나 읽지 못하면 둘 다 null이고, HEAD가 branch에 있지 않으면 branch만 null이다.
  head(dir: string): Promise<{ branch: string | null; commit: string | null }>;
};

const GIT_TIMEOUT_MS = 10_000;
const GIT_OUTPUT_MAX = 64 * 1024;
const GIT_NOT_FOUND =
  "git was not found; install git and make sure it is on PATH";

type Ran = { code: number; stdout: string } | "not_found";

function run(args: readonly string[]): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      // status가 사람의 index를 고쳐 쓰지 않게, 자격을 묻는 창을 띄우지 않게 한다. 사람의 git 설정은 그대로 읽는다.
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < GIT_OUTPUT_MAX) stdout += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolve("not_found");
      else reject(error);
    });
    child.on("close", (code, signal) => {
      if (signal !== null) reject(new Error(`git ${args[2]} timed out`));
      else
        resolve({ code: code ?? 1, stdout: stdout.slice(0, GIT_OUTPUT_MAX) });
    });
  });
}

export function createGitReader(deps: { logger: Logger }): GitReader {
  const git = async (dir: string, ...args: string[]) => {
    const ran = await run(["-C", dir, ...args]);
    if (ran === "not_found") {
      deps.logger.warn({
        component: "projects-identity",
        event: "git_not_found",
        message: GIT_NOT_FOUND,
      });
      return null;
    }
    return ran;
  };
  return {
    async topLevel(dir) {
      const ran = await git(dir, "rev-parse", "--show-toplevel");
      return ran === null || ran.code !== 0 ? null : ran.stdout.trim() || null;
    },
    async remotes(dir) {
      const ran = await git(dir, "remote", "-v");
      if (ran === null || ran.code !== 0) return [];
      return ran.stdout.split(/\r?\n/).flatMap((line) => {
        const found = /^(\S+)\s+(.+?)\s+\(fetch\)$/.exec(line);
        return found === null ? [] : [{ name: found[1]!, url: found[2]! }];
      });
    },
    async head(dir) {
      const read = async (...args: string[]) => {
        try {
          const ran = await git(dir, "rev-parse", ...args);
          return ran === null || ran.code !== 0
            ? null
            : ran.stdout.trim() || null;
        } catch {
          // 시간이 다 됐다.
          return null;
        }
      };
      const commit = await read("HEAD");
      if (commit === null) return { branch: null, commit: null };
      const branch = await read("--abbrev-ref", "HEAD");
      return { branch: branch === "HEAD" ? null : branch, commit };
    },
  };
}
