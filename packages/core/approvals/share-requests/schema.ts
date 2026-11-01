import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 앱마다 열린 요청은 하나다. 승인이나 거절이면 줄을 지운다. agents는 agent id의 JSON 배열이다.
export const shareRequestSteps: SchemaStep[] = [
  {
    id: "approvals.share_requests",
    sql: `
create table share_requests (
  app text primary key,
  agents text not null,
  coding_agents integer not null check (coding_agents in (0, 1)),
  reason text not null,
  session text not null,
  requested_at text not null
);`,
  },
];
