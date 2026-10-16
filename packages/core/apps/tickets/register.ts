import { ticketUploadSummary } from "../../../protocol/coding-agent/ticket/mod.ts";
import type { ReaderRegistration } from "../../storage/ledger/mod.ts";
import { createTicketCheckCommands, createTicketCheckReads } from "./checks.ts";
import { createTicketClaimCommands } from "./claims.ts";
import { createTicketCommands } from "./commands.ts";
import { CLAIM_SWEEP_INTERVAL_MS } from "./expiry.ts";
import { createTicketReads } from "./reads.ts";
import { createTicketReportCommands } from "./report.ts";
import { TICKET_BLOB_FIELDS, TICKET_BLOB_PURPOSES } from "./blobs.ts";
import { ticketSchemaSteps } from "./schema.ts";

const commands = createTicketCommands();
const claims = createTicketClaimCommands();
const report = createTicketReportCommands();
const checks = createTicketCheckCommands();
const reads = createTicketReads();
const checkReads = createTicketCheckReads();

const readList = [
  reads.list,
  reads.show,
  reads.claim_sweep,
  checkReads.check_work,
];

// 만료 정리 간격. core 감독 timer가 이 간격으로 후보를 읽고 ticket.expire_claim을 제출한다.
// timer 자체는 표를 쓰지 않는다.
export const ticketClaimSweepIntervalMs = CLAIM_SWEEP_INTERVAL_MS;

// reader Worker가 다시 import한다. 앱 하나 범위 검사와 annotation 풀기가 읽는 port
// (CodingSessionLookup, TicketAnnotationLookup)는 그 구현 module의 reader 등록이 붙인다.
export function createReaderRegistration(): ReaderRegistration {
  return { reads: readList, ports: new Map() };
}

export const ticketDefinitions = {
  schema: ticketSchemaSteps,
  blobFields: TICKET_BLOB_FIELDS,
  blobPurposes: TICKET_BLOB_PURPOSES,
  uploadRoutes: [ticketUploadSummary],
  commands: [
    commands.create,
    commands.update,
    commands.verify,
    commands.cancel,
    claims.claim,
    claims.renew_claim,
    claims.expire_claim,
    report.report_completion,
    checks.record_checks,
  ],
  reads: readList,
};
