import type { SchemaStep } from "../../protocol/server/mod.ts";

// workflow_instances에 run 단위 session 열기 덮어쓰기(open_mode: 'tab' | 'background' | NULL) 열을 더한다. 기존 행은 NULL로 남는다.
// 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(project-commands)의 schemaStepsAfterTeams 끝에서 잇는다.
export const WORKFLOW_OPEN_MODE_SCHEMA_STEP: SchemaStep = {
  id: "workflows.instances-open-mode",
  sql: "ALTER TABLE workflow_instances ADD COLUMN open_mode TEXT CHECK (open_mode IS NULL OR open_mode IN ('tab', 'background'));",
};
