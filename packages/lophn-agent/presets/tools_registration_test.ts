import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import {
  createToolCommands,
  createToolReads,
  toolsSchemaSteps,
} from "../harness/tools/mod.ts";

// tool call ledger 테스트 등록. 제품 mod.ts는 이 파일을 export하지 않는다.

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const commands = createToolCommands();
  const reads = createToolReads();
  return {
    schemaSteps: [...toolsSchemaSteps],
    commands: [
      commands.request,
      commands.decide,
      commands.start,
      commands.finish,
      commands.recordRead,
      commands.supplement,
    ],
    reads: [reads.read, reads.list],
  };
}
