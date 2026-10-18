import type { Clock } from "../../../packages/base/mod.ts";
import { bootCore, createRun } from "../../support/core/mod.ts";
import { runProgramChecks } from "../checks/mod.ts";
import {
  type CodingDriver,
  prepareCodingAgent,
  startCodingDriver,
} from "../coding/driver/mod.ts";
import { collectCoding } from "../coding/metrics/mod.ts";
import {
  collectSessions,
  diskBlobReader,
  metricsOf,
  sumMetrics,
  writeFullRecord,
} from "../collect/mod.ts";
import { loadCriterion } from "../criteria/mod.ts";
import { createHumanRole, type HumanRole } from "../human/mod.ts";
import { type JudgeDefinition, judgeItem, judgePassed } from "../judge/mod.ts";
import { attachRealModels, evalCoreSettings } from "../provider/mod.ts";
import {
  agentRefOf,
  beginRestore,
  endRestore,
  restoreCoreEnv,
  restoreWorld,
  saveMaterials,
} from "../restore/mod.ts";
import { measureCli, resolveVersion, seenComponents } from "../versions/mod.ts";
import {
  type CheckResult,
  type CodingSummary,
  type CodingTrace,
  type HumanSummary,
  isCodingAgent,
  type JudgeItem,
  type Participant,
  type Scenario,
  type SourceInfo,
  type TrialRecord,
  type TrialResult,
  type VersionRef,
} from "../types.ts";
import { createSpendGuard, roleSpendUsd } from "./spend.ts";
import { CODING_TRIAL_LIMIT_MS, runSteps } from "./steps.ts";

export type TrialDeps = {
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  key: string; // 어디에도 찍거나 쓰지 않는다
  model: string;
  runId: string;
  evalDir: string; // 전체 기록 폴더(.dev-data/eval)
  source: SourceInfo;
  judge: JudgeDefinition;
  log: (line: string) => void;
  registryDir: string;
  trialBudgetUsd: number; // trial 하나의 role agent·judge·사람 역할 비용 상한
  repoRoot: string; // `lophn` wrapper가 가리키는 checkout
  hookRoot: string; // 사람이 설치한 hook이 가리키는 checkout. worktree가 지워져도 남는 곳이다
  binDir: string;
  home: string; // 사람의 HOME. Claude Code의 JSONL이 여기 있다
  saved: { name: string; n: number }[]; // 이 run에서 후보로 쓴 재료. 하나라도 있으면 더 쓰지 않는다
};

export type TrialOutcome = {
  result: TrialResult;
  components: VersionRef[];
  saved: { name: string; n: number }[]; // 이 trial이 후보로 쓴 재료
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function humanSummary(human: HumanRole): HumanSummary {
  const { answers, decisions, cost_usd } = human.record();
  return {
    answered: answers.length,
    fallback: answers.filter((a) => a.error !== null).length,
    decisions: decisions.length,
    cost_usd,
  };
}

export async function runTrial(
  deps: TrialDeps,
  scenario: Scenario,
  index: number,
): Promise<TrialOutcome> {
  const coding = scenario.real.some(isCodingAgent);
  const run = await createRun();
  let core: Awaited<ReturnType<typeof bootCore>> | undefined;
  let driver: CodingDriver | undefined;
  try {
    core = await bootCore(run, {
      settings: evalCoreSettings(),
      env: await restoreCoreEnv(scenario.world),
    });

    const ctx = await beginRestore(core);
    const restored = await restoreWorld(ctx, scenario.world);
    if (!restored.ok) {
      throw new Error(`되살리기 실패: ${restored.error.message}`);
    }
    await scenario.setup?.(ctx); // 안 쓴 fake는 endRestore가 닫는다. ticket 대본이 fake를 쓰므로 endRestore 앞이다
    await endRestore(ctx);

    await attachRealModels(core, {
      key: deps.key,
      model: deps.model,
      real: scenario.real.filter((p): p is Participant => !isCodingAgent(p))
        .map((p) => agentRefOf(ctx.world, p)),
    });

    // 되살리기의 가짜 터미널과 섞이지 않게 되살리기가 끝난 뒤에만 붙인다. Gateway 연결이 비동기라 t0 전에 시작한다.
    let cliVersion: string | undefined;
    if (coding) {
      const prepared = await prepareCodingAgent({
        core,
        root: deps.repoRoot,
        hookRoot: deps.hookRoot,
        binDir: deps.binDir,
        model: deps.model,
        clock: deps.clock,
        install: "check",
      });
      cliVersion = prepared.version;
      const live = startCodingDriver({
        core,
        clock: deps.clock,
        binDir: deps.binDir,
        outDir: `${deps.evalDir}/${deps.runId}/trial-${index}`,
        root: deps.repoRoot,
        log: deps.log,
        timeoutMs: CODING_TRIAL_LIMIT_MS,
      });
      // 끝나기 전에 한 번 끊고 마지막에 또 끊는다. 둘째부터는 첫 결과를 돌려준다.
      let stopped: Promise<CodingTrace[]> | undefined;
      driver = { ...live, stop: () => stopped ??= live.stop() };
    }
    const human = scenario.human === undefined ? undefined : createHumanRole({
      port: core,
      fetch: (url, init) => fetch(url, init),
      apiKey: deps.key,
      clock: deps.clock,
      spec: scenario.human,
    });
    const spend = createSpendGuard({
      limitUsd: deps.trialBudgetUsd,
      roleSpend: () => roleSpendUsd(core!),
      humanSpend: () => human?.record().cost_usd ?? 0,
      clock: deps.clock,
    });

    // 첫 step 직전이 t0다. collector가 이보다 먼저 시작한 turn(되살리기·setup의 흔적)을 뺀다.
    const startedAt = deps.clock.now();
    const startedMs = deps.clock.nowMs();
    const roots = new Map<string, string>();
    const settle = await runSteps({
      core,
      setup: ctx,
      scenario,
      roots,
      human,
      driver,
      over: spend.over,
      startedMs,
      clock: deps.clock,
      sleep: deps.sleep,
      log: deps.log,
    });
    const traces = await driver?.stop() ?? [];
    const finishedAt = deps.clock.now();

    // ask의 질문 글은 기다리는 동안에만 읽히므로 core를 끄기 전에 모은다.
    const records = await collectSessions(
      { port: core, readBlob: diskBlobReader(run.home) },
      [...roots.values()],
      startedAt,
    );
    // coding agent 수치는 role agent의 metrics와 섞지 않고 coding에만 둔다.
    const codingRecords = coding
      ? await collectCoding({ home: deps.home }, traces)
      : undefined;
    const trial: TrialRecord = {
      index,
      started_at: startedAt,
      finished_at: finishedAt,
      settle,
      sessions: records,
      metrics: sumMetrics(records.map(metricsOf)),
      ...(codingRecords && { coding: codingRecords }),
      ...(human && { human: human.record() }),
    };

    const checks: CheckResult[] = await runProgramChecks(scenario.checks, {
      trial,
      core,
    });
    const judge: JudgeItem[] = [];
    for (const check of scenario.checks) {
      if (check.kind !== "judge") continue;
      const failedPremise = check.premise.filter((id) =>
        !checks.find((c) => c.id === id)?.pass
      );
      if (settle.kind === "timeout" || failedPremise.length > 0) {
        checks.push({
          id: check.id,
          kind: "judge",
          pass: false,
          reason: settle.kind === "timeout"
            ? "timeout이라 judge를 부르지 않았다"
            : `전제 check가 떨어져 judge를 부르지 않았다: ${
              failedPremise.join(", ")
            }`,
        });
        continue;
      }
      const criterion = await loadCriterion(check.criterion);
      const item = await judgeItem(
        { fetch: (url, init) => fetch(url, init), apiKey: deps.key },
        {
          check: check.id,
          criterion,
          input: await check.input({ trial, core }),
          judge: deps.judge,
        },
      );
      judge.push(item);
      checks.push({
        id: check.id,
        kind: "judge",
        pass: judgePassed(criterion, item),
        reason: oneLine(
          item.error ?? `${item.verdict}: "${item.quote ?? ""}"`,
        ),
      });
    }

    const components = await seenComponents(records);
    if (!components.ok) {
      throw new Error(`component 버전 확인 실패: ${components.error.message}`);
    }
    const refs = [...components.value];
    // harness도 component다. 값은 prepareCodingAgent가 이미 잰 `claude --version`이다.
    if (cliVersion !== undefined) {
      refs.push(
        (await resolveVersion(
          deps.registryDir,
          await measureCli("claude", cliVersion),
        )).ref,
      );
    }

    // 통과한 첫 trial만 후보로 쓴다(--trials 3이 같은 산출물 후보를 셋 만들지 않게). 쓰기 실패는 점수가 아니다.
    const saved: { name: string; n: number }[] = [];
    if (
      scenario.save !== undefined && deps.saved.length === 0 &&
      settle.kind === "idle" && checks.every((c) => c.pass)
    ) {
      const written = await saveMaterials(
        { core, world: ctx.world, refs: scenario.world, trial },
        scenario.save,
        {
          scenario: `${scenario.id}@${scenario.n}`,
          trial: index,
          run: deps.runId,
        },
      );
      if (written.ok) {
        for (const { name, n } of written.value) {
          saved.push({ name, n });
          deps.log(`후보: ${name}@${n}`);
        }
        deps.saved.push(...saved);
      } else {
        deps.log(`후보를 쓰지 못했다: ${written.error.message}`);
      }
    }

    await writeFullRecord(deps.evalDir, deps.runId, index, {
      trial,
      judge,
      source: deps.source,
    });
    const result: TrialResult = {
      index,
      settle,
      checks,
      judge,
      metrics: trial.metrics,
      ...(codingRecords && {
        coding: codingRecords.map(({ tail: _, ...rest }): CodingSummary =>
          rest
        ),
      }),
      ...(human && { human: humanSummary(human) }),
    };
    return { result, components: refs, saved };
  } finally {
    // 각 정리가 실패해도 다음을 한다. core log는 멈춘 이유를 아는 유일한 길이라 stop 뒤 지우기 전에 복사한다.
    await driver?.stop().catch(() => {});
    await core?.stop().catch(() => {});
    await Deno.mkdir(`${deps.evalDir}/${deps.runId}`, { recursive: true })
      .then(() =>
        Deno.copyFile(
          `${run.dir}/core.log`,
          `${deps.evalDir}/${deps.runId}/trial-${index}.core.log`,
        )
      ).catch(() => {});
    await run.remove().catch(() => {});
  }
}
