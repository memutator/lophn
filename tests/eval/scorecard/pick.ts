import { sumMetrics } from "../collect/mod.ts";
import {
  parseRef,
  type RunRecord,
  type Scenario,
  type ScorecardRow,
  type VersionRef,
} from "../types.ts";

export type Current = {
  scenarios: Pick<Scenario, "id" | "n" | "proposal" | "world" | "checks">[]; // 지금 checkout의 시나리오
  versions: Map<string, VersionRef>; // ev-versions의 currentVersions
  judge: VersionRef | null; // 지금 judge. 없으면 judge check를 비교하지 않는다
  model: string; // 기준 model 이름
};

// 이름이 같은 두 목록에서 n이 바뀐(또는 한쪽에만 있는) 것을 `label name@a → name@b`로 쓴다.
export function versionChanges(
  label: string,
  a: VersionRef[],
  b: VersionRef[],
): string[] {
  const before = new Map(a.map((r) => [r.name, r.n]));
  const after = new Map(b.map((r) => [r.name, r.n]));
  const out: string[] = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(name);
    const y = after.get(name);
    if (x === y) continue;
    out.push(
      `${label} ${x === undefined ? "없음" : `${name}@${x}`} → ${
        y === undefined ? "없음" : `${name}@${y}`
      }`,
    );
  }
  return out;
}

// 낡은 이유 목록. 비어 있으면 유효하다.
export function staleReasons(
  run: RunRecord,
  scenario: Current["scenarios"][number],
  current: Current,
): string[] {
  const reasons: string[] = [];
  if (run.scenario.n !== scenario.n) {
    reasons.push(`scenario ${scenario.id}@${run.scenario.n} → @${scenario.n}`);
  }
  reasons.push(
    ...versionChanges(
      "materials",
      run.materials,
      scenario.world.map((w) => parseRef(w, "material")),
    ),
  );

  const judgeChecks = scenario.checks.flatMap((c) =>
    c.kind === "judge" ? [c] : [],
  );
  reasons.push(
    ...versionChanges(
      "criterion",
      run.grader.criteria,
      judgeChecks.map((c) => parseRef(c.criterion, "criterion")),
    ),
  );
  // judge check가 없는 시나리오는 judge가 바뀌어도 결과가 같다.
  if (
    judgeChecks.length > 0 &&
    current.judge !== null &&
    run.grader.judge?.n !== current.judge.n
  ) {
    reasons.push(
      `judge judge@${run.grader.judge?.n ?? "없음"} → @${current.judge.n}`,
    );
  }
  const checks = current.versions.get("checks:checks");
  if (checks !== undefined && run.grader.checks.n !== checks.n) {
    reasons.push(`checks@${run.grader.checks.n} → @${checks.n}`);
  }

  for (const c of run.components) {
    if (c.kind === "model") {
      if (c.name !== current.model) {
        reasons.push(`model ${c.name} → ${current.model}`);
      }
      continue;
    }
    const now = current.versions.get(`${c.kind}:${c.name}`);
    if (now !== undefined && now.n !== c.n) {
      reasons.push(`${c.kind}:${c.name}@${c.n} → @${now.n}`);
    }
  }
  const core = current.versions.get("core:core");
  if (core !== undefined && run.core.n !== core.n) {
    reasons.push(`core@${run.core.n} → @${core.n}`);
  }
  return reasons;
}

function rowOf(
  run: RunRecord,
  scenario: Current["scenarios"][number],
  stale: string[],
): ScorecardRow {
  const checks = new Map<string, ScorecardRow["checks"][number]>();
  for (const t of run.trials) {
    for (const c of t.checks) {
      let row = checks.get(c.id);
      if (row === undefined) {
        row = { id: c.id, kind: c.kind, passed: 0, of: 0, reasons: [] };
        checks.set(c.id, row);
      }
      row.of += 1;
      if (c.pass) row.passed += 1;
      else if (row.reasons.length < 3 && !row.reasons.includes(c.reason)) {
        row.reasons.push(c.reason);
      }
    }
  }
  return {
    scenario: { kind: "scenario", name: scenario.id, n: scenario.n },
    proposal: scenario.proposal,
    run: run.id,
    stale,
    passed: run.trials.filter((t) => t.checks.every((c) => c.pass)).length,
    trials: run.trials.length,
    checks: [...checks.values()],
    metrics: sumMetrics(run.trials.map((t) => t.metrics)),
  };
}

// current.scenarios 순서. 시나리오마다 유효한 가장 늦은 run, 없으면 가장 늦은 run(낡음 표시).
export function pickRows(runs: RunRecord[], current: Current): ScorecardRow[] {
  return current.scenarios.map((scenario) => {
    const mine = runs
      .filter((r) => r.scenario.name === scenario.id)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map((run) => ({ run, stale: staleReasons(run, scenario, current) }));
    const picked = mine.find((m) => m.stale.length === 0) ?? mine[0];
    if (picked === undefined) {
      return {
        scenario: { kind: "scenario", name: scenario.id, n: scenario.n },
        proposal: scenario.proposal,
        run: null,
        stale: ["run 없음"],
        passed: 0,
        trials: 0,
        checks: [],
        metrics: null,
      };
    }
    return rowOf(picked.run, scenario, picked.stale);
  });
}
