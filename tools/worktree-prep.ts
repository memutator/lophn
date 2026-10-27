// 새 worktree에 자기 node_modules를 만들고 Electron binary까지 받는다.
// npm workspace의 `@lophn/*`는 상대 경로 symlink라 다른 checkout의 node_modules를 빌려 쓰면
// 그 package가 다른 checkout을 가리킨다.
// 실행: deno run -A tools/worktree-prep.ts <worktree 경로>
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
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

async function run(
  cwd: string,
  command: string,
  args: string[],
): Promise<void> {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) fail(`${command} ${args.join(" ")}가 실패했다`);
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

const target = `${worktree}/${MODULES}`;
if (!(await exists(target))) {
  await run(worktree, "npm", [
    "ci",
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
  ]);
}
// npm ci의 postinstall이 건너뛰어졌으면 require가 binary를 받는다. 이미 받았으면 그냥 지나간다.
await run(worktree, "node", ["-e", "require('electron')"]);
console.log(`${target} 준비 완료`);
