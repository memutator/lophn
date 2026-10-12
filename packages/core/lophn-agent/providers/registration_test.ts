import type { LedgerTestRegistration } from "../../testing/ledger.ts";
import {
  createProviderCommands,
  createProviderReads,
  providerSchemaSteps,
} from "./mod.ts";

// provider ledger 테스트 등록. 명령·읽기·schema를 public harness에 붙인다.
export function createLedgerTestRegistration(): LedgerTestRegistration {
  const commands = createProviderCommands();
  const reads = createProviderReads();
  return {
    schemaSteps: providerSchemaSteps,
    commands: [
      commands.register,
      commands.disconnect,
      commands.refreshCredential,
      commands.recordAvailability,
    ],
    reads: [reads.read, reads.list],
  };
}
