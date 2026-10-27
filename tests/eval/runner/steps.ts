import type { Clock } from "../../../packages/base/mod.ts";
import {
  appCallTool,
  type ToolCallInput,
} from "../../../packages/protocol/apps/mod.ts";
import { openSession, say } from "../../support/core/human.ts";
import type { Core } from "../../support/core/mod.ts";
import type { HumanRole } from "../human/mod.ts";
import { agentRefOf } from "../restore/mod.ts";
import type { Scenario, Settle, SetupContext } from "../types.ts";
import { type IdleResult, readSnapshot, waitUntilIdle } from "./idle.ts";

export type StepsContext = {
  core: Core;
  setup: SetupContext;
  scenario: Scenario;
  roots: Map<string, string>; // collect가 시작할 session. say가 연 것
  human?: HumanRole;
  over?: () => Promise<string | null>;
  startedMs: number; // t0
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

export async function runSteps(ctx: StepsContext): Promise<Settle> {
  const { core, scenario, roots, human, clock, log } = ctx;
  const { idle_ms, stuck_ms } = scenario.limits ?? {};
  const wait = (): Promise<IdleResult> =>
    waitUntilIdle(
      () => readSnapshot(core, { approvals: human !== undefined }),
      { clock, sleep: ctx.sleep, log },
      {
        ...(idle_ms !== undefined && {
          timeoutMs: Math.max(0, idle_ms - (clock.nowMs() - ctx.startedMs)),
        }),
        ...(stuck_ms !== undefined && { stuckMs: stuck_ms }),
        hooks: {
          act: human && (async () => (await human.tick()).acted > 0),
          over: ctx.over,
        },
      },
    );

  let settle: Settle = { kind: "idle", unstarted: [] };
  for (const step of scenario.steps) {
    if (step.kind === "say") {
      const ref = agentRefOf(ctx.setup.world, step.to);
      const refKey = JSON.stringify(ref);
      let session = roots.get(refKey);
      if (session === undefined) {
        session = await openSession(core, ref);
        roots.set(refKey, session);
      }
      await say(core, session, step.text);
    } else if (step.kind === "callApi") {
      const app = ctx.setup.world.apps[step.app];
      if (app === undefined) {
        throw new Error(`callApi: 앱 ${step.app}을 못 푼다`);
      }
      const called = await core.call(appCallTool, {
        target: { mode: "live", app, release: null },
        tool: step.api,
        ...(step.input !== undefined && {
          input: step.input as ToolCallInput["input"],
        }),
        caller: { kind: "person", view_session: "eval" },
      });
      const { outcome } = called;
      log(`callApi ${step.app}.${step.api}: ${outcome.status}`);
      // 앱 handler가 낸 오류(failed)는 실패가 아니다. calendar-diagnose는 bug를 일부러 터뜨린다.
      if (outcome.status === "denied" || outcome.status === "unknown") {
        throw new Error(
          `callApi ${step.app}.${step.api}: ${JSON.stringify(outcome)}`,
        );
      }
    } else {
      const idle = await wait();
      if (idle.kind === "idle") {
        settle = { kind: "idle", unstarted: [] };
        for (const w of idle.waiting) {
          if (w.questions > 0) log(`ask 대기 ${w.session}`);
          if (w.permissions > 0) log(`허락 대기 ${w.session}`);
        }
      } else {
        settle = { kind: "timeout", unstarted: idle.unstarted };
        log(
          `멈추지 않아 timeout: running ${idle.running.join(",")} unstarted ${idle.unstarted.join(
            ",",
          )}`,
        );
        break;
      }
    }
  }
  return settle;
}
