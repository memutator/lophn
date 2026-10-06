// claim 기한 규칙(coding-agent/tickets#R12, R13). 기한은 claim·명시 갱신 시각부터
// 정확히 3,600,000ms다. 읽기·release 준비·무호출은 기한을 바꾸지 않는다.
// 만료 정리는 60초마다·재시작 때 하되, 정리 전이라도 쓰기는 즉시 기한을 검사한다.
export const CLAIM_DURATION_MS = 3_600_000;
export const CLAIM_SWEEP_INTERVAL_MS = 60_000;

export type ClaimRow = {
  connection: string;
  seq: string;
  expires_at: string;
};

// checkTicketClaim 거절 이유. contract의 TICKET_CLAIM_REJECTS와 같다.
export type ClaimReject =
  | "missing"
  | "expired"
  | "released"
  | "revoked"
  | "changed"
  | "wrong_connection"
  | "not_ready"
  | "ticket_closed";

// 성공에는 ticket이 속한 앱도 싣는다. release 준비가 준비 대상 앱과 ticket의 앱이 같은지 대조한다.
export type ClaimCheck = { ok: true; expires_at: string; app?: string } | {
  ok: false;
  reason: ClaimReject;
};

// 경계는 거절이다. now가 기한과 같으면 이미 만료다(R12).
export function expired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

export function expiresAt(fromMs: number): number {
  return fromMs + CLAIM_DURATION_MS;
}

// 현재 claim 검사. 정리 전이라도 만료·회수·다른 seq는 즉시 거절한다(R13).
// connection 회수는 claim 행이 남아 있어도 거절한다(connection#R8).
export function checkClaim(input: {
  state: string;
  readiness: string;
  claim: ClaimRow | null;
  connection: string;
  claim_seq: string;
  connection_revoked: boolean;
  now_ms: number;
  expires_at_ms: number | null;
}): ClaimCheck {
  if (input.state === "confirmed" || input.state === "cancelled") {
    return { ok: false, reason: "ticket_closed" };
  }
  if (input.readiness !== "ready") {
    return { ok: false, reason: "not_ready" };
  }
  if (input.claim === null) {
    // 만료·반납·회수로 끝난 claim의 seq는 released다. 한 번도 없던 seq는 missing.
    return {
      ok: false,
      reason: input.claim_seq === "0" ? "missing" : "released",
    };
  }
  if (input.connection_revoked) return { ok: false, reason: "revoked" };
  if (input.claim.connection !== input.connection) {
    return { ok: false, reason: "wrong_connection" };
  }
  if (input.claim.seq !== input.claim_seq) {
    return { ok: false, reason: "changed" };
  }
  if (
    input.expires_at_ms === null || expired(input.expires_at_ms, input.now_ms)
  ) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, expires_at: input.claim.expires_at };
}
