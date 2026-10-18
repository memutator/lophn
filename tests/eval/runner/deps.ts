import { systemClock } from "../../../packages/base/mod.ts";
import { ensureWrapper } from "../coding/driver/mod.ts";
import type { Variant } from "../experiment/variant/mod.ts";
import type { JudgeDefinition } from "../judge/mod.ts";
import type { Criterion, SourceInfo } from "../types.ts";
import { EVAL_DIR, mainCheckout, REGISTRY_DIR } from "./paths.ts";
import type { TrialDeps } from "./trial.ts";
import { binDirOf } from "./world.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// run마다 다른 runId와 saved만 빼고 trial이 쓰는 값을 모은다. coding 시나리오가 있으면 wrapper를 pool 전에 한 번 쓴다.
// 이유: trial마다 prepareCodingAgent가 같은 호출을 하지만 내용이 같으면 쓰지 않으므로, 병렬 trial 둘이 처음에 같은 file을 동시에 쓰다 hook이 반쯤 쓰인 wrapper를 여는 일을 없앤다.
export async function trialDepsOf(args: {
  key: string;
  model: string;
  variant: Variant;
  trialBudgetUsd: number;
  saveEnabled: boolean;
  coding: boolean;
  source: SourceInfo;
  judge: JudgeDefinition;
  repeatCriterion: Criterion;
}): Promise<Omit<TrialDeps, "runId" | "saved">> {
  const { variant } = args;
  const binDir = await binDirOf(variant, EVAL_DIR);
  const hookRoot = args.coding ? await mainCheckout() : variant.root;
  if (args.coding) {
    await ensureWrapper(binDir, variant.root);
    if (hookRoot !== variant.root) {
      await ensureWrapper(`${hookRoot}/.dev-data/eval/bin`, hookRoot);
    }
  }
  return {
    clock: systemClock,
    sleep,
    key: args.key,
    model: args.model,
    evalDir: EVAL_DIR,
    source: args.source,
    judge: args.judge,
    log: console.log,
    registryDir: REGISTRY_DIR,
    trialBudgetUsd: args.trialBudgetUsd,
    variant,
    hookRoot,
    binDir,
    home: Deno.env.get("HOME") ?? "",
    saveEnabled: args.saveEnabled,
    repeatCriterion: args.repeatCriterion,
    live: new Set(),
  };
}
