# screens-project-window

project 창의 틀을 새 설계로 맞춘다. 앞선 task가 만든 부품(sidebar, 문서 탭, 터미널, 검색)을 `workspace.tsx`에 꽂고, 탭 줄을 design `TabStrip` 하나로 바꾸고, 새 탭(+) menu에 아이콘을 붙이고, 탭 key를 파일 경로로 바꾸고, 정보 패널 slot·tracking·판·context watch 같은 옛 장치를 걷어낸다. gallery의 project 창 harness(`ProjectApp`)도 같은 부품으로 갈아탄다.

- 단위: screens-project (wave 3)
- 선행: screens-project-sidebar, screens-project-editor, screens-project-terminal, screens-project-search (이 넷이 `workspace/`의 kind 파일과 sidebar를 새 모양으로 내놓은 뒤 `workspace.tsx`가 그것을 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`, `workspace.module.css`
  - `packages/shell/renderer/workspace/panes/`, `tab-strip/`(지운다), `top-path/`, `info-panel-slot/`(지운다), `kinds/`의 `agent.tsx`, `agents.tsx`, `app-panel.tsx`, `context.tsx`, `contexts.tsx`, `host.ts`, `kind.ts`, `registry.ts`
  - `packages/shell/renderer/workspace/model.ts`, `layout-map.ts`, `view-hint.ts`, `drag.ts`, `launcher-button.tsx`, `app-panel-tab.tsx`, `app-panel-tab.module.css`, `notice-ask.tsx`(지운다), `ask-view.ts`(지운다), `notice-card.tsx`, `notice-card.module.css`
  - `packages/shell/renderer/workspace/sidebar/`의 옛 file(`sidebar.tsx`와 css. 부르는 쪽을 바꾼 뒤 지운다. `agents-section.tsx`는 `SidebarAgent` type을 다시 내보내는 한 줄 file로 남긴다: screens-agents의 `sidebar-agents.ts`가 아직 옛 경로에서 import한다)
  - `tools/wireframes/frames/compositions/project-window.tsx`, `project-app.tsx`, `project-pages.tsx`, `project-files/pages.tsx`, `project-files/explorer.tsx`, `agent-panel.tsx`, `menu-icons.tsx`, `file-tree-data.ts`, `file-data.ts`(다른 task가 복사해 간 뒤 안 쓰면 지운다), `files.module.css`(window와 sidebar 쪽 규칙만)
  - `packages/design/wording/catalog/project.ts`와 생성물 `catalog/project.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `U6.1#2`, `U6.1#3`
  - inventory(lead가 맞추며 더함): `U1.3#3`
  - spec: S1 8장(Context 탭은 열 때 읽는다, 위반 toast는 반응 층), S8 2장(Agent 묶음), S5(앱 view 열기에 project) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`, `place-session.md`, `app-call.md`
  - inventory: `U2.4#11`, `U6.3#1`, `U6.4#5`, `U6.1#1`, `U2.3#6`(탭 key를 파일 경로로: 문서 탭 쪽 `kinds/document-editor.tsx`는 screens-project-editor가 바꿨고 이 task가 `workspace.tsx`·`layout-map.ts`의 `openPath`와 복원을 맞춘다), `U2.3#13`(정보 패널은 문서 탭 안으로 갔다. 작업대 쪽 `info-panel-slot`을 지운다), `U2.3#15`(문서 탭의 판 hint와 pending 조건을 뺀다), `I2.9#1`(Agent 탭의 agent 지정이 assignment → place에 놓인 agent. main 쪽은 screens-project-main), `I2.9#2`(layout 저장의 info 탭: `info/versions/contexts` → `info/contexts`. renderer 쪽 `layout-map.ts`), `I2.9#3`(문서 탭 kind의 대상이 파일 경로. renderer 쪽 `layout-map.ts`)
  - inventory(다른 단위 줄이지만 이 task가 `workspace.tsx`에서 호출부를 걷는다): `U1.3#14`(`newContext`, `engineerTabOpen`, `expectDraft`), `U1.3#15`(`useContextWatch`), `U1.3#16`(`contextStamp`), `U2.3#1`(workspace가 state로 들고 inline으로 그리는 위반 toast)
  - 결정: `../README.md` 3장 #57(`project_manager`), #93
  - 지금 코드: `workspace/workspace.tsx`(964줄), `panes/panes.tsx`(436줄), `tab-strip/tab-strip.tsx`(200줄), `kinds/host.ts`(`DocumentSlice`, `ContextsSlice`, `AgentsSlice`, `AgentViewSlice`, `TabHost`), `layout-map.ts`, `app-panel-tab.tsx`
  - 본보기(화면): `tools/wireframes/frames/compositions/project-window.tsx`(`TabBar` 125줄~, `TabMenu` 483줄~, `NewTabPick`), `project-app.tsx`(525줄: 탭을 여는 모든 길이 같은 `open` 규칙), `project-pages.tsx`, `tools/wireframes/frames/chrome/tab-strip.tsx`(ui-chrome이 design으로 옮긴 `TabStrip`)
- 계약:
  - 쓰는 것:
    - `@lophn/design/components`의 `TabStrip`(ui-chrome. props `tabs`, `selected`, `focused`, `compact`, `onSelect`, `onClose`, `end`(탭 줄 끝의 새 탭 + 단추 slot), `TabItem = { key, title, icon?, dot? }`. 아이콘+이름, 고른 탭 아래 3px 밑줄, 상자 없음, 종류 글자 없음), `FileIcon`, `VendorIcon`, `MenuIcon`, `Menu`, `Toast`(ui-chrome)
    - `ProjectSidebar`, `RailAction`, `WorkspaceSource`(screens-project-sidebar), 문서 탭·터미널 탭·검색 탭의 kind 선언(screens-project-editor, -terminal, -search)
    - `ipc/workspace.ts`의 layout 읽기·저장·현재 보기 힌트(contract-shell)
    - `useSessions`(screens-data-events)로 Agent 탭의 상태 점
  - 내놓는 것:
    - `Workspace`의 props는 더하기만 한다. 지금 `desktop/main.tsx`가 넘기는 `WorkspaceProps` 가운데 R1·R2가 걷은 것(tracking, versions, compare)과 이 task가 걷는 것(`ask`, `notice-ask`)은 호출하는 쪽이 같이 줄여야 하므로 보고에 목록을 적는다.
    - `kinds/host.ts`: `AgentViewSlice.openFile(path: string)`(대화의 결과 링크가 파일을 연다. screens-conversation-view가 `AgentViewHost.openFile`을 더한다), `TabHost.openTab(tab, options?: { focus?: boolean })`(core 요청으로 열리는 터미널 탭은 focus를 옮기지 않는다)

## 할 일

1. `panes/panes.tsx`와 `tab-strip/`을 design `TabStrip`으로 바꾼다(탭 줄 끝 새 탭 + 단추는 `end` slot). 아이콘은 파일 탭이 파일 종류 아이콘, Agent 탭이 그 agent의 profile 아이콘, coding 터미널 탭이 harness vendor 아이콘, 나머지는 종류 아이콘이다. 탭 이름 오른쪽의 종류 글자는 없다. Agent 탭의 상태 점은 `useSessions`에서 온다. `tab-strip/`은 지운다. 근거: `U6.3#1`.
2. 새 탭(+) menu를 바꾼다. New tab → Document, Terminal, Agent ▸(agent 목록), Context, Search, App panel이다. Agents(관리 탭)와 New context 항목은 없다(`kinds/agents.tsx`의 `launcher`와 `labelKey`를 지운다. Agent 탭의 관리 화면은 sidebar의 [Manage]가 연다). 항목과 하위 menu에 design `MenuIcon`(ui-chrome)으로 아이콘을 붙인다. 근거: `U6.4#5`.
3. `workspace.tsx`를 정리한다.
   - sidebar를 `ProjectSidebar`로 바꾸고, `contextPanel` slot에는 screens-contexts가 만들 `ContextSidebar`를 넣는다. 그 component가 아직 없으면 slot에 현재 Contexts 목록 행을 그대로 넣어 두고 contexts task가 바꾼다(`workspace/contexts/`를 import하는 줄은 이 task가 더하지 않는다. 비워 두면 Context 모양이 빈 상태다).
   - 걷는다: `info-panel-slot`과 `infoOpen`·`infoPlacement`(정보 패널은 문서 탭 안에 있다), `tracking`·`TrackingStrip`, `compares`·`versionsTick`·`showCompare`(R1이 걷지 못한 것), `useContextWatch`·`contextStamp`·`settleContextTabs`, `newContext`·`engineerTabOpen`·`expectDraft`, inline `ViolationToast`와 `toasts` state, `notice-ask`·`ask-view`. 근거: `U1.3#14`, `U1.3#15`, `U1.3#16`, `U2.3#1`, `U2.3#13`.
   - context 목록은 열 때(Contexts 탭, sidebar의 Context 모양, 대화 속 context 링크의 이름)만 `contextsSource.list`로 읽어 둔다. polling과 store는 없다.
   - 위반 toast의 호스트 처리는 `screens-project-reactions`가 한다. 이 task는 inline 그림만 걷는다.
4. 탭 key와 복원을 파일 경로로 맞춘다. `layout-map.ts`의 문서 탭은 파일 경로가 key이고, 이미 열려 있으면 고르기만 한다. 정보 패널 탭은 `info`와 `contexts`뿐이다(`versions` 없음). 문서 탭의 판 hint와 pending 조건(`view-hint.ts`, `kinds/host.ts`의 `notePresentation`·`noteMeta`의 판)을 뺀다. 근거: `U2.3#6`, `U2.3#15`, `I2.9#2`, `I2.9#3`.
5. Agent 탭의 agent 지정을 place에 놓인 agent로 맞춘다(`kinds/agent.tsx`, `layout-map.ts`). role 이름 `context_engineer`를 `project_manager`로 바꾼다. `AgentViewSlice.openFile(path)`를 더하고 `openResult`는 그대로 둔다(옛 `AgentView`가 아직 쓴다). 근거: `I2.9#1`.
6. 앱 패널 탭(`app-panel-tab.tsx`, `kinds/app-panel.tsx`)이 앱 view를 열 때 이 project를 함께 넘기게 한다(`AppViewOpen`에 project. 모양은 contract-app-calls가 고정한 `ipc/app-frame.ts`). 근거: `U2.4#11`.
7. `DocumentSlice`에서 안 쓰게 된 칸(`rows`, `compareOf`, `showCompare`, `versionsChanged`, `infoShown`, `toggleInfo`, `notePresentation`의 판)을 걷는다. 문서 탭(screens-project-editor)이 먼저 merge됐으므로 쓰는 곳이 없어야 한다. `ContextsSlice`의 `askContextEngineer`·`newContext`·`stampOf`도 걷는다.
8. 토글·행동 단추를 줄 오른쪽 끝 고정 열에 두는 규칙(`U6.1#1`)을 이 틀의 단추(탭 줄 끝 +, 새 탭 menu)에 맞춘다. `workspace/model.ts`의 `TOP_BAR_HEIGHT` 48을 36(`--window-top-bar`)으로 바꾼다(ui-chrome-top-bar가 이 task로 넘긴 일이다).
9. 문구를 wording key로 바꾼다(영역 `project-workspace`). tracking, 판·비교·복원 계열 key와 `project-workspace.heading.documents` 등 쓰는 곳이 없어진 key는 지운다. key는 `catalog/project.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/project.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
10. gallery harness를 갈아탄다.
   - `project-window.tsx`의 `ProjectSidebar`·`TabBar`·`TabMenu` look-alike를 지우고 renderer의 `ProjectSidebar`, design `TabStrip`, renderer의 새 탭 menu를 그린다. `StaticMenu`, `Mark`, `Mono`, `TabSpec`, `TabKind`, `RailAction`, `SidebarSpec` 같은 다른 page가 import하는 export는 이름과 모양을 유지한다.
   - `project-app.tsx`의 `ProjectApp`은 props(`panes`, `sidebar`, `titleExtra`, `body`, `children` 등)를 유지한다. waiting·contexts·agent 장면의 page가 이것을 쓴다.
   - `project-pages.tsx`와 `project-files/pages.tsx`의 sidebar·탭 줄 쪽 page(`TabKinds`, `NewTabMenu`, `SidebarCollapsed`, `ExplorerRootMenu`, `AgentsGroup`, `ContextSidebar`)가 옮긴 component로 그려지게 import를 고친다.
   - `project-files/explorer.tsx`, `agent-panel.tsx`, `file-tree-data.ts`를 지운다(sidebar가 옮겼다). `menu-icons.tsx`는 design `MenuIcon`으로 바뀐 만큼 쓰는 곳이 없어지면 지운다.
11. (lead가 맞추며 더함 (`U1.3#3`)) 새 탭(`+`) 메뉴의 Agents 항목
12. (lead가 맞추며 더함 (`U6.1#2`, `U6.1#3`)) 탭 본문의 내용은 최대 폭을 둔 기둥을 가로 가운데에 놓는다 / 고른 탭과 탭 본문은 배경이 같아 하나로 보인다. 본문 안에 배경색이 다른 넓은 영역을 두지 않는다. image, pdf, terminal의 바탕도 같다. contexts와 agents 탭 본문도 같은 규칙을 따른다(그 brief들이 이 규칙을 쓴다)

- (lead가 더함, screens-project-terminal이 넘긴 것) coding 터미널 탭을 잇는다.
  - `TabHost.openTab`에 고르지 않고 붙이는 옵션(`openTab(tab, { select: false })`)을 두고, `workspace/kinds/terminal.tsx`의 `openCodingTerminal`이 그 옵션을 넘기게 한다.
  - 탭마다 아이콘: `TabKindDef`에 `iconOf?(tab)`를 두고 TabStrip이 쓴다. coding 탭은 `codingTabIcon(tab)`(terminal kind가 낸다)을 쓴다.
  - 작업대가 `useTerminalOpenRequests`(`terminal/use-terminal-open-requests.ts`)를 부르고 요청을 자기 앱·project로 거른다. `store.onSelect`를 등록한다. 대기 목록 카드에서 `store.focusSession`을 부르는 일은 screens-data-waiting 몫이다.

- (lead가 더함, screens-project-search가 넘긴 것) 파일 탭 key가 절대 경로가 된다(search와 editor가 그렇게 연다). main layout의 `tabKey` 검사(`/^[A-Za-z0-9._:-]+$/`)는 `/`를 받지 못하니 layout schema와 `layout-map`을 경로 key에 맞춘다. rail의 `saved`가 `openSearchShortcut`으로 가는 것은 저장된 view로 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 틀)
- 남지 않음: `grep -rn "context_engineer\|useContextWatch\|contextStamp\|TrackingStrip\|infoPlacement\|tab-strip/" packages/shell/renderer/workspace/workspace.tsx packages/shell/renderer/workspace/panes packages/shell/renderer/workspace/kinds packages/shell/renderer/workspace/layout-map.ts`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-explorer-root`, `new-agent-sidebar`, `new-sidebar-collapsed`, `new-sidebar-context`, `new-tab-kinds`, `new-tab-menu`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: `desktop/main.tsx`·`entry.tsx`(screens-workspace)가 `Workspace`에 넘기는 props 가운데 줄어든 것의 목록. 영역 `project-workspace`의 지운 key와 새 key.
- 안 쓰게 된 export: 옛 `sidebar/sidebar.tsx`의 `Sidebar`, `contexts/shortcut-rail.tsx`(screens-contexts가 지운다), `contexts/violation-toast.tsx`(screens-contexts가 지운다), `AgentViewSlice.openResult`(대화가 `openFile`로 갈아타면)
- 정한 것: `U2.3#31`(코드 이름 `workspace/`와 Lophn Workspace)은 이 task에서 하지 않는다. `renderer/workspace/`를 다른 이름으로 옮기면 병렬로 도는 모든 단위의 import가 한꺼번에 깨지므로 cleanup이 한다. context 목록 읽는 시점.
- 계약 바꾸기 요청(wave 3): layout schema에 새 탭 종류 필드가 필요하면 여기 적는다
