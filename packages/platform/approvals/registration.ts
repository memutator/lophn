// approval의 core 등록(platform#T21, T22). schema·command·read·blob field를 한 자리에서 낸다.
// core writer가 teamModules로 이 파일을 다시 import하므로 createCoreRegistration만 둔다.

import { APPROVAL_BLOB_FIELDS } from "./blobs.ts";
import { createApprovalCommands } from "./commands.ts";
import { approvalsGetRead, approvalsListRead } from "./reads.ts";
import { APPROVAL_SCHEMA_STEPS } from "./schema.ts";

export function createApprovalRegistration() {
  const commands = createApprovalCommands();
  return {
    schemaSteps: APPROVAL_SCHEMA_STEPS,
    commands: [
      commands.create,
      commands.expire,
      commands.cancel,
      commands.grant,
      commands.reject,
    ],
    reads: [approvalsGetRead(), approvalsListRead()],
    blobFields: APPROVAL_BLOB_FIELDS,
  };
}

export function createCoreRegistration() {
  return createApprovalRegistration();
}
