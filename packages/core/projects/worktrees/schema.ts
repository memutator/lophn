import type { SchemaStep } from "../../../protocol/server/mod.ts";

// git worktree 레코드(`project_worktrees`), project별 환경 설정(`project_worktree_settings`),
// 그리고 session의 선택 불변 `worktree_id` 열이다.
// 이미 낸 step은 고치지 않고, 새 step은 assembly.ts 맨 뒤 wiring의 schemaStepsAfterTeams와 schema-steps.lock.json 끝에 붙인다.
export const WORKTREES_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "projects.worktrees",
    sql: `
CREATE TABLE project_worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_root TEXT NOT NULL,
  git_common_dir TEXT NOT NULL,
  path TEXT NOT NULL,
  git_admin_name TEXT,
  label TEXT NOT NULL,
  branch TEXT,
  base_ref TEXT,
  base_commit TEXT,
  provenance TEXT NOT NULL CHECK (provenance IN ('managed', 'adopted')),
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'missing', 'removing', 'removed')),
  idempotency_key TEXT,
  created_branch INTEGER NOT NULL DEFAULT 0 CHECK (created_branch IN (0, 1)),
  managed_root TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX project_worktrees_project_status ON project_worktrees (project_id, status);
CREATE UNIQUE INDEX project_worktrees_idem ON project_worktrees (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE project_worktree_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  copy_patterns_json TEXT NOT NULL DEFAULT '[]',
  setup_command TEXT,
  teardown_command TEXT,
  run_setup INTEGER NOT NULL DEFAULT 1 CHECK (run_setup IN (0, 1))
);
ALTER TABLE sessions ADD COLUMN worktree_id TEXT;
CREATE TRIGGER sessions_worktree_id_immutable
BEFORE UPDATE OF worktree_id ON sessions
BEGIN
  SELECT RAISE(ABORT, 'session worktree_id is immutable');
END;
`.trim(),
  },
];
