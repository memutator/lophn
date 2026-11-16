import type { ReaderRegistration } from "../storage/ledger/mod.ts";
import { createJobCommands } from "./commands.ts";
import { createDueCommands } from "./due.ts";
import { createEventCommands } from "./events.ts";
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
  const events = createEventCommands();
  return {
    schemaSteps: jobsSchemaSteps,
    commands: [
      commands.create,
      commands.update,
      commands.approve,
      commands.remove,
      commands.takeOver,
      due.claimDue,
      due.started,
      due.ended,
      due.decideHold,
      events.fire,
    ],
    reads: [
      reads.list,
      reads.runList,
      reads.pending,
      reads.holds,
      reads.open,
      reads.activity,
      events.triggers,
    ],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  const reads = createJobReads();
  const events = createEventCommands();
  return {
    reads: [
      reads.list,
      reads.runList,
      reads.pending,
      reads.holds,
      reads.open,
      reads.activity,
      events.triggers,
    ],
    ports: new Map<unknown, unknown>(),
  };
}
