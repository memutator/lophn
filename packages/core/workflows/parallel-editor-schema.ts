import type { SchemaStep } from "../../protocol/server/mod.ts";

// workflow_instances에 병렬 활성 step 목록(active_steps_json)과
// instance 1:1 연결 편집용 lophn session(editor_session) 열을 더한다.
export const WORKFLOW_PARALLEL_EDITOR_SCHEMA_STEP: SchemaStep = {
  id: "workflows.instances-parallel-editor",
  sql: `alter table workflow_instances add column active_steps_json text check (active_steps_json is null or json_valid(active_steps_json));
alter table workflow_instances add column editor_session text;`,
};
