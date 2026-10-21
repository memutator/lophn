# tr-eval-prune-checks

eval check에서 ticket·problem·coding·막힌 call을 읽던 것(`checks/app/tickets.ts`, `checks/app/observe.ts`와 그 test, `readProblem`, `aeCallsOnlyToCodingAgent`, `addCodingCall`, `waitProblems`, `not_allowed`, T19만 쓰던 call check)을 지운다. 그것을 쓰던 check·시나리오 file에서는 죽은 check와 import만 걷어 시나리오 file이 지운 이름 없이 import되게 한다. 시나리오를 새 흐름으로 다시 쓰는 것은 wave 2의 일이다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/checks/{mod,calls,calls_test,fixtures}.ts`
  - `tests/eval/checks/app/{tickets,observe,observe_test}.ts` (지운다)
  - `tests/eval/checks/app/{mod,live,calls,calls_test,fixtures,judge-input,diagnose}.ts`
  - `tests/eval/scenarios/calendar/common.ts`
  - `tests/eval/scenarios/calendar/{calendar-user,calendar-dev,calendar-maintain,calendar-diagnose}.scenario.ts`
  - `tests/eval/scenarios/lophn/L7.scenario.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(지우는 eval), `project-docs/plan/test-restore/survey-eval.md`의 0(1, 2), 1의 `checks/fixtures.ts`·`checks/app/live.ts`·`checks/app/tickets.ts`·`checks/app/observe.ts`·`checks/app/diagnose.ts`·`checks/app/calls.ts`·`checks/app/fixtures.ts`·`checks/app/judge-input.ts`·`checks/calls…` 줄, 2의 `L7`·`calendar/*` 줄
  - architecture: `project-docs/architecture/eval.md`(check 순서, live check는 fixture 확인에서 건너뛴다, "case마다 right/wrong fixture"), `project-docs/architecture/approval.md` 73(agent call은 묻지도 막지도 않는다)
  - 근거: `packages/core/router/router.ts` 119·128·148(`coding_agent` call 거절), `packages/protocol/lophn-agent/calls.ts` 99(`CALL_FAIL_REASONS`에 `not_allowed`가 없다), `packages/protocol/approvals/assignment.ts` 63-77(`agentAssignmentSet`. 줄이 없는 agent의 revision은 0, `packages/core/approvals/assignment/store.ts` 12)
  - module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - 코드(main `85f19080e`의 줄):
    - `tests/eval/checks/calls.ts` 1-9(import), 77-146(`hasFailedCall`, `failedCalls`, `targetKey`, `noOtherCallAfterFailedCall`), `tests/eval/checks/mod.ts` 1-6
    - `tests/eval/checks/fixtures.ts` 23(`FixtureCall.fail`), 220-232(`denied` 갈래), 246-266
    - `tests/eval/checks/app/live.ts` 8-11, 63-79(`waitProblems`). `tests/eval/checks/app/calls.ts` 6-40(`aeCallsOnlyToCodingAgent`), 75-93(`readProblem`). `tests/eval/checks/app/fixtures.ts` 27-52(`addCodingCall`)
    - `tests/eval/checks/app/judge-input.ts` 2-9, 11-50, 52-88(`cardCoveredInput`), 90-101(`askedAgainInput`), 103-132(`rootCauseInput`)
    - `tests/eval/checks/app/diagnose.ts` 1, 2-16, 27-70(`Snap`, `decideNoRecurrence`, `snapshot`), 72-191(`diagnosisChecks`)
    - `tests/eval/checks/validate.ts` 18-30·55-68(judge premise는 program check여야 하고, wrong fixture가 하나 이상 있어야 한다)
    - `tests/eval/scenarios/calendar/common.ts` 3-28(import), 33(`CODING`), 42-58(`createCalendarOperator`), 60-73(`aeTicketChecks`), 101-121(ticket·problem fixture helper), 123-150(`buildAppFixtures`), 152-182(`buildAppChecks`)
    - `tests/eval/scenarios/calendar/calendar-{user,dev}.scenario.ts` 4·12·17, `calendar-maintain.scenario.ts` 2-33·40·44-93, `calendar-diagnose.scenario.ts` 3-24·31·34-65, `tests/eval/scenarios/lophn/L7.scenario.ts`
    - 쓰는 쪽(고치지 않는다): `tests/eval/scenarios/operator/O4.scenario.ts` 13·24, `tests/eval/scenarios/calendar/calendar-api.scenario.ts` 3·6·17(`createCalendarOperator`, `appToolSession`, `eventInCalendar`), `tests/eval/scenarios/calendar/spec.ts` 4(`ApiStep`, `BugSpec`, `ReuseSpec` type)
- 계약:
  - 쓰는 것: tr-eval-prune-coding의 `types.ts`(coding 갈래 없음, `Scenario.real: Participant[]`, restore `setup.ts` 없음), `packages/protocol/approvals/assignment.ts`의 `agentAssignmentSet`(`{agent, entries: [{app, removed_tools}]}`, compare `{revision}`)
    - 선행이 없으므로 tr-eval-prune-coding의 결과에 기대지 않는다. 이 task는 coding·`deliver`·`restore/setup.ts` 이름을 쓰지 않게만 한다. 그래서 그 task가 먼저 merge되든 나중에 되든 맞는다.
  - 내놓는 것:
    - `checks/mod.ts`에서 `hasFailedCall`, `noOtherCallAfterFailedCall`(T19만 썼다)이 빠진다. fixture의 call 실패 이유에 `not_allowed`가 없다.
    - `checks/app/mod.ts`에서 `waitProblems`, `observationChecks`, `ObserveSpec`, `Probe`, `aeCallsOnlyToCodingAgent`, `readProblem`, `addCodingCall`이 빠진다. ticket을 읽던 `cardCoveredInput`과 ticket·problem을 읽던 `rootCauseInput`, `diagnosisChecks`의 problem 부분도 빠진다(새 입력은 tr-eval-calendar-build, tr-eval-calendar-maintain이 쓴다). 남는 것: `callApi`, `eventually`, `findApp`, `liveCheck`, `oneLine`, `exampleMatches`, `appActive`, `releaseAdvanced`, `apiAnswers`, `ApiStep`, `reuseChecks`, `ReuseSpec`, `appToolCalled`, `askedAgainInput`, `appDesignInput`, `appToolSession`, `BugSpec`, `DiagnoseSpec`와 `diagnosisChecks`의 live 부분.
      - `diagnosisChecks(spec)`는 live check 셋을 이 순서로 낸다: `fixed-release-active`(고친 release가 active이고 첫 release가 superseded, runtime running), `no-recurrence`(같은 `bug.api` 호출이 `bug.expectAfterFix`로 답한다. problem은 보지 않는다), `blueprint-kept`. id는 그대로다.
    - `scenarios/calendar/common.ts`의 `createCalendarOperator`는 `agentAssignmentSet {app, removed_tools: []}`로 Operator에게 앱을 준다(O4, calendar-api가 쓴다). `CODING`, `aeTicketChecks`, `ticketCreate`, `ticketVerify`, `problemGet`이 없다. `LOPHN`, `AE`, `OP`, `eventInCalendar`, `buildAppChecks`, `buildAppFixtures`는 남는다.
      - `buildAppChecks(card, request)`는 `app-active`, `reuseChecks(REUSE)`, judge `asked-again`(premise `app-active`), judge `app-design`(premise `app-active`)이다. `buildAppFixtures(_goal: string)`는 이름과 인자 자리를 그대로 둔다(calendar-user·dev가 넘기는 글을 tr-eval-calendar-build가 다시 쓴다).
    - 시나리오 n은 올리지 않는다. 그 시나리오를 다시 쓰는 wave 2 task가 한 번 올린다.

## 할 일

brief는 main `85f19080e` 기준이다. 같은 wave의 tr-eval-prune-coding(`tests/eval/types.ts`, `runner/**`, `restore/**`, T19 시나리오 둘, `materials/calendar-call`)과 tr-eval-versions(`versions/**`, `experiment/**`의 그 몫, `registry/**`)의 file은 고치지 않는다. `tests/eval/checks/records.ts`, `tests/eval/scenarios/calendar/spec.ts`, A1-ask·A12·O4·calendar-api 시나리오도 소유 밖이다.

1. 지운다: `git rm tests/eval/checks/app/tickets.ts tests/eval/checks/app/observe.ts tests/eval/checks/app/observe_test.ts tests/eval/checks/app/calls_test.ts tests/eval/checks/calls_test.ts`. 두 `calls_test.ts`는 지우는 check(`aeCallsOnlyToCodingAgent`, `noOtherCallAfterFailedCall`)만 본다(`write-test`: 설계와 안 맞는 test는 지운다).
2. `tests/eval/checks/calls.ts`: `hasFailedCall`, `failedCalls`, `targetKey`, `noOtherCallAfterFailedCall`(77-146)과 import `callFailed`·`matchTarget`·`Participant`·`SentCall`을 지운다. `tests/eval/checks/mod.ts` 1-6은 `callAfterAppCreate`, `callCount`만 내보낸다.
3. `tests/eval/checks/fixtures.ts`: `FixtureCall.fail`(23)을 `"not_found" | "closed"`로 두고 `denied` 갈래(220-232)를 지운다(정한 것). tool step의 not_executed 기본 code `"denied"`(172)는 tool 결과라 그대로 둔다.
4. `tests/eval/checks/app/live.ts`: `problemList`·`ProblemListItem` import(8-11)와 `waitProblems`(63-79)를 지운다. `until`은 `eventually`가 쓴다.
5. `tests/eval/checks/app/calls.ts`: `aeCallsOnlyToCodingAgent`(6-40, 주석 포함)와 `readProblem`(75-93)을 지운다. `successCalls`, `appToolCalled`는 남는다.
6. `tests/eval/checks/app/fixtures.ts`: `addCodingCall`(27-52)을 지운다.
7. `tests/eval/checks/app/judge-input.ts`: `cardCoveredInput`, `rootCauseInput`과 그것만 쓰던 `SECTION_MAX`, `clip`, `TicketText`, `ticketLines`, `createdTickets`, import `appTools`·`joinInput`·`TrialRecord`·`BugSpec`·`findApp`·`./tickets.ts`를 지운다. `askedAgainInput`은 남기고 90 주석은 "request는 사람 말(`say`)이다"로 둔다.
8. `tests/eval/checks/app/diagnose.ts`
   - import `problemGet`(10), `readProblem`(13), `./tickets.ts`(16)와 `Snap`, `decideNoRecurrence`, `snapshot`(27-70)을 지운다. 쓰이지 않게 된 `App`, `Core`, `CheckOutcome` import도 지운다.
   - `diagnosisChecks`에서 `read-problem`, `evidence-has-problem`, `ticket-points-at-bug`를 지운다. `no-recurrence`는 `callApi` 결과가 `succeeded`이고 `exampleMatches(bug.expectAfterFix, outcome.result)`인지만 본다. problem 전후 snapshot과 3초 기다림(127)을 지운다. `fixed-release-active`, `blueprint-kept`는 그대로다.
   - 1 머리 주석은 "고친 release가 켜지고, 같은 호출이 이제 기대대로 답하고, blueprint를 고쳐 덮지 않았나"로 둔다.
9. `tests/eval/checks/app/mod.ts`: 계약의 "남는 것"만 내보낸다(`waitProblems`, `observe.ts` 줄, `aeCallsOnlyToCodingAgent`, `readProblem`, `cardCoveredInput`, `rootCauseInput`, `addCodingCall`을 지운다).
10. `tests/eval/scenarios/calendar/common.ts`
    - `agentGrantsSet` import(4)를 `agentAssignmentSet`(`packages/protocol/approvals/mod.ts`)으로 바꾸고 `createCalendarOperator`의 53-56을 `ctx.core.call(agentAssignmentSet, { agent: { role: "operator", agent: id }, entries: [{ app, removed_tools: [] }] }, { revision: 0 })`으로 둔다. 새 Operator는 할당 줄이 없어 revision이 0이다.
    - `CODING`(33)과 `codingAgent` import, `aeTicketChecks`(60-73), `ticketCreate`·`ticketVerify`·`problemGet`(101-121), import `addCodingCall`·`aeCallsOnlyToCodingAgent`·`cardCoveredInput`·`toolCount`·`FxStep`을 지운다. 31 주석에서 ticket·coding·problem 말을 뺀다("앱의 일은 앱 그릇의 App Engineer가 한다").
    - `buildAppFixtures(_goal: string)`: `{ right: [fixtureTrial([fixtureSession(AE, [])])], wrong: [] }`. 인자는 쓰지 않지만 부르는 곳의 글을 남기려고 둔다(`_` 앞머리라 lint가 넘긴다).
    - `buildAppChecks(card, request)`: 계약의 넷. `card-covered` judge는 입력 함수가 없어 뺀다. `asked-again`의 premise는 `app-active`다. `card` 인자는 `app-design`이 계속 쓴다.
11. `tests/eval/scenarios/calendar/calendar-user.scenario.ts`, `calendar-dev.scenario.ts`: import에서 `CODING`을 빼고(4), `real: [AE]`(12). `buildAppFixtures("…")`(17-19)는 그대로다. world의 `calendar-call@3`과 2 주석은 그대로 둔다(tr-eval-calendar-build가 바꾼다).
12. `tests/eval/scenarios/calendar/calendar-maintain.scenario.ts`: import `addCodingCall`·`aeCallsOnlyToCodingAgent`·`cardCoveredInput`과 common의 `aeTicketChecks`·`CODING`·`LOPHN`·`ticketCreate`·`ticketVerify`, `goal`·`aeSession`(31-33)을 지운다. `real: [AE]`. checks는 `app-active`, `release-advanced`, `data-remains`, `old-api-answers`, `repeat-works`, judge `asked-again`(premise `release-advanced`). `card-covered` judge는 뺀다. fixtures는 `{ right: [fixtureTrial([fixtureSession(AE, [])])], wrong: [] }`.
13. `tests/eval/scenarios/calendar/calendar-diagnose.scenario.ts`: import `addCodingCall`·`rootCauseInput`·`toolCount`와 common의 `CODING`·`problemGet`·`ticketCreate`·`ticketVerify`, `goal`·`aeSession`(19-22), 구조 분해(24)를 지운다. `real: [AE]`, checks는 `diagnosisChecks({ app: APP, bug: BUG })` 그대로. `ae-ticket-created`와 judge `root-cause`는 뺀다. fixtures는 12와 같다. steps와 1-2 주석은 그대로 둔다(tr-eval-calendar-maintain이 다시 쓴다).
14. `tests/eval/scenarios/lophn/L7.scenario.ts`: `restore/setup.ts` import(9)와 `setup`(23-26)을 지운다. `READS`(15)를 지우고 `read-all`은 `toolsCalled("read-all", [["app.get", "app.list"]])`, `no-write`는 그대로. fixtures: right `[app.get]`, `[app.list]`, wrong `[]`→`read-all`, `[app.get, fixtureAppCreate("가계부2")]`→`no-write`. 1 주석에서 "problem, ticket"을 뺀다. world와 사람 말은 그대로 둔다(tr-eval-scenario-fix가 다시 쓴다).

정한 것:
- **call fixture의 실패 이유에서 `denied`도 뺀다.** agent call은 Gate를 거치지 않아 막히지 않는다(`approval.md` 73). `denied`는 T19 둘과 지우는 `checks/calls_test.ts`만 썼다. `not_found`(이름이 안 풀림)와 `closed`는 지금도 난다.
- **`no-recurrence`의 id를 남기고 problem 판정만 뺀다.** 다른 brief가 이 id와 "같은 호출이 이제 답한다"에 기댄다. 고친 뒤 새 오류 log가 없는지는 tr-eval-calendar-maintain이 본다(survey 1의 `checks/app/diagnose.ts` 줄).
- **calendar 넷의 fixture는 wrong이 비고 남은 program check가 모두 live다.** 그래서 eval 시작의 fixture 확인(`validateFixtures`)은 이 넷에서 "wrong fixture 없음"으로 떨어진다. 새 check와 fixture는 wave 2 task(tr-eval-calendar-build, tr-eval-calendar-maintain)가 넣는다. 이 task는 import와 type만 맞추고 판정을 새로 짓지 않는다(README "범위 밖", skeleton "다시 쓰는 것은 wave 2의 일").
- **judge `card-covered`와 `root-cause`는 시나리오에서 뺀다.** 입력 함수(`cardCoveredInput`, `rootCauseInput`)를 지우기 때문이다. criterion file(`tests/eval/criteria/{card-covered,root-cause}.json`)은 소유 밖이라 둔다.

## 끝남

- `deno task check`가 통과한다. `tests/eval`은 아직 `NOT_CHECKED`라 fmt·lint만 이 file들을 본다.
- test: `deno test --no-check --allow-all tests/eval/checks tests/eval/scenarios/calendar/dates_test.ts`가 통과한다(지금 `reuse_test.ts`는 `live.ts`의 `problemList` 때문에 뜨지 못한다).
- import: 아래가 `FAIL`을 찍지 않는다(지운 export를 import하는 시나리오가 없다).
  ```sh
  for f in tests/eval/scenarios/calendar/*.scenario.ts tests/eval/scenarios/lophn/L7.scenario.ts tests/eval/scenarios/operator/O4.scenario.ts; do
    deno eval "await import('file://$PWD/$f')" > /dev/null 2>&1 || echo "FAIL $f"
  done
  ```
- type check: 아래 명령이 찍는 오류 자리는 `tests/eval/types.ts` 14-15(`IntentKind`·`RequestChoice`, tr-eval-human)와, T19 시나리오 둘이 아직 있으면(tr-eval-prune-coding이 merge되기 전) 그 둘과 `tests/eval/restore/{setup,active-app,package}.ts`·`tests/support/app/activate.ts`뿐이다. 이 task 소유 file에는 0줄이다.
  ```sh
  deno check $(git ls-files 'tests/eval/checks/*.ts' 'tests/eval/scenarios/*.ts') 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' | grep -oE "at (file://)?[^ ]+:[0-9]+:[0-9]+" \
    | sed "s#at ##; s#file://$PWD/##" | sed -E 's/:[0-9]+$//' | sort -u
  ```
- 위험 test: 없음. 죽은 check와 그 test를 지우는 일이다. 남은 판정(`exampleMatches`, reuse)은 `match_test.ts`, `reuse_test.ts`가 본다.
- 남지 않음:
  - `grep -rnE "ticketList|ticketShow|problemList|problemGet|ProblemListItem|waitProblems|readProblem|observationChecks|appTickets|problemTickets|appProblems|aeCallsOnlyToCodingAgent|addCodingCall|codingAgent|CODING\b|not_allowed|agentGrantsSet|restore/setup|hasFailedCall|noOtherCallAfterFailedCall|cardCoveredInput|rootCauseInput" tests/eval/checks tests/eval/scenarios`가 0줄이다(T19 둘이 아직 있으면 그 둘의 줄만 남는다).
  - `grep -nE "ticket\.|problem\.|coding" tests/eval/scenarios/calendar/{common,calendar-user,calendar-dev,calendar-maintain,calendar-diagnose}.ts tests/eval/scenarios/lophn/L7.scenario.ts tests/eval/checks/app/*.ts tests/eval/checks/*.ts`가 0줄이다. 소유 밖의 A1-ask·A12(`ticket.create`)와 `calendar/spec.ts`(`a problem opens`)는 wave 2 task가 고친다.
  - `git status --short tests/eval/registry tests/eval/criteria`가 빈다.
- 진짜 model과 eval은 돌리지 않는다(`deno task eval`, `eval:gate`, `eval:experiment`).

## 보고

- 바꾼 file
- 통과한 check(`deno task check`, test, import 고리, type check 명령의 출력 전부)
- 등록할 것: 없을 것이다. 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `tests/eval/checks/records.ts`의 `callFailed`(소유 밖), 그 밖에 생기면 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 문서(lead가 끝에 고친다): `project-docs/architecture/eval.md` 자리 표의 `checks/app/`(observation, 진단) 줄과 "check 순서가 실행 순서다"의 observation 예. 고칠 줄을 file:줄로 적는다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 적어도 아래는 적는다. 없으면 "없음"
  - calendar-user·calendar-dev·calendar-maintain·calendar-diagnose는 fixture 확인을 지나지 못한다(wrong fixture 없음). wave 2 task가 새 check와 fixture로 채운다.
  - calendar-diagnose는 아직 problem이 App Engineer를 부른다고 보는 단계(`callApi` 하나)다. 사람이 말하는 단계는 tr-eval-calendar-maintain이 더한다.
