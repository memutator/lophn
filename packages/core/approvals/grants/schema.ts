import type { SchemaStep } from "../../../protocol/server/mod.ts";

// agent grant는 agent마다 한 줄이다. agent는 canonical JSON이고 entries는 AgentGrant의 entries다.
// 사람이 통째로 바꾸므로 갱신 시각만 둔다.
export const AGENT_GRANT_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "agent_grants",
    sql: `
create table agent_grants (
  agent text primary key,
  entries text not null,
  updated_at text not null
);`,
  },
];
