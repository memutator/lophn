import type { PlanEntry, Policy } from "../spec/mod.ts";

type Range = { min: number; likely: number; worst: number };
export type Estimate = {
  trials: Range;
  usd: Range;
  unpriced: string[]; // 기준 trial이 없어 시나리오 평균으로 값을 어림한 시나리오 id
};

const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

// variant trial 하나의 값은 기준과 같다고 어림한다. 어림이다.
export function estimateTrials(
  entries: { entry: PlanEntry; flaky: boolean }[],
  policy: Policy,
): Estimate {
  const all = mean(
    entries.flatMap((e) => e.entry.baseline.map((o) => o.cost_usd)),
  );
  const sum: Estimate = {
    trials: { min: 0, likely: 0, worst: 0 },
    usd: { min: 0, likely: 0, worst: 0 },
    unpriced: [],
  };
  for (const { entry, flaky } of entries) {
    const min = flaky ? policy.max : policy.base;
    const n: Range = {
      min,
      likely: entry.role === "guard" ? min : policy.max,
      worst: policy.max,
    };
    const priced = entry.baseline.length > 0;
    if (!priced) sum.unpriced.push(entry.scenario);
    const price = priced ? mean(entry.baseline.map((o) => o.cost_usd)) : all;
    for (const k of ["min", "likely", "worst"] as const) {
      sum.trials[k] += n[k];
      sum.usd[k] += n[k] * price;
    }
  }
  return sum;
}
