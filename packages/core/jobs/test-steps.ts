import type { SchemaStep } from "../../protocol/server/mod.ts";
import { JOBS_APPROVAL_MODES_SCHEMA_STEP } from "./approval-modes-schema.ts";
import { jobMachineSchemaSteps } from "./machine-schema.ts";
import { jobsSchemaSteps } from "./schema.ts";
import { jobTriggerSchemaSteps } from "./trigger-schema.ts";

// jobs 표를 직접 만드는 test가 같이 쓰는 step 목록이다. event 때(`jobs.trigger`)까지 들어 있어 새 열이 생겨도 test마다 고치지 않는다.
export const jobsTestSteps: readonly SchemaStep[] = [
  ...jobsSchemaSteps,
  ...jobTriggerSchemaSteps,
  ...jobMachineSchemaSteps,
  JOBS_APPROVAL_MODES_SCHEMA_STEP,
];

// 테스트의 tx port에 꽂는 이 기계다. 다른 기계는 OTHER_MACHINE으로 쓴다.
export const THIS_MACHINE = "mch_01hzzzzzzzzzzzzzzzzzzzzzza";
export const OTHER_MACHINE = "mch_01hzzzzzzzzzzzzzzzzzzzzzzb";
