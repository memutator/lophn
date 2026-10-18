# ex-repeat

trial에서 같은 tool을 같은 인자로 3번 이상 부른 곳을 찾아, Haiku judge가 "다른 방법으로 다시 해 봤나(`different_attempts`), 같은 실수를 되풀이했나(`same_mistake`)"를 판단하게 하는 진단 judge `repeat-kind@1`을 만든다. check가 아니다: 시나리오의 pass에 들지 않고, 결과는 experiment 보고에 들어간다. eval-base의 judge 호출과 입력 만들기를 그대로 쓴다.

- 단위: ex-repeat (wave 2)
- 선행: ex-spec
- 소유(이 task만 고친다):
  - `tests/eval/experiment/repeat/**`
  - `tests/eval/criteria/repeat-kind.json`
  - `tests/eval/criteria/mod.ts` 안의 `repeat-kind` 항목 한 줄(landed 파일이 criterion마다 항목을 요구할 때만. ev-judge가 만든 파일이라 그 한 줄만 더하고 나머지는 고치지 않는다)
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "check와 judge"(표의 "되풀이" 줄, "judge를 믿고 쓰기"), "공통 수치"(tool 정확도의 "되풀이")
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 되풀이 judge)
  - eval-base: `project-docs/plan/eval-base/tasks/ev-judge.md`(`judgeItem`, `joinInput`, `Criterion`, `JudgeItem`, `JudgeDefinition`, criterion json 꼴, "criterion 하나에 판단 하나"), `ev-collect.md`("기대하는 모양"의 `SessionRecord`, `CollectedToolCall`, 되풀이를 묶는 규칙과 재시도에 밀린 행), `ev-contract.md`(`TrialRecord`)
  - 코드: `packages/protocol/lophn-agent/tool-values.ts`(`ToolCall`의 `tool`, `input`(hash), `retry_of`, `state`, `outcome`, `ToolResult`의 `summary`)
- 계약:
  - 쓰는 것:
    - `tests/eval/experiment/spec/mod.ts`(ex-spec): `type RepeatFinding`.
    - eval-base가 만든 것:
      - `tests/eval/types.ts`: `TrialRecord`, `SessionRecord`, `CollectedToolCall`(`call: ToolCall`, `input: unknown | null`, `output: unknown | null`), `Criterion`, `JudgeItem`.
      - `tests/eval/judge/mod.ts`: `judgeItem(deps: { fetch: JudgeFetch; apiKey: string }, args: { check: string; criterion: Criterion; input: string; judge: JudgeDefinition }): Promise<JudgeItem>`(던지지 않는다. 인용 검사 포함), `joinInput(sections: { label: string; text: string }[]): string`, `type JudgeDefinition`, `type JudgeFetch`.
      - `tests/eval/criteria/mod.ts`: `loadCriterion(ref)`가 `tests/eval/criteria/<name>.json`을 읽는다(file의 `n`이 ref와 다르면 던진다).
  - 내놓는 것(ex-cli가 부른다), `tests/eval/experiment/repeat/mod.ts`:
    - `REPEAT_KIND = "repeat-kind@1"`.
    - `type RepeatGroup = { session: string; tool: string; input_hash: string; calls: string[]; timeline: CollectedToolCall[] }`. `calls`는 같은 tool·같은 인자의 tool call id(시간 순, 3개 이상). `timeline`은 그 session의 tool call 가운데 첫 되풀이부터 마지막 되풀이까지(양끝 포함)다.
    - `findRepeatGroups(trial: TrialRecord, minCount = 3): RepeatGroup[]`. 큰 묶음이 먼저다.
    - `repeatKindInput(group: RepeatGroup): string`. judge가 받는 입력.
    - `RepeatFinding`: 이 task가 정의하지 않는다. ex-spec이 `tests/eval/experiment/spec/`에 정의하고(`ExperimentResult.repeats?`가 쓴다) 이 task는 거기서 import해 다시 내보낸다. 모양은 `{ session: string; tool: string; count: number; calls: string[]; item: JudgeItem }`이다(ex-spec이 이 칸 그대로 옮긴다).
    - `judgeRepeats(deps: { fetch: JudgeFetch; apiKey: string; criterion: Criterion; judge: JudgeDefinition }, trial: TrialRecord, opts?: { maxGroups?: number }): Promise<{ findings: RepeatFinding[]; cost_usd: number }>`. `maxGroups` 기본 3. 묶음이 없으면 judge를 부르지 않고 `{ findings: [], cost_usd: 0 }`. `cost_usd`는 `item.cost_usd`의 합이다. ex-cli가 이것을 experiment 예산에 더하고, `findings`를 `result.json`에 싣는다(칸 이름은 ex-spec의 result 꼴에서 정한다. 이 task는 정하지 않는다).
    - `tests/eval/criteria/repeat-kind.json`: criterion 데이터. ex-cli가 experiment를 시작할 때 `registerAuthored`로 등록한다(`kind: "criterion"`, `name: "repeat-kind"`, `n: 1`).

## 할 일

1. `tests/eval/criteria/repeat-kind.json`: `{ "name": "repeat-kind", "n": 1, "question", "verdicts": ["different_attempts", "same_mistake", "cannot_tell"], "pass": ["different_attempts"] }`. `pass`는 `Criterion`의 모양을 채우려고 둔 값이고 아무 데서도 통과 판정에 쓰지 않는다. JSON은 `JSON.stringify(value, null, 2) + "\n"` 꼴로 쓴다. `question`은 영어로 쓰고, 이 뜻을 담는다(다듬어도 된다):
   - 한 session에서 모델이 같은 tool을 정확히 같은 입력으로 여러 번 불렀다. `[REPEATED_CALL]`은 그 tool과 입력이고, `[TIMELINE]`은 첫 되풀이부터 마지막 되풀이까지 그 session의 tool call을 줄마다 보인다(되풀이는 `*`로 표시, 각 줄에 결과).
   - `different_attempts`: 되풀이 사이에서 모델이 접근을 바꿨거나(다른 tool, 다른 대상), 바뀌는 상태를 기다리며 다시 확인했다. 같은 호출이 다른 결과를 낼 수 있었다.
   - `same_mistake`: 되풀이 사이에 아무것도 바뀌지 않았고, 되풀이마다 같은 실패나 새 정보 없는 결과가 돌아왔다.
   - `cannot_tell`: 입력으로 정할 수 없다.
2. `find.ts`: `findRepeatGroups`.
   - session마다 `tool_calls`를 본다. 묶는 키는 (`call.tool`, `call.input`(hash))다. 같은 입력은 같은 hash다(입력 blob이 canonical JSON이다. `ev-collect.md`).
   - 센 대상은 `state === "finished"`이고 재시도에 밀리지 않은 행이다(`retry_of`로 다른 행이 이 행의 id를 가리키면 뺀다). `outcome.kind === "not_executed"`인 행은 `code`가 `denied`·`rejected`가 아니면 뺀다(model 탓이 아니다. ev-collect의 tool 정확도 규칙과 같다). 막힌(`denied`) call을 같은 인자로 거듭 부른 것은 되풀이에 든다.
   - 크기가 `minCount` 이상인 묶음만 낸다. `timeline`은 그 묶음의 첫 call과 마지막 call 사이의 `tool_calls` 구간이다.
3. `input.ts`: `repeatKindInput`은 `joinInput`으로 두 칸을 만든다.
   - `REPEATED_CALL`: `tool: <tool>`, `times: <count>`, `input: <첫 call의 input JSON>`(2000자까지, 넘으면 `…(truncated)`). input이 null이면 `(input not available)`.
   - `TIMELINE`: `timeline`의 call마다 한 줄. `#<순서> [*]<tool> <input JSON 200자까지> -> <outcome.kind>[/<outcome.code>]`, `output`이 있으면 `ToolResult.summary` 120자까지를 ` | `로 잇는다. 30줄을 넘으면 앞 15줄, `… <n> lines omitted …`, 뒤 15줄로 줄인다. 되풀이한 call은 줄 맨 앞에 `*`를 붙인다.
   - 순서와 JSON은 결정적이어야 한다(키 정렬은 `canonicalize`가 아니라 기록에 있는 그대로 둔다. 같은 입력이면 같은 글이 나오면 된다).
4. `judge.ts`: `judgeRepeats`. 묶음마다 `judgeItem(deps, { check: `repeat:${tool}#${i}`, criterion, input: repeatKindInput(group), judge })`을 차례로 부른다(`i`는 0부터). `RepeatFinding`을 만든다. `count`는 `calls.length`. 병렬로 부르지 않는다(최대 3개라 단순하게).
5. `mod.ts`가 위 "내놓는 것"을 내보낸다. `loadCriterion`·`loadJudgeDefinition`은 이 task가 부르지 않는다. 호출하는 ex-cli가 로드해 `deps`로 넘긴다(순수하게 남기려고).
6. test(아래).

## 정한 것

- **check가 아니다.** `TrialResult.judge`와 `checks`에 넣지 않고, 시나리오 통과에 들지 않는다. 이유: roadmap이 "진단"이라 했고 README가 "통과에 들지 않는다"고 정했다. 그래서 `JudgeCheck`을 만들지 않고 `judgeRepeats`가 `JudgeItem`을 바로 돌려준다.
- **judge 입력에 되풀이 사이의 call을 넣는다.** roadmap 표는 "그 call 셋과 결과"라고만 적었는데, 인자가 같은 call 셋만으로는 "다른 방법을 시도했나"를 판단할 수 없다. 그래서 첫 되풀이부터 마지막 되풀이까지의 그 session의 tool call 줄(tool, 입력 요약, 결과)을 같이 준다. transcript 전체는 주지 않는다(roadmap의 입력 규칙).
- **묶음은 trial당 3개까지 판단한다.** 크기가 큰 순서다. 이유: judge 비용을 묶음 수에 비례해 늘리지 않으려는 것이다(Haiku라 싸지만 실패한 trial이 많으면 쌓인다). 남은 묶음은 `findRepeatGroups`에는 있어도 `judgeRepeats`가 부르지 않는다.
- **실패한 tool call의 안내 글은 없다.** output blob이 success일 때만 남기 때문이다(ev-collect). 실패 줄은 `outcome`의 kind와 code만 보인다.
- **coding agent의 tool call은 보지 않는다.** `SessionRecord`에 role agent session만 있다(coding agent는 `eval-coding`이 CLI 기록에서 따로 센다).
- **`INPUT_SECTIONS`(`tests/eval/criteria/mod.ts`)는 landed 파일이 필요로 할 때만 `repeat-kind: ["REPEATED_CALL", "TIMELINE"]` 한 줄을 더한다.** 이 한 줄만 이 task의 소유다(계획 조정). 칸 이름은 criterion의 `question`과 `input.ts`와 같아야 한다. 파일이 항목을 요구하지 않으면 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`는 check에서 돈다. test는 순수하다(네트워크, 진짜 provider, core 없음).
- 위험 test(1개, `find_test.ts`): "같은 tool·같은 입력 hash가 한 session에서 3번이면 묶음이 되고, 2번이면 안 되며, 다른 session의 같은 call과 합쳐지지 않고, 재시도에 밀린 행과 model 탓이 아닌 미실행(`stopped` 등)은 세지 않으며, 막힌(`denied`) 반복은 센다." (손으로 만든 `SessionRecord` 표 하나. 이 규칙이 틀리면 judge가 엉뚱한 입력으로 돈다.)
- `judgeItem` 자체(요청 모양, 인용 검사)는 ev-judge의 test가 본다. 여기서 다시 test하지 않는다.
- 새 subprocess·서버·진짜 provider 호출 test는 없다.
- 남지 않음: `grep -rn "api.anthropic.com" tests/eval`은 `judge/run.ts` 한 곳이다(이 task는 HTTP를 직접 하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. ex-cli가 할 일: `repeat-kind@1`을 `registerAuthored`로 등록하고, `judgeRepeats` 결과를 `result.json`에 싣고, `cost_usd`를 experiment 예산에 더한다.
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `RepeatFinding`이 ex-spec과 달라 막히는 곳. `CollectedToolCall`·`JudgeItem`·`judgeItem` 모양이 위와 달라 막히는 곳
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 진짜 API로 불러 보지 않았다(ev-judge와 같은 미확인). 실패한 call의 안내 글이 없어 `same_mistake`와 `cannot_tell`의 경계가 흐릴 수 있다.
