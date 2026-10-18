import type { VersionRef } from "../../types.ts";
import type {
  AssemblyReport,
  ExperimentSpec,
  Outcome,
  OverfitWarning,
  PlanEntry,
  RepeatFinding,
} from "../spec/mod.ts";

export type VerdictEntry = PlanEntry & {
  variant_runs: string[]; // 이 experiment가 X@b로 돈 RunRecord.id
  variant: Outcome[]; // 그 run들의 trial 전부(outcomeOf)
  remaining: number; // ex-trials의 nextTrials 결과. 0이 아니면 아직 끝나지 않았다(예산이 끊었다 등)
};

export type VerdictInput = {
  spec: ExperimentSpec;
  spec_hash: string; // ex-spec readSpec의 hash
  spec_commit: string | null; // ex-spec checkSpecLocked의 결과
  changed: { from: VersionRef; to: VersionRef }[]; // ex-select changedComponents(기준, variant)
  entries: VerdictEntry[]; // ex-select의 Plan.entries에 variant를 붙인 것
  keep: { scenario: string; runs: string[] }[];
  excluded: { scenario: string; reason: string }[];
  stopped_by_budget: boolean;
  decided_at: string; // Clock.now(). 함수 안에서 시각을 읽지 않는다
  // 진단. 판정에 쓰지 않고 result에 그대로 옮긴다.
  overfit?: OverfitWarning[];
  repeats?: RepeatFinding[];
  assembly?: AssemblyReport[];
};
