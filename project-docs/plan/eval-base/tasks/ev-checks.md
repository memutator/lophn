# ev-checks

시나리오들이 같이 쓰는 확인 함수(Check 만드는 법), 손으로 쓰는 record fixture helper, 그리고 `right`/`wrong` record로 grader를 돈 쓰기 전에 확인하는 자체 점검(`selfCheck`)과 case 불러오기를 만든다. 17개 case에 쓸 확인을 이 file들이 다 갖는다.

- 단위: ev (wave 2)
- 선행: ev-contracts
- 소유(이 task만 고친다):
  - `tests/eval/{checks,fixtures,grade,load}.ts`
  - `tests/eval/check-cases.ts`
- 읽을 것:
  - 계획: `project-docs/products/roadmap/eval.md`의 "책임에 따른 call: 작은 판단 case"(17행 pass 열), "case 고르는 규칙"(특히 2·3·4), "시나리오 꼴"
  - 조사: `project-docs/plan/eval-base/research/roles-and-outcomes.md` 1절(항목별 관찰 결과), 3절(role별 tool 목록, `call` 입력 모양), 7절(점검할 수 있는 것과 없는 것)
  - 코드: `packages/core/agent-roles/tool-lists.ts`(어느 tool을 어느 role이 어길 수 있나), `packages/core/lophn-agent/tools/bundles/call.ts`(`call` 입력·결과), `packages/protocol/approvals/grants.ts`(grant setting은 `excluded | never | ask`. `never`는 "묻지 않음"이다)
  - 계약: `tests/eval/types.ts`
- 계약:
  - 쓰는 것: `tests/eval/types.ts`
  - 내놓는 것:
    - `checks.ts`(모두 `Check`를 돌려주는 factory. `id`는 첫 인자):
      - `calledAgent(id, { to: { role, app?, project? }, reply?, min?, max? })`: `calls` 중 풀린 받는 쪽이 맞고(`record.to`, 없으면 `asked.to`의 role과 place 이름. Gate가 거절한 call은 `record`가 없다) `reply`가 맞는 것의 수가 `min`(기본 1) 이상 `max` 이하다. `to.role`은 `app_engineer | project_manager | operator | lophn`.
      - `noCallExcept(id, allowed)`: `allowed`가 아닌 받는 쪽으로 간 call이 0이다.
      - `noCalls(id)`: call 0.
      - `usedTool(id, name, { min?, max? })`, `neverTool(id, name)`: tool 이름은 `.`와 `_`를 같게 본다(`app.create` = `app_create`). 센 것은 시도한 모든 call이다(실패, 거절 포함).
      - `readsAll(id, names)`: 이름마다 한 번 이상.
      - `toolOrder(id, first, then)`: `first`의 첫 call이 `then`의 첫 call보다 `order`가 앞선다. 둘 다 있어야 통과한다.
      - `noWriteTools(id)`: `effect`가 `write`/`external`인 call 0.
      - `noRedirectAfterRefusal(id, refused)`: 거절된 `call`(grant `excluded`는 Gate가 `deny`해서 tool outcome이 `not_executed`/`denied`이고 `result`와 `record`가 null이다. Router가 낸 실패는 `result.fail_reason`이 있다. 둘 다 거절로 센다) 중 받는 쪽이 `refused`인 것이 하나 이상 있고, 그 뒤(`order`)에 `refused`가 아닌 받는 쪽으로 간 call이 0이다. 거절당한 call이 한 번도 없으면 떨어진다(`why: "refused call was never sent"`). case를 돌리지 못한 것이라 통과로 세지 않는다.
    - `fixtures.ts`: `emptyRecord(over?)`, `fixtureSession(target, over?)`, `fixtureTool(name, over?)`, `fixtureCall({ to, reply, state?, fail_reason? })`로 `RunRecord` fixture를 짧게 쓴다. 칸은 `types.ts` 그대로이고, 안 준 칸은 비어 있거나 0이다.
    - `grade.ts`: `gradeRecord(scenario, record): { pass: boolean; checks: { id: string; pass: boolean; why: string | null }[] }`, `selfCheck(scenarios: Scenario[]): string[]`(문제 목록, 비면 통과).
    - `load.ts`: `loadScenarios(dir?: string): Promise<Scenario[]>`. `tests/eval/cases/*.ts`를 동적 import해 각 file의 `default export`(Scenario)를 모은다. id가 겹치면 던진다.
    - `check-cases.ts`: `deno run --allow-read tests/eval/check-cases.ts [id...]`. `loadScenarios`와 `selfCheck`를 돌려 문제를 찍고, 있으면 exit 1.

## 할 일

1. `checks.ts`를 쓴다. 규칙(roadmap "case 고르는 규칙"):
   - 결과를 채점한다: call의 받는 쪽과 답 방식, tool 사용 수와 순서. 모델이 쓴 글(`messages`)은 읽지 않는다.
   - 순서는 순서 자체가 규칙일 때만 본다(`toolOrder`).
   - 각 Check의 `why`는 떨어진 이유 한 줄이다(무엇을 기대했고 무엇이 있었나. 예: `expected 1 call to app_engineer@가계부 (reply none), got 0`).
2. `fixtures.ts`를 쓴다. fixture는 case 파일이 `right`/`wrong`을 3~8줄로 쓰게 하는 것이 목적이다.
3. `selfCheck`:
   - `right`: 모든 check가 통과하지 않으면 문제.
   - `wrong`: `fails`가 비었거나, 적힌 check id가 시나리오에 없거나, 적힌 check가 통과하거나, 전체가 통과하면 문제.
   - 각 시나리오에 check가 1~3개가 아니면 문제. `proposal`·`trials`가 없으면 문제.
   - 항상 떨어지는 grader가 `wrong`을 통과시키는 것을 `right` 쪽 확인이 막는다. 그래서 `right`가 필수다.
4. 자체 확인: scratch(`.dev-data/ev-checks/`, commit하지 않는다)에 시나리오 둘을 직접 만들어(하나는 맞는 grader, 하나는 일부러 틀린 grader) `selfCheck`가 하나는 비고 하나는 문제를 내는지 본다. 이 file들은 core를 띄우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. grader의 정확성은 test suite가 아니라 case마다 `right`/`wrong`을 runner가 돌리기 전에 `selfCheck`로 확인한다(계획 README 정한 것).
- 남지 않음: scratch를 commit하지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 문서에 답이 없어 정한 것(예: `to`를 못 푼 call을 `asked.to`로 맞추는 방식)
- 계약 바꾸기 요청: `types.ts`를 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음"
