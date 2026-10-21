import { type Pool, trialKindOf } from "../experiment/parallel/mod.ts";
import { outcomeOf } from "../experiment/spec/mod.ts";
import { foldJudge, readPending } from "../judge/mod.ts";
import {
  parseRef,
  refText,
  type RunRecord,
  type Scenario,
  type TrialResult,
  type VersionRef,
} from "../types.ts";
import { runTrial, type TrialDeps, type TrialOutcome } from "./trial.ts";

export type ScenarioArgs = {
  scenario: Scenario;
  runId: string;
  deps: Omit<TrialDeps, "runId" | "saved">;
  pool: Pool;
  // 지금까지 끝난 결과를 보고 더 돌릴 trial 수. 0이면 끝이다.
  next(results: TrialResult[]): number;
  materials: VersionRef[];
  core: VersionRef;
  checks: VersionRef;
  runsDir: string;
};

export type ScenarioRun = {
  record: RunRecord | null; // 끝난 trial이 하나도 없으면 null
  saved: { name: string; n: number }[];
  failed: string | null; // trial이 던져 멈춘 이유
};

// "pass" | "fail (check-id)" | "pending (check-id)"
export function trialLine(trial: TrialResult): string {
  const state = outcomeOf(trial, []).state;
  if (state === "pass") return "pass";
  const ids = state === "pending"
    ? trial.checks.filter((c) => c.pending).map((c) => c.id)
    : trial.checks.filter((c) => !c.pass && !c.pending).map((c) => c.id);
  if (trial.settle.kind !== "idle") ids.unshift("timeout");
  return `${state} (${ids.join(", ")})`;
}

// 시나리오 하나의 trial을 pool로 돌려 run 하나로 묶는다. 한 번에 next개를 내고, 끝난 만큼 보고 다시 묻는다.
export async function runScenario(args: ScenarioArgs): Promise<ScenarioRun> {
  const { scenario, runId, pool, deps } = args;
  const saved: { name: string; n: number }[] = [];
  const trialDeps: TrialDeps = { ...deps, runId, saved };
  const startedAt = deps.clock.now();
  const outcomes: TrialOutcome[] = [];
  const kind = trialKindOf(scenario);
  let failed: string | null = null;
  let index = 0;

  for (let count = args.next([]); count > 0;) {
    const round = Array.from({ length: count }, () => {
      const i = index++;
      const id = `${scenario.id}#${i}`;
      return pool.submit({
        id,
        kind,
        run: async () => {
          deps.log(`[trial] ${id} start`);
          const outcome = await runTrial(trialDeps, scenario, i);
          const { result } = outcome;
          deps.log(
            `[trial] ${id} ${trialLine(result)} $${
              result.metrics.cost_usd.toFixed(3)
            }`,
          );
          return { value: outcome, cost_usd: result.metrics.cost_usd };
        },
      });
    });
    let skipped = false;
    for (const done of await Promise.all(round)) {
      if (done.status === "done") outcomes.push(done.value);
      else if (done.status === "failed") {
        failed ??= `${scenario.id}: 멈춤: ${done.error}`;
      } else skipped = true;
    }
    // 멈춘 pool은 새 job을 바로 건너뛰므로 다시 물으면 끝나지 않는다.
    if (failed !== null || skipped) break;
    count = args.next(outcomes.map((o) => o.result));
  }
  if (failed !== null) deps.log(failed);
  if (outcomes.length === 0) return { record: null, saved, failed };
  outcomes.sort((a, b) => a.result.index - b.result.index);

  if (outcomes.some((o) => o.result.metrics.unpriced_calls > 0)) {
    deps.log("비용 모르는 call 있음: 합계 비용이 모자랄 수 있다");
  }
  const components = new Map<string, VersionRef>();
  for (const o of outcomes) {
    for (const ref of o.components) components.set(refText(ref), ref);
  }
  const hasJudge = scenario.checks.some((c) => c.kind === "judge");
  const record: RunRecord = {
    id: runId,
    started_at: startedAt,
    scenario: { kind: "scenario", name: scenario.id, n: scenario.n },
    materials: args.materials,
    components: [...components.entries()].sort(([a], [b]) => a < b ? -1 : 1)
      .map(([, ref]) => ref),
    core: args.core,
    grader: {
      criteria: scenario.checks.flatMap((c) =>
        c.kind === "judge" ? [parseRef(c.criterion, "criterion")] : []
      ),
      judge: hasJudge
        ? { kind: "judge", name: "judge", n: deps.judge.n }
        : null,
      checks: args.checks,
    },
    model: deps.model,
    ...(deps.effort === undefined ? {} : { effort: deps.effort }),
    source: { commit: deps.source.commit, dirty: deps.source.dirty },
    // 이미 들어온 채점을 합쳐 쓴다. 요약이 없던 사이에 들어온 채점은 foldRun이 못 합친다.
    trials: foldJudge(
      outcomes.map((o) => o.result),
      await readPending(deps.evalDir, runId),
    ),
  };
  await Deno.mkdir(args.runsDir, { recursive: true });
  await Deno.writeTextFile(
    `${args.runsDir}/${runId}.json`,
    JSON.stringify(record, null, 2) + "\n",
  );
  return { record, saved, failed };
}
