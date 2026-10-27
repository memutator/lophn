import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import { type RunRecord } from "../../types.ts";
import type { Current } from "../../scorecard/pick.ts";
import type { ExperimentSpec, PlanEntry, Role } from "../spec/mod.ts";
import { baselineOf, baselineOutcomes } from "./baseline.ts";

export type Plan = {
  entries: PlanEntry[];
  keep: { scenario: string; runs: string[] }[]; // X를 보지 않은 valid run. 다시 돌리지 않는다
  excluded: { scenario: string; reason: string }[]; // 낡아서 기준이 못 된 것
};

const ROLE_ORDER: Record<Role, number> = { target: 0, case: 1, guard: 2 };
const byScenario = (a: { scenario: string }, b: { scenario: string }) =>
  a.scenario.localeCompare(b.scenario);

// current는 기준(main) checkout의 currentVersions로 만든 것이다. variant의 것이 아니다.
export function selectRuns(
  spec: ExperimentSpec,
  runs: RunRecord[],
  current: Current,
): Result<Plan> {
  const { from } = spec.change;
  const now = current.versions.get(`${from.kind}:${from.name}`);
  if (now?.n !== from.n) {
    return err({
      code: "conflict",
      message: `${from.kind}:${from.name}@${from.n} is not the base checkout version (${
        now ? `@${now.n}` : "absent"
      })`,
    });
  }

  const problems: { code: "conflict" | "invalid_input"; text: string }[] = [];
  const entries: PlanEntry[] = [];
  const keep: Plan["keep"] = [];
  const excluded: Plan["excluded"] = [];

  for (const scenario of current.scenarios) {
    const b = baselineOf(runs, scenario, current, from);
    const target = spec.target.find((g) => g.scenario === scenario.id);
    const kase = spec.cases.find((g) => g.scenario === scenario.id);
    const role: Role | null = target
      ? "target"
      : kase
        ? "case"
        : b.saw.length > 0
          ? "guard"
          : null;

    if (role === null) {
      if (b.valid.length > 0) {
        keep.push({ scenario: scenario.id, runs: b.valid.map((r) => r.id) });
      } else if (b.stale_saw.length > 0) {
        excluded.push({
          scenario: scenario.id,
          reason: b.stale_saw[0].reasons.slice(0, 2).join("; "),
        });
      }
      continue;
    }

    if (target && b.saw.length === 0) {
      problems.push(
        b.valid.length === 0
          ? {
              code: "conflict",
              text: `target ${scenario.id}: no baseline run. Run \`deno task eval --scenario ${scenario.id}\` first`,
            }
          : {
              code: "invalid_input",
              text: `target ${scenario.id}: no run saw ${from.kind}:${from.name}@${from.n}. The hypothesis does not reach this scenario`,
            },
      );
      continue;
    }

    entries.push({
      scenario: scenario.id,
      n: scenario.n,
      role,
      checks: (target ?? kase)?.checks ?? null,
      baseline_runs: b.saw.map((r) => r.id),
      baseline: baselineOutcomes(b.saw, from),
    });
  }

  // target이나 case가 지금 checkout에 없으면 조용히 빠지지 않게 한다.
  for (const g of [...spec.target, ...spec.cases]) {
    if (!current.scenarios.some((s) => s.id === g.scenario)) {
      problems.push({
        code: "invalid_input",
        text: `scenario ${g.scenario} not found`,
      });
    }
  }

  if (problems.length > 0) {
    return err({
      code: problems[0].code,
      message: problems[0].text,
      details: { problems: problems.map((p) => p.text) },
    });
  }
  entries.sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byScenario(a, b),
  );
  return ok({
    entries,
    keep: keep.sort(byScenario),
    excluded: excluded.sort(byScenario),
  });
}
