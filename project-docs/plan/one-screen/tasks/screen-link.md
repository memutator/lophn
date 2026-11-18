# screen-link

git이 아닌 이 컴퓨터의 project에 다른 기계의 project 정체(`pri_`)를 적는 route와, 그 잇기를 고르는 dialog를 만든다. git project는 지금처럼 저장소의 id file이 정체를 정하고 이 route로 바뀌지 않는다. 정체가 바뀌는 세 길(잇기, [Separate project]의 `renew_identity`, id file이 ledger에서 난 id를 대신할 때)은 옛 정체를 project 기록에 "옛 정체"로 남기고, 앱은 `identity`가 가는 모든 자리에서 그 목록을 받아 옛 정체로 key한 줄을 옮길 수 있다. dialog를 목록의 줄에 다는 일은 `screen-lists`가 한다.

- 단위: screen (wave 1)
- 선행: 없음. `multi-device-fixes`가 main에 올라간 뒤에 띄운다.
- 소유(이 task만 고친다):
  - `packages/protocol/projects/{identity-api,project-api,values}.ts`, `packages/protocol/apps/{views,phone-screen}.ts`, `packages/protocol/shell/app-bridge-types.ts`
  - `packages/core/projects/registry/{schema,store,rows,commands,contexts,registry_test}.ts`, `packages/core/projects/identity/identity_test.ts`
  - `packages/shell/main/app-frame/{app-projects,app-projects_test,app-connection,view-model,registry_test}.ts`, `packages/shell/ipc/app-frame.ts`, `packages/shell/preload/app-tool.ts`
  - `packages/shell/renderer/app-frame/app-views.tsx`, `packages/shell/renderer/workspace/{source,core-source,fake-source}.ts`
  - `packages/shell/renderer/desktop/workspaces/projects/{source,core-source}.ts`, `packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts`, `packages/shell/renderer/desktop/workspaces/projects/{link-dialog.tsx,link-dialog.module.css}`(새 file)
  - `packages/sdk/app-ui/{use-place,use-projects}.ts`, `packages/sdk/app-ui/{guide.md,package.json}`, `packages/sdk/app-ui-native/{guide.md,package.json}`
  - `packages/core/agent-workspaces/skills/migrate-sdk/{app-ui-2.20.0,app-ui-native-1.7.0}.md`(새 file), `packages/core/apps/packages/template/app/{AGENTS.md.tmpl,lophn.ts.tmpl,package.json.tmpl}`, `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`, `package-lock.json`
  - `tools/wireframes/pages/screens/{shell,project-window}.tsx`, `tools/wireframes/pages/screens/shell/project-link-scene.tsx`(새 file)
  - `packages/design/i18n/catalog/workspace.ts`
  - `project-docs/flows/areas/{projects,app-surface}.yaml`, `project-docs/architecture/{project-identity,app-call}.md`
- 읽을 것:
  - 계획 README "정한 것 › 목록"의 "git이 아닌 project를 잇는다"
  - 본보기(같은 모양의 일): commit `62622e9ae`("Give apps the project's cross-machine identity…"). `identity`를 앱에 싣던 34개 file이 이번에 옛 정체를 싣는 자리와 같다. `git show 62622e9ae --stat`로 자리를 보고 따라 한다. change-log `project-docs/products/change-log/0.23/project-address.yaml`(앱은 `identity ?? id`로 key한다)
  - architecture: `project-docs/architecture/project-identity.md`(모델 "쓰는 길 셋", 지키는 것 8, 결정의 git이 아닌 project id), `app-call.md`(앱이 받는 project와 place), `ui-kit.md` "앱 SDK 판과 지원 하한"
  - skill: `.claude/skills/sdk-note/SKILL.md`(판, pin, `migrate-sdk` 메모, Instruction diff), `.claude/skills/ui-design/SKILL.md`
  - 조사 `reports/multi-device/survey-n1-one-screen.md` 부록 D
  - 지금 code: `packages/core/projects/registry/commands.ts`의 `recordIdentity`·`recordedIdentity`, `store.ts`의 `storeIdentity`, `packages/core/projects/identity/service.ts`의 `renew`, `packages/protocol/projects/identity.ts`의 `matchProjects`
- 계약:
  - 쓰는 것: `defineCommand`, `ProjectsSource`, `SchemaStep`
  - 내놓는 것:
    - route `projects/link_identity`(command, name `project.link_identity`, `actors: ["user"]`, `changes: ["projects"]`): 입력 `{project: prj_, identity: pri_}` → 출력 `projectRecordSchema`. 거절: project가 없으면 `not_found`, `repo`가 `none`이 아니면(git이거나 아직 못 읽었다) `conflict`와 `details.reason: "git_project"`, 이 기계의 다른 project(보관 포함)가 그 `identity`나 옛 정체로 그 id를 갖고 있으면 `conflict`와 `details.reason: "identity_in_use"`. 이미 그 id면 그대로 성공이다.
    - 옛 정체: ledger·route 값은 `former_identities: pri_[]`(`projectRecordSchema`와 `project.list|get`의 project), 앱이 받는 값(`AppProject`, place의 project workspace, view 열기 IPC, `app_views.open`, 폰 place schema, SDK `Project`·`PlaceWorkspace`)은 `formerIdentities: string[]`. 오래된 것이 앞이고 최대 16개, 지금 `identity`는 들지 않는다.
    - `ProjectsSource.linkIdentity(project: ProjectItem, identity: string): Promise<SourceResult<ProjectItem>>`
    - `LinkProjectDialog({remote: {machineName, title, identity}, candidates: readonly ProjectItem[], onLink, onClose})`: 다른 기계의 git이 아닌 project 하나를 이 컴퓨터의 git이 아닌 project 가운데 하나와 잇는다. `candidates`는 부르는 쪽(`screen-lists`)이 `repo === "none"`이고 그 id가 아닌 이 컴퓨터의 project로 거른다.

시작 전에 다시 볼 것: `multi-device-fixes`의 `fix-identity`(change-log `project-docs/products/change-log/0.23/multi-device-fixes.yaml`(끝난 task `fix-identity`. brief는 `git show ffe208f94^:project-docs/plan/multi-device-fixes/tasks/fix-identity.md`))가 git을 못 읽은 project의 `repo`와 id를 다루는 길(`identity/inspect.ts`, `file.ts`)과 `project-identity.md`의 "앱이 받는 id가 바뀌는 경우"를 고쳤다. "git이 아닌 것"의 판정과 그 문단을 merge된 모양에 맞춘다.

## 할 일

1. **ledger.** `registry/schema.ts`에 새 schema step `projects.registry.former-identities`를 `PROJECTS_FORMER_IDENTITY_STEPS`로 낸다: `ALTER TABLE projects ADD COLUMN former_identities TEXT NOT NULL DEFAULT '[]'`(JSON 배열). 이미 낸 `PROJECTS_IDENTITY_STEPS`의 SQL은 고치지 않는다. 지키는 것: 기존 줄의 `identity`·`repo`·`remote_*`는 그대로이고 옛 정체는 빈 목록에서 시작한다(옛 기록이 없다). `wiring/remote.ts`의 `schemaStepsAfterTeams` 끝에 펼치는 줄과 `schema-steps.lock.json` 끝의 `{id, sha256}`은 "등록할 것"에 적는다(lead).
2. **남기는 규칙.** `store.ts`의 `storeIdentity`가 null이 아닌 옛 `identity`를 다른 null 아닌 값으로 바꿀 때 옛 값을 `former_identities` 끝에 더한다(같은 값은 한 번, 지금 값은 빼고, 16개를 넘으면 앞에서 버린다). 그래서 잇기, `renew_identity`(file을 쓴 뒤 다시 읽어 `recordIdentity`가 적는다), id file이 ledger에서 난 id를 대신하는 다시 읽기가 모두 같은 자리를 지난다. null로 비우기(`clearIdentity`, 같은 file을 읽은 둘째 copy)는 남기지 않는다(그 id는 다른 project로 갔다). `rows.ts`가 칸을 읽는다.
3. **route.** `identity-api.ts`에 `linkIdentity`, `commands.ts`에 handler(`recordIdentity`처럼 tx 안에서 `loadProject`, `authorizeProject`, 거절 규칙, `storeIdentity`), `contexts.ts`에 command 이름. `revision`은 올리지 않는다. `packages/protocol/projects/mod.ts`의 목록 줄은 "등록할 것"에 적는다.
4. **앱에 싣기**(본보기 commit의 자리 그대로): `app-bridge-types.ts`의 `AppProject`·`AppPlaceWorkspace`, `views.ts`의 `appViewWorkspaceSchema`, `phone-screen.ts`의 place, `ipc/app-frame.ts`, shell main `app-projects.ts`(`project.list`의 `former_identities` → `formerIdentities`), `app-connection.ts`, `view-model.ts`, preload `app-tool.ts`, renderer `app-views.tsx`의 `AppWorkspaceProvider`와 `workspace/{source,core-source,fake-source}.ts`의 `ProjectView`. `workspace-window.tsx`가 `AppWorkspaceProvider`에 값을 넘기는 한 줄(`identity={…}` 옆)은 같은 wave의 `screen-base-scope`가 갖는다: "넘길 줄"에 정확히 적는다(lead가 둘을 merge한 뒤 넣는다).
5. **SDK**(`sdk-note` skill): `@lophn/app-ui` 2.20.0(`Project.formerIdentities`, `PlaceWorkspace`의 project에 `formerIdentities`, guide의 key 절에 "옛 정체로 붙은 줄을 `identity`로 옮긴다"), `@lophn/app-ui-native` 1.7.0(같은 `PlaceWorkspace`를 다시 낸다). skill의 grep으로 pin을 모두 바꾸고(`lophn.ts.tmpl`, `package.json.tmpl`, `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`, guide의 peer 표) `npm install`로 `package-lock.json`을 다시 만든다. 메모 `app-ui-2.20.0.md`(Previous 2.19.0, Breaking no, 옮기는 code의 Before/After, `## Instruction diff`는 git이 낸 guide와 `AGENTS.md.tmpl` diff), `app-ui-native-1.7.0.md`. `AGENTS.md.tmpl`의 project key 줄을 맞춘다. `lophn.supported_from`은 그대로다(더한 칸이라 옛 판으로 봉인한 앱도 뜬다).
6. **화면.** wireframe 먼저(`ui-design` skill): `shell.tsx`에 page `shell-project-link`(dialog가 열린 상태: 다른 기계 이름과 그 project 제목, 이 컴퓨터의 후보 목록, [Link])와 `shell-project-link-empty`(후보가 없다)를 더한다. scene은 `shell/project-link-scene.tsx`이고 renderer의 `LinkProjectDialog`를 fake source로 그린다. `link-dialog.tsx`의 글은 `workspace.ts`의 `projects.link.*` key이고, 잇기 전에 "이 project가 <기계>의 project와 같은 정체를 갖는다" 한 줄을 보인다. `project-window.tsx`의 mock place에 `formerIdentities`를 맞춘다.
7. 문서와 flows: `project-identity.md`(비목표의 "잇기"를 지우고 모델 "쓰는 길"에 잇기, 옛 정체를 남기는 세 길, 지키는 것에 "잇기는 git project의 정체를 바꾸지 못한다"), `app-call.md`(앱이 받는 `formerIdentities`). flows `projects.yaml`(route와 두 거절, renew·다시 읽기가 옛 정체를 남긴다)과 `app-surface.yaml`(앱이 받는 project·place)(`flows` skill).

### 정한 것
- command route다: 정체는 ledger의 project 줄이고 쓰기는 writer의 권한·기록을 거친다(`recordIdentity`와 같은 자리).
- 이 기계에만 쓴다: 다른 기계에 쓰는 길(그 기계의 사람 route)이 없어도 되고, README가 "이 기계의 project에 적는다"다.
- 옛 정체를 남기는 곳은 `storeIdentity` 하나다: 세 길이 모두 그 함수를 지나므로 빠지는 길이 없다.
- 이름: ledger와 route는 protocol의 snake case(`former_identities`), 앱에 가는 값은 SDK의 camel case(`formerIdentities`)다. place workspace는 앱에 그대로 가므로 SDK 이름을 쓴다.
- 16개 상한: 사람이 정체를 바꾸는 일은 드물고, 상한이 있어야 schema가 모양을 거절할 수 있다.
- agent는 잇지 못한다: `renew_identity`처럼 다른 기계에서 무엇이 같은 project인지를 바꾼다(지키는 것 8).

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `shell-project-link`, `shell-project-link-empty`가 renderer의 `LinkProjectDialog`로 그려진다. `node packages/shell/renderer/build.ts`가 선다. protocol의 폰 place schema가 바뀌므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다. check의 sdk notes가 통과한다.
- 위험 test(새 test file을 만들지 않는다):
  - `registry_test.ts`: "잇기는 git project의 정체를 바꾸지 못하고(`conflict`, id 그대로), 이 기계의 다른 project가 가진 id를 적지 못하며, git이 아닌 project에 적은 id는 그 뒤 `recordIdentity`(폴더 다시 읽기)를 거쳐도 남는다."
  - `registry_test.ts`와 `app-projects_test.ts`: "잇기나 renew로 정체가 바뀐 뒤 앱이 옛 정체를 받는다." 잇기와 `renew_identity`가 적는 다시 읽기(file id가 바뀐 `recordIdentity`) 뒤 `project.list`의 `former_identities`에 옛 id가 있고, 앱의 project 목록(`app-projects.ts`)의 `formerIdentities`에 같은 값이 온다.
  - `identity_test.ts`(schema step을 실제 ledger에 적용하는 자리): "새 step을 적용한 뒤 기존 project의 `identity`·`repo`가 그대로이고 옛 정체는 빈 목록이다."
- 남지 않음: 없음(더하기만 한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
