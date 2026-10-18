import { refText, type RunRecord, type TrialResult } from "../../types.ts";
import { outcomeOf } from "../spec/mod.ts";

// 같은 버전 = 이 글이 같다. source(commit, dirty)는 뺀다: commit이 달라도 같은 구성이다.
// components는 trial.components가 있으면 그것을, 없으면 run.components(합집합)를 쓴다.
export function versionKey(run: RunRecord, trial: TrialResult): string {
  const refs = [
    run.scenario,
    ...run.materials,
    ...(trial.components ?? run.components),
    run.core,
    ...run.grader.criteria,
    ...(run.grader.judge ? [run.grader.judge] : []),
    run.grader.checks,
  ].map(refText).sort();
  return [...refs, `model:${run.model}`].join("\n");
}

// 같은 버전에서 trial끼리 pass와 fail이 갈린 적이 있는 시나리오 id. 채점 대기는 세지 않는다.
// 시나리오 n이 지금과 다른 run은 센 적 없다: 시나리오를 고치면 다른 시나리오다.
export function flakyScenarios(
  runs: RunRecord[],
  scenarios: { id: string; n: number }[],
): Set<string> {
  const flaky = new Set<string>();
  for (const { id, n } of scenarios) {
    const groups = new Map<string, Set<string>>();
    for (const run of runs) {
      if (run.scenario.name !== id || run.scenario.n !== n) continue;
      for (const trial of run.trials) {
        const state = outcomeOf(trial, run.components).state;
        if (state === "pending") continue;
        const key = versionKey(run, trial);
        const seen = groups.get(key) ?? new Set<string>();
        seen.add(state);
        groups.set(key, seen);
      }
    }
    if ([...groups.values()].some((s) => s.size === 2)) flaky.add(id);
  }
  return flaky;
}
