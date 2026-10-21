# tr-eval-scenario-fix

지운 tool과 setup에 묶인 판단 시나리오를 고친다. L6은 `guide.read` 대신 `guide-*` skill의 `skill.read`, A1-ask와 A12는 지운 `ticket.create` check를 지금 tool로, O4와 calendar-api는 되살린 world와 할당으로 Operator가 돈다. L7은 lophn이 앱·status·logs·invocations를 읽고 아무것도 쓰지 않는 것으로 다시 쓴다.

- 단위: eval (wave 2)
- 선행: tr-eval-restore, tr-eval-human.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/lophn/{L6,L7}.scenario.ts`
  - `tests/eval/scenarios/app-engineer/{A1-ask,A12}.scenario.ts`
  - `tests/eval/scenarios/operator/O4.scenario.ts`
  - `tests/eval/scenarios/calendar/calendar-api.scenario.ts`
  - `tests/eval/checks/tools.ts`
  - `tests/eval/registry/scenario/{L6,L7,A1-ask,A12,O4,calendar-api}.json`
  - `tests/eval/criteria/facts-separated.json` (새 file. L7의 judge)
  - `tests/eval/registry/criterion/facts-separated.json` (새 file. 등록이 만든다)
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md` "범위 밖"(사람 말과 check를 결과로 다시 쓰기는 사람의 실험 일), `project-docs/plan/test-restore/survey-eval.md` §2의 L6, L7, A1-ask, A12, O4, calendar-api 줄과 §4의 L7 줄. 재는 것은 각 시나리오의 지금 뜻 그대로다
  - 제품 결정: `project-docs/products/AGENT-ROLE.md`의 L6, L7(36-37), O4(46), A1(55), A12(66). roadmap `project-docs/products/roadmap/eval.md`의 "책임에 따른 call: 작은 판단 case" 표(355-375: A12, O4, L6 `skill.read`로 `guide-roles-and-assignments`, L7, A1-ask)와 calendar-api 줄(301). 표의 `ticket.*`·`problem`·grant는 개편 전 계약이라 따르지 않는다
  - architecture: `project-docs/architecture/eval.md` "지키는 것"의 "버전은 hash로 고정한다"(85), "채점 순서"(87), "왜 이 모양인가"의 "case마다 right/wrong fixture를 둔다"(115)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`
  - 코드(줄은 HEAD `85f19080e` 기준. wave 1 merge 뒤 tr-eval-prune-checks가 L7과 `calendar/common.ts`를 이미 걷었다)
    - 고칠 곳: `tests/eval/checks/tools.ts` 5-26 `toolCount`. `tests/eval/scenarios/lophn/L6.scenario.ts`(1 주석, 15 n, 21 `guide.read`, 26-45 fixture). `tests/eval/scenarios/lophn/L7.scenario.ts`(전체). `tests/eval/scenarios/app-engineer/A1-ask.scenario.ts`(1-4 주석, 31 n, 37 `no-ticket-create`, 42 premise, 59-72 wrong fixture). `tests/eval/scenarios/app-engineer/A12.scenario.ts`(1 주석, 19 n, 26 `no-ticket-create`, 52-60 wrong fixture). `tests/eval/scenarios/operator/O4.scenario.ts`(2-4 주석, 21 n, 23 world). `tests/eval/scenarios/calendar/calendar-api.scenario.ts`(14 n, 16 world)
    - 쓰는 것: `tests/eval/checks/records.ts`(`effectiveToolCalls`, `toolCallsOf`. `CollectedToolCall`의 `input`·`output`), `tests/eval/checks/fixtures.ts`(`fixtureSession`의 `FxStep`은 `input`·`output`·`effect`를 받는다, `fixtureAppCreate`), `tests/eval/checks/mod.ts`(`callCount`, `toolsCalled`, `noWriteTools`, `toolCount`), `tests/eval/checks/validate.ts`(`validateFixtures`), `tests/eval/judge/mod.ts`(`joinInput`, `relayCompleteInput`, `asksGapInput`), `tests/eval/criteria/relay-complete.json`(criterion 꼴), `tests/eval/criteria/mod.ts`의 `loadCriterion`(verdicts에 `cannot_tell`, pass에 없음), `tests/eval/types.ts`(`callApi` step, `say`, `untilIdle`, `JudgeCheck.input`의 `core`), `tests/eval/runner/steps.ts`의 `callApi` step(앱 handler의 `failed`는 실패가 아니다), `tests/eval/scenarios/lophn/common.ts`(`LOPHN`, `AE_캘린더`), `tests/eval/scenarios/calendar/common.ts`의 `createCalendarOperator`(tr-eval-prune-checks가 할당으로 바꿨다), `tests/eval/versions/authored.ts` 19-33 `scenarioHash`(시나리오 file과 같은 폴더의 helper file 전부를 묶는다), `tests/eval/runner/register.ts`, `tests/eval/runner/cli.ts` 134-149
    - 제품: `packages/core/lophn-agent/tools/bundles/skill.ts` 12-13(`skill.read` 입력 `{ name, path? }`), `packages/core/agent-roles/skills/guide-roles-and-assignments/SKILL.md`, `packages/core/agent-roles/tool-lists.ts` 5-60(lophn과 App Engineer만 `app.status`·`app.logs`·`app.invocations`를 갖는다. `call`의 effect는 read다: `packages/core/lophn-agent/tools/bundles/call.ts` 41), `packages/core/agent-roles/roles/lophn/prompt.md` 44-50, 59(guide는 `skill.read`, 앱 상태는 `app.get`·`app.status`·`app.logs`·`app.invocations`를 읽고 읽지 않은 수는 "not confirmed", 원인 해석은 App Engineer 몫), `packages/core/agent-roles/roles/app-engineer/prompt.md` 31-37(사람이 정할 것만 묻는다, 짓기 전에 `DESIGN.md`), 98-102(앱 밖 재사용은 lophn에게 none call), `packages/core/agent-roles/roles/operator/prompt.md` 32-33, `packages/protocol/lophn-agent/messages.ts`(`messagesList` 입력 `{ session }`, `messageBody` 출력 `content.parts`), `packages/protocol/base/actor.ts` 20-25(agent 메시지의 actor는 `agent:<id>`), `packages/protocol/apps/runtime.ts` 192 `appLogs`, `packages/protocol/apps/calls/invocation.ts` 108 `appInvocations`
    - 재료: tr-eval-restore가 보고한 새 판(예상 `calendar-app@3`, `calendar-app-bug@3`), `tests/eval/materials/calendar-app-bug/<n>/files/bug.json`(`event.list {range: "next_week"}`이 handler 예외로 끝난다)
- 계약:
  - 쓰는 것: tr-eval-prune-checks의 `createCalendarOperator`(할당), tr-eval-restore의 재료 판, `packages/core/agent-roles/skills`(`guide-*`), App Engineer와 lophn tool `app.get`, `app.list`, `app.status`, `app.logs`, `app.invocations`
  - 내놓는 것: 없음

## 할 일

근거는 survey §2의 여섯 줄과 AGENT-ROLE의 그 줄이다. 시나리오마다 재는 뜻은 그대로 두고 지운 tool 이름과 world만 지금 것으로 바꾼다. 사람 말은 L7(앱 이름이 바뀐다) 말고는 고치지 않는다. 진짜 model provider는 부르지 않는다: `deno task eval`(`--env-file=.env`) 대신 `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts …`로 돈다(key가 없으면 registry 등록과 fixture 확인 뒤 0으로 끝난다). world 확인 전에 이 worktree에서 `deno task e2e:deps`를 한 번 돈다.

1. `tests/eval/checks/tools.ts`의 `toolCount` 옵션을 넓힌다. export 이름과 다른 builder는 그대로다(`checks/mod.ts`를 고치지 않는다).
   - `tool: string | string[]`: 배열이면 그 가운데 어느 tool이든 센다(A1-ask의 "짓지 않았다"를 check 하나로 둔다).
   - `input?: Record<string, unknown>`: 있으면 tool call 입력(`CollectedToolCall.input`)의 그 칸이 모두 같은 것만 센다(맨 위 칸만, `===` 비교. L6의 `skill.read {name}`).
   - `reason`에 이름(`a|b`)과 `input`(있으면 JSON)을 싣는다. 지금 부르는 곳(L1, L4-new 등)은 바뀌지 않는다.
2. L6(`lophn/L6.scenario.ts`): `toolCount("read-guide", { tool: "skill.read", input: { name: "guide-roles-and-assignments" }, count: { min: 1 } })`. `no-call`, `no-app-create`는 그대로. fixture: right는 그 `skill.read`(input 칸 포함), wrong에 다른 guide(`guide-settings`)를 읽은 것(`read-guide` 떨어짐)을 더하고 나머지 wrong은 `guide.read`를 `skill.read`로 바꾼다. 머리 주석을 AGENT-ROLE L6("사용 안내 skill(`guide-*`)로 답한다")에 맞춘다. n 3 → 4.
3. A1-ask(`app-engineer/A1-ask.scenario.ts`): `no-ticket-create`를 `toolCount("no-build", { tool: ["file.write", "file.edit", "release.prepare"], count: 0 })`로 바꾼다. judge `asks-gap`의 premise는 `["no-build", "asked"]`. wrong fixture의 `ticket.create`를 `file.write`(effect write)로 바꾸고 fails `["no-build", "asked"]`. 머리 주석(1-4)을 지금 A1(짓기 전에 `DESIGN.md`를 쓰고 직접 짓는다)과 App Engineer 지침(사람이 정할 것만 묻는다)으로 고친다: 너무 막연해 설계도 할 수 없으면 쓰기 전에 묻는다. n 2 → 3.
   - 정한 것: `shell.run`은 막지 않는다. 이유: 묻기 전에 `git log` 같은 읽기를 할 수 있고, survey §2가 짚은 것은 짓기(`release.prepare`)와 쓰기(`file.write`, `file.edit`)다.
4. A12(`app-engineer/A12.scenario.ts`): `no-ticket-create`를 지운다. `call-to-lophn`, `no-package-publish`, judge는 그대로. wrong fixture의 `ticket.create`를 `package.publish`(effect write)로 바꾸고 fails `["call-to-lophn", "no-package-publish"]`. 머리 주석은 그대로 맞다. n 2 → 3.
5. O4(`operator/O4.scenario.ts`): world를 tr-eval-restore의 `calendar-app-bug` 새 판으로, 주석(2-4)의 `calendar-app-bug@2`도 같이. check와 fixture는 그대로다. n 6 → 7(world와 `createCalendarOperator`가 바뀌었다. 이 시나리오의 hash는 `operator/` 폴더만 묶으므로 손으로 올린다).
6. calendar-api(`calendar/calendar-api.scenario.ts`): world를 `calendar-app` 새 판으로. check와 fixture는 그대로다. n 5 → 6.
   - 정한 것: calendar-api는 registry에 올리지 않는다(`tests/eval/registry/scenario/calendar-api.json`을 고치지 않는다). 이유: 이 시나리오의 hash는 `calendar/` 폴더의 helper(`common.ts`, `spec.ts`, `dates.ts`) 전부를 묶는데(`scenarioHash`), 같은 wave의 tr-eval-calendar-build와 그 뒤 tr-eval-calendar-maintain이 그 helper를 고친다. 지금 올리면 n 6의 hash가 뒤에서 바뀌어 다음 eval이 "n을 올려라"로 멈춘다. n 6은 registry에 없으니(지금 최대 3) 첫 진짜 run이 그때의 hash로 올린다. fixture 확인은 할 일 8의 script로 한다.
7. L7(`lophn/L7.scenario.ts`)을 다시 쓴다(survey §2 L7, §4 L7, AGENT-ROLE L7). 뜻: 앱이 잘 도는지 물으면 lophn은 앱, 상태, log, 실패한 호출을 읽고, 확인한 사실과 해석을 나눠 답한다. 쓰지 않고 넘기지 않는다(`/repair-app`으로 부른 것이 아니다).
   1. world `["calendar-app-bug@<restore의 새 판>"]`, real `[LOPHN]`, setup 없음. 사람 말 `"캘린더 앱 잘 돌아?"`. steps `[callApi("캘린더", "event.list", { range: "next_week" }), say(LOPHN, REQUEST), untilIdle()]`(`callApi` step은 `tests/eval/types.ts`의 것. 사람이 앱 화면에서 부른 것처럼 handler 예외를 터뜨려 앱 log의 줄과 실패한 invocation을 남긴다. agent 기록이 아니라 collect에 섞이지 않는다).
   2. checks
      - `toolsCalled("read-all", [["app.get", "app.list"], "app.status", "app.logs", "app.invocations"])`
      - `noWriteTools("no-write")`
      - `callCount("no-call", { count: 0 })`(`call`의 effect가 read라 `no-write`가 잡지 못한다)
      - judge `{ kind: "judge", id: "facts-separated", premise: ["read-all", "no-write", "no-call"], criterion: "facts-separated@1", input }`
   3. judge 입력(이 file 안 함수. 다른 lophn 시나리오의 hash를 건드리지 않으려고 `lophn/common.ts`에 두지 않는다): `joinInput`으로 세 절.
      - `[HUMAN_REQUEST]`: 사람 말.
      - `[READ]`: `toolCallsOf(trial)` 가운데 `app.get`·`app.list`·`app.status`·`app.logs`·`app.invocations`마다 `<tool> <input JSON>` 한 줄과 `output` JSON. 합쳐 12,000자에서 자르고 `[truncated]`를 붙인다(`checks/app/judge-input.ts`의 `clip`과 같은 상한). 없으면 `(nothing read)`.
      - `[ANSWER]`: lophn의 마지막 답. `core`가 있으면 lophn session(`trial.sessions`에서 `agent.role === "lophn"`)의 `messagesList { session }`에서 actor가 `agent:`로 시작하는 마지막 메시지를 `messageBody`로 읽어 `content.parts`의 text를 잇는다. 못 읽으면 `(no answer)`. fixture(`core === null`)면 `(fixture)`(빈 글이면 fixture 확인이 떨어진다).
   4. criterion `tests/eval/criteria/facts-separated.json`(새 file. 꼴은 `relay-complete.json`):
      - `name: "facts-separated"`, `n: 1`, `verdicts: ["separated", "mixed", "cannot_tell"]`, `pass: ["separated"]`
      - `question`(영어 한 문단): 입력은 세 절이다. `[HUMAN_REQUEST]`는 사람이 앱에 대해 물은 것, `[READ]`는 agent가 답하기 전에 읽은 것(tool, 입력, 결과), `[ANSWER]`는 agent의 답이다. 답이 확인한 것과 짐작한 것을 나누는지 판정한다: 앱에 대한 사실(상태, 오류, 실패한 호출, 수, 시각)로 말한 것은 모두 `[READ]`가 뒷받침해야 하고, `[READ]`에 없는 원인·짐작·수는 짐작이나 확인하지 않은 것으로 밝혀야 한다. separated = 사실로 말한 것이 모두 `[READ]`에 있고 나머지는 짐작이나 미확인으로 밝혔다, mixed = `[READ]`가 뒷받침하지 않는 것을 하나라도 사실로 말했다, cannot_tell = 입력으로 정할 수 없다. 인용은 판정을 정한 `[ANSWER]`의 부분이다.
      - 정한 것: criterion 이름 `facts-separated`. `tests/eval/criteria/mod.ts`의 `INPUT_SECTIONS`는 아무도 읽지 않아 고치지 않는다(이 task의 file이 아니다).
   5. fixtures
      - right: lophn session에 `app.get`, `app.status`, `app.logs`, `app.invocations`(모두 effect read). 둘째 right는 `app.get` 대신 `app.list`.
      - wrong: `app.invocations`가 없다 → `["read-all"]`. 넷에 `fixtureAppCreate(...)`를 더한다 → `["no-write"]`. 넷에 `{ call: { to: AE_캘린더, reply: "none" } }`를 더한다 → `["no-call"]`.
   6. 머리 주석은 AGENT-ROLE L7. n 4 → 5. 옛 `problem.list`·`ticket.list`·`apps-home@1` 쓰임이 남지 않는다.
8. 확인(진짜 model 없음. script는 scratch에 두고 commit하지 않는다).
   1. `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts --scenario L6 --scenario L7 --scenario A1-ask --scenario A12 --scenario O4`가(`--scenario`는 시나리오마다 따로 준다) `ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다…`로 0으로 끝난다. 다섯 시나리오의 새 n과 `criterion:facts-separated@1`이 registry에 오르고 fixture 확인이 지난다. calendar-api는 여기에 넣지 않는다(6).
   2. calendar-api의 fixture: `discoverScenarios()`(`tests/eval/runner/discover.ts`)에서 calendar-api를 찾아 `validateFixtures([scenario])`(`tests/eval/checks/mod.ts`)가 `ok: true`.
   3. world: `resolveVariant({ current: REPO_ROOT })`와 `prepareTrialWorld({ variant }, scenario, held)`(`tests/eval/runner/world.ts`, `finally`에서 `releaseWorld(held)`)로 L7, O4, calendar-api의 world와 setup을 되살린다. L7은 되살린 뒤 `callApi`(`tests/eval/checks/app/mod.ts`)로 `event.list {range: "next_week"}`를 불러 outcome이 `failed`이고, 그 뒤 `appLogs {app}`에 그 오류 줄이, `appInvocations {app, status: "failed"}`에 그 호출이 있는지 찍는다(L7이 기대는 전제다). O4와 calendar-api는 Operator가 만들어지고 `agentAssignmentGet`에 캘린더 줄이 있는지 찍는다.
   4. `git status`로 바뀐 path가 소유 안인지 본다. 재료나 다른 시나리오의 registry가 바뀌었으면 되돌리고 보고한다.

## 끝남

- `deno task check`가 통과한다(이 task의 file은 아직 `NOT_CHECKED`라 아래로 따로 본다).
- `deno check tests/eval/checks/mod.ts tests/eval/scenarios/lophn/L6.scenario.ts tests/eval/scenarios/lophn/L7.scenario.ts tests/eval/scenarios/app-engineer/A1-ask.scenario.ts tests/eval/scenarios/app-engineer/A12.scenario.ts tests/eval/scenarios/operator/O4.scenario.ts tests/eval/scenarios/calendar/calendar-api.scenario.ts`가 통과한다.
- `deno test --no-check tests/eval/checks`가 통과한다.
- `deno fmt --check`와 `deno lint`가 바꾼 `.ts` file에서 통과한다.
- 할 일 8의 1, 2가 통과하고 3의 world 셋이 되살아나며 L7 전제(실패한 `event.list`, 앱 log 줄, 실패한 invocation)가 찍힌다.
- 위험 test: 없음. check builder의 판정은 시나리오마다 right/wrong fixture가 provider 전에 본다(`validateFixtures`, `architecture/eval.md` "case마다 right/wrong fixture를 둔다").
- 남지 않음: `grep -n "guide.read\|ticket\.\|problem\.\|openProblem\|openTicket" tests/eval/scenarios/lophn/L6.scenario.ts tests/eval/scenarios/lophn/L7.scenario.ts tests/eval/scenarios/app-engineer/A1-ask.scenario.ts tests/eval/scenarios/app-engineer/A12.scenario.ts`가 0줄이다. `grep -n "apps-home\|가계부" tests/eval/scenarios/lophn/L7.scenario.ts`가 0줄이다. `grep -rn "calendar-app-bug@2\|calendar-app@2" tests/eval/scenarios/operator/O4.scenario.ts tests/eval/scenarios/calendar/calendar-api.scenario.ts tests/eval/scenarios/lophn/L7.scenario.ts`가 0줄이다(restore가 새 판을 만들지 않았으면 이 줄은 뺀다).

## 보고

- 바꾼 file
- 통과한 check(위 명령과 결과, 할 일 8의 3에서 찍은 L7 전제)
- 시나리오 n: 시나리오마다 옛 n → 새 n과 world
- 등록할 것: calendar-api@6은 registry에 올리지 않았다. `calendar/` helper를 마지막으로 고치는 task(tr-eval-calendar-maintain)나 lead가 그 뒤에 올리거나 첫 진짜 run이 올린다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(`toolCount`의 `tool` 배열과 `input`, A1-ask가 `shell.run`을 막지 않은 것, L7의 bug 터뜨리기를 step으로 둔 것, criterion 글)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 문서: lead가 끝에 고칠 줄. roadmap `project-docs/products/roadmap/eval.md` 표의 L6, L7, A1-ask, A12, O4 줄, `project-docs/architecture/eval.md` "자리" 표의 시나리오 수(T19 둘이 빠졌다)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## lead가 더함

- tr-eval-restore가 merge됐다. 새 판은 다섯 모두 `@3`이다: `notify-app@3`, `date-range@3`(needs `notify-app@3`), `calendar-app@3`, `calendar-app-bug@3`(parent `calendar-app@3`), `calendar-data@3`. 옛 판은 남아 있다. world는 `@3`을 쓴다. 세 world는 가짜 model로 되살아나고 앱의 `deno task check`가 지나는 것을 그 task가 봤다(bug world의 `deno task test`는 일부러 떨어진다).
- tr-eval-human도 merge되어 eval이 import된다. 확인은 늘 `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts …`다. L4-new는 lead가 n 7로 등록했다.
