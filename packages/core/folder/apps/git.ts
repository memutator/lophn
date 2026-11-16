// 앱 source의 git. 사람의 git 설정(global·system, hook, 서명)을 읽지 않고 묻지 않고 바로 실패한다(registration/source-folder.ts와 같은 꼴).
// 기계 사이 source는 증분 bundle이고 받는 쪽은 `refs/remotes/<mch>/*`로 fetch만 한다: 사람의 branch, HEAD, 작업 tree는 건드리지 않는다.
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import process from "node:process";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";

const OUTPUT_MAX = 256 * 1024;
const COMMIT = /^[0-9a-f]{40}$/;

export async function git(
  dir: string,
  ...args: string[]
): Promise<Result<string>> {
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("git", ["-C", dir, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return err({ code: "unavailable", message: "git could not start" });
  }
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (stdout.length < OUTPUT_MAX) stdout += chunk;
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (stderr.length < OUTPUT_MAX) stderr += chunk;
  });
  const code = await new Promise<number | null | "missing">((resolve) => {
    child.on("error", (error: NodeJS.ErrnoException) =>
      resolve(error.code === "ENOENT" ? "missing" : null),
    );
    child.on("close", resolve);
  });
  if (code === "missing") {
    return err({ code: "unavailable", message: "git is not installed" });
  }
  return code === 0
    ? ok(stdout.trim())
    : err({
        code: "unavailable",
        message: `git ${args[0]} failed: ${stderr.trim().slice(0, 500)}`,
      });
}

/** `refs/heads/*`의 이름 → commit. */
export async function branchHeads(
  repo: string,
): Promise<Result<Record<string, string>>> {
  const listed = await git(
    repo,
    "for-each-ref",
    "--format=%(objectname) %(refname)",
    "refs/heads/",
  );
  if (!listed.ok) return listed;
  const heads: Record<string, string> = {};
  for (const line of listed.value.split("\n")) {
    const [sha, ref] = line.split(" ");
    if (sha !== undefined && ref !== undefined && COMMIT.test(sha)) {
      heads[ref] = sha;
    }
  }
  return ok(heads);
}

// 이 기계 branch에서 `excluded`와 다른 기계에서 받은 것(`refs/remotes/*`)을 뺀 commit 수.
export async function newCommitCount(
  repo: string,
  excluded: readonly string[],
): Promise<Result<number>> {
  const counted = await git(
    repo,
    "rev-list",
    "--count",
    "--ignore-missing",
    "--branches",
    "--not",
    "--remotes",
    ...excluded,
  );
  return counted.ok ? ok(Number(counted.value)) : counted;
}

export function createBundle(
  repo: string,
  file: string,
  excluded: readonly string[],
): Promise<Result<string>> {
  return git(
    repo,
    "bundle",
    "create",
    "-q",
    file,
    "--branches",
    "--not",
    "--remotes",
    ...excluded,
  );
}

const HEADER_MAX = 1024 * 1024;

/** bundle 머리의 prerequisite commit(`-<sha>` 줄). git을 띄우지 않고 file 앞만 읽는다. */
export async function bundlePrerequisites(
  file: string,
): Promise<Result<string[]>> {
  let text: string;
  try {
    const handle = await open(file, "r");
    try {
      const bytes = new Uint8Array(HEADER_MAX);
      const { bytesRead } = await handle.read(bytes, 0, HEADER_MAX, 0);
      text = new TextDecoder("latin1").decode(bytes.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return err({ code: "unavailable", message: "the bundle cannot be read" });
  }
  const end = text.indexOf("\n\n");
  if (!/^# v[23] git bundle\n/.test(text) || end < 0) {
    return err({ code: "invalid_input", message: "not a git bundle" });
  }
  return ok(
    text
      .slice(0, end)
      .split("\n")
      .filter((line) => line.startsWith("-"))
      .map((line) => line.slice(1, 41))
      .filter((sha) => COMMIT.test(sha)),
  );
}

export async function hasCommit(repo: string, sha: string): Promise<boolean> {
  return (await git(repo, "cat-file", "-e", `${sha}^{commit}`)).ok;
}

// bundle의 branch를 `refs/remotes/<mch>/*`로만 받는다. 다른 기계의 branch를 그대로 비추므로 강제로 옮긴다.
export async function fetchBundle(
  repo: string,
  file: string,
  origin: Id<"mch">,
): Promise<Result<void>> {
  const verified = await git(repo, "bundle", "verify", "-q", file);
  if (!verified.ok) {
    return err({ code: "invalid_input", message: verified.error.message });
  }
  const fetched = await git(
    repo,
    "fetch",
    "-q",
    "--no-tags",
    "--no-write-fetch-head",
    file,
    `+refs/heads/*:refs/remotes/${origin}/*`,
  );
  return fetched.ok ? ok(undefined) : fetched;
}

// 새 저장소. 이어서 앱 workspace의 session이 commit할 때 사람의 전역 이름에 기대지 않게 저장소 안 설정을 남긴다.
export async function initRepository(dir: string): Promise<Result<void>> {
  for (const step of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "lophn"],
    ["config", "user.email", "lophn@localhost"],
    ["config", "commit.gpgsign", "false"],
  ]) {
    const done = await git(dir, ...step);
    if (!done.ok) return done;
  }
  return ok(undefined);
}

// 처음 만든 저장소에서만 부른다: main을 그 commit에 두고 작업 tree를 채운다.
export async function checkoutMain(
  dir: string,
  commit: string,
): Promise<Result<void>> {
  const moved = await git(dir, "update-ref", "refs/heads/main", commit);
  if (!moved.ok) return moved;
  const reset = await git(dir, "reset", "-q", "--hard", "main");
  return reset.ok ? ok(undefined) : reset;
}
