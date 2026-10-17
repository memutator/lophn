// approvals의 core 등록. writer가 command를, reader가 read를, core가 memory route를 가져간다.
import {
  approvalsDecideTurn,
  toolGateCheck,
} from "../../protocol/approvals/mod.ts";
import { approvalCommands } from "./commands.ts";
import { agentGrantRegistration } from "./grants/mod.ts";
import {
  approvalsPendingRead,
  approvalsRequestRead,
  approvalsUnappliedRead,
} from "./reads.ts";
import { APPROVAL_SCHEMA_STEPS } from "./schema.ts";

export function createCoreRegistration() {
  return {
    schemaSteps: [
      ...APPROVAL_SCHEMA_STEPS,
      ...agentGrantRegistration.schemaSteps,
    ],
    commands: [...approvalCommands, ...agentGrantRegistration.commands],
    reads: [
      approvalsPendingRead,
      approvalsRequestRead,
      approvalsUnappliedRead,
      ...agentGrantRegistration.reads,
    ],
    // handler는 wiring이 route 이름으로 붙인다.
    memoryRoutes: [approvalsDecideTurn, toolGateCheck],
  };
}

// reader Worker가 read만 다시 조립한다.
export function createReaderRegistration() {
  const { reads } = createCoreRegistration();
  return { reads, ports: new Map() };
}
