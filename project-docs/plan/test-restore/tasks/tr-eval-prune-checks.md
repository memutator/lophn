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
- 계약:
  - 쓰는 것: tr-eval-prune-coding의 `types.ts`(coding 갈래 없음, `Scenario.real: Participant[]`, restore `setup.ts` 없음), `packages/protocol/approvals/assignment.ts`의 `agentAssignmentSet`(`{agent, entries: [{app, removed_tools}]}`, compare `{revision}`)
  - 내놓는 것:
    - `checks/mod.ts`에서 `hasFailedCall`, `noOtherCallAfterFailedCall`(T19만 썼다)이 빠진다. fixture의 call 실패 이유에 `not_allowed`가 없다.
    - `checks/app/mod.ts`에서 `waitProblems`, `observationChecks`, `ObserveSpec`, `Probe`, `aeCallsOnlyToCodingAgent`, `readProblem`, `addCodingCall`이 빠진다. ticket을 읽던 `cardCoveredInput`과 ticket·problem을 읽던 `rootCauseInput`, `diagnosisChecks`의 problem 부분도 빠진다(새 입력은 tr-eval-calendar-build, tr-eval-calendar-maintain이 쓴다). 남는 것: `callApi`, `eventually`, `findApp`, `liveCheck`, `oneLine`, `exampleMatches`, `appActive`, `releaseAdvanced`, `apiAnswers`, `ApiStep`, `reuseChecks`, `ReuseSpec`, `appToolCalled`, `askedAgainInput`, `appDesignInput`, `appToolSession`, `BugSpec`, `DiagnoseSpec`와 `diagnosisChecks`의 live 부분.
    - `scenarios/calendar/common.ts`의 `createCalendarOperator`는 `agentAssignmentSet {app, removed_tools: []}`로 Operator에게 앱을 준다(O4, calendar-api가 쓴다). `CODING`, `aeTicketChecks`, `ticketCreate`, `ticketVerify`, `problemGet`이 없다. `LOPHN`, `AE`, `OP`, `eventInCalendar`, `buildAppChecks`, `buildAppFixtures`는 남는다.
    - 시나리오 n은 올리지 않는다. 그 시나리오를 다시 쓰는 wave 2 task가 한 번 올린다.

## 할 일

죽은 check module과 export를 지우고, 그것을 import하던 check·시나리오 file에서 그 부분만 걷어 지운 이름(`ticket`, `problem`, `coding`, `not_allowed`, `agentGrantsSet`)이 `tests/eval/checks`와 `tests/eval/scenarios`에 남지 않게 한다.
