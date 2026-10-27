import {
  type BootOptions,
  type Core,
  createRun,
  type Run,
} from "../../support/core/mod.ts";
import { explainBreak, type Variant } from "../experiment/variant/mod.ts";
import { evalCoreSettings } from "../provider/mod.ts";
import { restoreContext, restoreWorld } from "../restore/mod.ts";
import type { RestoreContext, Scenario } from "../types.ts";

// trial과 gate의 dry run, assembly 재생이 같은 설정으로 core를 띄운다.
function bootOptions(): BootOptions {
  return { settings: evalCoreSettings() };
}

// 만든 것을 바로 쥐여 준다. 중간에 던져도 부른 쪽 finally가 core를 끄고 run을 지운다.
export type Held = { run?: Run; core?: Core };

// createRun → boot → 재료 되살리기.
export async function prepareTrialWorld(
  deps: { variant: Variant },
  scenario: Scenario,
  held: Held = {},
): Promise<{ run: Run; core: Core; ctx: RestoreContext }> {
  const { variant } = deps;
  const run = (held.run = await createRun());
  let core: Core;
  try {
    core = held.core = await variant.boot(run, bootOptions());
  } catch (error) {
    throw new Error(explainBreak(variant, "boot", messageOf(error)));
  }
  try {
    const ctx = restoreContext(core);
    const restored = await restoreWorld(ctx, scenario.world);
    if (!restored.ok) {
      throw new Error(`되살리기 실패: ${restored.error.message}`);
    }
    return { run, core, ctx };
  } catch (error) {
    throw new Error(explainBreak(variant, "restore", messageOf(error)));
  }
}

// held를 끄고 지운다. 각 정리가 실패해도 다음을 한다.
export async function releaseWorld(held: Held): Promise<void> {
  await held.core?.stop().catch(() => {});
  await held.run?.remove().catch(() => {});
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
