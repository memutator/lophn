import type { SchemaStep } from "../../protocol/server/mod.ts";
import { jobsSchemaSteps } from "./schema.ts";
import { jobTriggerSchemaSteps } from "./trigger-schema.ts";

// jobs 표를 직접 만드는 test가 같이 쓰는 step 목록이다. event 때(`jobs.trigger`)까지 들어 있어 새 열이 생겨도 test마다 고치지 않는다.
export const jobsTestSteps: readonly SchemaStep[] = [
  ...jobsSchemaSteps,
  ...jobTriggerSchemaSteps,
];
