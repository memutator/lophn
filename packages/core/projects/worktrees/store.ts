import process from "node:process";
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  DEFAULT_WORKTREE_SETTINGS,
  type WorktreeRecord,
  type WorktreeSettings,
  worktreeRecordSchema,
  worktreeSettingsSchema,
  worktreesStore,
} from "../../../protocol/projects/worktrees.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import { projectExists } from "../lookups.ts";
import {
  isStrictlyInside,
  safeRealpath,
  validateWorktreesRoot,
} from "./paths.ts";

export const WORKTREES_PRINCIPAL = "machine:worktrees";

export const WORKTREES_CONTEXT: AuthenticatedContext = {
  principal: WORKTREES_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [worktreesStore.name],
    targets: {},
  },
  conditions: {},
  credential_ref: WORKTREES_PRINCIPAL,
};

export type StoredWorktreeRow = WorktreeRecord & {
  idempotency_key: string | null;
  created_branch: boolean;
  managed_root: string | null;
};

type RawWorktreeRow = {
  id: string;
  project_id: string;
  repo_root: string;
  git_common_dir: string;
  path: string;
  git_admin_name: string | null;
  label: string;
  branch: string | null;
  base_ref: string | null;
  base_commit: string | null;
  provenance: string;
  status: string;
  idempotency_key: string | null;
  created_branch: number | bigint;
  managed_root: string | null;
  created_at: string;
  updated_at: string;
};

type RawSettingsRow = {
  copy_patterns_json: string;
  setup_command: string | null;
  teardown_command: string | null;
  run_setup: number | bigint;
};

const WORKTREE_COLUMNS = `id, project_id, repo_root, git_common_dir, path, git_admin_name,
  label, branch, base_ref, base_commit, provenance, status, idempotency_key, created_branch, managed_root, created_at, updated_at`;

function rowToStored(row: RawWorktreeRow): StoredWorktreeRow | null {
  const parsed = worktreeRecordSchema.safeParse({
    id: row.id,
    project_id: row.project_id,
    repo_root: row.repo_root,
    git_common_dir: row.git_common_dir,
    path: row.path,
    git_admin_name: row.git_admin_name,
    label: row.label,
    branch: row.branch,
    base_ref: row.base_ref,
    base_commit: row.base_commit,
    provenance: row.provenance,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    idempotency_key: row.idempotency_key,
    created_branch: Number(row.created_branch) === 1,
    managed_root: row.managed_root,
  };
}

export function toPublicRecord(row: StoredWorktreeRow): WorktreeRecord {
  const {
    idempotency_key: _idem,
    created_branch: _cb,
    managed_root: _mr,
    ...record
  } = row;
  return record;
}

export function loadProjectWorktrees(
  sql: Pick<Sql, "get" | "all">,
  projectId: string,
  options?: { includeRemoved?: boolean },
): Result<StoredWorktreeRow[]> {
  if (!projectExists(sql, projectId)) {
    return err({ code: "not_found", message: "project not found" });
  }
  const where = options?.includeRemoved
    ? "project_id = ?"
    : "project_id = ? AND status != 'removed'";
  const rows = sql.all(
    `SELECT ${WORKTREE_COLUMNS} FROM project_worktrees WHERE ${where} ORDER BY created_at ASC, id ASC`,
    [projectId],
  ) as unknown as RawWorktreeRow[];
  const out: StoredWorktreeRow[] = [];
  for (const row of rows) {
    const parsed = rowToStored(row);
    if (parsed !== null) out.push(parsed);
  }
  return ok(out);
}

export function loadWorktreeById(
  sql: Pick<Sql, "get">,
  worktreeId: string,
): StoredWorktreeRow | null {
  const row = sql.get(
    `SELECT ${WORKTREE_COLUMNS} FROM project_worktrees WHERE id = ?`,
    [worktreeId],
  ) as unknown as RawWorktreeRow | undefined;
  if (row === undefined) return null;
  return rowToStored(row);
}

export function loadWorktreeByIdempotencyKey(
  sql: Pick<Sql, "get">,
  projectId: string,
  idempotencyKey: string,
): StoredWorktreeRow | null {
  const row = sql.get(
    `SELECT ${WORKTREE_COLUMNS} FROM project_worktrees WHERE project_id = ? AND idempotency_key = ?`,
    [projectId, idempotencyKey],
  ) as unknown as RawWorktreeRow | undefined;
  if (row === undefined) return null;
  return rowToStored(row);
}

export function loadWorktreesByStatuses(
  sql: Pick<Sql, "all">,
  statuses: readonly string[],
): StoredWorktreeRow[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = sql.all(
    `SELECT ${WORKTREE_COLUMNS} FROM project_worktrees WHERE status IN (${placeholders}) ORDER BY created_at ASC`,
    [...statuses],
  ) as unknown as RawWorktreeRow[];
  const out: StoredWorktreeRow[] = [];
  for (const row of rows) {
    const parsed = rowToStored(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

export function loadWorktreeSettings(
  sql: Pick<Sql, "get" | "all">,
  projectId: string,
): Result<WorktreeSettings> {
  if (!projectExists(sql, projectId)) {
    return err({ code: "not_found", message: "project not found" });
  }
  const row = sql.get(
    `SELECT copy_patterns_json, setup_command, teardown_command, run_setup
     FROM project_worktree_settings WHERE project_id = ?`,
    [projectId],
  ) as unknown as RawSettingsRow | undefined;
  if (row === undefined) {
    return ok({ ...DEFAULT_WORKTREE_SETTINGS, copy_patterns: [] });
  }
  let patterns: unknown = [];
  try {
    patterns = JSON.parse(row.copy_patterns_json);
  } catch {
    patterns = [];
  }
  const parsed = worktreeSettingsSchema.safeParse({
    copy_patterns: patterns,
    setup_command: row.setup_command,
    teardown_command: row.teardown_command,
    run_setup: Number(row.run_setup) === 1,
  });
  return ok(
    parsed.success
      ? parsed.data
      : { ...DEFAULT_WORKTREE_SETTINGS, copy_patterns: [] },
  );
}

// `folderOfCwd`와 터미널 열기가 관리 루트 안의 ready worktree를 project의 유효 폴더로 인정할 때 쓴다.
export function loadManagedReadyWorktrees(
  sql: Pick<Sql, "all">,
  projectId: string,
  managedRoot: string,
  options?: {
    homeDir?: string | null;
    repoRoots?: readonly string[];
    platform?: NodeJS.Platform;
  },
): StoredWorktreeRow[] {
  const rows = sql.all(
    `SELECT ${WORKTREE_COLUMNS} FROM project_worktrees WHERE project_id = ? AND status = 'ready'`,
    [projectId],
  ) as unknown as RawWorktreeRow[];
  const platform = options?.platform ?? process.platform;
  const out: StoredWorktreeRow[] = [];
  for (const row of rows) {
    const parsed = rowToStored(row);
    if (parsed === null || parsed.provenance !== "managed") continue;
    const repoRoots = [
      ...new Set([parsed.repo_root, ...(options?.repoRoots ?? [])]),
    ];
    const candidates: string[] = [];
    if (managedRoot.trim() !== "") candidates.push(managedRoot);
    if (parsed.managed_root !== null) candidates.push(parsed.managed_root);
    const roots: string[] = [];
    for (const candidate of candidates) {
      const checked = validateWorktreesRoot(candidate, {
        homeDir: options?.homeDir ?? null,
        repoRoots,
        platform,
      });
      if (checked.ok) {
        roots.push(checked.value);
      }
    }
    if (roots.length === 0) continue;
    const realPath = safeRealpath(parsed.path);
    if (roots.some((root) => isStrictlyInside(realPath, root, platform))) {
      out.push(parsed);
    }
  }
  return out;
}

function upsertWorktree(
  tx: Tx,
  record: WorktreeRecord & {
    idempotency_key?: string | null;
    created_branch?: boolean;
    managed_root?: string | null;
  },
): void {
  tx.sql.run(
    `INSERT INTO project_worktrees (
      id, project_id, repo_root, git_common_dir, path, git_admin_name,
      label, branch, base_ref, base_commit, provenance, status,
      idempotency_key, created_branch, managed_root, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repo_root = excluded.repo_root,
      git_common_dir = excluded.git_common_dir,
      path = excluded.path,
      git_admin_name = excluded.git_admin_name,
      label = excluded.label,
      branch = excluded.branch,
      base_ref = excluded.base_ref,
      base_commit = excluded.base_commit,
      provenance = excluded.provenance,
      status = excluded.status,
      managed_root = COALESCE(excluded.managed_root, project_worktrees.managed_root),
      updated_at = excluded.updated_at`,
    [
      record.id,
      record.project_id,
      record.repo_root,
      record.git_common_dir,
      record.path,
      record.git_admin_name,
      record.label,
      record.branch,
      record.base_ref,
      record.base_commit,
      record.provenance,
      record.status,
      record.idempotency_key ?? null,
      record.created_branch === true ? 1 : 0,
      record.managed_root ?? null,
      record.created_at,
      record.updated_at,
    ],
  );
}

function patchWorktree(
  tx: Tx,
  patch: {
    id: string;
    path?: string;
    git_admin_name?: string | null;
    label?: string;
    branch?: string | null;
    status?: string;
    updated_at: string;
  },
): boolean {
  const existing = loadWorktreeById(tx.sql, patch.id);
  if (existing === null) return false;
  tx.sql.run(
    `UPDATE project_worktrees
     SET path = ?, git_admin_name = ?, label = ?, branch = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.path ?? existing.path,
      patch.git_admin_name === undefined
        ? existing.git_admin_name
        : patch.git_admin_name,
      patch.label ?? existing.label,
      patch.branch === undefined ? existing.branch : patch.branch,
      patch.status ?? existing.status,
      patch.updated_at,
      patch.id,
    ],
  );
  return true;
}

function writeSettings(
  tx: Tx,
  projectId: string,
  settings: WorktreeSettings,
): void {
  tx.sql.run(
    `INSERT INTO project_worktree_settings (project_id, copy_patterns_json, setup_command, teardown_command, run_setup)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       copy_patterns_json = excluded.copy_patterns_json,
       setup_command = excluded.setup_command,
       teardown_command = excluded.teardown_command,
       run_setup = excluded.run_setup`,
    [
      projectId,
      JSON.stringify(settings.copy_patterns),
      settings.setup_command,
      settings.teardown_command,
      settings.run_setup ? 1 : 0,
    ],
  );
}

export const worktreesStoreCommand: CommandDefinition<typeof worktreesStore> = {
  route: worktreesStore,
  handle(tx, ctx, input) {
    const actor = parseActor(ctx.actor);
    if (actor?.kind !== "machine" || ctx.principal !== WORKTREES_PRINCIPAL) {
      return err({
        code: "forbidden",
        message: `${WORKTREES_PRINCIPAL} only`,
      });
    }
    if (!projectExists(tx.sql, input.project)) {
      return err({ code: "not_found", message: "project not found" });
    }
    if (input.upsert !== undefined) {
      upsertWorktree(tx, input.upsert);
    }
    if (input.patch !== undefined) {
      const okPatch = patchWorktree(tx, input.patch);
      if (!okPatch) {
        return err({ code: "not_found", message: "worktree not found" });
      }
    }
    if (input.delete_id !== undefined) {
      tx.sql.run(
        "DELETE FROM project_worktrees WHERE id = ? AND project_id = ?",
        [input.delete_id, input.project],
      );
    }
    if (input.settings !== undefined) {
      writeSettings(tx, input.project, input.settings);
    }
    return ok({ saved: true as const });
  },
};
