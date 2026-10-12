import type { Result } from "../../../base/mod.ts";
import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { createSeriesCommands } from "./commands.ts";
import { seriesSchemaSteps } from "./mod.ts";

type Environment = {
  currentCredential(credentialRef: string): Result<AuthenticatedContext>;
};

// series ledger 테스트 등록. 명령·schema를 public harness에 붙인다.
// 읽기는 T18이 등록한다. membership 검사(loadDocument·loadLatestVersion)는
// versions·addressing 표를 harness에 붙이는 곳에서 같이 뜨므로 여기서는 표만 더한다.
export function createLedgerTestRegistration(
  _environment: Environment,
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
  };
}
