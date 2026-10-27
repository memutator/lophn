import {
  err,
  type LophnError,
  ok,
  type Result,
} from "../../../../packages/base/mod.ts";
import type { RunRecord, VersionRef } from "../../types.ts";
import type { ExperimentSpec } from "./types.ts";

export type SpecContext = {
  scenarios: { id: string; n: number; checks: { id: string }[] }[]; // 지금 checkout의 시나리오
  runs: RunRecord[]; // tests/eval/runs/*.json
  versions: Map<string, VersionRef>; // 기준(main) checkout의 currentVersions. 키 `${kind}:${name}`
};

type Problem = { code: LophnError["code"]; text: string };

// 모양은 맞아도 지금 repo와 어긋날 수 있다. 문제를 모두 모으고 code는 첫 문제의 것이다.
export function checkSpecAgainst(
  spec: ExperimentSpec,
  ctx: SpecContext,
): Result<void> {
  const found: Problem[] = [];
  const add = (code: Problem["code"], text: string) =>
    found.push({ code, text });

  for (const [label, goals] of [
    ["target", spec.target],
    ["cases", spec.cases],
  ] as const) {
    for (const g of goals) {
      const scenario = ctx.scenarios.find((s) => s.id === g.scenario);
      if (!scenario) {
        add("not_found", `${label}: scenario ${g.scenario} not found`);
        continue;
      }
      for (const id of g.checks ?? []) {
        if (!scenario.checks.some((c) => c.id === id)) {
          add("invalid_input", `${label}: check ${id} not in ${g.scenario}`);
        }
      }
    }
  }

  const { from } = spec.change;
  const run = ctx.runs.find((r) => r.id === spec.start_run);
  if (!run) {
    add("not_found", `start_run ${spec.start_run} not found`);
  } else {
    if (run.model !== spec.model) {
      add(
        "invalid_input",
        `start_run model ${run.model} differs from ${spec.model}`,
      );
    }
    if (!spec.target.some((g) => g.scenario === run.scenario.name)) {
      add(
        "invalid_input",
        `start_run scenario ${run.scenario.name} is not a target`,
      );
    }
    if (
      !run.components.some(
        (c) => c.kind === from.kind && c.name === from.name && c.n === from.n,
      )
    ) {
      add(
        "invalid_input",
        `start_run did not see ${from.kind}:${from.name}@${from.n}`,
      );
    }
  }

  const current = ctx.versions.get(`${from.kind}:${from.name}`);
  if (!current || current.n !== from.n) {
    add(
      "conflict",
      `${from.kind}:${from.name}@${from.n} is not the base checkout version (${
        current ? `@${current.n}` : "absent"
      })`,
    );
  }

  if (found.length === 0) return ok(undefined);
  return err({
    code: found[0].code,
    message: `spec does not match this checkout: ${found[0].text}`,
    details: { problems: found.map((p) => p.text) },
  });
}
