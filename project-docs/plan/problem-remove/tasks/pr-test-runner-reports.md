# pr-test-runner-reports

app test runner가 problem 보고 길을 부르는 곳을 지운다: examples run 뒤 `rewind_unproven`을 problem으로 올리는 길과, test 자식의 SDK 보고·잡은 예외를 core `problem.report`·`ObserveException`으로 넘기는 길. runner 자체와 rewind 증명(app test 이유 줄)은 `ae-builds`까지 남는다.

- 단위: test-runner-reports (wave 2)
- 선행: pr-check-exclude.
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/app-test-lookup.ts`
  - `packages/core/problems/tests/unproven.ts`
  - `packages/core/problems/tests/unproven_test.ts`
  - `packages/core/problems/tests/control.ts`
  - `packages/core/problems/tests/work/runner-service.ts`
  - `packages/core/problems/tests/work/app-test-run.ts`
  - `packages/core/problems/tests/work/app-driver.ts`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(`rewind_unproven`을 problem으로 올리는 길을 지운다)과 "뼈대 검토에서 정한 것"(test runner가 test child의 보고를 core로 넘기던 길, preview와 test mode의 오류는 이번에 log에 쓰지 않는다)
  - architecture: `project-docs/architecture/coding-agent.md`의 app test `rewind` 줄과 `project-docs/architecture/activation.md`의 unproven 줄(지금 동작이다. 문서는 계획 끝에 lead가 고친다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `child-supervision-protocol`, `project-docs/module-catalog.yaml`의 `packages/core/problems`
  - 코드: 위 소유 file, `packages/core/problems/tests/app-test/judge.ts`(`unprovenNote`를 쓰는 곳), `packages/core/problems/tests/app-test-lookup.ts`(`findPassedAppTestReason`), `packages/core/apps/preview/adapters/mod.ts`(`createPreviewBrokerServices`의 `problems?` 칸), `packages/core/apps/permissions/broker/server.ts`(problems service가 없으면 그 broker 경로가 없다), `packages/core/main/worker/test-runner.ts`(`--app-test-job`이 `runAppTestJob` 결과를 그대로 찍는다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - test runner는 core `problem.report`, `ObserveException`을 부르지 않는다. control이 report credential(`reportContext`)과 unproven credential(`unprovenContext`)을 발급하지 않고, runner job에서 `report_credential`·`unproven_credential`·`app_test_unproven`이 빠진다.
    - `app-driver.ts`는 `createProblemReportService`(`packages/core/apps/permissions/broker/problems.ts`)를 쓰지 않는다. 그래야 `pr-log-exception`이 그 service를 바꿀 수 있다.
    - 지운다: `UNPROVEN_PROBLEM`, `unprovenAfterExamples`, `unprovenMessage`, `unprovenOfReason`, runner의 `reportUnproven`·`collectorFor`, `AppTestHooks.collector`
    - 그대로: `unprovenNote`(app test pass 이유 줄. 증명 결과는 test 기록에만 남는다)

## 할 일

1. `packages/core/problems/tests/unproven.ts`: `UNPROVEN_PROBLEM`, `unprovenOfReason`, `unprovenAfterExamples`, `unprovenMessage`를 지운다. `unprovenNote`와 그것이 쓰는 머리·꼬리 상수만 남긴다. file 머리 주석과 `NOTE_HEAD` 위 주석을 "app test pass 이유 끝에 붙이는 한 줄"로 고친다(읽는 쪽 `unprovenOfReason`과 problem 알림 언급을 지운다).
2. `packages/core/problems/tests/unproven_test.ts`를 지운다. 두 test가 모두 지운 함수(`unprovenAfterExamples`, `unprovenOfReason`)를 본다(`write-test`: 설계와 안 맞는 옛 test는 지운다).
3. `packages/core/problems/tests/control.ts`:
   - `reportContext`, `unprovenContext`, `unprovenOf`, 상수 `REPORT_PROCESS`·`REPORT_PRINCIPAL`을 지운다. import에서 `problemReport`, `observeException`, `findPassedAppTestReason`, `unprovenOfReason`을 뺀다.
   - `send`는 runner credential 하나만 발급하고 폐기한다. `contexts`의 `report`·`unproven`과 `body`의 둘째·셋째 인자를 뺀다.
   - `dispatch`가 보내는 본문에서 `report_credential`, `diagnostic_scope`, `app_test_unproven`, `unproven_credential`을 빼고 `scope` 지역 값을 지운다.
   - 머리 주석의 "(과 앱 보고용 app credential)"을 지운다.
4. `packages/core/problems/tests/work/runner-service.ts`:
   - `RunJob`에서 `report_credential`, `diagnostic_scope`, `app_test_unproven`, `unproven_credential`을 뺀다.
   - `collectorFor`, `reportUnproven`과 그 호출을 지운다. import에서 `observeException`, `problemReport`, `unproven.ts`의 셋을 뺀다. `hooks`에는 `started`만 남는다.
   - `jobSpec`의 `scope: job.diagnostic_scope`를 뺀다.
   - 관측의 `runner: { forwarded }`가 없어지면 `detailed`와 `observations`가 같아진다. `fits`(canonicalHash로 한도를 재던 갈래)와 `detailed`를 지우고 `observations`를 그대로 싣는다.
   - 머리 주석의 "앱의 보고는 요청별 app credential(...)로 실제 collector 접수 route에 넘긴다"를 지운다.
5. `packages/core/problems/tests/work/app-test-run.ts`: `AppTestJob.scope`, `AppTestJobResult.forwarded`, `AppTestHooks.collector`, `createRealAppDriver`에 넘기던 `sink`, 지역 값 `scope`·`forwarded`를 지운다. `AppTestHooks` 위 주석의 collector 대역 설명을 고친다.
6. `packages/core/problems/tests/work/app-driver.ts`:
   - `createProblemReportService` import, `problems` 값, `DriverSink` type, `RealDriverInput.sink`를 지운다. broker 묶음은 `createPreviewBrokerServices({ scope: previewScopeOf(input.blueprint) })`로 만든다.
   - 머리 주석의 "앱의 SDK 보고가 오는 broker socket을 직접 연다"를 broker socket을 연다는 말로 고친다.
   - test 자식의 broker는 `problems/*` 경로를 갖지 않는다(`packages/core/apps/permissions/broker/server.ts`는 service가 없으면 경로를 두지 않는다). 앱의 예외 관측은 거절을 받고 진입점의 crash exit는 그대로다. preview와 test mode의 오류를 log에 쓰는 것은 이 계획 밖이다(README "뼈대 검토에서 정한 것").
7. 지운 이름을 grep해 소유 file의 주석과 오류 메시지에 남은 것을 고친다.

추가(planner): `app-test-lookup.ts`의 `findPassedAppTestReason`은 `control.ts`의 `unprovenOf`만 썼다. 같이 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우는 test는 problem으로 알릴 tool을 고르는 규칙을 보던 것이고 그 규칙이 없어진다. 권한 경계를 보던 test가 아니다.
- 남지 않음:
  - `git grep -nE "UNPROVEN_PROBLEM|unprovenAfterExamples|unprovenMessage|unprovenOfReason|reportUnproven|collectorFor|report_credential|unproven_credential|app_test_unproven|diagnostic_scope|createProblemReportService|forwarded|DriverSink" -- packages/core/problems/tests`가 0줄이다.
  - `git grep -nwE "problemReport|observeException" -- packages/core/problems/tests`가 0줄이다.
  - `git grep -n "rewind_unproven" -- packages/core/problems`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 적어도 `packages/core/problems/tests/app-test-lookup.ts`의 `findPassedAppTestReason`(소유 밖. 쓰던 곳은 `control.ts`의 `unprovenOf`뿐이었다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
