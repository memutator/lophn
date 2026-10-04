import type { Result } from "../../base/mod.ts";
import { definePort, type PortKey } from "../platform/ports.ts";
import type { ConnectionId } from "./connections.ts";
import type { TicketId } from "./ticket-values.ts";

export const TICKET_CLAIM_REJECTS = [
  "missing",
  "expired",
  "released",
  "revoked",
  "changed",
  "wrong_connection",
  "not_ready",
  "ticket_closed",
] as const;

export type TicketClaimReject = (typeof TICKET_CLAIM_REJECTS)[number];

export type TicketClaimCheckInput = {
  ticket: TicketId;
  claim_seq: string;
  connection: ConnectionId;
  now: string;
};

export type TicketClaimCheckResult =
  | { ok: true; expires_at: string }
  | { ok: false; reason: TicketClaimReject };

// apps의 release 준비 transaction이 현재 claim을 확인한다.
// 읽기·준비는 claim 기한을 연장하지 않는다.
export type TicketClaimChecker = (
  input: TicketClaimCheckInput,
) => Result<TicketClaimCheckResult>;

export const TicketClaimCheck: PortKey<TicketClaimChecker> = definePort<
  TicketClaimChecker
>("TicketClaimCheck");
