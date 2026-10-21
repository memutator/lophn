# tr-eval-restore

eval이 켜진 앱 재료(`active_app`)와 package 재료를 공용 helper(`tests/support/app/activate.ts`)로 되살리게 다시 쓴다: `startTestApp`이 재료 source를 core가 깐 source 폴더에 commit하고, 가짜 App Engineer가 `release_prepare`·`release_activate`를 부르고, 사람 자격으로 동의한 뒤 running을 기다린다. 재료 source가 지금 `release.prepare`를 못 지나면 그 재료의 새 판을 만든다.

- 단위: eval (wave 2)
- 선행: tr-support-app, tr-eval-prune-coding.
- 소유(이 task만 고친다):
  - `tests/eval/restore/{active-app,package,apps,env,git,save}.ts`
  - `tests/eval/materials/{notify-app,date-range,calendar-app,calendar-app-bug,calendar-data}`
  - `tests/eval/registry/material/{notify-app,date-range,calendar-app,calendar-app-bug,calendar-data}.json`
  - `tests/eval/scenarios/lophn/L4-new.scenario.ts` (재료 판이 오르면 world만)
  - `tests/eval/registry/scenario/L4-new.json`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md` "정한 것"의 helper 줄(앱을 운영으로 올리는 helper는 하나, eval이 쓰는 이름은 그대로, test만을 위한 machine actor를 더하지 않는다)과 "지켜볼 것"(`app.create` 직후 agent runtime child가 다시 뜬다, `release.prepare` 한 tool 호출, `e2e:deps` cache), `project-docs/plan/test-restore/survey-eval.md` §0의 3, §1의 `restore/active-app.ts`·`restore/package.ts`·`restore/env.ts`·`restore/apps.ts` 줄, §6, §7의 1·4
  - 계약: `project-docs/plan/test-restore/tasks/tr-support-app.md`의 "내놓는 것"(`startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `createAppSource`의 `sample`, `deps.ts`). merge된 코드가 정본이다. 다르면 코드를 따르고 보고한다
  - architecture: `project-docs/architecture/eval.md` "지키는 것"의 "진짜 model은 `real` 참가자만 받는다"(79), "버전은 hash로 고정한다"(85), "산출물은 후보 재료다"(96. 재료 판은 불변이고 needs가 바뀌면 새 판), "왜 이 모양인가"의 "제품 route로 되살린다"(111). `project-docs/architecture/activation.md` "지키는 것"의 첫 줄들(첫 activation은 늘 묻는다, `waiting_consent`, 동의 뒤 시작은 driver sweep). `project-docs/architecture/testing.md` "앱 길"(56-66)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`
  - 코드(줄은 HEAD `85f19080e` 기준)
    - 고칠 곳: `tests/eval/restore/active-app.ts`(1-117 전체. 27-42 `writeSource`, 57-97 grant·Gateway·`reportHarness`, 98-103 deliver·동의·running), `tests/eval/restore/package.ts`(2 `releasesListRecords`, 4 `approvalsPending`, 23-24 주석, 39-49 `tests`, 53 tool 입력, 63-73 `reason`), `tests/eval/restore/env.ts`(1 import, 6 주석), `tests/eval/restore/apps.ts`(17 주석 "source는 연결하지 않는다", 18-33 `restoreApps`), `tests/eval/restore/save.ts`(39-95 `saveActiveApp`), `tests/eval/restore/git.ts`
    - 그대로 쓰는 것: `tests/eval/restore/manifest.ts`(`loadMaterial`, `writeMaterial`, `textOf`, `splitRef`), `tests/eval/restore/mod.ts`(`restoreOne`이 kind로 부른다), `tests/eval/restore/materials_test.ts`(모든 재료의 hash·고정 id·needs·parent·`.tmpl`), `tests/eval/runner/world.ts` 19-55(`bootOptionsOf`, `prepareTrialWorld`, `releaseWorld`), `tests/eval/runner/register.ts`(`registerAll`), `tests/eval/versions/registry.ts` 119-145 `registerAuthored`, `tests/eval/runner/cli.ts` 134-149(registry 등록과 fixture 확인 뒤 key가 없으면 0으로 끝난다), `tests/eval/provider/key.ts`(`ANTHROPIC_API_KEY`만 읽는다)
    - 제품: `packages/protocol/apps/releases.ts` 79-133(`ReleasePrepareOutput`의 `failed {stage, reason}`, `ReleaseActivateOutput`), `packages/core/apps/agent-tools/package.ts` 172-199(`package.publish` 입력: `app`, `name`, `version`, `description`, `path`, `guide`, `permissions`. `tests` 칸이 없다), `packages/core/apps/registration/source-folder.ts` 55-109(`app.create`가 template을 깔고 commit하고, 그 뒤 `scaffoldApp({ files: [], … dataRoot })`로 개발용 import map을 다시 쓴다), `packages/core/apps/packages/template/scaffold.ts`(`fill`의 `{{TITLE}}`·`{{APP}}`, 99-112 `.lophn/import-map.json`), `packages/core/apps/packages/template/import-map.ts` `devImportMap`, `packages/core/apps/packages/template/app/`(지금 template), `packages/sdk/cap-problem/mod.ts`(`installProblemReporter`가 없다. `reportProblem`은 `console.error`로 `error <name>…` 한 줄을 쓴다, `report-port.ts`), `packages/core/agent-roles/roles/app-engineer/prompt.md` 57-60(App Engineer는 source의 `AGENTS.md`를 읽고 `deno task check`·`deno task test`를 돌린다)
    - 재료: `tests/eval/materials/{notify-app,calendar-app,calendar-app-bug}/2/files/source/AGENTS.md.tmpl` 13-28(ticket·claim·`lophn-build-app` 글), `tests/eval/materials/calendar-app/2/files/source/tests/events_test.ts.tmpl` 3, 12-19(`installProblemReporter`), `tests/eval/materials/calendar-app-bug/2/files/bug.json`의 `description`("a problem opens")
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`의 `id`·`description`·`sample: false`·`patch`, `deliverRelease`, `approveActivation`, `waitRunning`, `tool`, `appProjectName`, `openAppProject`), `source.ts`(`amendAppSource`), `deps.ts`(`appCoreEnv`)
  - 내놓는 것:
    - `restoreActiveApp(ctx, material)`, `restorePackage(ctx, material)`, `restoreApps`의 이름과 꼴은 그대로다.
    - 재료 새 판을 만들었으면 그 `이름@n` 목록을 보고에 적는다. 그 재료를 world에 쓰는 시나리오(O4, calendar-*)는 그 시나리오를 맡은 task가 world를 올린다.

## 할 일

근거는 README "정한 것"(공용 helper 하나, 가짜 model lane이 App Engineer로 `release.prepare`·`release.activate`를 부르고 사람이 `activation.consent`로 동의)과 survey §1의 restore 줄이다. 진짜 model provider는 부르지 않는다: 되살리기는 restore의 fake server lane만 쓰고, eval CLI는 `deno task eval`(`--env-file=.env`) 대신 `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts …`로 돈다(key가 없으면 registry 등록과 fixture 확인 뒤 0으로 끝난다). 시작 전에 이 worktree에서 `deno task e2e:deps`를 한 번 돈다(`.dev-data/e2e/deno-dir`는 worktree마다 따로다).

1. `tests/eval/restore/active-app.ts`를 공용 helper 위로 다시 쓴다.
   1. 지운다: `writeSource`(27-42), `agentGrantsSet`·`appConnectSource`·`appGet`·`runtimePids`·`settle`·`openSession`·`connectGateway`·`reportHarness` import와 쓰임, `TestApp.gateway`, `finally`의 Gateway 닫기. 앱 source 자리는 `app.create`가 깐 `<home>/apps/<app>/source`다(`run.work/<slug>`가 아니다).
   2. 재료 source를 얹는 `AppPatch` 하나를 file 안에 둔다(`materialSource(material, slug, dataRoot)`): 폴더에서 `.git`과 `.lophn`만 남기고 지운 뒤(core가 깐 template file이 남으면 재료에 없는 `home` 화면 같은 file이 commit에 섞인다), 재료의 `source/<path>.tmpl`을 `<dir>/<path>`에 쓴다. 끝에 `scaffoldApp({ files: [], dir, app: slug, dataRoot })`(`packages/core/apps/packages/template/scaffold.ts`)로 개발용 import map을 재료의 `deno.json`으로 다시 쓴다.
      - 정한 것: 개발용 import map을 다시 쓴다. 이유: core는 앱을 등록할 때 그 폴더의 `deno.json`으로 이 map을 쓴다(`source-folder.ts` 97-104). 재료는 이미 있는 앱이라 같은 일을 한다. 안 쓰면 template의 map에 `@me/date-range`가 없어 App Engineer의 `deno task check`·`deno task test`가 처음부터 떨어진다(`--import-map=.lophn/import-map.json`). tr-support-app의 `createAppSource`가 patch 뒤 map을 이미 다시 쓰면 이 줄은 빼고 보고한다. `.lophn/`은 ignore라 commit은 바뀌지 않는다.
   3. `restoreActiveApp` 순서: `fake.reset()` → `restoreAppProject(ctx, spec.slug)`(그대로) → `startTestApp(core, fake, { id, name: spec.name, slug: spec.slug, description: spec.description, sample: false, patch })` → `deliverRelease(core, fake, app, { goal: spec.goal ?? "Make the first release of the app" })` → 결과 `activated.status`가
      - `waiting_consent`면 `approveActivation(core, app, "allow")`(전제 재료를 만드는 일이라 늘 allow),
      - `failed`면 `failure.code`와 `summary`를 담아 던진다,
      - `active`·`running`이면 동의 없이 넘어간다,
      그 뒤 `waitRunning(core, app, release)` → `ctx.world.apps[spec.name] = id`.
      `fake.reset()`은 `startTestApp` 앞에서만 한다(helper가 그 앱의 lane을 건다).
   4. 실패는 지금처럼 `unavailable` / `active app <name> was not restored: <error>`로 돌려준다. `deliverRelease`가 던진 prepare의 stage와 reason이 글에 그대로 실린다(재료를 고칠 때 이 글을 읽는다).
2. `tests/eval/restore/package.ts`
   1. `releasesListRecords`, `approvalsPending` import와 `tests` 읽기(39-49)를 지운다. publish 입력은 `{ app, ...spec }`(`exports`를 뺀 publish.json)이다. `package.publish` 입력에 `tests`가 없다.
   2. `reason`은 마지막 tool 결과만 싣는다(보류 approval 수를 지운다).
   3. 머리 주석(23-24)을 "package는 그 앱 source HEAD commit의 폴더다. 앱 재료가 먼저 되살아나야 한다"로 고친다. `fake.reset()`, lane(`package_publish`와 `App <app>:`), 새 App Engineer session, `packagesVersions` 확인은 그대로다.
3. `tests/eval/restore/env.ts`: `appCoreEnv` import를 `../../support/app/deps.ts`로 바꾸고, 주석(6)을 `appCoreEnv`가 지금 주는 것(release 준비가 쓰는 deno dir 등)에 맞춘다. systemd-run을 말하지 않는다.
4. `tests/eval/restore/apps.ts`
   1. 주석(17)을 고친다: `app.create`가 template source를 깔고 잇는다. 재료는 그 source를 쓰지 않는다.
   2. 정한 것: `appCreate`마다 그 앞의 `runtimePids`로 `settle(core, before)`를 기다린다(`startTestApp`과 같은 이유. README "지켜볼 것"의 첫 줄). 이유: 이 재료만 쓰는 시나리오(L4-app, A1-ask, A12 등)는 되살리기 뒤 곧 진짜 model turn을 연다. 그 turn이 끊기면 돈을 쓰고 trial이 떨어진다.
5. `tests/eval/restore/save.ts`, `git.ts`: 새 source 자리(`appGet`의 `source_path`, release `code_commit`)로 그대로 도는지 확인만 한다. 주석이 가리키는 helper 이름이 바뀌었으면 주석만 고친다.
6. 재료 새 판을 만든다. 정한 것: 아래 셋은 `release.prepare`를 지나더라도 새 판을 만든다. 이유: App Engineer는 source의 `AGENTS.md`를 읽는데(`prompt.md` 57) 재료의 `AGENTS.md`가 지운 계약(ticket claim 아래에서만 일한다, `lophn ticket show`)을 시키고, 캘린더의 test는 없어진 `installProblemReporter`를 import해 App Engineer가 고치기 전에 돌리는 `deno task check`·`test`가 처음부터 떨어진다. calendar-maintain, calendar-diagnose가 이 world에서 App Engineer를 잰다. 옛 판은 지우지 않는다(재료 판은 불변).
   1. 만드는 법: scratch script(commit하지 않는다)로 `loadMaterial(MATERIALS_ROOT, "<이름>@2")`의 file을 고쳐 `writeMaterial(MATERIALS_ROOT, "<이름>", 3, { kind, ids, needs, parent, produced_by: null }, files)`로 쓴다. `writeMaterial`이 `content_hash`를 잰다. `material.json` 칸 순서는 지금 재료와 같게 `kind, ids, needs, parent, produced_by`다. 손으로 hash를 쓰지 않는다.
   2. template이 가진 file 가운데 앱이 고치지 않는 것은 지금 template 것으로 바꾼다: `source/AGENTS.md.tmpl`(`packages/core/apps/packages/template/app/AGENTS.md.tmpl`의 `{{TITLE}}`을 앱 이름(알림, 캘린더), `{{APP}}`을 slug(notify, calendar)로), `source/main.ts.tmpl`. 지금 template과 byte가 같은 file(CLAUDE.md, .gitignore, deno.lock, scripts/, css-modules.d.ts, wording/t.ts)은 그대로다. 앱 file(blueprint.ts, deno.json, src의 앱 code와 화면, wording/en.ts·placeholders.ts, migrations, tests)은 아래 고칠 것만 고친다.
   3. 판과 고칠 것
      - `notify-app@3`: 위 2만. needs `[]`, parent null.
      - `calendar-app@3`: 위 2와 `source/tests/events_test.ts.tmpl`의 `installProblemReporter`(3, 12-19)를 걷는다. `reportProblem`은 `console.error`에 `error <name>…` 한 줄을 쓰므로 test는 `console.error`를 잠시 바꿔 그 줄에서 이름을 모은다(102, 114, 153의 판정은 그대로). needs `["notify-app@3", "date-range@3"]`, parent null.
      - `calendar-app-bug@3`: `calendar-app@3`의 file에 지금처럼 `src/events.ts`의 bug(@2와 calendar-app@2의 diff 그대로)와 `bug.json`. `bug.json`의 `description`에서 "and a problem opens"를 걷는다(problem이 없다. handler 예외는 앱 log와 실패한 invocation에 남는다). `api`, `input`, `expect_after_fix`, `files`는 그대로다. needs `["notify-app@3", "date-range@3"]`, parent `"calendar-app@3"`.
      - `date-range@3`: `publish.json` 그대로, needs `["notify-app@3"]`.
      - `calendar-data@3`: `calls.json` 그대로, needs `["calendar-app@3"]`.
   4. 되살리기(7)에서 `release.prepare`가 떨어지면 stage와 reason을 읽고 그 판(아직 commit 전이면 같은 n을 지우고 다시 쓴다)의 앱 file을 최소로 고친다. 무엇을 왜 고쳤는지 보고에 적는다.
   5. 새 판을 registry에 올린다: scratch script로 판마다 `registerAuthored(REGISTRY_DIR, { kind: "material", name, n: 3 }, manifest.content_hash)`(`tests/eval/versions/mod.ts`, `tests/eval/runner/paths.ts`의 `REGISTRY_DIR`).
7. world 되살리기를 진짜 model 없이 확인한다. scratch script(commit하지 않는다): `resolveVariant({ current: REPO_ROOT })`(`tests/eval/experiment/variant/mod.ts`, `tests/eval/runner/paths.ts`)로 variant를 얻고 `prepareTrialWorld({ variant }, { world: <재료 ref들> } as Scenario, held)`를 부른 뒤, 되살린 앱마다 `appGet`의 `source_path`에서 `DENO_DIR=<e2eDenoDir()>`로 `deno task check`와 `deno task test`를 돌려 결과를 찍고, `finally`에서 `releaseWorld(held)`. 세 world를 본다.
   - `notify-app@3 date-range@3`(L4-new)
   - `calendar-app@3 calendar-data@3`(calendar-api, calendar-maintain)
   - `calendar-app-bug@3`(O4, L7, calendar-diagnose)
   prepare·activate·동의·running·package publish·app data 호출이 모두 지나야 한다. `restore/app-data.ts`는 이 task의 file이 아니다. 거기서 떨어지면 고치지 말고 보고한다.
8. L4-new의 world를 올린다(이것이 "world bump"다): `tests/eval/scenarios/lophn/L4-new.scenario.ts`의 `world`를 `["notify-app@3", "date-range@3"]`로, `n`을 7로(지금 file 6, registry 5. 한 번 올린다). 사람 말과 check는 고치지 않는다. 그 뒤 `env -u ANTHROPIC_API_KEY deno run --allow-all tests/eval/run.ts --scenario L4-new`가 `ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다…`로 0으로 끝나야 한다(registry 등록과 fixture 확인. `tests/eval/registry/scenario/L4-new.json`에 n 7 줄이 붙는다).
9. `git status`로 바뀐 path가 소유 안인지 본다. registry의 criterion·judge file이 바뀌었으면 그 내용이 이 task 밖에서 바뀐 것이니 되돌리고 보고한다.

## 끝남

- `deno task check`가 통과한다(이 task의 file은 아직 `NOT_CHECKED`라 아래로 따로 본다).
- `deno check tests/eval/restore/mod.ts tests/eval/restore/save_test.ts tests/eval/restore/manifest_test.ts tests/eval/restore/materials_test.ts tests/eval/scenarios/lophn/L4-new.scenario.ts`가 통과한다.
- `deno test --no-check tests/eval/restore`가 통과한다(새 재료의 hash, 고정 id, needs·parent, `.tmpl`을 `materials_test.ts`가 본다).
- `deno fmt --check`와 `deno lint`가 바꾼 `.ts` file에서 통과한다(재료와 registry는 `fmt.exclude`다).
- 할 일 7의 세 world가 되살아나고, 되살린 캘린더와 알림 source에서 `deno task check`와 `deno task test`가 통과한다.
- 할 일 8의 명령이 0으로 끝난다.
- 위험 test: 없음. 재료 hash·needs의 무결성은 이미 `tests/eval/restore/materials_test.ts`가 보고, 되살리기는 core·fake server를 띄우는 일이라 test로 두지 않는다(할 일 7의 확인으로 갈음).
- 남지 않음: `grep -rn "agentGrantsSet\|reportHarness\|connectGateway\|approvalsPending\|appConnectSource\|releasesListRecords\|support/coding\|systemd" tests/eval/restore`가 0줄이다. `grep -rln "lophn ticket\|installProblemReporter" tests/eval/materials/{notify-app,calendar-app,calendar-app-bug}/3`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(위 명령과 결과, 할 일 7의 world마다 걸린 시간)
- 만든 재료 판: `이름@n` 목록과 판마다 고친 file(O4, L7, calendar-api, calendar-maintain, calendar-diagnose, calendar-user, calendar-dev의 world를 올리는 task가 읽는다)
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(개발용 import map 다시 쓰기, apps.ts의 settle, 새 판을 만든 이유, prepare 실패로 더 고친 것)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 문서: lead가 끝에 고칠 줄. `project-docs/architecture/eval.md` 96줄의 "지금 앱 재료" 목록, "자리" 표의 `tests/eval/restore/` 줄
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(tr-support-app의 helper가 계약과 달랐던 곳 포함)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". App Engineer가 나중에 `deno.json`에 의존을 더해도 제품은 `.lophn/import-map.json`을 다시 쓰지 않는다(등록 때만 쓴다). 확인했으면 적는다
