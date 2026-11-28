// `source_control/*` route handler 모음.
// 대상은 project의 git 등록 폴더 또는 ready worktree다.
// 쓰기 route는 사람 자격만 받는다(agent는 터미널 git을 쓴다).
// 불변식(spec 3.4.2): 충돌 상태·충돌 마커 커밋 거부, 해당 checkout에 도는 turn이 있으면 switch 거부,
// pull은 --ff-only, force push 없음, 인증 실패 시 묻는 창 없이 unauthorized + 사람이 칠 명령 한 줄.
import { constants as fsConstants } from "node:fs";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type SourceControlBranch,
  type SourceControlCommit,
  type SourceControlOperation,
  type SourceControlTarget,
  sourceControlAbort,
  sourceControlBranchCreate,
  sourceControlBranchDelete,
  sourceControlBranchRename,
  sourceControlFetch,
  sourceControlFileAt,
  sourceControlIgnored,
  sourceControlMarkResolved,
  sourceControlSuggestCancel,
  sourceControlSuggestMessage,
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
  listGitWorktrees,
  parsePorcelainV2Z,
  readGitDirectoryPath,
  RepoGitMutex,
  runGit,
  safeRealpath,
} from "../worktrees/mod.ts";
import {
  conflictMarkersInDiff,
  fairDiff,
  gitFailure,
  hasConflictMarkers,
  refused,
} from "./failures.ts";
import type { CommitMessageQueue } from "./suggest.ts";

const DIFF_MAX_CHARS = 512 * 1024;
const STATUS_FILES_MAX = 10_000;
const COMMIT_TIMEOUT_MS = 5 * 60_000;
const NETWORK_TIMEOUT_MS = 2 * 60_000;
const FILE_AT_MAX_BYTES = 5 * 1024 * 1024;
const SUGGEST_DIFF_BUDGET = 160_000;
const COMMIT_HOOKS = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
] as const;
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
  // agent session의 소속 project id. Home/App session이면 null.
  sessionProject(session: string): Promise<Result<Id<"prj"> | null>>;
  mutex?: RepoGitMutex;
  git?: GitRunner;
  onChanged?(project: Id<"prj">, worktree?: Id<"wkt">): void;
  // AI 커밋 메시지. 없으면 단추를 끈다.
  suggest?: {
    // lophn agent의 기본 model이 있는가. 없으면 이유(툴팁).
    available(): Promise<{ available: boolean; reason: string | null }>;
    queue: CommitMessageQueue;
  };
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

function operationOf(ops: {
  in_merge: boolean;
  in_rebase: boolean;
  in_cherry_pick: boolean;
  in_revert: boolean;
}): SourceControlOperation | null {
  if (ops.in_rebase) return "rebase";
  if (ops.in_merge) return "merge";
  if (ops.in_cherry_pick) return "cherry_pick";
  if (ops.in_revert) return "revert";
  return null;
}

const ABORT_COMMAND: Record<SourceControlOperation, string> = {
  merge: "merge",
  rebase: "rebase",
  cherry_pick: "cherry-pick",
  revert: "revert",
};

// 커밋 때 돌 hook. core.hooksPath를 따르는 `--git-path hooks`를 본다(husky 같은 hook 관리자).
async function commitHooksOf(cwd: string, git: GitRunner): Promise<string[]> {
  const res = await git(cwd, ["rev-parse", "--git-path", "hooks"]);
  if (res.code !== 0) return [];
  const raw = res.stdout.trim();
  const dir = isAbsolute(raw) ? raw : join(cwd, raw);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const hook of COMMIT_HOOKS) {
    if (!names.includes(hook)) continue;
    try {
      const info = await stat(join(dir, hook));
      if (process.platform === "win32" || (info.mode & 0o111) !== 0) {
        found.push(hook);
      }
    } catch {
      // 사라진 hook은 돌지 않는다.
    }
  }
  return found;
}

// ssh가 passphrase를 묻다 멈추지 않게 한다. 사람이 ssh 명령을 정해 두었으면 건드리지 않는다.
async function networkEnv(
  cwd: string,
  git: GitRunner,
): Promise<Record<string, string>> {
  if (
    process.env.GIT_SSH_COMMAND !== undefined ||
    process.env.GIT_SSH !== undefined
  ) {
    return {};
  }
  const configured = await git(cwd, ["config", "--get", "core.sshCommand"]);
  if (configured.code === 0 && configured.stdout.trim() !== "") return {};
  return { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

function parseNumstatZ(
  stdout: string,
): Map<string, { additions: number; deletions: number } | null> {
  const stats = new Map<
    string,
    { additions: number; deletions: number } | null
  >();
  const parts = stdout.split("\0");
  for (let at = 0; at < parts.length; at += 1) {
    const head = parts[at];
    if (head === undefined || head === "") continue;
    const fields = head.split("\t");
    if (fields.length < 3) continue;
    let path = fields.slice(2).join("\t");
    // rename은 `add\tdel\t` 뒤에 옛 경로·새 경로가 NUL로 이어 온다.
    if (path === "") {
      path = parts[at + 2] ?? "";
      at += 2;
    }
    const additions = Number(fields[0]);
    const deletions = Number(fields[1]);
    stats.set(
      path,
      fields[0] === "-" || !Number.isFinite(additions)
        ? null
        : { additions, deletions },
    );
  }
  return stats;
}

async function insideRoot(root: string, path: string): Promise<boolean> {
  try {
    const real = await realpath(path);
    const base = await realpath(root);
    const rel = relative(base, real);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
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

  const isAgent = (who: AuthenticatedContext): boolean =>
    who.actor === "agent" || who.actor.startsWith("agent:");

  // agent는 자기 project workspace의 source control만 읽을 수 있다.
  async function checkAgentProjectScope(
    who: AuthenticatedContext,
    project: Id<"prj">,
  ): Promise<Result<void>> {
    if (!isAgent(who)) return ok(undefined);
    if (
      who.conditions.project !== undefined &&
      who.conditions.project !== project
    ) {
      return forbidden(
        "agent may only access source control in its own project workspace",
        "cross_project",
      );
    }
    const session = who.conditions.session;
    if (session === undefined) {
      return forbidden("agent session is missing");
    }
    const owned = await deps.sessionProject(session);
    if (!owned.ok) return owned;
    if (owned.value !== project) {
      return forbidden(
        "agent may only access source control in its own project workspace",
        "cross_project",
      );
    }
    return ok(undefined);
  }

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
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
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
    const cwd = target.value.cwd;
    const [ops, remotes, hooks, unstagedStat, stagedStat, suggest] =
      await Promise.all([
        readGitOperationsState(target.value.gitDir),
        git(cwd, ["remote"]),
        commitHooksOf(cwd, git),
        git(cwd, ["--no-optional-locks", "diff", "--numstat", "-z"]),
        git(cwd, [
          "--no-optional-locks",
          "diff",
          "--cached",
          "--numstat",
          "-z",
        ]),
        deps.suggest === undefined
          ? Promise.resolve({
              available: false,
              reason: "AI commit messages are not available here",
            })
          : deps.suggest.available(),
      ]);
    const unstagedStats = parseNumstatZ(unstagedStat.stdout);
    const stagedStats = parseNumstatZ(stagedStat.stdout);
    const truncated = parsedStatus.files.length > STATUS_FILES_MAX;
    const files = parsedStatus.files.slice(0, STATUS_FILES_MAX).map((file) => ({
      ...file,
      ...(file.staged
        ? { staged_stat: stagedStats.get(file.path) ?? null }
        : {}),
      ...(file.unstaged
        ? { unstaged_stat: unstagedStats.get(file.path) ?? null }
        : {}),
    }));
    return ok({
      cwd,
      branch: parsedStatus.branch,
      detached: parsedStatus.detached,
      head_sha: parsedStatus.head_sha,
      upstream: parsedStatus.upstream,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      ...ops,
      operation: operationOf(ops),
      unborn: parsedStatus.head_sha === null,
      has_remote: remotes.code === 0 && remotes.stdout.trim() !== "",
      hooks,
      truncated,
      files,
      can_write: canWriteFor(who),
      suggest,
    });
  };

  const diff: ReadHandler = async (who, raw) => {
    const parsed = sourceControlDiff.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid diff input" });
    }
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    let safePath: string | undefined;
    if (parsed.data.path !== undefined) {
      const checked = assertSafeRepoRelPath(parsed.data.path);
      if (!checked.ok) return checked;
      safePath = checked.value;
    }
    const options = [
      "--no-color",
      "--no-ext-diff",
      ...(parsed.data.ignore_whitespace === true ? ["-w"] : []),
      ...(parsed.data.context_lines === undefined
        ? []
        : [`-U${parsed.data.context_lines}`]),
    ];
    const cwd = target.value.cwd;
    let untracked = false;
    let args: string[];
    if (parsed.data.commit !== undefined) {
      const sha = assertSafeRefName(parsed.data.commit, "commit");
      if (!sha.ok) return sha;
      // parent 쪽 diff. root 커밋은 빈 tree 대비이고 merge 커밋은 첫 parent 대비다.
      args = [
        "--no-optional-locks",
        "--literal-pathspecs",
        "show",
        "--format=",
        "-m",
        "--first-parent",
        ...options,
        sha.value,
        "--",
        ...(safePath === undefined ? [] : [safePath]),
      ];
    } else {
      if (parsed.data.staged !== true && safePath !== undefined) {
        const others = await git(cwd, [
          "--no-optional-locks",
          "--literal-pathspecs",
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          safePath,
        ]);
        untracked = others.code === 0 && others.stdout.trim() !== "";
      }
      args = untracked
        ? ["diff", "--no-index", ...options, "--", "/dev/null", safePath!]
        : [
            "--no-optional-locks",
            "--literal-pathspecs",
            "diff",
            ...(parsed.data.staged === true ? ["--cached"] : []),
            ...options,
            "--",
            ...(safePath === undefined ? [] : [safePath]),
          ];
    }
    const res = await git(cwd, args);
    // --no-index는 차이가 있으면 1로 끝난다.
    if (res.code !== 0 && !(untracked && res.code === 1)) {
      return gitFailure(res, "git diff failed");
    }
    const truncated = res.stdout.length > DIFF_MAX_CHARS;
    const text = truncated ? res.stdout.slice(0, DIFF_MAX_CHARS) : res.stdout;
    const binary = /Binary files .+ differ|GIT binary patch/.test(text);
    return ok({ diff: text, truncated, binary, untracked });
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
        parsed.data.all === true
          ? ["add", "-A"]
          : ["--literal-pathspecs", "add", "--", ...safePaths];
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
            : ["--literal-pathspecs", "reset", "HEAD", "--", ...safePaths];
      } else {
        args =
          parsed.data.all === true
            ? ["rm", "--cached", "-r", "--", "."]
            : ["--literal-pathspecs", "rm", "--cached", "--", ...safePaths];
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

    // spec 5.5: 같은 체크아웃에서 agent turn이 도는 동안 전체 버리기는 그 turn의 작업을 지운다.
    if (
      parsed.data.all === true &&
      deps.hasActiveTurnInCheckout(
        target.value.project,
        target.value.worktreeId,
      )
    ) {
      return refused(
        "active_agent",
        "cannot discard all changes while an agent turn is running in this checkout",
      );
    }

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
            ["--literal-pathspecs", "checkout", "--", ...trackedTargets],
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
            ["--literal-pathspecs", "clean", "-fd", "--", ...untrackedTargets],
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

  // spec 3.4.2 불변식 1과 spec 5.5 커밋 전 검사: 미해결 충돌·충돌 마커·빈 staged·중첩 저장소 gitlink를 거절한다.
  // 진행 중 merge·cherry-pick·revert는 미해결이 0이면 커밋으로 마무리한다(Complete Merge). rebase는 커밋으로 잇지 않는다.
  // hook과 서명은 저장소 설정대로 돈다(--no-verify·--no-gpg-sign을 붙이지 않는다).
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
    const cwd = target.value.cwd;

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const ops = await readGitOperationsState(target.value.gitDir);
      if (ops.in_rebase) {
        return refused(
          "operation_in_progress",
          "a rebase is in progress; continue or abort it in the terminal",
        );
      }
      const finishing = ops.in_merge || ops.in_cherry_pick || ops.in_revert;
      const st = await git(cwd, [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
      ]);
      if (st.code !== 0) return gitFailure(st, "git status failed");
      const parsedStatus = parsePorcelainV2Z(st.stdout);
      if (parsedStatus.conflicted_count > 0) {
        return refused(
          "unresolved_conflicts",
          "cannot commit while unmerged conflict entries remain",
        );
      }
      if (parsedStatus.staged_count === 0 && !finishing) {
        return refused("nothing_staged", "nothing staged to commit");
      }
      const stagedDiff = await git(cwd, [
        "--no-optional-locks",
        "diff",
        "--cached",
        "--no-color",
        "--no-ext-diff",
      ]);
      const markers =
        stagedDiff.code === 0 ? conflictMarkersInDiff(stagedDiff.stdout) : [];
      if (markers.length > 0) {
        return refused(
          "conflict_markers",
          "staged changes contain unresolved conflict markers (<<<<<<< / >>>>>>>)",
          { markers },
        );
      }
      // 미추적 중첩 저장소를 `git add`하면 내용 없이 gitlink 한 줄만 커밋된다.
      const added = await git(cwd, [
        "--no-optional-locks",
        "diff",
        "--cached",
        "--raw",
        "--diff-filter=A",
        "-z",
      ]);
      const gitlinks: string[] = [];
      if (added.code === 0) {
        const parts = added.stdout.split("\0");
        for (let at = 0; at + 1 < parts.length; at += 2) {
          if (/^:\d{6} 160000 /.test(parts[at] ?? "")) {
            gitlinks.push(parts[at + 1] ?? "");
          }
        }
      }
      if (gitlinks.length > 0) {
        const declared = await git(cwd, [
          "config",
          "-f",
          ".gitmodules",
          "--get-regexp",
          "^submodule\\..*\\.path$",
        ]);
        const paths = new Set(
          declared.code === 0
            ? declared.stdout
                .split(/\r?\n/)
                .map((line) => line.split(" ").slice(1).join(" "))
            : [],
        );
        const nested = gitlinks.filter((path) => !paths.has(path));
        if (nested.length > 0) {
          return refused(
            "nested_repository",
            "staged changes add a nested git repository without its files; unstage it or add it as a submodule",
            { paths: nested },
          );
        }
      }

      const hooks = await commitHooksOf(cwd, git);
      const res = await git(cwd, ["commit", "-F", "-"], {
        stdin: parsed.data.message,
        retryLocks: true,
        timeoutMs: COMMIT_TIMEOUT_MS,
      });
      if (res.code !== 0) {
        return gitFailure(res, "git commit failed", {
          hookFailure: hooks.some(
            (hook) => hook === "pre-commit" || hook === "commit-msg",
          ),
        });
      }
      const head = await git(cwd, ["rev-parse", "HEAD"]);
      const branch = await git(cwd, ["symbolic-ref", "--short", "HEAD"]);
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

  const log: ReadHandler = async (who, raw) => {
    const parsed = sourceControlLog.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid log input" });
    }
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
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

  const show: ReadHandler = async (who, raw) => {
    const parsed = sourceControlShow.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid show input" });
    }
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
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

  const branches: ReadHandler = async (who, raw) => {
    const parsed = sourceControlBranches.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid branches input" });
    }
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
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
        details: { reason: "active_agent" },
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
        details: { reason: "active_agent" },
      });
    }

    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const res = await git(
        target.value.cwd,
        ["switch", "--", safeBranch.value],
        { retryLocks: true },
      );
      if (res.code !== 0) {
        if (/invalid reference|did not match any/i.test(res.stderr)) {
          return err({
            code: "not_found" as const,
            message: res.stderr.trim() || "branch not found",
          });
        }
        if (/already (checked out|used by worktree)/i.test(res.stderr)) {
          return refused(
            "branch_checked_out",
            res.stderr.trim() || "branch is checked out in another worktree",
          );
        }
        // 자동 stash 하지 않는다. 바뀐 파일이 덮이면 git이 멈추고 그 이유를 그대로 보인다.
        return gitFailure(res, "git switch failed");
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
        return refused(
          "git_error",
          "cannot push from detached HEAD without specifying branch",
        );
      }
      const remote = parsed.data.remote ?? "origin";
      const args = [
        "push",
        ...(parsed.data.set_upstream === true ? ["-u"] : []),
        "--",
        remote,
        branch,
      ];
      const remotes = await git(target.value.cwd, ["remote"]);
      if (remotes.code === 0 && remotes.stdout.trim() === "") {
        return refused("no_remote", "no remote configured");
      }
      const res = await git(target.value.cwd, args, {
        timeoutMs: NETWORK_TIMEOUT_MS,
        retryLocks: true,
        extraEnv: await networkEnv(target.value.cwd, git),
      });
      if (res.code !== 0) {
        const cmd = `git -C ${shellQuote(target.value.cwd)} ${args.map(shellQuote).join(" ")}`;
        return gitFailure(res, "git push failed", { command: cmd });
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
        timeoutMs: NETWORK_TIMEOUT_MS,
        retryLocks: true,
        extraEnv: await networkEnv(target.value.cwd, git),
      });
      if (res.code !== 0) {
        const cmd = `git -C ${shellQuote(target.value.cwd)} ${args.map(shellQuote).join(" ")}`;
        // diverged면 merge·rebase를 하지 않고 멈춘다(--ff-only). 화면이 "Branch has diverged from upstream"을 보인다.
        return gitFailure(res, "git pull --ff-only failed", { command: cmd });
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

  const fetchRemote: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlFetch.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid fetch input" });
    }
    if (parsed.data.remote !== undefined) {
      const safeRemote = assertSafeRefName(parsed.data.remote, "remote");
      if (!safeRemote.ok) return safeRemote;
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const cwd = target.value.cwd;
    const remotes = await git(cwd, ["remote"]);
    if (remotes.code === 0 && remotes.stdout.trim() === "") {
      return refused("no_remote", "no remote configured");
    }
    // FETCH_HEAD를 쓰지 않아 다른 worktree·터미널의 fetch와 다투지 않는다.
    const args = [
      "fetch",
      "--quiet",
      "--prune",
      "--no-write-fetch-head",
      "--no-auto-maintenance",
      ...(parsed.data.remote === undefined ? [] : ["--", parsed.data.remote]),
    ];
    const res = await git(cwd, args, {
      timeoutMs: NETWORK_TIMEOUT_MS,
      extraEnv: await networkEnv(cwd, git),
    });
    if (res.code !== 0) {
      const cmd = `git -C ${shellQuote(cwd)} ${args.map(shellQuote).join(" ")}`;
      return gitFailure(res, "git fetch failed", { command: cmd });
    }
    deps.onChanged?.(
      target.value.project,
      target.value.worktreeId ?? undefined,
    );
    return ok({
      remote: parsed.data.remote ?? null,
      summary: res.stderr.trim().split(/\r?\n/)[0] || "fetched",
    });
  };

  const abort: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlAbort.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid abort input" });
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const ops = await readGitOperationsState(target.value.gitDir);
      const operation = operationOf(ops);
      if (operation === null) {
        return refused(
          "no_operation",
          "no merge, rebase, cherry-pick or revert is in progress",
        );
      }
      const res = await git(
        target.value.cwd,
        [ABORT_COMMAND[operation], "--abort"],
        { retryLocks: true },
      );
      if (res.code !== 0)
        return gitFailure(res, `git ${operation} --abort failed`);
      return ok({ operation });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  // 마커가 남은 파일을 해결로 표시하면 충돌 마커가 그대로 커밋될 수 있다(`git add -A` 함정).
  const markResolved: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlMarkResolved.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message:
          parsed.error.issues[0]?.message ?? "invalid mark_resolved input",
      });
    }
    const safePaths: string[] = [];
    for (const p of parsed.data.paths) {
      const checked = assertSafeRepoRelPath(p);
      if (!checked.ok) return checked;
      safePaths.push(checked.value);
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const cwd = target.value.cwd;
    const done = await mutex.run(target.value.gitCommonDir, async () => {
      if (parsed.data.keep !== "deletion") {
        const marked: string[] = [];
        for (const path of safePaths) {
          const full = join(cwd, path);
          if (!(await insideRoot(cwd, full))) continue;
          try {
            if (hasConflictMarkers(await readFile(full, "utf8")))
              marked.push(path);
          } catch {
            // 지워진 쪽을 남기는 충돌은 읽을 파일이 없다.
          }
        }
        if (marked.length > 0) {
          return refused(
            "conflict_markers",
            "these files still contain conflict markers",
            { files: marked },
          );
        }
      }
      const args =
        parsed.data.keep === "deletion"
          ? ["--literal-pathspecs", "rm", "--quiet", "--", ...safePaths]
          : ["--literal-pathspecs", "add", "--", ...safePaths];
      const res = await git(cwd, args, { retryLocks: true });
      if (res.code !== 0)
        return gitFailure(res, "git could not mark files as resolved");
      return ok({ resolved: safePaths.length });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  const branchRename: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlBranchRename.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid branch_rename input",
      });
    }
    const from = assertSafeRefName(parsed.data.from, "from");
    if (!from.ok) return from;
    const to = assertSafeRefName(parsed.data.to, "to");
    if (!to.ok) return to;
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const cwd = target.value.cwd;
    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const format = await git(cwd, ["check-ref-format", "--branch", to.value]);
      if (format.code !== 0) {
        return err({
          code: "invalid_input" as const,
          message: `invalid branch name "${to.value}"`,
        });
      }
      const res = await git(cwd, ["branch", "-m", from.value, to.value], {
        retryLocks: true,
      });
      if (res.code !== 0) {
        if (/already exists/i.test(res.stderr)) {
          return refused("branch_exists", res.stderr.trim());
        }
        return gitFailure(res, "git branch -m failed");
      }
      return ok({ name: to.value });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  // `git branch -d`만 쓴다. 병합되지 않은 브랜치는 지우지 않는다(강제 삭제 단추는 없다).
  const branchDelete: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlBranchDelete.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid branch_delete input",
      });
    }
    const name = assertSafeRefName(parsed.data.name, "name");
    if (!name.ok) return name;
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const cwd = target.value.cwd;
    const done = await mutex.run(target.value.gitCommonDir, async () => {
      const listed = await listGitWorktrees(
        target.value.repoRoot,
        target.value.gitCommonDir,
        git,
      );
      const holder = listed.ok
        ? listed.value.find((wt) => wt.branch === name.value)
        : undefined;
      if (holder !== undefined) {
        return refused(
          "branch_checked_out",
          `branch "${name.value}" is checked out in ${holder.path}`,
        );
      }
      const res = await git(cwd, ["branch", "-d", name.value], {
        retryLocks: true,
      });
      if (res.code !== 0) {
        if (/not fully merged/i.test(res.stderr)) {
          return refused(
            "unmerged",
            `branch "${name.value}" is not fully merged; it was kept`,
          );
        }
        if (/not found/i.test(res.stderr)) {
          return err({
            code: "not_found" as const,
            message: res.stderr.trim(),
          });
        }
        return gitFailure(res, "git branch -d failed");
      }
      return ok({ deleted: true as const });
    });
    if (done.ok) {
      deps.onChanged?.(
        target.value.project,
        target.value.worktreeId ?? undefined,
      );
    }
    return done;
  };

  const ignored: ReadHandler = async (who, raw) => {
    const parsed = sourceControlIgnored.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid ignored input" });
    }
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
    const paths: string[] = [];
    for (const p of parsed.data.paths) {
      const checked = assertSafeRepoRelPath(p);
      if (checked.ok) paths.push(checked.value);
    }
    if (paths.length === 0) return ok({ ignored: [] });
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const res = await git(
      target.value.cwd,
      ["--no-optional-locks", "check-ignore", "--stdin", "-z"],
      { stdin: `${paths.join("\0")}\0` },
    );
    // 1은 무시되는 것이 하나도 없다는 뜻이다.
    if (res.code === 1) return ok({ ignored: [] });
    if (res.code !== 0) return gitFailure(res, "git check-ignore failed");
    return ok({ ignored: res.stdout.split("\0").filter((p) => p !== "") });
  };

  const fileAt: ReadHandler = async (who, raw) => {
    const parsed = sourceControlFileAt.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid file_at input" });
    }
    const scope = await checkAgentProjectScope(
      who,
      parsed.data.project as Id<"prj">,
    );
    if (!scope.ok) return scope;
    const safePath = assertSafeRepoRelPath(parsed.data.path);
    if (!safePath.ok) return safePath;
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const cwd = target.value.cwd;
    const rev = parsed.data.rev;
    if (rev === "worktree") {
      const full = join(cwd, safePath.value);
      if (!(await insideRoot(cwd, full))) {
        return ok({ base64: null, size: 0, too_large: false });
      }
      try {
        const info = await stat(full);
        if (info.size > FILE_AT_MAX_BYTES) {
          return ok({ base64: null, size: info.size, too_large: true });
        }
        const bytes = await readFile(full);
        return ok({
          base64: bytes.toString("base64"),
          size: bytes.length,
          too_large: false,
        });
      } catch {
        return ok({ base64: null, size: 0, too_large: false });
      }
    }
    let spec: string;
    if (rev === "index") spec = `:${safePath.value}`;
    else {
      // 커밋 diff의 앞 그림은 `<sha>^`(첫 parent)다. 끝의 `^` 하나만 받고 나머지는 ref 규칙으로 본다.
      const parent = rev.endsWith("^");
      const safeRev = assertSafeRefName(parent ? rev.slice(0, -1) : rev, "rev");
      if (!safeRev.ok) return safeRev;
      spec = `${safeRev.value}${parent ? "^" : ""}:${safePath.value}`;
    }
    const size = await git(cwd, [
      "--no-optional-locks",
      "cat-file",
      "-s",
      spec,
    ]);
    if (size.code !== 0) return ok({ base64: null, size: 0, too_large: false });
    const bytes = Number(size.stdout.trim());
    if (!Number.isFinite(bytes) || bytes > FILE_AT_MAX_BYTES) {
      return ok({ base64: null, size: bytes || 0, too_large: true });
    }
    const blob = await git(
      cwd,
      ["--no-optional-locks", "cat-file", "blob", spec],
      {
        binary: true,
        maxOutputBytes: FILE_AT_MAX_BYTES + 1,
      },
    );
    if (blob.code !== 0) return gitFailure(blob, "git cat-file failed");
    return ok({ base64: blob.stdout, size: bytes, too_large: false });
  };

  // 정한 것 14: 만든 글을 돌려줄 뿐 커밋하지 않는다. 재료는 staged diff(파일별 공평 분배)와 최근 커밋 제목이다.
  const suggestMessage: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlSuggestMessage.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid suggest input" });
    }
    if (deps.suggest === undefined) {
      return refused("no_model", "AI commit messages are not available here");
    }
    const available = await deps.suggest.available();
    if (!available.available) {
      return refused(
        "no_model",
        available.reason ?? "no default model is set for the lophn agent",
      );
    }
    const target = await resolveTarget(parsed.data);
    if (!target.ok) return target;
    const cwd = target.value.cwd;
    const [staged, names, recent] = await Promise.all([
      git(cwd, [
        "--no-optional-locks",
        "diff",
        "--cached",
        "--no-color",
        "--no-ext-diff",
        "-M",
      ]),
      git(cwd, [
        "--no-optional-locks",
        "diff",
        "--cached",
        "--name-only",
        "-z",
      ]),
      git(cwd, ["--no-optional-locks", "log", "-n", "10", "--format=%s"]),
    ]);
    if (staged.code !== 0)
      return gitFailure(staged, "git diff --cached failed");
    if (staged.stdout.trim() === "") {
      return refused(
        "nothing_staged",
        "stage changes before asking for a message",
      );
    }
    const asked = await deps.suggest.queue.ask({
      request: parsed.data.request,
      diff: fairDiff(staged.stdout, SUGGEST_DIFF_BUDGET),
      files: names.stdout.split("\0").filter((name) => name !== ""),
      recent_subjects:
        recent.code === 0
          ? recent.stdout.split(/\r?\n/).filter((line) => line.trim() !== "")
          : [],
    });
    return asked.ok ? ok({ message: asked.value }) : asked;
  };

  const suggestCancel: MemoryHandler = async (who, raw) => {
    const allowed = requireWriteUser(who);
    if (!allowed.ok) return allowed;
    const parsed = sourceControlSuggestCancel.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid cancel input" });
    }
    return ok({
      cancelled: deps.suggest?.queue.cancel(parsed.data.request) ?? false,
    });
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
    fetchRemote,
    abort,
    markResolved,
    branchRename,
    branchDelete,
    ignored,
    fileAt,
    suggestMessage,
    suggestCancel,
  };
}
