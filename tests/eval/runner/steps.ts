import type { Clock } from "../../../packages/base/mod.ts";
import { placeSessionOpen } from "../../../packages/protocol/lophn-agent/mod.ts";
import { say } from "../../support/core/human.ts";
import type { Core } from "../../support/core/mod.ts";
import { agentAtPlaceOf } from "../restore/mod.ts";
import type {
  Participant,
  RestoreContext,
  Scenario,
  Settle,
  WorldIds,
} from "../types.ts";
import { type IdleResult, readSnapshot, waitUntilIdle } from "./idle.ts";

export type StepsContext = {
  core: Core;
  restore: RestoreContext;
  scenario: Scenario;
  roots: Map<string, string>; // collect가 시작할 session. key는 JSON.stringify(AgentAtPlace)
  over?: () => Promise<string | null>;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

// 참가자마다 session을 하나 연다. 이미 연 참가자는 다시 열지 않는다.
export async function openRoots(
  core: Core,
  world: WorldIds,
  participants: Participant[],
  roots: Map<string, string>,
): Promise<void> {
  for (const p of participants) {
    const at = agentAtPlaceOf(world, p);
    const key = JSON.stringify(at);
    if (roots.has(key)) continue;
    const id = core.ids.newId("ses");
    await core.call(placeSessionOpen, { id, agent: at.agent, place: at.place });
    roots.set(key, id);
  }
}

export async function runSteps(ctx: StepsContext): Promise<Settle> {
  const { core, scenario, roots, clock, log } = ctx;
  const wait = (): Promise<IdleResult> =>
    waitUntilIdle(
      () => readSnapshot(core),
      { clock, sleep: ctx.sleep, log },
      { hooks: { over: ctx.over } },
    );

  let settle: Settle = { kind: "idle", unstarted: [] };
  for (const step of scenario.steps) {
    if (step.kind === "say") {
      await openRoots(core, ctx.restore.world, [step.to], roots);
      const key = JSON.stringify(agentAtPlaceOf(ctx.restore.world, step.to));
      await say(core, roots.get(key)!, step.text);
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
