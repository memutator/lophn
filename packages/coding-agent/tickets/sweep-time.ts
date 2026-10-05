import { definePort, type Tx } from "../../contracts/platform/mod.ts";

// claim 만료 판단 시각. writer clock은 기동 시각에 고정되어 tx.now()로 기한을
// 볼 수 없다. sweep가 blob-prune으로 알린 시각만 여기 둔다. null이면 아직
// sweep가 시각을 알리지 않았으므로 호출자가 tx.now()를 쓴다.
// writer clock이 실제 시각을 따르면(fix/writer-clock) 이 port를 빼고 tx.now()로
// 돌아간다.
export type ClaimSweepTime = {
  nowMs(): number | null;
};

export const CLAIM_SWEEP_TIME_PORT = definePort<ClaimSweepTime>(
  "coding-agent.tickets.ClaimSweepTime",
);

export function claimSweepTimePort(
  current: () => number | null,
): { key: typeof CLAIM_SWEEP_TIME_PORT; create: (tx: Tx) => ClaimSweepTime } {
  return {
    key: CLAIM_SWEEP_TIME_PORT,
    create: () => ({ nowMs: () => current() }),
  };
}
