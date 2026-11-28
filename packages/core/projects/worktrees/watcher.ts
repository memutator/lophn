// spec 3.4.1: 좁은 상태 감시자.
// 홈 디렉터리(`~`)나 그 상위 디렉터리·파일시스템 루트에는 OS 감시자를 절대 걸지 않는다.
// 워킹 트리 전체 재귀 감시 대신 `.git/HEAD`, `.git/packed-refs`, `.git/worktrees/<admin>/HEAD`만 좁게 보고
// 디바운스(1.2초)로 활성 worktree의 상태를 다시 읽는다. 삭제/ENOENT 감지 시 즉시 감시자를 해제한다.
import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import type { Clock, IdSource, Logger, Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  WorktreeGitStatus,
  WorktreeStatus,
} from "../../../protocol/projects/worktrees.ts";
import {
  type GitRunner,
  listGitWorktrees,
  readWorktreeGitStatus,
  runGit,
} from "./git.ts";
import { isFilesystemRoot, isSameOrInside, safeRealpath } from "./paths.ts";
import type { StoredWorktreeRow } from "./store.ts";

const DEBOUNCE_MS = 1200;

export type WorktreeWatcherDeps = {
  clock: Clock;
  homeDir: string | null;
  listActive(): StoredWorktreeRow[];
  patchRecord(
    projectId: Id<"prj">,
    patch: {
      id: Id<"wkt">;
      path?: string;
      git_admin_name?: string | null;
      branch?: string | null;
      status?: WorktreeStatus;
      updated_at: string;
    },
  ): Promise<Result<void>>;
  onStatusChanged(projectId: Id<"prj">, status: WorktreeGitStatus): void;
  onWorktreesChanged(projectId: Id<"prj">, worktreeId?: Id<"wkt">): void;
  git?: GitRunner;
  logger?: Logger;
  ids?: IdSource;
};

function canSafelyWatch(target: string, homeDir: string | null): boolean {
  const real = safeRealpath(target);
  if (isFilesystemRoot(real)) return false;
  if (homeDir !== null) {
    const home = safeRealpath(homeDir);
    // 홈 디렉터리 자체 또는 홈의 상위 디렉터리는 감시 금지(macOS TCC 팝업 방지).
    if (isSameOrInside(home, real)) return false;
  }
  return true;
}

function statusSignature(status: WorktreeGitStatus): string {
  const { updated_at: _at, ...rest } = status;
  return JSON.stringify(rest);
}

export type WorktreeWatcher = ReturnType<typeof createWorktreeWatcher>;

export function createWorktreeWatcher(deps: WorktreeWatcherDeps) {
  const git = deps.git ?? runGit;
  const watchers = new Map<string, FSWatcher>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cachedStatus = new Map<string, WorktreeGitStatus>();
  const cachedSignatures = new Map<string, string>();
  let closed = false;

  function dropWatcher(target: string): void {
    const existing = watchers.get(target);
    if (existing !== undefined) {
      watchers.delete(target);
      try {
        existing.close();
      } catch {
        // ignore close errors
      }
    }
  }

  function scheduleRefresh(gitCommonDir: string): void {
    if (closed) return;
    const prev = timers.get(gitCommonDir);
    if (prev !== undefined) clearTimeout(prev);
    const timer = setTimeout(() => {
      timers.delete(gitCommonDir);
      void refreshForCommonDir(gitCommonDir);
    }, DEBOUNCE_MS);
    timer.unref?.();
    timers.set(gitCommonDir, timer);
  }

  function attachNarrowWatch(filePath: string, gitCommonDir: string): void {
    if (closed || watchers.has(filePath)) return;
    if (!canSafelyWatch(filePath, deps.homeDir)) return;
    try {
      const w = watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === "rename") {
          // 파일이 삭제·교체됐을 수 있으므로 감시자를 즉시 닫고 다음 sync에서 다시 건다.
          dropWatcher(filePath);
        }
        scheduleRefresh(gitCommonDir);
      });
      w.on("error", () => {
        dropWatcher(filePath);
      });
      watchers.set(filePath, w);
    } catch {
      // ENOENT 등: 존재하지 않으면 걸지 않는다.
    }
  }

  async function refreshOne(
    row: StoredWorktreeRow,
    gitListByAdmin?: Map<string, { path: string; branch: string | null }>,
  ): Promise<WorktreeGitStatus> {
    let effectivePath = row.path;
    let relinked = false;
    let nextStatus = row.status;

    const status = await readWorktreeGitStatus({
      worktreeId: row.id,
      worktreePath: row.path,
      repoRoot: row.repo_root,
      clock: deps.clock,
      git,
    });

    // spec 3.1.3: 외부 `git worktree move` 시 git_admin_name으로 relink한다.
    if (
      status.presence === "missing" &&
      row.git_admin_name !== null &&
      gitListByAdmin !== undefined
    ) {
      const moved = gitListByAdmin.get(row.git_admin_name);
      if (moved !== undefined && moved.path !== row.path) {
        effectivePath = moved.path;
        relinked = true;
      }
    }

    const finalStatus = relinked
      ? await readWorktreeGitStatus({
          worktreeId: row.id,
          worktreePath: effectivePath,
          repoRoot: row.repo_root,
          clock: deps.clock,
          git,
        })
      : status;

    // spec 3.5.5: unmounted면 missing으로 전이하지 않는다.
    if (finalStatus.presence === "present" && row.status === "missing") {
      nextStatus = "ready";
    } else if (finalStatus.presence === "missing" && row.status === "ready") {
      nextStatus = "missing";
    }

    const branchChanged =
      finalStatus.presence === "present" && finalStatus.branch !== row.branch;
    const statusTransition = nextStatus !== row.status;

    if (relinked || branchChanged || statusTransition) {
      const patched = await deps.patchRecord(row.project_id as Id<"prj">, {
        id: row.id as Id<"wkt">,
        ...(relinked ? { path: effectivePath } : {}),
        ...(branchChanged ? { branch: finalStatus.branch } : {}),
        ...(statusTransition ? { status: nextStatus } : {}),
        updated_at: deps.clock.now(),
      });
      if (patched.ok) {
        deps.onWorktreesChanged(
          row.project_id as Id<"prj">,
          row.id as Id<"wkt">,
        );
      }
    }

    cachedStatus.set(row.id, finalStatus);
    const sig = statusSignature(finalStatus);
    if (cachedSignatures.get(row.id) !== sig) {
      cachedSignatures.set(row.id, sig);
      deps.onStatusChanged(row.project_id as Id<"prj">, finalStatus);
    }
    return finalStatus;
  }

  async function refreshForCommonDir(gitCommonDir: string): Promise<void> {
    if (closed) return;
    const rows = deps
      .listActive()
      .filter(
        (one) =>
          one.git_common_dir === gitCommonDir &&
          (one.status === "ready" || one.status === "missing"),
      );
    if (rows.length === 0) return;

    const repoRoot = rows[0]!.repo_root;
    const listed = await listGitWorktrees(repoRoot, gitCommonDir, git);
    const byAdmin = new Map<string, { path: string; branch: string | null }>();
    if (listed.ok) {
      for (const item of listed.value) {
        if (item.git_admin_name !== null) {
          byAdmin.set(item.git_admin_name, {
            path: item.path,
            branch: item.branch,
          });
        }
      }
    }
    for (const row of rows) {
      if (closed) return;
      await refreshOne(row, byAdmin);
    }
    syncWatches();
  }

  function syncWatches(): void {
    if (closed) return;
    const active = deps
      .listActive()
      .filter((one) => one.status === "ready" || one.status === "missing");
    const desired = new Map<string, string>();
    for (const row of active) {
      desired.set(join(row.git_common_dir, "HEAD"), row.git_common_dir);
      desired.set(join(row.git_common_dir, "packed-refs"), row.git_common_dir);
      if (row.git_admin_name !== null) {
        desired.set(
          join(row.git_common_dir, "worktrees", row.git_admin_name, "HEAD"),
          row.git_common_dir,
        );
      }
    }
    for (const existing of [...watchers.keys()]) {
      if (!desired.has(existing)) dropWatcher(existing);
    }
    for (const [filePath, commonDir] of desired) {
      attachNarrowWatch(filePath, commonDir);
    }
  }

  return {
    sync(): void {
      syncWatches();
    },

    getCached(worktreeId: string): WorktreeGitStatus | null {
      return cachedStatus.get(worktreeId) ?? null;
    },

    setCached(status: WorktreeGitStatus): void {
      cachedStatus.set(status.worktree_id, status);
      cachedSignatures.set(status.worktree_id, statusSignature(status));
    },

    forget(worktreeId: string): void {
      cachedStatus.delete(worktreeId);
      cachedSignatures.delete(worktreeId);
      syncWatches();
    },

    async refreshWorktree(row: StoredWorktreeRow): Promise<WorktreeGitStatus> {
      const listed = await listGitWorktrees(
        row.repo_root,
        row.git_common_dir,
        git,
      );
      const byAdmin = new Map<
        string,
        { path: string; branch: string | null }
      >();
      if (listed.ok) {
        for (const item of listed.value) {
          if (item.git_admin_name !== null) {
            byAdmin.set(item.git_admin_name, {
              path: item.path,
              branch: item.branch,
            });
          }
        }
      }
      const status = await refreshOne(row, byAdmin);
      syncWatches();
      return status;
    },

    stop(): void {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const target of [...watchers.keys()]) dropWatcher(target);
      watchers.clear();
    },
  };
}
