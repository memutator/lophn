import { ticketUploadSummary } from "../../../protocol/coding-agent/ticket/mod.ts";
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import {
  type ReaderRegistration,
  snapshotPort,
} from "../../storage/ledger/mod.ts";
import { annotationLookup } from "../annotations/reads.ts";
import { createTicketCheckCommands, createTicketCheckReads } from "./checks.ts";
import { createTicketClaimCommands } from "./claims.ts";
import { createTicketCommands } from "./commands.ts";
import { CLAIM_SWEEP_INTERVAL_MS } from "./expiry.ts";
import { codingSessionLookup } from "./coding/lookup.ts";
import { TicketAnnotationLookup } from "./ports.ts";
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

// reader Worker가 다시 import한다. 앱 하나 범위 검사(CodingSessionLookup)와 근거 annotation 풀기
// (TicketAnnotationLookup)는 snapshot의 sql로 읽는다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: readList,
    ports: new Map<unknown, unknown>([
      [CodingSessionLookup, snapshotPort((s) => codingSessionLookup(s.sql))],
      [TicketAnnotationLookup, snapshotPort((s) => annotationLookup(s.sql))],
    ]),
  };
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
