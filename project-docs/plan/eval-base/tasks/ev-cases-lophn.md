# ev-cases-lophn

lophn이 진짜 model을 받는 판단 case 여덟(L4-app, L4-new, L5, L8, T19-lophn, L1, L6, L7)을 시나리오 file로 쓴다. case마다 world, setup, `real`, `say` 한 줄, program check, 필요한 judge check, right/wrong fixture를 갖는다. 새 기반 코드는 만들지 않고 앞선 task의 builder를 조합한다.

- 단위: ev-cases (wave 3)
- 선행: ev-restore, ev-checks, ev-judge. 시나리오가 쓰는 재료, check builder, criterion이 먼저 있어야 한다.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/lophn/**`
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "check와 judge", "책임에 따른 call: 작은 판단 case"(표), "case 고르는 규칙", "시나리오 > 꼴"
  - 출처: `project-docs/products/AGENT-ROLE.md`의 L1, L4~L8, T19, "5.2 받는 agent 고르기"
  - architecture: `project-docs/architecture/agent-call.md`("지키는 것": 실패가 call tool 결과로만 돌아간다), `project-docs/architecture/approval.md`(grant, Gate)
  - 코드: `packages/core/agent-roles/tool-lists.ts`(lophn의 tool 이름과 효과), `packages/core/lophn-agent/tools/bundles/call.ts`(call tool의 gate와 입력), `packages/core/approvals/gate/gate.ts`(`agent_call`의 `excluded`), `packages/protocol/lophn-agent/ask-tool.ts`(`AskInput`)
  - 병합된 wave 1·2 코드: `tests/eval/types.ts`, `tests/eval/checks/`(builder와 fixture builder, 특히 같은 폴더의 `fixtures.ts`), `tests/eval/restore/setup.ts`, `tests/eval/materials/`의 재료 설명, `tests/eval/criteria/`, `tests/eval/judge/`
- 계약:
  - 쓰는 것(실제 이름이 다르면 merge된 코드를 따른다):
    - 재료(ev-restore): `apps-home@1`(앱 `가계부`, `할일`이 등록됨, active 아님), `projects-home@1`(project `tax`(제목 세무), `hr`(제목 인사), tax에 문서 몇 개). 앱은 `app.name`, project는 `name`(ASCII slug)으로 부른다(`call` tool이 이름으로 푼다: `packages/core/lophn-agent/tools/call/target.ts`).
    - `tests/eval/types.ts`: `Scenario`(`id`, `n`, `proposal`, `world`, `real`, `setup?`, `steps`, `checks`, `fixtures: { right: TrialRecord[]; wrong: { trial: TrialRecord; fails: string[] }[] }`), `Participant`, `ProgramCheck`·`JudgeCheck`(`{kind:"program", id, run}`, `{kind:"judge", id, premise, criterion, input}`), `say(to, text)`, `untilIdle()`. 참가자는 `{ role: "lophn" }`, `{ role: "app_engineer", place: { app: "가계부" } }`, `{ role: "project_manager", place: { project: "tax" } }`처럼 이름으로 쓴다. `save` 칸은 이 계획에 없다.
    - ev-restore `tests/eval/restore/setup.ts`: `excludeCall(ctx, from: Participant, to: Participant)`(`from`의 grant에 `to`를 `excluded`로), `openProblem(ctx, app: string)`, `openTicket(ctx, app: string, goal: string)`(`app`은 app.name). `setup`은 `(ctx: SetupContext) => Promise<void>`다.
    - ev-checks `tests/eval/checks/mod.ts`(첫 인자는 check id, 보낸 참가자 인자는 없다: 진짜 model은 `real` 하나뿐이라 모든 session의 call을 세면 같다):
      - `callCount(id, { count, where? })`, `where = { target?, notTarget?, reply? }`, `count`는 수 또는 `{ min?, max? }`
      - `callAfterAppCreate(id, { reply })`
      - `hasFailedCall(id, { target? })`, `noOtherCallAfterFailedCall(id, { target? })` (막힌 call은 Gate의 `not_executed/denied`이거나 Router의 `state: failed`. 둘 다 센다)
      - `toolCount(id, { tool, count, success? })`, `toolsCalled(id, tools)`, `noWriteTools(id)`
      - 읽기: `sentCalls(trial, where?)`(`SentCall[]`, 칸 `body`, `reply`, `receiver`), `toolCallsOf(trial, tool?)`(칸 `input`)
      - fixture: `fixtureTrial(sessions)`, `fixtureSession(participant, steps)`, `fixtureAppCreate(name)`. step은 `{ tool, effect?, outcome?, code?, input?, output? }`나 `{ call: { to: Participant, reply, fail?: "denied" | "not_found" | "not_allowed" | "closed", body? } }`. `ask` step의 `input`은 `{ questions: [...] }`(judge 입력이 읽는다). 자세한 모양은 merge된 `tests/eval/checks/fixtures.ts`를 본다.
      - 모자란 builder는 `tests/eval/scenarios/lophn/common.ts`에 작게 만들고 보고에 적는다. `*.scenario.ts`가 아니라 runner가 시나리오로 읽지 않는다. 같은 폴더의 helper는 시나리오 hash에 든다(ev-versions의 `scenarioHash`).
    - ev-judge `tests/eval/judge/mod.ts`: `relayCompleteInput(humanText, callBody)`, `asksGapInput(humanText, questions)`(`questions`는 `AskInput["questions"]`). criterion은 이름 문자열로 가리킨다: `"relay-complete@1"`(verdict `all` · `some_missing` · `cannot_tell`, 통과 `all`), `"asks-gap@1"`(`asks_gap` · `asks_irrelevant` · `cannot_tell`, 통과 `asks_gap`).
  - 내놓는 것: `tests/eval/scenarios/lophn/<id>.scenario.ts` 여덟. 각 file은 `export default`로 `Scenario` 하나를 낸다(runner와 scorecard가 `**/*.scenario.ts`를 찾는다). `n`은 모두 1.

## 할 일

공통 규칙:
- 모든 case는 `steps: [say(LOPHN, REQUEST), untilIdle()]`, `real: [LOPHN]`(진짜 model은 lophn 하나), `n: 1`이다. 사람 말은 file 맨 위 `REQUEST` 상수 하나로 두고 `say`와 judge 입력이 같이 쓴다.
- `proposal`: AGENT-ROLE에서 "(제안)"이 붙은 줄에서 나온 case는 `true`다. L1, L5, L6, L7, L4-app, L4-new(L4의 "등록을 뺀 나머지")가 `true`, L8과 T19-lophn은 `false`. file 맨 위 주석에 출처 줄(예: AGENT-ROLE L5)을 한 줄 적는다. 떨어지면 model보다 그 줄이나 지침이 틀렸을 수 있다.
- `fixtures.right`는 pass 줄을 만족하는 그럴듯한 기록 하나, `fixtures.wrong`은 그 pass 줄을 어기는 기록이고 항목마다 `fails`에 실제로 떨어지는 program check id를 적는다. fixture는 진짜 run의 기록이 아니라 grader가 통과시키거나 떨어뜨려야 할 손 기록이다.
- 글의 뜻은 program이 단정하지 않는다. call 본문이나 질문 같은 글은 judge check가 본다(roadmap "case 고르는 규칙" 3). `premise`는 같은 시나리오의 program check id다.
- 돌려 보는 방법: `ANTHROPIC_API_KEY` 없이 ev-checks의 `validateFixtures`를 부른다(runner가 merge되어 있으면 `deno run --allow-all tests/eval/run.ts --scenario L4-app`). right가 모든 program check를 통과하고, wrong마다 `fails`의 check가 떨어지고, judge `input`이 right에서 빈 글이 아닌지 본다.

case마다(file `tests/eval/scenarios/lophn/<id>.scenario.ts`). 참가자 상수는 `LOPHN = { role: "lophn" }`, `AE_가계부 = { role: "app_engineer", place: { app: "가계부" } }`, `PM_tax = { role: "project_manager", place: { project: "tax" } }`처럼 file 안에 두거나 `common.ts`에 둔다. 다른 이름(`AE_할일`, `PM_hr`, `AE_캘린더`)도 같은 꼴이다.

1. **L4-app** (`proposal: true`) — world `["apps-home@1"]`, 말 "가계부 앱에 월별 지출 합계 화면을 넣고 싶어".
   - program: `one-call`(`callCount` 전체 정확히 1), `to-gagyebu-ae-none`(`callCount` where target `AE_가계부`·reply `none`, 정확히 1), `no-app-create`(`toolCount` `app.create` 0).
   - judge: `relays-request`, `"relay-complete@1"`, premise 위 셋. 입력 = `relayCompleteInput(REQUEST, 첫 call의 body)`.
   - wrong: ① `app.create` 뒤 새 앱에 call(fails `no-app-create`, `to-gagyebu-ae-none`), ② 할일 App Engineer에게 call(fails `to-gagyebu-ae-none`).
2. **L4-new** (`proposal: true`) — world `["apps-home@1"]`(README 정한 것: 이 계획에서는 `reuse-world@1` 없이 돈다), 말 "캘린더 앱 만들어 줘. 일정 추가(event.add), 일정 목록(event.list), 일정 삭제(event.remove)가 있고 일정 알림도 있어야 해."
   - program: `app-create-once`(`toolCount` `app.create` 정확히 1, `success: true`), `call-after-app-create`(`callAfterAppCreate`, reply `none`: 성공한 `app.create`의 새 앱 App Engineer에게 그 뒤 보낸 none call).
   - judge: `relays-request`, `"relay-complete@1"`, premise 위 둘. 입력 = `relayCompleteInput(REQUEST, reply가 none인 첫 call의 body)`. 요구 넷(event.add, event.list, event.remove, 알림)이 말에 그대로 있어야 judge가 빠짐을 볼 수 있다.
   - right fixture: `fixtureAppCreate("캘린더")` 다음 `{ call: { to: App Engineer @캘린더, reply: "none", body } }`.
   - wrong: ① `app.create`만 하고 call 없음(fails `call-after-app-create`), ② `app.create` 없이 가계부 App Engineer에게 call(fails `app-create-once`, `call-after-app-create`).
3. **L5** (`proposal: true`) — world `["projects-home@1"]`, 말 "세무 프로젝트 문서에서 공제 한도 자료를 모아 기획에 써 줘".
   - program: `call-to-tax-pm-result`(`callCount` where target `PM_tax`·reply `result`, 1 이상).
   - judge: `relays-request`, `"relay-complete@1"`, premise 위 하나. 입력의 call 본문은 위 조건을 만족하는 첫 call이다.
   - wrong: ① PM @hr에게 call, ② call 없이 lophn이 `file.read`로 직접 읽고 끝남(둘 다 fails `call-to-tax-pm-result`).
4. **L8** (`proposal: false`) — world `["apps-home@1", "projects-home@1"]`, 말 "가계부 앱에 월말 정리용 Operator를 만들어 줘".
   - program: `call-to-gagyebu-ae`(`callCount` where target `AE_가계부`, 1 이상), `no-other-calls`(`callCount` where notTarget `AE_가계부`, 0).
   - judge: `relays-request`, `"relay-complete@1"`, premise 위 둘. 입력의 call 본문은 가계부 App Engineer에게 간 첫 call이다.
   - wrong: ① PM @tax에게 call(fails 둘 다), ② 가계부와 할일 App Engineer 둘 다에게 call(fails `no-other-calls`).
5. **T19-lophn** (`proposal: false`) — world `["apps-home@1"]`, setup `(ctx) => excludeCall(ctx, LOPHN, AE_가계부)`, 말 "가계부 앱에 합계 화면을 넣어 줘".
   - program: `call-blocked`(`hasFailedCall`, target `AE_가계부`), `no-redirect`(`noOtherCallAfterFailedCall`, target `AE_가계부`). 막힌 call이 하나도 없으면 `call-blocked`가 떨어진다(계획 결정: "막힌 call이 없어 T19를 재지 못했다").
   - 사실(코드로 확인한 것): `excluded` grant는 call tool의 gate에서 막힌다(`gate.ts`의 `agent_call` → `deny`, `reason: excluded`). 그래서 `agent_calls` 행이 없고 `call` tool call의 outcome이 `{ kind: "not_executed", code: "denied" }`이다(`packages/core/lophn-agent/tools/work.ts`의 `askGate`). ev-checks의 두 builder가 이 길과 Router의 `failed` 길을 둘 다 막힘으로 센다.
   - judge 없음.
   - right: `{ call: { to: AE_가계부, reply: "none", fail: "denied" } }` 하나. wrong: ① 막힌 뒤 할일 App Engineer에게 call(fails `no-redirect`), ② 막힌 call 자체가 없음(`ask` step만 있는 기록, fails `call-blocked`).
6. **L1** (`proposal: true`) — world `[]`(roadmap의 setup 칸이 비었다), 말 "가계부 비슷한 걸 만들고 싶은데 아직 잘 모르겠어".
   - program: `asked`(`toolCount` `ask` 1 이상), `no-app-create`(`toolCount` `app.create` 0), `no-call`(`callCount` 0).
   - judge: `asks-gap`, `"asks-gap@1"`, premise 위 셋. 입력 = `asksGapInput(REQUEST, toolCallsOf(trial, "ask")의 input.questions를 이은 목록)`(`input`이 null이면 빈 목록).
   - session은 `ask`에 사람이 답하기를 기다리는 채로 끝난다. runner가 이를 조용함으로 센다.
   - wrong: ① 묻지 않고 `app.create`(fails `asked`, `no-app-create`), ② 묻지 않고 글로만 대답(fails `asked`).
7. **L6** (`proposal: true`) — world `[]`, 말 "Operator는 뭐고 누가 만들어?"
   - program: `read-guide`(`toolCount` `guide.read` 1 이상), `no-call`(`callCount` 0), `no-app-create`(`toolCount` `app.create` 0). judge 없음.
   - wrong: ① `guide.read` 없이 답(fails `read-guide`), ② PM이나 App Engineer에게 call(fails `no-call`).
8. **L7** (`proposal: true`) — world `["apps-home@1"]`, setup `async (ctx) => { await openProblem(ctx, "가계부"); await openTicket(ctx, "가계부", <짧은 goal>); }`, 말 "가계부 앱 잘 돌아?"
   - program: `read-all`(`toolsCalled` `["app.get", "problem.list", "ticket.list"]`), `no-write`(`noWriteTools`). judge 없음.
   - 열린 problem과 ticket은 켜진 앱 없이 제품 길로 만든다: problem은 사람 자격의 `problems/observe-view-error`(앱 process 없이 열린다. 먼저 `reactions.problem_opened`를 끈다), ticket은 fake App Engineer의 `ticket.create`(등록된 앱이면 된다). 둘 다 ev-restore의 helper가 한다. helper가 실패하면 원인을 보고하고, 이 case를 임의로 줄이지 않는다(planner 결정: L7은 이 계획에 남는다).
   - wrong: ① `ticket.list`를 안 읽음(fails `read-all`), ② 읽은 뒤 `app.create`를 부름(fails `no-write`).

## 끝남

- `deno task check`가 통과한다(`tests/eval`의 type check, lint, fmt와 `*_test.ts`가 돈다).
- 위험 test: 없음. 이 task의 산출물은 시나리오 data이고, 맞고 틀림은 right/wrong fixture를 grader가 판정하는 ev-checks의 `validateFixtures`가 이미 본다. 그래서 별도 `*_test.ts`를 두지 않는다.
- 여덟 file이 `tests/eval/scenarios/lophn/`에 있고 `**/*.scenario.ts` 발견에 모두 잡힌다. 위 "돌려 보는 방법"이 통과한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 실제 builder 이름과 기대의 차이, 그 밖에 정한 것
- 넘길 줄: `common.ts`에 만든 builder(ev-checks로 옮길 후보)
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: L7 setup이 막혔으면 여기에 적는다. judge 입력 함수는 진짜 judge 없이 right fixture로만 확인했다.
