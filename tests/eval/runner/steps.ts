import type { Clock } from "../../../packages/base/mod.ts";
import { openSession, say } from "../../support/core/human.ts";
import type { Core } from "../../support/core/mod.ts";
import { agentRefOf } from "../restore/mod.ts";
import type { RestoreContext, Scenario, Settle } from "../types.ts";
import { type IdleResult, readSnapshot, waitUntilIdle } from "./idle.ts";

export type StepsContext = {
  core: Core;
  restore: RestoreContext;
  scenario: Scenario;
  roots: Map<string, string>; // collect가 시작할 session. say가 연 것
  over?: () => Promise<string | null>;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

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
      const ref = agentRefOf(ctx.restore.world, step.to);
      const refKey = JSON.stringify(ref);
      let session = roots.get(refKey);
      if (session === undefined) {
        session = await openSession(core, ref);
        roots.set(refKey, session);
      }
      await say(core, session, step.text);
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
