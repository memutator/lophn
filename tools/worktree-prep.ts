// 새 worktree가 npm ci 없이 check를 돌게 shell main의 node_modules를 main checkout에서 잇는다.
// 실행: deno run -A tools/worktree-prep.ts <worktree 경로>
const MODULES = "packages/shell/main/node_modules";

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  const out = await new Deno.Command("git", {
    args: ["-C", cwd, ...args],
    stdout: "piped",
    stderr: "null",
  }).output();
  return out.code === 0 ? new TextDecoder().decode(out.stdout).trim() : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

const arg = Deno.args[0];
if (!arg) fail("사용법: deno run -A tools/worktree-prep.ts <worktree 경로>");
const worktree = await Deno.realPath(arg).catch(() => null);
if (!worktree) fail(`worktree가 없다: ${arg}`);

const top = await git(worktree, "rev-parse", "--show-toplevel");
if (top === null || await Deno.realPath(top) !== worktree) {
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
if (await exists(target)) Deno.exit(0);
const source = `${main}/${MODULES}`;
if (!await exists(source)) {
  fail(
    "main checkout에서 `npm --prefix packages/shell/main ci`를 먼저 돌린다.",
  );
}
await Deno.symlink(source, target);
console.log(`${target} -> ${source}`);
