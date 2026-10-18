import type { SourceInfo } from "../types.ts";
import { type Deps, REPO_ROOT } from "./registry.ts";

export type Git = (args: string[]) => Promise<string>;

export function denoGit(root: string): Git {
  return async (args) => {
    const out = await new Deno.Command("git", {
      args: ["-C", root, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (out.code !== 0) {
      throw new Error(
        `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
      );
    }
    return new TextDecoder().decode(out.stdout);
  };
}

// 제품 코드(packages, deno.json, deno.lock)의 변경만 센다. runs, registry, scorecards, materials는
// run이 스스로 쓰므로 세면 늘 dirty가 된다.
// desktop core의 deno.lock은 commit하지 않는 file인데 check와 core 기동이 늘 고쳐 둔다.
const TARGET = [
  "packages",
  "deno.json",
  "deno.lock",
  ":(exclude)packages/shell/main/desktop/core/deno.lock",
];

export async function captureSource(
  deps: Deps & { git?: Git } = {},
): Promise<SourceInfo> {
  const git = deps.git ?? denoGit(deps.root ?? REPO_ROOT);
  const commit = (await git(["rev-parse", "HEAD"])).trim();
  const status = await git([
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...TARGET,
  ]);
  if (status === "") return { commit, dirty: false };
  const diff = await git(["diff", "HEAD", "--", ...TARGET]);
  const untracked = status.split("\n").filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3));
  return { commit, dirty: true, diff, untracked };
}
