// claim 기한 규칙. 기한은 claim·명시 갱신 시각부터 정확히 3,600,000ms다. 읽기·release 준비·
// 무호출은 기한을 바꾸지 않는다. 만료 정리는 60초마다·재시작 때 하되, 정리 전이라도 쓰기는
// 즉시 기한을 검사한다.
import type { TicketClaimCheckResult } from "../../../protocol/coding-agent/ticket/mod.ts";

export const CLAIM_DURATION_MS = 3_600_000;
export const CLAIM_SWEEP_INTERVAL_MS = 60_000;

export type ClaimRow = {
  session: string;
  seq: string;
  expires_at: string;
};

// 경계는 거절이다. now가 기한과 같으면 이미 만료다.
export function expired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

// 현재 claim 검사. 정리 전이라도 만료·다른 seq는 즉시 거절한다.
export function checkClaim(input: {
  state: string;
  claim: ClaimRow | null;
  session: string;
  claim_seq: string;
  now_ms: number;
}): TicketClaimCheckResult {
  if (input.state === "verified" || input.state === "cancelled") {
    return { ok: false, reason: "ticket_closed" };
  }
  if (input.claim === null) {
    // 반납·만료로 끝난 claim의 seq는 released다. 한 번도 없던 seq는 missing.
    return {
      ok: false,
      reason: input.claim_seq === "0" ? "missing" : "released",
    };
  }
  if (input.claim.session !== input.session) {
    return { ok: false, reason: "wrong_session" };
  }
  if (input.claim.seq !== input.claim_seq) {
    return { ok: false, reason: "changed" };
  }
  if (expired(Date.parse(input.claim.expires_at), input.now_ms)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, expires_at: input.claim.expires_at };
}
