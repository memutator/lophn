# cleanup-shell

shell·design·tools에 남은 옛 route 상수 사용과 role 이름을 지우고, 안 쓰게 된 wording key를 catalog에서 지운다. wave 4에서 wording catalog는 이 task만 고친다.

- 단위: cleanup (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell`
  - `packages/design`
  - `tools/{wireframes,check-deps.ts,check-docs.ts,check-kit.ts,check-modules.ts,check-source.ts,check-source_test.ts,check-style.ts,check-wording.ts,check.ts,context-review.ts,dev.ts,dev_test.ts,move-files.ts,worktree-prep.ts}`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "화면"(Agents 탭, sidebar, 문구), "주소와 넘기기"(누가 받는가: 문구가 이것을 따른다), "뼈대 검토"(wording catalog는 wave 4에 이 task, "이름에서 role 낱말을 뺀다", `coding_agent`는 죽은 코드). `project-docs/products/roadmap/remove-role.md`의 "끝남 기준"
  - `.claude/skills/wording/SKILL.md` 전부. 특히 "key를 지우기 전에"(template literal key), "손으로 생성물을 고치지 않는다", "검사 범위"
  - `.claude/skills/ui-design/SKILL.md`: gallery page를 고칠 때만
  - 새 이름(그대로 두고 옛 이름으로 되돌리지 않는다): `project-docs/plan/remove-role/tasks/contract-agent.md`, `project-docs/plan/remove-role/tasks/contract-session.md`의 "내놓는 것". `project-docs/plan/remove-role/tasks/wireframe-agents.md`의 "내놓는 것"(옛 role label key를 대신할 key), `project-docs/plan/remove-role/tasks/shell-events.md`의 "내놓는 것"(renderer session store 꼴)
  - 뒤 task: `project-docs/plan/remove-role/tasks/cleanup-protocol.md`. 이 task가 합쳐지면 그 task가 protocol의 옛 꼴을 지운다. 그때 shell·design·tools에 옛 꼴 import가 하나도 없어야 한다.
  - architecture: `project-docs/architecture/terminal-agent.md`(남는 것: 사람이 연 터미널의 hook·tracker·탭 icon·점·알림, `memory:coding_agent_harnesses/list`, Settings › Coding agents의 감지·설치), `project-docs/architecture/layers.md`(`tools/check-deps.ts`가 지키는 core 층), `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design`, `design-api`. `project-docs/module-catalog.yaml`의 `packages/shell/*`, `packages/design`, `tools` 줄
  - 코드: `packages/shell/main/desktop/core/{routes,allowlist,client}.ts`(renderer 요청을 route 원본 schema로 검사하는 길), `packages/design/wording/catalog/`, `tools/check-deps.ts`
- 계약:
  - 쓰는 것: wave 1~3이 옮긴 새 꼴 전부. `wireframe-agents`가 더한 wording key.
  - 내놓는 것: `packages/shell`, `packages/design`, `tools`는 protocol의 옛 꼴을 import하지 않고 role 이름과 role label key가 없다. 지운 key는 template literal로 만드는 key인지 앞부분으로 grep한 뒤 지운다(`wording` skill).

## 할 일

wave 1~3이 모두 합쳐진 plan branch에서 시작한다. 아래 file 이름과 줄은 계획을 열 때(HEAD 706993098) 본 것이라 앞 task가 옮겼을 수 있다. 이름으로 grep해 찾는다. 임시 file은 worktree의 `.dev-data/cleanup-shell/`에 둔다. 같이 도는 `cleanup-core`와는 file이 겹치지 않는다(shell은 core를 import하지 않는다).

1. 남은 것 목록을 만든다. 이 목록이 아래 2~5의 일감이다.
   ```sh
   mkdir -p .dev-data/cleanup-shell
   git grep --untracked -nIiE "project[-_ ]?manager|app[-_ ]?engineer|operator" -- packages/shell packages/design tools > .dev-data/cleanup-shell/names.txt
   git grep --untracked -nIwE "PM|AE|CE|pm|ae" -- packages/shell packages/design tools >> .dev-data/cleanup-shell/names.txt
   git grep --untracked -nwE "Role|ROLES|AgentRef|placeOfAgentRef|CallAgent|NamedAgent|CallTo|AgentSession|AgentDefinitionRow|OperatorDefinition|AgentAssignment|BUILTIN_ROLE_NAMES|agentKindSchema|AGENT_SESSION_ROUTES|agentSessionRead|agentSessionList|openAgentSession|CALL_ROUTES|callSend|callSendable|callRead|AGENT_DEFINITION_ROUTES|agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_ASSIGNMENT_ROUTES|agentAssignmentGet|agentAssignmentSet" -- packages/shell packages/design tools > .dev-data/cleanup-shell/symbols.txt
   git grep --untracked -nIw coding_agent -- packages/shell packages/design tools
   git ls-files packages/shell packages/design tools | grep -iE "role|operator|project-manager|app-engineer"
   ```

2. 옛 protocol 꼴과 옛 route 상수 사용을 새 꼴로 바꾼다(계약 "내놓는 것"). 옛 이름 → 새 이름은 `AgentRef`·`CallAgent` → `AgentId`(+ place) 또는 `AgentAtPlace`, `NamedAgent` → `AgentAddress`, `AgentSession` → `PlaceSession`, `AgentDefinitionRow` → `AgentRow`, `AgentAssignment` → `Assignment`, `BUILTIN_ROLE_NAMES` → `LOPHN_AGENT_NAME`, route 상수는 `placeSession*`, `agentCall*`, `AGENT_ROUTES`의 `agent*`, `ASSIGNMENT_ROUTES`의 `assignment*`다(이름 표는 `contract-agent.md`, `contract-session.md`).
   - registry의 옛 → 새 상수 교체(`packages/protocol/**/registry.ts`, core approvals 등록)는 lead가 wave 2 task를 합칠 때 했다. 이 task는 하지 않는다.
   - 계획을 열 때 wave 2·3 어느 task도 소유하지 않았고 lead의 교체 목록(`agents-core`의 "등록할 것")에도 없는 곳: `packages/shell/main/desktop/core/routes.ts`가 `SHELL_ROUTES`에 옛 `AGENT_ASSIGNMENT_ROUTES`를 더한다. 아직 옛 것이면 `ASSIGNMENT_ROUTES`(`packages/protocol/approvals/assignment.ts`)로 바꾸고 보고에 적는다. 근거: shell main은 renderer 요청을 이 표의 route 원본 schema로 검사한다(`packages/shell/main/desktop/core/client.ts`의 `routeByName`, `packages/protocol/client/client.ts`의 input `safeParse`). 옛 꼴이 남으면 새 `{ agent: AgentId }` 입력이 `invalid_input`으로 막힌다.
   - 화면은 route를 resource·method 문자열로 부른다(type check가 못 본다. orchestrate "병렬 규칙"). 아래가 0줄이다:
     ```sh
     git grep -nE "agent-definitions|\"operators\"|builtin-agents|ListAgentDefinitions|ReadAgentDefinition|CreateOperator|ChangeOperator|DeleteOperator|ChangeBuiltinAgent|queued_coding|creator_role" -- packages/shell packages/design tools
     ```
     allowlist의 `memory:`·`upload:profile-images/*`·`file:profile-images/*` 줄은 새 route도 같은 이름이라 그대로 맞다.
   - 칸 이름 `role`·`operator`의 남은 줄을 본다. 남기는 것은 아래 6의 다른 뜻뿐이다:
     ```sh
     git grep -nE "\brole:|\.role\b|\"role\"|\boperator:|\.operator\b" -- packages/shell packages/design tools
     ```
   - `packages/shell/renderer/desktop/settings/providers/core-source.ts`의 지역 type `BuiltinDefinition`은 provider 정의이고 옛 agent 정의 꼴이 아니다. 그대로 둔다.

3. shell에 남은 `coding_agent` 가짜 role을 지운다(README "뼈대 검토").
   - `CallAgent`의 `coding_agent` 가지(대기 목록·알림·앱 공간의 agent 줄)는 `shell-events`가 옮겼어야 한다. 남았으면 지운다: `packages/shell/renderer/desktop/connection/waiting/{model.ts,fake-source.ts,cards/head.tsx}`, `packages/shell/renderer/app-frame/app-space.tsx`, `packages/shell/main/desktop/wiring/notice.ts`.
   - `CallFrom`의 `coding_agent` 가지(받은 메시지의 보낸 이)는 `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`(`senderOf`, `from.kind === "coding_agent"`), `packages/shell/renderer/conversation/agent-tab-data.ts`(`senderOf`)에 있다. 그 가지만 만들던 sender 종류 `coding`(`packages/shell/renderer/conversation/thread/sender-chip.tsx` 등)도 같이 지운다.
   - 정한 것: protocol의 `CallFrom`은 `cleanup-protocol`이 지울 때까지 `coding_agent` 가지를 가진다. shell은 그 가지를 글자로 쓰지 않는다. `switch`가 모든 가지를 요구하면 보낸 session이 있는 가지를 `default`로 받는다(`from.session`은 두 가지 모두에 있다). protocol에서 지워지면 그대로 맞는다.
   - `coding_agent_harnesses`·`coding_agent_terminals`(터미널 agent 층)는 남긴다. `-w` grep은 이것을 잡지 않는다(`project-docs/architecture/terminal-agent.md`).

4. role 이름, role 낱말이 든 이름, 주석, file 이름을 지운다(README "이름에서 role 낱말을 뺀다", "화면").
   - 앞 task가 남겼을 수 있는 것(있으면 role 낱말을 뺀 이름으로 바꾼다): `packages/shell/renderer/workspace/reactions/project-manager.ts`(file 이름. `git mv` 뒤 import를 맞춘다), `SidebarAgentRole`, `AppSpaceAgentRole`, `ROLE_LABEL`, `ROLE_KEY`·`roleKey`(`packages/shell/renderer/workflow/model.ts`), `ROLE_TEXT`·`AgentRole`(`packages/shell/renderer/app-frame/app-detail/model.ts`), `agentByRole`, `ROLE_ORDER`, `roleLabel`, `openRole`, `isRole`, `packages/shell/renderer/desktop/dev-mock/agent.ts`의 `role`.
   - `tools/check-deps.ts`: core 층 주석의 "role 층(agent-roles)"을 `agent-places` 층으로 고치고 `CORE_ROLES` → `CORE_PLACES`(값 `agent-places`), `ROLE_TOOL_DIR` → `PLACE_TOOL_DIR`로 바꾼다. 정한 것: rule `harness-domain`의 role 이름 문자열 검사(`ROLE_NAMES`와 그 message "role 이름")는 지운다. 검사할 role 이름이 없다. feature module protocol 검사와 `HARNESS_LEFTOVERS`는 그대로 둔다. 근거: `project-docs/architecture/layers.md`의 층 규칙은 그대로이고 role만 없어졌다.
   - `tools/wireframes`(mock, pages, drafts)에 남은 role 말과 옛 꼴. page를 더하거나 뺐으면 gallery `tools/wireframes/pages/index.ts`는 보고의 "등록할 것"에 적는다.
   - file 이름을 바꾸면 그 경로를 글로 적은 곳(주석, `tools/check-deps.ts`)을 grep해 맞춘다.

5. wording catalog를 정리한다(`.claude/skills/wording/SKILL.md`). wave 4에서 catalog는 이 task만 고친다(README "뼈대 검토").
   - 후보: key나 값에 role 말이나 지운 coding session 갈래가 든 key, 그리고 lead가 띄울 때 알려 주는 wave 2·3 보고의 "안 쓰게 된 key".
     ```sh
     git grep -nIiE "role|operator|project manager|app engineer|project-manager|app-engineer|coding" -- 'packages/design/wording/catalog/*.ts' ':!packages/design/wording/catalog/*.placeholders.ts'
     ```
     계획을 열 때 있던 묶음: `agents.ts`(`*-operator`, `*.role-*`, `agents.notice.name-fixed-role`), `app-space.ts`(`app-detail.label.role-*`, `App Engineer`가 든 annotation·실패 글, `app-space.title.coding-opened`), `conversation.ts`(`conversation.label.sender-role-*`, `{role}`이 든 `conversation.label.sender-agent-named`), `data.ts`(`waiting.label.agent-*`), `workflow.ts`(`workflow.label.role-*`, Project Manager가 든 empty 글), `workspace-settings.ts`(`jobs.label.agent-*`, App Engineer가 든 `settings.*coding*` 글), `workspace.ts`, `artifact.ts`, `domain.ts`.
   - 후보마다 쓰는지 본다. 전체 key와 key 앞부분(마지막 `-`나 `.` 앞까지) 둘 다 grep한다. template literal로 만드는 key는 전체 이름이 코드에 없다(skill "key를 지우기 전에"):
     ```sh
     git grep -nF "<key>" -- packages tools ':!packages/design/wording/catalog'
     git grep -nF "<key 앞부분>" -- packages tools ':!packages/design/wording/catalog'
     ```
   - 안 쓰면 지운다. 쓰는데 key 이름에 role 낱말이 있으면 `wireframe-agents`가 더한 같은 뜻의 key로 바꾸고, 없으면 role 낱말을 뺀 이름으로 바꾸고 부르는 곳을 고친다. 쓰는데 값에 role 이름이 있으면 값을 다시 쓴다: "Operator"는 "agent", role label은 지운다. 누가 받는지는 README "주소와 넘기기"를 따른다(domain 일과 주인 없는 artifact annotation은 그 place의 lophn, 앱 화면 annotation은 앱 title bar에서 고른 agent, workflow는 그 project place의 session이 쓴다). 값의 `{role}` 같은 placeholder를 빼면 그 key를 부르는 코드도 같이 고친다. skill의 part 마침표 규칙과 안쪽 말 금지를 지킨다.
   - 정한 것: catalog 전체의 안 쓰는 key를 훑지 않는다. 앞부분 grep 없이 훑으면 template literal key(`common.label.tab-*`, `secret-input.*`, `conversation.label.media-*`)를 지운다(skill에 적힌 실수). 후보는 위 둘뿐이다.
   - `npm run wording`으로 `*.placeholders.ts`를 다시 만든다(손으로 고치지 않는다). `node tools/check-wording.ts`를 돌린다.

6. `role` 낱말이 다른 뜻으로 남는 곳은 그대로 둔다: HTML·ARIA role(`packages/design/components/**`, `packages/shell/preload/annotate/`, annotation 대상 element의 role인 `packages/shell/ipc/annotation.ts`·`packages/shell/main/app-frame/annotate.ts`), 창 종류 role(`packages/shell/main/desktop/detached/ipc.ts`), preload role `"shell" | "overlay"`(`packages/shell/preload/shell-api.ts`), 이 저장소 개발 agent의 role(`tools/check-docs.ts`가 읽는 `project-docs/context-component-registry.yaml`의 `roles`), file 옮기기의 참조 종류(`tools/move-files.ts`의 `Role`), `tools/check-source.ts` 금지어 표의 "Roles 화면"(옛 말이 돌아오지 않게 막는 줄이다), tab 종류 `agentKind`(`packages/shell/*/workspace/kinds/`).

7. 끝나면 "남지 않음"의 grep, `npm run wording -- --check`, `node tools/check-wording.ts`, renderer build(`node packages/shell/renderer/build.ts`. check:full이 못 본다), `npm run wireframes`, `npm run check:full`을 돌린다.

**뼈대 검토로 더한 일 (planner):** wave 2·3 brief가 이름만 남기고 동작을 바꾼 것들이다. 살 단계가 동시에 돌아 위 목록에 빠졌을 수 있다. 남아 있으면 role 낱말을 뺀 이름으로 바꾸거나 지운다.
- `SidebarAgent.role`, `AppSpaceAgent.role`, `openProjectManager`, `openedProjectManagerSession`, `projectManagerSession`(`workspace/kinds/artifact.tsx`의 `ArtifactTab.projectManagerSession` 포함), `Workspace.projectManager`, `AppSpace.appEngineer`, `OperatorEditor` alias, `TabKind "operator"`, `AgentRow.operator`, `AgentTabSourceFactory`의 옛 인자 꼴
- 주인 없던 file의 옛 꼴: `desktop/dev-mock/agent.ts`, `desktop/settings/agents/*`, `app-frame/side-panel.tsx`, `workspace/use-tab-host-slices.ts`
- wording: `workflow.empty.sidebar`("Ask the Project Manager…")처럼 role 낱말이 글에 남은 key
- 찾기: `git grep -n -i "projectManager\|appEngineer\|operator" packages/shell packages/design tools`

## 끝남

- `npm run check`가 통과한다. `npm run wording -- --check`가 통과하고 `node tools/check-wording.ts`의 error가 0개다. `node packages/shell/renderer/build.ts`가 된다.
- (화면) `npm run wireframes`가 되고 gallery의 Agents 탭, project 창, 앱 공간, 대화, 대기 목록 page가 그려진다.
- 위험 test: 없음(화면, 문구, 개발 도구는 test하지 않는다. `.claude/skills/write-test`).
- 남지 않음: 아래가 모두 0줄이다.
  ```sh
  git grep --untracked -nIiE "project[-_ ]?manager|app[-_ ]?engineer|operator" -- packages/shell packages/design tools
  git grep --untracked -nIwE "PM|AE|CE|pm|ae" -- packages/shell packages/design tools
  git grep --untracked -nwE "AgentRef|placeOfAgentRef|CallAgent|NamedAgent|CallTo|AgentSession|AgentDefinitionRow|OperatorDefinition|AgentAssignment|BUILTIN_ROLE_NAMES|agentKindSchema|AGENT_SESSION_ROUTES|agentSessionRead|agentSessionList|openAgentSession|CALL_ROUTES|callSend|callSendable|callRead|AGENT_DEFINITION_ROUTES|agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_ASSIGNMENT_ROUTES|agentAssignmentGet|agentAssignmentSet" -- packages/shell packages/design tools
  git grep --untracked -nIw coding_agent -- packages/shell packages/design tools
  git ls-files packages/shell packages/design tools | grep -iE "role|operator|project-manager|app-engineer"
  ```
- `role` 낱말은 다른 뜻으로만 남는다. 아래에 남는 줄은 할 일 6의 다른 뜻뿐이다:
  ```sh
  git grep --untracked -nIE "[Rr]ole|ROLE|역할" -- packages/shell packages/design tools | grep -vE 'role="|role=\{|aria-|getByRole'
  ```

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
