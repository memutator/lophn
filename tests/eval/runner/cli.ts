import { parseArgs } from "node:util";
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../packages/base/mod.ts";
import { validateFixtures } from "../checks/mod.ts";
import { loadCriterion } from "../criteria/mod.ts";
import { loadJudgeDefinition } from "../judge/mod.ts";
import { readAnthropicKey } from "../provider/mod.ts";
import {
  MATERIALS_ROOT,
  orderMaterials,
  verifyMaterial,
} from "../restore/manifest.ts";
import {
  parseRef,
  refText,
  type RunRecord,
  type Scenario,
  type TrialResult,
  type VersionRef,
} from "../types.ts";
import {
  captureSource,
  checksVersion,
  coreVersion,
  criterionContent,
  hashText,
  judgeContent,
  registerAuthored,
  scenarioHash,
} from "../versions/mod.ts";
import { createCap } from "./cap.ts";
import { type Discovered, discoverScenarios } from "./discover.ts";
import { runTrial } from "./trial.ts";
import { runTrials } from "./trials.ts";

const REGISTRY_DIR = new URL("../registry", import.meta.url).pathname;
const RUNS_DIR = new URL("../runs", import.meta.url).pathname;
// 전체 기록. worktree 루트의 .dev-data다.
const EVAL_DIR = new URL("../../../.dev-data/eval", import.meta.url).pathname;

const USAGE =
  "사용법: deno task eval (--scenario <id> [--scenario <id>...] | --all) [--model <name>] [--trials N] [--budget <usd>]";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function passed(trial: TrialResult): boolean {
  return trial.settle.kind === "idle" && trial.checks.every((c) => c.pass);
}

// 재료 hash를 확인하고 시나리오, 재료, criterion, judge를 registry에 올린다. 문제를 모아 돌려준다.
async function registerAll(selected: Discovered[]): Promise<{
  problems: string[];
  materials: Map<string, VersionRef[]>;
}> {
  const problems: string[] = [];
  const materials = new Map<string, VersionRef[]>();
  const register = async (
    ref: VersionRef,
    hash: string,
    content?: string,
  ) => {
    const result = await registerAuthored(REGISTRY_DIR, ref, hash, content);
    if (!result.ok) problems.push(result.error.message);
  };

  for (const { scenario, path } of selected) {
    await register(
      { kind: "scenario", name: scenario.id, n: scenario.n },
      await scenarioHash(path),
    );
    const ordered = await orderMaterials(MATERIALS_ROOT, scenario.world);
    if (!ordered.ok) {
      problems.push(`${scenario.id}: ${ordered.error.message}`);
      continue;
    }
    const refs: VersionRef[] = [];
    for (const material of ordered.value) {
      const verified = await verifyMaterial(material);
      if (!verified.ok) {
        problems.push(
          `${verified.error.message}. 내용이 바뀌었다. n을 올려라`,
        );
        continue;
      }
      const ref = parseRef(material.ref, "material");
      refs.push(ref);
      await register(ref, material.manifest.content_hash);
    }
    materials.set(scenario.id, refs);
    for (const check of scenario.checks) {
      if (check.kind !== "judge") continue;
      const criterion = await loadCriterion(check.criterion);
      const content = criterionContent(criterion);
      await register(
        parseRef(check.criterion, "criterion"),
        await hashText(content),
        content,
      );
    }
  }
  if (selected.some((s) => s.scenario.checks.some((c) => c.kind === "judge"))) {
    const judge = await loadJudgeDefinition();
    const content = judgeContent(judge);
    await register(
      { kind: "judge", name: "judge", n: judge.n },
      await hashText(content),
      content,
    );
  }
  return { problems, materials };
}

function hasJudge(scenario: Scenario): boolean {
  return scenario.checks.some((c) => c.kind === "judge");
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
      },
    }));
  } catch (error) {
    console.log(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const trials = Number(values.trials);
  const budget = Number(values.budget);
  if (!Number.isInteger(trials) || trials < 1 || !(budget > 0)) {
    console.log(
      `--trials는 1 이상 정수, --budget은 0보다 커야 한다.\n${USAGE}`,
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

  const core = await coreVersion();
  const checks = await checksVersion();
  const source = await captureSource();
  const judge = await loadJudgeDefinition();
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const cap = createCap(budget);
  let stoppedByCap = false;

  for (const { scenario } of selected) {
    const runId = ids.newId("run");
    const started_at = systemClock.now();
    const deps = {
      clock: systemClock,
      sleep,
      key,
      model: values.model!,
      runId,
      evalDir: EVAL_DIR,
      source,
      judge,
      log: console.log,
    };
    let outcomes;
    try {
      ({ outcomes, stoppedByCap } = await runTrials(
        trials,
        (index) => runTrial(deps, scenario, index),
        cap,
      ));
    } catch (error) {
      console.log(
        `${scenario.id}: 멈춤: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 1;
    }
    if (outcomes.length === 0) break;

    const results = outcomes.map((o) => o.result);
    const components = new Map<string, VersionRef>();
    for (const o of outcomes) {
      for (const ref of o.components) components.set(refText(ref), ref);
    }
    const criteria = scenario.checks.flatMap((c) =>
      c.kind === "judge" ? [parseRef(c.criterion, "criterion")] : []
    );
    const record: RunRecord = {
      id: runId,
      started_at,
      scenario: { kind: "scenario", name: scenario.id, n: scenario.n },
      materials: materials.get(scenario.id) ?? [],
      components: [...components.entries()].sort(([a], [b]) => a < b ? -1 : 1)
        .map(([, ref]) => ref),
      core,
      grader: {
        criteria,
        judge: hasJudge(scenario)
          ? { kind: "judge", name: "judge", n: judge.n }
          : null,
        checks,
      },
      model: values.model!,
      source: { commit: source.commit, dirty: source.dirty },
      trials: results,
    };
    await Deno.mkdir(RUNS_DIR, { recursive: true });
    await Deno.writeTextFile(
      `${RUNS_DIR}/${runId}.json`,
      JSON.stringify(record, null, 2) + "\n",
    );

    const failed = [
      ...new Set(
        results.flatMap((t) =>
          t.checks.filter((c) => !c.pass).map((c) => c.id)
        ),
      ),
    ];
    const cost = results.reduce(
      (sum, t) =>
        sum + t.metrics.cost_usd + t.judge.reduce((s, j) => s + j.cost_usd, 0),
      0,
    );
    console.log(
      `${scenario.id}@${scenario.n}: ${
        results.filter(passed).length
      }/${results.length} trial 통과, 떨어진 check ${
        failed.length === 0 ? "없음" : failed.join(", ")
      }, $${cost.toFixed(4)} (${runId})`,
    );
    if (stoppedByCap) break;
  }
  console.log(
    `합계 $${cap.total().toFixed(4)} / 상한 $${budget}${
      stoppedByCap ? ": 상한에 걸려 멈췄다" : ""
    }`,
  );
  return 0;
}
