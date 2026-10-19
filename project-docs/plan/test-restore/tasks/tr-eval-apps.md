# tr-eval-apps

앱 eval 자료를 새 판으로 만든다: notify-app, calendar-app, calendar-app-bug의 앱 source를 지금 선언(`tools[]`, `domain`, `public`), SDK 이름, App Engineer 문구로 다시 쓴 새 판과, 그 셋을 needs로 가리키는 재료의 새 판이다. 옛 판은 지우지 않는다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/materials/notify-app/2/`
  - `tests/eval/materials/date-range/2/`
  - `tests/eval/materials/calendar-call/3/`
  - `tests/eval/materials/calendar-app/2/`
  - `tests/eval/materials/calendar-app-bug/2/`
  - `tests/eval/materials/calendar-data/2/`
  - `tests/eval/restore/{apps,active-app,app-data,package,call,deliver,save}.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/eval.md`(흐름, "자리"의 `tests/eval/materials`·`tests/eval/restore`, "버전은 hash로 고정한다"), `project-docs/architecture/app-call.md`("지키는 것"의 tool 선언 칸), `project-docs/architecture/domain.md`(`app.create`가 앱 slug 이름의 domain을 만든다, "다른 domain의 비공개 tool은 보이지 않는다", "domain의 일을 받는 쪽")
  - 이슈: `project-docs/issues/eval.md`의 "eval materials의 앱 source가 옛 app-api 선언과 SDK 이름을 쓴다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-spi`(blueprint 선언)·`sdk-api`(`@lophn/cap-tool`), `project-docs/module-catalog.yaml`의 `tests`
  - 본보기(앱 source): `packages/core/apps/packages/template/app/`의 `blueprint.ts.tmpl`, `main.ts.tmpl`, `deno.json.tmpl`, `AGENTS.md.tmpl`, `src/tools.ts.tmpl`, `src/screens/items/bridge.ts.tmpl`, `tests/blueprint_test.ts.tmpl`, `tests/wording_test.ts.tmpl`
  - SDK: `packages/sdk/cap-tool/mod.ts`(`tool`, `ToolRejection`, `readResult`, `registeredTools`, `connectTools`, `ToolClient`), `packages/sdk/cap-tool/connect.ts`(`ToolClient.callTool`)
  - protocol: `packages/protocol/apps/blueprint/tools.ts`(`validateScreensAndTools`), `packages/protocol/apps/blueprint/uses.ts`(`app_connections` 항목 `{app, tools, reason}`)
  - 옛 판: `tests/eval/materials/{notify-app,calendar-app,calendar-app-bug,date-range,calendar-data}/1/`, `tests/eval/materials/calendar-call/2/`
  - 되살리기: `tests/eval/restore/manifest.ts`(`loadMaterial`, `orderMaterials`), `tests/eval/restore/hash.ts`(`contentHash`), `tests/eval/restore/materials_test.ts`, `tests/eval/runner/world.ts`(`prepareTrialWorld`, `releaseWorld`), `tests/eval/experiment/variant/mod.ts`(`resolveVariant`)
  - 받는 쪽: `packages/core/agent-roles/place/session-directory.ts`(App Engineer를 `place.app` 이름으로 푼다), `packages/core/agent-roles/tool-lists.ts`(`ROLE_WRITE_TOOLS`: `ticket.*`은 App Engineer만), `tests/e2e/registration_test.ts`의 `lophn-registers-then-calls`(lophn → App Engineer `call`의 `to` 모양)
- 계약:
  - 쓰는 것: `packages/protocol/apps/blueprint/tools.ts`(`validateScreensAndTools`), 앱 template `packages/core/apps/packages/template/app/`(선언·SDK 이름·문구의 본보기)
  - 내놓는 것(`tr-eval-calendar`·`tr-eval-checks`가 기댄다):
    - 판과 needs: `notify-app@2`(needs 없음), `date-range@2`(needs `notify-app@2`), `calendar-call@3`(needs `notify-app@2`, `date-range@2`), `calendar-app@2`(needs `notify-app@2`, `date-range@2`), `calendar-app-bug@2`(parent `calendar-app@2`, needs 같음), `calendar-data@2`(needs `calendar-app@2`)
    - 고정 앱 id는 1/과 같다. tool 이름은 1/의 `app_api` key 그대로다. tool의 `domain`은 앱 slug(`notify`, `calendar`)다
    - 재료 kind 목록(`tests/eval/types.ts`)은 바꾸지 않는다

## 할 일

뼈대가 정한 것:
- 왜 넷이 아니라 여섯인가: 재료의 needs는 판에 박혀 있다. `date-range@1`·`calendar-call@2`·`calendar-data@1`이 옛 판을 needs로 가리켜, 새 판 world에 옛 앱이 같은 고정 id로 한 번 더 되살아난다. 그래서 내용이 같아도 needs만 바꾼 새 판을 만든다.
- 다른 앱(calendar)이 부르는 notify의 tool은 다른 domain이므로 `public: true`여야 보인다(`project-docs/architecture/domain.md`).
- `tests/eval/registry/`는 고치지 않는다(registry는 run이 쓴다. 지금 registry는 file의 n보다 뒤에 있고 그 틈은 `tr-eval-checks`가 다룬다).
- `deno task eval`·`eval:experiment`는 돌리지 않는다. `.env`의 key를 읽어 진짜 provider를 부를 수 있다(AGENTS.md "사람에게 묻는 것"). 새 판이 되살아나는지는 진짜 model 없는 되살리기(dry run)로 본다.

1. **판 쓰는 길.** 새 판마다 옛 판의 `files/`를 `cp -r`로 옮겨 시작하고(옛 판은 한 byte도 고치지 않는다), 고친 뒤 `material.json`을 program으로 쓴다. worktree 안 `.dev-data/tr-eval-apps/hash.ts`(git 밖, commit하지 않는다)가 `files/` 아래 모든 file을 `{path, bytes}`로 읽어 `contentHash`(`tests/eval/restore/hash.ts`)를 재고, `JSON.stringify(v, null, 2) + "\n"`로 칸 순서 `kind, ids, needs, parent, produced_by, content_hash`의 `material.json`을 쓴다. `kind`·`ids`는 옛 판 그대로, `produced_by`는 `null`이다. file을 고치면 hash를 다시 잰다. 근거: eval.md "버전은 hash로 고정한다", `manifest.ts`의 `verifyMaterial`.
2. **`notify-app/2`**(kind `active_app`, needs `[]`, parent `null`). 1/에서 아래만 바꾼다. 업무 동작(handler, DB, 화면 모양, problem 이름)은 그대로다.
   - `source/blueprint.ts.tmpl`: `app_api` → `tools`. 항목마다 `key` → `name`(값 그대로 `notify.list`, `notify.schedule`), `label` → `title`, `input` → `inputSchema`, `project_scope`를 지우고 `public: true`, `domain: "notify"`를 더한다(알림 앱은 남이 부르라고 있는 앱이다. `app.json`의 description). `sdk_dependencies`의 `@lophn/cap-app-api` → `@lophn/cap-tool`. 주석의 app-api → tool(template 주석과 같게).
   - `source/deno.json.tmpl`: import map의 `@lophn/cap-app-api` 줄 → `"@lophn/cap-tool": "lophn-sdk:@lophn/cap-tool@1.0.0/mod.ts"`.
   - `source/src/app-api.ts.tmpl`을 지우고 `source/src/tools.ts.tmpl`로 옮긴다: `appApi` → `tool`, `AppApiRejection` → `ToolRejection`, `registerAppApis` → `registerTools`, import는 `@lophn/cap-tool`. 첫 줄 주석은 template `src/tools.ts.tmpl`의 것.
   - `source/main.ts.tmpl`: template `main.ts.tmpl` 그대로.
   - `source/tests/blueprint_test.ts.tmpl`: template의 것 그대로(lophn이 만든 file이다).
   - `source/tests/wording_test.ts.tmpl`: 첫 주석과 끝 test를 template처럼(`tools`, `tool.name`, `tools[0].title`). 나머지(reminders key)는 그대로.
   - `source/tests/reminders_test.ts.tmpl`: SDK 이름(`@lophn/cap-tool`, `ToolRejection`, `../src/tools.ts`)만. `date_range_test.ts.tmpl`은 그대로.
   - `source/src/screens/reminders/bridge.ts.tmpl`: `call(api, …)` → `callTool(tool, …)`(template `bridge.ts.tmpl`), 주석의 app-api → tool.
   - `source/AGENTS.md.tmpl`: template `AGENTS.md.tmpl`에서 `{{TITLE}}` → `알림`, `{{APP}}` → `notify`만 바꾼 것(App Engineer 문구와 "tool 선언에는 tool마다 `domain`" 줄이 여기서 온다).
   - `app.json`과 그 밖의 file은 그대로.
3. **`date-range/2`**(kind `package`): `publish.json` 그대로, needs `["notify-app@2"]`.
4. **`calendar-app/2`**(kind `active_app`, needs `["notify-app@2", "date-range@2"]`, parent `null`). 2의 바꿈을 같게 하고 더해서:
   - blueprint `tools`: `event.list`·`event.add`·`event.remove`, `public: false`(template 기본. 이 앱의 tool은 같은 domain의 agent만 부른다), `domain: "calendar"`. `app_connections`: `[{ app: "app_0000000000000000000000ntfy", tools: ["notify.schedule"], reason: text["events.summary.notify-reason"] }]`. `sdk_dependencies`의 `@me/date-range`는 그대로.
   - `src/app-api.ts.tmpl` → `src/tools.ts.tmpl`: 위 이름 바꿈 + `connectAppApi(NOTIFY_APP, ["notify.schedule"])` → `connectTools(NOTIFY_APP, ["notify.schedule"])`, `Deps.notify`는 `Pick<ToolClient, "callTool">`.
   - `src/notify.ts.tmpl`: `AppApiClient` → `ToolClient`(`@lophn/cap-tool`), `client.call(…)` → `client.callTool("notify.schedule", { title, at })`. 주석의 app-api → tool.
   - `tests/events_test.ts.tmpl`: `fakeNotify`가 `callTool`을 준다, `ToolRejection`, `../src/tools.ts`.
   - `src/screens/events/bridge.ts.tmpl`: `callTool`.
   - `AGENTS.md.tmpl`: template에서 `캘린더`·`calendar`.
   - 지키는 것: handler가 여는 problem 이름(`event_input_invalid`, `notify_call_failed`, `store_unavailable`)과 응답 모양(`{id, title, start}`, `reminder`, `rows`, `{id, removed}`)은 바꾸지 않는다. `tests/eval/scenarios/calendar/spec.ts`의 `OBSERVE`·`MVP_SCRIPT`·`OLD_SCRIPT`·`SEED_CALLS`가 기댄다. `connectTools`와 `"notify.schedule"`은 테스트가 아닌 같은 file(`src/tools.ts`)에 있다(`tests/eval/checks/app/reuse.ts`의 `reuse-imports`).
5. **`calendar-app-bug/2`**(kind `active_app`, parent `calendar-app@2`, needs `["notify-app@2", "date-range@2"]`). `calendar-app/2/files`에 1/과 같은 bug만 심는다: `source/src/events.ts.tmpl`의 `RANGE_RULES` type을 `Record<string, { offset: number }>`로, `next_week` 줄을 뺀다. `bug.json`은 1/ 그대로. 확인: `diff -r tests/eval/materials/calendar-app/2/files tests/eval/materials/calendar-app-bug/2/files`가 `bug.json`과 그 두 줄뿐이다.
6. **`calendar-data/2`**(kind `app_data`): `calls.json` 그대로, needs `["calendar-app@2"]`.
7. **`calendar-call/3`**(kind `call`, needs `["notify-app@2", "date-range@2"]`). `app.json` 그대로. `call.json`은 둘을 바꾼다(뼈대의 "needs만"에서 벗어남. 보고의 "정한 것"에 적는다):
   - `to`: `{ "role": "app_engineer", "place": { "app": "캘린더" } }`. Project Manager는 `ticket.create`가 없고(`tool-lists.ts`), 앱의 일은 App Engineer가 받는다(domain.md "domain의 일을 받는 쪽").
   - `body`의 "app-api (아래 key와 입력·출력으로 만들어 주세요." → "tool (아래 이름과 입력·출력으로 만들어 주세요.". 나머지 글자는 그대로.
8. **되살리기 code**(근거: eval.md "제품 route로 되살린다").
   - `deliver.ts`: `CallSpec.to`를 `{ role: "app_engineer"; place: { app: string } }`로 바꾸고, 미리 보는 것을 `ctx.world.apps[spec.to.place.app]`로 바꾼다(오류 글 "app … not restored"). fake lophn의 `call` 입력은 `spec.to` 그대로다.
   - `call.ts`: 주석을 "받는 쪽은 그 앱의 App Engineer(`to.place.app`)"로.
   - `apps.ts`: `restoreAppProject`는 export와 동작을 그대로 둔다(operators-home, `PM_ledger`, T19-op의 exclude가 `<slug>-project` 이름에 기댄다). 주석만 지금 모델로 고친다: 앱은 project에 묶이지 않는다. 이것은 사람이 앱 옆에 둔 보통 project이고 다른 시나리오가 `<slug>-project` 이름으로 그 Project Manager를 가리킨다.
   - `active-app.ts`: `restoreAppProject` 부르는 줄은 그대로 둔다(위 이유). 주석만.
   - `package.ts`: 주석과 변수의 Project Manager → App Engineer(`pm` → `ae`). 동작은 그대로다(이미 App Engineer session이 publish한다).
   - `save.ts`: 고치지 않는다. `saveCall`을 App Engineer 받는 쪽으로 바꾸는 일은 뒤 task `tr-eval-app-engineer`의 몫이다.
   - `app-data.ts`: 고치지 않는다(`calls.json`의 `api` 칸은 재료 내용이라 이름을 바꾸지 않는다).
9. **dry run**(진짜 model 없이 새 판이 되살아나는지). worktree에서 먼저 `deno task e2e:deps`를 돈다(`appCoreEnv`가 `.dev-data/e2e/deno-dir`를 요구한다). `.dev-data/tr-eval-apps/dry-run.ts`(git 밖)를 `deno run --allow-all .dev-data/tr-eval-apps/dry-run.ts`로 돈다(`--env-file`을 주지 않는다). script는 `resolveVariant({ current: <worktree> })`의 variant로 world마다 `prepareTrialWorld({ variant }, { world } as Scenario, held)` → 아래 확인 → `finally`에서 `releaseWorld(held)`다. 확인은 `callApi`·`findApp`(`tests/eval/checks/app/live.ts`), `appTools`(`packages/protocol/apps/blueprint/read.ts`), `callRead`(`packages/protocol/lophn-agent/mod.ts`)로 한다.
   - `["calendar-app@2", "calendar-data@2"]`: 되살리기 ok. `app.tools`에서 알림의 tool 둘이 `public: true`·`domain: "notify"`, 캘린더의 tool 셋이 `domain: "calendar"`. 캘린더 `event.add`(`{ title: "확인", start: { year: 2099, month: 7, day: 1, hour: 9, minute: 0 } }`)가 `succeeded`이고 결과의 `reminder`가 `"scheduled"`(앱 → 앱 `connectTools` 길). `event.list { range: "all" }`에 calendar-data의 일정 셋이 있다.
   - `["calendar-app-bug@2"]`: 되살리기 ok. `event.list { range: "next_week" }`는 `failed`, `{ range: "this_week" }`는 `succeeded`.
   - `["notify-app@2", "date-range@2", "calendar-call@3"]`: 되살리기 ok. `deliverCall(ctx, "calendar-call@3")`가 ok이고, `callRead`의 `to.agent`가 `{ role: "app_engineer", app: "app_0000000000000000000000cdr1" }`이며 `receiver_session`이 있다.
   - 끝난 뒤 `/tmp/lophn-e2e-*`가 남지 않는다.

## 끝남

- `deno task check:full`이 통과한다(`tests/eval/restore/materials_test.ts`가 새 판 여섯의 hash, needs, parent를 본다).
- dry run(할 일 9)의 세 world가 모두 되살아나고 확인이 맞는다.
- 위험 test: 없음(새 판은 이미 있는 `materials_test.ts`가 본다).
- 남지 않음: `grep -rn "app-api\|app_api\|appApi\|AppApi\|cap-app-api\|project_scope\|registerAppApis" tests/eval/materials/{notify-app,calendar-app,calendar-app-bug}/2 tests/eval/materials/calendar-call/3`가 0줄이다.
- 옛 판이 그대로다: `git diff --stat -- tests/eval/materials/*/1 tests/eval/materials/calendar-call/2`가 비었다.
- `deno task eval`, `eval:experiment`, `eval:gate`를 돌리지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- dry run 결과: world마다 한 줄(되살리기 시간, 확인 결과)
- 등록할 것: 없음일 것이다(registry는 run이 쓴다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것. `calendar-call@3`의 `call.json`을 바꾼 것과 그 이유를 적는다
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
