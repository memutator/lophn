# ex-select

committed run 요약에서 experiment가 다시 돌릴 시나리오를 고른다. 바꾸는 component X@a를 본 기준 run을 target, guard, 그대로 쓰는 것(keep)으로 나누고, 기준 쪽 trial 결과를 모아 둔다. 기준 run은 다시 돌리지 않고 있는 그대로 쓴다.

- 단위: ex-select (wave 2)
- 선행: ex-spec
- 소유(이 task만 고친다):
  - `tests/eval/experiment/select/**`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "experiment"(다시 돌린다 / 돌리지 않는다 / 기준 쪽도 새로 돌리지 않는다, 예), "trial 수"(같은 구성으로 돈 trial은 experiment를 넘어 쌓인다), "scorecard"(낡은 run은 표시만)
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것": 기준 구성은 main checkout에서 잰 버전이다, guard는 spec에 쓰지 않고 run 기록으로 program이 고른다)
  - 먼저 끝난 brief: `project-docs/plan/eval-experiment/tasks/ex-spec.md`(type과 세는 함수)
  - 지금 코드(main에 있다): `tests/eval/scorecard/pick.ts`(`Current`, `staleReasons`와 낡음의 이유 규칙), `tests/eval/types.ts`(`RunRecord`의 `components`, `scenario`, `source`), `tests/eval/versions/components.ts`(`currentVersions`의 키 `${kind}:${name}`)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`(main에 있다): `RunRecord`, `TrialResult`(`components?`는 ex-spec이 더한다), `Scenario`, `VersionRef`, `refText`
    - `tests/eval/scorecard/pick.ts`: `type Current = { scenarios: Pick<Scenario, "id" | "n" | "proposal" | "world" | "checks">[]; versions: Map<string, VersionRef>; judge: VersionRef | null; model: string }`, `staleReasons(run: RunRecord, scenario: Current["scenarios"][number], current: Current): string[]`(비어 있으면 유효한 run)
    - `tests/eval/experiment/spec/mod.ts`(ex-spec): `ExperimentSpec`, `PlanEntry`, `Role`, `Outcome`(`components` 칸 포함), `outcomeOf(trial: TrialResult, runComponents: VersionRef[]): Outcome`
    - `packages/base/mod.ts`: `Result`, `ok`, `err`
  - 내놓는 것(`tests/eval/experiment/select/mod.ts`):
    - `selectRuns(spec, runs, current): Result<Plan>`
    - `changedComponents(base: Map<string, VersionRef>, variant: Map<string, VersionRef>): { from: VersionRef; to: VersionRef }[]`
    - `type Plan = { entries: PlanEntry[]; keep: { scenario: string; runs: string[] }[]; excluded: { scenario: string; reason: string }[] }`
    - ex-cli가 `entries`로 trial을 돌리고, ex-verdict가 `entries`와 `keep`, `excluded`를 결과에 옮긴다.

## 할 일

1. **기준 run 모으기** (`baseline.ts`). `current`는 호출하는 쪽(ex-cli)이 **기준(main) checkout**의 `currentVersions`로 만든다. variant checkout의 것이 아니다. 이유: 채택은 고친 것을 main에 넣는 것이라 기준 구성은 main에서 잰 버전이다(README). 낡음 규칙은 `scorecard/pick.ts`의 `staleReasons` 그대로 쓴다. 새로 쓰지 않는다.

```ts
export type Baseline = {
  valid: RunRecord[];     // staleReasons가 비어 있는 run. started_at 오름차순
  saw: RunRecord[];       // valid 가운데 X@a(kind·name·n이 모두 같은 것)를 본 run. run.components(합집합)에 든 것
  stale_saw: { run: string; reasons: string[] }[];   // 낡았지만 X@a를 본 run. 가장 늦은 것 하나만
};
// current.scenarios의 시나리오마다 한 번. runs 가운데 run.scenario.name === scenario.id 인 것만 본다.
export function baselineOf(runs: RunRecord[], scenario: Current["scenarios"][number], current: Current, from: VersionRef): Baseline;
```

   - 기준 쪽 trial은 **valid한 run 전부**의 trial을 쌓는다(가장 늦은 하나만이 아니다). 이유: roadmap "같은 구성으로 돈 trial은 experiment를 넘어 쌓인다. 기준 쪽 통과율은 점점 정확해진다". 쌓는 것은 `saw`(X@a를 본 valid run)만이다. 이유: X를 안 본 run은 이 고침의 대상이 아니라 비교의 기준이 못 된다.
   - trial 단위로도 거른다: `saw` run의 trial을 `outcomeOf(trial, run.components)`로 바꾸고, `Outcome.components`에 X@a가 든 것만 남긴다. `TrialResult.components`가 있는 run은 X를 안 본 trial이 빠지고, 없는 옛 요약은 `run.components`(합집합)를 받으므로 trial이 모두 남는다.
   - run은 JSON 안의 `id`로 가리킨다(`baseline_runs`, `stale_saw.run`). file 이름을 쓰지 않는다.
   - `stale_saw`: valid가 아닌 run 가운데 X@a를 본 것. 그 시나리오를 다시 돌려도 기준이 없으므로 `excluded`에 이유(`staleReasons`의 첫 두 줄을 `; `로 이은 글)와 함께 올린다.
2. **고르기** (`select.ts`).

```ts
export function selectRuns(spec: ExperimentSpec, runs: RunRecord[], current: Current): Result<Plan>;
```

   - 먼저 `current.versions.get("<kind>:<name>")`가 `spec.change.from`과 같은지 본다. 다르면 `conflict`(ex-spec의 `checkSpecAgainst`가 이미 보지만 이 함수가 혼자 불려도 틀린 기준으로 고르지 않게 한다).
   - `current.scenarios`마다 `baselineOf`를 구한 뒤 역할을 정한다. 우선순위는 이 순서다.
     1. spec의 `target`에 든 시나리오 → role `target`, `checks`는 Goal의 것 또는 null. `saw`가 비면 문제다: valid run이 하나도 없으면 `conflict`("기준 run이 없다. 먼저 `deno task eval --scenario <id>`로 기준을 만들어라"), valid는 있는데 X@a를 본 것이 없으면 `invalid_input`("target이 X@a를 보지 않았다. 가설이 이 시나리오에 닿지 않는다"). 문제는 모아서 한 번에 돌려준다(`details.problems`).
     2. spec의 `cases`에 든 시나리오 → role `case`. 기준이 없어도 된다(미리 써 둔 새 case는 아직 돈 적이 없다). 기준 run이 있으면 `saw`의 것을 담는다.
     3. `saw`가 비지 않은 나머지 → role `guard`, `checks: null`.
     4. `valid`가 있고 `saw`가 비었다 → `keep`(그 valid run의 id 목록). X를 보지 않았으니 X@b가 기준이 되어도 결과가 그대로 유효하다(roadmap).
     5. `valid`가 없고 `stale_saw`가 있다 → `excluded`.
     6. 나머지(run이 없거나, 모두 낡았는데 X를 본 적도 없다) → 아무 데도 올리지 않는다.
   - `PlanEntry`: `scenario`, `n`(`current.scenarios`의 n), `role`, `checks`, `baseline_runs`(`saw`의 id, started_at 오름차순), `baseline`(위 trial 단위로 거른 `Outcome`을 run 순서, `trial.index` 순서로).
   - 정렬: `entries`는 role(target, case, guard) 다음 시나리오 id 순. `keep`·`excluded`는 시나리오 id 순.
3. **바뀐 component** (`changed.ts`). variant checkout의 `currentVersions`와 기준의 것을 비교한다. ex-cli가 두 Map을 넘겨 `changed`를 얻고 ex-verdict에 준다.

```ts
// 양쪽에 있고 n이 다른 키만. 키는 `${kind}:${name}`, core와 checks도 포함한다(core나 checks가 같이 바뀌면 섞인 결과로 읽어야 한다).
// 한쪽에만 있는 키는 건너뛴다(새 skill이 더해진 것 등은 registry를 오르는 일이라 ex-verdict가 reasons에 적는다).
export function changedComponents(base: Map<string, VersionRef>, variant: Map<string, VersionRef>): { from: VersionRef; to: VersionRef }[];
```

   - 키 순서로 정렬한다.
4. `mod.ts`가 위 export를 다시 내보낸다.
5. test를 `tests/eval/experiment/select/select_test.ts`에 쓴다. 손으로 만든 `RunRecord`와 `Current`만 쓴다. 파일 시스템과 시각을 쓰지 않는다.

## 정한 것

- 기준 쪽은 valid한 run 전부의 trial을 쌓는다. 가장 늦은 run 하나만 쓰지 않는다. 이유: 위 1번. trial 정책(ex-trials)과 판정(ex-verdict)은 기준 쪽 통과율이 여러 trial로 쌓인 값이라고 가정한다. 단, X@a를 본 run으로 한정한다.
- 시나리오의 n은 지금 checkout의 것이다. 시나리오 n이 올랐으면 옛 run은 `staleReasons`가 낡았다고 해서 기준에서 빠진다. 새 기준을 만들려면 사람이 먼저 `deno task eval`을 돌려야 한다.
- 낡은 run으로 기준을 만들지 않는다. 이유: 낡은 run은 기준 구성(main)에서 잰 값이 아니다(roadmap "scorecard: 낡은 run은 표시만"). 대신 `excluded`로 드러내 experimenter가 사람에게 기준을 먼저 만들자고 말하게 한다.
- case는 target처럼 기준이 필요하지 않다. 대신 case에 기준 run이 이미 있으면 `baseline`에 담아 ex-verdict가 보여 줄 수 있게 한다(판정에는 쓰지 않는다. ex-verdict의 규칙 참조).
- 시나리오 하나가 target과 case에 모두 있으면 ex-spec의 `parseSpec`이 거절한다. 이 함수는 그것을 다시 보지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`select_test.ts`, 하나):
  - "X@a를 본 valid run의 시나리오만 target·guard로 골라 기준 trial을 쌓고, 지금 버전과 다른 run은 기준에서 빼 excluded에 올리고, X를 보지 않은 valid run은 keep에 두며, target에 기준이 없으면 거절한다": run 몇 개(`instruction:lophn@3`을 보고 지금 버전과 같은 run 둘이 같은 시나리오에 있어 trial이 쌓이는 것, trial 단위 `components`가 있는 run에서 X를 안 본 trial이 빠지는 것, 같은 X를 봤지만 다른 component가 지금과 달라 낡은 run, X를 안 본 valid run, target인데 valid run이 없는 경우)와 `Current`로 `selectRuns`. 다시 돌릴 대상이 이 선택 하나로 정해지고, 틀리면 돈을 쓰고도 엉뚱한 시나리오를 재거나 기준 없이 판정하게 된다.
- 남지 않음: 해당 없음(새 코드).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `scorecard/pick.ts`의 `staleReasons`·`Current`가 위 모양과 다르면 맞춘 이름을 적는다. 고치지 않는다(`ex-judge-agent`가 `scorecard/**`를 고치지만 `pick.ts`는 바꾸지 않는다).
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: `TrialResult.components`가 없는 옛 run 요약은 run의 합집합으로 대신하므로 X를 안 본 trial이 기준 통과율에 섞인다. 새 run은 ex-cli가 `components`를 채운다.
