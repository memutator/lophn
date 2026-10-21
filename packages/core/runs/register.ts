import { runCancel, runStart, runWait } from "../../protocol/runs/mod.ts";
import type { ReaderRegistration } from "../storage/ledger/mod.ts";
import { createRunCommands } from "./commands.ts";
import { createRunReads } from "./reads.ts";
import { runsSchemaSteps } from "./schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  // StartRun, WaitRun, CancelRun은 ledger를 쓰지 않는다. handler는 core 조립이 붙인다.
  memoryRoutes?: readonly unknown[];
};

// service.ts를 import하지 않는다. Worker가 이 file을 싣는다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createRunCommands();
  const reads = createRunReads();
  return {
    schemaSteps: runsSchemaSteps,
    commands: [commands.create, commands.settle],
    reads: [reads.read, reads.list],
    memoryRoutes: [runStart, runWait, runCancel],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  const reads = createRunReads();
  return {
    reads: [reads.read, reads.list],
    ports: new Map<unknown, unknown>(),
  };
}
