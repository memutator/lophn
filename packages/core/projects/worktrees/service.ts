// git worktree 핵심 수명주기 service.
// 생성 파이프라인·롤백(spec 3.2.4), adopt, rename, remove preflight·가드 표·3중 소유권·브랜치 보존(spec 3.5),
// gitignored 파일 복사·setup/teardown 훅(spec 3.3), 재시작 복구·반쯤 지워진 폴더 정리(spec 3.5.5)를 담당한다.
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import {
  type Clock,
  err,
  type IdSource,
  type Logger,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  WorktreeExternal,
  WorktreeGitStatus,
  WorktreeHardBlock,
  WorktreeRecord,
  WorktreeRemovePreflight,
  WorktreeSettings,
  WorktreeSetupRun,
} from "../../../protocol/projects/worktrees.ts";
import { copyGitignoredFiles } from "./copy.ts";
import {
  countUnpushedCommits,
  ensureUniqueBranchName,
  type GitRunner,
  hasSubmodules,
  inspectGitRepo,
  isWorktreeLockedInGit,
  listGitWorktrees,
  pruneWorktreesSafely,
  readGitdirAdminName,
  readWorktreeGitStatus,
  RepoGitMutex,
  resolveBaseRef,
  runGit,
  verifyGitdirPointsToCommonDir,
} from "./git.ts";
import {
  assertSafeRefName,
  computeWorktreePath,
  generateAutoBranchName,
  isFilesystemRoot,
  isSameOrInside,
  isStrictlyInside,
  safeRealpath,
  validateWorktreesRoot,
} from "./paths.ts";
import { type StoredWorktreeRow, toPublicRecord } from "./store.ts";
import type { WorktreeWatcher } from "./watcher.ts";

export const TEARDOWN_TIMEOUT_MS = 60_000;

export type WorktreeHookRunner = {
  runSetup(input: {
    project: Id<"prj">;
    worktree: WorktreeRecord;
    commandId: string;
  }): Promise<Result<WorktreeSetupRun>>;
  runTeardown(input: {
    project: Id<"prj">;
    worktree: WorktreeRecord;
    commandId: string;
    timeoutMs: number;
  }): Promise<
    Result<{
      ok: boolean;
      exit_code: number | null;
      tail?: string;
      error?: string;
    }>
  >;
};

export type WorktreeActivity = {
  activeSessions(worktreeId: Id<"wkt">): readonly Id<"ses">[];
  activeTerminals(worktreeId: Id<"wkt">): readonly string[];
  stopSessionsAndTerminals(worktreeId: Id<"wkt">): Promise<Result<void>>;
};

export type WorktreeServiceDeps = {
  clock: Clock;
  random: RandomSource;
  ids: IdSource;
  homeDir: string | null;
  defaultWorktreesRoot: string;
  configuredWorktreesRoot(): string;
  projectFolders(project: string): Result<readonly string[]>;
  // 모든 활성 project의 등록 폴더 목록. 관리 루트가 타 저장소 내부/상위인지 검증할 때 쓴다.
  allProjectFolders?(): readonly string[];
  loadProjectWorktrees(
    project: string,
    options?: { includeRemoved?: boolean },
  ): Result<StoredWorktreeRow[]>;
  loadWorktreeById(id: string): StoredWorktreeRow | null;
  loadWorktreeByIdempotencyKey(
    project: string,
    key: string,
  ): StoredWorktreeRow | null;
  loadWorktreesByStatuses(statuses: readonly string[]): StoredWorktreeRow[];
  loadSettings(project: string): Result<WorktreeSettings>;
  upsert(
    project: Id<"prj">,
    record: WorktreeRecord & {
      idempotency_key?: string | null;
      created_branch?: boolean;
      managed_root?: string | null;
    },
  ): Promise<Result<void>>;
  patch(
    project: Id<"prj">,
    patch: {
      id: Id<"wkt">;
      path?: string;
      git_admin_name?: string | null;
      label?: string;
      branch?: string | null;
      status?: WorktreeRecord["status"];
      updated_at: string;
    },
  ): Promise<Result<void>>;
  deleteRow(project: Id<"prj">, id: Id<"wkt">): Promise<Result<void>>;
  activity: WorktreeActivity;
  hooks?: WorktreeHookRunner;
  watcher?: () => WorktreeWatcher | undefined;
  mutex?: RepoGitMutex;
  git?: GitRunner;
  platform?: NodeJS.Platform;
  logger?: Logger;
  onChanged(project: Id<"prj">, worktree?: Id<"wkt">): void;
};

export type WorktreeService = ReturnType<typeof createWorktreeService>;

async function isSymlink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function nearestExistingDir(target: string): Promise<string | null> {
  let cur = safeRealpath(target);
  for (let depth = 0; depth < 64; depth += 1) {
    if (await pathExists(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function createWorktreeService(deps: WorktreeServiceDeps) {
  const git = deps.git ?? runGit;
  const mutex = deps.mutex ?? new RepoGitMutex();
  const platform = deps.platform ?? process.platform;
  // 과거 설정 변경 이력까지 포함해 현재 프로세스 수명 동안 쓰인 관리 루트를 기억한다.
  const knownManagedRoots = new Set<string>([
    safeRealpath(deps.defaultWorktreesRoot),
  ]);
  // 최근 setup 실행 결과(메모리). setup 실패 시 worktree를 남기고 상태·꼬리를 조회할 수 있게 한다.
  const setupRuns = new Map<string, WorktreeSetupRun>();

  function effectiveWorktreesRoot(): string {
    const configured = deps.configuredWorktreesRoot().trim();
    const chosen = configured === "" ? deps.defaultWorktreesRoot : configured;
    knownManagedRoots.add(safeRealpath(chosen));
    return chosen;
  }

  function managedRoots(): string[] {
    effectiveWorktreesRoot();
    return [...knownManagedRoots];
  }

  // 현재 설정·기본 루트에 더해 행 생성 시점에 검증·영속화한 `managed_root`도 인정해
  // 설정 변경·재기동 뒤에도 기존 managed worktree 소유권 검증과 정리가 깨지지 않게 한다.
  function managedRootsForRow(row: StoredWorktreeRow): string[] {
    const roots = new Set<string>(managedRoots());
    if (row.managed_root !== null) {
      const checked = validateWorktreesRoot(row.managed_root, {
        homeDir: deps.homeDir,
        repoRoots: [row.repo_root],
        platform,
      });
      if (checked.ok) {
        roots.add(checked.value);
      }
    }
    return [...roots];
  }

  async function resolveProjectGitFolder(
    project: string,
    explicitFolder?: string,
  ): Promise<
    Result<{ repoRoot: string; gitCommonDir: string; isUnborn: boolean }>
  > {
    const folders = deps.projectFolders(project);
    if (!folders.ok) return folders;
    if (folders.value.length === 0) {
      return err({
        code: "invalid_input",
        message: "project has no registered folder",
        details: { reason: "no_folder" },
      });
    }

    let chosen: string | undefined;
    if (explicitFolder !== undefined) {
      const targetReal = safeRealpath(explicitFolder);
      chosen = folders.value.find(
        (folder) =>
          folder === explicitFolder || safeRealpath(folder) === targetReal,
      );
      if (chosen === undefined) {
        return err({
          code: "invalid_input",
          message: "folder is not registered in this project",
          details: { reason: "unknown_folder" },
        });
      }
    } else if (folders.value.length === 1) {
      chosen = folders.value[0]!;
    } else {
      // 등록 폴더가 여럿이면 git 저장소인 폴더가 정확히 하나일 때만 자동 선택하고, 여럿이면 명시 지정 요구.
      const gitFolders: string[] = [];
      for (const folder of folders.value) {
        const inspected = await inspectGitRepo(folder, git);
        if (inspected.ok) gitFolders.push(folder);
      }
      if (gitFolders.length === 1) {
        chosen = gitFolders[0]!;
      } else if (gitFolders.length === 0) {
        return err({
          code: "invalid_input",
          message: "project has no git repository folder",
          details: { reason: "not_git_repository" },
        });
      } else {
        return err({
          code: "invalid_input",
          message:
            "project has multiple git folders; specify folder when creating a worktree",
          details: { reason: "ambiguous_folder" },
        });
      }
    }

    const inspected = await inspectGitRepo(chosen, git);
    if (!inspected.ok) return inspected;
    return ok({
      repoRoot: inspected.value.repo_root,
      gitCommonDir: inspected.value.git_common_dir,
      isUnborn: inspected.value.is_unborn,
    });
  }

  // spec 3.5.2: 3중 소유권 증명(managed ∧ 관리 루트 안 실경로 ∧ git_common_dir/gitdir 재검증).
  async function verifyManagedOwnership(
    row: StoredWorktreeRow,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (row.provenance !== "managed") {
      return { ok: false, reason: "not_managed" };
    }
    const targetPath = row.path;
    if (isFilesystemRoot(targetPath)) {
      return { ok: false, reason: "unsafe_path" };
    }
    if (deps.homeDir !== null) {
      const home = safeRealpath(deps.homeDir);
      if (isSameOrInside(home, safeRealpath(targetPath), platform)) {
        return { ok: false, reason: "unsafe_path" };
      }
    }
    if (await isSymlink(targetPath)) {
      return { ok: false, reason: "unsafe_path" };
    }
    const realTarget = safeRealpath(targetPath);
    const realRepo = safeRealpath(row.repo_root);
    if (realTarget === realRepo) {
      return { ok: false, reason: "unsafe_path" };
    }
    const insideManagedRoot = managedRootsForRow(row).some((root) =>
      isStrictlyInside(realTarget, root, platform),
    );
    if (!insideManagedRoot) {
      return { ok: false, reason: "outside_managed_root" };
    }
    if (await pathExists(targetPath)) {
      const inspected = await inspectGitRepo(targetPath, git);
      const commonMatches =
        inspected.ok && inspected.value.git_common_dir === row.git_common_dir;
      const gitdirMatches = await verifyGitdirPointsToCommonDir(
        targetPath,
        row.git_common_dir,
        row.git_admin_name,
      );
      if (!commonMatches && !gitdirMatches) {
        return { ok: false, reason: "git_ownership_mismatch" };
      }
    }
    return { ok: true };
  }

  async function computePreflight(
    row: StoredWorktreeRow,
  ): Promise<WorktreeRemovePreflight> {
    const activeSessions = [
      ...deps.activity.activeSessions(row.id as Id<"wkt">),
    ];
    const activeTerminals = [
      ...deps.activity.activeTerminals(row.id as Id<"wkt">),
    ];
    const settingsRes = deps.loadSettings(row.project_id);
    const teardownCommand = settingsRes.ok
      ? settingsRes.value.teardown_command
      : null;

    // adopted worktree는 디스크를 건드리지 않고 untrack만 한다.
    if (row.provenance === "adopted") {
      return {
        worktree_id: row.id as Id<"wkt">,
        provenance: "adopted",
        path: row.path,
        branch: row.branch,
        can_remove: activeSessions.length === 0 && activeTerminals.length === 0,
        requires_force: false,
        requires_stop_sessions:
          activeSessions.length > 0 || activeTerminals.length > 0,
        hard_blocks: [],
        dirty: false,
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        conflicted_count: 0,
        has_submodules: false,
        locked: false,
        nested_worktrees: [],
        active_sessions: activeSessions,
        active_terminals: activeTerminals,
        ahead: null,
        unpushed_commits: null,
        deletable_branch: false,
        teardown_command: null,
      };
    }

    const hardBlocks: WorktreeHardBlock[] = [];
    const ownership = await verifyManagedOwnership(row);
    if (!ownership.ok) {
      hardBlocks.push("unsafe_path");
    }

    // 중첩 worktree 검사: 다른 active 등록 worktree가 이 경로 안에 있으면 무조건 차단.
    const siblings = deps.loadProjectWorktrees(row.project_id);
    const nested: Id<"wkt">[] = [];
    if (siblings.ok) {
      const realSelf = safeRealpath(row.path);
      for (const other of siblings.value) {
        if (other.id === row.id || other.status === "removed") continue;
        if (isStrictlyInside(safeRealpath(other.path), realSelf, platform)) {
          nested.push(other.id as Id<"wkt">);
        }
      }
    }
    if (nested.length > 0) hardBlocks.push("nested_worktree");

    const locked = await isWorktreeLockedInGit(
      row.git_common_dir,
      row.git_admin_name,
    );
    if (locked) hardBlocks.push("worktree_locked");

    const status = await readWorktreeGitStatus({
      worktreeId: row.id,
      worktreePath: row.path,
      repoRoot: row.repo_root,
      clock: deps.clock,
      git,
    });
    const submodules =
      status.presence === "present"
        ? await hasSubmodules(row.path, git)
        : false;
    const unpushed =
      status.presence === "present"
        ? await countUnpushedCommits(row.path, status.branch ?? row.branch, git)
        : null;

    const requiresForce = status.dirty || submodules;
    const requiresStopSessions =
      activeSessions.length > 0 || activeTerminals.length > 0;
    const canRemove =
      hardBlocks.length === 0 && !requiresForce && !requiresStopSessions;

    return {
      worktree_id: row.id as Id<"wkt">,
      provenance: "managed",
      path: row.path,
      branch: status.branch ?? row.branch,
      can_remove: canRemove,
      requires_force: requiresForce,
      requires_stop_sessions: requiresStopSessions,
      hard_blocks: hardBlocks,
      dirty: status.dirty,
      staged_count: status.staged_count,
      unstaged_count: status.unstaged_count,
      untracked_count: status.untracked_count,
      conflicted_count: status.conflicted_count,
      has_submodules: submodules,
      locked,
      nested_worktrees: nested,
      active_sessions: activeSessions,
      active_terminals: activeTerminals,
      ahead: status.ahead,
      unpushed_commits: unpushed,
      deletable_branch:
        row.created_branch && (status.branch ?? row.branch) !== null,
      teardown_command: teardownCommand,
    };
  }

  // spec 3.5.5: 부분 삭제 잔여 폴더 복구(not a working tree 시 git worktree list 미등록 + gitdir: 검증 뒤 안전 rm).
  async function removeCheckoutDisk(
    row: StoredWorktreeRow,
    options: { force: boolean; hasSubmodules: boolean },
  ): Promise<Result<void>> {
    if (!(await pathExists(row.path))) {
      await pruneWorktreesSafely(
        row.repo_root,
        row.git_common_dir,
        git,
        platform,
      );
      return ok(undefined);
    }

    const args = ["worktree", "remove"];
    if (options.force) {
      args.push("--force");
      if (options.hasSubmodules) {
        args.push("--force");
      }
    }
    args.push("--", row.path);

    let res = await git(row.repo_root, args, { retryLocks: true });
    // Windows CWD 핸들 해제 지연 대비 짧은 재시도.
    if (res.code !== 0 && platform === "win32") {
      for (const delay of [100, 300, 700]) {
        await sleep(delay);
        res = await git(row.repo_root, args, { retryLocks: true });
        if (res.code === 0) break;
      }
    }

    if (res.code === 0) {
      await pruneWorktreesSafely(
        row.repo_root,
        row.git_common_dir,
        git,
        platform,
      );
      return ok(undefined);
    }

    // "is not a working tree" 부분 잔여 폴더 안전 정리(spec 3.5.5).
    if (/is not a working tree/i.test(res.stderr)) {
      const listed = await listGitWorktrees(
        row.repo_root,
        row.git_common_dir,
        git,
      );
      const realTarget = safeRealpath(row.path);
      const stillRegistered =
        listed.ok && listed.value.some((item) => item.path === realTarget);
      const gitdirValid = await verifyGitdirPointsToCommonDir(
        row.path,
        row.git_common_dir,
      );
      if (!stillRegistered && gitdirValid) {
        await rm(row.path, { recursive: true, force: true });
        await pruneWorktreesSafely(
          row.repo_root,
          row.git_common_dir,
          git,
          platform,
        );
        return ok(undefined);
      }
    }

    return err({
      code: "unavailable",
      message: res.stderr.trim() || "failed to remove git worktree",
      details: { reason: "git_remove_failed" },
    });
  }

  return {
    getSetupRun(worktreeId: string): WorktreeSetupRun | null {
      return setupRuns.get(worktreeId) ?? null;
    },

    getManagedRoot(): string {
      return effectiveWorktreesRoot();
    },

    getMutex(): RepoGitMutex {
      return mutex;
    },

    // ready 상태이며 project에 속한 worktree를 돌려준다. removing·removed·missing이면 conflict다.
    resolveReady(project: string, worktreeId: string): Result<WorktreeRecord> {
      const row = deps.loadWorktreeById(worktreeId);
      if (row === null || row.project_id !== project) {
        return err({
          code: "not_found",
          message: "worktree not found in this project",
        });
      }
      if (row.status !== "ready") {
        return err({
          code: "conflict",
          message: `worktree "${row.label}" is ${row.status} and cannot be used`,
          details: { reason: `worktree_${row.status}` },
        });
      }
      return ok(toPublicRecord(row));
    },

    async list(input: {
      project: Id<"prj">;
      includeExternal?: boolean;
      includeRemoved?: boolean;
    }): Promise<
      Result<{
        entries: {
          record: WorktreeRecord;
          status: WorktreeGitStatus;
          setup: WorktreeSetupRun | null;
        }[];
        external?: WorktreeExternal[];
        settings: WorktreeSettings;
      }>
    > {
      const rows = deps.loadProjectWorktrees(input.project, {
        includeRemoved: input.includeRemoved,
      });
      if (!rows.ok) return rows;
      const settings = deps.loadSettings(input.project);
      if (!settings.ok) return settings;

      const watcher = deps.watcher?.();
      const entries = await Promise.all(
        rows.value.map(async (row) => {
          const status =
            row.status === "removed"
              ? {
                  worktree_id: row.id as Id<"wkt">,
                  presence: "missing" as const,
                  branch: row.branch,
                  detached: row.branch === null,
                  head_sha: null,
                  dirty: false,
                  staged_count: 0,
                  unstaged_count: 0,
                  untracked_count: 0,
                  conflicted_count: 0,
                  ahead: null,
                  behind: null,
                  updated_at: row.updated_at,
                }
              : await readWorktreeGitStatus({
                  worktreeId: row.id,
                  worktreePath: row.path,
                  repoRoot: row.repo_root,
                  clock: deps.clock,
                  git,
                });
          if (row.status !== "removed") {
            watcher?.setCached(status);
          }
          return {
            record: toPublicRecord(row),
            status,
            setup: setupRuns.get(row.id) ?? null,
          };
        }),
      );

      let external: WorktreeExternal[] | undefined;
      if (input.includeExternal === true) {
        external = [];
        const knownPaths = new Set(
          rows.value
            .filter((r) => r.status !== "removed")
            .map((r) => safeRealpath(r.path)),
        );
        const folders = deps.projectFolders(input.project);
        const seenCommon = new Set<string>();
        if (folders.ok) {
          for (const folder of folders.value) {
            const inspected = await inspectGitRepo(folder, git);
            if (!inspected.ok) continue;
            if (seenCommon.has(inspected.value.git_common_dir)) continue;
            seenCommon.add(inspected.value.git_common_dir);
            const listed = await listGitWorktrees(
              inspected.value.repo_root,
              inspected.value.git_common_dir,
              git,
            );
            if (!listed.ok) continue;
            for (const item of listed.value) {
              if (item.bare) continue;
              if (item.path === inspected.value.repo_root) continue;
              if (knownPaths.has(item.path)) continue;
              external.push({
                path: item.path,
                repo_root: inspected.value.repo_root,
                git_common_dir: inspected.value.git_common_dir,
                git_admin_name: item.git_admin_name,
                branch: item.branch,
                head_sha: item.head_sha,
                locked: item.locked,
              });
            }
          }
        }
      }

      return ok({
        entries,
        ...(external === undefined ? {} : { external }),
        settings: settings.value,
      });
    },

    async get(input: {
      worktree: Id<"wkt">;
      includePreflight?: boolean;
    }): Promise<
      Result<{
        record: WorktreeRecord;
        status: WorktreeGitStatus;
        setup: WorktreeSetupRun | null;
        active_sessions_count: number;
        active_terminals_count: number;
        preflight?: WorktreeRemovePreflight;
      }>
    > {
      const row = deps.loadWorktreeById(input.worktree);
      if (row === null) {
        return err({ code: "not_found", message: "worktree not found" });
      }
      const status = await readWorktreeGitStatus({
        worktreeId: row.id,
        worktreePath: row.path,
        repoRoot: row.repo_root,
        clock: deps.clock,
        git,
      });
      deps.watcher?.()?.setCached(status);
      const activeSessions = deps.activity.activeSessions(row.id as Id<"wkt">);
      const activeTerminals = deps.activity.activeTerminals(
        row.id as Id<"wkt">,
      );
      const preflight =
        input.includePreflight === true
          ? await computePreflight(row)
          : undefined;
      return ok({
        record: toPublicRecord(row),
        status,
        setup: setupRuns.get(row.id) ?? null,
        active_sessions_count: activeSessions.length,
        active_terminals_count: activeTerminals.length,
        ...(preflight === undefined ? {} : { preflight }),
      });
    },

    // spec 3.2.4 생성 파이프라인과 실패 롤백.
    async create(input: {
      project: Id<"prj">;
      mode?: "new_branch" | "existing_branch";
      folder?: string;
      branch?: string;
      branchSeed?: string;
      baseRef?: string;
      label?: string;
      fetchBase?: boolean;
      idempotencyKey?: string;
      runSetup?: boolean;
    }): Promise<
      Result<{
        record: WorktreeRecord;
        status: WorktreeGitStatus;
        warnings: string[];
        copied_files: number;
        setup: WorktreeSetupRun | null;
      }>
    > {
      const mode = input.mode ?? "new_branch";

      // 멱등키 재호출 처리.
      if (input.idempotencyKey !== undefined) {
        const existing = deps.loadWorktreeByIdempotencyKey(
          input.project,
          input.idempotencyKey,
        );
        if (existing !== null && existing.status === "ready") {
          const status = await readWorktreeGitStatus({
            worktreeId: existing.id,
            worktreePath: existing.path,
            repoRoot: existing.repo_root,
            clock: deps.clock,
            git,
          });
          return ok({
            record: toPublicRecord(existing),
            status,
            warnings: [],
            copied_files: 0,
            setup: setupRuns.get(existing.id) ?? null,
          });
        }
      }

      // 1. 사전 검증 (디스크·DB 무변경).
      const repoRes = await resolveProjectGitFolder(
        input.project,
        input.folder,
      );
      if (!repoRes.ok) return repoRes;
      const { repoRoot, gitCommonDir, isUnborn } = repoRes.value;
      if (isUnborn) {
        return err({
          code: "conflict",
          message:
            "cannot create a worktree on an unborn repository (create an initial commit first)",
          details: { reason: "unborn_repository" },
        });
      }

      const projectFoldersRes = deps.projectFolders(input.project);
      const repoRoots = new Set<string>([
        repoRoot,
        ...(projectFoldersRes.ok ? projectFoldersRes.value : []),
        ...(deps.allProjectFolders?.() ?? []),
      ]);
      const validatedRoot = validateWorktreesRoot(effectiveWorktreesRoot(), {
        homeDir: deps.homeDir,
        repoRoots: [...repoRoots],
        platform,
      });
      if (!validatedRoot.ok) return validatedRoot;
      const worktreesRoot = validatedRoot.value;

      // 등록 project 밖의 임의 git working tree 안으로 관리 루트를 잡는 것도 차단한다.
      const existingAncestor = await nearestExistingDir(worktreesRoot);
      if (existingAncestor !== null) {
        const rootGit = await inspectGitRepo(existingAncestor, git);
        if (
          rootGit.ok &&
          isSameOrInside(worktreesRoot, rootGit.value.repo_root, platform)
        ) {
          return err({
            code: "invalid_input",
            message: "worktrees root cannot be inside a git working tree",
            details: { reason: "unsafe_worktrees_root" },
          });
        }
      }

      const warnings: string[] = [];
      let branch: string;
      let baseRef: string | null = null;
      let baseCommit: string | null = null;

      if (mode === "existing_branch") {
        if (!input.branch) {
          return err({
            code: "invalid_input",
            message: "branch is required for existing_branch mode",
          });
        }
        const safeBranch = assertSafeRefName(input.branch, "branch");
        if (!safeBranch.ok) return safeBranch;
        branch = safeBranch.value;

        const exists = await git(repoRoot, [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${branch}`,
        ]);
        if (exists.code !== 0) {
          return err({
            code: "not_found",
            message: `local branch "${branch}" does not exist`,
            details: { reason: "branch_not_found" },
          });
        }
        const listed = await listGitWorktrees(repoRoot, gitCommonDir, git);
        if (listed.ok && listed.value.some((wt) => wt.branch === branch)) {
          return err({
            code: "conflict",
            message: `branch "${branch}" is already checked out in another worktree`,
            details: { reason: "branch_in_use" },
          });
        }
        const tip = await git(repoRoot, [
          "rev-parse",
          "--verify",
          `refs/heads/${branch}^{commit}`,
        ]);
        baseCommit = tip.code === 0 ? tip.stdout.trim() || null : null;
      } else {
        const resolved = await resolveBaseRef({
          repoRoot,
          explicitBaseRef: input.baseRef,
          fetchBase: input.fetchBase,
          git,
        });
        if (!resolved.ok) return resolved;
        baseRef = resolved.value.base_ref;
        baseCommit = resolved.value.base_commit;
        warnings.push(...resolved.value.warnings);

        if (input.branch !== undefined) {
          const safeBranch = assertSafeRefName(input.branch, "branch");
          if (!safeBranch.ok) return safeBranch;
          const formatCheck = await git(repoRoot, [
            "check-ref-format",
            "--branch",
            safeBranch.value,
          ]);
          if (formatCheck.code !== 0) {
            return err({
              code: "invalid_input",
              message: `invalid branch name "${safeBranch.value}"`,
              details: { reason: "invalid_ref" },
            });
          }
          const exists = await git(repoRoot, [
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${safeBranch.value}`,
          ]);
          if (exists.code === 0) {
            return err({
              code: "conflict",
              message: `branch "${safeBranch.value}" already exists`,
              details: { reason: "branch_exists" },
            });
          }
          branch = safeBranch.value;
        } else {
          const rawCandidate = generateAutoBranchName(
            deps.random,
            input.branchSeed,
          );
          const unique = await ensureUniqueBranchName(
            repoRoot,
            rawCandidate,
            git,
          );
          if (!unique.ok) return unique;
          branch = unique.value;
        }
      }

      const id = deps.ids.newId("wkt") as Id<"wkt">;
      const targetPathRes = computeWorktreePath({
        worktreesRoot,
        repoRoot,
        gitCommonDir,
        branch,
        id,
        platform,
      });
      if (!targetPathRes.ok) return targetPathRes;
      const targetPath = targetPathRes.value;

      const label = (input.label?.trim() || branch).slice(0, 80);
      const now = deps.clock.now();

      // 2. ledger에 status: "creating" 선행 기록.
      const creatingRecord: WorktreeRecord & {
        idempotency_key: string | null;
        created_branch: boolean;
        managed_root: string;
      } = {
        id,
        project_id: input.project,
        repo_root: repoRoot,
        git_common_dir: gitCommonDir,
        path: targetPath,
        git_admin_name: null,
        label,
        branch,
        base_ref: baseRef,
        base_commit: baseCommit,
        provenance: "managed",
        status: "creating",
        idempotency_key: input.idempotencyKey ?? null,
        created_branch: mode === "new_branch",
        managed_root: worktreesRoot,
        created_at: now,
        updated_at: now,
      };
      const savedCreating = await deps.upsert(input.project, creatingRecord);
      if (!savedCreating.ok) return savedCreating;

      // 3~4. repo_git_lock 안에서 git worktree add + 사후 검증 + 실패 시 롤백.
      const gitResult = await mutex.run(gitCommonDir, async () => {
        let addedCheckout = false;
        let createdNewBranch = false;
        const rollback = async () => {
          if (addedCheckout || (await pathExists(targetPath))) {
            await git(
              repoRoot,
              ["worktree", "remove", "--force", "--", targetPath],
              { retryLocks: true },
            );
            await rm(targetPath, { recursive: true, force: true }).catch(
              () => undefined,
            );
            await pruneWorktreesSafely(repoRoot, gitCommonDir, git, platform);
          }
          if (createdNewBranch && baseCommit !== null) {
            // tip이 바뀌지 않았을 때만 새로 만든 브랜치를 되돌린다.
            const tip = await git(repoRoot, [
              "rev-parse",
              "--verify",
              `refs/heads/${branch}`,
            ]);
            if (tip.code === 0 && tip.stdout.trim() === baseCommit) {
              await git(repoRoot, ["branch", "-D", "--", branch], {
                retryLocks: true,
              });
            }
          }
          await deps.deleteRow(input.project, id);
        };

        try {
          await mkdir(dirname(targetPath), { recursive: true });
          const addArgs =
            mode === "existing_branch"
              ? ["worktree", "add", "--", targetPath, branch]
              : [
                  "worktree",
                  "add",
                  "--no-track",
                  "-b",
                  branch,
                  "--",
                  targetPath,
                  baseCommit!,
                ];
          const addRes = await git(repoRoot, addArgs, { retryLocks: true });
          if (addRes.code !== 0) {
            await rollback();
            const code: "conflict" | "unavailable" =
              /already checked out|already exists/i.test(addRes.stderr)
                ? "conflict"
                : "unavailable";
            return err({
              code,
              message: addRes.stderr.trim() || "git worktree add failed",
              details: { reason: "git_worktree_add_failed" },
            });
          }
          addedCheckout = true;
          createdNewBranch = mode === "new_branch";

          // 4. 사후 검증.
          const post = await inspectGitRepo(targetPath, git);
          if (!post.ok || post.value.git_common_dir !== gitCommonDir) {
            await rollback();
            return err({
              code: "unavailable" as const,
              message:
                "post-create verification failed: worktree does not belong to repository",
              details: { reason: "post_verify_failed" },
            });
          }
          const realPath = post.value.repo_root;
          const adminName = await readGitdirAdminName(realPath, gitCommonDir);
          return ok({ realPath, adminName });
        } catch (cause) {
          await rollback();
          return err({
            code: "unavailable" as const,
            message: cause instanceof Error ? cause.message : String(cause),
            details: { reason: "git_worktree_add_failed" },
          });
        }
      });

      if (!gitResult.ok) return gitResult;

      // 5. status: "ready" 커밋.
      const readyAt = deps.clock.now();
      const readyRecord: WorktreeRecord = {
        id,
        project_id: input.project,
        repo_root: repoRoot,
        git_common_dir: gitCommonDir,
        path: gitResult.value.realPath,
        git_admin_name: gitResult.value.adminName,
        label,
        branch,
        base_ref: baseRef,
        base_commit: baseCommit,
        provenance: "managed",
        status: "ready",
        created_at: now,
        updated_at: readyAt,
      };
      const patchedReady = await deps.patch(input.project, {
        id,
        path: readyRecord.path,
        git_admin_name: readyRecord.git_admin_name,
        status: "ready",
        updated_at: readyAt,
      });
      if (!patchedReady.ok) return patchedReady;

      // 6. 환경 준비: gitignored 파일 복사 + setup 명령 실행(실패해도 worktree는 유지).
      let copiedFiles = 0;
      let setupRun: WorktreeSetupRun | null = null;
      const settingsRes = deps.loadSettings(input.project);
      if (settingsRes.ok) {
        const settings = settingsRes.value;
        if (settings.copy_patterns.length > 0) {
          const copied = await copyGitignoredFiles({
            repoRoot,
            worktreePath: readyRecord.path,
            patterns: settings.copy_patterns,
            git,
          });
          copiedFiles = copied.copied;
          warnings.push(...copied.warnings);
        }
        const shouldRunSetup = input.runSetup ?? settings.run_setup;
        if (
          shouldRunSetup &&
          settings.setup_command !== null &&
          deps.hooks !== undefined
        ) {
          const ran = await deps.hooks.runSetup({
            project: input.project,
            worktree: readyRecord,
            commandId: settings.setup_command,
          });
          if (ran.ok) {
            setupRun = ran.value;
            setupRuns.set(id, setupRun);
            if (
              setupRun.status === "failed" ||
              setupRun.status === "timed_out"
            ) {
              warnings.push(
                `setup command "${settings.setup_command}" ${setupRun.status} (worktree kept)`,
              );
            }
          } else {
            setupRun = {
              command_id: settings.setup_command,
              run_id: null,
              status: "failed",
              exit_code: null,
              error: ran.error.message,
            };
            setupRuns.set(id, setupRun);
            warnings.push(
              `setup command "${settings.setup_command}" could not start: ${ran.error.message}`,
            );
          }
        }
      }

      const status = await readWorktreeGitStatus({
        worktreeId: id,
        worktreePath: readyRecord.path,
        repoRoot,
        clock: deps.clock,
        git,
      });
      deps.watcher?.()?.setCached(status);
      deps.watcher?.()?.sync();
      deps.onChanged(input.project, id);

      return ok({
        record: readyRecord,
        status,
        warnings,
        copied_files: copiedFiles,
        setup: setupRun,
      });
    },

    // spec 3.2.1: 외부 linked worktree를 adopted로 등록.
    async adopt(input: {
      project: Id<"prj">;
      path: string;
      label?: string;
    }): Promise<Result<{ record: WorktreeRecord; status: WorktreeGitStatus }>> {
      const folders = deps.projectFolders(input.project);
      if (!folders.ok) return folders;
      const inspectedTarget = await inspectGitRepo(input.path, git);
      if (!inspectedTarget.ok) return inspectedTarget;
      const targetPath = inspectedTarget.value.repo_root;
      const targetCommon = inspectedTarget.value.git_common_dir;

      // project 등록 폴더 중 같은 git_common_dir을 가진 저장소를 찾는다.
      let parentRepoRoot: string | null = null;
      for (const folder of folders.value) {
        const repo = await inspectGitRepo(folder, git);
        if (repo.ok && repo.value.git_common_dir === targetCommon) {
          parentRepoRoot = repo.value.repo_root;
          break;
        }
      }
      if (parentRepoRoot === null) {
        return err({
          code: "invalid_input",
          message:
            "path is not a linked worktree of any git repository in this project",
          details: { reason: "unrelated_repository" },
        });
      }
      if (targetPath === parentRepoRoot) {
        return err({
          code: "invalid_input",
          message:
            "cannot adopt the main checkout; specify a linked worktree path",
          details: { reason: "main_checkout" },
        });
      }

      const listed = await listGitWorktrees(parentRepoRoot, targetCommon, git);
      if (!listed.ok) return listed;
      const matched = listed.value.find((wt) => wt.path === targetPath);
      if (matched === undefined) {
        return err({
          code: "invalid_input",
          message: "path is not registered in git worktree list",
          details: { reason: "not_a_worktree" },
        });
      }

      const existing = deps.loadProjectWorktrees(input.project);
      if (!existing.ok) return existing;
      if (
        existing.value.some(
          (one) =>
            one.status !== "removed" && safeRealpath(one.path) === targetPath,
        )
      ) {
        return err({
          code: "conflict",
          message: "this worktree is already registered in this project",
          details: { reason: "already_registered" },
        });
      }

      const id = deps.ids.newId("wkt") as Id<"wkt">;
      const now = deps.clock.now();
      const label = (
        input.label?.trim() ||
        matched.branch ||
        targetPath.split(/[/\\]/).pop() ||
        "worktree"
      ).slice(0, 80);

      const record: WorktreeRecord = {
        id,
        project_id: input.project,
        repo_root: parentRepoRoot,
        git_common_dir: targetCommon,
        path: targetPath,
        git_admin_name: matched.git_admin_name,
        label,
        branch: matched.branch,
        base_ref: null,
        base_commit: matched.head_sha,
        provenance: "adopted",
        status: "ready",
        created_at: now,
        updated_at: now,
      };
      const saved = await deps.upsert(input.project, {
        ...record,
        created_branch: false,
        managed_root: null,
      });
      if (!saved.ok) return saved;

      const status = await readWorktreeGitStatus({
        worktreeId: id,
        worktreePath: targetPath,
        repoRoot: parentRepoRoot,
        clock: deps.clock,
        git,
      });
      deps.watcher?.()?.setCached(status);
      deps.watcher?.()?.sync();
      deps.onChanged(input.project, id);
      return ok({ record, status });
    },

    // label 변경 및 선택적 `git branch -m`(경로 불변).
    async rename(input: {
      worktree: Id<"wkt">;
      label?: string;
      branch?: string;
      renameBranch?: boolean;
    }): Promise<Result<{ record: WorktreeRecord; status: WorktreeGitStatus }>> {
      const row = deps.loadWorktreeById(input.worktree);
      if (row === null || row.status === "removed") {
        return err({ code: "not_found", message: "worktree not found" });
      }
      let nextBranch = row.branch;
      const shouldRenameBranch =
        input.branch !== undefined && input.renameBranch !== false;

      if (shouldRenameBranch) {
        if (row.status !== "ready") {
          return err({
            code: "conflict",
            message: `cannot rename branch while worktree is ${row.status}`,
          });
        }
        const safe = assertSafeRefName(input.branch!, "branch");
        if (!safe.ok) return safe;
        const renamed = await mutex.run(row.git_common_dir, async () => {
          const check = await git(row.path, [
            "check-ref-format",
            "--branch",
            safe.value,
          ]);
          if (check.code !== 0) {
            return err({
              code: "invalid_input" as const,
              message: `invalid branch name "${safe.value}"`,
              details: { reason: "invalid_ref" },
            });
          }
          const currentBranchRes = await git(row.path, [
            "symbolic-ref",
            "--short",
            "HEAD",
          ]);
          if (
            currentBranchRes.code !== 0 ||
            currentBranchRes.stdout.trim() === ""
          ) {
            return err({
              code: "conflict" as const,
              message:
                "cannot rename branch while worktree is on detached HEAD",
              details: { reason: "detached_head" },
            });
          }
          const oldBranch = currentBranchRes.stdout.trim();
          if (oldBranch === safe.value) return ok(safe.value);
          const mv = await git(
            row.path,
            ["branch", "-m", "--", oldBranch, safe.value],
            { retryLocks: true },
          );
          if (mv.code !== 0) {
            return err({
              code: /already exists/i.test(mv.stderr)
                ? ("conflict" as const)
                : ("unavailable" as const),
              message: mv.stderr.trim() || "git branch -m failed",
            });
          }
          return ok(safe.value);
        });
        if (!renamed.ok) return renamed;
        nextBranch = renamed.value;
      }

      const nextLabel = (input.label?.trim() || row.label).slice(0, 80);
      const updatedAt = deps.clock.now();
      const patched = await deps.patch(row.project_id as Id<"prj">, {
        id: row.id as Id<"wkt">,
        label: nextLabel,
        branch: nextBranch,
        updated_at: updatedAt,
      });
      if (!patched.ok) return patched;

      const updated: WorktreeRecord = {
        ...toPublicRecord(row),
        label: nextLabel,
        branch: nextBranch,
        updated_at: updatedAt,
      };
      const status = await readWorktreeGitStatus({
        worktreeId: updated.id,
        worktreePath: updated.path,
        repoRoot: updated.repo_root,
        clock: deps.clock,
        git,
      });
      deps.watcher?.()?.setCached(status);
      deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
      return ok({ record: updated, status });
    },

    async removePreflight(
      worktreeId: Id<"wkt">,
    ): Promise<Result<WorktreeRemovePreflight>> {
      const row = deps.loadWorktreeById(worktreeId);
      if (row === null || row.status === "removed") {
        return err({ code: "not_found", message: "worktree not found" });
      }
      return ok(await computePreflight(row));
    },

    // spec 3.5: 3중 소유권 증명 + 가드 표 + teardown + 브랜치 보존.
    async remove(input: {
      worktree: Id<"wkt">;
      force?: boolean;
      stopSessions?: boolean;
      deleteBranch?: boolean;
      forceDeleteBranch?: boolean;
      allowFailedTeardown?: boolean;
    }): Promise<
      Result<{
        removed: boolean;
        untrack_only: boolean;
        branch_deleted: boolean;
        preserved_branch: {
          name: string;
          head_sha: string | null;
          reason: string;
        } | null;
      }>
    > {
      const row = deps.loadWorktreeById(input.worktree);
      if (row === null || row.status === "removed") {
        return err({ code: "not_found", message: "worktree not found" });
      }

      const preflight = await computePreflight(row);

      // 1. 무조건 차단 가드(override 불가).
      if (preflight.hard_blocks.includes("unsafe_path")) {
        return err({
          code: "forbidden",
          message:
            "worktree path failed ownership and safety checks; refusing disk deletion",
          details: { reason: "unsafe_path" },
        });
      }
      if (preflight.hard_blocks.includes("nested_worktree")) {
        return err({
          code: "conflict",
          message:
            "worktree contains nested registered worktrees; remove child worktrees first",
          details: {
            reason: "nested_worktree",
            nested_worktrees: preflight.nested_worktrees,
          },
        });
      }
      if (preflight.hard_blocks.includes("worktree_locked")) {
        return err({
          code: "conflict",
          message: "worktree is locked by git; run `git worktree unlock` first",
          details: { reason: "worktree_locked" },
        });
      }

      // 2. adopted worktree는 디스크와 브랜치를 절대 건드리지 않고 목록에서만 뺀다.
      if (row.provenance === "adopted") {
        if (preflight.requires_stop_sessions) {
          if (input.stopSessions !== true) {
            return err({
              code: "conflict",
              message:
                "active sessions or terminals are using this worktree; pass stop_sessions: true to stop them",
              details: {
                reason: "active_sessions",
                active_sessions: preflight.active_sessions,
                active_terminals: preflight.active_terminals,
              },
            });
          }
          const stopped = await deps.activity.stopSessionsAndTerminals(
            row.id as Id<"wkt">,
          );
          if (!stopped.ok) return stopped;
        }
        const now = deps.clock.now();
        const patched = await deps.patch(row.project_id as Id<"prj">, {
          id: row.id as Id<"wkt">,
          status: "removed",
          updated_at: now,
        });
        if (!patched.ok) return patched;
        setupRuns.delete(row.id);
        deps.watcher?.()?.forget(row.id);
        deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
        return ok({
          removed: true,
          untrack_only: true,
          branch_deleted: false,
          preserved_branch: null,
        });
      }

      // 3. Windows 터미널 CWD 잠금 방어(spec 3.5.5): dirty/submodules를 터미널 종료보다 먼저 검사한다.
      if (preflight.dirty && input.force !== true) {
        return err({
          code: "conflict",
          message:
            "worktree has uncommitted or untracked changes; pass force: true to remove anyway",
          details: {
            reason: "dirty_worktree",
            staged_count: preflight.staged_count,
            unstaged_count: preflight.unstaged_count,
            untracked_count: preflight.untracked_count,
            conflicted_count: preflight.conflicted_count,
          },
        });
      }
      if (preflight.has_submodules && input.force !== true) {
        return err({
          code: "conflict",
          message:
            "worktree contains submodules; pass force: true to remove anyway",
          details: { reason: "has_submodules" },
        });
      }

      // 4. 도는 세션·터미널 검사 및 종료.
      if (preflight.requires_stop_sessions) {
        if (input.stopSessions !== true) {
          return err({
            code: "conflict",
            message:
              "active sessions or terminals are using this worktree; pass stop_sessions: true to stop them",
            details: {
              reason: "active_sessions",
              active_sessions: preflight.active_sessions,
              active_terminals: preflight.active_terminals,
            },
          });
        }
      }

      // 5. teardown 훅: 지우기 직전 60초 타임아웃 아래 동기 실행. 실패 시 allow_failed_teardown만 통과.
      if (
        preflight.teardown_command !== null &&
        deps.hooks !== undefined &&
        (await pathExists(row.path))
      ) {
        const torn = await deps.hooks.runTeardown({
          project: row.project_id as Id<"prj">,
          worktree: toPublicRecord(row),
          commandId: preflight.teardown_command,
          timeoutMs: TEARDOWN_TIMEOUT_MS,
        });
        const failed = !torn.ok || !torn.value.ok;
        if (failed && input.allowFailedTeardown !== true) {
          return err({
            code: "conflict",
            message: torn.ok
              ? `teardown command "${preflight.teardown_command}" failed (exit ${torn.value.exit_code ?? "timeout"}); pass allow_failed_teardown: true to continue`
              : `teardown command "${preflight.teardown_command}" failed: ${torn.error.message}`,
            details: {
              reason: "teardown_failed",
              command_id: preflight.teardown_command,
              ...(torn.ok && torn.value.tail !== undefined
                ? { tail: torn.value.tail }
                : {}),
            },
          });
        }
      }

      // 6. ledger에 removing 저널 기록 (신규 세션 부착 즉시 차단).
      const removingAt = deps.clock.now();
      const markRemoving = await deps.patch(row.project_id as Id<"prj">, {
        id: row.id as Id<"wkt">,
        status: "removing",
        updated_at: removingAt,
      });
      if (!markRemoving.ok) return markRemoving;
      deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);

      // 도는 세션·터미널 종료(Windows CWD 핸들 해제 포함).
      if (preflight.requires_stop_sessions) {
        const stopped = await deps.activity.stopSessionsAndTerminals(
          row.id as Id<"wkt">,
        );
        if (!stopped.ok) {
          await deps.patch(row.project_id as Id<"prj">, {
            id: row.id as Id<"wkt">,
            status: (await pathExists(row.path)) ? "ready" : "missing",
            updated_at: deps.clock.now(),
          });
          deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
          return stopped;
        }
      }

      // 7. 디스크 제거 + 브랜치 보존/삭제.
      const branchName = preflight.branch;
      let expectedHeadSha: string | null = null;
      if (branchName !== null && input.deleteBranch === true) {
        const rev = await git(row.repo_root, [
          "rev-parse",
          "--verify",
          `refs/heads/${branchName}`,
        ]);
        expectedHeadSha = rev.code === 0 ? rev.stdout.trim() || null : null;
      }

      const diskDone = await mutex.run(row.git_common_dir, async () => {
        const removed = await removeCheckoutDisk(row, {
          force: input.force === true,
          hasSubmodules: preflight.has_submodules,
        });
        if (!removed.ok) return removed;

        // 브랜치 보존 정책(spec 3.5.4): 기본 delete_branch: false.
        let branchDeleted = false;
        let preservedBranch: {
          name: string;
          head_sha: string | null;
          reason: string;
        } | null = null;

        if (input.deleteBranch === true && branchName !== null) {
          if (!row.created_branch && input.forceDeleteBranch !== true) {
            preservedBranch = {
              name: branchName,
              head_sha: expectedHeadSha,
              reason: "existing_branch",
            };
          } else {
            const del = await git(
              row.repo_root,
              ["branch", "-d", "--", branchName],
              { retryLocks: true },
            );
            if (del.code === 0) {
              branchDeleted = true;
            } else if (
              input.forceDeleteBranch === true &&
              expectedHeadSha !== null
            ) {
              // CAS 삭제: 예상 head SHA가 같을 때만 ref 제거.
              const cas = await git(
                row.repo_root,
                [
                  "update-ref",
                  "-d",
                  `refs/heads/${branchName}`,
                  expectedHeadSha,
                ],
                { retryLocks: true },
              );
              if (cas.code === 0) {
                branchDeleted = true;
              } else {
                preservedBranch = {
                  name: branchName,
                  head_sha: expectedHeadSha,
                  reason: "cas_mismatch",
                };
              }
            } else {
              preservedBranch = {
                name: branchName,
                head_sha: expectedHeadSha,
                reason: "unmerged",
              };
            }
          }
        }

        return ok({ branchDeleted, preservedBranch });
      });

      if (!diskDone.ok) {
        const stillThere = await pathExists(row.path);
        await deps.patch(row.project_id as Id<"prj">, {
          id: row.id as Id<"wkt">,
          status: stillThere ? "ready" : "missing",
          updated_at: deps.clock.now(),
        });
        deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
        return diskDone;
      }

      const doneAt = deps.clock.now();
      await deps.patch(row.project_id as Id<"prj">, {
        id: row.id as Id<"wkt">,
        status: "removed",
        updated_at: doneAt,
      });
      setupRuns.delete(row.id);
      deps.watcher?.()?.forget(row.id);
      deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);

      return ok({
        removed: true,
        untrack_only: false,
        branch_deleted: diskDone.value.branchDeleted,
        preserved_branch: diskDone.value.preservedBranch,
      });
    },

    // spec 3.5.5: core 기동 시 creating·removing 저널 레코드 복구.
    async recoverOnStartup(): Promise<void> {
      const pending = deps.loadWorktreesByStatuses(["creating", "removing"]);
      for (const row of pending) {
        try {
          if (row.status === "creating") {
            const exists = await pathExists(row.path);
            if (exists) {
              const inspected = await inspectGitRepo(row.path, git);
              const adminName = await readGitdirAdminName(
                row.path,
                row.git_common_dir,
              );
              if (
                inspected.ok &&
                inspected.value.git_common_dir === row.git_common_dir &&
                adminName !== null
              ) {
                await deps.patch(row.project_id as Id<"prj">, {
                  id: row.id as Id<"wkt">,
                  path: inspected.value.repo_root,
                  git_admin_name: adminName,
                  branch: inspected.value.branch,
                  status: "ready",
                  updated_at: deps.clock.now(),
                });
                deps.onChanged(
                  row.project_id as Id<"prj">,
                  row.id as Id<"wkt">,
                );
                continue;
              }
            }
            // 불완전한 creating 레코드 롤백 정리.
            await mutex.run(row.git_common_dir, async () => {
              const owned = await verifyManagedOwnership(row);
              if (owned.ok && (await pathExists(row.path))) {
                await removeCheckoutDisk(row, {
                  force: true,
                  hasSubmodules: false,
                });
              } else if (
                row.provenance === "managed" &&
                (await pathExists(row.path))
              ) {
                // git worktree add가 `.git` 포인터를 쓰기 전에 끊긴 부분 디렉터리는
                // 관리 루트 내부이고 repo_root 밖임이 확인되면 안전하게 지운다.
                const realPath = safeRealpath(row.path);
                if (
                  managedRootsForRow(row).some((r) =>
                    isStrictlyInside(realPath, r, platform),
                  ) &&
                  !isSameOrInside(
                    realPath,
                    safeRealpath(row.repo_root),
                    platform,
                  )
                ) {
                  await rm(realPath, { recursive: true, force: true }).catch(
                    () => undefined,
                  );
                  await pruneWorktreesSafely(
                    row.repo_root,
                    row.git_common_dir,
                    git,
                    platform,
                  );
                }
              }
              if (
                row.created_branch &&
                row.branch !== null &&
                row.base_commit !== null
              ) {
                const tip = await git(row.repo_root, [
                  "rev-parse",
                  "--verify",
                  `refs/heads/${row.branch}`,
                ]);
                if (tip.code === 0 && tip.stdout.trim() === row.base_commit) {
                  await git(row.repo_root, ["branch", "-D", "--", row.branch], {
                    retryLocks: true,
                  });
                }
              }
            });
            await deps.deleteRow(
              row.project_id as Id<"prj">,
              row.id as Id<"wkt">,
            );
            deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
          } else if (row.status === "removing") {
            if (row.provenance === "adopted") {
              await deps.patch(row.project_id as Id<"prj">, {
                id: row.id as Id<"wkt">,
                status: "removed",
                updated_at: deps.clock.now(),
              });
              deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
              continue;
            }
            const owned = await verifyManagedOwnership(row);
            if (!owned.ok) {
              await deps.patch(row.project_id as Id<"prj">, {
                id: row.id as Id<"wkt">,
                status: (await pathExists(row.path)) ? "ready" : "missing",
                updated_at: deps.clock.now(),
              });
              continue;
            }
            const cleaned = await mutex.run(row.git_common_dir, async () => {
              return await removeCheckoutDisk(row, {
                force: true,
                hasSubmodules: await hasSubmodules(row.path, git),
              });
            });
            await deps.patch(row.project_id as Id<"prj">, {
              id: row.id as Id<"wkt">,
              status: cleaned.ok
                ? "removed"
                : (await pathExists(row.path))
                  ? "ready"
                  : "missing",
              updated_at: deps.clock.now(),
            });
            deps.onChanged(row.project_id as Id<"prj">, row.id as Id<"wkt">);
          }
        } catch (cause) {
          deps.logger?.warn({
            component: "worktrees",
            event: "startup_recovery_failed",
            message: `${row.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      deps.watcher?.()?.sync();
    },
  };
}
