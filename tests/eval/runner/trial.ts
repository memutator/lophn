import type { Clock } from "../../../packages/base/mod.ts";
import { bootCore, createRun } from "../../support/core/mod.ts";
import { openSession, say } from "../../support/core/human.ts";
import { runProgramChecks } from "../checks/mod.ts";
import {
  collectSessions,
  diskBlobReader,
  metricsOf,
  sumMetrics,
  writeFullRecord,
} from "../collect/mod.ts";
import { loadCriterion } from "../criteria/mod.ts";
import { type JudgeDefinition, judgeItem, judgePassed } from "../judge/mod.ts";
import { attachRealModels, evalCoreSettings } from "../provider/mod.ts";
import {
  agentRefOf,
  beginRestore,
  endRestore,
  restoreWorld,
} from "../restore/mod.ts";
import { seenComponents } from "../versions/mod.ts";
import type {
  CheckResult,
  JudgeItem,
  Scenario,
  Settle,
  SourceInfo,
  TrialRecord,
  TrialResult,
  VersionRef,
} from "../types.ts";
import { readSnapshot, waitUntilIdle } from "./idle.ts";

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
};

export type TrialOutcome = { result: TrialResult; components: VersionRef[] };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export async function runTrial(
  deps: TrialDeps,
  scenario: Scenario,
  index: number,
): Promise<TrialOutcome> {
  const run = await createRun();
  let core: Awaited<ReturnType<typeof bootCore>> | undefined;
  try {
    core = await bootCore(run, { settings: evalCoreSettings() });

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
      real: scenario.real.map((p) => agentRefOf(ctx.world, p)),
    });

    // 첫 step 직전이 t0다. collector가 이보다 먼저 시작한 turn(되살리기·setup의 흔적)을 뺀다.
    const startedAt = deps.clock.now();
    const sessions = new Map<string, string>();
    let settle: Settle = { kind: "idle", unstarted: [] };
    for (const step of scenario.steps) {
      if (step.kind === "say") {
        const ref = agentRefOf(ctx.world, step.to);
        const refKey = JSON.stringify(ref);
        let session = sessions.get(refKey);
        if (session === undefined) {
          session = await openSession(core, ref);
          sessions.set(refKey, session);
        }
        await say(core, session, step.text);
        continue;
      }
      const idle = await waitUntilIdle(() => readSnapshot(core!), deps);
      if (idle.kind === "idle") {
        settle = { kind: "idle", unstarted: [] };
        for (const w of idle.waiting) {
          if (w.questions > 0) deps.log(`ask 대기 ${w.session}`);
          if (w.permissions > 0) deps.log(`허락 대기 ${w.session}`);
        }
      } else {
        settle = { kind: "timeout", unstarted: idle.unstarted };
        deps.log(
          `멈추지 않아 timeout: running ${idle.running.join(",")} unstarted ${
            idle.unstarted.join(",")
          }`,
        );
        break;
      }
    }
    const finishedAt = deps.clock.now();

    // ask의 질문 글은 기다리는 동안에만 읽히므로 core를 끄기 전에 모은다.
    const records = await collectSessions(
      { port: core, readBlob: diskBlobReader(run.home) },
      [...sessions.values()],
      startedAt,
    );
    const trial: TrialRecord = {
      index,
      started_at: startedAt,
      finished_at: finishedAt,
      settle,
      sessions: records,
      metrics: sumMetrics(records.map(metricsOf)),
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
          input: check.input({ trial, core }),
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
    };
    return { result, components: components.value };
  } finally {
    // 각 정리가 실패해도 다음을 한다. core log는 멈춘 이유를 아는 유일한 길이라 stop 뒤 지우기 전에 복사한다.
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
