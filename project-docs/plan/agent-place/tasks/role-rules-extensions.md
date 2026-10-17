# role-rules-extensions

`extensions/`에 남은 role 층 내용 셋을 `agent-roles`로 옮긴다. (1) 설정 층 규칙: 전역 → project → agent 정의 층으로 MCP server와 skill을 겹치고, 앱 place에는 project 층이 없다. (2) `<data root>/projects/<id>` 아래 path(`skills/`, `extensions.json`)를 harness가 문자열로 다시 짜는 것. (3) PM의 업무 절차인 내장 skill `builtin-skills/context-init`·`context-update` 폴더. harness는 결과(path 함수, 층 목록, 내장 skill 폴더)를 인자로 받는다. 이 셋은 `HARNESS_LEFTOVERS`에 없다(check가 보지 못함). 비우는 file이 없고 사본이 하나로 모이는 것이 끝이다.

- 단위: role-rules (wave 2)
- 선행: role-rules-agent-files, role-rules-data-folder. agent-files가 `register.ts`, `lophn-agent-team.ts`를 먼저 바꾸고(turn-agent를 거쳐 `product-driver.ts`도), data-folder가 path 함수를 준다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/project-settings.ts`
  - `packages/core/lophn-agent/extensions/project-servers.ts`
  - `packages/core/lophn-agent/extensions/registry.ts`
  - `packages/core/lophn-agent/extensions/skills-handler.ts`
  - `packages/core/lophn-agent/extensions/skill-folders.ts`
  - `packages/core/lophn-agent/extensions/skills.ts`
  - `packages/core/lophn-agent/extensions/skills_test.ts`
  - `packages/core/lophn-agent/extensions/mod.ts`
  - `packages/core/lophn-agent/extensions/mcp-snapshot.ts`
  - `packages/core/lophn-agent/extensions/builtin-skills/context-init/SKILL.md`
  - `packages/core/lophn-agent/extensions/builtin-skills/context-update/SKILL.md`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-team.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-extensions.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/agent-roles/place/project-layer.ts`
  - `packages/core/agent-roles/skills/context-init/SKILL.md`
  - `packages/core/agent-roles/skills/context-update/SKILL.md`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(harness와 lophn domain 절), `project-docs/architecture/agent-definition.md`
  - 이슈: `project-docs/issues/layers.md`(첫 절 "harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 본보기: 지난 계획이 같은 일을 나눈 방식은 `project-docs/products/change-log/0.2.0.md`의 "lophn-agent를 harness, role 층, domain tool로 나눔"(role 층이 값·규칙을 갖고 harness는 조립이 넘긴 것으로 돈다. `main/daemon/wiring/lophn-agent-team.ts`가 꽂는다)
  - 지금 코드(열어서 확인함):
    - 층 규칙: `registry.ts`(`createExtensionRegistry`가 `projectOf(place)`로 project 층을 읽고, app place는 `EMPTY_PROJECT_EXTENSIONS`, 전역 위에 project 층을 `mergeMcpLayers`로 겹침), `project-settings.ts`(`PROJECT_EXTENSIONS_FILE`, `projectFolderOf`, `projectSkillsOf`, `projectExtensionsPathOf`, 설정 command·read)
    - path 사본: `project-servers.ts`의 `PROJECT_ID`, `${root}/projects`, `${root}/projects/${id}/...`
    - skill 쪽: `skill-folders.ts`의 `productSkillStores(place)`(agent runtime child가 `LOPHN_HOME`으로 구한 root에서 project 폴더를 만듦), `skills-handler.ts`, `skills.ts`의 `BUNDLED_SKILLS_ROOT`, `builtinForRole`
    - 쓰는 곳: `register.ts`의 `globalSkillSources`(`bundled: BUNDLED_SKILLS_ROOT`), `extensionRegistry`, `bundledSkillRoots: [BUNDLED_SKILLS_ROOT]`(launch spec), `main/agent-runtime/product-driver.ts`의 `productSkillStores(place)`, `main/daemon/wiring/lophn-agent-extensions.ts`의 `registeredMcpServers(ctx.ledgerPath)`, `main/daemon/wiring/lophn-agent-runtime.ts`의 `mcpServerSnapshot(ctx.ledgerPath)`
    - 내장 skill 선언: `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS`(`role: "project_manager"`). 선언은 renderer(`shell/renderer/workspace/agents/core-extensions.ts`)도 읽는 protocol 계약이라 옮기지 않는다. 옮기는 것은 `SKILL.md` 폴더다.
- 계약:
  - 쓰는 것: `role-rules-data-folder`의 `placeDataFolder`, `projectsDataArea`, `projectIdOfFolder`
  - 내놓는 것:
    - `agent-roles/place/project-layer.ts`: `PROJECT_LAYER = { skillsFolder(root, project): string; extensionsFile(root, project): string; settingsFolderArea(root): string; projectIdOfFolder(name): string | null }` 꼴. 값은 지금 `projectSkillsOf`·`projectExtensionsPathOf`·`PROJECT_EXTENSIONS_FILE`·`PROJECT_ID`와 같다. 앱 place에는 project 층이 없다는 판정(`layerOf(place): "project" | null` 같은 것)도 여기 둔다.
    - `agent-roles/skills/`: `BUNDLED_SKILLS_ROOT`(= 이 폴더)와 두 `SKILL.md`(내용 그대로. `tools/move-files.ts`로 옮겨 history를 잇는다)
    - harness `extensions/`: 위 값을 함수·문자열 인자로 받는다. harness 안에 `projects`·`PROJECT_EXTENSIONS_FILE`·`prj_` 문자열 사본이 남지 않는다.

## 지켜야 할 것(계획 README, 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

그 밖에: harness 폴더의 비운 file에는 role 이름 문자열 리터럴(`"project_manager"`, `"app_engineer"`, `"operator"`; `tools/check-deps.ts`의 `ROLE_NAMES`)이 type 자리(`Exclude<Role, "operator">` 같은 것)까지 한 줄도 남으면 안 된다. 판정은 role 표가 함수로 내놓는다(`isOperator(role)` 꼴). `tools/check-deps.ts`는 이 task가 비운 file의 `HARNESS_LEFTOVERS` 항목만 지운다. 다른 task도 다른 줄을 고치므로 소유 줄에 두지 않았다(겹치면 lead가 rebase에서 두 쪽을 다 남긴다). 항목을 안 지우면 check가 "목록에서 빼라"고 실패한다.

## 할 일

1. `agent-roles/place/project-layer.ts`를 만들고 `project-settings.ts`·`project-servers.ts`·`registry.ts`·`skills-handler.ts`·`skill-folders.ts`의 path 계산과 "project 층 있음/없음" 판정을 그 값을 인자로 받게 바꾼다. 인자 모양은 가장 단순한 것(deps 칸 하나)으로 한다. `parseProjectExtensions`·`EMPTY_PROJECT_EXTENSIONS`·file 형식(`extensions.json` 칸)은 harness에 남는다(설정 file의 모양은 harness의 것).
2. 내장 skill 폴더를 `tools/move-files.ts`로 `packages/core/agent-roles/skills/`로 옮긴다. `BUNDLED_SKILLS_ROOT` 상수를 `skills.ts`·`skill-folders.ts`·`mod.ts`에서 지우고 `globalSkillSources`·`productSkillStores`·`agentRuntimePermissions`의 `bundledSkillRoots`에 인자로 넘긴다. 읽기 허락과 발견 폴더가 같은 값을 쓰게 한다(지금 `register.ts` 주석). 설치 묶음에 이 폴더가 실리는지(`tools/`의 package 쪽이 `extensions/builtin-skills` 경로를 이름으로 거는 곳이 없는지)를 grep으로 확인한다. 지금은 없다.
3. `register.ts`, `lophn-agent-team.ts`: `createLophnAgent` ports에 `projectLayer`와 `bundledSkillsRoot`를 더하고 team file이 꽂는다. `main/agent-runtime/product-driver.ts`는 `productSkillStores(place, { projectLayer, bundledSkillsRoot })`로 부른다(agent runtime child는 composition root라 role 층을 import해도 된다).
4. `mcp-snapshot.ts`의 `registeredMcpServers`·`mcpServerSnapshot`이 project 폴더 규칙을 deps로 받게 하고 두 호출처(`wiring/lophn-agent-extensions.ts`, `wiring/lophn-agent-runtime.ts`)가 넘긴다. 이 세 곳은 한 줄씩만 고친다. `extensions/mcp-*.ts`의 다른 부분(`mcp-grants` 단위의 몫)은 건드리지 않는다.
5. `skills_test.ts`를 새 입력에 맞춘다(기존 "내장 context-init은 사람 skill이 덮지 못한다" 계열 test는 그대로 살린다). 새 test는 쓰지 않는다.
6. 이 task는 `HARNESS_LEFTOVERS` 항목을 지우지 않는다(해당 file이 없다).

## 끝남

- `deno task check`가 통과한다.
- 동작을 바꾸지 않는다: role 4개(lophn, project_manager, app_engineer, operator)의 tool 목록·prompt bytes·정의 file 자리를 전후로 비교한다. 이 task가 건드리지 않는 것(tool 목록, prompt)은 소유 file 밖이라 diff에 없음을 보이면 되고, 정의 file 자리와 이름·기본 profile처럼 이 task가 옮기는 값은 옮기기 전 값을 임시 script(commit하지 않는다)로 뽑아 옮긴 뒤 값과 같음을 보인다. 확인은 unit test와 `deno task check`까지다.
- 새 E2E·subprocess·서버 test를 만들지 않는다.
- 위험 test: 없음(기존 `skills_test.ts`가 "끌 수 없는 내장 skill은 같은 이름의 사람 skill이 덮지 못한다"를 지키고, project 폴더 자리는 `role-rules-data-folder`의 표 test가 지킨다. 이 task는 호출만 바꾼다).
- 남지 않음: `grep -rn "\"projects\"\|/projects/\|PROJECT_ID\|builtin-skills\|BUNDLED_SKILLS_ROOT" packages/core/lophn-agent --include=*.ts`가 `_test.ts`를 빼고 0줄이다. `packages/core/lophn-agent/extensions/builtin-skills/` 폴더가 없다. 지운 path 사본: `grep -rn "extensions/builtin-skills" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

