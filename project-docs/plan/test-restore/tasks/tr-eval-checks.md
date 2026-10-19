# tr-eval-checks

`issues/eval.md`의 정한 것 가운데 시나리오 폴더 `lophn/`과 check·variant·registry 쪽을 고친다: `callAfterAppCreate`와 그 fixture를 새 `app.create` 모양에 맞추고 L4-new가 새 앱 판을 가리키게 한다, L7 `read-all`을 앱 상태 읽기 하나(`app.get` 또는 `app.list`)로 넓힌다, variant가 symlink 대신 `deno task e2e:deps`를 돈다, registry가 file의 n보다 뒤에 있어 run이 멈추는 틈을 없앤다.

- 단위: eval (wave 1)
- 선행: tr-eval-apps. L4-new의 world가 `notify-app@2`·`date-range@2`를 가리킨다.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/lophn/`
  - `tests/eval/checks/{calls,calls_test,fixtures,tools,mod}.ts`
  - `tests/eval/experiment/variant/`
  - `tests/eval/versions/{registry,versions_test}.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/eval.md`(흐름, "버전은 hash로 고정한다", "variant의 core는 그 checkout에서", "gate는 싼 것부터"), `project-docs/architecture/domain.md`("앱은 domain이 0개가 되지 않는다": `app.create`가 같은 tx에서 앱 slug 이름의 domain을 만든다)
  - 이슈: `project-docs/issues/eval.md`의 "variant의 e2e deno-dir symlink로 gate의 앱 E2E가 모두 떨어진다", "L7의 `read-all`은 `app.get` 이름만 받는다"(둘 다 정한 것)
  - 제품 코드(고치지 않는다):
    - `packages/core/apps/agent-tools/app.ts`의 tool `app.create`: 입력 `{name, purpose}`, slug는 tool이 만든다, 결과는 `fitted("registered app <id>", <app record>)`라 `content.id`가 새 앱 id다
    - `packages/core/lophn-agent/tools/call/target.ts`의 `named`: `{role: "app_engineer", place: {app: <앱 이름>}}`을 `{role: "app_engineer", app: <id>}`로 푼다
    - `packages/core/agent-roles/roles/lophn/prompt.md`: "For a new app, register it first with `app.create` … An app does not belong to a project, so you do not choose one", 앱 일은 "that app's App Engineer"에게, 앱 상태는 `app.get`, `problem.list`·`problem.get`, `ticket.list`로 읽는다
    - `packages/core/agent-roles/tool-lists.ts`: lophn의 읽기 tool에 `app.list`·`app.get`·`problem.list`·`problem.get`·`ticket.list`가 있다
  - eval 코드: `tests/eval/runner/register.ts`(`registerAll`이 시나리오·재료 n을 `registerAuthored`로 올린다), `tests/eval/versions/authored.ts`(`scenarioHash`: 시나리오 file + 같은 폴더 helper file), `tests/eval/runner/world.ts`(`prepareTrialWorld`, `releaseWorld`, `bootOptionsOf`), `tests/eval/runner/discover.ts`(`discoverScenarios`), `tests/eval/checks/records.ts`(`effectiveToolCalls`, `sentCalls`), `tests/eval/restore/save.ts`(`saveCall`, tr-eval-apps 소유), `tests/support/coding/deps.ts`(`appCoreEnv`, `e2eDenoDir`), `tests/support/coding/prepare-deps.ts`
  - module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - test 기준: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `tr-eval-apps`의 판, agent tool `app.create`(입력 `{name, purpose}`, project 없음. 받는 쪽은 그 앱의 App Engineer `{role: "app_engineer", app}`)
  - 내놓는 것: `tests/eval/checks/mod.ts`의 `fixtureTrial`·`fixtureSession`·`toolCount`·`FxStep`·`callCount` 모양은 바꾸지 않는다(`tr-eval-calendar`·`tr-eval-operator`가 쓴다). `fixtureAppCreate`는 `lophn/` 시나리오만 쓴다

## 할 일

1. registry 틈을 없앤다(`tests/eval/versions/registry.ts`의 `registerAuthored`).
   - 지금은 새 n이 `maxN(entries) + 1`이어야 받는다. registry는 시나리오 대부분이 1(`L4-new`만 1·2)인데 file은 2·3이고, `tax-kinds`는 등록된 적이 없고 `operators-home`은 1만 있다(file은 2·3). 그래서 첫 run이 "n은 X여야 한다"로 멈춘다.
   - 정한 것(planner): 새 n이 `max`보다 크면 받는다(빈 n을 건너뛴다). `max` 이하의 새 n은 지금처럼 `invalid_input`이고 message는 "n은 {max}보다 커야 한다"로 고친다. 같은 n의 hash가 다르면 `conflict`("n을 올려라")는 그대로다.
   - `tests/eval/versions/versions_test.ts`의 첫 test 표를 새 규칙으로 고친다: `(1,x)` 새로 올림, `(1,x)` 그대로, `(1,y)` conflict, `(3,z)` 새로 올림(2를 건너뜀), `(2,w)` invalid_input(max 3 이하), `(3,q)` conflict. test 이름도 맞춘다.
   - `tests/eval/registry/`의 data는 고치지 않는다.
2. variant가 symlink 대신 `deno task e2e:deps`를 돈다(`tests/eval/experiment/variant/prepare.ts`의 `prepareVariant`, 근거: 이슈의 정한 것).
   - `${path}/.dev-data/e2e/deno-dir`를 지금 checkout 것에 symlink로 잇는 줄을 지운다.
   - 대신 그 폴더가 비었으면(`io.nonEmpty`) variant root를 cwd로 `[Deno.execPath(), "task", "e2e:deps"]`를 `io.run`으로 돌린다. 이미 차 있으면 건너뛴다(함수 머리의 "이미 한 일이면 다시 해도 같다"). 실패하면 `err({code: "unavailable", message: "e2e:deps가 실패했다: <stderr>"})`.
   - 순서: worktree-prep → e2e:deps → core 입구 cache. cache 단계의 `DENO_DIR: currentDir`는 그대로 둔다. trial의 core는 지금 checkout의 `appCoreEnv()`(지금 checkout의 `.dev-data/e2e/deno-dir`)로 뜨기 때문이다(`tests/eval/runner/world.ts`의 `bootOptionsOf` → `restoreCoreEnv`). variant 폴더는 gate의 e2e(variant의 `tests/support/coding/deps.ts`)만 읽는다.
   - 더 쓰이지 않는 `VariantIo.symlink`·`VariantIo.mkdir`를 `io.ts`(type과 `denoIo`)와 `variant_test.ts`의 `fakeIo`에서 지운다. 주석의 symlink 설명을 새 길로 고친다.
3. `callAfterAppCreate`(`tests/eval/checks/calls.ts`)를 새 `app.create`에 맞춘다.
   - 만든 앱: 성공한 `app.create` tool call(`effectiveToolCalls`)의 output `content.id`(string). input의 `project`는 더 보지 않는다.
   - 맞는 call: 그 tool call 뒤(`c.tool_call > made.tool_call`)에 보낸 `sentCalls` 가운데 `reply`가 `opts.reply`이고 `receiver`가 `{role: "app_engineer", app: <만든 id>}`인 것.
   - reason 글과 함수 위 주석을 "새 앱의 App Engineer"로 고친다.
4. fixture(`tests/eval/checks/fixtures.ts`, export는 `mod.ts`)를 고친다.
   - `fixtureAppCreate(name: string): FxStep`. input `{name, purpose: \`${name} fixture\`}`, output은 지금처럼 `{status: "success", content: {id: \`app_fx_${name}\`}}`.
   - `FixtureCall.to`를 `Participant | {role: "app_engineer"; place: {app: string}}`로 넓힌다(type 이름 예: `FixtureTarget`, `mod.ts`에서 type export). `refOf`는 App Engineer를 `{role: "app_engineer", app: \`app_fx_${place.app}\`}`로 만든다(`fixtureAppCreate`의 id와 같은 규칙이라 L4-new right fixture가 맞는다). `placeName`은 project만 다루므로 App Engineer에는 `null`이다.
   - 정한 것(planner가 받아들였다): `tests/eval/types.ts`의 `Participant`(App Engineer를 뺀다)는 이 task 소유가 아니라 고치지 않고 fixture 입력만 넓힌다. `fixtureSession(agent: Participant, steps: FxStep[])`, `fixtureTrial`, `FxStep`의 tool 꼴은 그대로이고 call 꼴의 `to`만 넓어지므로 calendar·operator 시나리오는 그대로 type check를 지난다. 뒤 task `tr-eval-app-engineer`가 `Participant`에 App Engineer를 들이고 이 따로 둔 type을 `Participant`로 접는다.
5. `toolsCalled`(`tests/eval/checks/tools.ts`)를 `tools: (string | string[])[]`로 넓힌다. 배열 항목은 "그 가운데 하나가 불렸다"이다. reason은 빠진 묶음을 `app.get|app.list`처럼 적는다. 지금 쓰는 곳은 L7뿐이다.
6. L7(`tests/eval/scenarios/lophn/L7.scenario.ts`, 근거: 이슈의 정한 것):
   - check: `toolsCalled("read-all", [["app.get", "app.list"], "problem.list", "ticket.list"])`. `noWriteTools("no-write")`는 그대로.
   - fixture: right는 `app.get` 판과 `app.list` 판 둘. wrong은 `ticket.list`가 빠진 것(read-all), 앱 상태 읽기가 없는 것(read-all), 읽기에 `fixtureAppCreate("가계부2")`가 섞인 것(no-write).
   - n 2 → 3.
7. L4-new(`tests/eval/scenarios/lophn/L4-new.scenario.ts`):
   - world: `["notify-app@2", "date-range@2"]`. `calendar-home@1`은 뺀다. 앱이 project에 묶이지 않아 고를 빈 project가 없다(lophn prompt).
   - 받는 쪽: 이 file 안에 `{role: "app_engineer", place: {app: "캘린더"}}`를 둔다. `common.ts`에 두지 않는다(helper를 고치면 폴더 모든 시나리오의 n이 오른다).
   - fixture right: `fixtureAppCreate("캘린더")` 뒤 그 App Engineer에게 `reply: "none"`, `body: BODY`. wrong: app.create만(call-after-app-create), app.create 없이 `PM_notify`에게(app-create-once, call-after-app-create), app.create 뒤 다른 앱의 App Engineer(`place: {app: "알림"}`)에게(call-after-app-create).
   - 머리 주석을 "새 앱은 `app.create`로 만들고(project를 고르지 않는다. 앱 이름의 domain이 같이 생긴다) 그 앱의 App Engineer에게 요구를 빠짐없이 넘긴다"로 고친다. REQUEST·BODY·`save`는 그대로다. `save`가 부르는 `saveCall`(`restore/save.ts`)을 App Engineer 받는 쪽으로 고치는 일은 뒤 task `tr-eval-app-engineer`로 옮겼다. 그때까지 L4-new의 `save`는 후보를 쓰지 못한다(진짜 run에서만 돌아 이 task의 확인에는 걸리지 않는다).
   - n 3 → 4.
8. L1·L4-app: `fixtureAppCreate(name, project)` 부르는 곳만 `fixtureAppCreate(name)`으로 고치고 n 2 → 3. 다른 것은 바꾸지 않는다. `common.ts`, L5, L6, L8, T19-lophn은 손대지 않는다(n 그대로).
   - 알고 둔다: L4-app·L8·T19-lophn은 앱 일을 `<slug>-project`의 Project Manager에게 보내는지 잰다. 지금 lophn prompt는 앱 일을 App Engineer에게 보낸다. 그쪽으로 고치는 일은 뒤 task `tr-eval-app-engineer`가 한다(참가자 type, `agentRefOf`, 수집의 place 이름이 같이 바뀌어야 한다). 이 task는 하지 않는다.
9. 문서: `architecture/eval.md`에 이 task가 바꾼 동작(registry n 규칙, variant 준비)과 어긋나는 줄은 없다(확인함). 고치지 않는다. 자료 판 줄은 lead가 끝에 고친다.

## 끝남

- `deno task check:full`이 통과한다.
- 위험 test: 없음. 새로 쓰지 않는다. `versions_test.ts`의 `registerAuthored` 표만 새 규칙으로 고친다. 같은 n의 다른 내용을 거절하는 줄은 run 비교를 지키므로 남긴다.
- 진짜 model 없는 확인. git 밖 일회용 script(예: `.dev-data/plan-test-restore/tr-eval-checks-check.ts`, `deno run --allow-all`)로 돌리고 commit하지 않는다.
  1. `discoverScenarios()`의 **모든** 시나리오에 `validateFixtures`(`tests/eval/checks/mod.ts`)가 `{ok: true, problems: []}`다. fixture builder를 바꿨으므로 다른 폴더도 본다.
  2. `tests/eval/registry/`를 임시 폴더로 복사한다. 모든 시나리오(`scenarioHash(path)`)와 그 world의 재료(`orderMaterials(MATERIALS_ROOT, scenario.world)`의 `manifest.content_hash`)를 `registerAuthored(<사본>, ref, hash)`로 올려 실패가 0개다. 옛 규칙이면 떨어지던 것(예: registry에 1만 있는 `operators-home@3`, 이 task가 올린 `L1@3`)이 들어 있어야 확인이 된다. 진짜 `tests/eval/registry/`에는 쓰지 않는다.
  3. `deno task e2e:deps`를 돌린 뒤(notify-app@2가 active_app이라 `appCoreEnv`가 deno-dir을 요구한다), `resolveVariant({current: REPO_ROOT})`(`tests/eval/experiment/variant/mod.ts`, `REPO_ROOT`는 `tests/eval/runner/paths.ts`)로 L4-new와 L7을 `prepareTrialWorld`로 되살리고 `releaseWorld`로 정리한다. 둘 다 던지지 않고, L4-new는 `ctx.world.apps["알림"]`이 있다. 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 돌리지 않는다: `deno task eval`, `eval:experiment`(`.env`를 읽어 진짜 provider를 부를 수 있다), `eval:gate`, `tests/eval/run.ts`(셋 다 진짜 registry에 쓴다).
- 남지 않음: `grep -rn "\.symlink\|io\.mkdir" tests/eval/experiment/variant`가 0줄이다. `grep -rn 'fixtureAppCreate("[^"]*", ' tests/eval`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check와 위 확인 script의 결과(시나리오 수, registry 사본에 올린 수, dry run한 시나리오)
- 올린 시나리오 n: L1 3, L4-app 3, L4-new 4, L7 3
- 등록할 것: 없음이 기대값이다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다. `FixtureCall.to`를 넓힌 것이 calendar·operator 쪽을 깨면 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 넷을 적는다.
  - L4-app·L8·T19-lophn이 Project Manager 쪽 길을 잰다(할 일 8. `tr-eval-app-engineer`가 고친다)
  - L4-new의 `save`는 `saveCall`이 App Engineer 받는 쪽을 찾지 못해 후보를 쓰지 못한다(할 일 7. `tr-eval-app-engineer`가 고친다)
  - symlink가 이미 있는 옛 variant worktree는 `nonEmpty`가 참이라 e2e:deps를 건너뛴다. 그 worktree는 지우고 다시 만든다
  - 진짜 model run은 돌리지 않았다
