import {
  type RewindStore,
  sweepRewindStore,
} from "../../packages/lophn-agent/revert/mod.ts";
import { ledgerSnapshot } from "./rewind-files.ts";

// session 저장소 쓸기의 core 조립이다(lophn-agent/revert "저장"). 시작 때와 이 간격마다 row가 없는 고아 저장물과
// 닫히거나 지워진 session의 디렉터리를 쓸어낸다.
export const REWIND_SWEEP_INTERVAL_MS = 60 * 60_000;

// 이보다 최근에 만든 저장물은 ledger row 등록 전일 수 있어(설치와 등록은 공동 원자 작업이 아니다) 건너뛴다.
export const REWIND_SWEEP_GRACE_MS = 10 * 60_000;

export async function sweepRewind(input: {
  ledgerPath: string;
  store: RewindStore;
  nowMs: number;
}): Promise<void> {
  await sweepRewindStore({
    store: input.store,
    snapshot: (read) => {
      const seen = ledgerSnapshot(input.ledgerPath, read);
      if (!seen.ok) throw new Error(seen.error.message);
      return seen.value;
    },
    skipNewerThan: input.nowMs - REWIND_SWEEP_GRACE_MS,
  });
}
