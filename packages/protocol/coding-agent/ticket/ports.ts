import type { Result } from "../../../base/mod.ts";
import { definePort, type PortKey } from "../../base/ports.ts";
import type { TicketId } from "./values.ts";

const TICKET_CLAIM_REJECTS = [
  "missing",
  "expired",
  "released",
  "revoked",
  "changed",
  "wrong_session",
  "ticket_closed",
] as const;

type TicketClaimReject = (typeof TICKET_CLAIM_REJECTS)[number];

type TicketClaimCheckInput = {
  ticket: TicketId;
  claim_seq: string;
  session: string;
  now: string;
};

export type TicketClaimCheckResult =
  // app은 ticket이 속한 앱이다. release 준비가 준비 대상 앱과 같은지 대조한다.
  | { ok: true; expires_at: string; app?: string }
  | { ok: false; reason: TicketClaimReject };

// apps의 release 준비 transaction이 현재 claim을 확인한다.
// 읽기·준비는 claim 기한을 연장하지 않는다.
export type TicketClaimChecker = (
  input: TicketClaimCheckInput,
) => Result<TicketClaimCheckResult>;

export const TicketClaimCheck: PortKey<TicketClaimChecker> = definePort<
  TicketClaimChecker
>("TicketClaimCheck");

// coding session이 끝났을 때 claim을 반납한다. 완료 보고가 없었으면 같은 tx에서
// `CodingSessionEndedUnreported`를 낸다. 구현은 coding-agent-tickets.
export type TicketSessionEnd = {
  settle(session: string): Result<{ ticket: string | null; reported: boolean }>;
  // 기동 때 claim이 남은 모든 session을 정산하고 정산한 수를 돌려준다.
  settleAll(): Result<number>;
};
export const TicketSessionEnd: PortKey<TicketSessionEnd> = definePort<
  TicketSessionEnd
>("TicketSessionEnd");
