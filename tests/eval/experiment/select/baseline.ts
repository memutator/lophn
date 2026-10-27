import type { RunRecord, VersionRef } from "../../types.ts";
import { type Current, staleReasons } from "../../scorecard/pick.ts";
import { type Outcome, outcomeOf } from "../spec/mod.ts";

export type Baseline = {
  valid: RunRecord[]; // staleReasons가 비어 있는 run. started_at 오름차순
  saw: RunRecord[]; // valid 가운데 X@a를 본 run
  stale_saw: { run: string; reasons: string[] }[]; // 낡았지만 X@a를 본 run. 가장 늦은 것 하나만
};

const same = (a: VersionRef, b: VersionRef) =>
  a.kind === b.kind && a.name === b.name && a.n === b.n;

// current는 기준(main) checkout의 것이다. 기준 구성은 main에서 잰 버전이라서다.
export function baselineOf(
  runs: RunRecord[],
  scenario: Current["scenarios"][number],
  current: Current,
  from: VersionRef,
): Baseline {
  const mine = runs
    .filter((r) => r.scenario.name === scenario.id)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((run) => ({ run, reasons: staleReasons(run, scenario, current) }));
  const sawFrom = (r: RunRecord) => r.components.some((c) => same(c, from));
  const valid = mine.filter((m) => m.reasons.length === 0).map((m) => m.run);
  const stale = mine.filter((m) => m.reasons.length > 0 && sawFrom(m.run));
  const latest = stale.at(-1);
  return {
    valid,
    saw: valid.filter(sawFrom),
    stale_saw: latest ? [{ run: latest.run.id, reasons: latest.reasons }] : [],
  };
}

// 쌓는 것은 saw run의 trial 가운데 X@a를 본 것이다. TrialResult.components가 없는 옛 요약은 run 합집합을 받아 trial이 모두 남는다.
export function baselineOutcomes(
  saw: RunRecord[],
  from: VersionRef,
): Outcome[] {
  return saw.flatMap((run) =>
    run.trials
      .map((t) => outcomeOf(t, run.components))
      .filter((o) => o.components.some((c) => same(c, from)))
      .sort((a, b) => a.index - b.index),
  );
}
