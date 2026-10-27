import { spawn } from "node:child_process";
import type { SourceInfo } from "../types.ts";
import { type Deps, REPO_ROOT } from "./registry.ts";

export type Git = (args: string[]) => Promise<string>;

function output(
  cmd: string,
  args: string[],
): Promise<{ code: number | null; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
      });
    });
  });
}

export function denoGit(root: string): Git {
  return async (args) => {
    const out = await output("git", ["-C", root, ...args]);
    if (out.code !== 0) {
      throw new Error(`git ${args.join(" ")}: ${out.stderr.toString("utf8")}`);
    }
    return out.stdout.toString("utf8");
  };
}

// 제품 코드(packages, deno.json, deno.lock)의 변경만 센다. runs, registry, scorecards, materials는
// run이 스스로 쓰므로 세면 늘 dirty가 된다.
const TARGET = ["packages", "deno.json", "deno.lock"];

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
  const untracked = status
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3));
  return { commit, dirty: true, diff, untracked };
}
