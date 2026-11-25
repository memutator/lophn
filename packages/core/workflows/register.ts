import {
  workflowCheck,
  workflowDelete,
  workflowEdit,
  workflowExport,
  workflowImport,
  workflowList,
  workflowRename,
  workflowReport,
  workflowResume,
  workflowRetry,
  workflowSetDefaults,
  workflowStart,
  workflowStop,
  workflowTitleRequestTake,
} from "../../protocol/workflows/mod.ts";
import type { ReaderRegistration } from "../storage/ledger/mod.ts";
import { WORKFLOW_SNAPSHOT_BLOB_FIELD } from "./checkpoint-schema.ts";
import { createWorkflowCommands } from "./commands.ts";
import { createWorkflowReads } from "./reads.ts";
import { workflowsSchemaSteps } from "./schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  blobFields?: readonly unknown[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  // 여덟 route의 handler는 core 조립(wf-service)이 붙인다. 여기 넣어야 agent credential·remote allowlist가 닿는 route 목록에 든다.
  memoryRoutes?: readonly unknown[];
};

// service.ts를 import하지 않는다. Worker가 이 file을 싣는다. command가 routerFor를 쓰므로
// router-registration.ts와 같은 Worker에 있어야 한다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createWorkflowCommands();
  const reads = createWorkflowReads();
  return {
    schemaSteps: workflowsSchemaSteps,
    blobFields: [WORKFLOW_SNAPSHOT_BLOB_FIELD],
    commands: [
      commands.create,
      commands.apply,
      commands.upsertCheckpoint,
      commands.rename,
      commands.setAiTitle,
    ],
    reads: [reads.read, reads.list, reads.activity],
    memoryRoutes: [
      workflowList,
      workflowStart,
      workflowReport,
      workflowEdit,
      workflowRetry,
      workflowResume,
      workflowStop,
      workflowCheck,
      workflowRename,
      workflowDelete,
      workflowExport,
      workflowImport,
      workflowSetDefaults,
      workflowTitleRequestTake,
    ],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  const reads = createWorkflowReads();
  return {
    reads: [reads.read, reads.list, reads.activity],
    ports: new Map<unknown, unknown>(),
  };
}
