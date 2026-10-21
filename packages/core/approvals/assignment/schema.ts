import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 할당은 agent마다 한 줄이다. agent는 canonical JSON이고 entries는 AgentAssignment의 entries다.
// 줄이 있으면 한 번 이상 쓴 것이라 revision은 1부터다(줄 없음이 0).
export const ASSIGNMENT_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "agent_assignments",
    sql: `
create table agent_assignments (
  agent text primary key,
  entries text not null,
  revision integer not null check (revision > 0),
  updated_at text not null
);`,
  },
];
