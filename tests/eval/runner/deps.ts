import { systemClock } from "../../../packages/base/mod.ts";
import type { Variant } from "../experiment/variant/mod.ts";
import type { JudgeDefinition } from "../judge/mod.ts";
import type { Criterion, SourceInfo } from "../types.ts";
import { EVAL_DIR, REGISTRY_DIR } from "./paths.ts";
import type { TrialDeps } from "./trial.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// run마다 다른 runId만 빼고 trial이 쓰는 값을 모은다.
export function trialDepsOf(args: {
  key: string;
  model: string;
  effort?: string;
  variant: Variant;
  trialBudgetUsd: number;
  keep?: boolean;
  source: SourceInfo;
  judge: JudgeDefinition;
  repeatCriterion: Criterion;
}): Omit<TrialDeps, "runId"> {
  const { variant } = args;
  return {
    clock: systemClock,
    sleep,
    key: args.key,
    model: args.model,
    effort: args.effort,
    evalDir: EVAL_DIR,
    source: args.source,
    judge: args.judge,
    log: console.log,
    registryDir: REGISTRY_DIR,
    trialBudgetUsd: args.trialBudgetUsd,
    variant,
    keep: args.keep,
    repeatCriterion: args.repeatCriterion,
    live: new Set(),
  };
}
