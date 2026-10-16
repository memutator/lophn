import { ROUTER_COMMANDS } from "./commands.ts";
import { ROUTER_READS } from "./reads.ts";
import { ROUTER_SCHEMA_STEPS } from "./schema.ts";

// Router의 core 등록. writer가 command를, reader가 read를 가져간다. 바깥 구현은 environment.ts로 놓인다.
export function createRouterRegistration() {
  return {
    schemaSteps: ROUTER_SCHEMA_STEPS,
    commands: [...ROUTER_COMMANDS],
    reads: [...ROUTER_READS],
  };
}

// reader Worker가 read만 다시 조립한다.
export function createRouterReaderRegistration() {
  return { reads: [...ROUTER_READS], ports: new Map() };
}
