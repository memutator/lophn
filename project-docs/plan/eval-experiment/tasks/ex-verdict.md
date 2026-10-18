# ex-verdict

판정 규칙 `default@1`을 program으로 계산해 채택·기각·결론 못 냄을 정하고 `result.json`을 쓴다. 채택하려면 target과 미리 써 둔 case가 모두 통과하고 guard가 기준보다 나빠지지 않아야 한다. 작은 trial 수(1~3번)에서 "통과"와 "나빠짐"이 정확히 무엇인지 이 task가 못 박는다. 해석은 하지 않는다. experimenter가 이 결과를 읽고 해석하고, 뒤집으려면 이유를 적어 사람이 정한다.

- 단위: ex-verdict (wave 2)
- 선행: ex-spec
- 소유(이 task만 고친다):
  - `tests/eval/experiment/verdict/**`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "experiment"(표의 판정 규칙, target, guard, 결과), "trial 수", "특정 시나리오에 맞추지 않기"(1. 미리 써 둔 case도 통과해야 채택한다), "역할과 흐름"(program은 판정 규칙 계산, experimenter는 판정 결과를 뒤집지 못한다), "정한 것"(채택 규칙, 판정은 program이 계산한다)
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 판정, 기준 구성, trial 정책)
  - 먼저 끝난 brief: `project-docs/plan/eval-experiment/tasks/ex-spec.md`(type, 세는 함수, `writeResult`와 "판정이 난 result는 덮지 않는다"), `ex-select.md`(`PlanEntry`를 만드는 쪽), `ex-trials.md`(`nextTrials`가 `remaining`을 정하는 쪽)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`: `VersionRef`, `refText`
    - `tests/eval/experiment/spec/mod.ts`(ex-spec): `ExperimentSpec`, `ExperimentResult`, `ScenarioResult`, `PlanEntry`, `Outcome`(`state`, `pending` 칸 포함), `Tally`(`pending` 칸 포함), `Role`, `OverfitWarning`, `RepeatFinding`, `AssemblyReport`, `tallyOf(outcomes, checks)`, `poolVerdict(tally)`, `writeResult(dir, result): Promise<Result<void>>`
    - `packages/base/mod.ts`: `Result`, `ok`, `err`
  - 내놓는 것(`tests/eval/experiment/verdict/mod.ts`):
    - `decide(input: VerdictInput): Result<ExperimentResult>` (순수 함수)
    - `recordVerdict(dir: string, input: VerdictInput): Promise<Result<ExperimentResult>>` (`decide` 다음 `writeResult`)
    - `type VerdictEntry`, `type VerdictInput` (아래)
    - ex-cli가 variant trial을 모은 뒤 `VerdictInput`을 만들어 부른다. ex-cli는 이어 돌리기를 위해 이전 `inconclusive` result의 `scenarios[].variant_runs`를 읽어 같은 experiment의 variant run을 알아낸다.

## 할 일

1. **입력** (`types.ts`).

```ts
export type VerdictEntry = PlanEntry & {
  variant_runs: string[];     // 이 experiment가 X@b로 돈 RunRecord.id
  variant: Outcome[];         // 그 run들의 trial 전부(outcomeOf)
  remaining: number;          // ex-trials의 nextTrials 결과. 0이 아니면 아직 끝나지 않았다(예산이 끊었다 등)
};
export type VerdictInput = {
  spec: ExperimentSpec;
  spec_hash: string;                 // ex-spec readSpec의 hash
  spec_commit: string | null;        // ex-spec checkSpecLocked의 결과
  changed: { from: VersionRef; to: VersionRef }[];   // ex-select changedComponents(기준, variant)
  entries: VerdictEntry[];           // ex-select의 Plan.entries에 variant를 붙인 것
  keep: { scenario: string; runs: string[] }[];
  excluded: { scenario: string; reason: string }[];
  stopped_by_budget: boolean;
  decided_at: string;                // Clock.now(). 함수 안에서 시각을 읽지 않는다
  // 진단. ex-cli가 ex-overfit, ex-repeat, ex-assembly에서 모아 넘긴다. 판정에 쓰지 않고 result에 그대로 옮긴다.
  overfit?: OverfitWarning[];
  repeats?: RepeatFinding[];
  assembly?: AssemblyReport[];
};
```

2. **규칙 `default@1`** (`rule.ts`). 아래가 규칙의 정의다. 코드 맨 위 주석에 이 표를 한 번 요약해 둔다. 규칙을 바꾸면 이름을 올린다(`default@2`)는 한 줄도 같이 쓴다. entry마다 `status`를 정한 다음 전체 `decision`을 정한다.

   entry의 두 tally: `vt = tallyOf(variant, checks)`, `bt = tallyOf(baseline, checks)`. `checks`는 target·case는 Goal의 것(없으면 null이라 trial 전체), guard는 null이다. `vv = poolVerdict(vt)`, `bv = poolVerdict(bt)`.

   | role | status | 조건(위에서 처음 맞는 것) |
   |---|---|---|
   | 전부 | `incomplete` | `remaining > 0`, 또는 `vt.trials === 0`, 또는 **`vt.pending > 0`**(variant에 채점 대기 trial이 있다), 또는 target·guard인데 **`bt.trials === 0`이고 `bt.pending > 0`**(기준이 채점 대기뿐이다) |
   | target | `ok` | `vv === "pass"` 이고 **나아졌다**: `vt.passed * bt.trials > bt.passed * vt.trials` (통과율이 기준보다 엄격히 높다) |
   | target | `not_improved` | `vv === "pass"` 인데 나아지지 않았다(기준 통과율 이상이 아님) |
   | target | `fail` | `vv`가 `pass`가 아니다 |
   | case | `ok` / `fail` | `vv === "pass"` / 아니다. 기준과 비교하지 않는다(미리 써 둔 새 case는 기준이 없을 수 있다) |
   | guard | `worse` | `vv === "fail"` 이고 `bv !== "fail"` |
   | guard | `ok` | 그 밖. 단 `vt.passed * bt.trials < bt.passed * vt.trials`(통과율이 기준보다 낮다)이면 `weaker: true`로 표시한다 |

   - 채점 대기: `tallyOf`는 채점 대기 trial을 `trials`에 세지 않고 `pending`에만 센다(ex-spec). 그래서 정해진 trial만으로 위 표가 돈다. 단 variant에 채점 대기가 하나라도 있으면 그 entry는 `incomplete`다(정해진 trial로 미리 판정하지 않는다. 이유: 남은 채점이 결과를 뒤집을 수 있고, 규칙은 한 눈금으로만 센다). 기준 쪽 채점 대기는 정해진 기준 trial이 있으면 그것만 쓰고 `note`에 대기 수를 적는다. 이미 떨어진 trial은 채점이 남아 있어도 정해진 것이다(`Outcome.state`가 `fail`).
   - "통과"(`pass`)는 `poolVerdict`의 정의 그대로 **엄격한 과반**이다: trial이 1번이면 1/1, 3번이면 2/3 이상, 5번이면 3/5 이상. `split`은 정확히 절반이라 통과가 아니다.
   - "나빠짐"(`worse`)은 variant가 과반을 통과하지 못했는데(`fail`) 기준은 `fail`이 아니었던(`pass` 또는 `split`) 것이다. 기준이 이미 `fail`이면 나빠질 수 없다. 작은 trial 수에서 구체적으로: 기준이 통과였던 guard는 variant가 3번 중 0~1번 통과하면 `worse`, 2~3번 통과하면 `ok`(2/3이면 `weaker`)다. guard의 첫 trial이 기준과 다르면 ex-trials가 3번까지 늘리므로(첫 trial만 떨어진 채 끝나지 않는다) `worse`는 늘 3번 뒤에 선언된다. 이유: 한 번 떨어진 것을 나빠짐으로 보면 흔들리는 시나리오 때문에 채택이 막히고, 2/3을 통과로 치는 이상 같은 눈금으로 센다.
   - 한계(보고서가 아니라 코드 주석에도 쓴다): 3번으로는 우연과 나빠짐을 완전히 가르지 못한다. 기준이 통과율 60% 안팎인 guard는 우연히 `worse`가 될 수 있다. 결론이 의심되면 spec의 `trials.max`를 올린 새 spec을 쓴다. 규칙은 어림하지 않는다.
   - target이 이미 기준에서 통과하던 것이면(기준 통과율이 variant와 같거나 높다) `not_improved`로 기각된다. 가설이 이 target에서 틀렸다는 뜻이다.

   전체 `decision`:
   1. entry 중 `fail`, `not_improved`, `worse`가 하나라도 있다 → `reject`. 끝나지 않은 entry가 같이 있어도 확정된 실패가 있으면 기각이다(더 돌려도 채택될 수 없다).
   2. 아니고 `incomplete`가 하나라도 있다 → `inconclusive`. 채점 대기 때문이면 `reasons`에 "채점 대기: <시나리오> <n>건. `deno task eval:judge`로 채점한 뒤 이어 돌린다"를 적는다(예산 때문에 끝나지 않은 것과 갈라 쓴다). 채점이 들어오면 같은 experiment를 이어 돌려 다시 판정한다(`inconclusive`만 덮어쓸 수 있다).
   3. 아니면 → `adopt`.

3. **결과 만들기** (`decide.ts`). `decide(input)`:
   - 먼저 입력을 본다. 모두 `Result`로 돌려주고 판정은 하지 않는다.
     - `changed`에 `spec.change.from`과 kind·name·n이 같은 `from`을 가진 것이 없다 → `conflict`("variant에서 X가 바뀌지 않았다"). 이유: 고치지 않은 variant로 돈 결과를 채택에 쓰지 않는다.
     - `spec.target`과 `spec.cases`의 시나리오마다 `entries`에 같은 role의 entry가 하나씩 있어야 한다. 빠졌거나 role이 다르면 `invalid_input`. target entry에 `baseline`이 비어 있어도 `invalid_input`(나아졌는지 알 수 없다).
   - `mixed = input.changed.length !== 1`. `changed`는 `refText`로 바꿔 `{from, to}` 글로 담는다. variant의 실제 `to`가 `spec.change.to`와 n이 다르면 `reasons`에 "spec의 to는 <글>인데 variant는 <글>이다"를 적는다(막지 않는다. ex-spec 참조). mixed이면 "섞인 변경이다: <나머지 change>"를 적는다. 판정은 같다. 읽는 사람이 섞인 결과로 읽는다.
   - `ScenarioResult` 칸은 ex-spec의 type 그대로 채운다. `note`는 한 줄 사실이다. 예: `variant 3/3, baseline 0/1: 나아졌다`, `variant 1/3, baseline 1/1: 나빠졌다`. `baseline` tally는 기준이 비면 `{passed: 0, trials: 0, pending: 0}`.
   - `reasons`: 첫 줄은 요약 한 줄(`adopt: target 2/2 ok, case 1/1 ok, guard 6 ok (weaker 1)` 꼴). 다음에 `ok`가 아닌 entry와 `weaker`인 entry의 `note`를 한 줄씩. 그 다음 `mixed`·`to` 불일치·`stopped_by_budget`(`예산 $<n>에서 멈췄다`)·`excluded` 개수(`기준이 낡아 빠진 시나리오 <n>개: <ids>`).
   - `cost_usd`는 모든 entry의 `variant`의 `cost_usd` 합. `keep`, `excluded`, `stopped_by_budget`, `decided_at`, `spec_hash`, `spec_commit`과 `overfit`, `repeats`, `assembly`(있을 때만)는 입력 그대로. 진단은 `decision`과 `reasons`의 요약 줄에 영향을 주지 않는다(통과에 들지 않는다). `rule`은 `spec.judgment.rule`.
4. **쓰기** (`record.ts`). `recordVerdict(dir, input)`은 `decide`를 부르고 성공하면 `writeResult(dir, result)`(ex-spec)로 쓴다. 판정이 이미 난 result가 있으면 `writeResult`가 `conflict`를 돌려주고 이 함수는 그것을 그대로 돌려준다(다시 굴려 마음에 드는 결과를 얻는 길을 막는다. 이어 돌리기는 `inconclusive`만).
5. `mod.ts`가 위를 다시 내보낸다.
6. test를 `tests/eval/experiment/verdict/verdict_test.ts`에 쓴다. 손으로 만든 입력만 쓰고 파일 시스템을 쓰지 않는다(`recordVerdict`는 부르지 않는다. `writeResult`는 ex-spec이 본다).

## 정한 것

- 규칙은 `default@1` 하나다. 이유: spec이 이름으로 가리키므로 규칙을 바꿀 때 옛 result가 어느 규칙으로 계산됐는지 남는다.
- target은 "통과"에 더해 "기준보다 나아졌다"를 요구한다. 이유: roadmap의 target은 "나아져야 할 시나리오나 check"이고 채택은 개선이 확인된 때만이다. 그렇지 않으면 이미 통과하던 target이 우연히 통과해 채택된다. case는 새로 쓴 것이라 기준이 없을 수 있어 통과만 본다.
- 확정된 실패가 있으면 끝나지 않은 entry가 있어도 `reject`다. `inconclusive`는 확정된 실패가 없고 일부만 끝나지 않았을 때다. 이유: 예산을 쓰고도 더 돌려 봐야 아무것도 바뀌지 않는 경우에 결론을 미루지 않는다.
- guard의 worse는 `fail` 과반 실패다. "기준보다 통과율이 낮다" 만으로는 worse가 아니라 `weaker` 표시다. 이유: 기준이 1/1이고 variant가 2/3인 경우 우연일 가능성이 높아 채택을 막으면 흔들리는 시나리오가 늘 채택을 막는다. 대신 `weaker`는 result에 남아 experimenter가 짚는다.
- 판정 이유는 사람이 읽는 `reasons`와 숫자(`scenarios`)를 같이 남긴다. 해석은 하지 않는다(그것은 experimenter의 일이다). program이 쓴 result.json을 experimenter가 고치지 않는다. 뒤집자는 제안은 `report.md`에 이유와 함께 적고 사람이 정한다.
- 비용은 variant trial의 `Outcome.cost_usd`(대상 + judge) 합이다. runner(Haiku)와 experimenter의 비용은 세지 않는다. 이유: 개발 쪽 agent의 비용이고 experiment 예산이 아니다. 예산 상한은 ex-parallel의 pool이 지킨다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`verdict_test.ts`, 둘):
  - "규칙대로 채택·기각·결론 못 냄이 갈린다": `decide`를 표로. target 통과·나아짐 + case 통과 + guard 문제 없음 → `adopt`; guard 기준 1/1에서 variant 1/3 → `worse` → `reject`; guard 기준 1/1에서 variant 2/3 → `ok`·`weaker`로 `adopt`; target이 variant 3/3인데 기준도 3/3 → `not_improved` → `reject`; case가 2/3 미만 → `reject`; 확정된 실패 없이 `remaining > 0`인 entry가 있음 → `inconclusive`; 확정된 실패와 `remaining > 0`이 같이 있음 → `reject`; target의 variant trial이 모두 통과 쪽이지만 judge check 하나가 채점 대기 → `inconclusive`(reasons에 "채점 대기"); program check가 이미 떨어진 trial은 judge가 대기여도 정해진 실패라 `reject`에 센다. 채택은 고친 것을 main에 넣는 일이라 틀리면 나빠진 harness가 남는다.
  - "고치지 않은 variant이거나 미리 써 둔 case entry가 빠졌거나 target에 기준이 없으면 판정하지 않고 거절한다": `decide`의 `conflict`·`invalid_input`.
- 남지 않음: 해당 없음(새 코드).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것. 위 "정한 것"과 다르게 했으면 이유를 적는다.
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: ex-spec의 `ExperimentResult`·`ScenarioResult` 칸이 모자라 보이면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 채점 대기가 있으면 variant는 정해진 부분만으로 미리 판정하지 않는다. 3번 이하 trial로는 우연과 나빠짐을 가르지 못한다(위 한계). guard를 check 단위가 아니라 trial 전체의 통과로 센다. 한 check만 나빠지고 다른 check가 가린 경우는 `note`에 안 보인다(고치려면 `Outcome.checks`로 check별로 센다).
