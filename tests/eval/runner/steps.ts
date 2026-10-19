import type { Clock } from "../../../packages/base/mod.ts";
import {
  appCallTool,
  type ToolCallInput,
} from "../../../packages/protocol/apps/mod.ts";
import { callRead } from "../../../packages/protocol/lophn-agent/mod.ts";
import { openSession, say } from "../../support/core/human.ts";
import type { Core } from "../../support/core/mod.ts";
import type { CodingDriver } from "../coding/driver/mod.ts";
import type { HumanRole } from "../human/mod.ts";
import { agentRefOf, deliverCall } from "../restore/mod.ts";
import {
  isCodingAgent,
  parseRef,
  type Scenario,
  type Settle,
  type SetupContext,
} from "../types.ts";
import { type IdleResult, readSnapshot, waitUntilIdle } from "./idle.ts";

// coding 시나리오 trial 하나의 상한. t0부터 잰다.
export const CODING_TRIAL_LIMIT_MS = 90 * 60_000;
// callApi 뒤 ProblemOpened가 Project Manager 입력이 되기까지의 틈을 다음 untilIdle이 넘게 한다.
const CODING_QUIET_MS = 3_000;
// 활성화 허락 뒤 앱 process가 뜨고 release가 끝나기까지 아무도 일하지 않는 사이.
const CODING_GRACE_MS = 10_000;

export type StepsContext = {
  core: Core;
  setup: SetupContext;
  scenario: Scenario;
  roots: Map<string, string>; // collect가 시작할 session. say가 연 것과 deliver가 받는 쪽으로 찾은 것
  fake: Set<string>; // deliver가 call을 보내려고 연 fake lophn session. root로 더하지 않는다
  human?: HumanRole;
  driver?: CodingDriver;
  over?: () => Promise<string | null>;
  startedMs: number; // t0
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

export async function runSteps(ctx: StepsContext): Promise<Settle> {
  const { core, scenario, roots, fake, human, driver, clock, log } = ctx;
  const coding = scenario.real.some(isCodingAgent);
  const wait = (): Promise<IdleResult> =>
    waitUntilIdle(
      () => readSnapshot(core, { approvals: human !== undefined }),
      { clock, sleep: ctx.sleep, log },
      {
        ...(coding && {
          timeoutMs: Math.max(
            0,
            CODING_TRIAL_LIMIT_MS - (clock.nowMs() - ctx.startedMs),
          ),
          quietMs: CODING_QUIET_MS,
        }),
        hooks: {
          act: human && (async () => (await human.tick()).acted > 0),
          over: ctx.over,
          graceMs: coding ? CODING_GRACE_MS : undefined,
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
    } else if (step.kind === "deliver") {
      const ref = scenario.world.find((r) =>
        parseRef(r, "material").name === step.material
      );
      if (ref === undefined) {
        throw new Error(`deliver: world에 call 재료 ${step.material}가 없다`);
      }
      const sent = await deliverCall(ctx.setup, ref);
      if (!sent.ok) throw new Error(`deliver 실패: ${sent.error.message}`);
      const { call } = await core.call(callRead, { call: sent.value.call });
      if (call.receiver_session === null) {
        throw new Error(
          `deliver: ${ref}의 받는 session이 없다(state ${call.state}, fail_reason ${call.fail_reason})`,
        );
      }
      // fake lophn의 session은 root가 아니다. 그 fake model call이 수치와 component에 섞이면 안 된다.
      if (call.from.kind === "agent") fake.add(call.from.session);
      roots.set(call.receiver_session, call.receiver_session);
    } else if (step.kind === "callApi") {
      const app = ctx.setup.world.apps[step.app];
      if (app === undefined) {
        throw new Error(`callApi: 앱 ${step.app}을 못 푼다`);
      }
      const called = await core.call(appCallTool, {
        target: { mode: "live", app, release: null },
        tool: step.api,
        ...(step.input !== undefined &&
          { input: step.input as ToolCallInput["input"] }),
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
      let idle = await wait();
      // 완료 보고 없이 CLI가 멈췄거나 보고 뒤 process가 안 끝났다. 끊으면 core가 Project Manager에게 알려 새 turn이 열릴 수 있다.
      if (idle.kind === "idle" && driver !== undefined && driver.active() > 0) {
        log("터미널이 남은 채 쉬어 끊고 다시 기다린다");
        await driver.stop();
        idle = await wait();
      }
      if (idle.kind === "idle") {
        settle = { kind: "idle", unstarted: [] };
        for (const w of idle.waiting) {
          if (w.questions > 0) log(`ask 대기 ${w.session}`);
          if (w.permissions > 0) log(`허락 대기 ${w.session}`);
        }
      } else {
        settle = { kind: "timeout", unstarted: idle.unstarted };
        log(
          `멈추지 않아 timeout: running ${idle.running.join(",")} unstarted ${
            idle.unstarted.join(",")
          }`,
        );
        break;
      }
    }
  }
  return settle;
}
