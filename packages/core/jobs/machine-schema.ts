import type { SchemaStep } from "../../protocol/server/mod.ts";

// job의 주인 기계. NULL은 "아직 찍지 않음"이다: 이 칸이 없던 때의 job은 새 판의 첫 기동 claim이 이 기계 id로 찍는다(step은 기계 id를 모른다).
// 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams에서 잇는다.
export const jobMachineSchemaSteps: readonly SchemaStep[] = [
  {
    id: "jobs.machine",
    sql: "ALTER TABLE jobs ADD COLUMN machine TEXT;",
  },
];
