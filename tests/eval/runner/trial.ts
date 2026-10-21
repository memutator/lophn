import type { Clock } from "../../../packages/base/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import { runProgramChecks } from "../checks/mod.ts";
import {
  collectSessions,
  diskBlobReader,
  metricsOf,
  sumMetrics,
  writeFullRecord,
} from "../collect/mod.ts";
import { loadCriterion } from "../criteria/mod.ts";
import { queueRepeats } from "../experiment/repeat/mod.ts";
import type { Variant } from "../experiment/variant/mod.ts";
import { createHumanRole, type HumanRole } from "../human/mod.ts";
import {
  type JudgeDefinition,
  judgeKey,
  newJudgeItem,
  writePending,
} from "../judge/mod.ts";
import { attachRealModels } from "../provider/mod.ts";
import { agentRefOf, saveMaterials } from "../restore/mod.ts";
import { seenComponents } from "../versions/mod.ts";
import {
  type CheckResult,
  type Criterion,
  type HumanSummary,
  type JudgeItem,
  type Scenario,
  type SourceInfo,
  type TrialRecord,
  type TrialResult,
  type VersionRef,
} from "../types.ts";
import { serial } from "./mutex.ts";
import { extraRoots } from "./roots.ts";
import { createSpendGuard, roleSpendUsd } from "./spend.ts";
import { runSteps } from "./steps.ts";
import { type Held, prepareTrialWorld, releaseWorld } from "./world.ts";

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
  trialBudgetUsd: number; // trial 하나의 role agent 비용 상한
  variant: Variant; // core가 가리키는 checkout
  saveEnabled: boolean; // experiment의 산출물은 후보가 아니라 저장하지 않는다
  keep?: boolean; // 끝난 world를 지우지 않는다. 사람이 데스크톱 앱(LOPHN_DEV_HOME)으로 열어 본다
  saved: { name: string; n: number }[]; // 이 run에서 후보로 쓴 재료. 하나라도 있으면 더 쓰지 않는다
  repeatCriterion: Criterion; // 같은 호출을 되풀이했는지 보는 진단 criterion
  live: Set<{ stop(): Promise<unknown> }>; // 도는 trial. 둘째 신호가 기다리지 않고 끈다
};

export type TrialOutcome = {
  result: TrialResult;
  components: VersionRef[];
  saved: { name: string; n: number }[]; // 이 trial이 후보로 쓴 재료
};

function humanSummary(human: HumanRole): HumanSummary {
  const { answers, decisions } = human.record();
  return {
    answered: answers.length,
    fallback: answers.filter((a) => a.error !== null).length,
    decisions: decisions.length,
  };
}

export async function runTrial(
  deps: TrialDeps,
  scenario: Scenario,
  index: number,
): Promise<TrialOutcome> {
  const held: Held = {};
  const live = { stop: () => held.core?.stop() ?? Promise.resolve() };
  deps.live.add(live);
  try {
    const { run, core, ctx } = await prepareTrialWorld(
      deps,
      scenario,
      held,
    );

    await attachRealModels(core, {
      key: deps.key,
      model: deps.model,
      real: scenario.real.map((p) => agentRefOf(ctx.world, p)),
    });

    const human = scenario.human === undefined ? undefined : createHumanRole({
      port: core,
      clock: deps.clock,
      spec: scenario.human,
      evalDir: deps.evalDir,
      run: deps.runId,
      trial: index,
      log: deps.log,
    });
    const spend = createSpendGuard({
      limitUsd: deps.trialBudgetUsd,
      roleSpend: () => roleSpendUsd(core),
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
      over: spend.over,
      startedMs,
      clock: deps.clock,
      sleep: deps.sleep,
      log: deps.log,
    });
    const finishedAt = deps.clock.now();

    // ask의 질문 글은 기다리는 동안에만 읽히므로 core를 끄기 전에 모은다.
    // callApi 같은 step이 깨운 role agent도 기록에 든다. 후보 가운데 t0 뒤 turn이 없는 것은 버린다.
    const rootIds = [...roots.values()];
    const extra = new Set(extraRoots(
      (await core.call(sessionSnapshotsList, {})).snapshots,
      rootIds,
    ));
    const records = (await collectSessions(
      { port: core, readBlob: diskBlobReader(run.home) },
      [...new Set([...rootIds, ...extra])],
      startedAt,
    )).filter((r) => !extra.has(r.session) || r.turns.length > 0);
    const trial: TrialRecord = {
      index,
      started_at: startedAt,
      finished_at: finishedAt,
      settle,
      sessions: records,
      metrics: sumMetrics(records.map(metricsOf)),
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
      const item = newJudgeItem({
        check: check.id,
        criterion,
        input: await check.input({ trial, core }),
        judge: deps.judge,
      });
      await writePending(deps.evalDir, {
        key: judgeKey(index, check.id),
        run: deps.runId,
        trial: index,
        kind: "check",
        asked_at: deps.clock.now(),
        criterion,
        item,
      });
      judge.push(item);
      checks.push({
        id: check.id,
        kind: "judge",
        pass: false,
        pending: true,
        reason: "채점 대기",
      });
      deps.log(`채점 대기 ${deps.runId} ${judgeKey(index, check.id)}`);
    }

    // 동시에 도는 trial이 같은 registry file을 쓰지 않게 줄 세운다.
    const refs = await serial(async () => {
      const components = await seenComponents(
        records,
        deps.variant.versionDeps,
      );
      if (!components.ok) {
        throw new Error(
          `component 버전 확인 실패: ${components.error.message}`,
        );
      }
      return [...components.value];
    });

    // 통과한 첫 trial만 후보로 쓴다(--trials 3이 같은 산출물 후보를 셋 만들지 않게). 쓰기 실패는 점수가 아니다.
    // 확인과 저장이 겹치면 동시 trial이 둘 다 저장하므로 함께 줄 세운다.
    const saved: { name: string; n: number }[] = [];
    if (
      deps.saveEnabled && scenario.save !== undefined &&
      settle.kind === "idle" && checks.every((c) => c.pass || c.pending)
    ) {
      await serial(async () => {
        if (deps.saved.length > 0) return;
        const written = await saveMaterials(
          { core, world: ctx.world, refs: scenario.world, trial },
          scenario.save!,
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
      });
    }

    await writeFullRecord(deps.evalDir, deps.runId, index, {
      trial,
      judge,
      source: deps.source,
    });

    // 같은 호출을 되풀이한 곳의 진단. 채점 대기 item만 두고 통과 판정에는 들지 않는다.
    const repeats = await queueRepeats({
      evalDir: deps.evalDir,
      run: deps.runId,
      clock: deps.clock,
      criterion: deps.repeatCriterion,
      judge: deps.judge,
    }, trial);
    if (repeats.length > 0) {
      await Deno.writeTextFile(
        `${deps.evalDir}/${deps.runId}/trial-${index}.repeat.json`,
        JSON.stringify(repeats, null, 2) + "\n",
      );
      for (const r of repeats) deps.log(`채점 대기 ${deps.runId} ${r.key}`);
    }

    const result: TrialResult = {
      index,
      settle,
      checks,
      judge,
      metrics: trial.metrics,
      components: refs,
      ...(human && { human: humanSummary(human) }),
    };
    return { result, components: refs, saved };
  } finally {
    deps.live.delete(live);
    // 각 정리가 실패해도 다음을 한다. core log는 멈춘 이유를 아는 유일한 길이라 stop 뒤 지우기 전에 복사한다.
    await held.core?.stop().catch(() => {});
    if (held.run !== undefined) {
      await Deno.mkdir(`${deps.evalDir}/${deps.runId}`, { recursive: true })
        .then(() =>
          Deno.copyFile(
            `${held.run!.dir}/core.log`,
            `${deps.evalDir}/${deps.runId}/trial-${index}.core.log`,
          )
        ).catch(() => {});
      // 후보 재료(save)는 다 통과한 trial만 쓴다. 떨어진 trial이 만든 앱도 사람이 볼 수 있게 source를 남긴다.
      await copyAppSources(
        held.run.home,
        `${deps.evalDir}/${deps.runId}/trial-${index}/apps`,
      ).catch(() => {});
    }
    if (deps.keep && held.run !== undefined) {
      await held.ctx?.fake.close().catch(() => {});
      deps.log(
        `world를 남겼다: LOPHN_DEV_HOME=${held.run.home} deno task dev 로 연다. 다 보면 ${held.run.dir}를 지운다`,
      );
    } else {
      await releaseWorld(held);
    }
  }
}

// `<home>/apps/<app id>/source`를 `<dest>/<app id>/source`로 복사한다.
async function copyAppSources(home: string, dest: string): Promise<void> {
  for await (const app of Deno.readDir(`${home}/apps`)) {
    const source = `${home}/apps/${app.name}/source`;
    if (!app.isDirectory || !await exists(source)) continue;
    await Deno.mkdir(`${dest}/${app.name}`, { recursive: true });
    const copied = await new Deno.Command("cp", {
      args: ["-r", source, `${dest}/${app.name}/source`],
    }).output();
    if (!copied.success) {
      throw new Error(new TextDecoder().decode(copied.stderr));
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
