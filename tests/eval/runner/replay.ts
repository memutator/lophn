import type { ReplayPort } from "../experiment/assembly/mod.ts";
import { resolveVariant, type Variant } from "../experiment/variant/mod.ts";
import { attachRealModels } from "../provider/mod.ts";
import { agentRefOf } from "../restore/mod.ts";
import { isCodingAgent, type Participant } from "../types.ts";
import { systemClock } from "../../../packages/base/mod.ts";
import { REPO_ROOT } from "./paths.ts";
import { runSteps } from "./steps.ts";
import { type Held, prepareTrialWorld, releaseWorld } from "./world.ts";

// trial과 같은 길로 시나리오를 돌리되 real 참가자의 model만 endpoint(fake provider)로 보낸다. judge와 check는 돌리지 않는다.
export function createReplayPort(
  log: (line: string) => void = console.log,
): ReplayPort {
  const variants = new Map<string, Variant>();
  return {
    async run({ scenario, checkout, model, endpoint }) {
      const key = checkout ?? "";
      let variant = variants.get(key);
      if (variant === undefined) {
        const resolved = await resolveVariant({
          checkout: checkout ?? undefined,
          current: REPO_ROOT,
        });
        if (!resolved.ok) throw new Error(resolved.error.message);
        variant = resolved.value;
        variants.set(key, variant);
      }
      const held: Held = {};
      try {
        const { core, ctx } = await prepareTrialWorld(
          { variant },
          scenario,
          held,
        );
        await attachRealModels(core, {
          key: "replay",
          model,
          real: scenario.real.filter((p): p is Participant => !isCodingAgent(p))
            .map((p) => agentRefOf(ctx.world, p)),
          endpoint,
        });
        const settle = await runSteps({
          core,
          setup: ctx,
          scenario,
          roots: new Map(),
          fake: new Set(),
          startedMs: systemClock.nowMs(),
          clock: systemClock,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          log,
        });
        return { settle };
      } finally {
        await releaseWorld(held);
      }
    },
  };
}
