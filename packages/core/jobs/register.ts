import type { ReaderRegistration } from "../storage/ledger/mod.ts";
import { createJobCommands } from "./commands.ts";
import { createDueCommands } from "./due.ts";
import { createJobReads } from "./reads.ts";
import { jobsSchemaSteps } from "./schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
};

// scheduler·service 류를 import하지 않는다. Worker가 이 file을 싣는다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createJobCommands();
  const due = createDueCommands();
  const reads = createJobReads();
  return {
    schemaSteps: jobsSchemaSteps,
    commands: [
      commands.create,
      commands.update,
      commands.remove,
      due.claimDue,
      due.started,
      due.ended,
      due.decideHold,
    ],
    reads: [reads.list, reads.runList, reads.holds, reads.open],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  const reads = createJobReads();
  return {
    reads: [reads.list, reads.runList, reads.holds, reads.open],
    ports: new Map<unknown, unknown>(),
  };
}
