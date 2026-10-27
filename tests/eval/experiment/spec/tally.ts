import type { TrialResult, VersionRef } from "../../types.ts";
import type { Outcome, OutcomeState, PoolVerdict, Tally } from "./types.ts";

// 채점 대기인 check는 pass:false라도 떨어진 것이 아니다. 이미 떨어진 것이 있으면 대기가 남아도 fail이다.
export function outcomeOf(
  trial: TrialResult,
  runComponents: VersionRef[],
): Outcome {
  const pending = trial.checks.filter((c) => c.pending).map((c) => c.id);
  const failed =
    trial.settle.kind !== "idle" ||
    trial.checks.some((c) => !c.pass && !c.pending);
  const state: OutcomeState = failed
    ? "fail"
    : pending.length > 0
      ? "pending"
      : "pass";
  return {
    index: trial.index,
    passed: state === "pass",
    state,
    pending,
    checks: Object.fromEntries(trial.checks.map((c) => [c.id, c.pass])),
    cost_usd: trial.metrics.cost_usd,
    components: trial.components ?? runComponents,
  };
}

// 없는 id는 실패다: check 이름이 바뀐 것을 통과로 치지 않는다.
export function goalState(o: Outcome, checks: string[] | null): OutcomeState {
  if (checks === null) return o.state;
  const down = (id: string) =>
    !(id in o.checks) || (!o.checks[id] && !o.pending.includes(id));
  if (checks.some(down)) return "fail";
  return checks.some((id) => o.pending.includes(id)) ? "pending" : "pass";
}

export function goalPassed(o: Outcome, checks: string[] | null): boolean {
  return goalState(o, checks) === "pass";
}

export function tallyOf(outcomes: Outcome[], checks: string[] | null): Tally {
  const t: Tally = { passed: 0, trials: 0, pending: 0 };
  for (const o of outcomes) {
    const s = goalState(o, checks);
    if (s === "pending") t.pending++;
    else {
      t.trials++;
      if (s === "pass") t.passed++;
    }
  }
  return t;
}

export function poolVerdict(t: Tally): PoolVerdict {
  if (t.trials === 0) return "none";
  if (t.passed * 2 > t.trials) return "pass";
  if (t.passed * 2 < t.trials) return "fail";
  return "split";
}
