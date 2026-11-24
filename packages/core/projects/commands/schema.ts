import type { SchemaStep } from "../../../protocol/server/mod.ts";

// project command 정의와 project별 agent 설정 저장 표다.
// 이미 낸 step은 고치지 않고, 새 step은 assembly.ts 맨 뒤 wiring의 schemaStepsAfterTeams와 schema-steps.lock.json 끝에 붙인다.
export const PROJECT_COMMANDS_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "projects.commands",
    sql: `
CREATE TABLE project_commands (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  kind TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  folder_ref TEXT,
  cwd TEXT,
  env_json TEXT,
  preview_url TEXT,
  auto_open_preview INTEGER NOT NULL DEFAULT 0,
  timeout_ms INTEGER,
  agents_json TEXT,
  ask_before_run INTEGER,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX project_commands_project_pos ON project_commands (project_id, position);
CREATE TABLE project_command_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  agents_json TEXT NOT NULL,
  ask_before_run INTEGER NOT NULL DEFAULT 0,
  approve_agent_writes INTEGER NOT NULL DEFAULT 1
);
`.trim(),
  },
];
