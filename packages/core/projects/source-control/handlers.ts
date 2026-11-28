// `source_control/*` route handler 모음.
// 대상은 project의 git 등록 폴더 또는 ready worktree다.
// 쓰기 route는 사람 자격만 받는다(agent는 터미널 git을 쓴다).
// 불변식(spec 3.4.2): 충돌 상태·충돌 마커 커밋 거부, 해당 checkout에 도는 turn이 있으면 switch 거부,
// pull은 --ff-only, force push 없음, 인증 실패 시 묻는 창 없이 unauthorized + 사람이 칠 명령 한 줄.
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type SourceControlBranch,
  type SourceControlCommit,
  type SourceControlTarget,
  sourceControlBranchCreate,
  sourceControlBranches,
  sourceControlCommit,
  sourceControlDiff,
  sourceControlDiscard,
  sourceControlLog,
  sourceControlPull,
  sourceControlPush,
  sourceControlShow,
  sourceControlStage,
  sourceControlStatus,
  sourceControlSwitch,
  sourceControlUnstage,
} from "../../../protocol/projects/source-control.ts";
import type { WorktreeRecord } from "../../../protocol/projects/worktrees.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler, ReadHandler } from "../../server/mod.ts";
import {
  assertSafeRefName,
  type GitRunner,
  inspectGitRepo,
  isGitAuthError,
  listGitWorktrees,
  parsePorcelainV2Z,
  readGitDirectoryPath,
  RepoGitMutex,
  runGit,
  safeRealpath,
} from "../worktrees/mod.ts";

const DIFF_MAX_CHARS = 512 * 1024;
const COMMIT_FIELD_SEP = "\x1f";
const COMMIT_RECORD_SEP = "\x1e";

export type SourceControlHandlersDeps = {
  projectFolders(project: string): Result<readonly string[]>;
  resolveReadyWorktree(
    project: string,
    worktreeId: string,
  ): Result<WorktreeRecord>;
  // 지정한 checkout(worktreeId 또는 main checkout=null)에서 현재 도는 agent turn/쓰기가 있는지 검사한다.
  hasActiveTurnInCheckout(
    project: Id<"prj">,
    worktreeId: Id<"wkt"> | null,
  ): boolean;
  isDevice(principal: string): boolean;
  granted(principal: string): boolean;
  mutex?: RepoGitMutex;
  git?: GitRunner;
  onChanged?(project: Id<"prj">, worktree?: Id<"wkt">): void;
};

type ResolvedTarget = {
  project: Id<"prj">;
  worktreeId: Id<"wkt"> | null;
  cwd: string;
  repoRoot: string;
  gitCommonDir: string;
  gitDir: string;
};

function forbidden(message: string, reason?: string): Result<never> {
  return err({
    code: "forbidden",
    message,
    ...(reason === undefined ? {} : { details: { reason } }),
  });
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function assertSafeRepoRelPath(rawPath: string): Result<string> {
  const normalized = rawPath.replace(/\\/g, "/");
  if (
    normalized === "" ||
    normalized.startsWith("-") ||
    isAbsolute(rawPath) ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0")
  ) {
    return err({
      code: "invalid_input",
      message: `invalid repository path "${rawPath}"`,
    });
  }
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === ".." || seg === ".git")) {
    return err({
      code: "invalid_input",
      message: `invalid repository path "${rawPath}"`,
    });
  }
  return ok(normalized);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readGitOperationsState(gitDir: string) {
  const [inMerge, inRebaseMerge, inRebaseApply, inCherryPick, inRevert] =
    await Promise.all([
      exists(join(gitDir, "MERGE_HEAD")),
      exists(join(gitDir, "rebase-merge")),
      exists(join(gitDir, "rebase-apply")),
      exists(join(gitDir, "CHERRY_PICK_HEAD")),
      exists(join(gitDir, "REVERT_HEAD")),
    ]);
  return {
    in_merge: inMerge,
    in_rebase: inRebaseMerge || inRebaseApply,
    in_cherry_pick: inCherryPick,
    in_revert: inRevert,
  };
}

function hasConflictMarkersInDiff(diff: string): boolean {
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1);
    if (
      body.startsWith("<<<<<<< ") ||
      body === "=======" ||
      body.startsWith(">>>>>>> ")
    ) {
      return true;
    }
  }
  return false;
}

function parseLogRecords(stdout: string): SourceControlCommit[] {
  const commits: SourceControlCommit[] = [];
  for (const raw of stdout.split(COMMIT_RECORD_SEP)) {
    const record = raw.trim();
    if (record === "") continue;
    const fields = record.split(COMMIT_FIELD_SEP);
    if (fields.length < 7) continue;
    const sha = fields[0]!.trim();
    if (sha === "") continue;
    const parentsRaw = fields[2]!.trim();
    const refsRaw = fields[6]!.trim();
    commits.push({
      sha,
      short_sha: fields[1]!.trim() || sha.slice(0, 7),
      parents: parentsRaw === "" ? [] : parentsRaw.split(/\s+/),
      author_name: fields[3]!,
      author_email: fields[4]!,
      authored_at: fields[5]!,
      refs:
        refsRaw === ""
          ? []
          : refsRaw
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean),
      subject: fields[7] ?? "",
    });
  }
  return commits;
}

export function createSourceControlHandlers(deps: SourceControlHandlersDeps) {
  const git = deps.git ?? runGit;
  const mutex = deps.mutex ?? new RepoGitMutex();

  const canWriteFor = (who: AuthenticatedContext): boolean => {
    if (who.actor !== "user") return false;
    return deps.isDevice(who.principal) ? deps.granted(who.principal) : true;
  };

  function requireWriteUser(who: AuthenticatedContext): Result<void> {
    if (who.actor !== "user") {
      return forbidden(
        "only the person may use source control write routes; agents should use git in the terminal",
      );
    }
    if (deps.isDevice(who.principal) && !deps.granted(who.principal)) {
      return forbidden(
        "this device does not have terminal input grant on this computer",
      );
    }
    return ok(undefined);
  }

  async function resolveTarget(
    target: SourceControlTarget,
  ): Promise<Result<ResolvedTarget>> {
    const project = target.project as Id<"prj">;
    if (target.worktree !== undefined) {
      const wt = deps.resolveReadyWorktree(project, target.worktree);
      if (!wt.ok) return wt;
      const inspected = await inspectGitRepo(wt.value.path, git);
      if (!inspected.ok) return inspected;
      const gitDir = await readGitDirectoryPath(wt.value.path, git);
      if (gitDir === null) {
        return err({
          code: "unavailable",
          message: "could not determine git directory for worktree",
        });
      }
      return ok({
        project,
        worktreeId: wt.value.id as Id<"wkt">,
        cwd: wt.value.path,
        repoRoot: wt.value.repo_root,
        gitCommonDir: wt.value.git_common_dir,
        gitDir,
      });
    }

    const folders = deps.projectFolders(project);
    if (!folders.ok) return folders;
    if (folders.value.length === 0) {
      return err({
        code: "invalid_input",
        message: "project has no registered folder",
      });
    }
    let chosen: string | undefined;
    if (target.folder !== undefined) {
      const wanted = safeRealpath(target.folder);
      chosen = folders.value.find(
        (folder) => folder === target.folder || safeRealpath(folder) === wanted,
      );
      if (chosen === undefined) {
        return err({
          code: "invalid_input",
          message: "folder is not registered in this project",
        });
      }
    } else {
      for (const folder of folders.value) {
        const check = await inspectGitRepo(folder, git);
        if (check.ok) {
          chosen = folder;
          break;
        }
      }
      if (chosen === undefined) {
        return err({
          code: "invalid_input",
          message: "project has no git repository folder",
          details: { reason: "not_git_repository" },
        });
      }
    }

    const inspected = await inspectGitRepo(chosen, git);
    if (!inspected.ok) return inspected;
    const gitDir = await readGitDirectoryPath(inspected.value.repo_root, git);
    if (gitDir === null) {
      return err({
        code: "unavailable",
        message: "could not determine git directory",
      });
    }
    return ok({
      project,
      worktreeId: null,
      cwd: inspected.value.repo_root,
      repoRoot: inspected.value.repo_root,
      gitCommonDir: inspected.value.git_common_dir,
      gitDir,
    });
  }

  const status: ReadHandler = async (who, raw) => {
    const parsed = sourceControlStatus.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid status input" });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const res = await git(target.value.cwd, [
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "--branch",
      "--untracked-files=all",
      "--ignore-submodules=none",
      "-z",
    ]);
    if (res.code !== 0) {
      return err({
        code: "unavailable",
        message: res.stderr.trim() || "git status failed",
      });
    }
    const parsedStatus = parsePorcelainV2Z(res.stdout);
    const ops = await readGitOperationsState(target.value.gitDir);
    return ok({
      cwd: target.value.cwd,
      branch: parsedStatus.branch,
      detached: parsedStatus.detached,
      head_sha: parsedStatus.head_sha,
      upstream: parsedStatus.upstream,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      ...ops,
      files: parsedStatus.files,
      can_write: canWriteFor(who),
    });
  };

  const diff: ReadHandler = async (_who, raw) => {
    const parsed = sourceControlDiff.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid diff input" });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const args = ["--no-optional-locks", "diff", "--no-color"];
    if (parsed.data.staged === true) args.push("--cached");
    if (parsed.data.context_lines !== undefined) {
      args.push(`-U${parsed.data.context_lines}`);
    }
    if (parsed.data.path !== undefined) {
      const safePath = assertSafeRepoRelPath(parsed.data.path);
      if (!safePath.ok) return safePath;
      args.push("--", safePath.value);
    }
    const res = await git(target.value.cwd, args);
    if (res.code !== 0) {
      return err({
        code: "unavailable",
        message: res.stderr.trim() || "git diff failed",
      });
    }
    const truncated = res.stdout.length > DIFF_MAX_CHARS;
    const text = truncated ? res.stdout.slice(0, DIFF_MAX_CHARS) : res.stdout;
    const binary = /Binary files .+ differ|GIT binary patch/.test(text);
    return ok({ diff: text, truncated, binary });
  };

  const stage: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlStage.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid stage input",
      });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const safePaths: string[] = [];
    if (parsed.data.all !== true) {
      for (const p of parsed.data.paths ?? []) {
        const checked = assertSafeRepoRelPath(p);
        if (!checked.ok) return checked;
        safePaths.push(checked.value);
      }
    }

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      // unmerged 충돌 파일을 git add -A로 실수 마킹하지 않도록 충돌 파일이 있으면 명시적 경로만 허용한다.
      if (parsed.data.all === true) {
        const st = await git(target.value.cwd, [
          "--no-optional-locks",
          "status",
          "--porcelain=v2",
          "-z",
        ]);
        if (
          st.code === 0 &&
          parsePorcelainV2Z(st.stdout).conflicted_count > 0
        ) {
          return err({
            code: "conflict" as const,
            message:
              "cannot stage all while merge conflicts remain; resolve conflicts first",
            details: { reason: "unresolved_conflicts" },
          });
        }
      }
      const args =
        parsed.data.all === true ? ["add", "-A"] : ["add", "--", ...safePaths];
      const res = await git(target.value.cwd, args, { retryLocks: true });
      if (res.code !== 0) {
        return err({
          code: "unavailable" as const,
          message: res.stderr.trim() || "git add failed",
        });
      }
      const after = await git(target.value.cwd, [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "-z",
      ]);
      const stagedCount =
        after.code === 0
          ? parsePorcelainV2Z(after.stdout).staged_count
          : safePaths.length;
      return ok({ staged: stagedCount });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  const unstage: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlUnstage.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid unstage input",
      });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const safePaths: string[] = [];
    if (parsed.data.all !== true) {
      for (const p of parsed.data.paths ?? []) {
        const checked = assertSafeRepoRelPath(p);
        if (!checked.ok) return checked;
        safePaths.push(checked.value);
      }
    }

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const head = await git(target.value.cwd, [
        "rev-parse",
        "--verify",
        "HEAD",
      ]);
      const hasHead = head.code === 0;
      let args: string[];
      if (hasHead) {
        args =
          parsed.data.all === true
            ? ["reset", "HEAD", "--"]
            : ["reset", "HEAD", "--", ...safePaths];
      } else {
        args =
          parsed.data.all === true
            ? ["rm", "--cached", "-r", "--", "."]
            : ["rm", "--cached", "--", ...safePaths];
      }
      const res = await git(target.value.cwd, args, { retryLocks: true });
      if (res.code !== 0) {
        return err({
          code: "unavailable" as const,
          message: res.stderr.trim() || "git unstage failed",
        });
      }
      return ok({ unstaged: parsed.data.all === true ? 1 : safePaths.length });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  const discard: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlDiscard.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid discard input",
      });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const safePaths: string[] = [];
    if (parsed.data.all !== true) {
      for (const p of parsed.data.paths ?? []) {
        const checked = assertSafeRepoRelPath(p);
        if (!checked.ok) return checked;
        safePaths.push(checked.value);
      }
    }

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const st = await git(target.value.cwd, [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--untracked-files=all",
        "-z",
      ]);
      if (st.code !== 0) {
        return err({
          code: "unavailable" as const,
          message: st.stderr.trim() || "git status failed",
        });
      }
      const parsedStatus = parsePorcelainV2Z(st.stdout);
      const untrackedSet = new Set(
        parsedStatus.files.filter((f) => f.untracked).map((f) => f.path),
      );

      let discarded = 0;
      if (parsed.data.all === true) {
        const restore = await git(target.value.cwd, ["checkout", "--", "."], {
          retryLocks: true,
        });
        if (restore.code !== 0) {
          return err({
            code: "unavailable" as const,
            message: restore.stderr.trim() || "git discard failed",
          });
        }
        discarded += parsedStatus.unstaged_count;
        if (parsed.data.include_untracked === true && untrackedSet.size > 0) {
          const clean = await git(target.value.cwd, ["clean", "-fd"], {
            retryLocks: true,
          });
          if (clean.code !== 0) {
            return err({
              code: "unavailable" as const,
              message: clean.stderr.trim() || "git clean failed",
            });
          }
          discarded += untrackedSet.size;
        }
      } else {
        const trackedTargets = safePaths.filter((p) => !untrackedSet.has(p));
        const untrackedTargets = safePaths.filter((p) => untrackedSet.has(p));
        if (trackedTargets.length > 0) {
          const restore = await git(
            target.value.cwd,
            ["checkout", "--", ...trackedTargets],
            { retryLocks: true },
          );
          if (restore.code !== 0) {
            return err({
              code: "unavailable" as const,
              message: restore.stderr.trim() || "git checkout failed",
            });
          }
          discarded += trackedTargets.length;
        }
        if (untrackedTargets.length > 0) {
          const clean = await git(
            target.value.cwd,
            ["clean", "-fd", "--", ...untrackedTargets],
            { retryLocks: true },
          );
          if (clean.code !== 0) {
            return err({
              code: "unavailable" as const,
              message: clean.stderr.trim() || "git clean failed",
            });
          }
          discarded += untrackedTargets.length;
        }
      }
      return ok({ discarded });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  // spec 3.4.2 불변식 1: MERGE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD/unmerged index 또는 충돌 마커가 있으면 커밋 거부.
  const commit: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlCommit.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid commit input",
      });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const ops = await readGitOperationsState(target.value.gitDir);
      if (
        ops.in_merge ||
        ops.in_rebase ||
        ops.in_cherry_pick ||
        ops.in_revert
      ) {
        return err({
          code: "conflict" as const,
          message:
            "cannot commit while a merge, rebase, cherry-pick, or revert is in progress",
          details: { reason: "merge_in_progress" },
        });
      }
      const st = await git(target.value.cwd, [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
      ]);
      if (st.code !== 0) {
        return err({
          code: "unavailable" as const,
          message: st.stderr.trim() || "git status failed",
        });
      }
      const parsedStatus = parsePorcelainV2Z(st.stdout);
      if (parsedStatus.conflicted_count > 0) {
        return err({
          code: "conflict" as const,
          message: "cannot commit while unmerged conflict entries remain",
          details: { reason: "unresolved_conflicts" },
        });
      }
      if (parsedStatus.staged_count === 0 && parsed.data.amend !== true) {
        return err({
          code: "conflict" as const,
          message: "nothing staged to commit",
          details: { reason: "nothing_staged" },
        });
      }
      const stagedDiff = await git(target.value.cwd, [
        "--no-optional-locks",
        "diff",
        "--cached",
        "--no-color",
      ]);
      if (
        stagedDiff.code === 0 &&
        hasConflictMarkersInDiff(stagedDiff.stdout)
      ) {
        return err({
          code: "conflict" as const,
          message:
            "staged changes contain unresolved conflict markers (<<<<<<< / ======= / >>>>>>>)",
          details: { reason: "conflict_markers" },
        });
      }

      const commitArgs = ["commit"];
      if (parsed.data.amend === true) commitArgs.push("--amend");
      commitArgs.push("-F", "-");
      const res = await git(target.value.cwd, commitArgs, {
        stdin: parsed.data.message,
        retryLocks: true,
      });
      if (res.code !== 0) {
        return err({
          code: "conflict" as const,
          message:
            res.stderr.trim() || res.stdout.trim() || "git commit failed",
        });
      }
      const head = await git(target.value.cwd, ["rev-parse", "HEAD"]);
      const branch = await git(target.value.cwd, [
        "symbolic-ref",
        "--short",
        "HEAD",
      ]);
      return ok({
        sha: head.stdout.trim(),
        branch:
          branch.code === 0 && branch.stdout.trim() !== ""
            ? branch.stdout.trim()
            : null,
        summary: res.stdout.trim().split(/\r?\n/)[0] ?? "committed",
      });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  const log: ReadHandler = async (_who, raw) => {
    const parsed = sourceControlLog.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid log input" });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const limit = parsed.data.limit ?? 50;
    const args = [
      "--no-optional-locks",
      "log",
      `--max-count=${limit}`,
      ...(parsed.data.skip !== undefined ? [`--skip=${parsed.data.skip}`] : []),
      `--format=%H${COMMIT_FIELD_SEP}%h${COMMIT_FIELD_SEP}%P${COMMIT_FIELD_SEP}%an${COMMIT_FIELD_SEP}%ae${COMMIT_FIELD_SEP}%aI${COMMIT_FIELD_SEP}%D${COMMIT_FIELD_SEP}%s${COMMIT_RECORD_SEP}`,
    ];
    if (parsed.data.ref !== undefined) {
      const safeRef = assertSafeRefName(parsed.data.ref, "ref");
      if (!safeRef.ok) return safeRef;
      args.push(safeRef.value);
    }
    if (parsed.data.path !== undefined) {
      const safePath = assertSafeRepoRelPath(parsed.data.path);
      if (!safePath.ok) return safePath;
      args.push("--", safePath.value);
    }
    const res = await git(target.value.cwd, args);
    if (res.code !== 0) {
      // unborn repo는 빈 목록으로 돌려준다.
      if (/does not have any commits yet/i.test(res.stderr)) {
        return ok({ commits: [] });
      }
      return err({
        code: "unavailable",
        message: res.stderr.trim() || "git log failed",
      });
    }
    return ok({ commits: parseLogRecords(res.stdout) });
  };

  const show: ReadHandler = async (_who, raw) => {
    const parsed = sourceControlShow.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid show input" });
    }
    const safeSha = assertSafeRefName(parsed.data.sha, "sha");
    if (!safeSha.ok) return safeSha;
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const meta = await git(target.value.cwd, [
      "--no-optional-locks",
      "show",
      "--no-patch",
      `--format=%H${COMMIT_FIELD_SEP}%h${COMMIT_FIELD_SEP}%P${COMMIT_FIELD_SEP}%an${COMMIT_FIELD_SEP}%ae${COMMIT_FIELD_SEP}%aI${COMMIT_FIELD_SEP}%D${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%b`,
      safeSha.value,
      "--",
    ]);
    if (meta.code !== 0) {
      return err({
        code: "not_found",
        message: meta.stderr.trim() || `commit "${safeSha.value}" not found`,
      });
    }
    const fields = meta.stdout.split(COMMIT_FIELD_SEP);
    const sha = fields[0]?.trim() ?? safeSha.value;
    const parentsRaw = fields[2]?.trim() ?? "";
    const refsRaw = fields[6]?.trim() ?? "";
    const commitInfo = {
      sha,
      short_sha: fields[1]?.trim() || sha.slice(0, 7),
      parents: parentsRaw === "" ? [] : parentsRaw.split(/\s+/),
      author_name: fields[3] ?? "",
      author_email: fields[4] ?? "",
      authored_at: fields[5] ?? "",
      refs:
        refsRaw === ""
          ? []
          : refsRaw
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean),
      subject: fields[7] ?? "",
      body: (fields[8] ?? "").trim(),
    };

    const [numstat, nameStatus, patchRes] = await Promise.all([
      git(target.value.cwd, [
        "--no-optional-locks",
        "show",
        "--format=",
        "--numstat",
        safeSha.value,
        "--",
      ]),
      git(target.value.cwd, [
        "--no-optional-locks",
        "show",
        "--format=",
        "--name-status",
        safeSha.value,
        "--",
      ]),
      git(target.value.cwd, [
        "--no-optional-locks",
        "show",
        "--format=",
        "--no-color",
        safeSha.value,
        "--",
      ]),
    ]);

    const statusByPath = new Map<string, string>();
    if (nameStatus.code === 0) {
      for (const line of nameStatus.stdout.split(/\r?\n/)) {
        const m = /^([A-Z]\d*)\t(.+)$/.exec(line);
        if (!m) continue;
        const pathParts = m[2]!.split("\t");
        const finalPath = pathParts[pathParts.length - 1]!;
        statusByPath.set(finalPath, m[1]!);
      }
    }
    const files: {
      path: string;
      status: string;
      additions: number | null;
      deletions: number | null;
    }[] = [];
    if (numstat.code === 0) {
      for (const line of numstat.stdout.split(/\r?\n/)) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const add = parts[0] === "-" ? null : Number(parts[0]);
        const del = parts[1] === "-" ? null : Number(parts[1]);
        const filePath = parts.slice(2).join("\t");
        files.push({
          path: filePath,
          status: statusByPath.get(filePath) ?? "M",
          additions: Number.isFinite(add) ? add : null,
          deletions: Number.isFinite(del) ? del : null,
        });
      }
    }

    const rawPatch = patchRes.code === 0 ? patchRes.stdout : "";
    const truncated = rawPatch.length > DIFF_MAX_CHARS;
    return ok({
      commit: commitInfo,
      files,
      diff: truncated ? rawPatch.slice(0, DIFF_MAX_CHARS) : rawPatch,
      truncated,
    });
  };

  const branches: ReadHandler = async (_who, raw) => {
    const parsed = sourceControlBranches.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid branches input" });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const currentRes = await git(target.value.cwd, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);
    const current =
      currentRes.code === 0 && currentRes.stdout.trim() !== ""
        ? currentRes.stdout.trim()
        : null;
    const detached = current === null;

    const wtListed = await listGitWorktrees(
      target.value.repoRoot,
      target.value.gitCommonDir,
      git,
    );
    const worktreeByBranch = new Map<string, string>();
    if (wtListed.ok) {
      for (const wt of wtListed.value) {
        if (wt.branch !== null) worktreeByBranch.set(wt.branch, wt.path);
      }
    }

    const refPatterns =
      parsed.data.include_remote === true
        ? ["refs/heads", "refs/remotes"]
        : ["refs/heads"];
    const res = await git(target.value.cwd, [
      "--no-optional-locks",
      "for-each-ref",
      `--format=%(refname)${COMMIT_FIELD_SEP}%(refname:short)${COMMIT_FIELD_SEP}%(objectname)${COMMIT_FIELD_SEP}%(upstream:short)${COMMIT_FIELD_SEP}%(upstream:track,nobracket)`,
      ...refPatterns,
    ]);
    if (res.code !== 0) {
      return err({
        code: "unavailable",
        message: res.stderr.trim() || "git for-each-ref failed",
      });
    }

    const items: SourceControlBranch[] = [];
    for (const line of res.stdout.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const [fullRef, shortName, sha, upstream, track] =
        line.split(COMMIT_FIELD_SEP);
      if (!fullRef || !shortName) continue;
      const isRemote = fullRef.startsWith("refs/remotes/");
      if (isRemote && shortName.endsWith("/HEAD")) continue;
      let ahead: number | null = null;
      let behind: number | null = null;
      if (track) {
        const a = /ahead (\d+)/.exec(track);
        const b = /behind (\d+)/.exec(track);
        if (a) ahead = Number(a[1]);
        if (b) behind = Number(b[1]);
      }
      items.push({
        name: shortName,
        current: !isRemote && shortName === current,
        remote: isRemote,
        upstream: upstream || null,
        head_sha: sha || null,
        ahead,
        behind,
        worktree_path: isRemote
          ? null
          : (worktreeByBranch.get(shortName) ?? null),
      });
    }

    return ok({ current, detached, branches: items });
  };

  const branchCreate: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlBranchCreate.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message:
          parsed.error.issues[0]?.message ?? "invalid branch_create input",
      });
    }
    const safeName = assertSafeRefName(parsed.data.name, "name");
    if (!safeName.ok) return safeName;
    if (parsed.data.start_point !== undefined) {
      const safeStart = assertSafeRefName(
        parsed.data.start_point,
        "start_point",
      );
      if (!safeStart.ok) return safeStart;
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const shouldCheckout = parsed.data.checkout === true;
    // spec 3.4.2 불변식 2: 도는 turn이 있으면 checkout 전환 금지.
    if (
      shouldCheckout &&
      deps.hasActiveTurnInCheckout(
        target.value.project,
        target.value.worktreeId,
      )
    ) {
      return err({
        code: "conflict",
        message:
          "cannot switch branches while an agent turn is running in this checkout",
        details: { reason: "active_turn_in_checkout" },
      });
    }

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const format = await git(target.value.cwd, [
        "check-ref-format",
        "--branch",
        safeName.value,
      ]);
      if (format.code !== 0) {
        return err({
          code: "invalid_input" as const,
          message: `invalid branch name "${safeName.value}"`,
        });
      }
      const args = shouldCheckout
        ? [
            "checkout",
            "--no-track",
            "-b",
            safeName.value,
            ...(parsed.data.start_point !== undefined
              ? [parsed.data.start_point]
              : []),
          ]
        : [
            "branch",
            "--no-track",
            "--",
            safeName.value,
            ...(parsed.data.start_point !== undefined
              ? [parsed.data.start_point]
              : []),
          ];
      const res = await git(target.value.cwd, args, { retryLocks: true });
      if (res.code !== 0) {
        return err({
          code: /already exists/i.test(res.stderr)
            ? ("conflict" as const)
            : ("unavailable" as const),
          message: res.stderr.trim() || "failed to create branch",
        });
      }
      const sha = await git(target.value.cwd, [
        "rev-parse",
        `refs/heads/${safeName.value}`,
      ]);
      return ok({
        name: safeName.value,
        checked_out: shouldCheckout,
        head_sha: sha.stdout.trim(),
      });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  // spec 3.4.2 불변식 2: 같은 checkout에서 도는 turn이 있으면 switch 거부.
  const switchBranch: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlSwitch.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid switch input",
      });
    }
    const safeBranch = assertSafeRefName(parsed.data.branch, "branch");
    if (!safeBranch.ok) return safeBranch;
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    if (
      deps.hasActiveTurnInCheckout(
        target.value.project,
        target.value.worktreeId,
      )
    ) {
      return err({
        code: "conflict",
        message:
          "cannot switch branches while an agent turn is running in this checkout",
        details: { reason: "active_turn_in_checkout" },
      });
    }

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const res = await git(
        target.value.cwd,
        ["switch", "--", safeBranch.value],
        { retryLocks: true },
      );
      if (res.code !== 0) {
        const isConflict =
          /already checked out|would be overwritten|local changes/i.test(
            res.stderr,
          );
        const isNotFound = /invalid reference|did not match any/i.test(
          res.stderr,
        );
        return err({
          code: isNotFound
            ? ("not_found" as const)
            : isConflict
              ? ("conflict" as const)
              : ("unavailable" as const),
          message: res.stderr.trim() || "git switch failed",
        });
      }
      const head = await git(target.value.cwd, ["rev-parse", "HEAD"]);
      return ok({
        branch: safeBranch.value,
        head_sha: head.stdout.trim(),
      });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  // spec 3.4.2 불변식 3: force push 없음. 인증 실패 시 unauthorized + 사람이 칠 명령 한 줄.
  const push: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlPush.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid push input" });
    }
    if (parsed.data.remote !== undefined) {
      const safeRemote = assertSafeRefName(parsed.data.remote, "remote");
      if (!safeRemote.ok) return safeRemote;
    }
    if (parsed.data.branch !== undefined) {
      const safeBranch = assertSafeRefName(parsed.data.branch, "branch");
      if (!safeBranch.ok) return safeBranch;
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const curBranchRes = await git(target.value.cwd, [
        "symbolic-ref",
        "--short",
        "HEAD",
      ]);
      const branch =
        parsed.data.branch ??
        (curBranchRes.code === 0 ? curBranchRes.stdout.trim() : "");
      if (branch === "") {
        return err({
          code: "conflict" as const,
          message: "cannot push from detached HEAD without specifying branch",
        });
      }
      const remote = parsed.data.remote ?? "origin";
      const args = [
        "push",
        ...(parsed.data.set_upstream === true ? ["-u"] : []),
        "--",
        remote,
        branch,
      ];
      const res = await git(target.value.cwd, args, {
        timeoutMs: 60_000,
        retryLocks: true,
      });
      if (res.code !== 0) {
        if (isGitAuthError(res.stderr)) {
          const cmd = `git -C ${shellQuote(target.value.cwd)} ${args.map(shellQuote).join(" ")}`;
          return err({
            code: "unauthorized" as const,
            message: `git push authentication failed; run in terminal: ${cmd}`,
            details: { reason: "git_auth_failed", command: cmd },
          });
        }
        return err({
          code: /non-fast-forward|rejected/i.test(res.stderr)
            ? ("conflict" as const)
            : ("unavailable" as const),
          message: res.stderr.trim() || "git push failed",
        });
      }
      return ok({
        remote,
        branch,
        summary: (res.stderr.trim() || res.stdout.trim() || "pushed").split(
          /\r?\n/,
        )[0]!,
      });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  // spec 3.4.2 불변식 3: pull은 --ff-only. 인증 실패 시 unauthorized + 사람이 칠 명령 한 줄.
  const pull: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlPull.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid pull input" });
    }
    if (parsed.data.remote !== undefined) {
      const safeRemote = assertSafeRefName(parsed.data.remote, "remote");
      if (!safeRemote.ok) return safeRemote;
    }
    if (parsed.data.branch !== undefined) {
      const safeBranch = assertSafeRefName(parsed.data.branch, "branch");
      if (!safeBranch.ok) return safeBranch;
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const beforeHead = (
        await git(target.value.cwd, ["rev-parse", "HEAD"])
      ).stdout.trim();
      const args = ["pull", "--ff-only", "--no-tags"];
      if (parsed.data.remote !== undefined) {
        args.push("--", parsed.data.remote);
        if (parsed.data.branch !== undefined) {
          args.push(parsed.data.branch);
        }
      }
      const res = await git(target.value.cwd, args, {
        timeoutMs: 60_000,
        retryLocks: true,
      });
      if (res.code !== 0) {
        if (isGitAuthError(res.stderr)) {
          const cmd = `git -C ${shellQuote(target.value.cwd)} ${args.map(shellQuote).join(" ")}`;
          return err({
            code: "unauthorized" as const,
            message: `git pull authentication failed; run in terminal: ${cmd}`,
            details: { reason: "git_auth_failed", command: cmd },
          });
        }
        return err({
          code: /Not possible to fast-forward|diverging|local changes/i.test(
            res.stderr,
          )
            ? ("conflict" as const)
            : ("unavailable" as const),
          message: res.stderr.trim() || "git pull --ff-only failed",
        });
      }
      const afterHead = (
        await git(target.value.cwd, ["rev-parse", "HEAD"])
      ).stdout.trim();
      return ok({
        remote: parsed.data.remote ?? null,
        branch: parsed.data.branch ?? null,
        head_sha: afterHead,
        updated: afterHead !== beforeHead,
        summary: (res.stdout.trim() || res.stderr.trim() || "up to date").split(
          /\r?\n/,
        )[0]!,
      });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  return {
    status,
    diff,
    stage,
    unstage,
    discard,
    commit,
    log,
    show,
    branches,
    branchCreate,
    switchBranch,
    push,
    pull,
  };
}
