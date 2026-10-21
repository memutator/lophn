# hr-screen-wireframe

`ui-design` skill로 wireframe부터, run이 연 session을 project sidebar의 Agent 쪽에서 그대로 두지 않고 그 session을 연 run 아래에 묶어 보이는 모양을 정한다. renderer component에 optional props로 모양을 더하고 gallery에 고정 data page를 세우면, 사람이 gallery를 보고 고른다.

- 단위: screen (wave 2)
- 선행: hr-contract-runs.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/agent-panel.tsx`
  - `packages/shell/renderer/workspace/sidebar/use-agent-panel.ts`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.module.css`
  - `packages/shell/renderer/workspace/sidebar/run-list.tsx`(새 file)
  - `packages/shell/renderer/app-frame/agent-select.tsx`
  - `packages/shell/renderer/app-frame/side-panel.tsx`
  - `packages/shell/renderer/app-frame/side-panel.module.css`
  - `packages/shell/renderer/app-frame/app-space.tsx`
  - `packages/shell/renderer/app-frame/app-runs.ts`(새 file)
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-files/pages.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space/pages.tsx`
  - `tools/wireframes/pages/screens/app-space/space.tsx`
  - `tools/wireframes/mock/app-space/data.ts`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery가 정본, 새 page 만들기, drive로 상태 고정, 확인), `.claude/skills/wording/SKILL.md`(key 이름, 값에 쓰지 않는 안쪽 말 `run`)
  - 계획: `project-docs/plan/headless-run/README.md`의 "이 계획에서 더 정한 것"(run이 연 session은 열린 채 남는다)과 "뼈대 검토에서 정한 것"의 화면 줄(project sidebar, 앱의 agent 목록, tool run은 run 목록에만, `--session` session은 원래 자리)
  - roadmap: `project-docs/products/roadmap/headless-schedule.md`의 "정할 것" 1(1시간마다 도는 job이 sidebar에 session을 하루 24개 쌓는다)
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 `runRecordSchema`(`RUN_STATES`, `target`, `session_opened`)
  - architecture: `project-docs/architecture/ui-kit.md`("gallery가 정본이다"), `project-docs/architecture/place-session.md`(session은 저절로 끝나지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `tools`
  - 본보기(화면, project sidebar): page `new-agent-sidebar`(`tools/wireframes/pages/screens/project-workspace.tsx`)와 그 component `AgentsGroup`(`tools/wireframes/pages/screens/project-files/pages.tsx`), 고정 data를 props로 옮기는 `PageSidebar`·`SidebarSpec`·`PANEL_SESSIONS`·`OPEN`(`tools/wireframes/pages/screens/project-window.tsx`), `SESSIONS`·`AGENT_ROWS`(`tools/wireframes/mock/agents-data.ts`). `ProjectApp`(`tools/wireframes/pages/screens/project-app.tsx`, 읽기만)은 `SidebarSpec`을 펼쳐 `PageSidebar`에 넘긴다
  - 본보기(화면, 앱 공간): page `new-app-space`·`new-app-agent-pane`(`tools/wireframes/pages/screens/app-space.tsx`), 진짜 `AppSpace`를 fake source와 drive로 그리는 `tools/wireframes/pages/screens/app-space/space.tsx`(`build`, `AGENT_KEY`, `useDrive`의 `[data-agent-select]`), `tools/wireframes/pages/screens/app-space/pages.tsx`
  - renderer(project sidebar): `packages/shell/renderer/workspace/sidebar/agent-panel.tsx`(`Group`, `SessionItem`, `Dot`, Recent 묶음), `use-agent-panel.ts`(`PanelSession`, `agentPanelOf`, `RECENT_LIMIT`), `project-sidebar.tsx`, `panel-sessions.ts`(읽기만. `agentRow`가 session을 agent 줄로 찾는 규칙)
  - renderer(앱 공간): `packages/shell/renderer/app-frame/agent-select.tsx`(머리 주석의 "약속하는 DOM"), `side-panel.tsx`(`AgentPaneState`의 `manage`가 같은 Agent 탭 칸에 관리 화면을 여는 꼴, `Head`, `ManageBody`), `app-space.tsx`(`useAppAgents`, `useSessions`, `AgentSelect`의 `onManage`), `app-agents.ts`
  - session 제목을 읽는 법: `packages/shell/renderer/workspace/workspace.tsx`의 `knownSessions` effect(agent마다 `agentViewSource(...).sessions()`)
- 계약:
  - 쓰는 것: hr-contract-runs의 run 기록(`id`, `kind`, `target`, `session`, `session_opened`, `state`, `created_at`)
  - 내놓는 것(hr-screen-data가 이 이름과 모양에 기댄다. 이 task만 바꾼다):
    - `packages/shell/renderer/workspace/sidebar/run-list.tsx`:

      ```ts
      export type RunStateView = "running" | "done" | "failed" | "cancelled";

      /** run 기록(`runs/list`)에서 화면이 쓰는 칸. renderer는 protocol을 type check하지 않아 id는 문자열이다. */
      export interface RunRecordView {
        readonly id: string;
        readonly kind: "agent" | "tool";
        /** agent: 이름을 푼 agent(`SessionEntry.agent`와 같은 `CallAgent`). tool: 앱 id와 tool 이름. */
        readonly target:
          | { readonly agent: CallAgent }
          | { readonly app: string; readonly tool: string };
        readonly session: string | null;
        readonly session_opened: boolean;
        readonly state: RunStateView;
        readonly created_at: string;
      }
      ```

    - `packages/shell/renderer/workspace/sidebar/use-agent-panel.ts`:

      ```ts
      /** project sidebar의 run 한 줄. hr-screen-data가 run 기록에서 옮긴다(agent run만). */
      export interface PanelRun {
        readonly id: string;
        /** 받는 agent 줄의 `SidebarAgent.assignment`. */
        readonly agent: string;
        readonly state: RunStateView;
        /** 시작한 때(epoch ms, `created_at`). */
        readonly at: number;
        /** run이 연 session(`session_opened`). 부르는 쪽은 이 session을 `sessions`에서 빼고 넘긴다. `--session` run은 null. */
        readonly session: PanelSession | null;
      }
      ```

    - `ProjectSidebar`와 `AgentPanel`의 run 묶음 props: `ProjectSidebar`의 `runs?: readonly PanelRun[]`이고, `AgentPanel`은 지금처럼 `view`로 받는다(`AgentPanelView.runs`). optional이라 주지 않으면 지금 모양 그대로이고 `workspace.tsx`는 고치지 않아도 된다. hr-screen-data가 이 props를 실제 data로 채운다.
    - `AppSpace`의 `runs?: () => Promise<ReadResult<readonly RunRecordView[]>>`(`ReadResult`는 `packages/shell/renderer/workspace/source.ts`의 것). 주지 않으면 agent select에 새 항목이 없고 지금 모양 그대로이며 `packages/shell/renderer/desktop/main.tsx`는 고치지 않아도 된다. hr-screen-data가 core 통로를 넘긴다.

## 정한 것

문서가 모양을 정하지 않아(README "모양은 wireframe에서 정한다") 살 단계에서 추천안으로 정했다. 사람이 gallery를 보고 바꿀 수 있다.

1. **project sidebar의 Agent 쪽:** Agents 묶음과 Recent 사이에 run 묶음을 새로 둔다. run 줄(받는 agent의 avatar와 이름, 상태, 시작 시각) 아래에 그 run이 연 session 줄을 agent 묶음의 session처럼 들여 쓴다. run이 연 session은 agent 묶음과 Recent에 나오지 않는다. 이유: README "그 session을 연 run 아래에 묶어 보인다". agent 묶음 안에 넣으면 agent 묶음이 다시 길어진다.
2. **run 묶음은 새것부터 5개만 보인다**(`RECENT_LIMIT`와 같은 수). run이 없으면 묶음 머리도 없다. 이유: job이 시간마다 run을 만들어도 sidebar가 자라지 않는다(roadmap "정할 것" 1). "더 보기"는 문서에 없는 요구라 두지 않는다. 밀려난 run session은 그 agent의 Agent 탭 session 목록에 남는다.
3. **project sidebar에는 lophn, 이 project의 Project Manager, 이 project에 놓인 Operator의 agent run만 온다.** App Engineer와 앱에 놓인 Operator의 run, tool run은 앱 공간에 온다. 이유: README "뼈대 검토에서 정한 것".
4. **앱 공간:** 앱의 agent 목록(위쪽 바의 agent select, `app-agents.ts`가 "그 앱 자리의 agent 목록"이라 부른다)에 Manage 위로 항목 하나를 더한다. 고르면 오른쪽 패널의 Agent 탭이 Manage처럼 같은 칸에 그 앱의 run 목록을 연다. 목록에는 App Engineer와 이 앱에 놓인 Operator의 agent run(아래에 run이 연 session)과 이 앱의 tool run(session 줄 없음)이 새것부터 다 있다. session 줄을 누르면 같은 칸에 그 agent의 Agent 화면이 그 session으로 열린다. 이유: 앱 공간에는 sidebar가 없다. tool run은 앱 하나를 부르므로 그 앱의 목록이 tool run이 보이는 "run 목록"이다. agent select menu(design `Menu`)는 항목이 한 줄씩이라 run과 session을 들여 쓸 수 없다.
5. **보이는 이름은 "Background"다**(묶음 머리, agent select 항목, 패널 탭 이름). 이유: `run`은 wording의 `INTERNAL_WORDS`라 값에 쓰지 않는다(key 이름에는 써도 된다). CLI와 뒤의 job이 화면 없이 연 일이다.
6. **상태 표시:** running은 sidebar session의 일하는 중 점(`working`)과 같은 점, failed는 "Failed", cancelled는 "Cancelled", done은 표시 없이 시각만 둔다. 실패 이유와 결과 값은 보이지 않는다. 이유: 화면 계약은 위 일곱 칸이고, 결과는 CLI `lophn run show`가 보인다.
7. **`RunList`는 `workspace/sidebar/`에 두고 `project-sidebar.module.css`를 그대로 쓴다.** 앱 공간은 `AgentsPage`처럼 workspace에서 import한다. 이유: session 줄 모양이 하나다. `parts/`로 옮기면 CSS 사본이 생긴다.
8. **앱 공간에서 run 기록을 읽어 줄로 옮기는 hook(`app-runs.ts`)은 이 task가 쓴다.** 이유: gallery는 진짜 `AppSpace`를 그리고 `AppSpace`에는 gallery 전용 prop을 두지 않는다(ui-design). 그래서 `AppSpace`는 읽는 함수를 받고, gallery는 고정 기록을 돌려주는 함수를, hr-screen-data는 core 통로를 넘긴다. project sidebar는 `PageSidebar`가 props를 바로 넘기므로 옮기기를 hr-screen-data가 한다.
9. **앱 공간이 읽는 때:** run 목록을 열 때 한 번, 열려 있는 동안 `useSessions()`가 바뀔 때마다. 이유: run event가 계약에 없다. agent run은 그 turn의 `TurnEnded`로 끝나 session store가 바뀐다. tool run은 session event가 없어 다른 session이 움직이거나 목록을 다시 열 때까지 상태가 늦을 수 있다.

## 할 일

1. gallery부터 그린다(ui-design "새 화면(page) 만들기"). page가 서고 사람이 볼 수 있는 것이 먼저다. 아래 2-8의 renderer 일과 같이 하되, gallery file에는 모양을 덮는 CSS나 gallery 전용 prop을 두지 않는다. page id는 주소라 한 번 정하면 바꾸지 않는다. title은 영어, description은 한국어 한두 문장이다. `tools/wireframes/pages/index.ts`는 고치지 않는다(page는 기존 영역 file에 더한다).

   | page id | 영역 file | 보이는 상태 |
   |---|---|---|
   | `new-agent-sidebar` | `project-workspace.tsx` | 그대로다. run이 없어 run 묶음 머리도 없고 지금 모양과 같다 |
   | `new-agent-sidebar-runs`(새) | `project-workspace.tsx` | Agent 쪽 run 묶음: running(session은 일하는 중) 하나, done 하나, failed 하나, cancelled 하나, `--session`으로 이어 쓴 done 하나(run 줄 아래가 비었고 그 session은 원래 agent 묶음에 그대로 있다). run이 연 session은 agent 묶음과 Recent에 없다 |
   | `new-app-space` | `app-space.tsx` | 펼친 agent select에 새 항목이 Manage 위에 있다. description을 맞춘다 |
   | `new-app-runs`(새) | `app-space.tsx` | 오른쪽 패널 Agent 탭의 run 목록: App Engineer running(아래 session), 이 앱 Operator done(아래 session), App Engineer failed(아래 session), tool run done, tool run failed(둘 다 session 줄 없음) |
   | `new-app-runs-empty`(새) | `app-space.tsx` | 같은 칸에 run이 없다는 한 줄 |

   - project sidebar: `tools/wireframes/mock/agents-data.ts`에 run이 연 session 줄(`SessionRow`)과 run 고정 data를 더한다. run session 줄은 `SESSIONS`와 따로 둔다(`sessionsOf`를 쓰는 다른 page의 session switcher가 바뀌지 않게). `tools/wireframes/pages/screens/project-window.tsx`의 `SidebarSpec`에 `runs?: boolean`을 더한다. 켜면 `PageSidebar`가 고정 run을 `PanelRun`으로 옮겨 `ProjectSidebar`에 `runs`로 넘긴다(run session은 `sessions`에 넣지 않는다). 끄면 run도 run session도 넘기지 않는다(`new-agent-sidebar`가 바뀌지 않는다). run session 줄을 누르면 지금 session 줄처럼 그 탭이 열린다(`PageSidebar`의 `onSession`이 두 목록에서 찾는다). `tools/wireframes/pages/screens/project-files/pages.tsx`에 component 하나를 더한다(`AgentsGroup` 꼴, `sidebar={{ mode: "agent", runs: true }}`). 묶음이 한 화면에 들지 않으면 `scrollToAgents`를 쓴다.
   - 앱 공간: `tools/wireframes/mock/app-space/data.ts`에 고정 run 기록(`RunRecordView[]`, tool 이름은 Orders 앱의 것)을 둔다. `tools/wireframes/pages/screens/app-space/space.tsx`의 `build`가 모든 page의 진짜 `AppSpace`에 같은 `runs` 읽는 함수를 넘긴다(진짜 앱처럼 agent select에 항목이 늘 있다). `AppSpaceProps`에 run 목록을 연 채 시작할지와 빈 목록으로 할지를 더하고, drive는 `[data-agent-select]`를 누른 뒤 새 항목을 누른다. `tools/wireframes/pages/screens/app-space/pages.tsx`에 component 둘을 더한다. agent run의 session 제목은 fake 대화 source(`mockAgentTabSource`)가 아는 session id를 쓰면 보인다. 모르는 id는 `conversation.label.session-untitled`("New session")로 보인다.
2. `packages/shell/renderer/workspace/sidebar/run-list.tsx`(새): 위 계약의 `RunStateView`, `RunRecordView`와 줄 값 `RunRow`, component `RunList`를 둔다.
   - `RunRow`: `id`, `name`(agent 이름 또는 tool 이름), `profile`(agent avatar, tool run은 null), `state`, `at`(epoch ms), `session`(run이 연 session의 `PanelSession`, 없으면 null).
   - `RunList`는 run 줄과 그 아래 들여 쓴 session 줄을 그린다. session 줄은 `agent-panel.tsx`의 `SessionItem`과 같은 모양이다(같은 component를 export해 같이 쓴다. 사본을 만들지 않는다). session 줄을 누르면 `onSession(session: PanelSession)`을 부른다. run 줄은 누르는 곳이 아니다.
   - 상태와 시각은 줄 오른쪽 끝 고정 열에 둔다(ui-design "모든 화면의 규칙"). running 점은 `Dot`과 같은 표시(`data-state="working"`, 접근 이름 `common.label.tab-working`)다. 시각은 `formatRelativeTime`이다.
   - tool run 줄의 아이콘은 `packages/shell/renderer/icons/mod.ts` 묶음에서 고른다(lucide를 직접 import하지 않는다).
   - DOM 표식: 줄마다 `data-run=<id>`, 상태 `data-run-state=<state>`. session 줄은 지금처럼 `data-session=<id>`.
3. `packages/shell/renderer/workspace/sidebar/use-agent-panel.ts`: 위 계약의 `PanelRun`을 더한다. `AgentPanelView`에 `runs: readonly RunRow[]`를 더하고 `agentPanelOf(agents, sessions, runs = [])`가 `PanelRun`을 `RunRow`로 옮긴다(agent 줄을 `assignment`로 찾아 이름과 avatar, 못 찾은 run은 뺀다, `at`이 큰 것부터 5개). `useAgentPanel`의 인자와 memo 의존을 맞춘다. session을 빼는 일은 하지 않는다(부르는 쪽이 이미 뺐다. 정한 것 1과 계약).
4. `agent-panel.tsx`: `AgentPanelProps`가 그대로 `view`만 받으므로 `view.runs`가 비지 않으면 Agents 묶음과 Recent 사이에 run 묶음 `<section data-runs="">`을 그린다(머리 글 `run-list.heading.background`). `SessionItem`을 `run-list.tsx`가 쓰게 export하거나 `run-list.tsx`로 옮긴다. `project-sidebar.tsx`: `ProjectSidebarProps`에 `runs?: readonly PanelRun[]`(주석: 비면 묶음이 없다)를 더해 `useAgentPanel`에 넘긴다. `project-sidebar.module.css`: run 줄과 상태 글에 필요한 class만 더하고 값은 token(var)을 쓴다.
5. `packages/shell/renderer/app-frame/agent-select.tsx`: props에 `onRuns?: () => void`를 더한다. 있으면 Manage 바로 위에 항목 하나(`separatorBefore`, 글 `run-list.button.background`, `data-agent-runs=""`, `[data-agent]`가 아니다)를 둔다. 없으면 지금 그대로다. 머리 주석의 "약속하는 DOM"을 맞춘다. 항목 id는 assignment(`asg_…`)와 겹치지 않는 고정 문자열이다(`MANAGE`와 같은 꼴).
6. `packages/shell/renderer/app-frame/side-panel.tsx`: `AgentPaneState`에 `{ readonly mode: "runs" }`를 더한다. `SidePanelProps`에 `runs?: readonly RunRow[]`를 더하고, `runs` mode의 몸은 `RunList`(비면 `run-list.empty.none` 한 줄, `data-runs-empty=""`)다. session 줄을 누르면 `onState({ mode: "agent", assignment: session.agent, session: session.id })`. `Head`의 Agent 탭 이름은 `runs` mode에서 `run-list.heading.background`다. `side-panel.module.css`: 몸의 여백과 scroll에 필요한 class만 더한다.
7. `packages/shell/renderer/app-frame/app-runs.ts`(새): 앱 공간의 run 줄을 만드는 hook(`app-agents.ts` 꼴)이다. 정한 것 4, 8, 9를 따른다.
   - 읽는 함수(`AppSpace.runs`)를 run 목록이 열릴 때와 열려 있는 동안 `useSessions()`가 바뀔 때 부른다. 실패하면 빈 목록이다(`useAppAgents`가 실패를 무시하는 것과 같다).
   - 이 앱의 run만 남긴다: tool run은 `target.app`이 이 앱이다. agent run은 `target.agent`가 이 앱의 App Engineer이거나 `useAppAgents` 목록에 있는 Operator다(Operator를 찾는 칸은 `panel-sessions.ts`의 `agentRow`와 같다). lophn과 Project Manager run은 project sidebar 몫이라 뺀다.
   - `RunRow.session`은 `session_opened`일 때만 채운다: 상태와 열림은 `useSessions()`의 그 session, `PanelSession.agent`는 그 agent의 `AppSpaceAgent.assignment`, 제목은 `workspace.tsx`의 `knownSessions`처럼 이 앱 agent마다 `agentViewSource({ assignment, place: { kind: "app", id: app } }).sessions()`에서 읽고 모르면 `conversation.label.session-untitled`다. `--session` run은 null이라 그 session은 원래 자리(그 agent의 session 목록)에만 있다.
   - 이 file은 `.ts`라 check-wording이 직접 문구를 못 잡는다. 화면 글은 `t("...")`로만 쓴다.
8. `packages/shell/renderer/app-frame/app-space.tsx`: `AppSpaceProps`에 계약의 `runs?`를 더한다. 있으면 `AgentSelect`에 `onRuns`(`setPane({ mode: "runs" })` 뒤 `showTab("agent")`, `onManage`와 같은 꼴)를 넘기고, `app-runs.ts`의 줄을 `SidePanel`의 `runs`로 넘긴다. 없으면 지금 그대로다.
9. wording(`packages/design/wording/catalog/project.ts`, key 앞부분 `run-list.`). 추천 key와 값(값에 `run`을 쓰지 않는다):
   - `run-list.heading.background`: "Background"
   - `run-list.button.background`: "Background"
   - `run-list.label.failed`: "Failed"
   - `run-list.label.cancelled`: "Cancelled"
   - `run-list.empty.none`: "Nothing has started in the background yet."
   - 일하는 중 점은 `common.label.tab-working`을 쓴다. 더한 뒤 `deno task wording`으로 `project.placeholders.ts`를 만든다(손으로 고치지 않는다).

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, 위 표의 다섯 page가 Light와 Dark에서 그려진다(`python3 -m http.server <port> -d tools/wireframes` 뒤 `http://localhost:<port>/dist/index.html?frame=<page id>&theme=dark`). `new-agent-sidebar`의 모양은 바뀌지 않는다.
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- `deno run --allow-read tools/check-wording.ts`가 새 key에 오류와 warning을 내지 않는다(특히 internal-word).
- 사람이 gallery를 보고 모양을 고른다(skeleton: hr-screen-data는 그 뒤에 띄운다). lead가 page id 다섯을 사람에게 알린다. 사람이 바꾸라고 한 것은 같은 worker가 이 task 안에서 고친다.
- 위험 test: 없음. 화면이다.
- 남지 않음:
  - `git diff --name-only plan/headless-run...HEAD`에 `packages/shell/renderer/workspace/workspace.tsx`와 `packages/shell/renderer/desktop/main.tsx`가 없다(새 props는 optional이다).
  - `grep -rn "lucide" packages/shell/renderer/workspace/sidebar/run-list.tsx packages/shell/renderer/app-frame/app-runs.ts`가 0줄이다.
  - `grep -rn "TODO\|FIXME" packages/shell/renderer/workspace/sidebar packages/shell/renderer/app-frame/app-runs.ts`에 새 줄이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 사람에게 보일 gallery page id(위 표의 다섯)와 page마다 한 줄 설명
- 등록할 것: 없음 예상(page는 기존 영역 file에 더한다. wording 생성물은 이 task가 `deno task wording`으로 만든다)
- 안 쓰게 된 export
- 정한 것: 위 "정한 것"과 다르게 한 것, 그리고 worker가 더 정한 것(key 이름, 아이콘, 상태 글)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약(hr-contract-runs의 run 기록)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
