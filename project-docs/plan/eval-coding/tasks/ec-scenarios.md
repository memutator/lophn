# ec-scenarios

캘린더 단위 시나리오 넷(calendar-mvp, calendar-api, calendar-maintain, calendar-diagnose)을 `tests/eval/scenarios/calendar/`에 쓰고, L4-new를 n=2로 올려 world를 `notify-app@1`·`date-range@1`로 바꾸고 `calendar-call`을 save한다. 시나리오마다 요구 카드(`Scenario.human`)와 허락 규칙, program check, judge check, right/wrong fixture를 갖는다. 새 기반 코드는 만들지 않고 앞선 task의 builder와 재료를 조합한다. 사람 말에 적는 app-api key와 입력·출력, 심은 bug, 일정 data는 이미 merge된 재료에서 베낀다.

- 단위: ec-scenarios (wave 4)
- 선행: ec-world, ec-calendar, ec-checks, ec-human
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/**`
  - `tests/eval/scenarios/lophn/L4-new.scenario.ts`
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "캘린더 단위"(표), "요구 카드", "재사용 확인", "observation 확인", "진단 확인", "단위와 의존", "진짜로 도는 것"(허락 규칙), "시나리오 > 꼴"
  - 계획: `project-docs/plan/eval-coding/README.md`의 "정한 것"(calendar-app@1은 손으로 쓴 기준 앱, 재사용·observation 확인은 calendar-mvp의 check, 뒤 단위는 `calendar-app@1`에서 시작, `calendar-app-bug@1`, `calendar-data@1`, 상한)
  - eval-base(landed): `tests/eval/scenarios/lophn/L4-new.scenario.ts`와 `lophn/common.ts`(이 task가 고치는 바탕), `tests/eval/checks/{mod,fixtures,validate,run}.ts`(`callCount`, `toolCount`, `fixtureSession`, `fixtureTrial`, `fixtureAppCreate`, `FixtureCall`, `validateFixtures`), `tests/eval/judge/{mod,input}.ts`, `tests/eval/criteria/mod.ts`, `tests/eval/restore/mod.ts`(`agentRefOf`)와 `types.ts`(`SetupContext`, `WorldIds`), `project-docs/architecture/eval.md`
  - 같은 계획의 brief: `ec-checks.md`(이 task가 쓰는 builder 전부), `ec-human.md`(`HumanSpec`), `ec-runner.md`(`Step`의 `deliver`·`callApi`, check 뒤에 save), `ec-world.md`, `ec-calendar.md`, `ec-restore.md`, `ec-contract.md`
  - 재료(merge된 것을 직접 연다): `tests/eval/materials/notify-app/1/`, `date-range/1/`, `calendar-call/1/`, `calendar-app/1/`, `calendar-app-bug/1/`, `calendar-data/1/`의 `material.json`과 `files/`. 앱 이름, app-api key와 입력·출력, package export 이름, bug patch, 일정 data는 여기가 정본이다.
  - 코드: `packages/protocol/lophn-agent/agent-definitions.ts`의 `operatorCreate`(place `{ kind: "app", id }`가 된다), `packages/protocol/approvals/grants.ts`의 `agentGrantsSet`(entry `{ kind: "app", app, apis: [] }`), `tests/e2e/operator_test.ts`의 `operatorWith`(Operator를 만들고 grant를 주는 모양), `packages/protocol/approvals/intent.ts`의 `IntentKind`(허락 규칙 키 `activation`)
- 계약:
  - 쓰는 것(실제 이름이 다르면 merge된 코드를 따르고 보고에 적는다):
    - `tests/eval/types.ts`(ec-contract가 정한 것. landed된 export를 따른다): `Scenario.human?: HumanSpec`(`{ card: string; approve: ApproveRule }`, `ApproveRule`은 `Partial<Record<IntentKind, ...>>`), `Scenario.save?: Save`(`Record<이름, SaveSource>`), `deliver(material: string)`(`world`에 든 call 재료의 이름, 예 `"calendar-call"`), `callApi(app, api, input?)`(app은 app.name), `activeApp(app)`, `sentCall(app)`(lophn이 그 앱의 App Engineer에게 보낸 첫 call의 본문과 받는 쪽을 담는 `call` 종류), `CodingParticipant`·`codingAgent(app)`·`isCodingAgent(p)`(`Scenario.real`은 `(Participant | CodingParticipant)[]`이다), `JudgeCheck.input`은 `string | Promise<string>`이라 ec-checks의 judge 입력 builder를 cast 없이 넣는다.
    - ec-checks `tests/eval/checks/app/mod.ts`: `liveCheck`, `findApp`, `callApi`(helper. step의 `callApi`와 이름이 겹치면 import에서 바꿔 쓴다), `appActive`, `releaseAdvanced`, `apiAnswers`·`ApiStep`, `reuseChecks`·`ReuseSpec`, `observationChecks`·`ObserveSpec`·`Probe`, `diagnosisChecks`·`DiagnoseSpec`·`BugSpec`, `aeCallsOnlyToCodingAgent`, `appApiCalled`, `appApiOrder`, `cardCoveredInput`, `askedAgainInput`, `rootCauseInput`, `appApiSession`, `addCodingCall`. 꼴은 `ec-checks.md`의 "내놓는 것"이다.
    - ev-checks `tests/eval/checks/mod.ts`: `callCount`, `toolCount`, `fixtureSession`, `fixtureTrial`, `fixtureAppCreate`, `FxStep`. (`FixtureCall.to`는 `Participant`라 coding agent를 못 가리킨다. coding agent로 간 call은 ec-checks의 `addCodingCall`로 더한다.)
    - 재료 이름: `notify-app@1`, `date-range@1`, `calendar-call@1`, `calendar-app@1`, `calendar-app-bug@1`, `calendar-data@1`(위 재료). criterion: `relay-complete@1`(L4-new), `card-covered@1`, `asked-again@1`, `root-cause@1`.
  - 내놓는 것: `tests/eval/scenarios/calendar/{calendar-mvp,calendar-api,calendar-maintain,calendar-diagnose}.scenario.ts`(각각 `export default`로 `Scenario` 하나, `n: 1`, `proposal: false`), 고친 `tests/eval/scenarios/lophn/L4-new.scenario.ts`(`n: 2`). 같은 폴더의 helper는 `spec.ts`, `common.ts`, `dates.ts`(시나리오가 아니다. `**/*.scenario.ts` glob에 안 걸린다).

## 할 일

공통 규칙:
- 앱 이름은 `캘린더`, 알림 앱은 `알림`, Operator는 `일정관리`다(재료의 실제 이름이 다르면 재료를 따른다). 모든 값은 `spec.ts`에 두고 시나리오 file은 그것을 조합만 한다. 이유: 같은 app-api 입력·출력과 날짜를 여러 시나리오와 fixture가 쓰므로 한 곳을 고치면 모두 따라간다. 시나리오 hash는 같은 폴더의 helper로 재므로 값을 고치면 시나리오 `n`을 올려야 한다(registry가 `conflict`로 막는다).
- check 순서가 곧 실행 순서다(ec-checks가 요구하는 계약). 데이터를 바꾸는 check(`apiAnswers`, `observationChecks`, `no-recurrence`)는 읽기만 하는 check 뒤에 두고, `observationChecks`(store를 망가뜨림)는 program check의 맨 끝에 둔다. judge check는 그 뒤다.
- 날짜는 `2099-03`~`2099-05`처럼 먼 미래로 고정한다(아래 spec). 이유: 알림 앱이 지난 시각을 거절하거나 eval을 돌리는 날에 따라 결과가 달라지지 않게 한다. 예외는 calendar-api(사람 말이 "다음 주 화요일"이라 실행 날짜로 계산한다).
- 각 시나리오의 `fixtures`는 진짜 run의 기록이 아니라 grader가 통과시키거나 떨어뜨려야 할 손 기록이다. core가 없는 fixture 확인(`core === null`)에서 live check는 `liveCheck`가 건너뛰므로(통과 처리) `fails`에는 기록만 보는 check id만 적는다.
- 사람 말과 카드에 앱 이름, key, 입력·출력을 그대로 적는다. 그래야 `apiAnswers`가 그 호출을 해서 판정할 수 있다.

1. **재료를 연다**. 위 "재료"의 file을 열어 아래를 `spec.ts`에 옮긴다. 아래 값은 계획이 정한 정본(`ec-world.md`, `ec-calendar.md`)이고 재료의 실제 file과 다르면 재료를 따르고 어긋난 곳을 보고한다.
   - 앱 이름과 id: `캘린더`(`app_0000000000000000000000cdr1`), `알림`(`app_0000000000000000000000ntfy`).
   - app-api(시각은 앱을 쓰는 사람의 지역 시각, 한 주는 월요일~일요일):
     - `event.add`(write): 입력 `{ title: string, start: { year, month, day, hour, minute } }`(정수 다섯 칸), 결과 `{ id, title, start: "YYYY-MM-DDTHH:mm", reminder: "scheduled" | "failed" }`.
     - `event.list`(read): 입력 `{ range?: "all" | "this_week" | "next_week" }`(주지 않으면 `all`), 결과 `{ rows: [{ id, title, start }], ... }`, `start` 빠른 순.
     - `event.remove`(write): 입력 `{ id: integer }`, 결과 `{ id, removed: boolean }`. 같은 id를 다시 지워도 오류가 아니다(`removed: false`).
     - 알림은 `event.add`가 알림 앱의 `notify.schedule`(`{ title, at: epoch ms }`)을 시작 10분 전으로 부른다. 목록의 주 범위는 `@me/date-range`의 `weekRange`로 계산한다.
   - problem 이름: 잘못된 시각 `event_input_invalid`, 저장소 실패 `store_unavailable`, 알림 앱 호출 실패 `notify_call_failed`(기준 앱 `calendar-app@1`의 이름이다. 진짜 coding agent가 만든 앱은 다를 수 있어 check는 이름을 단정하지 않는다).
   - 재사용: `PKG = "@me/date-range"`, `PKG_EXPORTS`(`date-range@1/files/publish.json`의 `exports`: `toDate`, `formatLocal`, `weekRange`. 정의 검사에 쓰므로 type 이름 `DateParts`도 더한다), `NOTIFY = { app: "알림", api: "notify.schedule" }`.
   - `calendar-data@1/files/calls.json`의 일정(쓰기 호출): `팀 회의` 2099-03-02 10:00, `점심 약속` 2099-03-04 12:00, `독서 모임` 2099-03-06 19:00.
   - `calendar-app-bug@1/files/bug.json`(`{ api, input, expect_after_fix, files, description }`): 기대값은 `event.list { range: "next_week" }`가 처리되지 않는 `TypeError`를 던진다(`src/events.ts`의 `RANGE_RULES`에서 `next_week` 줄이 빠졌다). 이것을 `BugSpec`(`expectAfterFix`는 camelCase)으로 옮긴다. 칸 이름이나 값이 다르면 재료를 따른다. 고친 뒤 기대 결과는 data 없는 앱의 `{ rows: [] }`다.
   - 복원된 첫 release의 번호: `RESTORED_RELEASE = 1`(calendar-maintain의 `releaseAdvanced`와 calendar-diagnose가 쓴다. 재료를 되살린 뒤 `releasesListRecords`로 확인되는 값이 정본이다. 다르면 보고한다).
2. **`spec.ts`에 둘 것**.
   - 이름 상수: `APP`, `NOTIFY_APP`, `OPERATOR`.
   - 요구 카드 셋(글 자체. `HumanSpec.card`로 넘긴다. 형식은 roadmap "요구 카드"와 같게 "원하는 것 / 정해 둔 답 / 모르는 것"):
     - `CARD_MVP`(`calendar-call@1` 본문이 쓰지 않은 것을 담는다: 알림 시각, 한 주의 정의, 목록을 거르는 말, 반복 없음):

       ```
       원하는 것: 일정 추가·목록·삭제, 일정 전 알림
       정해 둔 답: 알림은 일정 시작 10분 전. 한 주는 월요일부터 일요일까지. 목록은 이번 주·다음 주·전체로 거름. 반복은 지금 필요 없음
       모르는 것: 색, 화면 배치 → "추천대로 해 줘"
       ```
     - `CARD_MAINTAIN`:

       ```
       원하는 것: 반복 일정. event.add에 repeat 입력("none" 또는 "weekly", 주지 않으면 "none")을 더한다
       정해 둔 답: 반복은 매주(weekly)만. weekly이면 start부터 매주 같은 요일·같은 시각으로 모두 4번 나타난다. 지금 있는 일정과 app-api 이름·입력, 알림은 시작 10분 전, 한 주는 월요일~일요일 그대로
       모르는 것: 그 밖의 전부 → "추천대로 해 줘"
       ```
     - `CARD_DIAGNOSE`:

       ```
       원하는 것: 이 문제가 다시 나지 않게 고쳐 줘. 이미 쓰는 app-api의 이름과 입력은 바꾸지 마
       모르는 것: 그 밖의 전부 → "추천대로 해 줘"
       ```
       calendar-diagnose는 roadmap 표에서 사람 역할이 없다. 그래도 카드를 둔다. 이유: App Engineer가 `ask`하면(예: problem을 닫을지) 답할 사람이 없어 trial이 90분 상한까지 멈춘다. 카드는 전부 "추천대로"로 답하게 하는 최소 카드다.
   - 사람 말 둘: `SAY_MAINTAIN`("캘린더 앱에 반복 일정 기능을 더해 줘. event.add 입력에 repeat(\"none\" 또는 \"weekly\")를 더해 줘. 주지 않으면 \"none\"이고 지금처럼 일정 하나만 만들어. \"weekly\"이면 start부터 매주 같은 요일·같은 시각으로 일정이 나타나게 해 줘. event.list에도 나와야 해."), `SAY_API`("다음 주 화요일 3시에 치과 일정 넣고 이번 주 일정 알려 줘").
   - app-api 호출 script(`ApiStep[]`. 날짜는 먼 미래이고 `start`는 구조 입력이다. `D(y,m,d,h,mi)`는 `{ year, month, day, hour, minute }`를 만드는 작은 함수):
     - `MVP_SCRIPT`(빈 DB에서 도는 앱, calendar-mvp): `event.add { title: "치과", start: D(2099,3,10,15,0) }` → `{ title: "치과", start: "2099-03-10T15:00" }`; `event.list { range: "all" }` → `{ rows: [{ title: "치과", start: "2099-03-10T15:00" }] }`; `event.list { range: "this_week" }` → `{ rows: [] }`(먼 미래라 이번 주에 없다); `event.remove { id: 앞 add 결과의 id }` → `{ removed: true }`; 같은 `event.remove`를 한 번 더 → `{ removed: false }`(멱등); `event.list { range: "all" }` → `{ rows: [] }`.
     - `OLD_SCRIPT`(일정 data가 이미 있는 앱, calendar-maintain): `event.add { title: "치과", start: D(2099,4,7,15,0) }` → `{ title: "치과", start: "2099-04-07T15:00" }`; `event.list { range: "all" }` → 함수 expect: 그 일정이 있다; `event.remove { id }` → `{ removed: true }`. (`all` 목록에 seed 세 건이 함께 있으므로 줄 수에 기대지 않는다.)
     - `SEED_CALLS`(`data-remains`): `event.list { range: "all" }` → 함수 expect: seed 세 일정이 `title`·`start`로 `start` 빠른 순으로 들어 있다(다른 일정이 더 있어도 된다).
     - `REPEAT_SCRIPT`: `event.add { title: "운동", start: D(2099,5,4,7,0), repeat: "weekly" }` → `{ title: "운동", start: "2099-05-04T07:00" }`; `event.list { range: "all" }` → 함수 expect: `title`이 "운동"인 줄의 `start`에 `2099-05-04T07:00`, `2099-05-11T07:00`, `2099-05-18T07:00`, `2099-05-25T07:00`이 모두 있다.
   - `REUSE: ReuseSpec = { app: APP, notify: { app: NOTIFY_APP, api: "notify.schedule" }, pkg: { name: PKG, exports: PKG_EXPORTS } }`.
   - `OBSERVE: ObserveSpec`: `badInput = { api: "event.add", input: { title: "잘못된 입력", start: D(2099,2,30,9,0) } }`(정수 칸이 모두 범위 안이라 schema를 통과하지만 없는 날짜라 업무 규칙이 거절한다. 기준 앱에서는 `event_input_invalid`), `notifyDown = { api: "event.add", input: { title: "알림 실패", start: D(2099,6,1,9,0) } }`(기준 앱에서는 `notify_call_failed`), `store = { api: "event.list", input: { range: "all" } }`(기준 앱에서는 `store_unavailable`), `notify = NOTIFY_APP`.
   - `BUG: BugSpec`(1에서 `bug.json`을 옮긴 값. `api`는 `event.list`, `input`은 `{ range: "next_week" }`).
3. **`dates.ts`와 test**: `nextWeekTuesdays(now: Date): string[]`(local 날짜 `YYYY-MM-DD`). "다음 주 화요일"은 주를 월요일 시작으로 본 날짜와 일요일 시작으로 본 날짜 둘이 후보다(같으면 하나). Operator model과 사람이 일요일에 "다음 주"를 다르게 읽는 일이 있어, 둘 중 하나면 맞는 것으로 친다. 위험 test 하나(`dates_test.ts`): 월요일·화요일·일요일·토요일 날짜로 두 후보가 맞게 나온다(주 경계에서 틀리면 calendar-api가 거짓으로 떨어진다).
4. **`common.ts`**: 참가자 상수, 공용 check 조각, setup, fixture helper.
   - 참가자: `LOPHN`, `AE = { role: "app_engineer", place: { app: APP } }`, `CODING = codingAgent(APP)`(`types.ts`), `OP = { role: "operator", name: OPERATOR, place: { app: APP } }`.
   - `createCalendarOperator(ctx: SetupContext): Promise<void>`: `ctx.core.ids.newId("agt")`로 id를 정해 `operatorCreate({ id, place: { kind: "app", id: ctx.world.apps[APP] }, definition: { name: OPERATOR, body: <한두 줄 짧은 지침> } })`, `agentGrantsSet({ agent: { role: "operator", agent: id }, entries: [{ kind: "app", app: ctx.world.apps[APP], apis: [] }] })`, `ctx.world.operators[OPERATOR] = id`. model은 정의에 넣지 않는다(runner가 `real`에 붙인다). 이유: calendar-api의 world(`calendar-app@1`)에는 Operator가 없고, 이 task가 재료를 소유하지 않으므로 setup에서 제품 route로 만든다.
   - 공용 check 조각: `aeTicketChecks()` = `[toolCount("ae-ticket-created", { tool: "ticket.create", count: { min: 1 } }), toolCount("ae-ticket-verified", { tool: "ticket.verify", count: { min: 1 }, success: true })]`(`ec-checks`의 `aeCallsOnlyToCodingAgent("ae-calls-coding-only")`와 함께 calendar-mvp와 calendar-maintain이 쓴다).
   - `event-in-calendar` check(calendar-api 전용, live): `liveCheck`로 만든다. `callApi(core, app, "event.list", { range: "all" })`의 `rows` 가운데 `title`에 "치과"가 들고 `start`가 `nextWeekTuesdays(new Date(trial.started_at))`의 어느 날짜 `<날>T15:00`과 같은 줄이 하나라도 있으면 통과.
   - fixture helper: `ticketCreate(goal)`(`FxStep`: `tool: "ticket.create"`, `effect: "write"`, `input: { app: "app_fx_캘린더", goal, check: { kind: "text", text: "..." } }`, `output: { status: "success", content: { ticket: "tkt_fx" } }`), `ticketVerify()`, `problemGet()`(`tool: "problem.get"`).
5. **calendar-mvp** (`calendar-mvp.scenario.ts`)
   - world `["notify-app@1", "date-range@1", "calendar-call@1"]`, `real: [AE, CODING]`, `human: { card: CARD_MVP, approve: { activation: "allow" } }`, `steps: [deliver("calendar-call"), untilIdle()]`, `save: { "calendar-app": activeApp(APP) }`.
   - program(기록): `...aeTicketChecks()`, `aeCallsOnlyToCodingAgent("ae-calls-coding-only")`.
   - program(live): `appActive("app-active", { app: APP })`, `apiAnswers("api-answers", { app: APP, steps: MVP_SCRIPT })`, `...reuseChecks(REUSE)`, `...observationChecks(OBSERVE)`.
   - judge: `card-covered`(`criterion: "card-covered@1"`, `premise: ["app-active"]`, `input: cardCoveredInput(CARD_MVP, APP)`), `asked-again`(`"asked-again@1"`, `premise: ["ae-ticket-created"]`, `input: askedAgainInput(APP)`).
   - right fixture: lophn session(`fixtureSession(LOPHN, [{ call: { to: AE, reply: "none", body } }])`: fake lophn이 call을 보낸 기록), App Engineer session(`addCodingCall(fixtureSession(AE, [ticketCreate(...), ticketVerify()]), APP, body)`).
   - wrong: ① ticket 없이 끝남(AE session은 `addCodingCall(fixtureSession(AE, []), APP)`만. fails `ae-ticket-created`, `ae-ticket-verified`), ② ticket은 만들었지만 verify가 없음(fails `ae-ticket-verified`), ③ coding agent 대신 lophn에게 call(`{ call: { to: LOPHN, reply: "none", ... } }`. fails `ae-calls-coding-only`).
6. **calendar-api** (`calendar-api.scenario.ts`)
   - world `["calendar-app@1"]`, `setup: createCalendarOperator`, `real: [OP]`, `human`과 `save` 없음, `steps: [say(OP, SAY_API), untilIdle()]`.
   - program(기록): `appApiCalled("added", { command: "event.add" })`, `appApiCalled("listed", { command: "event.list" })`, `appApiOrder("list-after-add", { first: "event.add", then: "event.list" })`, `callCount("no-agent-calls", { count: 0 })`.
   - program(live): `event-in-calendar`.
   - judge 없음.
   - right fixture: `appApiSession(OP, [{ tool: "app__fx__event.add", effect: "write" }, { tool: "app__fx__event.list" }])`. wrong: ① `event.add` 없이 `event.list`만(fails `added`, `list-after-add`), ② `event.list`가 `event.add` 앞(fails `list-after-add`), ③ Operator가 다른 agent에게 call(fails `no-agent-calls`).
   - tool 정확도(app-api tool의 성공·형식 오류 비율)는 check가 아니라 공통 수치(`Metrics.tools`)다. 이 시나리오는 그 수치를 scorecard에서 읽는다(roadmap "확인": app-api tool의 정확도).
7. **calendar-maintain** (`calendar-maintain.scenario.ts`)
   - world `["calendar-app@1", "calendar-data@1"]`, `real: [AE, CODING]`, `human: { card: CARD_MAINTAIN, approve: { activation: "allow" } }`, `steps: [say(AE, SAY_MAINTAIN), untilIdle()]`, `save: { "calendar-app": activeApp(APP) }`.
   - program(기록): `...aeTicketChecks()`, `aeCallsOnlyToCodingAgent("ae-calls-coding-only")`.
   - program(live): `appActive("app-active", ...)`, `releaseAdvanced("release-advanced", { app: APP, after: RESTORED_RELEASE })`, `apiAnswers("data-remains", { app: APP, steps: SEED_CALLS })`, `apiAnswers("old-api-answers", { app: APP, steps: OLD_SCRIPT })`, `apiAnswers("repeat-works", { app: APP, steps: REPEAT_SCRIPT })`. (data를 바꾸는 `old-api-answers`·`repeat-works`는 `data-remains` 뒤다.)
   - judge: `card-covered`(`premise: ["release-advanced"]`, `input: cardCoveredInput(CARD_MAINTAIN, APP)`), `asked-again`(`premise: ["ae-ticket-created"]`, `input: askedAgainInput(APP, SAY_MAINTAIN)`; 요청이 call이 아니라 `say`로 가므로 두 번째 꼴).
   - right/wrong: calendar-mvp와 같은 모양(lophn session 없이 AE session 하나). wrong: ① ticket 없음, ② verify 없음, ③ coding agent 아닌 곳으로 call.
8. **calendar-diagnose** (`calendar-diagnose.scenario.ts`)
   - world `["calendar-app-bug@1"]`, `real: [AE, CODING]`, `human: { card: CARD_DIAGNOSE, approve: { activation: "allow" } }`, `steps: [callApi(APP, BUG.api, BUG.input), untilIdle()]`. 사람 자격 호출이 bug를 터뜨리면 problem이 열리고 `reactions.problem_opened`의 기본(`open`)대로 program이 App Engineer를 부른다(`tests/e2e/reaction_test.ts`의 길). `save` 없음.
   - program: 기록 `ae-ticket-created`(`toolCount`, 위와 같은 id·조건), live `...diagnosisChecks({ app: APP, bug: BUG })`. 배열에서 `read-problem`(기록)과 `ae-ticket-created`를 앞에 둔다.
   - judge: `root-cause`(`criterion: "root-cause@1"`, `premise: ["evidence-has-problem"]`, `input: rootCauseInput(BUG, APP)`).
   - right fixture: AE session `addCodingCall(fixtureSession(AE, [problemGet(), ticketCreate(...), ticketVerify()]), APP, body)`. wrong: ① problem을 읽지 않고 ticket(fails `read-problem`), ② ticket 없음(fails `ae-ticket-created`).
9. **L4-new** (`tests/eval/scenarios/lophn/L4-new.scenario.ts`). landed된 L4-new@1(상수 `REQUEST`와 `BODY`, `./common.ts`에서 `AE_가계부, AE_캘린더, firstCallBody, LOPHN`을 import. `lophn/common.ts`는 이 task의 소유가 아니다)을 이렇게 바꾼다. 나머지(program check `app-create-once`, `call-after-app-create`, judge `relays-request`(`relayCompleteInput(REQUEST, firstCallBody(trial, { reply: "none" }))`), `real: [LOPHN]`, `proposal: true`)는 그대로다.
   - `n: 2`. `world: ["notify-app@1", "date-range@1"]`(`apps-home@1`을 뺀다).
   - `save: { "calendar-call": sentCall("캘린더") }`.
   - 상수 `REQUEST`를 `ec-world.md`의 `calendar-call@1` 본문과 같은 key와 입력·출력으로 쓴다. 이유: 산출물이 `calendar-call@1`의 후보가 되어 calendar-mvp의 `apiAnswers`가 그 call로 만든 앱을 부르려면 call 본문에 key와 입력·출력이 있어야 하고, 사람 말에 없으면 lophn이 옮길 수 없다. 본문처럼 알림 앱·package를 쓰라는 말, 알림 시각(10분 전), 주의 정의는 쓰지 않는다(재사용은 App Engineer가 스스로 찾는지를 본다. 시각과 주는 요구 카드의 몫이다). landed된 `calendar-call/1/files/call.json`의 `body`와 app-api 세 줄이 다르면 그것을 따른다. 기대 글:

     ```
     캘린더 앱 만들어 줘. 일정을 넣고, 목록으로 보고, 지우고, 일정 전에 알림도 받고 싶어. app-api는 이 key와 입력·출력으로 만들어 줘. 시각은 쓰는 사람의 지역 시각이야.
     - event.add (쓰기). 입력 { title: 문자열, start: { year, month, day, hour, minute } } 다섯 칸은 모두 정수야. 출력 { id, title, start } 이고 start는 "YYYY-MM-DDTHH:mm" 문자열이야.
     - event.list (읽기). 입력 { range?: "this_week" | "next_week" | "all" }, 주지 않으면 all이야. 출력은 { id, title, start } 행의 목록이고 start가 빠른 순이야.
     - event.remove (쓰기). 입력 { id: 정수 }. 출력 { id, removed: true 또는 false }.
     ```
   - 시나리오 hash는 그 file과 같은 폴더의 helper(`.scenario.ts`와 `_test.ts`가 아닌 file. `tests/eval/versions/authored.ts`의 `scenarioHash`)로 잰다. `lophn/common.ts`는 이미 든다. `../calendar/spec.ts`를 import하지 않는다(그러면 calendar helper를 고쳐도 L4-new `n`이 안 올라가는 구멍이 생긴다). 말은 이 file 안에 둔다.
   - fixture: right는 landed 모양 그대로(`fixtureAppCreate("캘린더")` 다음 `{ call: { to: AE_캘린더, reply: "none", body: BODY } }`)이고 `BODY`(요구를 옮긴 call 본문 상수)에 새 입력·출력 글을 넣는다. wrong ②의 `AE_가계부`를 이 file 안에 둘 상수 `AE_알림 = { role: "app_engineer", place: { app: "알림" } }`로 바꾼다(world에 가계부가 없다. `AE_가계부` import는 지운다). wrong ①과 fails 목록은 그대로다.
10. 돌려 본다: `ANTHROPIC_API_KEY=` (빈 값)으로 `deno run --allow-all tests/eval/run.ts --scenario calendar-mvp`(`deno task eval`은 `.env`의 key를 읽어 진짜 provider를 부르므로 쓰지 않는다. 시작할 때 재료 hash와 fixture를 확인하고 key가 없으면 0으로 끝난다)(나머지 셋과 `L4-new`도). 각 시나리오에서 right fixture가 모든 program check를 통과하고(live check는 건너뛴다), wrong마다 `fails`의 check가 떨어지고, judge `input`이 right에서 빈 글이 아니다. 진짜 provider와 진짜 claude는 부르지 않는다. 진짜 trial은 lead가 돈다(README "lead가 할 일").

## 정한 것

- **카드는 시나리오 file 옆 helper(`spec.ts`)에 글로 둔다**: `HumanSpec.card`가 글 자체다(`ec-human.md`). 시나리오 hash가 같은 폴더의 helper를 재므로 카드를 고치면 시나리오 `n`을 올려야 한다(roadmap "카드는 시나리오 버전에 든다").
- **calendar-diagnose에도 카드를 준다**: 위 2. 사람 역할이 없으면 App Engineer의 `ask`가 영영 답을 못 받는다.
- **보조 데이터와 날짜는 먼 미래(2099)**: 위 공통 규칙.
- **줄 수에 기대지 않는다**: 일정 data가 있거나 앞 check가 일정을 넣어 둔 앱의 `event.list`는 함수 expect로 필요한 일정이 있는지만 본다. 줄 수와 순서까지 맞추는 expect는 빈 DB에서 도는 `MVP_SCRIPT`뿐이다.
- **calendar-mvp와 calendar-maintain의 save 이름은 둘 다 `calendar-app`이다**: 로드맵 표를 따랐다(mvp는 `calendar-app@1`, maintain은 `calendar-app@2`). runner는 이름이 같으면 다음 `n`을 쓰므로 `calendar-app@1`이 손으로 쓴 기준 앱이면 둘 다 후보 `@2`, `@3`처럼 먼저 도는 쪽이 앞 번호를 가진다. 어느 쪽이 어느 계보인지는 `produced_by`가 말한다. 사람이 후보를 고를 때 보고 이름을 정한다.

## 끝남

- `deno task check`가 통과한다(`tests/eval`의 type check, lint, fmt와 `*_test.ts`가 돈다).
- 위험 test: "`nextWeekTuesdays`가 주 경계(일요일, 월요일)에서 월요일 시작과 일요일 시작 두 규칙의 화요일을 맞게 낸다." (`dates_test.ts`. 틀리면 Operator가 맞게 일정을 넣어도 calendar-api가 떨어진다.) 시나리오 file의 맞고 틀림은 ev-checks의 `validateFixtures`가 이미 본다.
- 다섯 시나리오가 `**/*.scenario.ts` 발견에 모두 잡히고, 위 "돌려 본다"가 통과한다.
- 남지 않음: `grep -rn "apps-home" tests/eval/scenarios/lophn/L4-new.scenario.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 재료와 기대가 달라 맞춘 곳(app-api 입력·출력, 날짜, export 이름, bug), 기대한 export와 달라 맞춘 이름
- 넘길 줄: 남의 file을 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `Scenario.human`, `Scenario.save`, `Step`, `real`의 coding agent가 위 모양과 달라 막히는 곳
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: live check는 fixture에서 건너뛰어 right/wrong으로 검증하지 못했다(첫 진짜 실행에서 본다). `calendar-app@1`의 첫 release 번호(`RESTORED_RELEASE`)와 notify app이 먼 미래 날짜(2099)를 받는지는 재료를 되살려 봐야 안다.
