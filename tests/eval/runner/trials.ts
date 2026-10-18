import type { TrialResult } from "../types.ts";
import type { Cap } from "./cap.ts";

// trial은 차례로 돈다. 이미 돈 trial은 상한에 걸려도 버리지 않는다.
export async function runTrials<T extends { result: TrialResult }>(
  count: number,
  runOne: (index: number) => Promise<T>,
  cap: Cap,
  log: (line: string) => void = console.log,
): Promise<{ outcomes: T[]; stoppedByCap: boolean }> {
  const outcomes: T[] = [];
  let warned = false;
  for (let index = 0; index < count; index++) {
    if (cap.exceeded()) return { outcomes, stoppedByCap: true };
    const outcome = await runOne(index);
    outcomes.push(outcome);
    const { metrics, judge } = outcome.result;
    cap.add(metrics.cost_usd + judge.reduce((sum, j) => sum + j.cost_usd, 0));
    if (metrics.unpriced_calls > 0 && !warned) {
      warned = true;
      log("비용 모르는 call 있음: 합계 비용이 모자랄 수 있다");
    }
  }
  return { outcomes, stoppedByCap: false };
}
