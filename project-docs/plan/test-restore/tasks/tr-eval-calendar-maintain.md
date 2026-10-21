# tr-eval-calendar-maintain

calendar-maintain과 calendar-diagnose를 다시 쓴다. maintain: data가 있는 켜진 앱을 App Engineer가 바꾸고(prepare, preview, activate) 옛 data와 옛 tool이 남는다. diagnose: bug를 터뜨린 뒤 사람이 App Engineer에게 말하고(problem도 reaction도 session을 열지 않는다), App Engineer가 status·logs·invocations를 먼저 읽고 고쳐 올려 같은 호출이 이제 답한다. `root-cause` judge 입력은 ticket 대신 App Engineer의 마지막 답과 고친 commit diff다.

- 단위: eval (wave 2)
- 선행: tr-eval-calendar-build.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/{calendar-maintain,calendar-diagnose}.scenario.ts`
  - `tests/eval/checks/app/{diagnose,judge-input,mod}.ts`
  - `tests/eval/criteria/root-cause.json`
  - `tests/eval/registry/criterion/root-cause.json`
  - `tests/eval/registry/scenario/{calendar-maintain,calendar-diagnose}.json`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(agent가 정한 것의 "judge `card-covered`는 `DESIGN.md`를, `root-cause`는 App Engineer의 마지막 답과 고친 diff를 읽는다", "eval runner의 idle·stuck 한도는 시나리오마다 정한다")과 "범위 밖"(`SAY_MAINTAIN`, `CARD_MAINTAIN`, `CARD_DIAGNOSE`, `REPEAT_SCRIPT`, `OLD_SCRIPT`, `SEED_CALLS` 같은 사람 말과 tool 이름 check는 다시 쓰지 않고 새 흐름에서 그대로 돌게 둔다)
  - 계약: `project-docs/plan/test-restore/tasks/tr-eval-calendar-build.md`의 "내놓는 것"(`designFirst`, `appEngineerCalls`, `aeFlowChecks`, `aeFlowSteps`, `cardCoveredInput`, `card-covered@4`)
  - 조사: `project-docs/plan/test-restore/survey-eval.md` 1절의 `checks/app/diagnose.ts`·`judge-input.ts` 줄, 2절의 calendar-maintain·calendar-diagnose 줄, 4절의 calendar-maintain·calendar-diagnose
  - architecture: `project-docs/architecture/eval.md`의 "지키는 것"(버전은 hash로 고정한다, 채점 순서, check 순서가 실행 순서다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - 지침: `packages/core/agent-roles/roles/app-engineer/prompt.md` 9-14줄(lophn은 앱이 죽어도 session을 열지 않는다, 사람이 묻는다), 35-38줄(바꿀 때도 `DESIGN.md` 먼저), 50-77줄, 81-87줄(고치기 전에 `app.status`, `app.logs`, `app.invocations`를 읽는다)
  - 코드
    - `tests/eval/scenarios/calendar/calendar-maintain.scenario.ts`, `calendar-diagnose.scenario.ts`(tr-eval-prune-checks가 죽은 check를 걷은 뒤의 모양을 연다), `spec.ts`(`RESTORED_RELEASE` 11줄, `CARD_MAINTAIN` 31-34줄, `CARD_DIAGNOSE` 37-39줄, `SAY_MAINTAIN` 49-50줄, `OLD_SCRIPT` 87-99줄, `SEED_CALLS` 107-119줄, `REPEAT_SCRIPT` 127-145줄, `BUG` 156-163줄), `common.ts`(tr-eval-calendar-build 뒤)
    - `tests/eval/checks/app/diagnose.ts`(HEAD 72-191줄 `diagnosisChecks`: `fixed-release-active` 100-120줄, `no-recurrence` 121-141줄, `blueprint-kept` 142-189줄), `judge-input.ts`(HEAD 103-132줄 `rootCauseInput`, `SECTION_MAX`·`clip` 11-17줄), `design-doc.ts`(tr-eval-calendar-build), `reuse.ts`(`git` 72-86줄), `live.ts`(`findApp`, `callApi`, `liveCheck`, `oneLine`), `match.ts`(`exampleMatches`), `active.ts`(`appActive`, `releaseAdvanced`), `answers.ts`(`apiAnswers`)
    - `tests/eval/checks/fixtures.ts`(`FxStep`, `fixtureSession`), `tests/eval/checks/validate.ts`, `tests/eval/criteria/root-cause.json`, `tests/eval/criteria/mod.ts`(`INPUT_SECTIONS` 6-14줄)
    - `tests/eval/versions/authored.ts`(`scenarioHash` 19-33줄: 같은 폴더의 helper file이 다섯 calendar 시나리오 hash에 모두 든다), `tests/eval/runner/register.ts`, `tests/eval/runner/cli.ts`, `tests/eval/runner/world.ts`(`prepareTrialWorld`), `tests/eval/runner/steps.ts`(`callApi` 단계: 앱의 `failed`는 단계 실패가 아니다)
    - 앱 log: `packages/protocol/apps/app-log.ts` 9-56줄(줄 꼴 `error <name>…`, `exception <name>: <message>`, `since` 포함·`until` 제외), `packages/protocol/apps/runtime.ts` 191-200줄(`appLogs`, 사람 actor로 읽는다)
    - 마지막 답: `packages/protocol/lophn-agent/received-messages.ts` 41-53줄(`receivedMessageList`), `packages/protocol/lophn-agent/messages.ts` 183-201줄(`messageBody`), `packages/core/lophn-agent/session/message-commands.ts` 360-374줄(agent의 답은 `from_kind 'agent'`, `from_ref`가 그 session이다. 읽으면 `from: {kind: "agent", session: <자기 session>}`), 본보기 `tests/e2e/session_test.ts` 140-157줄
    - release: `packages/protocol/apps/activation/activation.ts` 60-92줄(`code_commit`, `number`, `status`), `releasesListRecords`, `packages/protocol/apps/mod.ts`의 `appGet`(`source_path`)
    - 재료: `tests/eval/materials/calendar-app/2/files/source`, `calendar-app-bug/2/files/bug.json`(tr-eval-restore가 새 판을 만들었으면 그 판)
- 계약:
  - 쓰는 것: tr-eval-calendar-build의 `buildAppChecks`, `designFirst`; `tests/eval/checks/app/diagnose.ts`의 live 부분(`BugSpec`, 같은 호출이 이제 `expectAfterFix`로 답한다); App Engineer tool `app.status`, `app.logs`, `app.invocations`; tr-eval-restore의 재료 판
    - (살 단계에서 더함) calendar-maintain은 `buildAppChecks` 전체가 아니라 tr-eval-calendar-build의 `aeFlowChecks()`(`designFirst` 포함)와 fixture 조각 `aeFlowSteps(purpose)`를 쓴다. `buildAppChecks`의 재사용 check와 `app-design`은 새 앱 몫이다. 진단 check는 `appEngineerCalls`를 쓴다.
  - 내놓는 것: `rootCauseInput`(이름 다시 둔다)의 입력이 App Engineer의 마지막 답과 고친 commit diff다. criterion은 `root-cause@4`다.

## 할 일

근거는 README "정한 것"과 App Engineer 지침 81-87줄이다. 진짜 model은 부르지 않는다: `deno task eval`은 `.env`의 key를 읽으므로 쓰지 않고, 아래 "끝남"의 명령(key를 뺀 `deno run`)만 쓴다(AGENTS.md "사람에게 묻는 것").

정한 것: `spec.ts`와 `common.ts`는 고치지 않는다. 이유: 같은 폴더의 helper file은 다섯 calendar 시나리오 hash에 모두 든다(`scenarioHash`). 고치면 tr-eval-calendar-build가 막 등록한 calendar-user@2·calendar-dev@2와 calendar-api의 hash가 바뀌어 registry가 그 n을 거절한다("n을 올려라"). 새 사람 말은 시나리오 file 안에 둔다. 고칠 수밖에 없으면 고치고, hash가 바뀐 시나리오를 보고에 적는다.

1. world 재료를 확인한다.
   - tr-eval-restore 보고의 판을 쓴다: maintain은 `calendar-app@<n>`, `calendar-data@<n>`, diagnose는 `calendar-app-bug@<n>`(그 brief대로면 셋 다 `@3`. 새 판이 없으면 지금 `@2`).
   - `find tests/eval/materials/calendar-app/<n>/files/source -name 'DESIGN.md*'`가 비어 있는지 본다. 비어 있어야 App Engineer가 바꾸기 전에 `DESIGN.md`를 `file.write`로 처음 쓰고, 기록만 읽는 `design-first`가 그것을 본다. 있으면 바꾼 절만 고친 trial을 `design-first`가 떨어뜨리므로(앞 글이 기록에 없다), maintain에서는 `aeFlowChecks().filter((c) => c.id !== "design-first")`를 쓰고 `asked-again`의 premise를 `["ae-tested"]`로 두고 보고한다.
   - 되살린 캘린더의 첫 release 번호가 `RESTORED_RELEASE`(1)인지 world 되살리기에서 본다(아래 "끝남"의 script에 `releasesListRecords` 한 줄을 더해 찍는다). 다르면 `spec.ts`의 값을 고치고 위 "정한 것"대로 보고한다.
2. `tests/eval/checks/app/diagnose.ts`: `diagnosisChecks(spec)`를 새 흐름으로 다시 쓴다. 근거: 지침 81-87줄, 조사 4절 calendar-diagnose, README "범위 밖"(`BugSpec`의 tool 이름 그대로).
   - 돌려주는 순서(읽기만 하는 것 먼저, 앱을 부르는 것 끝. `architecture/eval.md` "check 순서가 실행 순서다"):
     1. `read-before-fix`(기록 check. core를 쓰지 않는다): `appEngineerCalls(trial, spec.app)`(`./design-doc.ts`)에서 고치기 시작한 첫 call(`file.write`, `file.edit`, `release.prepare` 가운데 처음)을 찾는다. 없으면 떨어진다("고친 흔적이 없음"). 그 앞에 성공한 `app.logs`나 `app.invocations`가 하나 이상이어야 통과다. reason에 그 앞에서 읽은 tool 이름(`app.status` 포함)을 적는다.
        - 정한 것: `app.status`는 통과 조건에 넣지 않는다. 이유: 원인의 근거(예외 줄과 source frame, 실패한 호출)는 `app.logs`와 `app.invocations`에만 있고, 이 bug는 앱을 멈추지 않아 status는 늘 running이다.
     2. `fixed-release-active`: HEAD 100-120줄 그대로(켜진 release 번호 2 이상, 첫 release `superseded`, runtime ready).
     3. `blueprint-kept`: HEAD 142-189줄 그대로.
     4. `no-recurrence`(다시 쓴다): `findApp` → `since = new Date().toISOString()` → `callApi(core, app.id, bug.api, bug.input)`. `succeeded`이고 `exampleMatches(bug.expectAfterFix, result)`가 아니면 떨어진다(지금 reason 꼴). 맞으면 3초 기다린 뒤(supervisor가 log 줄을 늦게 쓴다) `appLogs {app, since}`의 줄 가운데 `text`가 `error `나 `exception `으로 시작하는 줄이 없어야 통과다. 떨어지면 그 줄을 `oneLine`으로 reason에 적는다.
   - 지운다: problem을 읽던 것(`snapshot`, `Snap`, `decideNoRecurrence`, `problemGet`·`tickets.ts` import, `read-problem`·`evidence-has-problem`·`ticket-points-at-bug`)이 tr-eval-prune-checks 뒤에도 남았으면 지운다. 머리 주석을 "고치기 전에 읽었나, 고친 release가 켜졌나, 같은 호출이 이제 답하고 새 오류 줄이 없나. 원인을 짚었나는 judge `root-cause@4`"로 고친다.
   - `BugSpec`, `DiagnoseSpec`의 모양은 그대로다.
3. `tests/eval/checks/app/judge-input.ts`: `rootCauseInput(bug, app)`를 다시 둔다(tr-eval-prune-checks가 ticket을 읽던 것을 지웠다). 근거: README "`root-cause`는 App Engineer의 마지막 답과 고친 diff를 읽는다".
   - 입력 칸 셋: `[BUG]`(지금처럼 `${bug.description}\nfiles: ${bug.files.join(", ")}`), `[ANSWER]`, `[FIX_DIFF]`. 둘 다 `clip`(12,000자)한다. fixture(`core === null`)에서는 둘 다 `(not available)`이다.
   - ANSWER: `trial.sessions` 가운데 `agent.role === "app_engineer"`이고 `place?.name === app`인 마지막 session에서 `receivedMessageList {session}`을 읽어 `from.kind === "agent" && from.session === session`인 메시지 가운데 `created_seq`가 가장 큰 것을 `messageBody {message}`로 읽고, `content.parts`의 `text` part를 줄바꿈으로 잇는다. 없으면 `(no answer)`.
   - FIX_DIFF: `findApp` → `releasesListRecords {app}`를 `number` 순으로 두고 가장 작은 것(되살린 bug release)과 가장 큰 것(App Engineer가 마지막으로 준비한 release)의 `code_commit`으로 `git(appGet의 source_path, ["diff", a, b, "--", ".", ":(exclude)deno.lock"])`(`reuse.ts`의 `git`). 둘이 같으면 `(no new release)`.
     - 정한 것: 켜진 release가 아니라 가장 큰 번호의 release를 쓴다. 이유: 고쳐 준비했지만 켜지 못한 trial에서도 judge가 고친 곳을 본다. 켜졌는지는 `fixed-release-active`가 따로 본다.
4. `tests/eval/checks/app/mod.ts`: `judge-input.ts`의 `rootCauseInput`을 내보낸다. 다른 export는 그대로다.
5. `tests/eval/criteria/root-cause.json`: `n: 4`, `verdicts`·`pass`는 지금 그대로(`root_cause`, `symptom_only`, `wrong`, `cannot_tell` / `root_cause`), `question`(사람이 이 brief에서 검토한다):

   > The input has three sections. [BUG] describes a bug that was planted in an app: the symptom, the true cause, and the files where the cause lives. [ANSWER] is the last message the App Engineer wrote after the person reported the symptom. [FIX_DIFF] is the code change from the release that had the bug to the newest release the App Engineer prepared; it may be cut off, or say there is no new release. Decide whether the App Engineer found the true cause and fixed it there. Verdicts: root_cause = the diff changes the code where the true cause lives and removes that cause, and the answer or the diff names it; symptom_only = the answer and the diff only deal with the symptom (for example catching or hiding the error, or a workaround elsewhere) and leave the cause; wrong = they name or change a different cause or an unrelated place; cannot_tell = the input does not let you decide (for example there is no answer and no new release). The quote must be the part of the input that decided your verdict (the diff line or the answer words that name or remove the cause, or for symptom_only and wrong the part that shows it).

   - `tests/eval/criteria/mod.ts`의 `INPUT_SECTIONS`는 tr-eval-calendar-build가 지웠다(읽는 곳이 없었다). 고칠 것이 없다.
6. `tests/eval/scenarios/calendar/calendar-maintain.scenario.ts`. 근거: 조사 4절 calendar-maintain(옛 data·tool이 남고, 새 release가 켜지고, preview를 썼다).
   - `n: 6`(file의 5와 registry의 3보다 크게 한 번 올린다), `world`(1의 판), `real: [AE]`, `limits: { idle_ms: 60 * 60_000 }`, `human`·`steps`·`save`는 그대로다.
     - 정한 것: 60분. 이유: 있는 앱에 기능 하나를 더하는 일이라 새 앱(90분, calendar-build)보다 짧고, README의 15~60분 안이다.
   - `checks`: `...aeFlowChecks()`, `appActive("app-active")`, `releaseAdvanced("release-advanced", {after: RESTORED_RELEASE})`, `data-remains`(`SEED_CALLS`), `old-api-answers`(`OLD_SCRIPT`), `repeat-works`(`REPEAT_SCRIPT`)(셋은 지금 그대로, data를 바꾸는 둘이 뒤), judge 둘:
     - `card-covered`: premise `["release-advanced"]`, criterion `card-covered@4`, input `cardCoveredInput(CARD_MAINTAIN, APP)`
     - `asked-again`: premise `["design-first"]`, criterion `asked-again@3`, input `askedAgainInput(SAY_MAINTAIN)`
   - `fixtures`(`goal` 글은 fixture의 Purpose로만 쓴다):
     - right: `fixtureTrial([fixtureSession(AE, aeFlowSteps(goal))])`
     - wrong: `aeFlowSteps(goal)`에서 `file.write` step을 뺀 것 → fails `["design-first"]`; `preview.`로 시작하는 step을 뺀 것 → fails `["ae-previewed"]`
   - 지운다: `addCodingCall`·`aeCallsOnlyToCodingAgent`·`aeTicketChecks`·`CODING`·`ticketCreate`·`ticketVerify`가 남았으면 그 import와 쓰는 곳.
7. `tests/eval/scenarios/calendar/calendar-diagnose.scenario.ts`. 근거: 조사 2절 calendar-diagnose("no reaction opens an AE session … needs a `say` step"), 지침 9-14줄.
   - 이 file 안에 사람 말 하나를 둔다: `const SAY_DIAGNOSE = "캘린더에서 다음 주 일정을 보려고 하면 오류가 나. 고쳐 줘.";` tool 이름과 입력을 말하지 않는다(`ISSUE-human-request-abstraction.md`).
   - `n: 6`, `world: ["calendar-app-bug@<n>"]`, `real: [AE]`, `limits: { idle_ms: 60 * 60_000 }`, `human: { card: CARD_DIAGNOSE, approve: { activation: "allow" } }`(그대로).
   - `steps: [callApi(APP, BUG.api, BUG.input), say(AE, SAY_DIAGNOSE), untilIdle()]`. 사람이 앱에서 오류를 본 뒤 App Engineer에게 말한다.
   - `checks`: `...diagnosisChecks({ app: APP, bug: BUG })`, judge `root-cause`: premise `["read-before-fix"]`, criterion `root-cause@4`, input `rootCauseInput(BUG, APP)`.
     - 정한 것: premise는 `read-before-fix`다. 이유: 옛 premise(`evidence-has-problem`)처럼 App Engineer가 조사하고 고치기 시작한 trial만 채점하고, 켜지 못한 trial의 원인 판단도 잰다.
   - `fixtures`:
     - right: AE session `[app.status, app.logs, { tool: "app.invocations", input: { app: "app_fx_캘린더", status: "failed" } }, { tool: "file.edit", effect: "write", input: { path: "src/events.ts", old_string: "a", new_string: "b" } }, { tool: "shell.run", effect: "external", input: { command: "deno task test" } }, { tool: "release.prepare", effect: "write" }, { tool: "release.activate", effect: "write" }]`
     - wrong: `file.edit`이 `app.logs` 앞인 순서 → fails `["read-before-fix"]`
   - 머리 주석을 "callApi가 bug를 터뜨리고, 사람이 App Engineer에게 말한다"로 고친다. problem·ticket·coding 말과 import(`problemGet`, `ticketCreate`, `ticketVerify`, `toolCount`, `CODING`, `addCodingCall`)가 남았으면 지운다.
8. `BUG.description`(`spec.ts` 162줄)의 "and a problem opens"는 tr-eval-calendar-build가 지웠다(planner). 이 task는 `spec.ts`를 고치지 않는다.
9. 확인과 등록(아래 "끝남"의 명령). key 없는 runner가 `registry/scenario/{calendar-maintain,calendar-diagnose}.json`에 `n: 6`, `registry/criterion/root-cause.json`에 `@4`(내용 포함)를 쓴다. 손으로 쓰지 않는다. `card-covered@4`는 tr-eval-calendar-build가 이미 등록했으므로 바뀌지 않아야 한다.

## 끝남

- `deno check tests/eval/run.ts tests/eval/scenarios/calendar/*.ts tests/eval/checks/app/*.ts`가 통과한다(`tests/eval`은 `tr-check-enable`까지 `NOT_CHECKED`라 `deno task check`가 보지 않는다). 소유 밖 file의 오류는 고치지 않고 보고한다.
- `deno fmt --check`와 `deno lint`가 바꾼 `.ts` file에서 통과한다.
- `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts --scenario calendar-maintain --scenario calendar-diagnose`가 "ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다" 줄을 찍고 0으로 끝난다. 같은 명령에 `--scenario calendar-user --scenario calendar-dev`를 더해도 0이다(helper를 고치지 않아 build의 등록이 그대로다). `deno task eval`은 쓰지 않는다.
- world 되살리기: `deno task e2e:deps` 뒤 tr-eval-calendar-build brief "끝남"의 임시 script(`.dev-data/tmp/world.ts`, commit하지 않는다)를 `calendar-maintain calendar-diagnose`로 돌려 둘 다 `ok`다. maintain의 되살린 첫 release 번호를 찍어 `RESTORED_RELEASE`와 맞는지 본다.
- `deno task check`가 통과한다.
- 위험 test: 없음. eval check의 판정은 시나리오마다 right·wrong fixture가 provider 전에 확인한다(`architecture/eval.md`). 사용자 data, 권한, sandbox 경계를 지키는 코드가 아니다(`write-test`).
- 남지 않음: `grep -rn "problemGet\|problemList\|ticket\|TICKET_GOALS\|EVIDENCE_FILES\|addCodingCall\|aeCallsOnlyToCodingAgent\|decideNoRecurrence\|CODING" tests/eval/scenarios/calendar/calendar-{maintain,diagnose}.scenario.ts tests/eval/checks/app/{diagnose,judge-input}.ts tests/eval/criteria/root-cause.json`가 0줄이다.
- `git diff main -- tests/eval/scenarios/calendar/common.ts tests/eval/scenarios/calendar/spec.ts`가 비어 있다(고쳤으면 보고에 이유와 hash가 바뀐 시나리오).

## 보고

- 바꾼 file
- 통과한 check(위 명령마다 결과 한 줄)
- 등록할 것: 없음(`deno.json`을 고치지 않는다). registry에 쓴 항목(`scenario` calendar-maintain@6·calendar-diagnose@6, `criterion` root-cause@4)을 적는다. 소유 밖 registry가 바뀌었으면 되돌리지 말고 적는다
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"들을 그대로 했는지 포함). 실제로 쓴 world 재료 판과 되살린 첫 release 번호
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 남긴 낡은 글: `spec.ts`의 `CARD_DIAGNOSE` 위 주석("사람 역할이 없는 단위지만"). 고치면 calendar 다섯의 n이 같이 오른다
- 문서(lead): `architecture/eval.md`의 진단 check(`read-before-fix`, `no-recurrence`가 app log를 본다), `root-cause` 입력(마지막 답과 diff), calendar-diagnose의 `say` 단계
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## lead가 더함

- tr-eval-restore가 merge됐다. 새 판은 다섯 모두 `@3`이다: `notify-app@3`, `date-range@3`(needs `notify-app@3`), `calendar-app@3`, `calendar-app-bug@3`(parent `calendar-app@3`), `calendar-data@3`. 옛 판은 남아 있다. world는 `@3`을 쓴다. 세 world는 가짜 model로 되살아나고 앱의 `deno task check`가 지나는 것을 그 task가 봤다(bug world의 `deno task test`는 일부러 떨어진다).
- tr-eval-human도 merge되어 eval이 import된다. 확인은 늘 `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts …`다. L4-new는 lead가 n 7로 등록했다.
