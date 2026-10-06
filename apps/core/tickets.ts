import {
  CLAIM_SWEEP_INTERVAL_MS,
  createTicketClaimCommands,
  createTicketCommands,
  createTicketFinishCommands,
  createTicketReads,
  expiredClaims,
  TICKET_BLOB_FIELDS,
  TICKET_BLOB_PURPOSES,
  ticketSchemaSteps,
} from "../../packages/coding-agent/mod.ts";
import {
  ticketCheckFailed,
  ticketConfirmed,
} from "../../packages/contracts/coding-agent/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
} from "../../packages/platform/ledger/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";

// owner definitions만 내보낸다. 문제 read·question read 대체 port 구현은
// 소유 구현(문제#T6, lophn-agent#T24)이 오면 그 port로 바꾼다. 지금은 소유
// 구현이 없어 port create를 두지 않는다. 등록하지 않은 port 호출은 tx.port가
// 거부하므로 ticket 생성 검사는 fail-closed다.
const commands = createTicketCommands();
const claims = createTicketClaimCommands();
const finish = createTicketFinishCommands();
const reads = createTicketReads();

// 만료·회수 정리 간격. core 감독 timer가 이 간격으로 후보를 읽고
// ticket.expire_claim을 제출한다. timer 자체는 표를 쓰지 않는다(R13).
export const ticketClaimSweepIntervalMs = CLAIM_SWEEP_INTERVAL_MS;
export { expiredClaims };

// reader Worker가 다시 import한다. ticket read는 port가 없다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createTicketReads();
  return {
    reads: [reads.list, reads.show, reads.checks, reads.claim_sweep],
    ports: new Map(),
  };
}

// ticket 계기 event의 공개 정책(platform/notifications#R1). notifications 구독자에게만 연다.
// 사람은 notification read로 본다. 다른 ticket event는 정책이 없어 계속 숨김이다.
export function createEventRegistration(): EventRegistration {
  return {
    visibility: [
      notificationsOnlyVisibility(ticketConfirmed),
      notificationsOnlyVisibility(ticketCheckFailed),
    ],
  };
}

export const ticketDefinitions = {
  schema: ticketSchemaSteps,
  blobFields: TICKET_BLOB_FIELDS,
  blobPurposes: TICKET_BLOB_PURPOSES,
  commands: [
    commands.create,
    commands.make_ready,
    claims.claim,
    claims.renew_claim,
    claims.release_claim,
    claims.expire_claim,
    finish.report_completion,
    finish.cancel,
  ],
  reads: [reads.list, reads.show, reads.checks, reads.claim_sweep],
};
