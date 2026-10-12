import {
  CLAIM_SWEEP_INTERVAL_MS,
  createTicketCheckCommands,
  createTicketCheckReads,
  createTicketClaimCommands,
  createTicketCommands,
  createTicketFinishCommands,
  createTicketReads,
  expiredClaims,
  TICKET_BLOB_FIELDS,
  TICKET_BLOB_PURPOSES,
  ticketSchemaSteps,
} from "./mod.ts";
import {
  ticketCancelled,
  ticketCheckFailed,
  ticketClaimed,
  ticketClaimReleased,
  ticketCompletionReported,
  ticketConfirmed,
  ticketCreated,
  ticketUploadSummary,
} from "../../../protocol/coding-agent/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
} from "../../storage/ledger/mod.ts";
import { notificationsOnlyVisibility } from "../../main/daemon/platform-register.ts";
import { ticketCheckFeedVisibility } from "./checker/connection.ts";
import {
  problemsWorkVisibility,
  visibleToProblemsWork,
} from "../../problems/grouping/connection.ts";

// owner definitions만 내보낸다. 문제 상태·질문 채택 답을 읽는 port(QuestionAdoptions,
// ProblemStatuses)의 제품 구현은 ticket-ports.ts가 따로 등록한다. 등록하지 않은 port 호출은
// tx.port가 거부하므로 그 등록이 없는 조립에서 ticket 생성 검사는 fail-closed다.
const commands = createTicketCommands();
const claims = createTicketClaimCommands();
const finish = createTicketFinishCommands();
const reads = createTicketReads();
const checks = createTicketCheckCommands();
const checkReads = createTicketCheckReads();

// 만료·회수 정리 간격. core 감독 timer가 이 간격으로 후보를 읽고
// ticket.expire_claim을 제출한다. timer 자체는 표를 쓰지 않는다.
export const ticketClaimSweepIntervalMs = CLAIM_SWEEP_INTERVAL_MS;
export { expiredClaims };

// reader Worker가 다시 import한다. ticket read는 port가 없다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createTicketReads();
  return {
    reads: [
      reads.list,
      reads.show,
      reads.checks,
      reads.screen_list,
      reads.screen_detail,
      reads.claim_sweep,
      checkReads.check_work,
    ],
    ports: new Map(),
  };
}

// ticket 계기 event의 공개 정책. notifications 구독자에게만 연다.
// 사람은 notification read로 본다. 다른 ticket event는 정책이 없어 계속 숨김이다.
export function createEventRegistration(): EventRegistration {
  return {
    visibility: [
      // `problems.work` 반응기(문제 work 연결)도 읽는 ticket event다.
      visibleToProblemsWork(notificationsOnlyVisibility(ticketConfirmed)),
      visibleToProblemsWork(notificationsOnlyVisibility(ticketCheckFailed)),
      // checker를 깨우는 event. checker 구독자(machine:ticket-check-feed)와 문제 work 반응기에게 열린다.
      visibleToProblemsWork(
        ticketCheckFeedVisibility(ticketCompletionReported),
      ),
      // 문제 work 반응기에게만 열린다. 정책이 없던 event다.
      problemsWorkVisibility(ticketCreated),
      problemsWorkVisibility(ticketClaimed),
      problemsWorkVisibility(ticketClaimReleased),
      problemsWorkVisibility(ticketCancelled),
    ],
  };
}

export const ticketDefinitions = {
  schema: ticketSchemaSteps,
  blobFields: TICKET_BLOB_FIELDS,
  blobPurposes: TICKET_BLOB_PURPOSES,
  uploadRoutes: [ticketUploadSummary],
  commands: [
    commands.create,
    commands.make_ready,
    claims.claim,
    claims.renew_claim,
    claims.release_claim,
    claims.expire_claim,
    finish.report_completion,
    finish.cancel,
    checks.record_checks,
  ],
  reads: [
    reads.list,
    reads.show,
    reads.checks,
    reads.screen_list,
    reads.screen_detail,
    reads.claim_sweep,
    checkReads.check_work,
  ],
};
