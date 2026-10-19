# dp-agent-roles-scope

App Engineer가 갖던 tool 목록, file 범위, 자격 조건, Operator 관리를 Project Manager(PM)에 붙이고 App Engineer를 role 층에서 지운다. PM의 file 범위는 자기 project 폴더 + 그 project 앱의 source + project 층 skill 폴더이고, 다른 project의 앱 source·앱 data는 닿지 않는다. 지침(prompt 글)은 `dp-agent-roles-prompt`가 한다.

- 단위: role-merge (wave 2)
- 선행: dp-agents-core. 같은 `lophn-agent/agents/` file(`ports.ts`, `adapters/node-fs.ts`)에 폴더 만들기 한 줄을 더하기 때문이다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/agents/`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/agent-roles/hooks.ts`
  - `packages/core/agent-roles/hooks_test.ts`
  - `packages/core/agent-roles/place/data-folder.ts`
  - `packages/core/agent-roles/place/data-folder_test.ts`
  - `packages/core/agent-roles/place/instruction-rules.ts`
  - `packages/core/agent-roles/place/instruction-rules_test.ts`
  - `packages/core/agent-roles/place/place-folders.ts`
  - `packages/core/agent-roles/place/place-folders_test.ts`
  - `packages/core/agent-roles/place/project-layer.ts`
  - `packages/core/agent-roles/place/session-directory.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/agent-roles/tools/operator.ts`
  - `packages/core/agent-roles/tools/operator-place.ts`
  - `packages/core/agent-roles/tools/operator-place_test.ts`
  - `packages/core/lophn-agent/agents/ports.ts`
  - `packages/core/lophn-agent/agents/adapters/`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/daemon/wiring/lophn-agent.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위는 place가 정한다"), `project-docs/architecture/agent-definition.md`(role 고정 목록, "agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다"), `project-docs/architecture/coding-agent.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > PM이 App Engineer의 일을 맡는다 / project skill 쓰기", `project-docs/products/AGENT-ROLE.md`의 A1~A16, C9
  - 쓰기 전: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `dp-app-project`의 `appOfProject`(`packages/core/apps/lookups.ts`)
  - 내놓는 것:
    - PM의 고정 tool 목록 = 공통 + 읽기 + 작업 tool + 옛 App Engineer 쓰기 tool(`ticket.create`, `ticket.update`, `ticket.verify`, `ticket.cancel`, `problem.set_state`, `app.link_source`, `package.publish`, `operator.create`, `operator.update`) + `app.app_api`. lophn은 그대로다.
    - PM 자격(agent credential)의 `conditions.app` = 그 project의 앱(앱이 없으면 없음), `annotations.get` 허용.
    - `placeScope`(`place-folders.ts`)의 PM 범위: 읽기·쓰기 모두 project 폴더들, 그 project 앱의 source 폴더, 그 project의 skill 폴더(`PROJECT_LAYER.skillsFolder`).

## 할 일

1. `tool-lists.ts`: `ROLE_WRITE_TOOLS.project_manager`에 옛 App Engineer 쓰기 tool을 더하고 `APP_API_TOOLS`(`app.app_api`)를 lophn과 PM에 준다(`builtinToolNames`의 `role === "app_engineer"` 조건을 `project_manager`로). `context.*`·`glossary.set` 줄은 건드리지 않는다(`domain-kinds`). `app_engineer` 항목은 `Record<Role, …>`·`switch` 때문에 type이 요구하는 동안만 빈 값으로 남긴다. 지우는 일은 `dp-place-protocol`이 `ROLES`에서 뺄 때 한다. `tool-lists_test.ts`의 "목록의 이름마다 정의가 있다"와 `packages/core/main/agent-tools_test.ts`를 맞춘다.
2. `credentials.ts`: `roleOperations`의 `annotationsGet` 허용을 `project_manager`로 옮긴다(73째 줄). `agentConditions`(82째 줄)가 `app?: string` 입력을 받아 PM이면 조건 `app`으로 싣는다(`app_engineer` 조건과 `place.kind === "app"` 갈래는 지운다). wiring `lophn-agent-runtime.ts`의 `conditionsFor`(215째 줄)를 `(input) => agentConditions({ ...input, app: <project의 앱 id> })`로 감싼다. 앱 id는 wiring이 ledger 읽기 연결로 `appOfProject`를 불러 얻는다(turn마다 credential이 새로 발급되므로 앱이 나중에 생겨도 다음 turn에 반영된다). 근거: 티켓·문제·annotation·package publish·source 연결의 담당 앱 판정이 모두 `conditions.app`을 읽는다(`packages/core/apps/tickets/model.ts`의 `boundApp`, `packages/core/apps/packages/publish.ts`, `packages/core/apps/registration/commands.ts`).
3. `place-folders.ts`: `PlaceFacts`에서 `place?.kind === "app"` 갈래와 `role === "app_engineer"` 줄을 지운다. project place의 PM은 `[...projectFolders, appSource(있으면), skillsFolder]`를 읽고 쓴다(`PlaceFacts.appSource`가 이제 project place의 앱 source이고 `skillsFolder: string | null`을 더한다). `draftFolders`는 그대로다(`domain-kinds`가 지운다). project의 Operator는 project 폴더만이다(그대로). `runtimeFolders`(agent runtime child의 Deno 권한)에 project마다의 skill 폴더들을 입력으로 더하고, `appSources`는 active 앱 source 전체 그대로 둔다. `draftRoot`(=`<data>/projects`)가 아직 있으면 `<data>/projects/<prj>/app/`(앱 data·release 사본)과 `packages/core/agent-roles/agents/`, `extensions.json`까지 쓰기 권한에 들어가므로, draft 폴더가 생기는 `<data>/projects/<prj>/contexts`의 목록으로 좁힌다. `domain-kinds`가 draft를 지웠으면 `draftRoot`째 지운다.
4. `place-folders-glue.ts`(`placeFoldersOf`, `runtimeFoldersOf`): 사실 모으기를 맞춘다. project place면 `appSource = appSourcePath(sql, appOfProject(sql, id))`(그 project 앱 하나만), `skillsFolder = PROJECT_LAYER.skillsFolder(dataRoot, id)`. 앱 place 갈래(`place?.kind === "app"`)를 지운다.
5. skill 폴더가 file tool의 허용 폴더가 되려면 실제로 있어야 한다(`packages/core/lophn-agent/tools/file/scope.ts`의 `resolveInPlace`가 없는 폴더를 건너뛴다). `AgentFileSystem`(`packages/core/lophn-agent/agents/ports.ts`)에 `ensureFolder(path)`를 더하고 `adapters/node-fs.ts`가 구현한다. `packages/core/agent-roles/agents/ensure.ts`의 `ensureProjectManager`가 PM 정의 file과 함께 `PROJECT_LAYER.skillsFolder`를 만든다.
6. App Engineer를 지운다: `packages/core/agent-roles/agents/app-engineer.ts`(file 지움)와 `ensureAppEngineer`, wiring `lophn-agent.ts`의 `withAppEngineer`·`ensureAppEngineer`·`appCreate` import, `packages/core/agent-roles/agents/role-table.ts`의 `app_engineer` 갈래(`slotOf`, `builtinRefs`의 app 갈래, `BUILTIN_FILES`), `packages/core/agent-roles/place/session-directory.ts`의 `app_engineer`와 `{ app }` place 갈래(Operator의 place도 project만), `packages/core/agent-roles/place/instruction-rules.ts`·`packages/core/agent-roles/place/data-folder.ts`(`placeDataFolder`·`placeAgentsFolder`가 project만)·`packages/core/agent-roles/place/project-layer.ts`(`projectOf`)의 앱 갈래. 시험 `role-table_test.ts`, `instruction-rules_test.ts`, `data-folder_test.ts`의 앱 사례를 지운다.
7. `packages/core/agent-roles/tools/operator.ts`: `operatorPlace`(40째 줄)와 `resolvePlace`(63~90째 줄)를 project만 받게 한다. `operator.create` 설명문의 "(Project Manager: your project, App Engineer: your app)"에서 App Engineer를 뺀다. `packages/core/agent-roles/tools/operator-place.ts`의 `operatorPlaceAllowed`는 PM이 자기 project에서만 허용한다. `operator-place_test.ts`에서 앱 사례를 지운다.
8. `hooks.ts` 7째 줄 주석 "agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다"를 "agent 정의는 …, PM은 project 층 skill 폴더를 쓴다"로 고친다(지침 파일 쓰기 Gate는 그대로).
9. 위험 test를 쓴다(아래).
10. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "PM의 file 범위는 자기 project의 폴더·앱 source·skill 폴더뿐이고 다른 project의 앱 source도, 자기 project의 `app/`(data·release 사본)·`packages/core/agent-roles/agents/`·`extensions.json`도 포함하지 않는다." `place-folders_test.ts`의 `placeScope` 표에 PM 두 project 사례를 더하고, `placeFoldersOf`(glue)로 같은 것을 두 project·두 앱 fixture에서 한 번 더 본다. 테스트는 둘 이하.
- 남지 않음: 아래가 0줄이다. (`Record<Role, …>`·`switch`가 요구하는 빈 `app_engineer` 줄은 예외이고 보고에 적는다.)
  - `grep -rn "app_engineer\|App Engineer" packages/core/agent-roles --include=*.ts` 중 `packages/core/agent-roles/roles/`(prompt 글)를 뺀 곳
  - `grep -rn "ensureAppEngineer\|withAppEngineer" packages`

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(wiring은 소유에 든다)
- 안 쓰게 된 export
- 정한 것: PM 자격의 `conditions.app`로 담당 앱을 판정했다(아래 위험 참고) / skill 폴더는 PM 정의 file과 같이 만든다 / 폴더 없는 project의 `LOPHN.md`는 PM 범위에 넣지 않았다(file 범위는 폴더 단위라 `resolveInPlace`가 file 하나를 root로 못 쓴다)
- 넘길 줄: `domain-kinds`·`artifact`가 같이 고치는 `place-folders.ts`·`tool-lists.ts`는 해당 줄만 고쳤다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 자격에 `conditions.app`이 생기면 `packages/core/storage/ledger/target-authorization.ts`의 `outsideBoundApp`(context·document target을 앱 밖으로 막는다)이 PM에게도 걸린다. `domain-kinds`가 context 읽기를 지우기 전에 land하면 PM의 context 읽기가 잠시 막힌다

## lead가 더함

- `draftRoot`는 좁히지 않는다. `domain-kinds`의 `dk-prompt-place`가 `runtimeFoldersOf`(`packages/core/main/daemon/place-folders-glue.ts`)에서 `draftRoot`를 지우고 project마다 `kindsFilePath`를 file 항목으로 넣는다(`runtimeFolders` 입력의 `draftRoot`가 `kindsFiles`로 바뀐다). `artifact`는 같은 함수에 `artifactFolders`를 더했다. project skill 폴더는 그 옆에 폴더 항목 하나로 더한다. 띄울 때 그 변경이 base에 있으면 그 위에서, 없으면 `draftRoot` 줄은 그대로 두고 skill 폴더만 더한다(lead가 rebase 때 두 쪽을 맞춘다).
- `artifact`가 `credentials.ts`에서 `annotationsGet`을 PM·Operator에게 열었고 `agentConditions`에 `project` 조건을 더했다. `conditions.app`은 그 옆에 더한다. 같은 뜻의 조건을 둘로 만들지 않는다.
- Deno 권한 함정: 쓰기 허락이 file 하나뿐이면 이미 있는 부모 폴더라도 `Deno.mkdir(parent, {recursive: true})`가 NotCapable로 거절된다. skill 폴더는 core 쪽(`ensureProjectManager`)에서 만들고, runtime child 안에서 만들지 않는다.
