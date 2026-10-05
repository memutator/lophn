import type { Result } from "../../base/mod.ts";
import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import { createSeriesCommands } from "./commands.ts";
import { seriesSchemaSteps } from "./mod.ts";

type Environment = {
  currentCredential(credentialRef: string): Result<AuthenticatedContext>;
};

// series ledger 테스트 등록. 명령·schema를 public harness에 붙인다.
// 읽기는 T18이 등록한다. versions·addressing 표는 membership 검사에서 필요 없다
// (membership은 loadDocument·loadLatestVersion을 부르므로 필요하다).
export function createLedgerTestRegistration(
  environment: Environment,
): LedgerTestRegistration {
  const commands = createSeriesCommands();
  return {
    schemaSteps: [...seriesSchemaSteps],
    commands: [
      commands.create,
      commands.update,
      commands.setDraft,
      commands.clearDraft,
      commands.addInstance,
      commands.updateInstance,
      commands.removeInstance,
      commands.archive,
      commands.unarchive,
    ],
    readPorts: new Map(),
  };
}
