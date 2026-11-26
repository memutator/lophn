import type { SchemaStep } from "../../protocol/server/mod.ts";

// workflow_instances에 일회성 여부(one_off), instance 전용 override 여부(overridden),
// 그리고 flow의 앱 tool 호출 agent(flow_agent) 열을 더한다.
// 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring의 schemaStepsAfterTeams 끝에서 잇는다.
export const WORKFLOW_ONEOFF_OVERRIDE_SCHEMA_STEP: SchemaStep = {
  id: "workflows.instances-oneoff-override",
  sql: `alter table workflow_instances add column one_off integer not null default 0 check (one_off in (0, 1));
alter table workflow_instances add column overridden integer not null default 0 check (overridden in (0, 1));
alter table workflow_instances add column flow_agent text;`,
};
