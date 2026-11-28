// 하드닝된 git 실행기, git_common_dir별 직렬 mutex, 상태·목록 파서, base ref 해석과 비대화형 fetch, Windows/WSL prune 방어.
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  open,
  readdir,
  readFile,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import type { WorktreeGitStatus } from "../../../protocol/projects/worktrees.ts";
import { assertSafeRefName, safeRealpath } from "./paths.ts";

export const GIT_DEFAULT_TIMEOUT_MS = 30_000;
export const GIT_FETCH_TIMEOUT_MS = 25_000;
const GIT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const LOCK_RETRY_DELAYS_MS = [50, 150, 400] as const;

export type GitRunResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  notFound: boolean;
};

export type GitRunner = (
  cwd: string,
  args: readonly string[],
  options?: {
    timeoutMs?: number;
    stdin?: string;
    maxOutputBytes?: number;
    retryLocks?: boolean;
    extraEnv?: Readonly<Record<string, string>>;
  },
) => Promise<GitRunResult>;

// git stderr에 원격 URL의 user:token@ 자격증명이 섞여 나올 때 마스킹한다(SSH git@host는 유지).
export function redactGitUrlCredentials(text: string): string {
  return text.replace(/(https?:\/\/)[^/\s@'"]+@/gi, "$1[REDACTED]@");
}

function isTransientLockError(stderr: string): boolean {
  return (
    /Unable to create '[^']*\.lock'/i.test(stderr) ||
    /Another git process seems to be running/i.test(stderr) ||
    /could not lock config file/i.test(stderr)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function runGitOnce(
  cwd: string,
  args: readonly string[],
  options?: {
    timeoutMs?: number;
    stdin?: string;
    maxOutputBytes?: number;
    extraEnv?: Readonly<Record<string, string>>;
  },
): Promise<GitRunResult> {
  const timeoutMs = options?.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxOutputBytes ?? GIT_MAX_OUTPUT_BYTES;
  const fullArgs = [
    ...(process.platform === "win32" ? ["-c", "core.longpaths=true"] : []),
    "-C",
    cwd,
    ...args,
  ];
  return new Promise((resolvePromise) => {
    const child = spawn("git", fullArgs, {
      shell: false,
      windowsHide: true,
      stdio: [options?.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
        GIT_ASKPASS: "",
        GIT_OPTIONAL_LOCKS: "0",
        ...(options?.extraEnv ?? {}),
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < maxBytes) {
        const remaining = maxBytes - stdoutBytes;
        const slice =
          chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stdoutChunks.push(slice);
        stdoutBytes += slice.length;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < maxBytes) {
        const remaining = maxBytes - stderrBytes;
        const slice =
          chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stderrChunks.push(slice);
        stderrBytes += slice.length;
      }
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code: 1,
        stdout: "",
        stderr: redactGitUrlCredentials(error.message),
        timedOut: false,
        notFound: error.code === "ENOENT",
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code: timedOut ? 124 : (code ?? 1),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: redactGitUrlCredentials(
          Buffer.concat(stderrChunks).toString("utf8"),
        ),
        timedOut,
        notFound: false,
      });
    });

    if (options?.stdin !== undefined && child.stdin !== null) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin);
    }
  });
}

export const runGit: GitRunner = async (cwd, args, options) => {
  let result = await runGitOnce(cwd, args, options);
  if (options?.retryLocks === true && result.code !== 0 && !result.notFound) {
    for (const delay of LOCK_RETRY_DELAYS_MS) {
      if (!isTransientLockError(result.stderr)) break;
      await sleep(delay);
      result = await runGitOnce(cwd, args, options);
      if (result.code === 0) break;
    }
  }
  return result;
};

// git_common_dir마다 변이 작업(add, remove, prune, branch 변경 등)을 직렬화한다.
export class RepoGitMutex {
  readonly #queues = new Map<string, Promise<unknown>>();

  run<T>(gitCommonDir: string, work: () => Promise<T>): Promise<T> {
    const key =
      process.platform === "win32" ? gitCommonDir.toLowerCase() : gitCommonDir;
    const prev = this.#queues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(work);
    this.#queues.set(key, next);
    void next.finally(() => {
      if (this.#queues.get(key) === next) {
        this.#queues.delete(key);
      }
    });
    return next;
  }
}

export type InspectedGitRepo = {
  repo_root: string;
  git_common_dir: string;
  is_bare: boolean;
  is_unborn: boolean;
  head_sha: string | null;
  branch: string | null;
};

export async function inspectGitRepo(
  dir: string,
  git: GitRunner = runGit,
): Promise<Result<InspectedGitRepo>> {
  const bareCheck = await git(dir, ["rev-parse", "--is-bare-repository"]);
  if (bareCheck.notFound) {
    return err({
      code: "unavailable",
      message: "git was not found on PATH",
      details: { reason: "git_not_found" },
    });
  }
  if (bareCheck.code !== 0) {
    return err({
      code: "invalid_input",
      message: `folder is not a git repository: ${dir}`,
      details: { reason: "not_git_repository" },
    });
  }
  const isBare = bareCheck.stdout.trim() === "true";
  if (isBare) {
    return err({
      code: "invalid_input",
      message: "bare git repositories are not supported for worktrees",
      details: { reason: "bare_repository" },
    });
  }
  const top = await git(dir, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || top.stdout.trim() === "") {
    return err({
      code: "invalid_input",
      message: `folder is not inside a git work tree: ${dir}`,
      details: { reason: "not_git_repository" },
    });
  }
  const common = await git(dir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const commonRaw =
    common.code === 0 && common.stdout.trim() !== ""
      ? common.stdout.trim()
      : (await git(dir, ["rev-parse", "--git-common-dir"])).stdout.trim();
  const repoRoot = safeRealpath(top.stdout.trim());
  const gitCommonDir = safeRealpath(
    isAbsolute(commonRaw) ? commonRaw : resolve(repoRoot, commonRaw),
  );
  const head = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  const isUnborn = head.code !== 0 || head.stdout.trim() === "";
  const branchRes = await git(repoRoot, ["symbolic-ref", "--short", "HEAD"]);
  const branch =
    branchRes.code === 0 && branchRes.stdout.trim() !== ""
      ? branchRes.stdout.trim()
      : null;

  return ok({
    repo_root: repoRoot,
    git_common_dir: gitCommonDir,
    is_bare: false,
    is_unborn: isUnborn,
    head_sha: isUnborn ? null : head.stdout.trim(),
    branch,
  });
}

export type ParsedGitWorktree = {
  path: string;
  head_sha: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  git_admin_name: string | null;
};

export async function readGitdirAdminName(
  worktreePath: string,
  gitCommonDir: string,
): Promise<string | null> {
  const dotGit = join(worktreePath, ".git");
  try {
    const stat = await lstat(dotGit);
    if (!stat.isFile()) return null;
    const text = await readFile(dotGit, "utf8");
    const match = /^gitdir:\s*(.+)$/m.exec(text);
    if (!match?.[1]) return null;
    const raw = match[1].trim();
    const resolved = safeRealpath(
      isAbsolute(raw) ? raw : resolve(worktreePath, raw),
    );
    const worktreesDir = safeRealpath(join(gitCommonDir, "worktrees"));
    const normResolved =
      process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const normWorktrees =
      process.platform === "win32" ? worktreesDir.toLowerCase() : worktreesDir;
    const prefix =
      normWorktrees.endsWith("/") || normWorktrees.endsWith("\\")
        ? normWorktrees
        : `${normWorktrees}${process.platform === "win32" ? "\\" : "/"}`;
    if (!normResolved.startsWith(prefix)) return null;
    const admin = resolved.slice(prefix.length).replace(/[/\\]+$/, "");
    if (admin === "" || admin.includes("/") || admin.includes("\\")) {
      return null;
    }
    return admin;
  } catch {
    return null;
  }
}

// `git worktree list --porcelain -z` 파서.
export async function listGitWorktrees(
  repoRoot: string,
  gitCommonDir: string,
  git: GitRunner = runGit,
): Promise<Result<ParsedGitWorktree[]>> {
  const res = await git(repoRoot, ["worktree", "list", "--porcelain", "-z"]);
  if (res.code !== 0) {
    return err({
      code: "unavailable",
      message: res.stderr.trim() || "failed to list git worktrees",
    });
  }
  const tokens = res.stdout.split("\0");
  const list: ParsedGitWorktree[] = [];
  let current: Partial<ParsedGitWorktree> | null = null;
  const flush = async () => {
    if (current === null || !current.path) return;
    const wtPath = safeRealpath(current.path);
    const admin = await readGitdirAdminName(wtPath, gitCommonDir);
    list.push({
      path: wtPath,
      head_sha: current.head_sha ?? null,
      branch: current.branch ?? null,
      detached: current.detached === true,
      bare: current.bare === true,
      locked: current.locked === true,
      prunable: current.prunable === true,
      git_admin_name: admin,
    });
    current = null;
  };
  for (const token of tokens) {
    if (token === "") {
      await flush();
      continue;
    }
    if (token.startsWith("worktree ")) {
      await flush();
      current = { path: token.slice("worktree ".length) };
    } else if (current !== null) {
      if (token.startsWith("HEAD ")) {
        current.head_sha = token.slice("HEAD ".length).trim() || null;
      } else if (token.startsWith("branch ")) {
        const ref = token.slice("branch ".length).trim();
        current.branch = ref.startsWith("refs/heads/")
          ? ref.slice("refs/heads/".length)
          : ref;
      } else if (token === "detached") {
        current.detached = true;
      } else if (token === "bare") {
        current.bare = true;
      } else if (token === "locked" || token.startsWith("locked ")) {
        current.locked = true;
      } else if (token === "prunable" || token.startsWith("prunable ")) {
        current.prunable = true;
      }
    }
  }
  await flush();
  return ok(list);
}

export type ParsedPorcelainStatus = {
  branch: string | null;
  detached: boolean;
  head_sha: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  conflicted_count: number;
  files: {
    path: string;
    orig_path?: string;
    index_status: string;
    worktree_status: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
    conflicted: boolean;
  }[];
};

// `git --no-optional-locks status --porcelain=v2 --branch --untracked-files=all --ignore-submodules=none -z` 파서.
export function parsePorcelainV2Z(stdout: string): ParsedPorcelainStatus {
  const entries = stdout.split("\0");
  let branch: string | null = null;
  let detached = false;
  let head_sha: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let staged_count = 0;
  let unstaged_count = 0;
  let untracked_count = 0;
  let conflicted_count = 0;
  const files: ParsedPorcelainStatus["files"] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry === "") continue;
    if (entry.startsWith("# ")) {
      if (entry.startsWith("# branch.oid ")) {
        const oid = entry.slice("# branch.oid ".length).trim();
        head_sha = oid === "(initial)" ? null : oid;
      } else if (entry.startsWith("# branch.head ")) {
        const head = entry.slice("# branch.head ".length).trim();
        if (head === "(detached)") {
          branch = null;
          detached = true;
        } else {
          branch = head;
          detached = false;
        }
      } else if (entry.startsWith("# branch.upstream ")) {
        upstream = entry.slice("# branch.upstream ".length).trim() || null;
      } else if (entry.startsWith("# branch.ab ")) {
        const match = /\+(\d+)\s+-(\d+)/.exec(entry);
        if (match) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      }
      continue;
    }

    const tag = entry[0];
    if (tag === "1") {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const xy = entry.slice(2, 4);
      const parts = entry.split(" ");
      const path = parts.slice(8).join(" ");
      const indexStatus = xy[0] ?? ".";
      const wtStatus = xy[1] ?? ".";
      const staged = indexStatus !== ".";
      const unstaged = wtStatus !== ".";
      if (staged) staged_count += 1;
      if (unstaged) unstaged_count += 1;
      files.push({
        path,
        index_status: indexStatus,
        worktree_status: wtStatus,
        staged,
        unstaged,
        untracked: false,
        conflicted: false,
      });
    } else if (tag === "2") {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const xy = entry.slice(2, 4);
      const parts = entry.split(" ");
      const path = parts.slice(9).join(" ");
      const origPath = entries[i + 1];
      if (origPath !== undefined) i += 1;
      const indexStatus = xy[0] ?? ".";
      const wtStatus = xy[1] ?? ".";
      const staged = indexStatus !== ".";
      const unstaged = wtStatus !== ".";
      if (staged) staged_count += 1;
      if (unstaged) unstaged_count += 1;
      files.push({
        path,
        ...(origPath ? { orig_path: origPath } : {}),
        index_status: indexStatus,
        worktree_status: wtStatus,
        staged,
        unstaged,
        untracked: false,
        conflicted: false,
      });
    } else if (tag === "u") {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const xy = entry.slice(2, 4);
      const parts = entry.split(" ");
      const path = parts.slice(10).join(" ");
      conflicted_count += 1;
      files.push({
        path,
        index_status: xy[0] ?? "U",
        worktree_status: xy[1] ?? "U",
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true,
      });
    } else if (tag === "?") {
      const path = entry.slice(2);
      untracked_count += 1;
      files.push({
        path,
        index_status: "?",
        worktree_status: "?",
        staged: false,
        unstaged: false,
        untracked: true,
        conflicted: false,
      });
    }
  }

  return {
    branch,
    detached,
    head_sha,
    upstream,
    ahead,
    behind,
    staged_count,
    unstaged_count,
    untracked_count,
    conflicted_count,
    files,
  };
}

async function pathReachable(target: string): Promise<boolean> {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// spec 3.4.1 & 3.5.5: 부모 repo_root도 도달 불가하면 unmounted로 판정해 missing 오전이를 막는다.
export async function readWorktreeGitStatus(input: {
  worktreeId: string;
  worktreePath: string;
  repoRoot: string;
  clock: Clock;
  git?: GitRunner;
}): Promise<WorktreeGitStatus> {
  const git = input.git ?? runGit;
  const at = input.clock.now();
  const present = await pathReachable(input.worktreePath);
  if (!present) {
    const repoPresent = await pathReachable(input.repoRoot);
    return {
      worktree_id: input.worktreeId,
      presence: repoPresent ? "missing" : "unmounted",
      branch: null,
      detached: false,
      head_sha: null,
      dirty: false,
      staged_count: 0,
      unstaged_count: 0,
      untracked_count: 0,
      conflicted_count: 0,
      ahead: null,
      behind: null,
      updated_at: at,
    };
  }
  const res = await git(input.worktreePath, [
    "--no-optional-locks",
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=all",
    "--ignore-submodules=none",
    "-z",
  ]);
  if (res.code !== 0) {
    return {
      worktree_id: input.worktreeId,
      presence: "missing",
      branch: null,
      detached: false,
      head_sha: null,
      dirty: false,
      staged_count: 0,
      unstaged_count: 0,
      untracked_count: 0,
      conflicted_count: 0,
      ahead: null,
      behind: null,
      updated_at: at,
    };
  }
  const parsed = parsePorcelainV2Z(res.stdout);
  const dirty =
    parsed.staged_count > 0 ||
    parsed.unstaged_count > 0 ||
    parsed.untracked_count > 0 ||
    parsed.conflicted_count > 0;
  return {
    worktree_id: input.worktreeId,
    presence: "present",
    branch: parsed.branch,
    detached: parsed.detached,
    head_sha: parsed.head_sha,
    dirty,
    staged_count: parsed.staged_count,
    unstaged_count: parsed.unstaged_count,
    untracked_count: parsed.untracked_count,
    conflicted_count: parsed.conflicted_count,
    ahead: parsed.ahead,
    behind: parsed.behind,
    updated_at: at,
  };
}

// spec 3.2.3: Base ref 해석과 비대화형 fetch 폴백.
export async function resolveBaseRef(input: {
  repoRoot: string;
  explicitBaseRef?: string;
  fetchBase?: boolean;
  git?: GitRunner;
}): Promise<
  Result<{ base_ref: string; base_commit: string; warnings: string[] }>
> {
  const git = input.git ?? runGit;
  const warnings: string[] = [];

  const verifyCommit = async (ref: string): Promise<string | null> => {
    const res = await git(input.repoRoot, [
      "rev-parse",
      "--verify",
      `${ref}^{commit}`,
    ]);
    return res.code === 0 && res.stdout.trim() !== ""
      ? res.stdout.trim()
      : null;
  };

  let chosenRef: string | null = null;
  let fullRef: string | null = null;

  if (input.explicitBaseRef !== undefined) {
    const safe = assertSafeRefName(input.explicitBaseRef, "base_ref");
    if (!safe.ok) return safe;
    const rev = await git(input.repoRoot, [
      "rev-parse",
      "--symbolic-full-name",
      safe.value,
    ]);
    chosenRef = safe.value;
    fullRef =
      rev.code === 0 && rev.stdout.trim() !== "" ? rev.stdout.trim() : null;
    const sha = await verifyCommit(chosenRef);
    if (sha === null) {
      return err({
        code: "not_found",
        message: `base_ref "${chosenRef}" was not found`,
        details: { reason: "base_ref_not_found" },
      });
    }
  } else {
    // ① refs/remotes/origin/HEAD → ② origin/main → ③ origin/master → ④ main → ⑤ master → ⑥ HEAD
    const originHead = await git(input.repoRoot, [
      "symbolic-ref",
      "-q",
      "refs/remotes/origin/HEAD",
    ]);
    const candidates: { display: string; full: string }[] = [];
    if (originHead.code === 0 && originHead.stdout.trim() !== "") {
      const target = originHead.stdout.trim();
      candidates.push({
        display: target.replace(/^refs\/remotes\//, ""),
        full: target,
      });
    }
    candidates.push(
      { display: "origin/main", full: "refs/remotes/origin/main" },
      { display: "origin/master", full: "refs/remotes/origin/master" },
      { display: "main", full: "refs/heads/main" },
      { display: "master", full: "refs/heads/master" },
      { display: "HEAD", full: "HEAD" },
    );
    for (const candidate of candidates) {
      const sha = await verifyCommit(candidate.full);
      if (sha !== null) {
        chosenRef = candidate.display;
        fullRef = candidate.full;
        break;
      }
    }
  }

  if (chosenRef === null) {
    return err({
      code: "conflict",
      message: "repository has no commits yet (unborn repository)",
      details: { reason: "unborn_repository" },
    });
  }

  // 원격 tracking ref이고 fetchBase !== false면 비대화형 fetch 시도, 실패 시 로컬 캐시로 폴백한다.
  if (
    input.fetchBase !== false &&
    fullRef !== null &&
    fullRef.startsWith("refs/remotes/")
  ) {
    const rest = fullRef.slice("refs/remotes/".length);
    const slash = rest.indexOf("/");
    if (slash > 0) {
      const remote = rest.slice(0, slash);
      const branch = rest.slice(slash + 1);
      if (
        assertSafeRefName(remote, "remote").ok &&
        assertSafeRefName(branch, "branch").ok
      ) {
        const fetched = await git(
          input.repoRoot,
          [
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "--no-auto-maintenance",
            "--",
            remote,
            `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
          ],
          { timeoutMs: GIT_FETCH_TIMEOUT_MS },
        );
        if (fetched.code !== 0) {
          warnings.push(
            `could not fetch ${chosenRef} (${fetched.timedOut ? "timed out" : fetched.stderr.trim() || "offline"}); used local cached ref`,
          );
        }
      }
    }
  }

  const finalCommit = await verifyCommit(fullRef ?? chosenRef);
  if (finalCommit === null) {
    return err({
      code: "not_found",
      message: `base_ref "${chosenRef}" could not be resolved to a commit`,
      details: { reason: "base_ref_not_found" },
    });
  }

  return ok({
    base_ref: chosenRef,
    base_commit: finalCommit,
    warnings,
  });
}

// spec 3.2.2: 기존 브랜치 및 ref 네임스페이스 충돌(foo vs foo/bar)을 회피해 유일한 브랜치명을 고른다.
export async function ensureUniqueBranchName(
  repoRoot: string,
  candidate: string,
  git: GitRunner = runGit,
): Promise<Result<string>> {
  const safe = assertSafeRefName(candidate, "branch");
  if (!safe.ok) return safe;

  const refsRes = await git(repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  const existing = new Set(
    refsRes.code === 0
      ? refsRes.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [],
  );

  const collides = (name: string): boolean => {
    if (existing.has(name)) return true;
    for (const ref of existing) {
      if (ref.startsWith(`${name}/`) || name.startsWith(`${ref}/`)) {
        return true;
      }
    }
    return false;
  };

  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const next = attempt === 1 ? safe.value : `${safe.value}-${attempt}`;
    if (collides(next)) continue;
    const formatCheck = await git(repoRoot, [
      "check-ref-format",
      "--branch",
      next,
    ]);
    if (formatCheck.code === 0) return ok(next);
  }
  return err({
    code: "conflict",
    message: `could not find an available branch name based on "${candidate}"`,
    details: { reason: "branch_collision" },
  });
}

function isForeignOsWorktreePath(
  gitdirTarget: string,
  platform: NodeJS.Platform,
): boolean {
  const trimmed = gitdirTarget.trim();
  const isWindowsDrive = /^[A-Za-z]:[/\\]/.test(trimmed);
  const isPosixWslOrUnix = trimmed.startsWith("/");
  if (platform === "win32") {
    return isPosixWslOrUnix;
  }
  return isWindowsDrive;
}

// spec 3.5.5: Windows/WSL 혼용 환경에서 타 OS worktree가 prune되지 않도록 임시 locked 파일을 배타 생성(wx)해 보호한다.
export async function pruneWorktreesSafely(
  repoRoot: string,
  gitCommonDir: string,
  git: GitRunner = runGit,
  platform: NodeJS.Platform = process.platform,
): Promise<Result<void>> {
  const adminRoot = join(gitCommonDir, "worktrees");
  const createdLocks: string[] = [];
  try {
    let entries: string[] = [];
    try {
      entries = await readdir(adminRoot);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const entryDir = join(adminRoot, entry);
      const gitdirFile = join(entryDir, "gitdir");
      try {
        const target = await readFile(gitdirFile, "utf8");
        if (!isForeignOsWorktreePath(target, platform)) continue;
        const lockPath = join(entryDir, "locked");
        try {
          const handle = await open(lockPath, "wx");
          await handle.writeFile("lophn cross-os prune guard\n", "utf8");
          await handle.close();
          createdLocks.push(lockPath);
        } catch {
          // 이미 locked 파일이 있으면 그대로 둔다.
        }
      } catch {
        continue;
      }
    }
    const res = await git(repoRoot, ["worktree", "prune"], {
      retryLocks: true,
    });
    if (res.code !== 0) {
      return err({
        code: "unavailable",
        message: res.stderr.trim() || "git worktree prune failed",
      });
    }
    return ok(undefined);
  } finally {
    for (const lockPath of createdLocks) {
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export async function hasSubmodules(
  worktreePath: string,
  git: GitRunner = runGit,
): Promise<boolean> {
  const gitmodules = join(worktreePath, ".gitmodules");
  try {
    const stat = await lstat(gitmodules);
    if (stat.isFile()) return true;
  } catch {
    // fallback to git ls-files for gitlink entries (mode 160000)
  }
  const ls = await git(worktreePath, ["--no-optional-locks", "ls-files", "-s"]);
  if (ls.code !== 0) return false;
  return ls.stdout.split(/\r?\n/).some((line) => line.startsWith("160000 "));
}

export async function countUnpushedCommits(
  worktreePath: string,
  branch: string | null,
  git: GitRunner = runGit,
): Promise<number | null> {
  if (branch === null) return null;
  const upstream = await git(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    `${branch}@{upstream}`,
  ]);
  if (upstream.code === 0 && upstream.stdout.trim() !== "") {
    const count = await git(worktreePath, [
      "rev-list",
      "--count",
      `${upstream.stdout.trim()}..${branch}`,
    ]);
    if (count.code === 0) {
      const n = Number(count.stdout.trim());
      return Number.isFinite(n) ? n : null;
    }
  }
  // upstream이 없으면 모든 원격 ref 대비 미푸시 커밋 수를 센다.
  const noRemote = await git(worktreePath, [
    "rev-list",
    "--count",
    branch,
    "--not",
    "--remotes",
  ]);
  if (noRemote.code === 0) {
    const n = Number(noRemote.stdout.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function verifyGitdirPointsToCommonDir(
  worktreePath: string,
  gitCommonDir: string,
  expectedAdminName?: string | null,
): Promise<boolean> {
  const admin = await readGitdirAdminName(worktreePath, gitCommonDir);
  if (admin === null) return false;
  if (expectedAdminName != null && admin !== expectedAdminName) return false;
  return true;
}

export async function isWorktreeLockedInGit(
  gitCommonDir: string,
  adminName: string | null,
): Promise<boolean> {
  if (adminName === null) return false;
  const lockFile = join(gitCommonDir, "worktrees", adminName, "locked");
  return await pathReachable(lockFile);
}

export async function readGitDirectoryPath(
  cwd: string,
  git: GitRunner = runGit,
): Promise<string | null> {
  const res = await git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]);
  if (res.code === 0 && res.stdout.trim() !== "") {
    return safeRealpath(res.stdout.trim());
  }
  const fallback = await git(cwd, ["rev-parse", "--git-dir"]);
  if (fallback.code !== 0 || fallback.stdout.trim() === "") return null;
  const raw = fallback.stdout.trim();
  return safeRealpath(isAbsolute(raw) ? raw : resolve(cwd, raw));
}

export function isGitAuthError(stderr: string): boolean {
  return /Authentication failed|could not read Username|could not read Password|Permission denied \(publickey\)|Repository not found|terminal prompts disabled|HTTP Basic: Access denied|Invalid username or token|returned error:\s*(?:401|403)\b|\bHTTP(?:\/[\d.]+)?\s+(?:401|403)\b/i.test(
    stderr,
  );
}
