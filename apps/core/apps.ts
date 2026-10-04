import { addressingSchemaSteps } from "../../packages/documents/addressing/mod.ts";
import {
  createAppCommands,
  createAppsReads,
  appsSchemaSteps,
} from "../../packages/apps/registration/mod.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  ports?: readonly unknown[];
};

// owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createAppCommands();
  const reads = createAppsReads();
  return {
    // place_names 예약은 documents/addressing 표를 쓴다(R6, R10).
    schemaSteps: [...addressingSchemaSteps, ...appsSchemaSteps],
    commands: [
      commands.create,
      commands.connectSource,
      commands.archive,
      commands.unarchive,
    ],
    reads: [reads.list, reads.get],
    ports: [],
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
