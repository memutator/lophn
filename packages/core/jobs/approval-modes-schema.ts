import type { SchemaStep } from "../../protocol/server/mod.ts";

// workflow_start job이 승인 시점에 고정한 participant별 권한 단계(approved_modes_json) 열을 더한다. 기존 행은 NULL로 남는다.
// 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring의 schemaStepsAfterTeams 끝에서 잇는다.
export const JOBS_APPROVAL_MODES_SCHEMA_STEP: SchemaStep = {
  id: "jobs.approved-modes",
  sql: "alter table jobs add column approved_modes_json text;",
};
