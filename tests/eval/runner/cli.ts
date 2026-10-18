import { dirname } from "node:path";
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
import { codingTotals } from "../coding/metrics/mod.ts";
import {
  isCodingAgent,
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
import { TRIAL_CAP_USD } from "./spend.ts";
import { runTrial, type TrialDeps } from "./trial.ts";
import { runTrials } from "./trials.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const REGISTRY_DIR = new URL("../registry", import.meta.url).pathname;
const RUNS_DIR = new URL("../runs", import.meta.url).pathname;
// 전체 기록. worktree 루트의 .dev-data다.
const EVAL_DIR = new URL("../../../.dev-data/eval", import.meta.url).pathname;

// 짧은 전용 폴더. unix socket 경로가 108자를 넘지 않고, 사람이 Claude Code에서 한 번 신뢰하면 그 아래 trial 폴더마다 folder trust가 안 뜬다.
const EVAL_TMP = "/tmp/lophn-eval";

const USAGE =
  "사용법: deno task eval (--scenario <id> [--scenario <id>...] | --all) [--model <name>] [--trials N] [--budget <usd>] [--trial-budget <usd>]";

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

// 사람이 hook을 개발 형태로 한 번 설치하는 checkout. worktree가 아니라 주 checkout이다(worktree는 지워진다).
async function mainCheckout(): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: REPO_ROOT,
    stdout: "piped",
  }).output();
  return dirname(new TextDecoder().decode(out.stdout).trim());
}

// 새 폴더마다 Claude Code가 folder trust를 묻는다. 사람이 TMPDIR를 정했으면 건드리지 않는다.
async function useEvalTmp(): Promise<void> {
  if (Deno.env.get("TMPDIR")) return;
  const made = await Deno.stat(EVAL_TMP).then(() => false, () => true);
  await Deno.mkdir(EVAL_TMP, { recursive: true });
  Deno.env.set("TMPDIR", EVAL_TMP);
  if (made) {
    console.log(
      `${EVAL_TMP}를 만들었다. Claude Code에서 이 폴더를 한 번 열어 신뢰한다(그 아래 trial 폴더에는 folder trust 질문이 안 뜬다)`,
    );
  }
}

function codingLines(
  results: TrialResult[],
  saved: { name: string; n: number }[],
): string[] {
  const lines: string[] = [];
  const terminals = results.flatMap((t) => t.coding ?? []);
  if (terminals.length > 0) {
    const totals = codingTotals(terminals.map((t) => ({ ...t, tail: "" })));
    const minutes = terminals.reduce(
      (sum, t) =>
        t.opened_at === null || t.ended_at === null
          ? sum
          : sum + (Date.parse(t.ended_at) - Date.parse(t.opened_at)) / 60_000,
      0,
    );
    const tokens = totals === null
      ? "token 모름"
      : `token input ${totals.input} output ${totals.output} cache read ${totals.cache_read}`;
    const permissions = terminals.reduce(
      (n, t) => n + t.permission_requests,
      0,
    );
    lines.push(
      `  coding: ${tokens}, 터미널 ${terminals.length}개 ${
        minutes.toFixed(1)
      }분, permission 물음 ${permissions}, 사람 개입: ${
        terminals.some((t) => t.human_input) ? "있음" : "없음"
      }`,
    );
  }
  const humans = results.flatMap((t) => t.human ?? []);
  if (humans.length > 0) {
    const sum = (pick: (h: (typeof humans)[number]) => number) =>
      humans.reduce((n, h) => n + pick(h), 0);
    lines.push(
      `  사람 역할: 답한 질문 ${sum((h) => h.answered)}(default ${
        sum((h) => h.fallback)
      }), 결정 ${sum((h) => h.decisions)}, $${
        sum((h) => h.cost_usd).toFixed(4)
      }`,
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

  const coding = selected.some((s) => s.scenario.real.some(isCodingAgent));
  if (coding) {
    await useEvalTmp();
    if (trials > 1) {
      console.log("coding 시나리오의 trial은 차례로만 돈다(병렬은 아직 없다)");
    }
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
  const repoRoot = REPO_ROOT;
  const hookRoot = coding ? await mainCheckout() : repoRoot;

  for (const { scenario } of selected) {
    const runId = ids.newId("run");
    const started_at = systemClock.now();
    const saved: { name: string; n: number }[] = [];
    const deps: TrialDeps = {
      clock: systemClock,
      sleep,
      key,
      model: values.model!,
      runId,
      evalDir: EVAL_DIR,
      source,
      judge,
      log: console.log,
      registryDir: REGISTRY_DIR,
      trialBudgetUsd: trialBudget,
      repoRoot,
      hookRoot,
      binDir: `${EVAL_DIR}/bin`,
      home: Deno.env.get("HOME") ?? "",
      saved,
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
        sum + t.metrics.cost_usd + t.judge.reduce((s, j) => s + j.cost_usd, 0) +
        (t.human?.cost_usd ?? 0),
      0,
    );
    const lines = codingLines(results, saved);
    console.log(
      `${scenario.id}@${scenario.n}: ${
        results.filter(passed).length
      }/${results.length} trial 통과, 떨어진 check ${
        failed.length === 0 ? "없음" : failed.join(", ")
      }, $${cost.toFixed(4)} (${runId})${
        lines.length === 0 ? "" : `\n${lines.join("\n")}`
      }`,
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
