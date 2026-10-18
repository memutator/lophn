# ec-checks

끝난 world를 보는 check와 새 criterion 셋을 만든다. 앱이 켜졌나, 정해 둔 app-api 호출이 기대대로 답하나, 재사용(package, 알림 앱 app-api), observation(정해 둔 실패를 일으켜 problem이 열리나), 진단(problem을 읽고 ticket에 붙이고 고친 뒤 다시 안 나나)을 `CheckInput.core`로 확인한다. 이 check들은 살아 있는 core가 있어야 하므로 fixture 확인(`core === null`)에서는 돌지 않고 통과로 건너뛴다. 기록(`TrialRecord`)만 보는 check, judge 입력 builder, 앱 app-api tool call을 만드는 fixture helper도 함께 둔다. 시나리오(`ec-scenarios`)가 이 builder를 조합한다.

- 단위: ec-checks (wave 2)
- 선행: ec-contract
- 소유(이 task만 고친다):
  - `tests/eval/checks/app/**`
  - `tests/eval/criteria/card-covered.json`
  - `tests/eval/criteria/asked-again.json`
  - `tests/eval/criteria/root-cause.json`
  - `tests/eval/criteria/mod.ts`(이 criterion 셋의 `INPUT_SECTIONS` 항목만 더한다. 나머지는 ev-judge가 만든 그대로)
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "check와 judge"(표의 calendar-diagnose 줄), "재사용 확인", "observation 확인", "진단 확인", "요구 카드", "캘린더 단위"
  - 계획: `project-docs/plan/eval-coding/README.md`의 "정한 것"(재사용·observation은 calendar-mvp의 check, 새 criterion 셋)
  - eval-base brief(이 task가 얹히는 바탕): `project-docs/plan/eval-base/tasks/ev-contract.md`(`CheckInput`, `ProgramCheck`, `JudgeCheck`, `SessionRecord`, `SentCall`), `ev-checks.md`(`sentCalls`, `toolCallsOf`, `fixtureSession`, `fixtureTrial`, `runProgramChecks`, `validateFixtures`), `ev-judge.md`(`Criterion` 꼴, `joinInput`, `asksGapInput`, `loadCriterion`), `ev-runner.md`(check가 도는 때: 끝난 뒤 core가 아직 살아 있다)
  - 같은 계획: `ec-human.md`(`HumanSpec`), `ec-runner.md`(check 뒤에 save, driver는 check 전에 멈춘다)
  - architecture: `project-docs/architecture/app-call.md`(app-api 호출 길), `project-docs/architecture/activation.md`(release와 active), `project-docs/architecture/coding-agent.md`
  - AGENT 지침(check가 기대는 행동의 출처): `packages/core/agent-roles/roles/app-engineer/prompt.md`(실패 분기 이름, `examples`, `problem.get`), `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`(순서 6: ticket이 적은 실패 분기마다 `reportProblem`), `packages/sdk/cap-problem/guide.md`(같은 이름은 한 problem으로 묶인다)
  - protocol(import해서 쓴다. 모두 `Core.call`로 사람 자격으로 부른다):
    - `packages/protocol/apps/mod.ts`: `appList`, `appGet`(`active_release`, `source_path`, `revision`), `appRuntime`, `appCallApi`, `appDisableExecution`, `appEnableExecution`(둘 다 `compare: { base_revision }`가 필요하다), `packagesVersions`, `packagesUsage`, `releasesListRecords`, `releasesGetRecord`(`ReleaseRecord`: `number`, `status`, `code_commit`, `activated_at`)
    - `packages/protocol/apps/blueprint/read.ts`: `appAppApi`(입력 `{ app, release? }`. 출력 `app_api[]`, `declarations.app_connections[]`)
    - `packages/protocol/problems/mod.ts`: `problemList`(`occurrence_count`, `state`, `name`), `problemGet`(`problem.group_key`, `problem.recurred`, `occurrence_count`)
    - `packages/protocol/coding-agent/ticket/mod.ts`: `ticketList`, `ticketShow`(`goal`, `check`, `evidence[]`, `state`)
    - `packages/protocol/config/mod.ts`: `settingsUpdate`(`reactions.problem_opened`를 `off`로)
  - 본보기: `tests/e2e/reaction_test.ts`(`appCallApi` 사람 호출, `reportViewError`, `settingsUpdate`로 reaction 끄기), `tests/support/app/patch-report.ts`(앱이 `reportProblem`으로 문제를 여는 patch), `tests/support/app/patch-reaction.ts`(처리 안 된 예외), `tests/support/core/human.ts`의 `until`, `packages/core/problems/tests/harness/examples.ts`의 `exampleMatches`(ticket `examples`의 비교 규칙. import하지 말고 규칙만 같게 베낀다)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`: `Check`, `ProgramCheck`, `JudgeCheck`, `CheckInput`, `CheckOutcome`, `TrialRecord`, `SessionRecord`, `SentCall`, `Participant`, `CodingParticipant`, `codingAgent`, `isCodingAgent`(ec-contract가 더한다. coding agent 참가자는 `Participant`와 따로인 `CodingParticipant`다).
    - ev-checks `tests/eval/checks/mod.ts`: `sentCalls(trial, where?)`, `toolCallsOf(trial, tool?)`, `fixtureSession(agent, steps)`, `FxStep`, `FixtureCall`. 이 task는 ev-checks의 file을 고치지 않는다.
    - ev-judge `tests/eval/judge/mod.ts`: `joinInput(sections)`, `asksGapInput(humanText, questions)`. 새 criterion 셋은 `Criterion` 꼴(`{ name, n, question, verdicts, pass }`)로 `tests/eval/criteria/<name>.json`에 두고 `loadCriterion`이 읽는다.
    - **ec-contract가 정한 계약(landed된 `types.ts`를 따른다)**: `JudgeCheck.input`은 `string | Promise<string>`이다(끝난 world에서 입력을 만들려면 route를 불러야 한다. ev-checks의 `validateFixtures`는 await하고 ev-runner도 await한다). `runProgramChecks`는 program check를 배열 순서대로 하나씩 await한다(observation check가 앱과 알림 앱을 일부러 망가뜨리므로 순서가 결과를 정한다. 아니면 ec-contract가 고친다). coding agent는 `CodingParticipant`로 가리키고 cast는 쓰지 않는다.
  - 내놓는 것(`tests/eval/checks/app/mod.ts`가 모두 내보낸다. `ec-scenarios`가 기댄다):
    - live 공통: `liveCheck(id, run: (core: Core, trial: TrialRecord) => Promise<CheckOutcome>): ProgramCheck`, `findApp(core, name): Promise<App>`(`appList`에서 `name`이 같고 `archived`가 아닌 앱 하나. 없거나 둘이면 던진다), `callApi(core, app, api, input?)`(사람 자격으로 `appCallApi`. `target: { mode: "live", app, release: null }`, `caller: { kind: "person", view_session: "eval" }`), `exampleMatches(expect, actual)`, `oneLine(text, max = 300)`
    - 앱 상태: `appActive(id, { app })`, `releaseAdvanced(id, { app, after })`
    - app-api 답: `apiAnswers(id, { app, steps })`, `type ApiStep = { api: string; input?: unknown | ((prev: unknown[]) => unknown); expect: unknown | ((result: unknown) => string | null) }`
    - 재사용(5개 check를 배열로): `reuseChecks(spec: ReuseSpec): ProgramCheck[]`. id는 `reuse-sdk-dependency`, `reuse-app-connection`, `reuse-imports`, `reuse-no-recreate`, `reuse-usage`.
      - `ReuseSpec = { app: string; notify: { app: string; api: string }; pkg: { name: string; exports: string[] } }`(`app`, `notify.app`은 app.name)
    - observation(4개 check를 배열로): `observationChecks(spec: ObserveSpec): ProgramCheck[]`. id는 `observe-bad-input`, `observe-notify-down`, `observe-store`, `observe-names-in-ticket`. 배열 순서가 곧 실행 순서다(store 실패는 마지막에 일으킨다).
      - `ObserveSpec = { app: string; notify: string; badInput: Probe; notifyDown: Probe; store: Probe }`, `Probe = { api: string; input?: unknown }`. 캘린더 앱의 problem 이름은 `event_input_invalid`(잘못된 시각), `notify_call_failed`(알림 앱 호출 실패), `store_unavailable`(저장소 실패)다. 이 task의 check는 이름을 단정하지 않는다(진짜 coding agent가 만든 앱은 다른 이름을 쓸 수 있다). 새 problem이 열리고 이름이 서로 다른지만 본다
    - 진단(6개 check를 배열로): `diagnosisChecks(spec: DiagnoseSpec): ProgramCheck[]`. id는 `read-problem`, `evidence-has-problem`, `ticket-points-at-bug`, `fixed-release-active`, `no-recurrence`, `blueprint-kept`.
      - `DiagnoseSpec = { app: string; bug: BugSpec }`, `BugSpec = { api: string; input?: unknown; expectAfterFix: unknown; files: string[]; description: string }`. 시나리오는 `calendar-app-bug@1`의 `files/bug.json`(`{ api, input, expect_after_fix, files, description }`)을 이 꼴로 옮긴다
    - 기록만 보는 check(core 없이 fixture에서도 돈다): `aeCallsOnlyToCodingAgent(id)`, `appApiCalled(id, { command, count? })`, `appApiOrder(id, { first, then })`, `readProblem(id)`(= `read-problem`)
    - judge 입력: `cardCoveredInput(card: string, app: string)`, `askedAgainInput(app: string)`, `rootCauseInput(bug: BugSpec, app: string)`. 모두 `(input: CheckInput) => string | Promise<string>`를 돌려준다. 시나리오는 `JudgeCheck.input`에 그대로 넣는다.
    - fixture: `appApiSession(agent: Participant, steps: FxStep[]): SessionRecord`(이름이 `app__fx__<command>`인 step을 app-api tool call로 만든다. 아래 할 일 10)
  - 새 criterion(내용은 할 일 1): `card-covered@1`, `asked-again@1`, `root-cause@1`.

## 할 일

1. criterion data 셋 `tests/eval/criteria/<name>.json`. 꼴은 `{ "name", "n", "question", "verdicts", "pass" }`, `n`은 1, `question`은 영어(judge가 읽는다), `JSON.stringify(value, null, 2) + "\n"`로 쓴다. `verdicts`에 `cannot_tell`을 넣고 `pass`에는 넣지 않는다. 입력의 칸 이름과 각 verdict의 뜻을 `question`에 쓴다(근거: roadmap "check와 judge" 표, README "새 criterion").
   - `card-covered`: 칸 `[CARD]`(요구 카드: 원하는 것, 정해 둔 답), `[BLUEPRINT]`(만든 앱이 선언한 app-api의 key, effect, description, input과 연결한 앱), `[TICKETS]`(App Engineer가 쓴 ticket마다 goal과 acceptance check). 카드의 구체 요구(원하는 것 하나하나와 정해 둔 답)가 blueprint의 app-api나 입력 칸, ticket의 goal이나 acceptance check의 예시에 실렸는지 본다. 표현이 달라도 된다. 카드가 "추천대로"에 맡긴 것은 실리지 않아도 된다. `all`(모두 실렸다) · `some_missing`(하나 이상 빠졌거나 반대로 실렸다) · `cannot_tell`. `pass`: `["all"]`.
   - `asked-again`: 칸 `[HUMAN_REQUEST]`(App Engineer가 받은 요청 글), `[QUESTIONS]`(App Engineer가 사람에게 한 질문). 요청에 이미 있는 것을 다시 묻는 질문이 있나. 질문이 없으면 `no_repeat`이다. `no_repeat` · `repeated` · `cannot_tell`. `pass`: `["no_repeat"]`. (칸 이름은 ev-judge의 `asksGapInput`이 만드는 `HUMAN_REQUEST`, `QUESTIONS`와 같다.)
   - `root-cause`: 칸 `[BUG]`(심은 bug의 증상과 진짜 원인, 원인이 있는 file), `[TICKET_GOALS]`(그 problem을 근거로 붙인 ticket의 goal), `[EVIDENCE_FILES]`(그 ticket의 근거로 붙은 file 경로). goal이 원인을 짚나. `root_cause`(원인을 짚고 고칠 곳을 가리킨다) · `symptom_only`(증상만 적었다) · `wrong`(다른 원인이나 엉뚱한 곳) · `cannot_tell`. `pass`: `["root_cause"]`.
   - `tests/eval/criteria/mod.ts`의 `INPUT_SECTIONS`에 위 세 criterion의 칸 이름 배열을 더한다(칸 이름은 위 그대로).  `loadCriterion`이 file을 읽는 것은 이미 ev-judge가 만들었으므로 항목만 더하고 다른 줄은 고치지 않는다.
2. `tests/eval/checks/app/live.ts`: 살아 있는 core를 쓰는 check의 바탕.
   - `liveCheck(id, run)`: `ProgramCheck`를 만든다. `input.core`가 `null`이면 `{ pass: true, reason: "live check: fixture에서는 건너뜀" }`을 돌려주고 `run`을 부르지 않는다. 이유: fixture에는 world가 없다. `validateFixtures`의 `fails`에는 live check id를 쓰지 않는다. 이 check들의 판정 논리는 순수 함수로 갈라 test한다(할 일 11).
   - `findApp(core, name)`, `callApi(core, app, api, input?)`, `oneLine`. `callApi`는 route 오류(`invalid_input`, `not_found`, `unavailable`)를 던지고, 앱이 `failed`·`denied`·`unknown`으로 답한 것은 `{ status, result?, ... }` 그대로 돌려준다(던지지 않는다).
   - `waitProblems(core, app, until)`: `problemList({ app })`를 `until`(`tests/support/core/human.ts`, 20초)로 읽는다. 문제 접수는 collector worker를 거쳐 늦게 보인다.
3. `tests/eval/checks/app/match.ts`: `exampleMatches(expect, actual)`는 `packages/core/problems/tests/harness/examples.ts`의 규칙과 같다(객체는 expect의 key가 모두 있고 값이 맞아야 하며 actual의 나머지 key는 무시, 배열은 길이가 같고 원소가 차례로 맞아야 한다, 나머지는 `===`). 이유: App Engineer가 쓴 `examples`와 이 check가 같은 규칙이어야 사람이 보는 결과와 어긋나지 않는다. core를 import하지 않는다(variant로 바뀌어도 grader가 안 바뀌어야 한다. ev-restore가 hash를 따로 쓴 것과 같은 이유).
   - `apiAnswers(id, { app, steps })`(live): 단계를 차례로 `callApi`한다. `outcome.status`가 `succeeded`여야 하고 `expect`가 값이면 `exampleMatches(expect, result)`, 함수이면 `null`을 돌려줘야 통과다(함수는 정렬이 정해지지 않은 배열 같은 것을 볼 때 쓴다). `input`이 함수이면 앞 단계들의 `result` 배열을 받는다(예: add가 돌려준 id를 remove에 쓴다). 첫 불일치에서 멈추고 reason에 `step <i> <api>: <이유>`와 실제 결과 앞 200자를 적는다.
4. `tests/eval/checks/app/active.ts` (live):
   - `appActive(id, { app })`: `findApp` → `appGet`의 `active_release`가 null이 아니고, `releasesGetRecord`의 `status`가 `active`, `appRuntime`이 `running`이며 `observation.ready`와 `accepting`이 참이다. 켜진 직후일 수 있어 `until`(60초)로 기다린다.
   - `releaseAdvanced(id, { app, after })`: `releasesListRecords({ app })`에서 `status: "active"`인 release의 `number`가 `after`보다 크고, `number <= after`인 release에 `active`가 없다(옛 것은 `superseded`). calendar-maintain의 "새 release가 active다".
5. `tests/eval/checks/app/reuse.ts`: `reuseChecks(spec)` (live + `git`).
   - 먼저 `findApp`으로 앱을 찾고 `appGet`의 `source_path`, `active_release`의 `code_commit`(`releasesGetRecord`)을 잡는다. source는 working tree가 아니라 그 commit이다: `git -C <source_path> ...`는 모두 `<code_commit>`을 인자로 준다. 이유: 켜진 release의 code만 재사용으로 센다.
   - `reuse-sdk-dependency`: `git show <commit>:blueprint.ts`의 `sdk_dependencies` 블록에서 `name: "..."`들을 뽑아(`blueprintSdkNames(text)`, 순수) 그 안에 `pkg.name`이 있고, template 기본 7개(`TEMPLATE_SDK_NAMES`: `@lophn/blueprint`, `@lophn/cap-problem`, `@lophn/cap-app-api`, `@lophn/cap-store`, `@lophn/ui`, `@lophn/app-ui`, `@lophn/wording`. `packages/core/apps/packages/template/app/blueprint.ts.tmpl`와 같아야 한다)를 뺀 것이 `pkg.name`을 포함한다. reason에 7개 밖의 이름들을 적는다.
   - `reuse-app-connection`: `appAppApi({ app })`(active release)의 `declarations.app_connections`에 `{ app: <notify 앱 id>, app_api에 notify.api }`가 있다. notify 앱 id는 `findApp(core, spec.notify.app)`.
   - `reuse-imports`: 둘 다 참이어야 한다(의존만 걸고 안 쓰면 떨어진다).
     - 패키지: `git grep -n -I -F -e <pkg.name> <commit> -- . ':(exclude)blueprint.ts' ':(exclude)deno.json' ':(exclude)deno.lock' ':(exclude)tests'`의 줄 가운데 `import`·`from`·`import(` 꼴(`importsPackage(line, name)`, 순수)이고 `_test.ts`가 아닌 것이 하나 이상.
     - app-api: `connectAppApi`가 든 file 집합(`git grep -l -F`)과 `notify.api` 글자가 든 file 집합(`git grep -l -F`)의 교집합에 `_test.ts`가 아닌 file이 하나 이상.
   - `reuse-no-recreate`: `pkg.exports`의 이름마다 `git grep -n -I -F -e <name> <commit> -- src`의 줄 가운데 정의 꼴(`definesName(line, name)`, 순수: `(export )?(async )?(function\*?|const|let|var|class|type|interface|enum) <name>`)이 없다. 있으면 reason에 `<file>:<줄> <name>`을 적는다. 패키지를 import하는 줄은 정의 꼴이 아니라 걸리지 않는다.
   - `reuse-usage`: `packagesVersions({ name })`의 마지막 version으로 `packagesUsage({ name, version })`를 부르고, `usages`에 `{ app: <앱 id>, release: <active_release> }`가 있다.
   - 이유(순서): 재사용으로 세는 것은 template 7개 위의 것뿐이다(roadmap "재사용 확인"). 선언(blueprint)·연결 선언·실제 import·새로 만들지 않음·core가 release에 고정한 사용처(`packages.usage`)를 따로 보면 어느 단계에서 새는지 scorecard에 보인다.
6. `tests/eval/checks/app/observe.ts`: `observationChecks(spec)` (live). 배열 순서가 실행 순서다.
   - 공통 순서(한 실패마다 `observeFailure(core, app, probe, around)`): ① `settingsUpdate`로 `reactions.problem_opened`를 `off`로 둔다(안 그러면 새 problem마다 진짜 App Engineer session이 열린다. `tests/e2e/reaction_test.ts`의 `setMode`). ② `before = problemList({ app })`. ③ `around`가 준비하고(아래) `callApi(core, app, probe.api, probe.input)`를 부른 뒤 `finally`로 되돌린다. ④ `waitProblems`로 `before`와 달라질 때까지(새 id나 `occurrence_count` 증가) 최대 20초 읽고, 달라졌으면 1.5초 뒤 한 번 더 읽는다. ⑤ `decideFailure(before, after, outcome)`(순수)로 판정한다.
   - `decideFailure`: `after`에 `before`에 없던 id가 있으면 통과(reason: 새 problem `<name>`). 아니고 `occurrence_count`만 늘었으면 떨어짐(reason: `이미 있는 problem "<name>"에 묶임: 원인이 달라도 이름이 같다`). 아무것도 안 달라졌으면 떨어짐(reason: `problem이 열리지 않음: 조용히 넘어감 (호출 결과 <status>)`). 한 실패가 새 problem을 하나 열어야 하는 이유: 앞서 실패가 연 problem이 `before`에 들어 있으므로, 다른 원인이 같은 이름으로 보고되면 묶이고 새 id가 안 생긴다. 이것이 "원인이 다르면 이름도 다른가"를 한 번에 본다.
   - `observe-bad-input`: `around` 없음. `spec.badInput`은 blueprint 입력 schema를 통과하지만 업무 규칙이 거절하는 입력이어야 한다(schema 위반은 handler에 가지 못해 problem이 안 열리는 게 맞다). 캘린더에서는 정수 칸이 모두 범위 안인 없는 날짜(`start: { year: 2099, month: 2, day: 30, hour: 9, minute: 0 }`)다. 호출 결과가 `failed`든 아니든 problem만 본다.
   - `observe-notify-down`: `around`는 `findApp(core, spec.notify)`의 `appDisableExecution`(`compare: { base_revision: (await appGet).app.revision }`)으로 알림 앱을 멈추고 호출 뒤 `appEnableExecution`으로 되돌린다. `spec.notifyDown`은 알림 앱을 부르는 정상 입력이다.
   - `observe-store`: `around`는 `<core.run.home>/apps/<app id>/data/app.sqlite`를 `node:sqlite`의 `DatabaseSync`로 열어(`busy_timeout` 5초) `sqlite_master`의 사용자 표(`name`이 `sqlite_`로 시작하지 않는 `type = 'table'`)를 모두 `<이름>__eval_gone`으로 rename한다. 되돌리지 않는다(trial이 끝나면 root가 지워지고, 순서상 마지막이다). 이유: 앱의 store 연결이 열려 있는 채 질의가 실패하는 가장 단순한 길이다(`schema()`는 `user_version`을 보므로 migration이 표를 다시 만들지 않는다). 제품 route에는 store 실패를 일으키는 길이 없다.
   - `observe-names-in-ticket`: `problemList({ app })` 전체에서 `problemGet`의 `problem.group_key.kind === "named"`인 것의 이름이 모두, 그 앱의 모든 ticket(`ticketList` → `ticketShow`)의 `goal`과 `check`(JSON) 글에 글자 그대로 들어 있다(`namesMissing(names, ticketText)`, 순수). named problem이 하나도 없으면 떨어진다(reason: `이름으로 보고된 problem이 없음`). 이유: App Engineer 지침은 ticket에 실패 분기와 이름을 쓰라 하고(`app-engineer/prompt.md`), 잡히지 않은 예외는 runtime이 저절로 보고해 이름이 ticket에 없는 것이 정상이라 named만 본다. 캘린더의 기준 앱은 저장소 실패도 `store_unavailable`로 이름을 달아 보고하므로(`ec-calendar.md` 4번) 세 실패 모두 named다. 반대 방향(ticket에 쓴 이름이 보고되지 않음)은 글에서 이름을 가려낼 수 없어 보지 않는다.
7. `tests/eval/checks/app/diagnose.ts`: `diagnosisChecks(spec)`. (roadmap "진단 확인")
   - `read-problem`(기록): AE의 `problem.get` 또는 `problem.body` tool call이 `outcome.kind === "success"`로 하나 이상(`toolCallsOf`). core 없이 fixture에서 돈다.
   - `evidence-has-problem`(live): 앱의 problem id들(`problemList({ app })`)을 구하고, 앱의 ticket 가운데 `evidence`에 `{ kind: "problem", id }`가 그 id 중 하나인 것이 하나 이상.
   - `ticket-points-at-bug`(live): 위 ticket의 `goal`에 `bug.api` 글자가 있거나 `evidence`의 `file` 경로가 `bug.files` 중 하나로 끝난다. (원인을 짚었나의 뜻은 judge `root-cause@1`이 본다. 이 check는 가리키는 곳이 맞는지만 본다.)
   - `fixed-release-active`(live): `releasesListRecords`에서 active release의 `number`가 2 이상이고 가장 낮은 번호의 release는 `superseded`, `appRuntime`이 running·ready.
   - `no-recurrence`(live): ① `problemList({ app })`와 각 problem의 `problemGet`으로 `occurrence_count`, `recurred`, `state`를 잡는다. ② `callApi(bug.api, bug.input)`를 부르고 `succeeded`이며 `exampleMatches(bug.expectAfterFix, result)`인지 본다. ③ 3초 기다린 뒤 다시 읽어 `decideNoRecurrence(before, after)`(순수)로 판정한다: 새 problem id가 없고, 모든 problem의 `occurrence_count`가 그대로이며, `recurred`가 null이다(`ProblemReopened`가 있었다면 `recurred`가 차 있다. `packages/protocol/problems/problem-record.ts`). reason에 늘어난 problem 이름을 적는다.
   - `blueprint-kept`(live): 가장 낮은 번호 release(`releasesListRecords`의 첫 것)와 active release 각각 `appAppApi({ app, release })`로 읽는다. active 쪽에 옛 쪽의 app-api key가 모두 있고, `bug.api`의 `effect`와 `input`(canonical JSON)이 같다. 이유: "blueprint를 고쳐 문제를 덮지 않았다". 옛 release의 blueprint를 못 읽으면 떨어진다(reason에 이유). 첫 진짜 실행에서 옛 release를 읽을 수 있는지 확인한다.
8. `tests/eval/checks/app/calls.ts` (기록만 본다. core 없이 돈다):
   - `aeCallsOnlyToCodingAgent(id)`: `agent.role === "app_engineer"`인 session의 `sent_calls`가 하나 이상이고, 모두 `to`가 이름 꼴이며 `to.role === "coding_agent"`, `reply === "conversation"`이다. 다른 role로 간 call이 있으면 떨어진다. 이유: roadmap "calendar-mvp 안에서 생기는 call도 판단 case와 같은 눈으로 본다". lophn이 App Engineer에게 보내는 첫 call(fake 대본)은 lophn session의 것이라 세지 않는다. `receiver`는 coding agent이면 풀리지 않을 수 있어 `to`를 본다.
   - `appApiCalled(id, { command, count? })`: `tool_calls`의 `call.app_api?.command === command`이고 `outcome.kind === "success"`인 수가 `count`(기본 1 이상. 수 또는 `{ min, max }`)를 만족한다(Operator가 app-api tool을 불렀나. 칸은 `ToolCall.app_api`, `packages/protocol/lophn-agent/tool-values.ts`).
   - `appApiOrder(id, { first, then })`: `first` command가 success인 call 뒤(tool call id 순)에 `then`이 success인 call이 있다.
9. `tests/eval/checks/app/judge-input.ts`: judge 입력을 만든다. 모두 `core === null`(fixture)에서도 빈 글이 아닌 글을 돌려준다.
   - `cardCoveredInput(card, app)`: `joinInput`으로 `CARD`, `BLUEPRINT`, `TICKETS`. live(`core`가 있음)이면 `BLUEPRINT`는 `appAppApi({ app })`에서 app-api마다 `- <key> (<effect>): <description> input=<canonical JSON>`과 `app_connections` 줄, `TICKETS`는 `ticketList` → `ticketShow`마다 `TICKET <n> [<state>]`, `goal: ...`, `check: <JSON>`. 각 칸은 12000자에서 자른다(자르면 끝에 `[truncated]`). fixture이면 `BLUEPRINT`는 `(not available)`, `TICKETS`는 기록의 `ticket.create` tool call 입력(`goal`, `check`)에서 만든다.
   - `askedAgainInput(app)`: 요청 글은 App Engineer가 받은 첫 call의 본문(`sentCalls(trial)`에서 받는 쪽 이름이 `app`의 App Engineer인 첫 것의 `body`. 없으면 `(no request)`), 질문은 `toolCallsOf(trial, "ask")`의 `input.questions`를 이은 목록. `asksGapInput(request, questions)`를 그대로 쓴다(칸 이름 `HUMAN_REQUEST`, `QUESTIONS`). 동기 함수라 core를 쓰지 않는다. (`say`로 요청이 간 시나리오는 첫 call이 없으므로 `request`를 인자로 받는 두 번째 꼴 `askedAgainInput(app, request)`도 준다.)
   - `rootCauseInput(bug, app)`: `BUG`는 `bug.description`, `TICKET_GOALS`는 live이면 `evidence-has-problem`과 같은 ticket들의 `goal`(번호 붙여 이음), fixture이면 기록의 `ticket.create` 입력 `goal`, `EVIDENCE_FILES`는 그 ticket들의 `file` 근거 경로(없으면 `(none)`).
10. `tests/eval/checks/app/fixtures.ts`: `appApiSession(agent, steps)`. `fixtureSession(agent, steps)`를 부른 뒤 `tool`이 `app__fx__`로 시작하는 tool call의 `call.app_api`를 `{ app: "app_fx_x", release: "rel_fx", command: <접두사 뒤>, ... }`로 채운다(protocol type으로 한 번 cast). 이유: ev-checks의 `FxStep`에는 `app_api` 칸이 없다. coding agent에게 가는 call(`FixtureCall.to`에 `codingAgent(app)`)이 ev-checks의 fixture type에서 안 받아지면 맞추는 일은 ec-contract 몫이다. 이 task에서 cast하지 않고 보고에 적는다.
11. 위험 test 셋(`tests/eval/checks/app/*_test.ts`). core, subprocess, `git`, 네트워크를 쓰지 않는다. 주석과 test 이름에 task id를 쓰지 않는다.
    - `match_test.ts`: `exampleMatches`가 core와 같은 규칙인 것. 객체는 expect의 key가 모두 있어야 하고 나머지 key는 무시, 배열은 길이와 순서까지 같아야 한다.
    - `observe_test.ts`: `decideFailure`(새 problem이면 통과, 이름이 묶여 발생만 늘면 떨어짐, 아무것도 안 바뀌면 떨어짐), `decideNoRecurrence`(발생 수가 늘거나 새 problem이 생기거나 `recurred`가 차면 떨어짐), `namesMissing`(ticket 글에 없는 이름만 돌려줌).
    - `reuse_test.ts`: `blueprintSdkNames`(7개 밖의 이름을 가려냄), `importsPackage`(의존 선언 줄과 주석·문자열은 import가 아님, `from "@me/x/sub"`는 import), `definesName`(`import { name }`은 정의가 아니고 `function name`, `const name =`은 정의).
12. 손으로 확인한다(commit하지 않는다. scratchpad script): `tests/support/app/activate.ts`의 `activateTestApp`으로 template 앱(`reportPatch`나 `crashPatch`를 얹은 것)을 켜고(`bootCore(run, { env: await appCoreEnv() })`, fake provider) 아래를 부른다. 진짜 provider는 부르지 않는다.
    - `appActive`, `apiAnswers`(template의 `add_item` 후 `list_items`), `callApi`가 통과한다.
    - `observeFailure`: `reportPatch`의 `report` app-api(`reportProblem` 이름 `e2e_report`)를 부르면 새 problem이 열리고, 같은 호출을 한 번 더 부르면 `이름이 묶임`으로 떨어진다. 아무것도 보고하지 않는 `list_items`를 부르면 `조용히 넘어감`으로 떨어진다.
    - store rename: 위 앱에서 `observe-store`의 around를 쓰고 `list_items`를 부르면 처리 안 된 예외가 new problem으로 열린다.
    - 각각의 결과를 보고에 적는다. 이 확인이 안 되면(앱 process가 못 뜨는 등) 이유를 적고 순수 부분만 낸다.

## 정한 것

- **live check는 fixture에서 건너뛴다**: `core === null`이면 통과로 돌려주고 이유를 `live check: fixture에서는 건너뜀`으로 적는다. `validateFixtures`의 `fails`에는 쓰지 않는다. 이유: fixture에는 world가 없다. 대신 판정 논리를 순수 함수(`decideFailure`, `decideNoRecurrence`, `namesMissing`, `blueprintSdkNames`, `importsPackage`, `definesName`)로 갈라 test한다. 대안(`CheckOutcome`에 `skipped`를 더함)은 계약을 바꾸므로 쓰지 않았다.
- **observation은 실패마다 따로 check로 둔다**: 한 check 안에서 셋을 돌리면 어느 실패가 조용한지 scorecard에 안 보이고, check끼리 상태를 넘기려면 전역 상태가 필요하다. 대신 "새 problem이 열려야 한다"를 기준으로 삼아 각 check가 서로의 결과를 모르고도 이름 충돌을 잡는다. 실행 순서는 배열 순서다.
- **store 실패는 SQLite 표 rename으로 일으킨다**: 제품 route에 store 실패를 일으키는 길이 없다. eval이 만든 data root의 앱 DB 파일을 eval 쪽 연결로 고치는 것이라 사람의 `~/.lophn`을 건드리지 않는다. 대안(앱 process를 내리고 DB를 깨뜨려 재시작)은 앱이 아예 못 떠 `app_unavailable`이 되어 handler의 store 실패 분기를 못 본다.
- **알림 앱 실패는 `app.disable_execution`으로 일으킨다**: 사람 자격의 제품 route다.
- **ticket에 적은 이름 확인은 named problem → ticket 방향만**: 위 할 일 6.
- **재사용의 source는 active release의 `code_commit`**: working tree가 아니다.
- **날짜는 시나리오가 넣는다**: 이 task의 builder는 날짜를 계산하지 않는다.

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`도 check에서 돈다. 그래서 test는 순수해야 한다(core 부팅, subprocess, `git`, 네트워크, 진짜 provider 없음).
- 위험 test:
  - "이름이 같아 한 problem으로 묶인 두 번째 실패와 아무 problem도 열지 않은 실패는 떨어지고, 새 problem이 열린 실패만 통과한다. 고친 뒤 같은 호출이 발생 수를 늘리거나 새 problem을 열거나 `recurred`를 채우면 떨어진다." (`observe_test.ts`, 원인이 다른 실패의 이름을 나누는지와 고친 release가 정말 문제를 없앴는지를 재는 기준이 틀리면 observation·진단 점수 전체가 틀린다.)
  - "의존만 걸고 import하지 않은 앱과 package의 export 이름을 다시 정의한 앱은 떨어뜨린다." (`reuse_test.ts`, 재사용 점수가 속는 두 길이다.)
  - "예시 비교는 core의 `examples`와 같은 규칙이다." (`match_test.ts`, 규칙이 갈라지면 App Engineer가 통과시킨 예시를 이 check가 다르게 판정한다.)
- 새 subprocess·서버·브라우저를 띄우는 test는 없다. live check는 test가 아니라 손 확인(할 일 12)으로 본다.
- 남지 않음: `grep -rn "packages/core" tests/eval/checks/app`은 주석 말고 import 0줄이다(core를 import하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (criterion 셋의 `INPUT_SECTIONS` 항목은 이 task가 `tests/eval/criteria/mod.ts`에 직접 더한다: `card-covered` → `["CARD","BLUEPRINT","TICKETS"]`, `asked-again` → `["HUMAN_REQUEST","QUESTIONS"]`, `root-cause` → `["BUG","TICKET_GOALS","EVIDENCE_FILES"]`. landed된 `mod.ts`가 다른 꼴이면 그 꼴에 맞춰 같은 정보를 넣는다.)
- 안 쓰게 된 export: 없음
- 정한 것: 아래 "정한 것" 밖에서 worker가 정한 것, 기대한 export와 달라 맞춘 이름
- 넘길 줄: 남의 file을 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: 위 "ec-contract가 정한 계약"과 landed된 코드가 다르면 여기에 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: live check는 fixture에서 건너뛰어(통과 처리) right/wrong fixture로 검증하지 못한다. 손 확인(할 일 12)만 했다. 첫 진짜 실행에서 확인할 것: 옛 release의 `appAppApi` 읽기, `app.disable_execution`이 알림 앱 호출을 `denied`로 만드는지, rename한 표에서 앱이 예외를 내는지.
