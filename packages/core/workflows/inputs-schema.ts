import type { SchemaStep } from "../../protocol/server/mod.ts";

// workflow_instances에 선언적 시작 입력 값(inputs_json) 열을 더한다. 기존 행은 NULL로 남는다.
// 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams 끝에서 잇는다.
export const WORKFLOW_INPUTS_SCHEMA_STEP: SchemaStep = {
  id: "workflows.instances-inputs",
  sql: "ALTER TABLE workflow_instances ADD COLUMN inputs_json TEXT CHECK (inputs_json IS NULL OR json_valid(inputs_json));",
};

export const workflowInputsSchemaSteps: readonly SchemaStep[] = [
  WORKFLOW_INPUTS_SCHEMA_STEP,
];
