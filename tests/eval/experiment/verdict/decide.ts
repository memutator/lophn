import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import { refText, type VersionRef } from "../../types.ts";
import type { ExperimentResult, ScenarioResult, Tally } from "../spec/mod.ts";
import { costOf, decisionOf, judgeEntry } from "./rule.ts";
import type { VerdictEntry, VerdictInput } from "./types.ts";

const sameRef = (a: VersionRef, b: VersionRef) =>
  a.kind === b.kind && a.name === b.name && a.n === b.n;

const frac = (t: Tally) => `${t.passed}/${t.trials}`;

function noteOf(
  e: VerdictEntry,
  status: ScenarioResult["status"],
  weaker: boolean,
  vt: Tally,
  bt: Tally,
): string {
  const pend = (
    t: Tally,
  ) => (t.pending > 0 ? ` (+${t.pending} 채점 대기)` : "");
  const head = `variant ${frac(vt)}${pend(vt)}, baseline ${frac(bt)}${
    pend(bt)
  }`;
  const why = {
    ok: e.role === "target"
      ? "나아졌다"
      : weaker
      ? "통과율이 기준보다 낮다"
      : "통과",
    fail: "통과하지 못했다",
    not_improved: "나아지지 않았다",
    worse: "나빠졌다",
    incomplete: e.remaining > 0
      ? `끝나지 않았다(남은 trial ${e.remaining})`
      : "끝나지 않았다",
  }[status];
  return `${head}: ${why}`;
}

export function decide(input: VerdictInput): Result<ExperimentResult> {
  const { spec, entries } = input;

  const main = input.changed.find((c) => sameRef(c.from, spec.change.from));
  if (!main) {
    return err({
      code: "conflict",
      message: `variant에서 ${refText(spec.change.from)}가 바뀌지 않았다`,
    });
  }
  const goals = [
    ...spec.target.map((g) => ({ ...g, role: "target" as const })),
    ...spec.cases.map((g) => ({ ...g, role: "case" as const })),
  ];
  for (const g of goals) {
    const e = entries.find((x) =>
      x.scenario === g.scenario && x.role === g.role
    );
    if (!e) {
      return err({
        code: "invalid_input",
        message: `${g.role} ${g.scenario}의 entry가 없다`,
      });
    }
    if (g.role === "target" && e.baseline.length === 0) {
      return err({
        code: "invalid_input",
        message: `target ${g.scenario}에 기준이 없다. 나아졌는지 알 수 없다`,
      });
    }
  }

  const judged = entries.map((e) => ({ e, j: judgeEntry(e) }));
  const scenarios: ScenarioResult[] = judged.map(({ e, j }) => ({
    scenario: e.scenario,
    n: e.n,
    role: e.role,
    checks: e.checks,
    baseline_runs: e.baseline_runs,
    baseline: j.bt,
    variant_runs: e.variant_runs,
    variant: j.vt,
    remaining: e.remaining,
    status: j.status,
    weaker: j.weaker,
    note: noteOf(e, j.status, j.weaker, j.vt, j.bt),
  }));
  const decision = decisionOf(scenarios.map((s) => s.status));

  const summary = (["target", "case", "guard"] as const).map((role) => {
    const of = scenarios.filter((s) => s.role === role);
    return `${role} ${
      of.filter((s) => s.status === "ok").length
    }/${of.length} ok`;
  }).join(", ");
  const weakerCount = scenarios.filter((s) => s.weaker).length;
  const reasons = [
    `${decision}: ${summary}${
      weakerCount > 0 ? ` (weaker ${weakerCount})` : ""
    }`,
    ...scenarios.filter((s) => s.status !== "ok" || s.weaker)
      .map((s) => `${s.role} ${s.scenario}: ${s.note}`),
  ];
  if (decision === "inconclusive") {
    for (const s of scenarios) {
      const n = s.variant.pending +
        (s.role !== "case" && s.baseline.trials === 0 ? s.baseline.pending : 0);
      if (n > 0) {
        reasons.push(
          `채점 대기: ${s.scenario} ${n}건. \`deno task eval:judge\`로 채점한 뒤 이어 돌린다`,
        );
      }
    }
  }

  const mixed = input.changed.length !== 1;
  if (refText(main.to) !== refText(spec.change.to)) {
    reasons.push(
      `spec의 to는 ${refText(spec.change.to)}인데 variant는 ${
        refText(main.to)
      }이다`,
    );
  }
  if (mixed) {
    const rest = input.changed.filter((c) => c !== main)
      .map((c) => `${refText(c.from)}→${refText(c.to)}`);
    reasons.push(`섞인 변경이다: ${rest.join(", ")}`);
  }
  if (input.stopped_by_budget) {
    reasons.push(`예산 $${spec.budget_usd}에서 멈췄다`);
  }
  if (input.excluded.length > 0) {
    reasons.push(
      `기준이 낡아 빠진 시나리오 ${input.excluded.length}개: ${
        input.excluded.map((x) => x.scenario).join(", ")
      }`,
    );
  }

  const result: ExperimentResult = {
    id: spec.id,
    decision,
    rule: spec.judgment.rule,
    spec_hash: input.spec_hash,
    spec_commit: input.spec_commit,
    changed: input.changed.map((c) => ({
      from: refText(c.from),
      to: refText(c.to),
    })),
    mixed,
    scenarios,
    keep: input.keep,
    excluded: input.excluded,
    reasons,
    cost_usd: entries.reduce((sum, e) => sum + costOf(e.variant), 0),
    stopped_by_budget: input.stopped_by_budget,
    decided_at: input.decided_at,
  };
  if (input.overfit) result.overfit = input.overfit;
  if (input.repeats) result.repeats = input.repeats;
  if (input.assembly) result.assembly = input.assembly;
  return ok(result);
}
