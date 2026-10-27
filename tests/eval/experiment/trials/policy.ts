import {
  goalPassed,
  goalState,
  type Outcome,
  type Policy,
  poolVerdict,
  type Role,
  tallyOf,
} from "../spec/mod.ts";

export type TrialState = {
  role: Role;
  checks: string[] | null; // PlanEntry.checks
  baseline: Outcome[]; // PlanEntry.baseline
  variant: Outcome[]; // 이 experiment가 지금까지 돈 variant trial
  flaky: boolean; // flakyScenarios에 든 시나리오인가
};

// 한 시나리오가 variant trial을 몇 번 더 돌아야 하는가. 0이면 끝이다.
// 채점 대기 trial이 있으면 0을 돌려 정하지 않는다: ex-cli가 채점 뒤 다시 부른다.
export function nextTrials(state: TrialState, policy: Policy): number {
  const n = state.variant.length;
  if (n >= policy.max) return 0;
  const start = state.flaky ? policy.max : policy.base;
  if (n < start) return start - n;

  if (state.role !== "guard") {
    const goal = state.checks;
    if (state.variant.some((o) => goalState(o, goal) === "pending")) return 0;
    // 통과가 하나라도 있어야 더 돌려 확인한다. 나아지지 않으면 거기서 멈춘다.
    return state.variant.some((o) => goalPassed(o, goal)) ? policy.max - n : 0;
  }

  if (state.variant.some((o) => goalState(o, null) === "pending")) return 0;
  const same =
    poolVerdict(tallyOf(state.variant, null)) ===
    poolVerdict(tallyOf(state.baseline, null));
  return same ? 0 : policy.max - n;
}
