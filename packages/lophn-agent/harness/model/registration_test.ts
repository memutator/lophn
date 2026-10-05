import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import {
  createProviderCommands,
  createProviderReads,
  providerSchemaSteps,
} from "../provider/mod.ts";
import {
  createModelDefaultsCommands,
  createModelDefaultsReads,
  modelSchemaSteps,
} from "./mod.ts";

// model defaults ledger 테스트 등록. provider 표와 같은 wire에 defaults 명령·읽기를 붙인다.
export function createLedgerTestRegistration(): LedgerTestRegistration {
  const providerCommands = createProviderCommands();
  const providerReads = createProviderReads();
  const modelCommands = createModelDefaultsCommands();
  const modelReads = createModelDefaultsReads();
  return {
    schemaSteps: [...providerSchemaSteps, ...modelSchemaSteps],
    commands: [
      providerCommands.register,
      modelCommands.change,
    ],
    reads: [
      providerReads.read,
      modelReads.defaults,
    ],
  };
}
