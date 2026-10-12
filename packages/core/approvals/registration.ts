// approval의 core 등록(platform#T21, T22). schema·command·read·blob field를 한 자리에서 낸다.
// core writer가 teamModules로 이 파일을 다시 import하므로 createCoreRegistration만 둔다.

import type { CommandRoute } from "../../protocol/platform/mod.ts";
import { createApplyCommand } from "./apply.ts";
import { APPROVAL_BLOB_FIELDS } from "./blobs.ts";
import { createApprovalCommands } from "./commands.ts";
import { approvalExpirySweepRead } from "./expiry.ts";
import { approvalsGetRead, approvalsListRead } from "./reads.ts";
import { APPROVAL_SCHEMA_STEPS } from "./schema.ts";

// owners는 apply가 dispatch할 수 있는 소유 command route 목록을 돌려주는 함수다.
// 주지 않으면(소유 command가 없는 등록) apply command를 등록하지 않는다.
export function createApprovalRegistration(
  options: { owners?: () => readonly CommandRoute[] } = {},
) {
  const commands = createApprovalCommands();
  return {
    schemaSteps: APPROVAL_SCHEMA_STEPS,
    commands: [
      commands.create,
      commands.expire,
      commands.cancel,
      commands.grant,
      commands.reject,
      ...(options.owners === undefined
        ? []
        : [createApplyCommand(options.owners)]),
    ],
    reads: [
      approvalsGetRead(),
      approvalsListRead(),
      approvalExpirySweepRead(),
    ],
    blobFields: APPROVAL_BLOB_FIELDS,
  };
}

export function createCoreRegistration() {
  return createApprovalRegistration();
}
