import {
  CLAIM_SWEEP_INTERVAL_MS,
  createTicketClaimCommands,
  createTicketCommands,
  createTicketReads,
  expiredClaims,
  ticketSchemaSteps,
} from "../../packages/coding-agent/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";

// owner definitions만 내보낸다. 문제 read·question read 대체 port 구현은
// 소유 구현(문제#T6, lophn-agent#T24)이 오면 그 port로 바꾼다. 지금은 소유
// 구현이 없어 port create를 두지 않는다. 등록하지 않은 port 호출은 tx.port가
// 거부하므로 ticket 생성 검사는 fail-closed다.
const commands = createTicketCommands();
const claims = createTicketClaimCommands();
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

export const ticketDefinitions = {
  schema: ticketSchemaSteps,
  commands: [
    commands.create,
    commands.make_ready,
    claims.claim,
    claims.renew_claim,
    claims.release_claim,
    claims.expire_claim,
  ],
  reads: [reads.list, reads.show, reads.checks, reads.claim_sweep],
};
