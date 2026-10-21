import type { Scenario } from "../../types.ts";

export type TrialKind = "judgment" | "long";

// 앱을 짓는 trial은 core·앱 build·앱 process를 오래 쥐어 판단 case보다 적게 동시에 돈다.
export const DEFAULT_LIMITS: Readonly<Record<TrialKind, number>> = {
  judgment: 4,
  long: 2,
};

export function trialKindOf(scenario: Pick<Scenario, "limits">): TrialKind {
  return scenario.limits !== undefined ? "long" : "judgment";
}
