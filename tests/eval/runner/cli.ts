import { parseArgs } from "node:util";
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../packages/base/mod.ts";
import { validateFixtures } from "../checks/mod.ts";
import { loadCriterion } from "../criteria/mod.ts";
import { createPool } from "../experiment/parallel/mod.ts";
import { REPEAT_KIND } from "../experiment/repeat/mod.ts";
import { outcomeOf } from "../experiment/spec/mod.ts";
import { resolveVariant } from "../experiment/variant/mod.ts";
import { loadJudgeDefinition } from "../judge/mod.ts";
import { readAnthropicKey } from "../provider/mod.ts";
import type { TrialResult } from "../types.ts";
import { captureSource, checksVersion, coreVersion } from "../versions/mod.ts";
import { createCap } from "./cap.ts";
import { trialDepsOf } from "./deps.ts";
import { type Discovered, discoverScenarios } from "./discover.ts";
import { REPO_ROOT, RUNS_DIR } from "./paths.ts";
import { registerAll } from "./register.ts";
import { runScenario, type ScenarioRun } from "./scenario.ts";
import { installSignals } from "./signals.ts";
import { TRIAL_CAP_USD } from "./spend.ts";

const USAGE =
  "사용법: deno task eval (--scenario <id> [--scenario <id>...] | --all) [--model <name>] [--trials N] [--budget <usd>] [--trial-budget <usd>] [--keep]";

// 채점 대기인 judge check는 떨어진 것이 아니다.
export function passed(trial: TrialResult): boolean {
  return outcomeOf(trial, []).state !== "fail";
}

function extraLines(
  results: TrialResult[],
  saved: { name: string; n: number }[],
): string[] {
  const lines: string[] = [];
  const humans = results.flatMap((t) => t.human ?? []);
  if (humans.length > 0) {
    const sum = (pick: (h: (typeof humans)[number]) => number) =>
      humans.reduce((n, h) => n + pick(h), 0);
    lines.push(
      `  사람 역할: 답한 질문 ${sum((h) => h.answered)}(default ${
        sum((h) => h.fallback)
      }), 결정 ${sum((h) => h.decisions)}`,
    );
  }
  if (saved.length > 0) {
    lines.push(`  후보: ${saved.map((s) => `${s.name}@${s.n}`).join(", ")}`);
  }
  return lines;
}

export async function main(args: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        scenario: { type: "string", multiple: true },
        all: { type: "boolean" },
        model: { type: "string", default: "claude-sonnet-5-5" },
        trials: { type: "string", default: "1" },
        budget: { type: "string", default: "50" },
        "trial-budget": { type: "string", default: String(TRIAL_CAP_USD) },
        keep: { type: "boolean" },
      },
    }));
  } catch (error) {
    console.log(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const trials = Number(values.trials);
  const budget = Number(values.budget);
  const trialBudget = Number(values["trial-budget"]);
  if (
    !Number.isInteger(trials) || trials < 1 || !(budget > 0) ||
    !(trialBudget > 0)
  ) {
    console.log(
      `--trials는 1 이상 정수, --budget과 --trial-budget은 0보다 커야 한다.\n${USAGE}`,
    );
    return 2;
  }
  const found = await discoverScenarios();
  let selected: Discovered[];
  if (values.all) {
    selected = found;
  } else if (values.scenario !== undefined) {
    selected = [];
    for (const id of values.scenario) {
      const hit = found.find((f) => f.scenario.id === id);
      if (hit === undefined) {
        console.log(
          `모르는 시나리오 ${id}. 있는 것: ${
            found.map((f) => f.scenario.id).join(", ")
          }`,
        );
        return 2;
      }
      selected.push(hit);
    }
  } else {
    console.log(USAGE);
    return 2;
  }

  const { problems, materials } = await registerAll(selected);
  const fixtures = await validateFixtures(selected.map((s) => s.scenario));
  problems.push(...fixtures.problems);
  if (problems.length > 0) {
    console.log(problems.join("\n"));
    return 1;
  }

  const key = readAnthropicKey(Deno.env);
  if (key === undefined) {
    console.log(
      "ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다. .env에 두면 돈다.",
    );
    return 0;
  }

  const variant = await resolveVariant({ current: REPO_ROOT });
  if (!variant.ok) {
    console.log(variant.error.message);
    return 1;
  }
  const core = await coreVersion(variant.value.versionDeps);
  const checks = await checksVersion(variant.value.graderDeps);
  const deps = trialDepsOf({
    key,
    model: values.model!,
    variant: variant.value,
    trialBudgetUsd: trialBudget,
    saveEnabled: true,
    keep: values.keep === true,
    source: await captureSource(variant.value.versionDeps),
    judge: await loadJudgeDefinition(),
    repeatCriterion: await loadCriterion(REPEAT_KIND),
  });
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const cap = createCap(budget, console.log);
  const pool = createPool({ budget: cap });
  const stopSignals = installSignals(pool, deps.live, console.log);

  const runs: (ScenarioRun & { scenario: Discovered["scenario"] })[] =
    await Promise.all(selected.map(async ({ scenario }) => ({
      scenario,
      ...await runScenario({
        scenario,
        runId: ids.newId("run"),
        deps,
        pool,
        next: (results) => results.length === 0 ? trials : 0,
        materials: materials.get(scenario.id) ?? [],
        core,
        checks,
        runsDir: RUNS_DIR,
      }),
    })));
  stopSignals();

  for (const { scenario, record, saved } of runs) {
    if (record === null) continue;
    const results = record.trials;
    const failed = [
      ...new Set(
        results.flatMap((t) =>
          t.checks.filter((c) => !c.pass && !c.pending).map((c) => c.id)
        ),
      ),
    ];
    const pending = results.reduce(
      (n, t) => n + t.checks.filter((c) => c.pending).length,
      0,
    );
    const cost = results.reduce((sum, t) => sum + t.metrics.cost_usd, 0);
    const lines = extraLines(results, saved);
    console.log(
      `${scenario.id}@${scenario.n}: ${
        results.filter(passed).length
      }/${results.length} trial 통과, 떨어진 check ${
        failed.length === 0 ? "없음" : failed.join(", ")
      }${
        pending > 0
          ? `, 채점 대기 ${pending}건(deno task eval:judge ${record.id})`
          : ""
      }, $${cost.toFixed(4)} (${record.id})${
        lines.length === 0 ? "" : `\n${lines.join("\n")}`
      }`,
    );
  }
  const halted = pool.halted();
  console.log(
    `합계 $${cap.total().toFixed(4)} / 상한 $${budget}${
      halted === "budget"
        ? ": 상한에 걸려 멈췄다"
        : halted === "stopped"
        ? ": 신호로 멈췄다"
        : ""
    }`,
  );
  return runs.some((r) => r.failed !== null) ? 1 : 0;
}
