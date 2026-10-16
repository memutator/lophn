# agent-definition-agents

agent 정의의 core 쪽을 새 모델로 바꾼다: role이 고정한 tool 목록, 전역·project·agent 세 설정 층, place 없는 lophn 하나, Operator의 context와 폴더 칸, built-in agent의 생성 규칙. 사람이 role의 tool 목록을 넓히거나 좁히는 길(`permissions`, `ROLE_CAPS`, 층별 교집합)은 지운다.

- 단위: agent-definition (wave 3)
- 선행: agent-definition-roles (`roles/common/mod.ts`가 `ROLE_CAPS`를 재노출하므로 그 줄을 먼저 지워야 이 task가 `role-caps.ts`를 지울 수 있다). contract-calls-places의 새 agent 정의 모양은 계약 고정 뒤라 main에 있다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/agents/` 전체 (`role-caps.ts`, `builtin.ts`, `resolve.ts`, `layers.ts`, `definition-file.ts`, `validate.ts`, `effective.ts`, `inspect.ts`, `reads.ts`, `commands.ts`, `store.ts`, `ports.ts`, `profile-asset.ts`, `mod.ts`, `adapters/`)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.3#9`
  - spec: S4 2장(정의의 구성, 층), 4장 "role이 갖는 tool", 9장, 11장 9·13·18 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S8 2·9장(place와 agent, file 범위) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I1.4#3`, `I1.4#4`, `I2.2#23`(`APP_COMMAND_EXPOSURE` 쪽), `I2.4#3`, `I2.4#4`, `I2.4#5`, `I2.4#37`, `I3.8#1`, `I3.8#2`, `I3.8#3`, `I3.8#4`
  - 결정: `../README.md` 3장 #18·23·57
- 계약:
  - 쓰는 것: `builtinToolNames(role)`(contract-agent-tools-catalog). 새 agent 정의 입력·저장 모양, `BUILTIN_AGENT_NAMES`, `agentPlaceAllowsRole`, role 값 `project_manager`(contract-calls-places의 `protocol/lophn-agent/agent-values.ts`, `agents.ts`). 정의에 들어가는 `mcpServerSchema`·skill 끄기 칸(contract-agent-tools-config).
  - 내놓는 것: `resolveAgent`(새 입력), `ensureLophn(deps)`, `ensureProjectManager(deps, project)`, `ensureAppEngineer(deps, app)`, Operator 만들기·고치기·지우기 command 함수. places-sessions(project 등록)와 app-calls(앱 등록), `core/main/daemon`(첫 기동)이 부른다.

## 할 일

먼저 `grep -rn "lophn-agent/agents\|agents/mod.ts" packages/core --include=*.ts`로 밖에서 쓰는 이름을 센다(run-loop, session, extensions, register.ts, tools가 쓴다). 쓰는 곳이 남은 이름은 지우지 않고 보고한다.

1. 상한 표 지움 (`I1.4#3`, `I2.2#23`): `role-caps.ts` 전체(`ROLE_CAPS`, `RoleCap`, `COMMON_READ_TOOLS`, `ASK_TOOLS`, `CONTEXT_ENGINEER_ONLY_TOOLS`, `CONTEXT_LOOKUP_ONLY_TOOLS`, `APP_COMMAND_EXPOSURE`, `DOCUMENT_READ_TOOLS`), `builtin.ts`의 `roleCapsOf`, `ResolveEnvironment.role_caps`, `productEnvironment`의 상한 칸을 지운다. 대신 `resolveAgent`의 `tools`는 `builtinToolNames(role)`이다. 앱 app-api, 외부 MCP tool, 다른 agent는 agent grant가 session 시작에 붙인다(agent-tools-app-api, agent-definition-extensions). role별 노출 효과 표는 grant의 효과별 기본값이 대신하니 새로 만들지 않는다.
2. 사람이 tool 목록을 바꾸는 길 지움 (`I1.4#4`, `I2.4#5`): 정의 파일의 `permissions` 칸, project 설정 `permissions`, Workspace 기본 권한, `resolve`의 `role_caps ∩ 층별 permissions`, `permissionLayers`, `permissionIssues`와 `over_cap` issue, `validate.ts`의 `capIssues`, `ResolvedAgent`의 `safe_tools`·`app_reads` 칸. 정의 파일에 tool을 적어도 결과 `tools`는 바뀌지 않는다(칸이 contract에서 사라졌으므로 읽을 때 `invalid_input`이 맞다).
3. 층 (`I2.4#4`): 값 출처 층을 `default / workspace / place / definition / session`에서 `전역 / project / agent`(+ composer가 session 하나만 고른 model)로 바꾼다. 같은 항목은 마지막 층이 덮는다. skill과 MCP server는 이름이 같을 때만 덮고 다르면 모두 쓴다. 지침은 덮지 않고 이어 붙이며 그 읽기는 agent-definition-instructions가 한다. model은 전역 기본 하나(`ReadModelDefault`), agent 정의의 model, session의 model 순서로 마지막이 이긴다. role별 기본은 없다. `layers.ts`의 `workspaceModels`·`modelLayers`를 지운다.
4. lophn은 place 없이 하나 (`I2.4#3`): 정의 파일이 project·앱 폴더 아래에 있고 `ResolveInput.place`가 필수이던 것을 고친다. lophn 정의는 전역 한 곳(data root의 agents 폴더)이고 place 없이 resolve된다. `BUILTIN_FILES.lophn`, `agentsDirectory`, `agentPlaceAllowsRole`의 "lophn은 두 위치 모두" 규칙, `instructionPlace`의 session place 따르기를 새 규칙으로 바꾼다. 정의는 project 폴더가 아니라 lophn data 안 project별 폴더에 둔다(Project Manager, App Engineer, Operator).
5. Operator 정의 칸 (`I2.4#37`): 정의 파일에 Operator가 붙은 `contexts`(project place의 Operator만)와 앱 place Operator의 file 범위가 되는 project 폴더 칸을 둔다. 폴더는 사람이 정한다. agent가 grant를 넓히지 못한다: Operator 정의 입력에 grant 칸이 없다. `app_reads`는 지운다.
6. 생성 규칙 (`I3.8#1`~`I3.8#4`):
   - `ensureLophn(deps)`: 첫 기동 때 lophn 정의가 없으면 만든다(옛 assignment bootstrap을 대신한다). 하나만 있어야 한다. 호출은 `core/main/daemon`의 몫이다.
   - `ensureProjectManager(deps, project)`: project마다 하나. 이미 있으면 그대로다. 호출은 places-sessions의 project 등록 쪽이 한다.
   - `ensureAppEngineer(deps, app)`: 앱마다 하나. 호출은 app-calls의 앱 등록 쪽이 한다. 옛 `AppCreated` → assignment 만들기 반응을 대신한다.
   - `commands.ts`: Project Manager와 App Engineer는 사람이 더하거나 지울 수 없다. Operator만 사람이 만든다. agent 이름이 built-in 이름과 겹치는지 보는 검사는 `isBuiltinAgentName`(Project Manager 이름 포함)을 쓴다.
   - 정의는 파일이라 SQL transaction에 묶을 수 없다. 이 함수들은 idempotent(여러 번 불러도 하나)로 만들고, 호출하는 쪽이 등록이 commit된 뒤에 부르게 한다고 보고에 적는다.
7. 옛 assignment 연결 정리: `ports.ts`의 `AssignmentRef`·`AssignmentWriter`, `agentFileName(role, assignment)`처럼 assignment id를 이름으로 쓰던 곳을 place와 role 기준으로 바꾼다. assignment 상태 machine 자체(`core/lophn-agent/assignments/`)는 places-sessions 몫이라 건드리지 않는다.
8. `reads.ts`, `inspect.ts`, `effective.ts`의 읽기 모양을 새 contract(`agentsRead`)에 맞춘다. 화면(screens-agents)이 기대는 것은 contract의 읽기다.
9. (lead가 맞추며 더함 (`I2.3#9`)) 받는 run의 place

- (lead가 더함, places-sessions-projects가 넘긴 것) project 등록 command가 같은 tx에서 `projectManagerProvisioningPort`(`core/projects/registry/ports.ts`, interface는 `core/projects/ports.ts`의 `ProjectManagerProvisioning.create(tx, project)`)를 부른다. 지금 이 port가 비어 있어 등록이 `internal`("project manager is not wired")로 거절된다. 구현을 짓고 `core/main/daemon/wiring/projects.ts`에서 끼운다(추가 소유, lead 승인: 그 file의 이 port 줄). domain module끼리 import하지 않으니 wiring이 둘을 잇는다. `folderResolverPort`는 projects `register.ts`가 이미 등록하니 다시 등록하지 않는다. `ProjectDirectory`는 wiring이 `projectInfoOf(sql, folders, {id}|{name})`·`projectInfoList(sql, folders)`로 채운다.

- (lead가 더함, app-calls-assembly가 넘긴 것) `wiring/projects.ts`에서 `ctx.provide("projectDirectory", …)`로 apps의 `ProjectDirectory`(`core/apps/ports.ts`)를 채운다. 지금 비어 있어 `apps/projects`가 503이다(추가 소유, lead 승인: 그 줄).

- (lead가 더함, platform-desktop이 넘긴 것) renderer는 이제 `upload:profile-images/upload`와 `file:profile-images/read`를 부른다(shell allowlist에 열림). core에 이 route handler가 등록돼 있지 않아 "route not found"다. 등록한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "사람이 정의 파일에 tool을 적어도 role의 고정 tool 목록은 바뀌지 않는다" — `agents/resolve_test.ts`가 role 네 개로 `resolveAgent`를 불러 `tools`가 `builtinToolNames(role)`와 같은지 본다.
  - "Project Manager와 App Engineer는 사람이 더하거나 지우지 못한다" — `agents/commands_test.ts`가 role별로 만들기·지우기를 시도해 `forbidden`을 본다(Operator만 허용). 임시 폴더 data root를 쓴다.
- 남지 않음: `grep -rn "ROLE_CAPS\|roleCapsOf\|APP_COMMAND_EXPOSURE\|over_cap\|capIssues\|safe_tools\|app_reads" packages/core`가 0줄이다. 밖에서 쓰는 곳이 남으면 그 이름을 보고한다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (`ensure*` 호출은 core-wiring의 wiring 파일과 places-sessions, app-calls가 한다)
- 안 쓰게 된 export: 1번~2번에서 밖의 사용처 때문에 남긴 이름
- 정한 것: lophn 정의 파일 위치, 세 층의 합침 규칙 구현, `ensure*`의 idempotent 방식
- 계약 바꾸기 요청: contract-calls-places의 정의 모양에서 모자란 칸

- (lead가 더함, router-calls가 넘긴 것. 추가 소유, lead 승인: `protocol/lophn-agent/sessions.ts`의 `sessionRead`) **turn이 끝까지 돌지 않는 원인이 이 task에 있다.** child의 `prepare`가 `unexpected core reply`로 실패한다. `agents/layers.ts`가 옛 `sessionRead`(옛 session record 모양, output refine `state_seq <= as_of_seq`)를 읽는다. 새 session의 `state_seq`는 표 안 순번이라 refine이 틀린다. `layers.ts`를 `agentSessionRead`로 옮기고, `faux assignment` 같은 옛 읽기를 걷는다. `protocol/lophn-agent/sessions.ts`의 `sessionRead`는 `agentSessionRead`와 같은 경로 `sessions/read`를 가리키니 지운다. 끝나면 개발 data를 새로 만들어 core를 띄우고 사람 메시지 하나로 turn이 시작해 끝나는지(provider가 없으면 `configuration_unavailable`로 끝나는지) 확인해 보고한다.
