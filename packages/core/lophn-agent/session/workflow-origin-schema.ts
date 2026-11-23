import type { SchemaStep } from "../../../protocol/server/mod.ts";

// session이 속한 workflow instance와 step. 낸 step의 SQL은 고치지 않고 새 step으로 더한다(WIRINGS 맨 뒤 wiring(remote)의
// schemaStepsAfterTeams 끝에서 잇는다).
// - workflow_origin: JSON `{ project, workflow, instance, step }`. 다른 열과 달리 열린 뒤에도 바뀐다(workflow가 step을 넘길 때마다
//   갱신한다). 그래서 immutability trigger가 없다.
// - sessions는 STRICT라도 ADD COLUMN은 되어 표를 다시 짜지 않는다.
export const workflowOriginSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.sessions.workflow-origin",
    sql: `
alter table sessions add column workflow_origin text check (workflow_origin is null or json_valid(workflow_origin));
create index sessions_workflow_instance on sessions ((workflow_origin ->> '$.instance')) where workflow_origin is not null;`,
  },
];
