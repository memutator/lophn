# rd-resolve-rule

agent 자격(App Engineer)이 problem을 resolved로 바꾸려면, 마지막 발생의 release보다 뒤에 activate된 active release가 있어야 받게 한다. 사람은 지금처럼 바꾼다.

- 단위: rd-resolve (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/reporting/model.ts`
  - `packages/core/problems/reporting/model_test.ts`
  - `packages/core/problems/reporting/mod.ts`
  - `packages/core/problems/grouping/commands.ts`
- 읽을 것:
  - issue: `project-docs/issues/problems.md`의 "고친 release 없이 resolved로 바꾸면 같은 release의 새 발생이 묻힌다"(정한 것: program이 막는다, 사람. 지침 줄은 계획 `prompt-text`가 이미 썼다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`
  - 코드: `packages/core/problems/grouping/commands.ts`의 `handleSetProblemState`·`mayChange`, `packages/core/problems/reporting/model.ts`의 `reopenDecision`, `packages/core/problems/ports.ts`의 `ReleaseLookup`·`ReleaseFact`(`activated_at`), `packages/core/problems/reporting/commands.ts`의 `activatedAtOf`(같은 port를 쓰는 본보기), `packages/core/problems/grouping/reads.ts`(마지막 발생의 release를 고르는 SQL)
- 계약:
  - 쓰는 것: `ReleaseLookupPort`(writer transaction에도 끼워져 있다: `repairs/register.ts`), route `problem.set_state`(그대로)
  - 내놓는 것: agent 자격으로 resolved를 청했는데 조건이 안 맞으면 `conflict`, 메시지는 `no fix release yet: ...`로 시작하고 "ask the person to resolve it"을 포함한다(영어. 모델이 읽는다). `rd-body-tool`이 `problem.set_state` tool 설명에 이 규칙을 쓴다. 순수 함수 `agentResolveDecision`(아래)을 `reporting/mod.ts`로 내보낸다.

## 할 일

1. `reporting/model.ts`에 순수 함수를 둔다:
   `agentResolveDecision(input: { last: ReleaseFact | null; active: ReleaseFact | null }): "allow" | "no_fix_release"`.
   `last`는 마지막 발생의 release, `active`는 그 앱의 active release다. `allow`인 것은 둘 다 있고 id가 다르고 둘 다 `activated_at`이 있으며 `active.activated_at > last.activated_at`일 때뿐이다. 시각은 같은 형식의 At이라 글자 순서가 시간 순서다(`reopenDecision`과 같은 가정). 나머지(모르는 release, 같은 release, 더 일찍 activate됨)는 `no_fix_release`다. 이유: 못 비교하면 닫지 않는 쪽이 안전하다. 닫혀 있는데 새 발생이 쌓이면 아무도 모른다(이슈 "영향").
2. `grouping/commands.ts`의 `handleSetProblemState`: `input.state === "resolved"`이고 `problem.state !== "resolved"`이고 actor 종류가 `agent`이면, `mayChange`를 통과한 뒤 UPDATE 전에 판정한다. 마지막 발생의 release는 `select release from reports where problem = ? order by observed_at desc, id desc limit 1`, 사실은 `tx.port(ReleaseLookupPort)(tx.sql)`의 `get(release)`와 `activeOf(problem.app)`이다. `no_fix_release`면 `conflict`를 낸다. `user`와 `ignored`는 건드리지 않는다. 같은 상태로 바꾸는 호출은 지금처럼 ok다.
3. `model_test.ts`에 `agentResolveDecision` 표 test 하나를 더한다(기존 `reopenDecision` 표와 같은 모양): 더 늦게 activate된 다른 release는 allow, 같은 release·더 일찍 activate된 release·active 없음·마지막 발생의 release 없음(null)·`activated_at` null은 no_fix_release.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "agent 자격은 마지막 발생의 release보다 뒤에 activate된 active release가 없으면 problem을 resolved로 바꾸지 못한다"(`model_test.ts`의 표)
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 오류 code를 `conflict`로 한 것, 마지막 발생의 release가 null이면 막는 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: transaction 안 SQL(마지막 발생 고르기)은 test가 순수 함수만 본다. 그 사실을 적는다.
