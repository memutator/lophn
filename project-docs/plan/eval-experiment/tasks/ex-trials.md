# ex-trials

experiment의 trial 정책을 program 규칙으로 만든다: 기본은 1번, guard가 기준과 다른 verdict를 내면 그 case만 3번까지, target이 통과하면 3번까지, 같은 버전에서 trial끼리 결과가 갈린 적이 있는 시나리오는 처음부터 3번. 갈린 적이 있는지는 쌓인 run 요약에서 찾는다. 돈을 쓰기 전에 trial 수와 비용의 어림을 낸다.

- 단위: ex-trials (wave 2)
- 선행: ex-spec
- 소유(이 task만 고친다):
  - `tests/eval/experiment/trials/**`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "trial 수"(정책 네 줄, "이 정책은 experiment의 판정 규칙에 같이 적는다"), "experiment"의 예(guard 6 × 1 + target 2 × 1~3 = 8~12 trial. 늘 3번씩이면 24 trial)
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 trial 정책)
  - 먼저 끝난 brief: `project-docs/plan/eval-experiment/tasks/ex-spec.md`(`Policy`, `Role`, `Outcome`, `PlanEntry`, `outcomeOf`, `goalPassed`, `tallyOf`, `poolVerdict`), `project-docs/plan/eval-base/tasks/ev-contract.md`(`RunRecord`의 `scenario`, `materials`, `components`, `core`, `grader`, `model`, `trials`)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`(main에 있다): `RunRecord`, `TrialResult`(`components?`는 ex-spec이 더한다), `refText`
    - `tests/eval/experiment/spec/mod.ts`(ex-spec): `Policy = { base: number; max: number }`, `Role`, `Outcome = { index; passed; checks: Record<string, boolean>; cost_usd; components }`, `PlanEntry`, `outcomeOf`, `goalPassed(o, checks)`, `goalState(o, checks): "pass" | "fail" | "pending"`, `tallyOf(outcomes, checks)`(채점 대기 trial은 `Tally.pending`에만 센다), `poolVerdict(tally): "pass" | "fail" | "split" | "none"`, `outcomeOf(trial, runComponents)`
  - 내놓는 것(`tests/eval/experiment/trials/mod.ts`):
    - `nextTrials(state: TrialState, policy: Policy): number`
    - `flakyScenarios(runs: RunRecord[], scenarios: { id: string; n: number }[]): Set<string>`
    - `estimateTrials(entries: { entry: PlanEntry; flaky: boolean }[], policy: Policy): Estimate`
    - ex-cli가 "돌릴 수 = `nextTrials`가 0이 될 때까지" 반복한다. ex-verdict는 이 함수를 부르지 않는다. ex-cli가 `nextTrials`의 결과를 `remaining`으로 넘긴다.

## 할 일

1. **다음에 몇 번 더 돌리나** (`policy.ts`). 한 시나리오의 지금 상태에서 variant trial을 몇 번 더 돌릴지 돌려준다. 0이면 그 시나리오는 끝이다.

```ts
export type TrialState = {
  role: Role;
  checks: string[] | null;     // PlanEntry.checks
  baseline: Outcome[];         // PlanEntry.baseline
  variant: Outcome[];          // 이 experiment가 지금까지 돈 variant trial
  flaky: boolean;              // flakyScenarios에 든 시나리오인가
};
export function nextTrials(state: TrialState, policy: Policy): number;
```

   규칙은 이 순서로 처음 맞는 것이 이긴다. `n = state.variant.length`, `start = flaky ? policy.max : policy.base`.
   1. `n >= policy.max` → 0.
   2. `n < start` → `start - n`. 처음 단계다. 흔들리는 시나리오는 처음부터 `max`번 돈다.
   3. target과 case(결과가 판정을 정하는 쪽): variant에 `goalState(o, state.checks) === "pending"`인 trial이 하나라도 있으면 0(채점이 들어올 때까지 정하지 않는다. ex-cli는 채점 뒤 이 함수를 다시 부른다). 아니고 `goalPassed(o, state.checks)`인 trial이 하나라도 있으면 `policy.max - n`, 없으면 0. 이유: roadmap "target이 나아지면 더 돌려 확인한다. 채택을 한 번의 결과로 정하지 않는다. 나아지지 않으면 거기서 멈춘다". case도 채택을 정하므로 같은 눈금으로 센다.
   4. guard: variant에 `goalState(o, null) === "pending"`인 trial이 있으면 0(위와 같은 이유). 아니면 `poolVerdict(tallyOf(state.variant, null))`가 `poolVerdict(tallyOf(state.baseline, null))`와 다르면 `policy.max - n`, 같으면 0. 이유: roadmap "guard가 기준과 다른 verdict를 내면 그 case만 더 돌려, 우연인지 나빠진 것인지 가른다". 기준이 `split`(기준 쪽에서 trial끼리 갈렸다)이면 variant가 `pass`나 `fail`이어도 다르므로 늘린다. 기준 verdict가 `fail`인데 variant가 `pass`로 나아져도 다르므로 늘린다(README는 "다른 verdict"라고만 했다. 나아진 쪽을 건너뛰면 아끼지만 정책을 글자 그대로 따랐다).
2. **갈리는 시나리오** (`flaky.ts`). "같은 버전"은 run이 가리킨 버전이 모두 같은 것이다.

```ts
// scenario(이름@n), materials, components, core, grader(criteria, judge, checks), model을 refText로 정렬해 이은 글.
// components는 trial.components가 있으면 그것을, 없으면 run.components(합집합)를 쓴다.
// source(commit, dirty)는 뺀다: commit이 달라도 같은 버전이면 같은 구성이다.
export function versionKey(run: RunRecord, trial: TrialResult): string;
// scenarios의 (id, n)마다: run.scenario.name === id 이고 run.scenario.n === n 인 run의 trial을 versionKey로 묶고,
// 묶음 안의 trial(outcomeOf)에 passed가 true와 false가 모두 있으면 그 id를 담는다.
// run은 file 이름이 아니라 JSON 안의 id로 가리킨다.
export function flakyScenarios(runs: RunRecord[], scenarios: { id: string; n: number }[]): Set<string>;
```

   - run 하나가 trial 둘 이상을 가져 안에서 갈린 것도 같은 묶음이라 잡힌다(trial마다 본 component가 다르면 묶음이 갈린다). 다른 run과 묶음이 같으면 그 trial도 한데 센다.
   - 세는 대상은 모든 run이다. 기준 run뿐 아니라 이전 experiment의 variant run도 들어 있다(`tests/eval/runs/`에 같은 형식으로 쌓인다). 그러니 X@b로 돈 run과 X@a로 돈 run은 `components`가 달라 묶음이 갈린다. 서로 섞이지 않는다.
   - 시나리오 n이 지금과 다른 run은 센 적 없다. 이유: 시나리오를 고치면 다른 시나리오다.
   - timeout으로 떨어진 trial(`settle.kind === "timeout"`)도 `passed: false`로 센다. 이유: 같은 버전에서 어떨 땐 통과하고 어떨 땐 멈췄다면 흔들리는 것이다.
3. **어림** (`estimate.ts`). roadmap "experiment"는 예산 칸에 "돌기 전에 어림을 찍는다"고 한다. ex-cli가 시작 전에 찍고, 상한(`spec.budget_usd`)이 worst보다 작으면 경고한다.

```ts
export type Estimate = {
  trials: { min: number; likely: number; worst: number };
  usd: { min: number; likely: number; worst: number };
  unpriced: string[];   // 기준 trial이 없어 시나리오 평균으로 값을 어림한 시나리오 id
};
export function estimateTrials(entries: { entry: PlanEntry; flaky: boolean }[], policy: Policy): Estimate;
```

   - 시나리오마다 trial 수: `min` = `flaky ? max : base`. `likely` = target과 case는 `max`, guard는 `min`과 같다(guard는 기준과 달라질 때만 늘고, 대개 같다). `worst` = 모두 `max`. 예: guard 6 + target 2에서 base 1, max 3이면 min 8, likely 12, worst 24(roadmap의 예와 같다).
   - 비용: 시나리오마다 trial 하나의 값은 `entry.baseline`의 `cost_usd` 평균이다. 기준 trial이 없으면(case) 모든 entry의 baseline 평균을 쓰고 그 id를 `unpriced`에 담는다. 아무 기준도 없으면 0이다. variant 쪽 값은 기준과 같다고 어림한다(X@b가 prompt를 늘려 비용이 달라질 수 있다. 어림이다).
4. `mod.ts`가 위를 다시 내보낸다.
5. test를 `tests/eval/experiment/trials/trials_test.ts`에 쓴다. 손으로 만든 `Outcome`과 `RunRecord`만 쓴다.

## 정한 것

- `nextTrials`는 "몇 번 더"를 돌려주고 한 번에 한 trial씩 시키지 않는다. 이유: 한 시나리오의 늘어난 trial은 서로 기대지 않아 같이 돌릴 수 있다(ex-parallel). 단계는 많아야 둘(처음, 늘리기)이다.
- 같은 버전의 묶음은 `versionKey`가 정확히 같은 trial끼리다. `TrialResult.components`가 있으면 trial마다 본 component로 묶는다. 없는 옛 요약은 run의 합집합으로 대신하므로 그 run은 묶음이 거칠다.
- case를 target과 같은 쪽으로 센다(통과하면 `max`까지). 이유: 둘 다 채택을 정하므로 한 번의 통과로 정하지 않는다.
- 기준 쪽 통과율이 높은 target을 건너뛰지 않는다. 이미 기준에서 통과한 target이면 ex-verdict가 `not_improved`로 기각한다. 이유: 이 일은 spec의 가설이 틀렸다는 것을 드러내는 일이고, trial 정책이 판정을 미리 알고 건너뛰면 규칙이 두 군데에 있게 된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`trials_test.ts`, 둘):
  - "trial 정책이 돈을 정한다: 처음엔 base번, 흔들리는 시나리오는 처음부터 max번, target·case는 통과가 하나라도 있어야 max까지 늘고 통과가 없으면 멈추며, guard는 기준과 verdict가 다를 때만 늘고 같으면 멈추고, max를 넘지 않는다": `nextTrials`를 표로(role마다 몇 줄, `split` 기준 한 줄 포함).
  - "같은 버전의 trial끼리 갈린 시나리오만 흔들린다고 하고, 버전이 다른 run끼리의 차이와 시나리오 n이 다른 run은 세지 않는다": 손으로 만든 `RunRecord` 몇 개로 `flakyScenarios`(한 run 안의 갈림, 같은 `versionKey`의 두 run 사이의 갈림, `components`가 다른 두 run 사이의 차이, 같은 run 안에서 trial의 `components`가 달라 묶음이 갈리는 경우).
- 남지 않음: 해당 없음(새 코드).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약(ex-spec의 type, `tests/eval/types.ts`)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 어림은 variant 비용이 기준과 같다고 본다. 첫 실제 experiment에서 잰 값으로 바꾼다.
