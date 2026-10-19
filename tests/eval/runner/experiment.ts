import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  type Result,
  systemClock,
} from "../../../packages/base/mod.ts";
import { validateFixtures } from "../checks/mod.ts";
import { loadCriterion } from "../criteria/mod.ts";
import {
  formatAssembly,
  loadRecordedTrial,
  measureAssembly,
} from "../experiment/assembly/mod.ts";
import {
  defaultGateDeps,
  type GateReport,
  runGate,
} from "../experiment/gate/mod.ts";
import { createPool, type Pool } from "../experiment/parallel/mod.ts";
import {
  findOverfit,
  formatWarnings,
  loadChangedText,
} from "../experiment/overfit/mod.ts";
import { REPEAT_KIND, type RepeatFinding } from "../experiment/repeat/mod.ts";
import {
  changedComponents,
  type Plan,
  selectRuns,
} from "../experiment/select/mod.ts";
import {
  type AssemblyReport,
  checkSpecAgainst,
  checkSpecLocked,
  EXPERIMENTS_DIR,
  type ExperimentSpec,
  type Outcome,
  outcomeOf,
  type OverfitWarning,
  readResult,
  readSpec,
} from "../experiment/spec/mod.ts";
import {
  estimateTrials,
  flakyScenarios,
  nextTrials,
} from "../experiment/trials/mod.ts";
import { recordVerdict, type VerdictEntry } from "../experiment/verdict/mod.ts";
import { resolveVariant, type Variant } from "../experiment/variant/mod.ts";
import { loadJudgeDefinition, outstanding, readPending } from "../judge/mod.ts";
import { readAnthropicKey } from "../provider/mod.ts";
import { MATERIALS_ROOT, orderMaterials } from "../restore/manifest.ts";
import {
  isCodingAgent,
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
  currentVersions,
} from "../versions/mod.ts";
import { readRuns } from "../scorecard/runs.ts";
import { checkChange } from "./change.ts";
import { createCap } from "./cap.ts";
import { trialDepsOf } from "./deps.ts";
import { type Discovered, discoverScenarios } from "./discover.ts";
import { collectLockFacts } from "./lock.ts";
import {
  EVAL_DIR,
  REGISTRY_DIR,
  REPO_ROOT,
  RUNS_DIR,
  useEvalTmp,
} from "./paths.ts";
import { registerAll } from "./register.ts";
import { createReplayPort } from "./replay.ts";
import { runScenario } from "./scenario.ts";
import { installSignals } from "./signals.ts";
import { TRIAL_CAP_USD } from "./spend.ts";
import { type Held, prepareTrialWorld, releaseWorld } from "./world.ts";

export type CommandOptions = {
  id: string;
  checkout?: string;
  base?: string;
};
export type ExperimentOptions = CommandOptions & {
  budget?: number;
  skipGate: boolean;
  prefixOnly: boolean;
};

const log = (line: string) => console.log(line);
const SPEC_DIR = `${REPO_ROOT}/${EXPERIMENTS_DIR}`;
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);

// spec 읽기부터 고르기까지. 돈이 안 든다.
type Begun = {
  spec: ExperimentSpec;
  hash: string;
  specCommit: string;
  variant: Variant;
  baseline: Map<string, VersionRef>;
  found: Discovered[];
  runs: RunRecord[];
  changed: { from: VersionRef; to: VersionRef }[];
  plan: Plan;
  judgeRef: VersionRef;
  scenarioOf: Map<string, Discovered>;
};

async function begin(opts: CommandOptions): Promise<Result<Begun>> {
  const read = await readSpec(SPEC_DIR, opts.id);
  if (!read.ok) return read;
  const { spec, hash } = read.value;

  const resolved = await resolveVariant({
    checkout: opts.checkout,
    current: REPO_ROOT,
  });
  if (!resolved.ok) return resolved;
  const variant = resolved.value;

  const baseline = await currentVersions(variant.graderDeps);
  const candidate = variant.isCurrent
    ? baseline
    : await currentVersions(variant.versionDeps);
  log(
    `[variant] ${variant.root} (core@${candidate.get("core:core")?.n ?? "?"})`,
  );

  const found = await discoverScenarios();
  const runs = await readRuns(RUNS_DIR);
  const scenarios = found.map((f) => f.scenario);
  const checked = checkSpecAgainst(spec, {
    scenarios,
    runs,
    versions: baseline,
  });
  if (!checked.ok) {
    const problems =
      (checked.error.details?.problems as string[] | undefined) ??
        [checked.error.message];
    return err({ ...checked.error, message: problems.join("\n") });
  }

  const facts = await collectLockFacts({
    id: spec.id,
    current: REPO_ROOT,
    variant: variant.isCurrent ? REPO_ROOT : variant.root,
    cases: spec.cases.map((g) => ({
      id: g.scenario,
      path: found.find((f) => f.scenario.id === g.scenario)?.path ??
        `${REPO_ROOT}/${g.scenario}`,
    })),
  });
  const locked = checkSpecLocked(facts);
  if (!locked.ok) return locked;

  const changed = changedComponents(baseline, candidate);
  const change = checkChange(spec.change, changed);
  if (!change.ok) return err({ code: "conflict", message: change.message });
  log(
    `[change] ${refText(spec.change.from)} -> @${
      changed.find((c) =>
        c.from.kind === spec.change.from.kind &&
        c.from.name === spec.change.from.name
      )?.to.n
    }  mixed: ${
      change.mixed.length === 0
        ? "-"
        : change.mixed.map((c) => `${refText(c.from)} -> @${c.to.n}`).join(", ")
    }`,
  );
  for (const w of change.warnings) log(`[warn] ${w}`);

  const judge = await loadJudgeDefinition();
  const judgeRef: VersionRef = { kind: "judge", name: "judge", n: judge.n };
  const selected = selectRuns(spec, runs, {
    scenarios,
    versions: baseline,
    judge: judgeRef,
    model: spec.model,
  });
  if (!selected.ok) return selected;
  const plan = selected.value;
  if (plan.entries.length === 0) {
    return err({ code: "not_found", message: "고른 시나리오가 없다" });
  }
  log(
    `[select] ${
      plan.entries.map((e) => `${e.role} ${e.scenario}@${e.n}`).join("  ")
    }`,
  );
  for (const k of plan.keep) {
    log(`[select] keep ${k.scenario} (run ${k.runs.length}개)`);
  }
  for (const x of plan.excluded) {
    log(`[select] excluded ${x.scenario}: ${x.reason}`);
  }
  return ok({
    spec,
    hash,
    specCommit: locked.value.spec_commit,
    variant,
    baseline,
    found,
    runs,
    changed,
    plan,
    judgeRef,
    scenarioOf: new Map(found.map((f) => [f.scenario.id, f])),
  });
}

function fail(message: string): number {
  log(message);
  return 1;
}

async function gate(
  begun: Begun,
  opts: CommandOptions,
  scenarios: Scenario[],
): Promise<boolean> {
  const { variant } = begun;
  const report: GateReport = await runGate(
    { checkout: variant.root, base: opts.base, scenarios },
    defaultGateDeps({
      catalogRoot: REPO_ROOT,
      validateFixtures,
      async dryRun(scenario) {
        const held: Held = {};
        try {
          await prepareTrialWorld({ variant }, scenario, held);
          log(`[gate] dry-run ${scenario.id} ok`);
          return ok(undefined);
        } catch (e) {
          log(`[gate] dry-run ${scenario.id} failed`);
          return err({ code: "unavailable", message: messageOf(e) });
        } finally {
          await releaseWorld(held);
        }
      },
    }, variant.root),
  );
  for (const s of report.stages) {
    const state = s.skipped ? `skipped (${s.detail})` : s.ok ? "ok" : "failed";
    log(`[gate] ${s.name} ${state} ${Math.round(s.ms / 1000)}s`);
    if (!s.ok && s.detail !== "") log(s.detail);
  }
  return report.ok;
}

const codingIn = (scenarios: Scenario[]) =>
  scenarios.some((s) => s.real.some(isCodingAgent));

export async function gateCommand(opts: CommandOptions): Promise<number> {
  const begun = await begin(opts);
  if (!begun.ok) return fail(begun.error.message);
  const scenarios = begun.value.plan.entries.map((e) =>
    begun.value.scenarioOf.get(e.scenario)!.scenario
  );
  if (codingIn(scenarios)) await useEvalTmp();
  return await gate(begun.value, opts, scenarios) ? 0 : 1;
}

const touched = (t: TrialResult) =>
  t.coding?.some((c) => c.human_input) ?? false;

// 시나리오 재료 안의 이름(앱, project, Operator)은 과적합 경고가 시나리오 고유 이름으로 본다.
async function extraNamesOf(
  scenarios: Scenario[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const s of scenarios) {
    const ordered = await orderMaterials(MATERIALS_ROOT, s.world);
    if (ordered.ok) {
      out[s.id] = ordered.value.flatMap((m) => Object.keys(m.manifest.ids));
    }
  }
  return out;
}

async function readRepeats(
  runIds: string[],
): Promise<RepeatFinding[]> {
  const out: RepeatFinding[] = [];
  for (const run of runIds) {
    const pending = (await readPending(EVAL_DIR, run)).filter((e) =>
      e.kind === "diagnosis"
    );
    try {
      for await (const f of Deno.readDir(`${EVAL_DIR}/${run}`)) {
        if (!f.name.endsWith(".repeat.json")) continue;
        const found = JSON.parse(
          await Deno.readTextFile(`${EVAL_DIR}/${run}/${f.name}`),
        ) as RepeatFinding[];
        // 채점이 들어왔으면 대기 entry의 최신 item으로 바꾼다.
        for (const r of found) {
          out.push({
            ...r,
            item: pending.find((e) => e.key === r.key)?.item ?? r.item,
          });
        }
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return out;
}

export async function experimentCommand(
  opts: ExperimentOptions,
): Promise<number> {
  const begun = await begin(opts);
  if (!begun.ok) return fail(begun.error.message);
  const { spec, variant, plan, runs, found } = begun.value;
  const entryScenarios = plan.entries.map((e) =>
    begun.value.scenarioOf.get(e.scenario)!.scenario
  );
  const coding = codingIn(entryScenarios);
  if (coding) await useEvalTmp();

  // 이어 돌리기: 판정이 난 spec은 다시 굴리지 않고, 끊긴 것은 앞서 돈 variant trial을 이어 받는다.
  const old = await readResult(SPEC_DIR, spec.id);
  if (!old.ok) return fail(old.error.message);
  if (old.value !== null && old.value.decision !== "inconclusive") {
    return fail(
      `판정이 이미 났다(${old.value.decision}). 새 spec(새 id)을 쓴다`,
    );
  }
  const priorRuns = new Map<string, string[]>();
  for (const s of old.value?.scenarios ?? []) {
    priorRuns.set(s.scenario, s.variant_runs);
  }
  const variantOutcomes = (
    all: RunRecord[],
    ids: string[],
  ): Outcome[] =>
    ids.flatMap((id) => {
      const run = all.find((r) => r.id === id);
      return (run?.trials ?? []).filter((t) => !touched(t))
        .map((t) => outcomeOf(t, run!.components));
    });

  const flaky = flakyScenarios(runs, found.map((f) => f.scenario));
  const stateOf = (
    entry: Plan["entries"][number],
    variantOutcomesOf: Outcome[],
  ) => ({
    role: entry.role,
    checks: entry.checks,
    baseline: entry.baseline,
    variant: variantOutcomesOf,
    flaky: flaky.has(entry.scenario),
  });
  const priorOf = (scenario: string) =>
    variantOutcomes(runs, priorRuns.get(scenario) ?? []);
  const nothingToRun = plan.entries.every((e) =>
    nextTrials(stateOf(e, priorOf(e.scenario)), spec.trials) === 0
  );

  if (!nothingToRun && !opts.skipGate) {
    if (!await gate(begun.value, opts, entryScenarios)) return 1;
  }

  // 진단. 막지 않고 result에 남긴다.
  let overfit: OverfitWarning[] | undefined;
  const changedText = await loadChangedText(REGISTRY_DIR, spec.change);
  if (!changedText.ok) {
    log(`[warn] 경고를 못 낸다: ${changedText.error.message}`);
  } else if (changedText.value === null) {
    log("[warn] 내용을 못 봐서 경고를 못 낸다");
  } else {
    overfit = findOverfit(
      changedText.value,
      entryScenarios,
      await extraNamesOf(entryScenarios),
    );
    for (const line of formatWarnings(overfit)) log(`[warn] ${line}`);
  }

  let assembly: AssemblyReport[] | undefined;
  if (spec.change.from.kind === "assembly") {
    assembly = [];
    const port = createReplayPort();
    for (const entry of plan.entries) {
      const run = entry.baseline_runs[0];
      if (run === undefined) continue;
      const recorded = await loadRecordedTrial(EVAL_DIR, run, 0);
      if (!recorded.ok) {
        log(`[assembly] ${run} 건너뜀: ${recorded.error.message}`);
        continue;
      }
      const report = await measureAssembly({ port }, {
        run,
        trial: recorded.value,
        scenario: begun.value.scenarioOf.get(entry.scenario)!.scenario,
        model: spec.model,
        checkout: variant.isCurrent ? null : variant.root,
      });
      assembly.push(report);
      for (const line of formatAssembly(report)) {
        log(`[assembly] ${line.replace(/^assembly /, "")}`);
      }
    }
  }
  if (opts.prefixOnly) return 0;

  const budget = opts.budget ?? spec.budget_usd;
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const newRuns = new Map<string, string>(); // 시나리오 id → 이번 run id
  let pool: Pool | undefined;
  const failures: string[] = [];

  if (!nothingToRun) {
    const estimate = estimateTrials(
      plan.entries.map((entry) => ({
        entry,
        flaky: flaky.has(entry.scenario),
      })),
      spec.trials,
    );
    const { trials, usd } = estimate;
    log(
      `[estimate] trials ${trials.min}..${trials.worst} (likely ${trials.likely}) $${
        usd.likely.toFixed(2)
      } (budget $${budget})${
        usd.worst > budget
          ? ` 예산 부족할 수 있음(최대 $${usd.worst.toFixed(2)})`
          : ""
      }`,
    );

    const key = readAnthropicKey(Deno.env);
    if (key === undefined) {
      return fail("ANTHROPIC_API_KEY가 없다. .env에 두고 다시 돌린다.");
    }
    const registered = await registerAll(
      plan.entries.map((e) => begun.value.scenarioOf.get(e.scenario)!),
    );
    if (registered.problems.length > 0) {
      return fail(registered.problems.join("\n"));
    }

    const deps = await trialDepsOf({
      key,
      model: spec.model,
      variant,
      trialBudgetUsd: TRIAL_CAP_USD,
      saveEnabled: false,
      coding,
      source: await captureSource(variant.versionDeps),
      judge: await loadJudgeDefinition(),
      repeatCriterion: await loadCriterion(REPEAT_KIND),
    });
    const core = await coreVersion(variant.versionDeps);
    const checks = await checksVersion(variant.graderDeps);
    pool = createPool({ budget: createCap(budget, log) });
    const stopSignals = installSignals(pool, deps.live, log);

    const logged = new Set<string>();
    await Promise.all(plan.entries.map(async (entry) => {
      const scenario = begun.value.scenarioOf.get(entry.scenario)!.scenario;
      const runId = ids.newId("run");
      const prior = priorOf(entry.scenario);
      const ran = await runScenario({
        scenario,
        runId,
        deps,
        pool: pool!,
        next: (results) => {
          for (const t of results.filter(touched)) {
            const mark = `${runId}#${t.index}`;
            if (!logged.has(mark)) {
              logged.add(mark);
              log(`사람 개입 ${runId} trial ${t.index}`);
            }
          }
          return nextTrials(
            stateOf(entry, [
              ...prior,
              ...results.filter((t) => !touched(t)).map((t) =>
                outcomeOf(t, [])
              ),
            ]),
            spec.trials,
          );
        },
        materials: registered.materials.get(entry.scenario) ?? [],
        core,
        checks,
        runsDir: RUNS_DIR,
      });
      if (ran.record !== null) newRuns.set(entry.scenario, runId);
      if (ran.failed !== null) failures.push(ran.failed);
    }));
    stopSignals();
  }

  // 요약을 새로 읽는다. 돌리는 사이 채점이 들어왔으면 foldRun이 요약을 고쳐 두었다.
  const now = await readRuns(RUNS_DIR);
  const entries: VerdictEntry[] = plan.entries.map((entry) => {
    const variantRuns = [
      ...(priorRuns.get(entry.scenario) ?? []),
      ...(newRuns.has(entry.scenario) ? [newRuns.get(entry.scenario)!] : []),
    ];
    const variant = variantOutcomes(now, variantRuns);
    return {
      ...entry,
      variant_runs: variantRuns,
      variant,
      remaining: nextTrials(stateOf(entry, variant), spec.trials),
    };
  });
  const allRuns = entries.flatMap((e) => e.variant_runs);
  const repeats = await readRepeats(allRuns);

  const verdict = await recordVerdict(SPEC_DIR, {
    spec,
    spec_hash: begun.value.hash,
    spec_commit: begun.value.specCommit,
    changed: begun.value.changed,
    entries,
    keep: plan.keep,
    excluded: plan.excluded,
    stopped_by_budget: pool?.halted() === "budget",
    decided_at: systemClock.now(),
    ...(overfit && { overfit }),
    ...(repeats.length > 0 && { repeats }),
    ...(assembly && { assembly }),
  });
  if (!verdict.ok) return fail(verdict.error.message);

  for (const run of allRuns) {
    const waiting = outstanding(await readPending(EVAL_DIR, run)).length;
    if (waiting === 0) continue;
    log(`[pending] ${run} ${waiting}건`);
    log(`  deno task eval:judge ${run}`);
    log(`  deno task eval:experiment ${spec.id}`);
  }
  for (const reason of verdict.value.reasons) log(`  ${reason}`);
  log(`[verdict] ${verdict.value.decision}`);
  // 판정은 result.json과 위 줄에 있다. 해석은 experimenter 몫이라 판정으로 종료 코드를 막지 않는다.
  return failures.length > 0 ? 1 : 0;
}
