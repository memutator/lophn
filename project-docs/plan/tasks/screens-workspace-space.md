# screens-workspace-space

Lophn Workspace의 틀과 창 전체를 잇는 마지막 화면 task다. Workspace를 Projects·Apps·Settings 셋으로 줄이고 sidebar를 wireframe대로(40px 줄, Settings 아래 항목 묶음) 옮기고, route·`main.tsx`·intents·palette·`entry.tsx`·dev-mock에서 다른 화면 task들이 안 쓰게 만든 prop과 옛 화면(Documents, Things to confirm, Tasks, coding 링크, notification chip)의 연결을 걷고 새 source와 data 층(event client, toast, 대기 목록)을 창에 잇는다. gallery의 Workspace 틀(`workspace-page.tsx`)은 renderer의 실제 `LophnSpace`를 fake source로 그리게 바꾼다.

- 단위: screens-workspace (wave 3)
- 선행: screens-workspace-settings, screens-workspace-screens, screens-app-space-frame, screens-agents-settings, screens-data-events, screens-data-waiting, screens-data-toast, screens-project-window, screens-project-reactions, screens-project-terminal, screens-conversation-view (이유: 이 task가 `desktop/main.tsx`·`lophn-space.tsx`·`entry.tsx`·dev-mock에서 그 task들이 바꾼 component와 source와 provider를 한꺼번에 잇는다. 그 task들의 보고에서 "남긴 prop", "연결할 source", "등록할 것", "안 쓰게 된 export"를 모아 처리한다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/{main.tsx,router.ts,intents.tsx,entry.tsx,entry.module.css,index.html}`
  - `packages/shell/renderer/desktop/palette/`
  - `packages/shell/renderer/desktop/dev-mock/{mod,admin,app-space,launcher,documents,ids}.ts`
  - `packages/shell/renderer/desktop/lophn-space/{lophn-space.tsx,lophn-space.module.css,model.ts,screens.ts,source.ts,core-source.ts}`
  - `packages/shell/renderer/desktop/lophn-space/sidebar/`
  - `packages/shell/renderer/desktop/lophn-space/testdata/`
  - `packages/shell/renderer/icons/`
  - `packages/shell/renderer/entry.tsx`
  - `tools/wireframes/frames/compositions/workspace-page.tsx`
  - `tools/wireframes/frames/compositions/workspace/{pages.tsx,settings-shell.tsx,top-toast.tsx,data.ts,workspace.module.css}`
  - `packages/design/wording/catalog/workspace.ts` (wording-split이 만든 file. 앞 task들과 같은 file이다. `documents.*` key가 다른 file에 있으면 그 file도 이 task가 고친다(확인))
  - `packages/design/wording/catalog/workspace.placeholders.ts` (`generate.ts`가 만드는 생성물)
  - 이 task가 건드리지 않는 곳: `desktop/top-bar/`(ui-chrome), `desktop/connection/`(screens-data), `desktop/dev-mock/requests.ts`(screens-data-waiting), `desktop/dev-mock/agent.ts`(screens-conversation-source), `desktop/dev-seed.ts`(screens-project-sidebar), `desktop/launcher/`·`lophn-space/projects/`·`lophn-space/apps/`(screens-workspace-screens), `lophn-space/settings/`(screens-workspace-settings, screens-agents-settings)
- 읽을 것:
  - spec: S1 8장(renderer 쪽 계약: event client, store, 반응 층, 대기 목록이 창 어디에 붙는지) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `U1.4#4`, `U1.4#5`, `U1.5#11`, `U2.1#6`, `U2.3#22`, `U2.5#1`, `U6.7#1`
  - 결정: `../README.md` 3장 #18·#23·#57(이름), #117·#118
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/workspace-page.tsx` (`WorkspaceWithoutProject`의 sidebar: 헤더, 40px 줄, Settings 하위 항목) → `lophn-space/sidebar/sidebar.tsx`
    - `tools/wireframes/frames/compositions/workspace/settings-shell.tsx` (`WORKSPACE_PANE_GROUPS`) — 항목 정의는 screens-workspace-settings가 `settings/model.ts`의 `SETTINGS_GROUPS`로 옮겼다. 이 task는 그것을 import한다.
    - `tools/wireframes/frames/compositions/workspace/workspace.module.css` (`navList`, `navItem`, `navRow`, `subList`, `navGroup`)
    - `ui-inventory.md` 6.2(위쪽 바 36px, sidebar 머리와 높이가 같고 경계선이 한 줄), 6.7
- 계약:
  - 쓰는 것:
    - 다른 task가 내놓은 component와 source(위 선행의 보고).
    - `shell/ipc/shortcuts.ts`의 intent(contract-shell): `things-to-confirm` intent(`ConfirmTargetIntent`)와 ticket 링크 intent(`CodingTargetIntent`)는 계약에 남아 있다. 이 task가 renderer의 처리 가지를 걷는다. `app-issue` intent는 남긴다. union에서 지우는 일은 cleanup이다.
    - screens-data의 `EventsProvider`·`useSessions`(events), `WaitingLayer`·`useWaitingPanel`(waiting), `ToastHost({ overlay })`·`registerToastActionHandler`·`ToastAction`(toast).
    - screens-project의 `Workspace` props(window 보고), `TerminalStore.focusSession`·`useTerminalOpenRequests`(terminal).
    - screens-app-space-frame의 `AppSpace` 새 prop: `project`, `annotate`, `projects`, `overlay`, `terminal`, `session`, `onOpenSession`.
  - 내놓는 것: `Desktop`(`main.tsx`) props 정리 결과, `Route`(`router.ts`), gallery helper `WorkspaceWithoutProject({ screen, pane })`(`screens-agents-settings`의 page가 `screen`·`pane`만 넘긴다. 이 두 prop을 유지한다), dev-mock의 `devMock()` 반환 모양.

## 할 일

1. **Workspace 화면을 셋으로 줄인다** — `lophn-space/model.ts`, `screens.ts`, `lophn-space.tsx`. (`U2.5#1`)
   - `LOPHN_SCREENS = ["projects", "apps", "settings"]`, `DEFAULT_SCREEN = "projects"`. `documents`·`things-to-confirm` 지운다. `model.ts`의 문서 검색 조건과 `searchBody`·`EMPTY_CONDITIONS`·`newId` 중 쓰는 곳이 없는 것을 지운다(`grep`으로 확인).
   - `LophnSpace`에서 `DocumentsScreen`, `ThingsToConfirm`, `useRequests`, `organize`, `initialRead`, `initialRequest`, `sessions`, `initialConnection`, 문서 reader 상태(`reading`)를 걷는다. `ProjectsScreen`·`AppsScreen`·`SettingsScreen`에는 각 task가 정한 source를 넘긴다.
   - Settings 항목 state(`settingsPane`)는 screens-workspace-settings가 `lophn-space.tsx`에 둔 것을 sidebar와 나눠 쓰도록 한 곳(`LophnSpace`)이 들게 한다. `Route`에 `settingsPane?`를 두어 처음 항목을 고를 수 있게 한다.
   - 위쪽 바 오른쪽에 `WaitingLayer`와 ⌘ `PaletteButton`을 꽂는다. `WaitingLayer`의 `onOpenSession`·`onAnswerInTerminal`은 5번의 라우팅 함수에 잇는다.
   - `source.ts`·`core-source.ts`(`LophnSource`, 628줄)에서 문서 검색·series·outline 읽기를 지우고 `catalog()`(팔레트의 project·앱 행)만 남긴다. `testdata/fake-source.ts`도 맞춘다.
2. **sidebar** — `lophn-space/sidebar/sidebar.tsx`, `sidebar.module.css`. (`U6.7#1`, 6.2)
   - 헤더: `LauncherButton`, "Lophn Workspace", 접기·펴기 `IconButton`. 헤더 높이는 위쪽 바(36px, ui-chrome token)와 같고 아래 경계선이 위쪽 바 경계선과 한 줄로 이어진다.
   - 줄 셋(Projects, Apps, Settings)은 40px 높이다. 고른 줄은 배경이 칠해진다(`active`). Settings가 고른 화면이고 sidebar가 펼쳐져 있으면 그 아래에 항목 묶음(General: General·Appearance / Agents: Providers·Agents·Tools and skills·Coding agents / System: Reactions·Diagnostics)이 들여 쓴 줄로 나온다. 고른 항목은 둥근 배경이다. 항목 정의는 `settings/model.ts`의 `SETTINGS_GROUPS`다. 접힌 sidebar에는 아이콘만 있고 `aria-label`·tooltip이 이름이다. Settings 안에 둘째 목차 열은 없다(`SettingsScreen`이 본문만 그린다).
   - `workspace.module.css`의 `navList`·`navItem`·`navRow`·`subList`·`navGroup` 규칙을 `sidebar.module.css`로 옮긴다.
3. **router** — `router.ts`. (`U2.1#6`) `Route`에서 `read`, `request`, `connection`, `taskTarget`을 지운다. `issueProblem`·`instructions`는 유지한다. `openLophn(screen?, settingsPane?)`. 기본 화면은 projects다. 세 가지를 더한다: `session?: string`(그 session을 그 place의 창에서 열어 시작한다), `projectManager?: { violation: string }`(그 project의 Project Manager를 위반을 붙여 열어 시작한다. screens-project-reactions가 같은 동작을 창 안에서 하므로 `Workspace` prop 이름은 그 보고를 따른다), `open?: { path: string; line?: number }`(project 창에서 파일을 열어 시작한다. palette의 파일 행이 쓴다). `Workspace`·`AppSpace`가 받는 prop 이름이 보고에 없는 것은 `Route` 칸만 두고 넘기지 않으며 보고의 "계약 바꾸기 요청"에 적는다.
4. **main.tsx** — `Desktop` props와 본문을 정리한다. (`U1.4#4`, `U1.4#5`)
   - 지운다: `organize`, `tracking`, `tasks`, `coding`(Settings 안으로 들어간 것은 `settingsPanels`로), `lophn`의 문서 쪽 쓰임, things-to-confirm 이동(`thingsToConfirm`, `confirmTarget`), `codingTarget`(coding 연결·Task 링크), `go()`의 `document` 갈래, `NotificationChip` 마운트와 import(wave 1이 폴더를 지웠다면 남은 줄).
   - 유지·변경: `onIssue`(`issueTarget`), `instructions`, 앱 공간으로 가기. `AppSpace`에는 screens-app-space-frame의 새 prop을 넘기고 `tasks`·`taskTarget`·`onDocuments`·`onThingsToConfirm`·`windows`처럼 안 쓰게 된 것은 걷는다. `Workspace`에는 screens-project의 새 prop을 넘기고 그쪽이 "줄어든 것"으로 보고한 prop(tracking, 판, compare, ask 등)을 걷는다.
   - data 층을 창에 잇는다: 창마다 `EventsProvider`를 한 번 감싸고(entry에서 만든 event client를 넘긴다), `ToastHost({ overlay })`를 한 번 마운트하고, **기본 toast 처리기**를 `registerToastActionHandler`로 등록한다. 기본 처리기는 지금 보이는 화면이 처리하지 못한 action(처리기가 `false`)을 다른 화면으로 가서 연다: `{ kind: "waiting" }` → 현재 창에서 `useWaitingPanel().setOpen(true)`, `{ kind: "session", session }` → `useSessions()`의 session place로 5번의 라우팅, `{ kind: "project-manager", project, violation }` → `openProject(project)` + `Route.projectManager`.
   - `Desktop`이 route에 따라 그리는 `Launcher`·`LophnSpace`·`Workspace`·`AppSpace`·`InstructionsEntry`에 `onOpenSession`·`onAnswerInTerminal`을 5번의 함수로 넘긴다.
5. **session 라우팅** — `main.tsx`의 함수 `openSession(session)`: `useSessions()`가 알려 주는 session의 place가 project이면 `openProject(id)`에 `Route.session`, 앱이면 `openApp(id)`에 `Route.session`이다. place가 없는 lophn의 session은 마지막으로 연 project 창에서 연다(project가 하나도 없으면 아무것도 하지 않고 Workspace의 Projects로 간다). 이 규칙은 문서에 답이 없어 정한 것이다. 보고의 "정한 것"에 적는다. `onAnswerInTerminal(session)`은 `TerminalStore.focusSession(session)`을 부르고, 그 session의 탭이 지금 창에 없으면 `openSession`으로 그 place의 창으로 간 뒤 같은 호출을 한다.
6. **intents.tsx** — `DesktopIntents`에서 Things to confirm 링크와 coding 링크(`cac_`·`tkt_`·`app_`) 처리를 지운다. 대기 목록 열기 intent가 계약(`shell/ipc/shortcuts.ts`)에 있으면 `useWaitingPanel().setOpen(true)`로 잇는다. `onIssue`·`go`는 유지한다. (`U1.4#5`)
7. **palette** — `palette/lophn-scope.ts`, `workspace-scope.ts`, `search.ts`, `model.ts`, `host.tsx`, `labels.ts`. (`U2.3#22`)
   - Workspace 팔레트의 행: project, 앱, 행동(런처, "Go to Projects/Apps/Settings"). `LophnTarget`의 `document` 갈래와 문서 묶음(`DocumentFound`, `documents` group)을 지운다.
   - 파일 묶음: 입력한 글로 project 키워드 검색(screens-project-search가 쓰는 route. 없으면 묶음이 비는 것으로 처리)을 해서 결과를 경로와 줄로 보인다. 고르면 `Route.open`으로 그 project 창에서 그 줄에서 연다. `search.ts`의 `documentSearch(lophn)`는 `fileSearch`로 바꾼다.
   - "Open lophn"이 아니라 "Lophn Workspace"라는 이름을 쓰는 key(`common.title.palette-lophn`, `common.button.palette-lophn`)의 글은 screens-data가 `U2.1#7`로 바꾼다. 이 task는 key를 새로 만들지 않고 쓰는 곳만 맞춘다.
8. **entry.tsx와 dev-mock** — `desktop/entry.tsx`, `dev-mock/mod.ts`, `admin.ts`, `app-space.ts`, `launcher.ts`, `documents.ts`, `ids.ts`.
   - 걷는다: `coreOrganizeSource`, `coreTrackingSource`, `coreTasksSource`, backup·update·notifications source, `coreCodingConnectionsSource`의 연결 method(screens-workspace-settings가 정한 새 모양으로), `mockOrganize`, `mockTasks`, `documents.ts`(남는 `mockLophn`은 catalog만), `windowIssueDecision`, `windowRevokeOpener`, 옛 `RequestsProvider`·`coreRequestSource`·`RequestDrafts` 조립(screens-data가 대기 목록을 새로 만들었다).
   - 더한다: 선행 task들이 보고한 새 source(`ProjectsSource`, reactions·appearance source, annotate 통로, `createFakeAgentsSource`의 새 모양, `fakeDetail`·`fakeIssues`의 새 인자, `AgentTabSourceFactory`)의 core·mock factory. 새 source가 계약 route를 부르기만 하는 core-source면 그대로 잇는다. dev-mock의 `DevMock` 필드와 조립(`mod.ts`)은 다른 task들이 이 task로 넘겼다. events의 fake Gateway(`DevMock.events`)와 대기 항목, `mockAgentViewSource`(conversation-source), 시드 작업대(project-sidebar)를 함께 잇는다.
   - `renderer/entry.tsx`는 mount 공용 file이다. 변경이 없으면 건드리지 않는다.
9. **icons** — `renderer/icons/`. 지운 화면의 아이콘 중 참조가 0인 것만 지운다(`lophnSpaceIcons.documents`·`series`·`thingsToConfirm`·`roles`, `conversationIcons.dock` 등은 다른 task가 쓰는지 `grep`으로 확인한다. 쓰는 곳이 남으면 지우지 않고 보고에 적는다). Settings 항목 아이콘이 없으면 `settingsIcons`에 더한다: general(SlidersHorizontal), appearance(Palette), providers(Plug), agents(Bot), tools(Wrench), coding(SquareTerminal), reactions(Zap), diagnostics(Activity) — wireframe `settings-shell.tsx`가 쓰는 lucide 아이콘이다.
10. **문구** — `U1.5#11`: `documents.*` key 가운데 `grep -rn "<key>" packages tools`로 참조가 0인 것을 지운다(`editor/instructions-entry.tsx`처럼 아직 쓰는 곳이 있는 key는 둔다). 박아 둔 영어 글이 sidebar·palette에 남았으면 `catalog/workspace.ts`의 key로 만든다. 만든 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 영역 생성물을 다시 만든다.
11. **gallery를 실제 `LophnSpace`로 그린다.**
    - `workspace-page.tsx`의 `WorkspaceWithoutProject`는 손으로 짠 sidebar와 `SettingsShell` 조합을 지우고 renderer `LophnSpace`를 dev-mock의 source로 그린다. props는 `screen`·`pane`을 유지하고, 지금 `workspace/pages.tsx`가 넘기는 `body`·`overlay`·`panes`·`connectStatic`은 없앤다.
    - `workspace/pages.tsx`의 export 이름은 그대로 두고 상태를 다시 만든다: `WorkspaceFolderMissing`(fake의 사라진 폴더 설정), `WorkspaceSubfolderAdd`·`WorkspaceSubfolderEdit`(mount 뒤 click), `SettingsRequiredEmpty`(fake settings에 필수 설정이 빈 상태. `TopToast` 덮개를 지운다). click helper가 필요하면 `workspace/drive.ts`에 둔다(다른 task가 같은 이름으로 만들었으면 그것을 쓴다).
    - 지운다: `workspace/settings-shell.tsx`, `workspace/top-toast.tsx`(쓰는 곳이 없어지면). `compositions/workspace-settings.tsx`의 `ConnectDialogsStatic`·`ConnectDialog`·`ProvidersPane`·`AgentsPane`는 screens-agents-settings 소유라 쓰는 곳이 없어졌다고 보고만 한다. `workspace/data.ts`와 `workspace.module.css`에서 아무도 안 쓰는 부분을 지운다(다른 task의 gallery wrapper가 읽는 것은 둔다. `grep`으로 확인).
    - `ways-page.tsx`·`ways.ts`는 화면이 아니라 Context 탭을 여는 길을 설명하는 page다. renderer 짝이 없으니 옮기지 않는다. 지금 그대로 둔다.
    - `workspace/launcher-pages.tsx`·`start-failure-page.tsx` 등 screens-workspace-screens가 바꾼 wrapper는 건드리지 않는다.

- (lead가 더함, screens-project-window가 넘긴 것) `Workspace`가 `useSessions()`를 부르는데 `EventsProvider`가 아직 어디에도 올라가 있지 않아 project 창이 "EventsProvider is missing"으로 던진다. 이 task가 desktop root에 `EventsProvider`를 올린다. palette(`desktop/palette/workspace-scope.ts`)의 `info-panel` action은 이제 아무것도 안 하니 걷는다. `tabKindLabel`·`DocumentRow`·`FileRow`는 palette만 쓴다(`WorkspaceSource.documents`는 없어졌고 palette에 `[]`가 간다). screens-data-secret-input이 넘긴 것: `desktop/lophn-space/things-to-confirm/core-source.ts`의 `confirmWithoutWindow` 호출은 main handler가 없어 늘 `unavailable`이다. 걷는다. screens-app-space-detail이 넘긴 것: `mockTasks` 삭제.

- (lead가 더함, screens-project-reactions가 넘긴 것) `desktop/main.tsx`가 `EventsProvider`, `ToastHost`, 기본 toast 처리기를 올린다. project 창의 처리기(`workspace/reactions/toast-handler.ts`)는 다른 project의 session·Project Manager와 `session:null`+`app`(재시작 멈춤) 행동에 `false`를 돌려준다. 기본 처리기가 그 session의 project나 앱 공간으로 가서 연다. `Workspace`의 `onThingsToConfirm` prop은 없어졌다(`thingsToConfirm`은 AppSpace만 쓴다). screens-agents-editor가 넘긴 것: `workspace/kinds/agents.tsx`의 `ASSIGNMENT_ID`(`asg_…` regex)는 이제 agent key(내장 role 이름 또는 `agt_…`, `agents/agent-key.ts`의 `OPERATOR_ID`)로 바꾼다. 같은 file이 넘기는 `AgentsPageProps.onChangeDefaults`는 안 쓰이니 걷는다(추가 소유, lead 승인: `workspace/kinds/agents.tsx`).

- (lead가 더함, screens-workspace-settings가 넘긴 것) `entry.tsx`의 `settingsPanels`에 `coreAppearanceSource(core)`(`settings/appearance/core-source.ts`)와 `coreReactionsSource(core)`(`settings/reactions/core-source.ts`)를 잇는다. 저장한 theme(`shell.theme`)을 시작할 때 적용한다(지금은 Appearance 패널이 열릴 때만). `SettingsScreen`의 `coding` prop과 `SettingsPanels.coding`을 하나로 합친다. settings 항목 state(`settingsPane`)를 sidebar와 나눈다. `settings/pane-icons.ts`의 아이콘 셋을 `icons/settings.ts`로 옮기고 지운다. `desktop/main.tsx`의 `codingTarget`·`route.connection`은 쓰는 곳이 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면·조립 task)
- 남지 않음:
  - `grep -rn "things-to-confirm\|DocumentsScreen\|OrganizeSource\|TrackingSource\|TasksSource\|NotificationChip\|taskTarget\|codingTarget\|confirmTarget\|SpaceDecisions" packages/shell/renderer/desktop`이 0줄이다.
  - `grep -rn "LOPHN_SCREENS" packages/shell/renderer`가 `projects`·`apps`·`settings` 셋만 가리킨다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-workspace*`, `new-settings-*` 전부가 실제 `LophnSpace`로 그려진다. `deno task dev:mock`(주소의 `mock`)로 창을 띄워 런처 → Workspace → Settings 각 항목 → Apps → 앱 공간이 오가고, 위쪽 바의 대기 pill이 보인다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `workspace`의 새 key와 지운 key. gallery `pages.ts`의 "지금 화면" part에서 지워진 화면을 가리키는 옛 page(`settings-connections`, `settings-update`, `settings-notifications`, `lophn-things-to-confirm`, `project-app-panel` 등)를 빼는 일 — 어느 page인지 적는다. `frames/mock-desktop.tsx`(lead)의 `SETTINGS_TAB` 표와 `settingsTab` prop이 새 Settings 항목과 맞는지.
- 안 쓰게 된 export: 지우지 못한 아이콘과 `LophnSource` method 등 (남이 쓰던 것은 지우지 않았다)
- 정한 것: lophn session을 어느 창에서 여는지(5번), `Route`에 더한 칸의 모양, palette 파일 묶음의 검색 route, gallery helper의 prop, 기본 toast 처리기의 라우팅
- 계약 바꾸기 요청(wave 3): `Workspace`·`AppSpace`에 `session`·`projectManager`·`open` prop이 없으면, 대기 목록 열기 intent나 project 키워드 검색 route가 계약에 없으면 적는다

- (lead가 더함, screens-app-space-frame가 넘긴 것) `desktop/main.tsx`와 `entry.tsx`가 `AppSpace`에 새 prop `project`, `annotate`, `projects`(`() => Promise<{ok:true; value:{id,name,folder}[]} | {ok:false}>`), `overlay`, `terminal`(`TerminalDeps`), `session`, `onOpenSession`을 넘긴다. `EventsProvider`가 `AppSpace` 위에 있어야 한다(없으면 throw). `AppSpaceProps`의 `windows`·`onDocuments`·`onThingsToConfirm`은 안 쓰니 지운다. dev-mock `DevMock`에 `fakeAnnotate()`와 `projects`를 잇는다.
- (lead가 더함, screens-conversation-view가 넘긴 것) `workspace/kinds/agent.tsx`의 `viewHost`에 `openFile: slice.openFile`을 넣는다(편집 카드 [Open]). `workspace.tsx`가 `panelSessions`의 `known` map(각 agent source의 `sessions()` 결과)을 채워 sidebar session 줄에 제목이 나오게 한다. `desktop/main.tsx`에 `EventsProvider`가 없어 지금 Agent 탭이 "EventsProvider is missing"으로 깨진다. 이 task가 올린다. `desktop/lophn-space/things-to-confirm`을 걷을 때 옛 `conversation/question-card/{question-card.tsx,model.ts,answered-summary.tsx}`도 지우고 `ask-card.tsx`를 `question-card.tsx`로 옮긴다.
- (lead가 더함, screens-contexts-overview가 넘긴 것) sidebar `.item[data-active]` 스타일이 `project-sidebar.module.css`에 없어 고른 saved view가 보이지 않는다. 한 줄 더한다.
- (lead가 더함, screens-workspace-screens가 넘긴 것) `desktop/entry.tsx`·`dev-mock/mod.ts`·gallery `mock-desktop.tsx`가 `projectsSource`(`coreProjectsSource(core, windowFolderPicker())`, fake는 `fakeProjects(options).source`)를 `Desktop`에 넘긴다. 런처도 `WaitingLayer`를 써서 `EventsProvider`가 필요하다. gallery `pages.tsx`의 `WorkspaceFolderMissing`이 `TopToast`를 같이 그려 toast가 둘 겹친다. overlay를 걷는다. `ProjectsScreenProps.lophn`과 `LophnSource.projects`·`updateProject`·`setProjectArchived`·`ProjectRow`·`ProjectChange`가 안 쓰이면 지운다.
