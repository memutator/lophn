import {
  type BootOptions,
  type Core,
  createRun,
  type Run,
} from "../../support/core/mod.ts";
import { explainBreak, type Variant } from "../experiment/variant/mod.ts";
import { evalCoreSettings } from "../provider/mod.ts";
import {
  beginRestore,
  endRestore,
  restoreCoreEnv,
  restoreWorld,
} from "../restore/mod.ts";
import type { Scenario, SetupContext } from "../types.ts";

// trial과 gate의 dry run, assembly 재생이 같은 환경으로 core를 띄운다. 다르면 active app 재료의 되살리기가 한쪽에서만 통과하거나 깨진다.
export async function bootOptionsOf(scenario: Scenario): Promise<BootOptions> {
  return {
    settings: evalCoreSettings(scenario),
    env: await restoreCoreEnv(scenario.world),
  };
}

// 만든 것을 바로 쥐여 준다. 중간에 던져도 부른 쪽 finally가 core를 끄고 run을 지운다.
export type Held = { run?: Run; core?: Core; ctx?: SetupContext };

// createRun → boot → 재료 되살리기 → setup. 끝나면 fake provider를 닫고 root에 model이 어디에도 없다.
export async function prepareTrialWorld(
  deps: { variant: Variant },
  scenario: Scenario,
  held: Held = {},
): Promise<{ run: Run; core: Core; ctx: SetupContext }> {
  const { variant } = deps;
  const run = held.run = await createRun();
  let core: Core;
  try {
    core = held.core = await variant.boot(run, await bootOptionsOf(scenario));
  } catch (error) {
    throw new Error(explainBreak(variant, "boot", messageOf(error)));
  }
  try {
    const ctx = held.ctx = await beginRestore(core);
    const restored = await restoreWorld(ctx, scenario.world);
    if (!restored.ok) {
      throw new Error(`되살리기 실패: ${restored.error.message}`);
    }
    await scenario.setup?.(ctx); // 안 쓴 fake는 endRestore가 닫는다. setup이 fake를 쓰므로 endRestore 앞이다
    await endRestore(ctx);
    return { run, core, ctx };
  } catch (error) {
    throw new Error(explainBreak(variant, "restore", messageOf(error)));
  }
}

// held를 끄고 지운다. 각 정리가 실패해도 다음을 한다.
export async function releaseWorld(held: Held): Promise<void> {
  await held.ctx?.fake.close().catch(() => {});
  await held.core?.stop().catch(() => {});
  await held.run?.remove().catch(() => {});
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
