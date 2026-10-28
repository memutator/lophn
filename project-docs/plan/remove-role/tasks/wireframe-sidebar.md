# wireframe-sidebar

project 창 sidebar와 앱 title bar agent select가 모든 agent(lophn과 사람이 만든 agent)를 보이고, 고르면 그 place의 session을 열게 한다. role로 가르던 sidebar 묶음과 PM session 바로 열기를 그 project place의 lophn session 열기로 바꾼다. gallery의 project 창·앱 공간 page를 같이 고친다(`ui-design`).

- 단위: wireframe (wave 2)
- 선행: wireframe-agents. wording key와 Agents 탭의 source 꼴을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar`
  - `packages/shell/renderer/workspace/{source,fake-source}.ts`
  - `packages/shell/renderer/workspace/reactions/project-manager.ts`
  - `packages/shell/renderer/workspace/kinds/{agent.tsx,host.ts}`
  - `packages/shell/renderer/app-frame/{agent-select.tsx,agent-select.module.css,app-agents.ts,app-space.tsx}`
  - `tools/wireframes/mock/app-space/data.ts`
  - `tools/wireframes/pages/screens/{project-window,project-workspace,project-app,app-space}.tsx`
  - `tools/wireframes/pages/screens/app-space`
- 읽을 것:
  - 제품 결정: `project-docs/plan/remove-role/README.md`
    - "화면": project 창 sidebar와 앱 agent select는 모든 agent를 보인다. 고르면 그 place의 session을 연다.
    - "session과 place 종류": session의 정체는 (agent id, place)다.
    - "주소와 넘기기": domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다. 앱 화면 annotation이 고른 agent에게 가는 것은 `shell-workspace`(wave 3)의 몫이다.
    - "뼈대 검토": wave 2와 3을 함께 올린다. wave 3 화면 task가 남은 옛 꼴을 옮긴다.
  - 앞 task: `project-docs/plan/remove-role/tasks/wireframe-agents.md`의 할 일 1(소유 밖이 쓰는 이름: `AgentListRow.role`은 lophn·operator 값만 온다), 7(`useSidebarAgents`가 목록을 받은 순서대로, lophn 첫 줄로 낸다), 9(`AgentSettingsEditor`와 별칭 `OperatorEditor`, `mock/agents-data.ts`의 새 값)
  - 계약 모양: `project-docs/plan/remove-role/tasks/contract-session.md`의 `placeSessionOpen`·`placeSessionList`. 이 task는 route를 직접 부르지 않는다. 탭과 pane에 (agent id, 창의 place)를 넘기고, 대화 source(`conversation/`, `shell-conversation`)가 그것으로 session을 연다.
  - architecture:
    - `project-docs/architecture/ui-kit.md` "gallery가 정본이다"
    - `project-docs/architecture/place-session.md` "지키는 것"의 첫 줄(session을 열 때 정해지고 바뀌지 않는다)
    - `project-docs/architecture/annotation.md`(주인 없는 artifact annotation이 받는 session. `projectManagerSession`이 넘기는 값이다)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `event-stream`(renderer session store). `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `tools`
  - 본보기(화면)와 renderer 짝:

    | gallery file | 그리는 renderer | page id |
    |---|---|---|
    | `tools/wireframes/pages/screens/project-window.tsx`(`PageSidebar`, `AGENTS`, `PageNewTabMenu`, `JOBS`) | `workspace/sidebar/{project-sidebar,agent-panel}.tsx`, `use-agent-panel.ts`, `workspace/add-tab-menu.tsx`(읽기만) | `new-agent-sidebar`, `new-agent-sidebar-runs`, `new-sidebar-collapsed`, `new-tab-menu-browser` |
    | `tools/wireframes/pages/screens/project-workspace.tsx` | 영역 file(page 목록). `new-agent-sidebar`·`new-agent-sidebar-runs`의 render는 `project-files/pages.tsx`(`wireframe-agents` 것) | 위와 같다 |
    | `tools/wireframes/pages/screens/project-app.tsx` | project 창 흉내(`openAgent`의 탭 열기, `NewTabMenu` 고르기) | project 창을 쓰는 page 전부 |
    | `tools/wireframes/pages/screens/app-space.tsx`, `app-space/{pages,space}.tsx` | `app-frame/{app-space,agent-select}.tsx`, `app-agents.ts` | `new-app-space`, `new-app-agent-pane`, `new-app-runs`, `new-app-side-panel`, `new-app-version-failed`, `new-app-annotate-list` |
    | `tools/wireframes/mock/app-space/data.ts`(`fixedRuns`) | `workspace/sidebar/run-list.tsx`의 `RunRecordView` | `new-app-runs` |

    가짜 data를 대신하는 것: agent 줄은 `AgentsSource.list`(`wireframe-agents`가 전역 목록으로 바꾼 것)다. project sidebar gallery는 `mock/agents-data.ts`의 `AGENT_ROWS`, 앱 공간 gallery는 `createFakeAgentsSource()`다. session 줄은 renderer session store(`useSessions()`)의 `agent`와 `place`다.
  - wording: 새 key가 없다. 쓰는 key는 있는 것이다(`project-workspace.heading.agents`, `project-workspace.button.manage-agents`, `project-workspace.button.new-session-with`, `app-space.label.agent-select`, `app-space.button.manage-agents`, `run-list.button.background`, `run-list.heading.background`). `project-workspace.label.role-operators`를 쓰지 않게 된다. 새 key가 필요하면 고치지 말고 보고한다(wave 2 catalog는 `wireframe-agents`만 고친다).
  - 코드(지금 모양):
    - `workspace/sidebar/sidebar-agent.ts`(`SidebarAgent`, `SidebarAgentRole`), `agents-section.tsx`(옮김 전 re-export)
    - `workspace/sidebar/use-agent-panel.ts`(`AgentPanelView.builtins`·`operators`, `BUILTIN_ORDER`), `agent-panel.tsx`(Operators 머리 줄)
    - `workspace/sidebar/panel-sessions.ts`(`agentByRole`, `openedProjectManagerSession`, `agentRowOf`, `agentRow`, `panelSessions`, `panelRuns`)
    - `workspace/reactions/project-manager.ts`(`openProjectManager`), `workspace/kinds/host.ts`(`AgentViewSlice.projectManagerSession`), `workspace/kinds/agent.tsx`(`openAgent`는 이미 탭 필드에 `place: host.projectId`를 넣는다)
    - `app-frame/agent-select.tsx`(`AppSpaceAgent`, `ordered`), `app-agents.ts`(`useAppAgents`), `app-space.tsx`(`appEngineer` prop, `latestSession`, `openAgent`, `openSession`, annotation 받는 session, `keyOf` import)
    - `workspace/fake-source.ts`의 `PARTICIPANTS`와 workflow 가짜 기록
- 계약:
  - 쓰는 것: `wireframe-agents`의 Agents 탭 source와 wording key. `contract-session`의 `placeSessionList`, `placeSessionOpen`. `contract-agent`의 `agentList`, `AgentId`.
  - 내놓는 것: sidebar와 agent select의 agent 줄은 `AgentId`이고, session을 열 때 (그 agent, 그 창의 place)로 연다. renderer session store의 agent 꼴(`CallAgent`)은 이 task가 바꾸지 않는다(`shell-events`가 바꾼다).

## 할 일

화면 모양은 renderer에서 고치고 gallery는 그 component를 그대로 그린다(`ui-design`). 이 task 뒤에도 renderer session store의 `SessionEntry.agent`는 옛 `CallAgent`다. 거기서 agent id를 읽는 곳을 한 함수로 모아 `shell-events`가 그 함수만 고치게 한다(정한 것).

1. **소유 밖이 쓰는 이름은 남긴다**(orchestrate 병렬 규칙 2). 칸 이름과 인자는 두고 값의 뜻만 바꾼다. 지우거나 이름을 바꾸는 일은 그 file을 가진 wave 3 task(`shell-workspace`, `shell-desktop`)와 `cleanup-shell`이 한다.

   | 이름 | 소유 밖에서 쓰는 곳 | 남기는 모양 |
   |---|---|---|
   | `SidebarAgent`(`assignment`, `role`, `name`, `profile`, `waiting`)와 `SidebarAgentRole` type | `workspace/workspace.tsx`(254줄 `row.role === "lophn"`, 743줄 `openRole("lophn" \| "project_manager")`), `workspace/use-tab-host-slices.ts`, `workspace/agents/sidebar-agents.ts`(`wireframe-agents`가 `role`을 `"lophn"`·`"operator"`로 채운다) | type 그대로. `assignment`의 값은 `AgentId`, `role`은 `"lophn"`·`"operator"`만 온다 |
   | `panel-sessions.ts`의 `agentByRole`, `agentRow`, `openedProjectManagerSession`, `panelSessions`, `panelRuns`, `runOpenedSessions`, `sessionDot`, `KnownSessions` | `workspace.tsx`, `use-tab-host-slices.ts` | 이름·인자 그대로 |
   | `reactions/project-manager.ts`의 `openProjectManager` | `workspace.tsx`(13줄 import, 817줄) | 이름 그대로. 하는 일만 바꾼다 |
   | `AgentViewSlice.projectManagerSession()`(`kinds/host.ts`) | `kinds/artifact.tsx:130`, `use-tab-host-slices.ts:140` | 이름 그대로 |
   | `openAgent`(`kinds/agent.tsx`)의 입력 `{ agent, name, session? }` | `workspace.tsx`, `use-tab-host-slices.ts` | 그대로 |
   | `AppSpaceAgent`(`assignment`, `role`, `name`, `profile`)와 그 `role` type(`"lophn" \| "app_engineer" \| "operator"`) | `app-frame/app-runs.ts`(46·72·75·97줄이 `"lophn"`·`"operator"`·`"app_engineer"`와 견준다), `app-frame/side-panel.tsx` | type 그대로. 값은 `"lophn"`·`"operator"`만 낸다 |
   | `AppSpaceProps.appEngineer` | `desktop/main.tsx:372` | 이름 그대로. 뜻은 "그 앱 place의 lophn 새 session으로 연다"다 |
   | `run-list.tsx`의 `RunRecordView`, `RunRow`, `RunList`, `SessionItem` | `app-frame/{app-runs,side-panel}.ts(x)`, `workspace/core-source.ts`, gallery `app-space/space.tsx` | 바꾸지 않는다(run 기록 꼴은 `runs-core`와 wave 3이 옮긴다) |
   | `workspace/source.ts`의 type(`RunFilter.agent: CallAgent`, `WorkflowInstanceView.participants`) | `workspace.tsx:289`(`{ role: "lophn" }`), `workflow/instance-view.tsx` | 바꾸지 않는다 |
   | `project-window.tsx`의 `TabKind`(`"operator"` 포함), `TabSpec`, `PageSidebar`, `PageNewTabMenu` | `agents-tab.tsx`의 `agentTab`이 `kind: "operator"`를 낸다(`wireframe-agents` 것), 여러 page | `TabKind` 값은 그대로 |

2. **session 줄과 agent 줄 잇기**(`workspace/sidebar/panel-sessions.ts`). 근거: README "session의 정체는 (agent id, place)다", "고르면 그 place의 session을 연다".
   - `sessionAgentKey(entry: SessionEntry): string | null`을 더한다. store의 `agent`(지금 `CallAgent`)를 agent id 글로 바꾼다: `{ role: "lophn" }` → `"lophn"`, `{ role: "operator", agent }` → `agent`, 그 밖(옛 PM·AE, `coding_agent`, null) → null. 윗줄 주석: "renderer session store의 agent를 읽는 한 곳. `shell-events`가 store를 `AgentId`로 바꿀 때 이 함수만 고친다". 이 task가 고치는 file에서 store 줄의 `agent`를 role로 읽는 곳은 이 함수뿐이다.
   - `sessionAtProject(entry, project)`: `entry.place`가 `{ kind: "project", id: project }`인가.
   - `agentRow(entry, agents, project)`: 이 project place의 session만 줄을 찾는다(`sessionAtProject`). 줄은 `agents.find((row) => row.assignment === sessionAgentKey(entry))`다. 그래서 home의 lophn session과 다른 project의 session은 이 sidebar에 없다.
   - `openedProjectManagerSession(entries, project)`: 이 project place의 열린(`ended === null`) lophn session 가운데 마지막 것이다. 윗줄 주석: 이름은 소유 밖이 불러 남긴다. 이 project의 lophn session이 주인 없는 artifact annotation을 받는다(README "domain 일을 받는 쪽").
   - `agentByRole`은 그대로 둔다(`"lophn"`으로 부르면 lophn 줄이다). 주석의 "Operator는 여럿이라"를 고친다.
   - `panelRuns`: run 기록의 `target.agent`(`RunRecordView`, 아직 `CallAgent`)를 같은 규칙(lophn → `"lophn"`, operator → id)으로 줄에 잇는 작은 함수를 따로 둔다. place 거르기는 부르는 쪽(`workspace.tsx`의 `runs({ place })`)이 한다.
3. **한 목록으로**(`use-agent-panel.ts`, `agent-panel.tsx`). 근거: README "모든 agent를 보인다", "role label은 지운다".
   - `AgentPanelView`의 `builtins`·`operators`를 `agents: readonly AgentGroup[]` 하나로 바꾼다. 순서는 받은 agent 목록 그대로다(lophn이 첫 줄. `useSidebarAgents`가 그렇게 준다). `BUILTIN_ORDER`와 `SidebarAgentRole` import를 지운다.
   - `agent-panel.tsx`는 `view.agents`를 그린다. Operators 머리 줄(`project-workspace.label.role-operators`)을 지운다. 묶음 머리의 Manage와 줄마다의 hover `+`는 그대로다.
4. **sidebar 줄 값**(`sidebar-agent.ts`, `agents-section.tsx`).
   - `sidebar-agent.ts`: type은 1번 표대로 둔다. 주석을 고친다: `assignment`는 `AgentId`(`asg_…`가 아니다), `role`은 lophn과 그 밖 둘만 오고 type의 나머지 값은 소유 밖 `workspace.tsx`가 견주어 남아 있다(`shell-workspace`가 지운다). "App Engineer는 앱 공간의 agent라 여기에 없다"를 지운다. 주석에 옛 role 이름을 글로 쓰지 않는다(끝남의 grep).
   - `agents-section.tsx`: `grep -rn "agents-section" packages tools`가 이 file 말고 0줄이면 지운다. 남았으면 두고 보고한다.
5. **project place의 lophn 바로 열기**(`reactions/project-manager.ts`, `kinds/host.ts`, `kinds/agent.tsx`). 근거: README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다".
   - `openProjectManager(env)`: lophn 줄(`agentByRole(env.agents(), "lophn")`)을 `openedProjectManagerSession(env.sessions(), env.project)` session으로 연다. 없으면 새 session 탭이다. 머리 주석과 함수 주석을 "그 project place의 lophn session을 연다"로 고친다. 이름은 1번 표대로 둔다.
   - `kinds/host.ts`: `projectManagerSession()` 주석을 "이 project place에서 열려 있는 lophn session. 없으면 null"로 고친다.
   - `kinds/agent.tsx`: `openAgent`는 이미 (agent id, `host.projectId`)를 탭 필드에 넣는다. 동작은 고치지 않는다. 머리 주석의 "place에 놓인 agent 하나(built-in 또는 Operator)"를 "agent 하나와 이 project place의 session 하나"로 고친다.
6. **앱 agent select**(`agent-select.tsx`, `agent-select.module.css`, `app-agents.ts`). 근거: README "앱 agent select는 모든 agent를 보인다".
   - `app-agents.ts`: `source.list(app)`이 주는 전역 목록을 그대로 옮긴다. Project Manager 거르기를 지운다. `role`은 `assignment === LOPHN_AGENT_ID ? "lophn" : "operator"`로 만들고 `AgentListRow.role`을 읽지 않는다(그 칸이 안 쓰이게 된다. 보고한다). 머리 주석을 고친다.
   - `agent-select.tsx`: `ordered`는 lophn을 맨 앞에, 나머지를 받은 순서대로 둔다(`"app_engineer"` 고르기를 지운다). 머리 주석, `AppSpaceAgent` 칸 주석, "약속하는 DOM" 주석의 "lophn, App Engineer, Operator들"을 "lophn, 다른 agent들(받은 순서)"로 고친다. "알림의 [Ask App Engineer]" 언급을 지운다. type은 1번 표대로 둔다.
   - `agent-select.module.css`: 목록이 길어지면 menu가 창 밖으로 넘친다. design `Menu`가 이미 넘침을 다루면 고치지 않는다. 넘치면 token 변수로 최대 높이와 scroll만 더한다.
7. **앱 공간의 agent pane**(`app-frame/app-space.tsx`). 근거: README "고르면 그 place의 session을 연다", "새 앱은 … 그 앱 place의 lophn session에 맡긴다". pane의 Agent 화면은 이미 (assignment, `{ kind: "app", id: app }`)로 대화 source를 얻는다(`side-panel.tsx`). 이 file은 어느 agent·session을 pane에 둘지만 정한다.
   - `appEngineer` prop이 참이면 처음 pane은 `{ mode: "agent", assignment: "lophn", session: null }`이다. prop 주석을 "이 앱 place의 lophn 새 session으로 열어 시작한다(방금 만든 앱)"로 고친다.
   - `latestSession(assignment)`: 열린 session 가운데 `place`가 이 앱이고 `sessionAgentKey(item) === assignment`인 마지막 것이다. `keyOf` import와 `role` 견줌(`"coding_agent"`, `"app_engineer"`)을 지운다.
   - `openSession(target, forApp)`: target이 null이면(이 앱의 일) lophn을 `latestSession("lophn")`으로 연다. target이 있으면 그 session의 `place`가 이 앱이고 `sessionAgentKey`가 agent select 목록에 있을 때만 연다.
   - annotation을 보낼 session: `pane.assignment === "app_engineer"`를 `"lophn"`으로 바꾼다. 고른 다른 agent에게 보내는 것(`agent` 칸)은 `shell-workspace`의 몫이라 하지 않는다.
   - coding 터미널 요청 쪽에 `"app_engineer"`가 남아 있으면(`coding-shell`이 지우지 않았으면) `"lophn"`으로 바꾼다.
8. **workspace source와 fake**(`workspace/source.ts`, `workspace/fake-source.ts`).
   - `source.ts`: type은 1번 표대로 바꾸지 않는다. role 말이 있는 주석만 고친다.
   - `fake-source.ts`의 workflow 가짜 기록: 참가자 `pm`(`{ role: "project_manager", name: "Project Manager" }`)을 `lophn`(`{ role: "lophn", name: "lophn" }`)으로, `operator`(`{ role: "operator", name: "Eval analyst" }`)를 `analyst`(`{ role: "agent", name: "Eval analyst" }`)로 바꾸고, 그 key를 쓰는 `by`·`with`·`participant` 줄을 모두 맞춘다. `PM_SESSION`·`PM_SESSION_2`·`OP_SESSION`과 "PM이 …" 주석도 이름을 바꾼다. view type의 `role`은 `string`이라 type은 그대로 지난다. 화면은 `name`을 먼저 보인다.
9. **gallery**. 근거: `ui-design`(page id는 바꾸지 않는다. title은 영어, description은 한국어).
   - `project-window.tsx`:
     - `AGENTS`: `AGENT_ROWS`(`wireframe-agents`가 lophn, Eval analyst, Experiment planner, Budget reviewer로 바꾼다)에서 `role: row.id === "lophn" ? "lophn" : "operator"`로 만든다. `"project_manager"` 갈래와 `operators` 머리 줄 거르기를 지운다.
     - `NewTabPick`: `"agent-project-manager"`를 지우고 `` `agent-operator:${string}` ``를 `` `agent:${string}` ``로 바꾼다. `PageNewTabMenu`의 `onAgent`를 맞춘다.
     - `JOBS`: `JobView`(`desktop/settings/jobs/source.ts`)의 꼴을 따른다. 이 task를 시작할 때 `jobs-core`가 합쳐져 `JobView`의 `creator`·`agent` 꼴이 바뀌었으면 Project Manager이던 값을 그 project의 lophn으로 맞춘다. 아직이면 값을 그대로 두고 보고한다(뼈대 문제: `jobs-core`가 뒤에 합쳐지면 이 file에서 깨진다).
     - `PageSidebar` 주석의 "lophn·Project Manager·Operator 둘"을 고친다.
   - `project-app.tsx`: `ENGINEER_TAB`과 `"agent-project-manager"` 갈래를 지운다. `agent:<id>`는 `newConversationTab(id)`다. `OperatorEditor` import를 `AgentSettingsEditor`로 바꾼다(그러면 `wireframe-agents`가 남긴 별칭 `OperatorEditor`가 안 쓰인다. 보고한다). `FLUSH`와 `case "operator"`의 탭 종류 값은 그대로다.
   - `project-workspace.tsx`: `new-agent-sidebar`(lophn과 다른 agent가 한 목록, 각자 이 project의 열린 session), `new-agent-sidebar-runs`, `new-tab-menu-browser`의 description에서 Project Manager·Operators를 지운다.
   - `app-space/space.tsx`: `AGENT_KEY`를 `{ lophn: "lophn", "Budget reviewer": BUDGET_REVIEWER_ID }`로 바꾸고 기본값을 `"lophn"`으로 한다. `RUN_SNAPSHOTS`는 그대로 둔다(run 기록 꼴, 1번 표).
   - `app-space/pages.tsx`: `pane={{ agent: "App Engineer" }}`를 `"lophn"`으로 바꾼다. 주석을 고친다.
   - `app-space.tsx`(영역 file): `new-app-space`(펼친 select에 lophn, Eval analyst, Experiment planner, Budget reviewer, 구분선 아래 Background와 Manage), `new-app-runs`, `new-app-version-failed`, `new-app-annotate-list`([Send to agent]), coding page들의 description에서 App Engineer·Operator를 지운다.
   - `mock/app-space/data.ts`의 `fixedRuns`: App Engineer run 둘(`run_engineer_running`, `run_engineer_failed`)을 Budget reviewer run(`{ role: "operator", agent: BUDGET_REVIEWER_ID }`)으로 바꾸고 id에서 engineer를 뺀다. 그래야 소유 밖 `app-runs.ts`가 목록에 남긴다(그 file은 operator run을 agent 목록으로 거른다). 머리 주석을 고친다. `RunRecordView` 꼴은 그대로다.
   - 같은 영역 file 안의 변경이라 `pages/index.ts`는 고칠 것이 없다.
10. 지우거나 바꾼 이름(`builtins`, `operators`, `BUILTIN_ORDER`, `ENGINEER_TAB`, `"agent-project-manager"`, `agent-operator:`, `keyOf`)을 `grep -rn`해 소유 file의 주석과 글에 남은 것을 고친다. 소유 밖 file이 type check에서 깨지면 고치지 말고 보고한다. 1번 표를 지키면 깨지는 곳이 없다.

## 정한 것

- store 줄의 agent를 읽는 곳을 `panel-sessions.ts`의 `sessionAgentKey` 하나로 모은다. 이유: `shell-events`(wave 3)가 store를 `AgentId`로 바꾸면 store를 role로 읽는 줄이 모두 깨진다. `shell-events`는 `panel-sessions.ts`를 넘길 줄로 갖지만 `app-frame/app-space.tsx`는 갖지 않는다. 이 함수를 거치면 `app-space.tsx`를 고치지 않고도 지난다.
- project sidebar의 session 줄은 이 project place의 session만이다. home의 lophn session과 다른 project의 session은 보이지 않는다. 이유: README "고르면 그 place의 session을 연다", session의 정체는 (agent, place)다. 지금은 place 없는 lophn session이 모든 project sidebar에 보였다.
- `SidebarAgent`·`AppSpaceAgent`의 `role`과 PM 이름이 든 export(`openProjectManager`, `openedProjectManagerSession`, `projectManagerSession`)는 이름과 type을 남기고 값과 하는 일만 바꾼다. 이유: 쓰는 곳(`workspace.tsx`, `use-tab-host-slices.ts`, `kinds/artifact.tsx`, `app-runs.ts`)이 이 task의 소유 밖이다(orchestrate 병렬 규칙 2). 이름 바꾸기는 `shell-workspace`와 `cleanup-shell`이 한다.
- 앱 공간 gallery의 App Engineer run은 Budget reviewer run으로 바꾼다. 이유: lophn run으로 바꾸면 소유 밖 `app-runs.ts`가 lophn run을 걸러 Background page가 빈다. 앱 place의 lophn run을 보이는 것은 run 꼴을 옮기는 wave 3의 몫이다.
- 위험 test를 더하지 않는다. 이유: 화면 목록과 묶음이다(AGENTS.md "속도", `write-test` "쓰지 않는 test").

## 끝남

- `npm run check`가 통과한다.
- `node packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- `npm run wireframes`가 되고, 아래 page가 고친 component로 그려진다(`ui-design` "확인"대로 띄워 본다).
  - `new-agent-sidebar`: lophn, Eval analyst, Experiment planner, Budget reviewer가 한 목록이고 "Operators" 머리 줄이 없다.
  - `new-agent-sidebar-runs`: Background 줄이 지금처럼 보인다.
  - `new-app-space`: 펼친 select가 lophn, Eval analyst, Experiment planner, Budget reviewer, Background, Manage 순서다.
  - `new-app-agent-pane`: lophn pane이 열린다.
  - `new-app-runs`: Budget reviewer run과 tool run이 보인다.
  - `new-app-side-panel`, `new-app-annotate-list`: 그려진다.
- 위험 test: 없음.
- 남지 않음:
  - `grep -rn "project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|role-operators\|keyOf" packages/shell/renderer/workspace/sidebar packages/shell/renderer/workspace/reactions/project-manager.ts packages/shell/renderer/workspace/kinds/agent.tsx packages/shell/renderer/workspace/kinds/host.ts packages/shell/renderer/workspace/fake-source.ts packages/shell/renderer/app-frame/agent-select.tsx packages/shell/renderer/app-frame/app-agents.ts packages/shell/renderer/app-frame/app-space.tsx tools/wireframes/pages/screens/project-workspace.tsx tools/wireframes/pages/screens/project-app.tsx tools/wireframes/pages/screens/app-space.tsx tools/wireframes/pages/screens/app-space tools/wireframes/mock/app-space/data.ts`가 남기는 type 두 줄(`sidebar-agent.ts`의 `SidebarAgentRole`, `agent-select.tsx`의 `AppSpaceAgentRole`)뿐이다.
  - `grep -n "project_manager\|Project Manager\|Operator" tools/wireframes/pages/screens/project-window.tsx`가 `JOBS`의 줄(`jobs-core`가 아직이면)뿐이다.
  - `grep -n "agent?\.role\|agent\.role\|\.role !==\|\.role ===" packages/shell/renderer/app-frame/app-space.tsx packages/shell/renderer/workspace/reactions/project-manager.ts`가 0줄이다.

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
