// 새 worktree가 npm ci 없이 check를 돌게 root node_modules를 main checkout에서 잇는다.
// 실행: deno run -A tools/worktree-prep.ts <worktree 경로>
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { lstat, realpath, symlink } from "node:fs/promises";
import process from "node:process";

const MODULES = "node_modules";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  const child = spawn("git", ["-C", cwd, ...args], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stdout: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  return code === 0
    ? new TextDecoder().decode(Buffer.concat(stdout)).trim()
    : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

const arg = process.argv.slice(2)[0];
if (!arg) fail("사용법: deno run -A tools/worktree-prep.ts <worktree 경로>");
const worktree = await realpath(arg).catch(() => null);
if (!worktree) fail(`worktree가 없다: ${arg}`);

const top = await git(worktree, "rev-parse", "--show-toplevel");
if (top === null || (await realpath(top)) !== worktree) {
  fail(`worktree가 아니다: ${arg}`);
}
const common = await git(
  worktree,
  "rev-parse",
  "--path-format=absolute",
  "--git-common-dir",
);
if (common === null) fail(`worktree가 아니다: ${arg}`);
const main = common.replace(/\/[^/]+$/, "");

const target = `${worktree}/${MODULES}`;
if (await exists(target)) process.exit(0);
const source = `${main}/${MODULES}`;
if (!(await exists(source))) {
  fail("main checkout에서 `npm install`을 먼저 돌린다.");
}
await symlink(source, target);
console.log(`${target} -> ${source}`);
