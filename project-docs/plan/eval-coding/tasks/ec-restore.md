# ec-restore

eval-base의 재료 되살리기(`tests/eval/restore/`)에 재료 종류 넷을 더한다: 켜진 앱(`active_app`), 앱 data(`app_data`), package(`package`), call(`call`). 켜진 앱은 `tests/support/app/activate.ts`와 같은 제품 길로(model 없이) 켜고, 앱 data는 쓰기 app-api 호출을 `apps/call_api`로 다시 부르고, package는 켜진 앱이 app test를 통과한 뒤 fake App Engineer의 `package.publish`로 내고, call은 앱 등록만 되살린 뒤 시나리오의 첫 단계에서 fake lophn이 본문을 `call`로 보낸다. 거꾸로 시나리오 산출물(켜진 앱의 source, call 본문)을 새 재료 n으로 쓰는 save도 만든다.

- 단위: ec-restore (wave 2)
- 선행: ec-contract
- 소유(이 task만 고친다):
  - `tests/eval/restore/**`
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "재료"(종류와 되살리는 길, 자리와 조립), "단위와 의존", "진짜로 도는 것"(전제 재료는 fake 대본으로 되살린다), "제품 빈틈"
  - 계획: `project-docs/plan/eval-coding/README.md`의 "정한 것"
  - eval-base brief(이 task가 늘리는 바탕. 파일 이름과 export는 그대로다): `project-docs/plan/eval-base/tasks/ev-restore.md`와 landed된 코드(`tests/eval/restore/mod.ts`, `manifest.ts`, `hash.ts`, `apps.ts`, `operators.ts`. 코드가 정본이다), `project-docs/architecture/eval.md`, `ev-contract.md`(`MaterialManifest`, `WorldIds`, `SetupContext`), `ev-provider.md`(`attachRealModels`는 전역 기본 model이 `null`일 때만 붙는다), `ev-runner.md`(trial 순서: 되살리기 → `endRestore` → `attachRealModels` → t0 → steps)
  - 같은 계획의 brief: `ec-contract.md`(`MaterialKind`, `Step`의 `deliver`, `Save`·`SaveSource`), `ec-runner.md`("쓰는 것"의 ec-restore 기대), `ec-world.md`와 `ec-calendar.md`(이 task가 정하는 재료 file 꼴을 쓰는 쪽)
  - architecture: `project-docs/architecture/activation.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/testing.md`
  - 본보기(그대로 import한다): `tests/support/app/activate.ts`의 `deliverRelease`, `approveActivation`, `waitRunning`, `tool`, `TestApp`(타입), `tests/support/coding/cli.ts`(`codingCli`), `tests/support/gateway/mod.ts`(`connectGateway`, `Gateway.close`), `tests/support/gateway/shell.ts`(`reportHarness`), `tests/support/coding/deps.ts`(`appCoreEnv`), `tests/support/core/human.ts`(`openSession`, `say`, `waitTurnEnd`, `settle`, `until`, `connectFakeProvider`), `tests/support/fake-server/mod.ts`(`startFakeServer`)와 `probe.ts`(`idIn`, `lastToolResult`, `toolNames`)
  - 본보기(읽고 같은 순서로 쓴다): `tests/support/app/source.ts`의 `createAppSource`(git init·commit 순서와 `GIT_ENV`), `tests/e2e/app-call_test.ts`(`appCallApi`를 사람 자격으로 부르는 모양), `packages/core/apps/packages/publish.ts`(`package.publish`가 거절하는 조건)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `approvals`; `project-docs/module-catalog.yaml`의 `tests`
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`(ec-contract가 더한다. merge된 실제 export가 다르면 그것을 따르고 보고에 적는다):
      - `MaterialKind`에 `"active_app" | "app_data" | "package" | "call"`.
      - `Save = Record<string, SaveSource>`(키는 새 재료 이름), `SaveSource = { kind: "active_app"; app: string } | { kind: "call"; app: string }`(`app`은 app.name). `Scenario.save?: Save`.
      - `Step`의 `{ kind: "deliver"; material: string }`(`material`은 call 재료 이름).
      - `TrialRecord`, `SessionRecord.sent_calls`(`SentCall.body`, `.reply`, `.receiver`, `.receiver_place`): `ev-contract.md` 그대로.
    - eval-base `tests/eval/restore/`: `beginRestore`, `restoreWorld`(재료 종류별 분기), `endRestore`, `manifest.ts`의 `MATERIALS_ROOT`(절대 경로), `Material`(`{ ref, manifest, files }`), `loadMaterial(root, ref): Promise<Material>`(고정 id를 `ID_PREFIX[kind]`로 `idSchema.parse`한다), `verifyMaterial(material): Promise<Result<void>>`, `writeMaterial(root, name, n, manifest, files): Promise<Result<void>>`, `orderMaterials(root, refs): Promise<Result<Material[]>>`(`needs` 순서), `textOf(material, path)`, `splitRef`; `hash.ts`의 `contentHash(files)`. 재료 종류별 되살리기 함수의 모양은 `restoreApps(ctx, material): Promise<void>`처럼 file을 읽고 실패하면 던지는 꼴이다(`restoreContext`만 `Result`).
    - protocol(고정 route, 사람 자격): `appCreate`, `appConnectSource`, `appGet`, `appRuntime`(`packages/protocol/apps/mod.ts`), `appCallApi`(`packages/protocol/apps/calls/call.ts`, 입력 `{ target: { mode: "live", app, release: null }, api, input?, caller: { kind: "person", view_session } }`), `releasesListRecords`·`releasesGetRecord`(`packages/protocol/apps/activation/activation.ts`; `ReleaseRecord.tests`는 같은 bundle의 app test `vrf` 목록, `code_commit`은 40 hex), `packagesVersions`(`packages/protocol/apps/package-routes.ts`), `agentGrantsSet`, `modelDefaultChange`, `callRead`, `ticketShow`.
  - 내놓는 것(`tests/eval/restore/mod.ts`가 다시 내보낸다. 아래 둘은 ec-runner가 기댄다):
    - `restoreWorld(ctx, refs, root = MATERIALS_ROOT)`가 네 종류를 되살린다. 세 번째 인자 `root`는 이미 landed된 시그니처 그대로다(임시 재료로 확인할 때 쓴다)(아래 "재료 file 꼴"이 정본이다. ec-world와 ec-calendar가 이 꼴로 재료를 만든다).
    - `deliverCall(ctx: SetupContext, ref: string): Promise<Result<{ call: string }>>`. `ref`는 call 재료의 `이름@n`(`"calendar-call@1"`)이다. ec-runner는 `deliver` 단계의 `material`(이름)에 맞는 항목을 `scenario.world`에서 찾아 ref로 넘긴다. 돌려주는 `call`은 보낸 call의 id(`cal_…`)다. runner가 `callRead`로 받는 쪽 session을 읽어 collect의 root로 삼는다. fake lophn session은 root가 되지 않는다(그 fake model call이 `Metrics`와 `seenComponents`에 들어가지 않게). 이유: 이름만 받으면 같은 이름의 새 n이 commit되었을 때 시나리오 world가 가리킨 n과 다른 본문을 보낼 수 있다.
    - `saveMaterials(deps: { core: Core; world: WorldIds; refs: string[]; trial: TrialRecord; root?: string }, save: NonNullable<Scenario["save"]>, from: { scenario: string; trial: number; run: string }): Promise<Result<{ name: string; n: number }[]>>`. ec-runner가 기대한 `deps`(`core`, `world`)에 `refs`(시나리오의 `world` 목록)와 `trial`(방금 끝난 `TrialRecord`)이 더 든다. 둘 다 save가 `needs`·`parent`·call 본문을 정하는 데 필요하다(아래 "할 일" 6). `root`는 재료 폴더(기본 `tests/eval/materials`).
    - `restoreCoreEnv(refs: string[], root = MATERIALS_ROOT): Promise<Record<string, string>>`. 재료 목록(`needs`를 따라간 것 전체)에 `active_app`·`app_data`·`package`가 하나라도 있으면 `appCoreEnv()`(`DENO_DIR`, `XDG_RUNTIME_DIR`)를, 아니면 `{}`를 돌려준다. ec-runner가 `bootCore(run, { settings, env })`의 `env`에 넣는다. 이유: release 준비와 app test가 npm·jsr 의존을 받아 둔 deno dir과 `systemd-run --user`를 쓴다(`tests/support/coding/deps.ts`). 준비가 안 됐으면 `appCoreEnv()`가 `deno task e2e:deps`를 안내하며 던진다.

## 재료 file 꼴 (정본)

`material.json`은 eval-base의 `MaterialManifest` 그대로다. `kind`와 `files/`만 종류마다 다르다. 모든 data file은 `JSON.stringify(value, null, 2) + "\n"`로 쓴다. `files/`에 아래에 없는 file이 더 있어도 되살리기는 읽지 않는다(재료를 쓰는 시나리오와 check가 읽는 설명 file 자리다).

| kind | `ids` | `files/` | 되살리는 길 |
|---|---|---|---|
| `active_app` | `{ "<app.name>": "app_..." }` 하나 | `app.json` = `{ "slug", "name", "description", "goal"? }`, `source/**` = 앱 source 트리(`.git`, `.lophn`, `dist`, `node_modules` 없이 git에 commit된 file 전부). **file마다 이름 뒤에 `.tmpl`을 붙여 담는다**(`blueprint.ts.tmpl`, `deno.json.tmpl`, `.gitignore.tmpl`) | `apps/create`(id 고정) → `source/`를 `<run.work>/<slug>`에 풀고 git init·commit → `apps/connect_source` → fake App Engineer 대본으로 ticket과 coding agent call → fake coding CLI(claim, release prepare, app test, report) → `ticket.verify` → activation 허락 → 앱 process가 뜰 때까지 |
| `app_data` | `{}` | `calls.json` = `[{ "app": "<app.name>", "api": "...", "input"?: ... }]` | 목록 순서대로 `apps/call_api`(사람 자격). 각 `outcome.status`가 `succeeded`여야 한다 |
| `package` | `{}` | `publish.json` = `{ "app": "<app.name>", "name": "@me/...", "version": "1.0.0", "description", "path": "<app source 안 폴더>", "permissions": [], "guide": { "purpose", "api", "examples" } }` | 낸 앱(`needs`에 든 `active_app`)의 fake App Engineer가 `package.publish`를 부른다 |
| `call` | `{ "<app.name>": "app_..." }` 하나 | `app.json` = `{ "slug", "name", "description" }`, `call.json` = `{ "to": { "role": "app_engineer", "place": { "app": "<app.name>" } }, "reply": "none", "body": "..." }` | `apps/create`(id 고정)만. source는 잇지 않는다. call 본문은 `deliverCall`이 보낸다 |

- 앱 source(`active_app`의 `source/**`)는 file마다 이름 뒤에 `.tmpl`을 붙여 담는다. 앱 template이 같은 이유로 `*.ts.tmpl`로 담긴다(`packages/core/apps/packages/template/app/`). `tests/eval/materials/` 안의 `.ts`·`.tsx`·`deno.json`은 `deno task check`의 lint·type check·test 탐색(`tools/check.ts`)과 Deno의 nested config 찾기에 걸린다.
- `package.json`이라는 이름의 file도 재료 폴더에 두지 않는다(npm 설정으로 읽힌다). 그래서 package 재료의 file 이름은 `publish.json`이다.

## 할 일

근거: `project-docs/products/roadmap/eval.md`의 "재료", `project-docs/architecture/activation.md`, `tests/support/app/activate.ts`.

1. **분기와 world** (`restore/mod.ts`, `restore/manifest.ts`): `mod.ts`의 `restoreOne` switch(`manifest.kind`로 가른다. 지금 네 case가 있다)에 네 case를 더한다(종류마다 file 하나: `active-app.ts`, `app-data.ts`, `package.ts`, `call.ts`). ec-contract가 `MaterialKind`를 늘리면 `manifest.ts`의 `ID_PREFIX`(`satisfies Record<MaterialKind, string>`)가 type check에서 깨진다. 네 줄을 더해 고친다: `active_app: "app"`, `call: "app"`, `app_data: "app"`, `package: "app"`(뒤 둘은 `ids`가 빈 객체라 prefix를 쓰지 않는다). 되살리기 전 hash 확인(`verifyMaterial`)과 `needs` 순서는 eval-base 그대로다.
2. **켜진 앱** (`active-app.ts`): `activate.ts`의 `startTestApp`이 template에서 source를 만드는 부분만 재료의 `source/`로 바꾼 것이다. 나머지는 export된 `deliverRelease`, `approveActivation`, `waitRunning`을 그대로 부른다. 순서:
   1. `ctx.fake.reset()`. `appCreate({ id: manifest.ids[name], slug, name, description })`.
   2. `source/`의 file을 `<ctx.core.run.work>/<slug>`에 쓴다(bytes 그대로, 이름 끝의 `.tmpl`만 뗀다). `git init`·`add -A`·`commit`(`createAppSource`와 같은 `GIT_ENV`: `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `-c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false`). commit은 `rev-parse HEAD`.
   3. 연결: `runtimePids`로 앞 pid를 잡고 `appConnectSource({ app, source_path }, { base_revision })`(`base_revision`은 `appGet`의 `revision`). pid가 있었으면 `settle(core, before)`.
   4. `agentGrantsSet`으로 App Engineer의 grant를 `[{ kind: "agent", agent: { role: "coding_agent", app }, setting: "never" }]`로 둔다(`startTestApp`과 같다. 그 파일의 주석은 이 줄이 없으면 call이 `not_allowed`라고 한다. 되살리기는 이미 알려진 길을 그대로 따른다).
   5. `connectGateway(core)` → `reportHarness(core)` → `openSession(core, { role: "app_engineer", app })`로 `TestApp`(`{ app, slug, name, source, commit, ae, gateway }`)을 만든다.
   6. `deliverRelease(core, ctx.fake, app, { goal: app.json.goal ?? "Make the first release of the app" })` → `approveActivation(core, app, "allow")` → `waitRunning(core, app, release)`. 이 활성화 허락은 시나리오의 `human.approve`와 상관없이 늘 `allow`다(전제 재료를 만드는 일이다).
   7. `finally`: `gateway.close()`. 이유: 진짜 driver(ec-driver)가 같은 `coding_terminal` frame을 받으려고 Gateway에 붙는데, 터미널 frame은 접속한 shell main 하나만 받는다(`tests/e2e/app-release_test.ts`의 주석). 앱마다 새로 붙고 닫는다.
   8. `ctx.world.apps[name] = id`.
   - 실패하면 던지지 말고 `err({ code: "unavailable", message })`로 돌려주고 message에 `deliverRelease`가 담는 ticket·release·runtime 상태를 그대로 싣는다.
3. **앱 data** (`app-data.ts`): `calls.json`을 읽어 앱 이름을 `ctx.world.apps`로 푼다(못 풀면 아무것도 부르지 않고 `err`). 차례로 `appCallApi`를 사람 자격(`caller: { kind: "person", view_session: "eval" }`)으로 부른다. `outcome.status !== "succeeded"`이면 거기서 멈추고 `err`에 몇 번째 호출인지와 `outcome` JSON을 담는다(이미 한 호출은 되돌리지 않는다. trial 폴더는 버려진다). 이유: 쓰기 호출만 담는 재료라 실패는 곧 앱이 달라진 것이다.
4. **package** (`package.ts`):
   1. `publish.json`의 `app`을 `ctx.world.apps`로 푼다. `releasesListRecords({ app })`에서 `status: "active"`인 release의 `tests`를 얻는다(없으면 `err`: 낸 앱이 켜져 있지 않다).
   2. `ctx.fake.reset()` 뒤 App Engineer 대본: `package_publish`(wire 이름. `ticket_create`가 `ticket.create`인 것과 같다) `{ app, name, version, description, path, guide, permissions, tests }` → `text`. 대본 줄(lane)은 `activate.ts`의 `aeLane`과 같은 모양으로 직접 쓴다(`TestApp` 없이): 요청의 tool 목록에 `package_publish`가 있고 본문에 `App <app id>:`가 있는 요청이 받는다.
   3. `openSession(core, { role: "app_engineer", app })` → `say(core, ae, "App <id>: publish <name>")` → `waitTurnEnd`. 그 뒤 `packagesVersions({ name })`에 그 version이 있어야 한다. 없으면 `err`(fake journal의 마지막 tool 결과를 message에 담는다. 낸 앱이 app test를 통과하지 못했거나 source commit에 `path`가 없으면 `package.publish`가 `invalid_input`이다).
   4. `package.publish`의 Gate가 사람에게 묻는 것으로 나오면(보류 request) 이 helper가 풀지 않는다. 보고에 적고 `err`로 멈춘다(재료를 되살리는 데 사람 허락이 필요하면 안 된다).
5. **call** (`call.ts`, `deliver.ts`):
   - `restoreCall`: `app.json`으로 `appCreate({ id, slug, name, description })`만. `ctx.world.apps[name] = id`.
   - `deliverCall(ctx, ref)`: ec-runner가 첫 단계(`deliver`)로 부른다. 이미 `endRestore`가 fake를 닫았고 진짜 model이 `real`에 붙어 있다. 그래서 이 함수가 자기 fake server를 따로 띄운다.
     1. `ref`로 `loadMaterial`(재료 폴더는 기본값)을 하고 `call.json`을 읽는다(kind가 `call`이 아니면 `err`). `ctx.world.apps`에 `to.place.app`이 있어야 한다(없으면 `err`).
     2. `startFakeServer()` → `connectFakeProvider(ctx.core, fake)`(전역 기본 model이 잠시 fake가 된다. `real`은 agent 층 model이 있어 영향이 없다) → 대본 `call`(`to`, `reply`, `body`는 `call.json` 그대로, `refs: []`) → `text("sent")`.
     3. `openSession(core, { role: "lophn" })` → `say(core, session, "deliver")` → `waitTurnEnd`. 이 뒤 fake의 마지막 tool 결과에 `cal_` id(`idIn(…, "cal")`)가 있어야 한다. 없으면 `err`(결과 글을 담는다. `not_allowed`면 lophn의 grant 줄을 의심한다).
     4. `finally`: `modelDefaultChange({ default: null })`(이 뒤 root의 전역 기본 model은 다시 `null`이다), `fake.close()`.
     5. 3번에서 읽은 `cal_` id를 `{ call }`로 돌려준다.
   - 정한 것: lophn에는 model을 session 층이나 agent 층에 붙이지 않고 전역 기본으로 잠깐 둔다. 이유: 가장 단순하다. 이 구간에는 다른 non-`real` agent가 일하지 않는다(첫 단계이고 받는 쪽은 `real`이다). 받는 쪽이 `real`이 아니면 이 구간에서 fake 답을 받을 수 있다는 점을 보고에 적는다.
6. **save** (`save.ts`): `saveMaterials`.
   - `save`의 항목마다(`name`, `spec`). `SaveSource`는 둘뿐이다(앱 data와 package는 어느 시나리오도 남기지 않아 ec-contract가 뺐다). 둘:
     - `spec.kind === "active_app"`: `saveActiveApp`. `world.apps[spec.app]`로 app id를 얻는다. `appGet`의 `source_path`, `active_release`가 있어야 한다(없으면 `err`: 켜지지 않았다). `releasesGetRecord`의 `code_commit`에서 `git -C <source_path> ls-tree -r -z --name-only <commit>`으로 file 목록을 읽고 file마다 `git cat-file blob <commit>:<path>`로 bytes를 읽어 `files/source/<path>.tmpl`에 둔다(`.tmpl`을 붙인다). 작업 트리가 아니라 활성 release의 commit에서 읽는 이유: 앱 처리 중 만든 untracked file이나 `.lophn/`(이 장치의 절대 경로가 든 import map)가 재료에 들어가면 hash가 장치마다 달라진다. `files/app.json`은 `appGet`의 `slug`, `name`, `description`이다. `ids`는 `{ [name]: app id }`.
     - `spec.kind === "call"`: `saveCall`. `deps.trial.sessions`의 `sent_calls` 가운데 `receiver?.role === "app_engineer"`이고 `receiver_place?.name === spec.app`인 첫 call을 고른다(없으면 `err`). `files/call.json`은 `{ to: { role: "app_engineer", place: { app: spec.app } }, reply, body }`(`reply`·`body`는 `SentCall`의 것). `files/app.json`은 그 앱의 `appGet`(`receiver.app`). `ids`는 `{ [app.name]: app id }`.
   - `manifest`: `kind`, `ids`, `produced_by: { scenario: from.scenario, trial: from.trial, run: from.run }`, `needs`와 `parent`는 `deps.refs`로 정한다. 각 ref를 `loadMaterial`로 읽어: `parent` = `ids`에 저장하는 app id가 든 재료의 ref(없으면 `null`. 둘 이상이면 n이 큰 것), `needs` = 나머지 가운데 kind가 `active_app`·`package`인 재료의 ref(순서는 `refs` 순서). 이유: `calendar-mvp`가 낸 `calendar-app@2`는 `notify-app`·`date-range`가 있어야 되살려지고, `calendar-call`은 같은 앱의 다른 모습(parent)이다.
   - n은 `<이름>/` 아래 있는 숫자 폴더의 최댓값 + 1(없으면 1). `writeMaterial(root, name, n, manifest, files)`로 쓴다(이미 있으면 eval-base의 `conflict`가 그대로 나온다). 쓴 `{ name, n }` 목록을 돌려준다. 하나가 `err`이면 나머지는 쓰지 않고 멈춘다.
7. **환경** (`env.ts`): `restoreCoreEnv`. `refs`의 `needs`를 `loadMaterial`로 따라가며 kind를 모은다.
8. **위험 test 1개** (`tests/eval/restore/materials_test.ts`): `tests/eval/materials/*/*/`의 모든 재료를 읽어 ① `verifyMaterial`이 통과하고 ② `ids` 값이 자기 prefix(`_` 앞 글자. `app`, `prj`, `ctx`, `agt`)의 `idSchema(prefix).parse`를 통과하고 ③ `needs`와 `parent`가 가리키는 `이름@n`이 폴더로 있고 ④ `needs`에 순환이 없고 ⑤ `files/source/` 아래 모든 file 이름이 `.tmpl`로 끝난다(아니면 `deno task check`가 그 file을 앱 source가 아닌 repo 코드로 읽는다). core를 띄우지 않고 file만 읽는다. 재료가 아직 하나도 없는 시점에도 통과한다.
9. **임시 script로 한 번 확인한다**(scratchpad, commit하지 않는다. fake provider만, 진짜 provider·진짜 Claude Code는 부르지 않는다). 준비: `deno task e2e:deps`가 돌아 있어야 한다(network를 쓰는 유일한 명령이다. 안 돼 있으면 사람에게 알린다). 재료가 아직 없으므로 script 안에서 임시 재료를 만든다: `tests/support/app/source.ts`의 `createAppSource`로 template 앱 source를 만들고 그 file들(이름 뒤에 `.tmpl`을 붙여)로 임시 `active_app`(app-api는 template의 `list_items`·`add_item`)과 `app_data`(`add_item` 한 번), `call` 재료를 임시 폴더 root에 `writeMaterial`로 쓴다(`restoreWorld`의 재료 root 인자로 그 폴더를 준다). 그 뒤:
   1. `createRun` → `bootCore(run, { env: await restoreCoreEnv(refs, root) })` → `beginRestore` → `restoreWorld(ctx, refs)` → `endRestore`.
   2. `appCallApi`로 `list_items`가 `succeeded`이고 앞서 넣은 row가 있는지, `appRuntime`이 running인지 읽는다.
   3. `package`: 임시 source의 한 폴더(`src/util/mod.ts` 같은 것)를 임시 `package` 재료로 내고 `packagesVersions`로 확인한다.
   4. `deliverCall`: `call` 재료로 `restoreWorld` 뒤 `deliverCall`을 부르고 `callRead`가 받는 쪽 App Engineer의 `accepted`(model이 없어 그쪽 turn은 `model_required`로 닫힌다. 정상)임을 확인한다. 부른 뒤 `modelDefaultRead`가 `null`인지 본다.
   5. `saveMaterials`: 위 `active_app`을 임시 root에 `save`로 써 보고, 다시 `restoreWorld`로 되살려지는지(hash 포함) 본다. 이미 있는 n을 덮지 않는 것도 한 번 본다.
   - 확인 결과(걸린 시간 포함)와 만난 제품 빈틈을 보고에 적는다.

## 끝남

- `deno task check`가 통과한다. `materials_test.ts`는 core를 띄우지 않고 subprocess·network 없이 file만 읽는다.
- 위험 test: "committed 재료의 hash·고정 id·`needs`·`parent`가 모두 맞고 앱 source file이 `.tmpl`로 담겨 있다" (재료 file이 fmt나 손으로 한 byte라도 바뀌면 모든 기준 run이 다른 world에서 돈 것이 된다. `deno task check`가 먼저 잡는다.)
- core를 띄우는 되살리기·save 자체는 test로 만들지 않는다(subprocess를 띄우는 test는 사람에게 묻는다). 위 9번 임시 script로만 확인한다.
- 주석과 test 이름에 task id·요구 ID를 쓰지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`deno.json`의 `eval` task와 `fmt.exclude`는 lead가 한다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 `deliverCall`이 ref를 받는 것, `saveMaterials`의 `needs`·`parent` 규칙, `deliverCall`의 전역 기본 model 잠깐 쓰기, `goal` 기본값, package의 `tests`를 release 기록에서 얻은 것)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `Save`·`SaveSource`·`Step.deliver`의 실제 모양, `saveMaterials`의 `deps`에 `refs`·`trial`이 더 든 것, `deliverCall`이 ref를 받는 것이 ec-contract·ec-runner 기대와 다르면 여기 적는다
- 만난 제품 빈틈: app test가 `@me` package를 쓰는 앱을 거절하지 않는지(`ec-world.md`의 "제품 빈틈" 참고), `package.publish`가 사람 허락을 묻는지, `deliverRelease`가 asserts를 던지는 곳
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 진짜 Claude Code가 붙는 길(driver)은 `ec-driver`·`ec-runner`의 몫이다. 
