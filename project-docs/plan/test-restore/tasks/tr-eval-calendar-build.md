# tr-eval-calendar-build

calendar-user와 calendar-dev를 App Engineer가 직접 설계하고 짓는 흐름으로 다시 쓴다. `app-design` judge는 App Engineer가 쓴 `DESIGN.md`의 Journeys와 Screens를 사람 요청과 견주게 바꾸고, 첫 `release.prepare` 전에 source root에 일곱 절의 `DESIGN.md`가 있는지 보는 program check를 더한다. ticket을 읽던 `card-covered` 입력은 `DESIGN.md`로 다시 쓴다. 지운 `calendar-call` 재료 대신 캘린더 앱 등록만 되살리는 `app` 재료를 둔다.

- 단위: eval (wave 2)
- 선행: tr-eval-restore, tr-eval-human.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/{calendar-user,calendar-dev}.scenario.ts`
  - `tests/eval/scenarios/calendar/{common,spec}.ts`
  - `tests/eval/criteria/mod.ts`(`INPUT_SECTIONS`만)
  - `tests/eval/checks/app/design.ts`
  - `tests/eval/checks/app/design-doc.ts` (새 file)
  - `tests/eval/checks/app/{judge-input,mod}.ts`
  - `tests/eval/criteria/{app-design,card-covered}.json`
  - `tests/eval/materials/calendar-blank` (새 file)
  - `tests/eval/registry/criterion/{app-design,card-covered}.json`
  - `tests/eval/registry/scenario/{calendar-user,calendar-dev}.json`
  - `tests/eval/registry/material/calendar-blank.json` (새 file)
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(사람이 정한 것의 "eval의 화면 채점은 코드가 아니라 설계를 본다"와 "program check 하나를 더한다", agent가 정한 것의 "calendar-user와 calendar-dev의 앱 등록은 새 material `calendar-blank@1`이 한다"와 "eval runner의 idle·stuck 한도는 시나리오마다 정한다")와 "범위 밖"(사람 말과 tool 이름 check를 다시 쓰지 않는다, App Engineer 지침을 고치지 않는다, `calendar-app-dev`·`calendar-app-user` 재료와 root의 `ISSUE-*.md`는 건드리지 않는다)
  - 조사: `project-docs/plan/test-restore/survey-eval.md` 2절의 calendar-user·calendar-dev 줄과 "Expected AE tool sequence"(89-100줄), 4절의 calendar-user·calendar-dev, 5절의 option 3·4
  - 사람 메모(저장소 root, commit하지 않은 file. 읽기만 한다): `ISSUE-calendar-without-calendar.md`(목록을 통과시킨 `app-design`, "App Engineer가 직접 짜면 설계를 건너뛴다"), `ISSUE-human-request-abstraction.md`
  - architecture: `project-docs/architecture/eval.md`의 "지키는 것"(버전은 hash로 고정한다, 채점 순서, check 순서가 실행 순서다, 산출물은 후보 재료다)과 "왜 이 모양인가"(case마다 right/wrong fixture)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - 지침: `packages/core/agent-roles/roles/app-engineer/prompt.md` 29-48줄(Designing the app: `DESIGN.md` 일곱 절과 순서), 50-77줄(Building and releasing: test, `release.prepare`, preview, `release.activate`)
  - 코드
    - `tests/eval/scenarios/calendar/calendar-user.scenario.ts`, `calendar-dev.scenario.ts`(1-21줄), `common.ts`(HEAD 기준 `buildAppFixtures` 123-150줄, `buildAppChecks` 152-182줄. tr-eval-prune-checks가 죽은 check를 걷은 뒤의 모양을 연다), `spec.ts`(`CARD_USER` 20-23줄, `CARD_DEV` 26-29줄, `SAY_USER`·`SAY_DEV` 43-47줄, `REUSE` 149-153줄. 이 task는 고치지 않는다)
    - `tests/eval/checks/app/design.ts`(지금 코드를 읽는 judge 입력), `judge-input.ts`(HEAD 52-88줄 `cardCoveredInput`의 BLUEPRINT 조립 62-73줄. tr-eval-prune-checks가 함수를 지운다), `reuse.ts`(`git` 72-86줄, `source` 128-144줄), `live.ts`(`findApp`, `liveCheck`), `mod.ts`
    - `tests/eval/checks/records.ts`(`effectiveToolCalls` 18-22줄, `toolCallsOf`), `tests/eval/checks/fixtures.ts`(`FxStep` 27-36줄, `fixtureSession` 117-278줄: `tool` 칸 step은 tool call 하나가 되고 `input`·`output`을 그대로 싣는다), `tests/eval/checks/validate.ts`(right는 모든 program check 통과, wrong은 `fails`가 떨어짐, right의 judge 입력은 core 없이 빈 글이 아님)
    - `tests/eval/criteria/app-design.json`, `card-covered.json`, `tests/eval/criteria/mod.ts`(`INPUT_SECTIONS` 6-14줄, `loadCriterion`)
    - `tests/eval/judge/input.ts`(`joinInput`)
    - `tests/eval/restore/apps.ts`(`restoreApps`: kind `app` 재료의 `apps.json`을 `appCreate`로 등록한다. `appCreate`는 template source를 `<home>/apps/<app>/source`에 깐다), `tests/eval/restore/manifest.ts`(`writeMaterial` 77-105줄이 `content_hash`를 잰다), `tests/eval/restore/save.ts`(`relations` 144-163줄), `tests/eval/materials/calendar-call/3/`(지운 재료. `files/app.json`의 앱 등록 값, `material.json`의 id. tr-eval-prune-coding 뒤에는 git 기록에서 읽는다)
    - `tests/eval/versions/authored.ts`(`scenarioHash` 19-33줄: 시나리오 file과 같은 폴더의 `.scenario.ts`·`_test.ts`가 아닌 file을 모두 잰다), `tests/eval/runner/register.ts`(`registerAll`), `tests/eval/runner/cli.ts`(key가 없으면 등록과 fixture 확인만 하고 0으로 끝난다), `tests/eval/runner/world.ts`(`prepareTrialWorld` 30-55줄)
    - tool 기록 모양: `packages/core/lophn-agent/tools/bundles/file.ts`(`file.write {path, content}`, `file.edit {path, old_string, new_string, replace_all?}`. 상대 path는 place 첫 폴더 기준), `packages/core/agent-roles/place/place-folders.ts` 29-49줄(App Engineer의 첫 폴더는 앱 source), `packages/protocol/apps/app-storage.ts` 59-61줄(`appDefaultSource` = `<app 폴더>/source`), `packages/core/lophn-agent/tools/bundles/shell.ts`(`shell.run {command, timeout_ms?}`), `packages/core/apps/agent-tools/release.ts` 68-125줄, `packages/core/apps/agent-tools/preview.ts`(`preview.start {release, fixture?}`, `preview.call {app, tool, input?}`, `preview.stop {app}`), `packages/core/router/router.ts` 113-150줄(`coding_agent`로 가는 call은 거절된다)
- 계약:
  - 쓰는 것: `packages/core/agent-roles/roles/app-engineer/prompt.md`의 `DESIGN.md` 절과 순서(Purpose, Reuse, Model, Journeys, Screens, Tools, Failure branches), tr-eval-prune-coding의 `Scenario.limits`, tr-eval-human의 `ApproveRule`, `tests/eval/checks/app/reuse.ts`(`source`, `git`), tr-eval-restore의 재료 판
  - 내놓는 것(tr-eval-calendar-maintain이 기댄다):

    ```ts
    // tests/eval/checks/app/design-doc.ts
    export const DESIGN_SECTIONS = [
      "Purpose", "Reuse", "Model", "Journeys", "Screens", "Tools", "Failure branches",
    ] as const;
    // pass: App Engineer의 첫 release.prepare 앞에 앱 source root의 DESIGN.md가 있고,
    // 그 글에 DESIGN_SECTIONS가 `## ` 머리로 이 순서대로 있다.
    export function designFirst(id: string, opts: { app: string }): ProgramCheck;
    ```

    - `checks/app/mod.ts`가 `designFirst`, `DESIGN_SECTIONS`를 내보낸다.
    - `appDesignInput(card, app)`(이름 그대로)는 켜진 release commit의 `DESIGN.md`에서 Journeys와 Screens 절을 읽어 judge에 준다. criterion은 `app-design@2`다: 그 종류의 앱이 처음 여는 주 화면을 골랐나, 사람이 한 말의 일을 그 화면에서 하나.
    - `cardCoveredInput`(이름 다시 둔다)은 ticket 대신 `DESIGN.md`를 읽는다. criterion은 `card-covered@4`다.
    - `scenarios/calendar/common.ts`의 `buildAppChecks(card, request)`가 `designFirst`와 `app-design@2`, `card-covered@4`를 싣는다(calendar-maintain도 쓴다).
    - 새 재료 `calendar-blank@1`(kind `app`)은 캘린더 앱(id `app_0000000000000000000000cdr1`)을 등록만 한다.
    - (살 단계에서 더함) `checks/app/mod.ts`가 `appEngineerCalls(trial, app): CollectedToolCall[]`(그 앱 App Engineer session들의 tool call. 재시도에 밀린 행을 빼고 `call.id` 순)도 내보낸다. calendar-maintain의 진단 check가 쓴다.
    - (살 단계에서 더함) `scenarios/calendar/common.ts`가 `aeFlowChecks(): ProgramCheck[]`(`design-first`, `ae-tested`, `ae-previewed`, `no-coding-call`)와 fixture 조각 `aeFlowSteps(purpose: string): FxStep[]`, `fxDesign(purpose, sections?)`를 내보낸다. calendar-maintain은 `buildAppChecks` 전체(새 앱 몫인 재사용 check와 `app-design`) 대신 이 둘을 쓴다.

## 할 일

근거는 README "정한 것"과 App Engineer 지침 29-77줄이다. 이 task가 쓰는 tool 이름은 기록의 tool 이름(점 이름, `release.prepare`)이다. 진짜 model은 부르지 않는다: `deno task eval`은 `.env`의 key를 읽으므로 쓰지 않고, 아래 "끝남"의 명령(key를 뺀 `deno run`)만 쓴다(AGENTS.md "사람에게 묻는 것").

1. 재료 `calendar-blank@1`을 만든다(README "calendar-user와 calendar-dev의 앱 등록은 새 material `calendar-blank@1`이 한다").
   - 손으로 `content_hash`를 쓰지 않고 `writeMaterial`로 쓴다. 임시 script(commit하지 않는다. 예: `.dev-data/tmp/blank.ts`, 저장소 root에서 `deno run --allow-all .dev-data/tmp/blank.ts`):

     ```ts
     import { MATERIALS_ROOT, writeMaterial } from "../../tests/eval/restore/manifest.ts";
     const apps = [{
       slug: "calendar",
       name: "캘린더",
       description: "일정을 넣고 보고 지우고, 일정 전에 알림을 받는 캘린더 앱",
     }];
     const bytes = new TextEncoder().encode(JSON.stringify(apps, null, 2) + "\n");
     const done = await writeMaterial(MATERIALS_ROOT, "calendar-blank", 1, {
       kind: "app",
       ids: { "캘린더": "app_0000000000000000000000cdr1" },
       needs: [],
       parent: null,
       produced_by: null,
     }, [{ path: "apps.json", bytes }]);
     if (!done.ok) throw new Error(done.error.message);
     ```
   - 정한 것: 앱 등록 값(slug, name, description)과 id는 지운 `calendar-call@3`의 `files/app.json`·`material.json` 그대로다. 이유: 앞 run과 같은 world라야 비교가 된다. description은 사람이 등록할 때 쓴 평범한 말이고 tool 명세가 아니다.
   - 정한 것: `needs`는 빈 목록이다. 이유: 앱 등록은 다른 재료에 기대지 않고, 판을 박아 두면 tr-eval-restore가 올린 `notify-app`·`date-range` 판과 둘 다 되살려 같은 앱 id가 부딪친다. 시나리오의 `save`가 쓰는 자식 재료는 `relations`가 world의 켜진 앱과 package를 needs로 잇는다(`save.ts` 144-163줄).
2. `tests/eval/checks/app/design-doc.ts`(새 file). `DESIGN.md`를 읽는 순수 함수와 `designFirst`. 근거: README "program check 하나를 더한다", 지침 35-38줄.
   1. `DESIGN_SECTIONS`(계약 그대로).
   2. `appEngineerCalls(trial, app)`: `trial.sessions` 가운데 `agent.role === "app_engineer"`이고 `place?.name === app`인 session의 tool call을 모아, 다른 행의 `retry_of`가 가리키는 행을 빼고(`records.ts`의 `effectiveToolCalls`와 같은 규칙) `call.id` 순으로 둔다(tool call id는 ULID라 시간 순이다).
   3. `designText(calls): string | null`: 성공한(`call.outcome?.kind === "success"`) `file.write`·`file.edit` 가운데 path가 source root의 `DESIGN.md`인 것을 차례로 되풀이해 마지막 글을 만든다. `file.write`는 글을 `input.content`로 바꾸고, `file.edit`은 앞 글이 있을 때 `old_string`을 `new_string`으로 바꾼다(`replace_all`이면 모두). 쓴 적이 없으면 `null`이다.
      - 정한 것: source root의 `DESIGN.md`는 앞의 `./`를 뗀 path가 `DESIGN.md`이거나 `/source/DESIGN.md`로 끝나는 path다. 이유: App Engineer의 상대 path 기준은 place 첫 폴더인 앱 source이고(`place-folders.ts` 29-49줄), 앱 source는 `<app 폴더>/source`다(`app-storage.ts` 59-61줄). fixture에는 절대 path가 없다.
      - 정한 것: 기록만 읽는다(fixture에서 right·wrong이 갈려야 한다). `shell.run`으로 쓴 `DESIGN.md`는 세지 않는다. 지침은 file tool로 쓰게 한다(57-58줄). 앱 template에는 `DESIGN.md`가 없어(`packages/core/apps/packages/template/app/`) 새 앱은 `file.write`로 처음 쓴다.
   4. `designSection(text, name): string | null`: `## ` 머리 가운데 앞뒤 공백을 떼고 소문자로 바꾼 글이 `name`의 소문자로 시작하는 첫 머리를 찾아, 그 다음 줄부터 다음 `## `이나 `# ` 머리 앞까지를 돌려준다. 없으면 `null`.
   5. `missingSections(text): string[]`: `## ` 머리를 위에서부터 읽으며 `DESIGN_SECTIONS`를 순서대로 맞춘다(머리 글이 절 이름으로 시작하면 맞음, 대소문자 무시). 사이의 다른 머리는 괜찮다. 순서대로 못 찾은 절 이름을 돌려준다.
      - 정한 것: 절 이름으로 "시작"하면 맞다. 이유: `## Purpose (목적)`, `## Failure Branches`처럼 쓴 머리를 떨어뜨리지 않는다. README가 정한 것은 일곱 절과 그 순서다.
   6. `designFirst(id, { app })`: 기록 check(core를 쓰지 않는다). `appEngineerCalls`에서 첫 `release.prepare`(outcome과 상관없이)를 찾는다. 없으면 떨어진다("release.prepare가 없음"). 그 앞의 call로 `designText`를 만들어 `null`이면 떨어진다("첫 release.prepare 앞에 DESIGN.md를 쓰지 않음"). `missingSections`가 비어야 통과다. reason에 빠진 절을 적는다.
   7. `designOf({ trial, core }, app): Promise<string | null>`: judge 입력이 쓴다. `core === null`(fixture)이면 `designText(appEngineerCalls(trial, app))`, 아니면 `source(core, app)`(`reuse.ts`)의 켜진 release commit에서 `git show <commit>:DESIGN.md`. 없으면(git이 던지면) `null`.
3. `tests/eval/checks/app/design.ts`: `appDesignInput(card, app)`를 설계를 읽게 다시 쓴다. 근거: README "eval의 화면 채점은 코드가 아니라 설계를 본다".
   - 입력 칸 셋: `[CARD]`(card 그대로), `[JOURNEYS]`, `[SCREENS]`. 둘은 `designOf`의 글에서 `designSection(text, "Journeys")`, `designSection(text, "Screens")`이고, 각각 12,000자에서 자른다(`[truncated]`를 붙인다. `judge-input.ts`의 `clip`과 같은 꼴). 글이 없으면 `(DESIGN.md not found)`, 절이 없으면 `(no Journeys section)`·`(no Screens section)`이다.
   - 지운다: `screenSource`, `SOURCE_MAX`, `FILE_MAX`, `SCREEN_FILE`, `PLUMBING`, `appTools` import, 화면 source와 blueprint의 화면 목록 칸(`SCREEN_SOURCE`). 머리 주석을 새 입력으로 고친다.
4. `tests/eval/checks/app/judge-input.ts`: `cardCoveredInput(card, app)`를 다시 둔다(tr-eval-prune-checks가 ticket을 읽던 것을 지웠다).
   - 입력 칸 셋: `[CARD]`, `[BLUEPRINT]`, `[DESIGN]`. BLUEPRINT는 HEAD 62-73줄과 같다(`findApp` → `appTools`의 tool마다 `- <name> (<effect>): <description> input=<JSON>`, `app_connections`마다 `connection: <app> -> <tools>`). fixture(`core === null`)에서는 `(not available)`이다. DESIGN은 `designOf`의 글 전체를 12,000자에서 자른 것이고, 없으면 `(DESIGN.md not found)`다.
5. `tests/eval/checks/app/mod.ts`: `design-doc.ts`의 `designFirst`, `DESIGN_SECTIONS`, `appEngineerCalls`와 `judge-input.ts`의 `cardCoveredInput`을 내보낸다. tr-eval-prune-checks가 남긴 export는 그대로 둔다.
6. criterion 둘. 질문 글은 아래 그대로 쓴다(사람이 이 brief에서 검토한다). `verdicts`는 `cannot_tell`을 품고 `pass`는 그것을 품지 않는다(`loadCriterion`).
   - `tests/eval/criteria/app-design.json`: `n: 2`, `verdicts: ["fits", "wrong_main_screen", "task_missing", "cannot_tell"]`, `pass: ["fits"]`, `question`:

     > The input has three sections. [CARD] is the requirement card a human holds: what the human wants and the answers the human has settled on. [JOURNEYS] and [SCREENS] are those two sections of DESIGN.md, the design the App Engineer wrote before building the app; either may say it is missing. Judge the design as written, not code. First find the main screen: the screen the app opens on (if the design does not say, the first screen it describes). Decide whether it is the screen that well-known apps of the same kind open on. For a calendar that is a grid of dates, such as a month or week view laid out by date; a list, a table, an agenda or a list grouped by day or week is not the main screen of a calendar, even when it shows dates. For other kinds of app, a list or table of records is the main screen only when well-known apps of that kind open on such a list. Then decide whether each thing the person wants on the card (for example adding, viewing and removing, and reminders) has a journey done on the main screen or on a screen reached from it. Something the card leaves to the agent's recommendation does not need to appear. Verdicts: fits = the main screen is the one well-known apps of this kind open on and every wanted thing on the card has a journey from it; wrong_main_screen = the main screen is not the one well-known apps of this kind open on; task_missing = the main screen fits but a wanted thing on the card has no journey or no place on the screens; cannot_tell = the input does not let you decide (for example both sections are missing). The quote must be the part of the input that decided your verdict (for fits and wrong_main_screen, the words that name the main screen and its layout; for task_missing, the card's words for the missing task).

   - `tests/eval/criteria/card-covered.json`: `n: 4`, `verdicts`·`pass`는 지금 그대로(`all`, `some_missing`, `cannot_tell` / `all`), `question`:

     > The input has three sections. [CARD] is the requirement card a human holds: what the human wants and the answers the human has settled on. [BLUEPRINT] is what the finished app declares: each tool with its name, effect, description and input, plus the apps it connects to. [DESIGN] is DESIGN.md, the design the App Engineer wrote for the app; it may say it is missing, or be cut off. Decide whether every concrete requirement on the card (each thing the human wants and each settled answer) is carried into the BLUEPRINT (a tool, an input field, a connection) or into the DESIGN (the model, a journey, a screen, a tool or a rule). Different wording is fine. Something the card leaves to the agent's recommendation does not need to appear. Verdicts: all = every concrete requirement on the card is present; some_missing = at least one requirement is missing, or is carried in the opposite or a changed form; cannot_tell = the input does not let you decide. The quote must be the part of the input that decided your verdict (for some_missing, the card's words that were lost or changed; for all, the blueprint or design part that carries the requirements).

   - 정한 것: app-design의 예는 캘린더를 든다. 이유: 옛 기준(`@1`)이 "a day-by-day agenda with dates"를 맞다고 적어 목록을 통과시켰고(`ISSUE-calendar-without-calendar.md` 4), 이 criterion을 쓰는 시나리오는 캘린더 둘뿐이다. App Engineer 지침에는 캘린더 예를 넣지 않는다(범위 밖).
   - `tests/eval/criteria/mod.ts`의 `INPUT_SECTIONS`(6-14)를 지운다. 읽는 곳이 없고(`git grep -n INPUT_SECTIONS -- tests`가 정의 한 줄) TICKETS·TICKET_GOALS 같은 옛 칸이 남아 있다(planner). 칸 이름은 criterion의 question 글이 정한다.
   - `tests/eval/scenarios/calendar/spec.ts`의 `BUG.description`(162)에서 "and a problem opens"를 지운다(지금 없는 동작. tr-eval-restore가 `bug.json@3`에서도 지운다). calendar helper를 고치는 것은 이 task가 마지막이라(tr-eval-calendar-maintain은 `common.ts`·`spec.ts`를 고치지 않는다) 등록 전에 같이 고친다(planner).
7. `tests/eval/scenarios/calendar/common.ts`: 새 흐름의 기록 check와 fixture 조각을 두고 `buildAppChecks`·`buildAppFixtures`를 다시 쓴다. 근거: 조사 2절 "Expected AE tool sequence", README "program check 하나를 더한다", area의 기대 흐름(App Engineer가 `DESIGN.md`를 쓰고, `shell.run`으로 test하고, `release.prepare`, `preview.*`, `release.activate`, 사람이 동의, `coding_agent`로 call 없음).
   1. 기록 check 셋(이 file 안의 함수. `appEngineerCalls(trial, APP)`만 본다. 성공한 tool call만 세고 `no-coding-call`만 outcome과 상관없이 센다):
      - `ae-tested`: 첫 `release.prepare` 앞에 `input.command`가 `/\bdeno\s+(task\s+)?(test|check)\b/`에 맞는 `shell.run`이 하나 이상. `release.prepare`가 없으면 떨어진다. 근거: 지침 59-61줄.
      - `ae-previewed`: 첫 `release.activate` 앞에 `preview.start`, 그 뒤 `preview.call` 하나 이상, 그 뒤 `preview.stop`이 이 순서로 있다. `release.activate`가 없으면 떨어진다. 근거: 지침 65-69줄.
      - `no-coding-call`: tool `call`의 `input.to.role`이 `"coding_agent"`인 것이 없다. 근거: Router가 그 call을 거절한다(`router.ts` 113-150줄). App Engineer가 직접 짓는다.
   2. `aeFlowChecks(): ProgramCheck[]` = `[designFirst("design-first", { app: APP }), ae-tested, ae-previewed, no-coding-call]`.
   3. fixture 조각(내보낸다):
      - `fxDesign(purpose, sections = DESIGN_SECTIONS): FxStep`: `{ tool: "file.write", effect: "write", input: { path: "DESIGN.md", content } }`. content는 `# 캘린더` 뒤에 `sections`마다 `## <이름>` 머리와 한 줄 본문이다(Purpose 본문은 `purpose`, 나머지는 `fixture`).
      - `aeFlowSteps(purpose): FxStep[]` = `fxDesign(purpose)`, `{ tool: "shell.run", effect: "external", input: { command: "deno task test" } }`, `{ tool: "release.prepare", effect: "write" }`, `preview.start`, `preview.call`, `preview.stop`(셋 다 `effect: "write"`), `{ tool: "release.activate", effect: "write" }`.
   4. `buildAppChecks(card, request): Check[]`(이름과 인자 그대로) = `...aeFlowChecks()`, `appActive("app-active", { app: APP })`, `...reuseChecks(REUSE)`, judge 셋:
      - `card-covered`: premise `["app-active"]`, criterion `card-covered@4`, input `cardCoveredInput(card, APP)`
      - `asked-again`: premise `["design-first"]`, criterion `asked-again@3`, input `askedAgainInput(request)`
      - `app-design`: premise `["app-active"]`, criterion `app-design@2`, input `appDesignInput(card, APP)`
      - 정한 것: asked-again의 premise는 `design-first`다. 이유: 옛 premise `ae-ticket-created`처럼 App Engineer가 짓는 데까지 간 trial만 채점한다.
      - 순서: 기록 check, 읽기만 하는 live check(`app-active`, 재사용), judge(`architecture/eval.md` "check 순서가 실행 순서다").
   5. `buildAppFixtures(purpose): Scenario["fixtures"]`(인자 이름만 바꾼다. 시나리오의 글 그대로 넘긴다):
      - right: `fixtureTrial([fixtureSession(AE, aeFlowSteps(purpose))])`
      - wrong:
        - `[shell.run, release.prepare, fxDesign(purpose), preview 셋, release.activate]`(설계가 prepare 뒤) → fails `["design-first"]`
        - `aeFlowSteps`에서 첫 step만 `fxDesign(purpose, DESIGN_SECTIONS.filter((s) => s !== "Screens"))`로 바꾼 것 → fails `["design-first"]`
        - `[fxDesign(purpose), release.prepare, release.activate]` → fails `["ae-tested", "ae-previewed"]`
        - `aeFlowSteps(purpose)` 뒤에 `{ tool: "call", effect: "read", outcome: "failure", code: "invalid_input", input: { to: { role: "coding_agent", place: { app: APP } }, reply: "conversation", body: purpose } }` → fails `["no-coding-call"]`
   6. 남는 것: `LOPHN`, `AE`, `OP`, `createCalendarOperator`, `eventInCalendar`(다른 시나리오가 쓴다. 고치지 않는다). 머리 주석과 `AE` 위 주석의 ticket·coding agent 말을 지금 흐름으로 고친다.
8. `tests/eval/scenarios/calendar/calendar-user.scenario.ts`, `calendar-dev.scenario.ts`:
   - `n: 2`(registry의 가장 큰 n은 1이다. 이 file이나 common.ts를 고쳤으면 한 번만 올린다).
   - `world: ["notify-app@<n>", "date-range@<n>", "calendar-blank@1"]`. `<n>`은 tr-eval-restore가 보고한 판이다(그 brief대로면 `@3`. 새 판이 없으면 `@2`).
   - `real: [AE]`, `human`·`steps`·`save`는 그대로다(사람 말과 카드를 바꾸지 않는다. README "범위 밖").
   - `limits: { idle_ms: 90 * 60_000 }`. 정한 것: 90분. 이유: App Engineer가 짓는 시나리오는 15~60분 걸리고(README), 옛 coding trial 상한(`CODING_TRIAL_LIMIT_MS`)과 같다. `stuck_ms`는 기본(300 s)이다. 이 시나리오에서는 사람 말 하나만 입력이고 곧 turn이 된다.
   - `checks: buildAppChecks(CARD_*, SAY_*)`, `fixtures: buildAppFixtures("<지금 글 그대로>")`.
   - 머리 주석 2줄의 `calendar-call` 말을 "calendar-blank 재료는 앱 등록만 되살린다"로 고친다.
9. 확인과 등록(아래 "끝남"의 명령). key 없는 runner가 `tests/eval/registry/scenario/{calendar-user,calendar-dev}.json`에 `n: 2`, `registry/criterion/{app-design,card-covered}.json`에 `@2`·`@4`(내용 포함), `registry/material/calendar-blank.json`을 쓴다. 손으로 쓰지 않는다.
   - calendar 폴더의 helper(`common.ts`)를 고치면 `calendar-api`, `calendar-maintain`, `calendar-diagnose`의 hash도 바뀐다(`scenarioHash`). 그 셋은 이 task가 등록하지 않는다. calendar-maintain·calendar-diagnose는 tr-eval-calendar-maintain이 n을 올린다. calendar-api는 tr-eval-scenario-fix(n을 올림)와 이 task가 다 merge된 뒤 lead가 key 없는 runner로 올린다.

## 끝남

- `deno check tests/eval/run.ts tests/eval/scenarios/calendar/*.ts tests/eval/checks/app/*.ts`가 통과한다(`tests/eval`은 `tr-check-enable`까지 `NOT_CHECKED`라 `deno task check`가 보지 않는다). 소유 밖 file의 오류는 고치지 않고 보고한다.
- `deno fmt --check`와 `deno lint`가 바꾼 `.ts` file에서 통과한다(같은 이유로 check가 보지 않는다).
- `deno test --allow-all --no-check tests/eval/restore/materials_test.ts`가 통과한다(새 재료의 hash와 고정 id).
- `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts --scenario calendar-user --scenario calendar-dev`가 "ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다" 줄을 찍고 0으로 끝난다(등록과 fixture right·wrong 확인이 문제 없이 지났다). `deno task eval`은 쓰지 않는다(`.env`의 key로 진짜 model을 부른다).
- world 되살리기: `deno task e2e:deps` 뒤 임시 script(commit하지 않는다)가 둘 다 `ok`를 찍는다.

  ```ts
  // .dev-data/tmp/world.ts. 저장소 root에서 `deno run --allow-all .dev-data/tmp/world.ts calendar-user calendar-dev`
  import { resolveVariant } from "../../tests/eval/experiment/variant/mod.ts";
  import { discoverScenarios } from "../../tests/eval/runner/discover.ts";
  import { type Held, prepareTrialWorld, releaseWorld } from "../../tests/eval/runner/world.ts";
  const variant = await resolveVariant({ current: Deno.cwd() });
  if (!variant.ok) throw new Error(variant.error.message);
  for (const { scenario } of await discoverScenarios()) {
    if (!Deno.args.includes(scenario.id)) continue;
    const held: Held = {};
    try {
      await prepareTrialWorld({ variant: variant.value }, scenario, held);
      console.log(`${scenario.id} ok`);
    } finally {
      await releaseWorld(held);
    }
  }
  ```
- `deno task check`가 통과한다.
- 위험 test: 없음. eval check의 판정은 시나리오마다 right·wrong fixture가 provider 전에 확인한다(`architecture/eval.md` "case마다 right/wrong fixture를 둔다"). 사용자 data, 권한, sandbox 경계를 지키는 코드가 아니다(`write-test`).
- 남지 않음: `grep -rn "calendar-call\|SCREEN_SOURCE\|screenSource\|ticket\|TICKETS\|coding agent" tests/eval/scenarios/calendar/{common,calendar-user,calendar-dev}* tests/eval/checks/app/{design,design-doc,judge-input}.ts tests/eval/criteria/{app-design,card-covered}.json`가 0줄이다.
- `git status`에 `tests/eval/materials/calendar-app-user/`, `calendar-app-dev/`(사람이 commit하지 않은 재료)와 root의 `ISSUE-*.md` 변경이 없다.

## 보고

- 바꾼 file
- 통과한 check(위 명령마다 결과 한 줄)
- 등록할 것: 없음(`deno.json`을 고치지 않는다). registry에 쓴 항목(`scenario` calendar-user@2·calendar-dev@2, `criterion` app-design@2·card-covered@4, `material` calendar-blank@1)을 적는다. key 없는 runner가 소유 밖 registry(`registry/material/notify-app.json`, `date-range.json`, `registry/judge`)를 바꿨으면 되돌리지 말고 적는다
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"들을 그대로 했는지 포함). 실제로 쓴 world 재료 판
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- hash가 바뀐 시나리오: `common.ts`를 고쳐 hash가 바뀐 `calendar-api`(tr-eval-scenario-fix 소유)의 n과 registry를 누가 맞춰야 하는지 적는다
- 문서(lead): `architecture/eval.md`의 `app-design`(설계를 읽는다), `card-covered`(DESIGN.md), `design-first` check, 재료 목록의 `calendar-blank@1`, 시나리오 표의 화면 judge 줄
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"(예: `shell.run`으로 쓴 DESIGN.md를 `design-first`가 세지 않는 것)

## lead가 더함

- tr-eval-restore가 merge됐다. 새 판은 다섯 모두 `@3`이다: `notify-app@3`, `date-range@3`(needs `notify-app@3`), `calendar-app@3`, `calendar-app-bug@3`(parent `calendar-app@3`), `calendar-data@3`. 옛 판은 남아 있다. world는 `@3`을 쓴다. 세 world는 가짜 model로 되살아나고 앱의 `deno task check`가 지나는 것을 그 task가 봤다(bug world의 `deno task test`는 일부러 떨어진다).
- tr-eval-human도 merge되어 eval이 import된다. 확인은 늘 `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts …`다. L4-new는 lead가 n 7로 등록했다.
