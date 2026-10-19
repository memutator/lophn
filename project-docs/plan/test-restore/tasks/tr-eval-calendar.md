# tr-eval-calendar

calendar 시나리오 넷(calendar-mvp, calendar-api, calendar-maintain, calendar-diagnose)이 새 앱 자료 판을 가리키게 하고 n을 올린다. 앱 tool을 부르는 live check를 새 선언에 맞춘다.

- 단위: eval (wave 1)
- 선행: tr-eval-apps, tr-eval-app-engineer. 새 판 재료가 있어야 world가 풀리고, eval이 App Engineer를 참가자로 알아야 한다.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/`
  - `tests/eval/checks/app/`
  - `tests/eval/criteria/card-covered.json`, `tests/eval/criteria/asked-again.json`, `tests/eval/criteria/root-cause.json`
- 읽을 것:
  - architecture: `project-docs/architecture/eval.md`("지키는 것"의 "check 순서가 실행 순서다", "버전은 hash로 고정한다", "case마다 right/wrong fixture를 둔다"), `project-docs/architecture/domain.md`(흐름의 "turn ── ResolvedAgent.domains": Operator는 place 그릇의 domain을 받는다, "domain의 일을 받는 쪽"), `project-docs/architecture/app-call.md`(agent tool 이름 `domain__<domain>__<tool>`)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`
  - 앞 task: `project-docs/plan/test-restore/tasks/tr-eval-apps.md`(판, needs, `calendar-call@3`의 받는 쪽이 App Engineer `{role: "app_engineer", place: {app: "캘린더"}}`)
  - role과 place: `packages/protocol/lophn-agent/places.ts`(`ROLE_PLACES`: Operator는 project·app에 놓인다), `packages/core/agent-roles/tool-lists.ts`(`ROLE_WRITE_TOOLS`: `ticket.create`·`ticket.verify`는 App Engineer만), `packages/protocol/lophn-agent/agent-definitions.ts`(`operatorCreate`, `agentDefinitionRead`의 `effective.domains`)
  - 지금 코드: `tests/eval/scenarios/calendar/*`, `tests/eval/checks/app/*`, `tests/eval/checks/fixtures.ts`(`fixtureSession`), `tests/eval/checks/validate.ts`(`validateFixtures`), `tests/eval/runner/world.ts`(`prepareTrialWorld`, `releaseWorld`), `tests/eval/restore/mod.ts`(`agentRefOf`, `deliverCall`)
  - criterion: `tests/eval/criteria/{card-covered,asked-again,root-cause}.json`(calendar 시나리오만 쓴다)
- 계약:
  - 쓰는 것: `tr-eval-apps`가 내놓은 판·needs·tool 이름, `tests/eval/checks/mod.ts`의 `fixtureTrial`·`fixtureSession`·`toolCount`·`FxStep`·`callCount`(모양을 바꾸지 않는다고 `tr-eval-checks`와 약속한다)

## 할 일

뼈대가 정한 것:
- 같은 폴더의 helper file(`common.ts`, `spec.ts`, `dates.ts`)은 그 폴더 모든 시나리오의 hash에 든다. 넷 다 n을 올린다.
- 참가자 role이 지금 role 목록과 맞는지 본다(계획 domain-entity가 App Engineer를 되살렸다. `calendar/common.ts`는 아직 앱이 `<slug>-project`에 묶인다고 적는다).
- `tests/eval/registry/`는 고치지 않는다. `deno task eval`은 돌리지 않는다(`tr-eval-apps` 참고).

기대는 것(소유 밖): App Engineer를 eval 참가자로 쓸 수 있어야 한다. `tr-eval-app-engineer`가 연다. 그 전에는 `tests/eval/types.ts`의 `Participant`는 `app_engineer`를 빼고, `agentRefOf`(`tests/eval/restore/mod.ts`), `fixtureSession`(`tests/eval/checks/fixtures.ts`), 받는 쪽 place(`tests/eval/collect/read.ts`의 `placeOf`, `PlaceName`)가 App Engineer를 모른다. 이것이 열린 뒤에 시작한다. 시작할 때 `Participant`에 `role: "app_engineer"`가 type check를 지나지 않으면 일하지 않고 lead에게 보고한다.

1. `common.ts` — 참가자를 지금 모델로(근거: `tool-lists.ts`, `places.ts`, domain.md).
   - `PROJECT`, `PM`을 지우고 `AE: Participant = { role: "app_engineer", place: { app: APP } }`를 둔다. 앱의 일(ticket, coding agent에게 맡기기, problem 읽기)은 App Engineer가 한다.
   - `OP`의 place를 `{ app: APP }`로.
   - `createCalendarOperator`: `operatorCreate`의 place를 `{ kind: "app", id: ctx.world.apps[APP]! }`로. Operator가 앱 그릇에 놓여 그 앱의 domain(`calendar`)을 맡으므로 비공개 tool도 받는다. 앱 grant 줄(`{ kind: "app", app, tools: [] }`)은 그대로다.
   - `pmTicketChecks` → `aeTicketChecks`, check id `ae-ticket-created`·`ae-ticket-verified`.
   - 주석: "`<slug>-project`에 묶인다"를 지우고, `calendar-app@1` → `calendar-app@2`, Project Manager → App Engineer.
2. `spec.ts` — 값(카드, 사람 말, script, `REUSE`·`OBSERVE`·`BUG`)은 그대로 두고 주석만: 판 이름(`calendar-app@2`, `date-range@2`, `calendar-data@2`, `calendar-app-bug@2`), `CARD_DIAGNOSE` 위 "Project Manager가 ask하면" → "App Engineer가 ask하면".
3. 시나리오 넷 — 모두 `n: 3`. 머리 주석의 Project Manager → App Engineer. `pmSession` → `aeSession`. judge `premise`와 wrong fixture의 `fails`를 새 check id로.
   - `calendar-mvp`: `world: ["notify-app@2", "date-range@2", "calendar-call@3"]`, `real: [AE, CODING]`, `lophnCall`의 `to: AE`, `aeCallsOnlyToCodingAgent("ae-calls-coding-only")`, `askedAgainInput(AE)`. 마지막 wrong(`LOPHN`에게 보낸 call)은 그대로 `ae-calls-coding-only`가 떨어진다.
   - `calendar-api`: `world: ["calendar-app@2"]`, `real: [OP]`, wrong fixture의 call `to: AE`. check는 그대로다(`appToolCalled`가 `domain__calendar__event_add…`를 `__event_add`로 맞춘다).
   - `calendar-maintain`: `world: ["calendar-app@2", "calendar-data@2"]`, `real: [AE, CODING]`, `say(AE, SAY_MAINTAIN)`, `askedAgainInput(AE, SAY_MAINTAIN)`.
   - `calendar-diagnose`: `world: ["calendar-app-bug@2"]`, `real: [AE, CODING]`, `toolCount("ae-ticket-created", …)`.
4. `tests/eval/checks/app/` — App Engineer로 맞춘다.
   - `calls.ts`: `pmCallsOnlyToCodingAgent` → `aeCallsOnlyToCodingAgent`, `readProblem`과 함께 session을 `s.agent.role === "app_engineer"`로 거른다. reason 글의 Project Manager → App Engineer.
   - `calls_test.ts`: trial의 session role을 `app_engineer`로, test 이름과 import를 새 이름으로.
   - `mod.ts`: export 이름.
   - `judge-input.ts`: `askedAgainInput`의 인자 이름 `pm` → `ae`, 주석. `cardCoveredInput`의 BLUEPRINT 줄은 그대로다(이미 `app.tools`의 `name`·`effect`·`inputSchema`와 `declarations.app_connections[].tools`를 읽는다).
   - `observe.ts`·`match.ts`의 주석 Project Manager → App Engineer.
   - 정한 것: `ApiStep`·`BugSpec`·`Probe`·`ReuseSpec.notify`의 `api` 칸 이름은 그대로 둔다. step `callApi`(`tests/eval/types.ts`)와 `calendar-data@2`의 `calls.json`이 `api`를 쓰고, 재료는 바꿀 수 없어 여기만 바꾸면 이름이 섞인다.
   - live check가 읽는 선언은 이미 새 것이다(`reuse.ts`의 `TEMPLATE_SDK_NAMES`·`connectTools`, `diagnose.ts`의 `appTools().tools`). 확인만 하고, dry run(5)에서 떨어지는 것만 고친다.
5. criterion(planner가 소유에 더했다): `tests/eval/criteria/{card-covered,asked-again,root-cause}.json`을 `n: 3`으로 올리고 question의 "Project Manager" → "App Engineer", card-covered의 "each app-api with its key" → "each tool with its name", "(an app-api, an input field, a connection)" → "(a tool, an input field, a connection)". 시나리오의 criterion 참조를 `@3`으로. 근거: judge 입력의 BLUEPRINT 줄이 tool 이름을 싣는데 question이 app-api key를 말하면 judge가 어긋난다.
6. **dry run**(진짜 model 없이). worktree에서 먼저 `deno task e2e:deps`. `.dev-data/tr-eval-calendar/dry-run.ts`(git 밖, commit하지 않는다)를 `deno run --allow-all .dev-data/tr-eval-calendar/dry-run.ts`로 돈다(`--env-file`을 주지 않는다). 시나리오 넷의 default export를 import한다. variant는 `resolveVariant({ current: <worktree> })`(`tests/eval/experiment/variant/mod.ts`), 시나리오마다 `prepareTrialWorld({ variant }, scenario, held)` → 확인 → `finally`에서 `releaseWorld(held)`다. live check는 `check.run({ trial: fixtureTrial([]), core })`로 부른다.
   - `validateFixtures([넷])`가 `{ ok: true, problems: [] }`다.
   - calendar-mvp: 되살리기 ok. `agentRefOf(ctx.world, AE)`가 `{ role: "app_engineer", app: "app_0000000000000000000000cdr1" }`. `deliverCall(ctx, "calendar-call@3")`가 ok.
   - calendar-api: 되살리기와 setup ok. `agentDefinitionRead({ agent: { role: "operator", agent: ctx.world.operators["일정관리"] } })`의 `effective.domains`가 1개(캘린더 앱의 domain)다.
   - calendar-maintain: 되살리기 ok. `app-active`·`data-remains`·`old-api-answers`가 통과하고 `release-advanced`·`repeat-works`는 떨어진다(model이 아직 일하지 않았다). 같은 world에서 `reuseChecks(REUSE)` 다섯이 통과하고, 맨 끝에 `observationChecks(OBSERVE)`의 앞 셋(`observe-bad-input`, `observe-notify-down`, `observe-store`)이 통과한다(`calendar-app@2`는 손으로 쓴 기준 앱이라 calendar-mvp의 live check를 새 선언으로 돌려 보는 자리다. `observe-store`가 store를 망가뜨리므로 마지막이다).
   - calendar-diagnose: 되살리기 ok. `callApi(core, 캘린더 id, BUG.api, BUG.input)`이 `failed`이고 `waitProblems`가 새 problem 하나를 본다.
   - 끝난 뒤 `/tmp/lophn-e2e-*`가 남지 않는다.
   - 기대와 다르게 떨어지면 재료 탓(→ `tr-eval-apps`에 넘길 것)인지 check 탓인지 갈라 보고한다.

## 끝남

- `deno task check:full`이 통과한다(`tests/eval/checks/app/*_test.ts`, `tests/eval/scenarios/calendar/dates_test.ts` 포함).
- dry run(할 일 6)의 확인이 모두 기대대로다.
- 위험 test: 없음(`calls_test.ts`는 role만 맞춘다).
- 남지 않음: `grep -rni "project_manager\|project manager\|calendar-project\|\bpm" tests/eval/scenarios/calendar tests/eval/checks/app`가 0줄이다. `grep -rn "@1\"\|calendar-call@2" tests/eval/scenarios/calendar`가 0줄이다.
- `deno task eval`, `eval:experiment`, `eval:gate`를 돌리지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- dry run 결과: 시나리오마다 한 줄(되살리기 시간, 확인 결과)
- 등록할 것: 없음일 것이다(registry는 run이 쓴다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
