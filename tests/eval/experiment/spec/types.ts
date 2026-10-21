import type { JudgeItem, VersionKind, VersionRef } from "../../types.ts";

// experiment로 바꿀 수 있는 component. grader(scenario, criterion, judge, checks)와 core, 재료는 대상이 아니다
// (grader는 지금 checkout에 고정하고 core는 experiment 대상이 아니다). model과 cli는 checkout을 바꾸는 길이 아니라 뺀다.
export const EXPERIMENT_KINDS: readonly VersionKind[] = [
  "instruction",
  "skill",
  "skill-description",
  "tool",
  "assembly",
  "runtime",
  "template",
];

// 시나리오 id(n 없음)와 보는 check. checks를 빼면 trial 전체의 통과를 본다.
export type Goal = { scenario: string; checks?: string[] };

export type Policy = { base: number; max: number }; // trial 수: 처음에 도는 수와 상한

export type ExperimentSpec = {
  id: string; // 폴더 이름. /^[a-z0-9][a-z0-9-]*$/
  hypothesis: string; // 무엇이 왜 나아지나
  start_run: string; // 출발점 RunRecord.id. 고치게 된 실패를 보인 run
  model: string; // 기준 model(예 claude-sonnet-5-5). 기준 run을 고를 때 낡음 판정에 쓴다
  change: { from: VersionRef; to: VersionRef }; // X@a → X@b. 같은 kind·name, n만 다르다
  target: Goal[]; // 나아져야 할 것. 하나 이상
  cases: Goal[]; // 고치기 전에 미리 써 둔 같은 규칙의 case. 하나 이상. target과 시나리오가 겹치지 않는다
  judgment: { rule: "default@1" }; // 판정 규칙의 이름. 계산은 ex-verdict가 한다
  trials: Policy; // 1 <= base <= max <= 5
  budget_usd: number; // experiment 하나의 $ 상한. 0보다 크다
};

export type Role = "target" | "guard" | "case";

// 한 trial의 결과 한 줄. 모든 task가 같은 눈금으로 세려고 여기서 만든다.
// components = 그 trial에서 진짜 model이 본 것. TrialResult.components가 없으면 run의 합집합을 쓴다(outcomeOf의 둘째 인자).
// state = trial 전체의 상태. 채점 대기인 judge check가 있고 이미 떨어진 것이 없으면 "pending"(아직 정해지지 않았다).
// pending = 채점 대기인 judge check id. passed = (state === "pass").
// checks에서 채점 대기 check는 false로 둔다. 통과가 아니라 정해지지 않은 것이라 pending에서 가른다.
export type OutcomeState = "pass" | "fail" | "pending";
export type Outcome = {
  index: number;
  passed: boolean;
  state: OutcomeState;
  pending: string[];
  checks: Record<string, boolean>;
  cost_usd: number;
  components: VersionRef[];
};
// trials = 정해진 trial 수(pass + fail). pending = 채점 대기라 세지 않은 trial 수.
export type Tally = { passed: number; trials: number; pending: number };
export type PoolVerdict = "pass" | "fail" | "split" | "none";

// ex-select가 고르고 ex-trials, ex-verdict가 읽는 한 시나리오의 자리.
export type PlanEntry = {
  scenario: string; // 시나리오 id
  n: number; // 지금 checkout의 시나리오 n
  role: Role;
  checks: string[] | null; // Goal.checks. guard는 null
  baseline_runs: string[]; // 기준으로 쓴 RunRecord.id. case는 비어 있을 수 있다
  baseline: Outcome[]; // 그 run들의 trial 전부
};

export type ScenarioResult = {
  scenario: string;
  n: number;
  role: Role;
  checks: string[] | null;
  baseline_runs: string[];
  baseline: Tally;
  variant_runs: string[];
  variant: Tally;
  remaining: number; // 정책이 더 돌리라고 한 trial 수. 0이 아니면 아직 끝나지 않았다
  status: "ok" | "fail" | "not_improved" | "worse" | "incomplete";
  weaker: boolean; // guard: 통과율은 기준보다 낮지만 worse는 아니다
  note: string; // 한 줄
};

export type ExperimentResult = {
  id: string;
  decision: "adopt" | "reject" | "inconclusive";
  rule: "default@1";
  spec_hash: string; // spec.json byte의 sha256. 돌린 뒤 spec이 바뀌면 드러난다
  spec_commit: string | null;
  changed: { from: string; to: string }[]; // refText. 기준 checkout과 variant checkout의 버전이 다른 것 전부
  mixed: boolean; // changed가 spec.change 하나가 아니다
  scenarios: ScenarioResult[];
  keep: { scenario: string; runs: string[] }[]; // X를 보지 않아 다시 돌리지 않은 것
  excluded: { scenario: string; reason: string }[]; // 낡아서 기준이 못 된 것
  reasons: string[]; // 판정 이유, 한 줄씩
  cost_usd: number;
  stopped_by_budget: boolean;
  decided_at: string;
  // 진단. 판정에 들지 않는다. 아래 세 type은 ex-overfit, ex-repeat, ex-assembly가 import한다.
  overfit?: OverfitWarning[];
  repeats?: RepeatFinding[];
  assembly?: AssemblyReport[];
};

// ex-overfit이 낸다. scenario는 `id@n`, component는 `kind:name@a→@b` 글, line은 더해진 줄(160자까지).
export type OverfitWarning = {
  scenario: string;
  component: string;
  file: string;
  kind: "name" | "phrase";
  term: string;
  line: string;
};

// ex-repeat이 낸다. 같은 tool을 같은 인자로 3번 이상 부른 곳 하나를 repeat-kind judge가 본 결과.
// trial과 key는 채점 대기 entry를 다시 찾는 칸이고(key는 ex-judge-agent의 judgeKey(trial, check)),
// item은 만든 때의 대기 item이다. 채점이 들어온 최신 item은 key의 entry에서 읽는다.
export type RepeatFinding = {
  trial: number;
  session: string;
  tool: string;
  count: number;
  calls: string[];
  key: string;
  item: JudgeItem;
};

// ex-assembly가 낸다. layer별 prefix hash가 앞 call과 같은 비율을 녹화한 쪽(baseline)과 다시 조립한 쪽(variant)에서 잰 값.
export type LayerStat = {
  layer: string;
  pairs: number; // 앞 call과 견준 쌍의 수 (calls - 1)
  stable: number; // 앞 call과 hash가 같은 쌍의 수
  rate: number | null; // stable / pairs. pairs가 0이면 null
  first_break: { call: number; before: string; after: string } | null; // call은 1부터. 층이 없어졌거나 새로 생기면 "(absent)"
};
export type SideStat = { calls: number; layers: LayerStat[] };
export type AssemblyReport = {
  run: string;
  trial: number;
  session: string | null;
  status: "ok" | "diverged" | "not_replayable";
  reason: string | null;
  diverged_at: number | null;
  compared_calls: number;
  identical_calls: number;
  baseline: SideStat | null;
  variant: SideStat | null;
};
