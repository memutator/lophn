import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import {
  createUsageCommands,
  createUsageReads,
  usageSchemaSteps,
} from "./mod.ts";

// usage ledger 테스트 등록. 명령·읽기·schema를 public harness에 붙인다.
// provider 표와 명령은 provider registration_test.ts가 등록하므로
// registrationModules에서 같이 뜬다.
export function createLedgerTestRegistration(): LedgerTestRegistration {
  const commands = createUsageCommands();
  const reads = createUsageReads();
  return {
    schemaSteps: [...usageSchemaSteps],
    commands: [
      commands.start,
      commands.finish,
      commands.supplement,
    ],
    reads: [reads.read, reads.list, reads.usage],
  };
}
