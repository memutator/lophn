# tr-eval-app-engineer

eval이 되살린 설계를 재게 한다: 앱의 일은 그 앱의 App Engineer가 받는다. App Engineer를 eval 참가자로 다시 들이고(참가자 type, `agentRefOf`, 수집의 place 이름, fixture, 버전의 role prompt), 앱 일을 아직 `<slug>-project`의 Project Manager에게 보내는 시나리오를 App Engineer 쪽으로 고친다.

- 단위: eval (wave 1)
- 선행: tr-eval-checks, tr-eval-apps, tr-eval-operator. 셋이 고친 file(fixture, variant, `lophn/`·`operator/` 시나리오, `restore/save.ts`)을 이어 고친다.
- 소유(이 task만 고친다):
  - `tests/eval/types.ts`
  - `tests/eval/restore/{mod,save}.ts`
  - `tests/eval/collect/{read,read_test}.ts`
  - `tests/eval/checks/{records,fixtures,mod}.ts`
  - `tests/eval/versions/{components,files}.ts`
  - `tests/eval/experiment/variant/texts.ts`
  - `tests/eval/scenarios/{lophn,operator,project-manager,app-engineer}/`
- 읽을 것:
  - architecture: `project-docs/architecture/eval.md`("버전은 hash로 고정한다", "run은 진짜 model이 본 것만 남긴다", 판단 case 줄), `project-docs/architecture/domain.md`("domain의 일을 받는 쪽은 그 그릇의 PM(project)이나 App Engineer(app)다")
  - role prompt(고치지 않는다): `packages/core/agent-roles/roles/lophn/prompt.md`(앱 일은 "that app's App Engineer"에게, Operator 요청은 "that place's Project Manager (project) or App Engineer (app)"에게), `project-manager/prompt.md`("Work on an app … goes to that app's App Engineer", "If the project has no app yet … Give it to lophn"), `operator/prompt.md`("If you meet a bug … in an app … Give it to that app's App Engineer"), `app-engineer/prompt.md`("Reuse across apps … go to lophn with `call`", `ticket.create`·`package.publish`가 App Engineer의 것), `packages/core/agent-roles/roles/prompts.ts`(`rolePrompt`가 `app_engineer`를 안다), `packages/core/agent-roles/tool-lists.ts`(`ROLE_WRITE_TOOLS`)
  - protocol(고치지 않는다): `packages/protocol/lophn-agent/places.ts`(`agentRefSchema`의 `{role: "app_engineer", app}`), `calls.ts`(`NamedAgent`의 `place: {app}`), `packages/core/lophn-agent/tools/call/target.ts`(`named`: App Engineer를 앱 이름으로 푼다), `packages/protocol/apps/apps.ts`(`appList`, cursor로 page)
  - 본보기: App Engineer를 Project Manager로 접은 commit `c55d0f954`. 그 앞 판(`git show c55d0f954^:<path>`)에 이 task가 되살릴 모양이 있다: `tests/eval/types.ts`(`Participant`의 `role: Role`, `PlaceName`의 `kind: "app" | "project"`), `tests/eval/collect/read.ts`(`readNames`의 `app` map, `placeOf`의 `app_engineer` 갈래), `tests/eval/restore/mod.ts`(`agentRefOf`의 `app_engineer` 갈래), `tests/eval/restore/save.ts`(`saveCall`), `tests/eval/scenarios/{lophn,operator}/common.ts`(`AE_가계부` 등), `tests/eval/scenarios/app-engineer/{common,A1-ask,A12}.ts`, `lophn/L4-app.scenario.ts`, `operator/O4.scenario.ts`. 옛 판은 다른 것(옛 SDK 이름, n, 재료 판)도 옛것이므로 통째로 되돌리지 않고 모양만 가져온다.
  - eval 코드: `tests/eval/runner/steps.ts`(`say`가 `agentRefOf`로 session을 연다), `tests/eval/runner/trial.ts`(`attachRealModels`에 `agentRefOf`를 넘긴다), `tests/eval/provider/attach.ts`(App Engineer는 `builtinAgentChange`로 model을 받는다), `tests/eval/restore/setup.ts`(`excludeCall`), `tests/eval/restore/deliver.ts`(tr-eval-apps가 `to: {role: "app_engineer", place: {app}}`을 읽게 고친다), `tests/eval/runner/discover.ts`, `tests/eval/runner/world.ts`, `tests/eval/runner/register.ts`, `tests/eval/versions/authored.ts`(`scenarioHash`)
  - module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - test 기준: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `tr-eval-apps`의 `deliver.ts`가 읽는 call 재료 `to` 꼴 `{role: "app_engineer", place: {app: <앱 이름>}}`(`calendar-call@3`과 같다), `tr-eval-checks`의 `callAfterAppCreate`(받는 쪽 `{role: "app_engineer", app}`)
  - 내놓는 것(`tr-eval-calendar`가 기댄다): `Participant`의 `role`은 `Role` 전부다. App Engineer 참가자는 `{role: "app_engineer", place: {app: <앱 이름>}}`이다. `PlaceName`은 `{kind: "app" | "project"; id; name}`이고 App Engineer session과 받는 쪽은 `kind: "app"`이다. `fixtureTrial`·`fixtureSession`·`toolCount`·`FxStep`·`callCount`의 모양은 그대로이고 `FixtureCall.to`는 `Participant`다. 재료 kind 목록(`MaterialKind`)은 바꾸지 않는다

## 할 일

1. 참가자 type(`tests/eval/types.ts`, 참가자와 수집 기록 쪽만).
   - `Participant`를 `Omit<NamedAgent, "role"> & { role: Role }`로 되돌린다. 위 주석은 "앱은 app.name(예 "가계부"), project는 project.name(예 "tax"), Operator는 자기 name. 앱의 일은 그 앱의 App Engineer가 맡는다"로 고친다.
   - `PlaceName`을 `{ kind: "app" | "project"; id: string; name: string }`로 바꾸고 주석을 맞춘다. `SaveSource`의 `call` 주석은 "lophn이 그 앱의 App Engineer에게 보낸 첫 call"로 고친다.
   - `MaterialKind`와 재료 type은 건드리지 않는다.
2. `agentRefOf`(`tests/eval/restore/mod.ts`)에 `app_engineer` 갈래를 더한다: `place.app` → `world.apps[name]` → `{ role, app }`. 못 풀면 지금처럼 던진다. `excludeCall`, `say`, `attachRealModels`가 이 함수로 App Engineer를 푼다.
3. 수집(`tests/eval/collect/read.ts`): `readNames`가 `appList`도 cursor로 끝까지 읽어 `app` map(id → name)을 만든다. `placeOf`가 `app_engineer`에 `{kind: "app", id, name}`을 준다. trial 안에서 만든 앱(L4-new)도 수집 때 읽으므로 이름이 있다. `read_test.ts`의 가짜 port에 `appList` 답을 더해 지금 test가 그대로 통과하게 한다.
4. `matchTarget`(`tests/eval/checks/records.ts`): `PlaceName`에 `app`이 들면 지금 비교(`receiver_place.kind`와 이름, 막힌 call은 `to`의 이름 꼴)가 그대로 App Engineer를 맞힌다. 확인하고 type이나 주석만 맞춘다.
5. fixture(`tests/eval/checks/fixtures.ts`, `mod.ts`).
   - tr-eval-checks가 넓힌 `FixtureCall.to`의 따로 둔 App Engineer type(`FixtureTarget` 등)을 지우고 `Participant`로 돌린다. `mod.ts`의 그 type export도 지운다.
   - `placeName`이 App Engineer에 `{kind: "app", id: \`app_fx_${app}\`, name: app}`을 준다. fixture의 받는 쪽 `receiver_place`가 `matchTarget`과 맞고, App Engineer가 보내는 쪽인 session의 `place`와 session id(`sessionOf`)도 앱 이름을 갖는다. `refOf`의 `app_fx_<app>` 규칙(`fixtureAppCreate`의 id와 같다)은 그대로다.
6. 버전의 role prompt(`tests/eval/versions/components.ts`, `files.ts`, `tests/eval/experiment/variant/texts.ts`). 지금은 App Engineer가 진짜 model을 받으면 `seenComponents`가 "system[0] matches no role prompt"로 run을 멈춘다.
   - `components.ts`의 `ROLES`에 `app_engineer`를 더한다. `Role` 전체에서 만들어(예: `Record<Role, …>`의 key) 빠지면 type check가 잡게 한다. test는 더하지 않는다.
   - `texts.ts`의 `ROLES`는 따로 쓰지 말고 `components.ts`에서 export한 것을 쓴다(variant의 `role_prompts`에 `app_engineer`가 없으면 `readRole`이 던진다).
   - `files.ts`의 `INSTRUCTION`에 `app-engineer`를 더해 `packages/core/agent-roles/roles/app-engineer/prompt.md`가 `instruction` 무리가 되게 한다.
7. `saveCall`(`tests/eval/restore/save.ts`): 받는 쪽이 `{role: "app_engineer", app: <그 앱 id>}`인 첫 sent call을 찾는다. `receiver_place`는 보지 않는다. 쓰는 `call.json`의 `to`는 `{role: "app_engineer", place: {app: <앱 이름>}}`(`deliver.ts`가 읽는 꼴, `calendar-call@3`과 같다)이고 `reply`, `body`는 그대로다. 오류 글은 "no call to the App Engineer of <앱>". L4-new의 `save`(`calendar-call` 후보)가 이것으로 다시 돈다. L4-new file은 `save`를 고치지 않는다.
8. `lophn/` 시나리오(근거: lophn prompt). `common.ts`를 고치므로 폴더의 시나리오 여덟 모두 n을 올린다(그때 file의 n + 1).
   - `common.ts`: `AE_가계부`, `AE_할일`, `AE_캘린더`, `AE_알림`(`{role: "app_engineer", place: {app: <이름>}}`)을 두고 `PM_ledger`, `PM_todo`, `PM_calendar`, `PM_notify`와 `<slug>-project` 주석을 지운다. `PM_tax`, `PM_hr`(L5)은 남긴다.
   - L4-app: 받는 쪽 `AE_가계부`. check id는 접기 전 이름 `to-gagyebu-ae-none`으로. wrong은 app.create 뒤 `AE_캘린더`, `AE_할일`에게. 머리 주석 "그 앱의 App Engineer에게 한 번 넘긴다".
   - L4-new: tr-eval-checks가 file 안에 둔 App Engineer 상수를 `common.ts`의 `AE_캘린더`·`AE_알림`으로 바꾼다. check와 fixture의 뜻은 그대로다.
   - L8: Operator 요청은 그 앱의 App Engineer에게 간다. `call-to-gagyebu-ae`, `no-other-calls`(notTarget `AE_가계부`). wrong은 `PM_tax`에게, `AE_가계부`와 `AE_할일` 둘에게.
   - T19-lophn: `excludeCall(ctx, LOPHN, AE_가계부)`, check의 target `AE_가계부`, wrong의 돌려 보낸 쪽은 `AE_할일`. 사람 말은 그대로다(옛 run에서 `call-blocked`가 통과했다. lophn은 앱 일을 받는 쪽 이름을 prompt로 안다).
   - L6: wrong fixture의 받는 쪽 `PM_ledger`를 `AE_가계부`로.
   - L1, L5, L7: n만 오른다.
9. `operator/` 시나리오(근거: Operator prompt). `common.ts`를 고치므로 넷 다 n을 올린다.
   - `common.ts`: `AE_가계부`를 더하고 `PM_ledger`를 지운다. `OP_월말정리`의 place `{project: "ledger-project"}`는 그대로 둔다(operators-home@4의 재료다). 주석은 "ledger-project는 apps-home이 앱 옆에 만든 보통 project다(`restoreAppProject`)"로.
   - O4: `TO_AE = {target: AE_가계부, reply: "none"}`, check id `call-to-gagyebu-ae-none`. 머리 주석 "그 앱의 App Engineer에게 답을 받지 않는 call로 맡긴다".
   - T19-op: `excludeCall(ctx, OP_월말정리, AE_가계부)`, check의 target `AE_가계부`. 사람 말이 막힌 상대를 이름으로 가리키는 것(tr-eval-operator)은 지키고 상대를 바꾼다. 예: "합계 tool이 늘 0을 돌려줘. 가계부 앱의 App Engineer에게 고쳐 달라고 맡기고 이번 달 합계를 구해 줘".
   - O6, O7: wrong fixture의 `PM_ledger`를 `AE_가계부`로.
10. `project-manager/`와 `app-engineer/`.
    - C8(`PM_tax`가 새 앱을 lophn에게)과 C9-other(`PM_tax`가 다른 project의 Operator를 `PM_hr`에게)는 지금 PM prompt와 맞다. `common.ts`에서 쓰지 않게 되는 `PM_ledger`, `PM_todo`와 `<slug>-project` 주석을 지우므로 둘 다 n을 올린다.
    - CA1-ask와 CA12는 Project Manager가 앱의 ticket·package 일을 하는 case다. 지금은 그 일이 App Engineer의 것이고 PM에게는 `ticket.create`도 없어 `no-ticket-create`가 아무것도 재지 않는다. 참가자를 `AE_가계부`로 바꾼다.
    - 정한 것: 둘을 `git mv`로 `tests/eval/scenarios/app-engineer/A1-ask.scenario.ts`, `A12.scenario.ts`로 옮기고 id를 접기 전 이름 `A1-ask`, `A12`로 되돌린다. 머리 주석의 출처가 AGENT-ROLE A1·A12이고, registry에 그 id의 n=1이 있어 옛 run과 이어진다. n은 2다(내용이 registry의 1과 같으면 1). `app-engineer/common.ts`에 `AE_가계부`, `AE_할일`, `LOPHN`을 둔다. A12의 wrong에서 `PM_todo`는 `AE_할일`로.
    - `calendar/`는 이 task가 고치지 않는다(tr-eval-calendar 소유. 그 task가 이 task 뒤에 App Engineer 참가자를 쓴다).
11. 문서: `architecture/eval.md`의 시나리오 폴더 줄(`lophn/`(8), `project-manager/`(4), `operator/`(4))은 lead가 끝에 고친다. 바뀐 폴더 수는 보고에 적는다.

## 끝남

- `deno task check:full`이 통과한다.
- 위험 test: 없음. role 목록은 type이 빠짐을 잡는다(할 일 6). `read_test.ts`는 가짜 port만 맞춘다.
- 진짜 model 없는 확인. git 밖 일회용 script(예: `.dev-data/plan-test-restore/tr-eval-app-engineer-check.ts`, `deno run --allow-all`)로 돌리고 commit하지 않는다.
  1. `discoverScenarios()`가 id 겹침 없이 끝나고(`CA1-ask`·`CA12`가 없고 `A1-ask`·`A12`가 있다) 모든 시나리오에 `validateFixtures`가 `{ok: true, problems: []}`다.
  2. `tests/eval/registry/`를 임시 폴더로 복사해 모든 시나리오(`scenarioHash`)와 그 world의 재료(`manifest.content_hash`)를 `registerAuthored(<사본>, …)`로 올려 실패가 0개다. 진짜 registry에는 쓰지 않는다.
  3. `resolveVariant({current: REPO_ROOT})`로 dry run한다(`prepareTrialWorld` → 확인 → `releaseWorld`). 이 world들에는 active_app이 없어 `e2e:deps`가 필요 없다.
     - T19-lophn과 T19-op: setup의 `excludeCall`이 App Engineer를 풀어 던지지 않는다.
     - A1-ask: `agentRefOf(ctx.world, AE_가계부)`가 `{role: "app_engineer", app: ctx.world.apps["가계부"]}`다. 그 ref로 `openSession` 한 session을 `collectSessions({port: core}, [session], <t0 앞 시각>)`으로 읽으면 `place`가 `{kind: "app", name: "가계부"}`다.
     - 같은 world에서 `saveCall` 왕복: LOPHN fixture session의 sent call 하나를 `receiver: {role: "app_engineer", app: <가계부 id>}`로 고친 trial을 만들고, `tests/eval/materials`를 임시 폴더로 복사한 root로 `saveMaterials(…, {"dry-call": {kind: "call", app: "가계부"}}, …)`가 ok다. 쓴 `call.json`의 `to`가 `{role: "app_engineer", place: {app: "가계부"}}`이고, 그 재료로 `deliverCall(ctx, "dry-call@1", <임시 root>)`이 ok이며 `callRead`의 `to.agent`가 `{role: "app_engineer", app: <가계부 id>}`다.
     - 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 돌리지 않는다: `deno task eval`, `eval:experiment`(`.env`를 읽어 진짜 provider를 부를 수 있다), `eval:gate`, `tests/eval/run.ts`(셋 다 진짜 registry에 쓴다). `tests/eval/registry/`를 고치지 않는다.
- 남지 않음: `grep -rn "PM_ledger\|PM_todo\|PM_calendar\|PM_notify\|FixtureTarget\|CA1-ask\|CA12" tests/eval --include=*.ts`가 0줄이다. `grep -n 'Exclude<Role' tests/eval/types.ts`가 0줄이다.

## 보고

- 바꾼 file과 옮긴 file
- 통과한 check와 위 확인 script의 결과
- 올린 시나리오 n: 시나리오마다 옛 n → 새 n
- 등록할 것: lead가 고칠 `architecture/eval.md`의 시나리오 폴더 줄
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(A1-ask·A12로 옮기고 이름을 되돌린 것 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 둘을 적는다.
  - 월말정리는 아직 project `ledger-project`에 놓인 Operator다. 접기 전처럼 앱 가계부에 두려면 새 operators 재료 판과 `restoreOperators`의 앱 place가 필요하다
  - 진짜 model run은 돌리지 않았다
