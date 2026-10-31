# workspace layout

place 창(Home, project, 앱)이 가진 탭이 어디에 있는가를 정하는 메커니즘이다. place 창은 새 shell 틀(`renderer/shell/`) 하나이고 layout은 place(Home, project, 앱) 하나에 desk 여럿이다. desk는 기본 desk(`_default`, 화면 이름 "Main") 하나, 사람이 만든 desk(New desk), 그 project의 workflow마다 하나인 workflow desk다. title bar 왼쪽의 desk 단추로 바꾼다. desk 하나가 tab 줄(tabs와 붙은 두 tab인 split 하나), workspace 위에 뜬 패널(floats, 접힌 것은 title bar 오른쪽 칸의 아이콘), OS 창(detached)을 통째로 가진다. 모든 탭 kind가 같은 길을 쓴다. renderer의 순수 함수 desk model, main이 place마다 검증해 저장하는 layout 파일, 패널을 그리는 float 층, 창마다 하나인 `<webview>` 그릇과 그 z-index, 탭을 창 사이로 옮기는 main 중계(`transfer`/`receive`)에 걸친다. browser 탭 page, 앱 화면, artifact 화면은 native view가 아니라 그 `<webview>` 그릇에 산다(`browser-tab.md`, `renderer/app-frame/webview-host.tsx`). native view는 browser의 크기 준 popup·DevTools와 overlay뿐이다.

## 흐름

```
 renderer/shell/desk-model.ts ── PlaceLayout { active, desks: { _default | desk-<시각>-<번호> | <workflow 이름> → Desk } }
   Desk { key, label, workflow?, tabs[], selected, split: { a, b, focus, dir, ratio } | null, floats[], detached[] }
   FloatTab { tab, rect, minimized }  배열 순서 = 위아래 순서(마지막이 맨 위)
   DetachedItem { tab, bounds }       bounds = OS 화면 좌표, 배열 순서 = 뗀 순서
   desk 함수: openTab(preview·after·select), closeTab, selectTab, moveTab, splitWith, setSplitDir, setSplitRatio, unsplit, floatTab, openFloatTab, minimizeFloat,
             restoreFloat, setFloatRect, dockFloat, closeFloat, detachTab, openDetachedTab, reattachTab, closeDetached, pinTab, stepTab
   layout 함수: updateDesk, addDesk, renameDesk, removeDesk(Main으로 합침), setActiveDesk, findTab, openTabInLayout, allTabs, mapLayoutTabs
        │
        │ 바뀔 때마다(commit) mapLayoutTabs(읽던 위치 채우기) ─▶ WorkspaceSource.layout.savePlaceLayout ─▶ layoutToStored(renderer/shell/layout-source.ts: transient 탭 빼기,
        ▼                                                      kind registry의 toStored) ─▶ shell:place-layout-save { place, layout } (main이 살아 있는 detached 창의 bounds로 덮는다)
 main/workspace/place-layout*.ts ── <data>/shell/places/<place>.json (schema_version 8, desk 1~200개, desk마다 floats·detached 각 최대 20, tabs 최대 1200)
                             없고 place가 project면 옛 <data>/shell/layouts/<prj_id>.json(판 5~7)을 읽어 올린다(아래 place layout). 그 밖의 다른 판은 unsupported_schema
 project settings 탭(kind project_settings, key "project-settings", project 창에 하나, noDetach) ─▶ General은 Places panel의 상세 dialog와 같은 ProjectForm이고 ProjectsSource를 PlaceWindow의 `projects` prop으로 받는다. 저장하면 host.projectSettings.projectChanged
     진입: 팔레트 행동 "Project settings". layout 파일에는 탭 kind와 key만 남는다
 main/workspace/window-state.ts ── <data>/shell/window.json { bounds, maximized } 앱에 하나. desktop 창의 마지막 자리

 Detach (project 창 place-window.tsx)                         detached 창 (#detached=<key>, renderer/workspace/detached/)
   kind.transfer(tab) ─▶ lophnDetached.open ─▶ main: 창 만들기 ─▶ browser native popup·DevTools만 moveViews(project 창 → 새 창)
   성공했을 때만 detachTab                                    take() ─▶ { project, tab, transfer } ─▶ kind.receive ─▶ 탭 하나 그리기
                                                            [Dock]·× ─▶ kind.transfer ─▶ dock ─▶ moveViews(새 창 → project 창)
   <webview> 탭(browser·앱·artifact)은 보내는 창이 element를 지우고 받는 창이 src/url로 다시 연다(page는 다시 load된다)
   docked event ─▶ kind.receive ─▶ reattachTab ◀──────── main ◀┘
   changed·open-tab·closed·opened event ◀──────────────── main ◀── patchTab·openTab·removeTab·popup

 place-window.tsx ── ShellFrame (renderer/shell/shell-frame.tsx. slot만 받고 폭·접힘·창 끌기 영역·OS별 자리를 안다)
   title bar 왼쪽: DeskSwitcher(desk 목록 + 아직 desk가 없는 workflow, New desk) · 검색(팔레트)
   title bar 가운데: TabStrip (한 칸 = tab 하나 또는 split 하나. 오른쪽 끝에 floats의 아이콘 칸: 눌린 것이 펴진 float)
   title bar 오른쪽: PanelTabs (Files·Domain·Artifacts·Workflows·Jobs. 고른 panel이 오른쪽 sidebar에 보인다) · 창 단추
   stage ─┬─ ContentCard    (머리 줄: ← →, 경로(project 이름 / 파일은 project 폴더 기준 조각), 상태 글(탭의 상태 점), ⋯ tab menu. 고른 tab, split이면 둘을 mount한다.
          │                  keep kind(앱 panel·browser·artifact)는 `keep`, 나머지는 `render`)
          └─ floats 슬롯    (첫 자식이 창의 `<webview>` 그릇(browser·앱·artifact 화면), 그 뒤 FloatLayer. stacking context 없음. 패널마다 FloatPanel, z-index = --z-sticky + 층 번호 × 2)
   왼쪽 sidebar: ProjectLeftSidebar(workspace/sidebar) → LeftSidebar(shell/left-sidebar.tsx. New session·Inbox(WaitingLayer)·Jobs, Places마다 열린 session과 접힌 Recent, Settings). 오른쪽 sidebar: ProjectPanel(workspace/sidebar/project-sidebar.tsx, 틀은 shell/right-sidebar.tsx의 머리 줄과 본문)
   왼쪽 sidebar의 session 규칙(shell/left-sidebar-places.ts): current = 이 창에 tab이 열렸거나(이 창의 place만 안다) 끝나지 않고 상태 점이 있는 session, 이 project의 live 터미널 coding agent, 사람 차례인 workflow.
   recent = 나머지. 7일 안, 사람이 지운 줄(hidden-recent)은 그 뒤 움직이기 전까지 뺀다. session을 누르면 이 project의 것은 openAgent(desk 규칙), 다른 place의 것은 toast 행동(session)으로 그 place로 간다.

 desk 바꾸기 (place-window.tsx commit)
   setActiveDesk ─▶ 저장 ─▶ lophnDetached.showOnly({ keys: 가는 desk의 detached }) ─▶ main: 그 project 창의 나머지 detached 창을 hide
                                                   └▶ missing(창이 없는 key) ─▶ open({ transfer: null, bounds })
   목록 읽기(project를 연 직후): source.workflows(project) 성공 ─▶ 목록에 없는 workflow desk를 removeDesk(Main으로 합침)

 webview 그릇 (renderer/app-frame/webview-host.tsx, 창마다 하나. project 창은 floats 층, detached 창·앱 전용 창은 본문의 층)
   card 화면(층 0) z-index 1 < floated 화면(층 = 펴진 float의 index + 1) z-index --z-sticky + 2L+1 < DOM 패널
   앱·artifact element는 src만 적고 첫 did-finish-load/did-fail-load 전까지 숨긴다. main이 새 src를 내면 element를 새로 만든다
 native overlay 층 (main/app-frame/view-order.ts viewOrder, 창마다 하나)
   browser native popup·DevTools는 main/browser/view-order.ts가 card 화면 < floated 화면 순으로 쌓고, overlay가 그 위다
```

## Home place

Home은 같은 `PlaceWindow`에 `place: { kind: "home" }`를 주어 그린다(`desktop/main.tsx`의 `home` 공간. 새 기본 창의 첫 화면이고 옛 launcher 화면은 없다). project 창과 코드가 같고 project가 필요한 것만 빠진다.

- **project가 없다(`TabHost.projectId === null`).** 터미널(통로를 주지 않는다), Explorer·Domain·Artifacts·Workflows panel, 검색 탭, project settings 탭, desk 단추(Main 하나), detached 창(`detached`를 주지 않는다)이 없다. 그 kind가 Home layout에 있어도(손상) `render`가 null을 돌려 크래시하지 않는다. html 파일은 artifact 탭이 project 파일로만 열리므로 Home에서는 문서 탭으로 연다.
- **오른쪽 sidebar는 Places와 Jobs다**(`workspace/sidebar/home-panel.tsx`). Places는 `shell/places-panel.tsx`(project·앱 목록, 등록, New app, 보관)이고 줄을 누르면 그 place로 간다. Jobs는 project panel과 같은 `JobPanel`에 `project: null`을 주어 모든 job을 보인다.
- **layout은 place key `home`(`<data>/shell/places/home.json`)이고 agent 탭은 `work_place: { kind: "home" }`로 저장한다**(project는 `{ kind: "project", id }`). 탭 `fields.place`는 `placeKey(place)`(project id 또는 `"home"`)이고 render는 이 창의 place와 다르면 그리지 않는다. Home session(`place === null`)은 그 session의 agent로 연 agent 탭이다(`agentRow`가 place가 null인 session을 찾는다). 다른 place의 session은 그 place 창으로 간다(toast 행동의 기본 처리기).
- **core가 준비되지 않았거나 시작에 실패하면 shell 대신 `HomeGate`(`desktop/places/home-gate.tsx`)가 선다**: 연결 화면(`ConnectionGate`)이나 `StartFailureScreen`. 연결이 끊긴 채(stale) 마지막 화면이 있으면 Home 창이 `ConnectionNotice`를 card 위 한 줄(`notice` prop)로 얹는다.

## 앱 place

앱은 같은 `PlaceWindow`에 `place: { kind: "app", id }`를 주어 그린다(`desktop/main.tsx`의 `app` 공간. 옛 `AppSpace`의 위쪽 바와 오른쪽 `SidePanel`은 없다). project가 없는 점은 Home과 같고, 앱 화면 탭과 앱 panel이 더해진다.

- **layout은 place key = 앱 id(`<data>/shell/places/<app_id>.json`)이고 저장된 것이 없으면 Main desk에 앱 화면 탭 하나가 고른 채 선다**(`freshLayout`). localStorage `lophn.app-layout.<app>`은 읽지 않는다. agent 탭은 `work_place: { kind: "app", id }`로, 앱 화면 탭은 `{ kind: "app_screen", key: "app-screen:<app>", app }`로 저장한다(`main/workspace/kinds/app-screen.ts`, 위험 test는 `place-layout_test.ts`).
- **앱 화면 탭(`workspace/kinds/app-screen.tsx`, `app-screen-tab.tsx`)은 그 앱의 현재 release의 entry screen을 `size: "full"`로 연다.** 앱 place마다 하나이고 닫으면 + menu의 App screen으로 다시 연다. 앱 panel 탭(`app_panel`)과 달리 보관소 key(`keepKey`)가 탭 key라 Float·desk 바꾸기에도 view가 이어진다. 화면이 멈추거나 앱이 멈췄을 때만 `ViewChrome` 줄이 선다. Detach하지 않는다(`noDetach`; 앱 place 창은 `detached`를 받지 않는다).
- **Annotate는 App panel 머리 줄의 단추다.** 앱 화면 탭이 view가 열릴 때 `host.appScreen.reportView`로 `view_session`을 알리고 `PlaceWindow`가 그 view로 `useAnnotate`를 연다. 고른 요소 목록(`AnnotationPanel`)과 알림은 앱 화면 탭이 같은 view로 따로 구독해 그린다. 받는 쪽은 이 앱 place의 열린 lophn session이고 없으면 새 session이다(보낸 뒤 그 session 탭을 연다).
- **새 앱(`openNewApp`)은 앱 화면과 lophn session을 붙인 split으로 열린다**(`startLophn`). session 요청(`route.session`)은 일반 desk 규칙으로 탭을 연다.
- **오른쪽 sidebar는 App·Domain·Logs다**(`workspace/sidebar/app-panel.tsx`). App은 옛 App details에서 Domains를 뺀 것(Icon, Folders, Version·Access·Activity), Domain은 `DomainsSection`, Logs는 `useAppRuns`가 읽은 이 앱의 run 기록이다(`RunList`; session 줄을 누르면 그 session의 Agent 탭). desk 단추는 없다(Main 하나). Files는 두지 않는다: 옛 패널도 앱 source 파일 탐색기는 없었고 연결 폴더 목록(Folders)은 App panel에 있다. preview 열기·승격 UI는 없다(`products/roadmap/app-preview.md`).
- **agent 탭의 `fields.place`는 앱 id**이고 source place는 `app`이다(`agent/tab-fields.ts`의 `sourcePlaceOf`). `agentRow`·`openedPlaceLophnSession`은 session의 place가 이 앱일 때만 이 창의 것으로 본다.

## 지키는 것

- **탭 하나는 한 곳에만 있다.** tabs, floats, detached 중 하나다. 같은 탭을 두 자리에 그리면 editor는 session이 둘이 되어 conflict가 나고, terminal은 입력을 받을 수 있는 webContents가 하나뿐이다. desk model 함수가 이를 지키고 `desk-model_test.ts`의 위험 test가 열기, split, float, dock, minimize, restore, detach, reattach, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는지 본다. `openTab`은 floated·detached 탭을 새로 붙이지 않는다. floated 패널이면 펴서 맨 위로 올리고, detached 탭이면 `PlaceWindow`가 그 창을 앞으로 가져온다.
- **"탭 하나는 한 곳에만 있다"는 desk를 건너서도 지킨다.** 같은 key의 탭은 두 desk에 없다. `host.openTab`(place-window.tsx)은 `findTab(layout, key)`로 그 탭이 있는 desk를 먼저 찾아 그 desk로 바꿔 보인다(floated면 펴서 맨 위로, detached면 창을 앞으로). 새 탭이라도 `after`가 다른 desk의 탭이면 그 desk로 바꿔 그 탭 뒤에 연다(숨은 desk의 terminal이 연 URL, `architecture/browser-tab.md`). 탭을 빼앗아 오지 않는 까닭은 detached 창과 살아 있는 terminal이 딸려 있어서다. 사라진 workflow의 desk는 Main으로 합친다(`removeDesk`): tabs는 Main 끝, floats·detached는 상한(20)이 남아 있을 때만 그대로 가고 아니면 tab으로 간다. Main에 이미 같은 key가 있으면 옮기지 않는다. 합치기는 workflow 목록 읽기에 성공했을 때만 한다(실패나 읽는 중에 합치면 desk의 탭이 모두 Main으로 옮겨진다). `desk-model_test.ts`의 위험 test가 desk를 지우고 건너 열어도 탭이 사라지거나 둘이 되지 않는지 본다.
- **화면이 그리고 고치는 것은 보이는 desk뿐이고, `<webview>`는 탭이 사는 동안 모든 desk에서 산다.** 고르지 않은 탭과 떠난 desk의 탭은 React에서 unmount한다(card는 고른 탭, split이면 둘만 mount한다). terminal은 창의 `TerminalDisplays`가 xterm·DOM·출력 구독을 유지해 돌아오면 다시 붙이며 과거 raw 출력을 다시 재생하지 않는다. browser 탭·앱 panel·artifact 탭의 `<webview>`는 탭 key가 어느 desk에서든 layout에 있으면 그릇이 숨긴 채 들고 있어 탭이나 desk를 오가도 page를 다시 load하지 않는다(`place-window.tsx`가 이전 key와 지금 `allTabs(layout)`의 차로 `webviews.release`를 부른다). 놓는 것은 탭 key가 모든 desk에서 사라졌거나 그 탭이 detached가 됐을 때다(detached 탭의 page는 그 창이 갖는다). `ViewKeeps`는 앱 panel·artifact 탭의 view_session과 마지막 state를 unmount·Float·Dock 사이에 잇는다. 떠난 desk의 detached 창은 닫지 않고 숨긴다(`showOnly`, main의 `DetachedEntry.hidden`). PTY와 그 창의 guest page가 그대로 산다. 숨은 창이 예기치 않게 사라지면 그 탭이 있는 desk가 `docked`를 받는다. 복원 때는 보이는 desk의 detached 창만 열고, 다른 desk의 것은 그 desk로 갈 때 `showOnly`의 `missing`으로 연다. `showOnly`는 보낸 project 창의 detached 창만 건드리고 detached 창이 부르면 `forbidden`이다(`ipc_test.ts`). key를 만들거나 열린 탭을 찾는 곳(agent 탭 번호, 같은 session 재사용, 파일 이름 바꾸기, 닫은 탭 다시 열기, 대기 목록의 terminal)은 `host.windowTabs()`·`allTabs(layout)`로 모든 desk를 본다.
- **workflow 탭은 자기 workflow의 desk에 산다.** `TabKindDef.homeDesk`가 있는 탭을 여는 길(sidebar의 workflow 줄, `openWorkflow`)은 어디에도 열려 있지 않으면 그 desk로 가서 연다(desk가 없으면 `addDesk`로 workflow 이름을 key·label·`workflow`로 만든다). 그 desk가 보이면 sidebar Workflows의 그 줄이 강조된다.
- **탭을 찾고 바꾸는 곳은 tabs, floats, detached를 모두 본다.** `findTab`(layout, 어느 desk의 무엇인지), `allTabs`, `mapLayoutTabs`를 쓴다. `host.openTab`, `patchTab`, `removeTab`, 닫은 탭 다시 열기, 파일 이름 바꾸기, 대기 목록의 terminal 고르기가 floated 탭에도 같다. 닫은 floated 탭은 tab으로 돌아온다. detached 탭을 여는 길은 모두 그 창을 앞으로 가져오고, 닫는 길(`removeTab`)은 그 창을 닫고 항목을 버린다. palette 탭 행에는 보이는 desk의 tabs만 나온다.
- **탭 안에서 연 것의 자리는 `workspace/open-policy.ts`의 `openAt` 하나가 정한다.** 터미널(shell, coding agent)의 URL·파일 경로, lophn agent 대화의 파일 link, 검색 결과처럼 탭(source) 안에서 연 새 탭은 source 바로 뒤다(split의 a 뒤면 짝 뒤로 비킨다). source가 floated·detached이거나 없으면 desk 끝, 보이지 않는 desk면 source 바로 뒤(`openTab`이 그 desk로 건너간다)다. 대화 코드 블록의 실행(`run`)은 floated 새 터미널이다. 이미 열린 탭은 이 규칙을 거치지 않고 있는 자리에서 보인다. 여는 쪽은 `openFile(host, path, { from })`처럼 source key만 넘기고 `after`를 스스로 계산하지 않는다.
- **project 창 renderer가 detached 항목까지 layout 전체를 갖고 저장한다.** detached 창은 자기 탭 하나를 main을 거쳐 받고(`take`), 바뀐 값(`changed`), 탭 열기(`open-tab`, project 창에 docked로), 닫기(`closed`)를 main을 거쳐 project 창에 알린다. layout 파일은 place마다 하나(`<data>/shell/places/<prj_id>.json`)이고 마지막에 쓴 것이 이기므로 저장하는 곳은 하나다. project 창은 project마다 `PlaceWindow`를 새로 mount한다(`key`). 그렇지 않으면 저장된 layout이 없는 project로 갈 때 앞 project의 탭이 남아 그 project의 layout으로 저장된다. main은 탭 값을 열어 보지 않고(key와 kind만) 같은 project 창에만 중계하며, 보낸 창으로 역할을 가려 `forbidden`으로 막는다(`main/desktop/detached/ipc.ts`). detached 창 bounds는 main이 저장할 때 살아 있는 창 값으로 채우고, 창을 옮기거나 크기를 바꾸면 `moved`로 project 창에 다시 저장하게 한다.
- **desktop 창의 자리는 layout이 아니라 앱에 하나다(`window.json`).** 한 창이 Home·project·settings를 오가므로 창 자리는 project에 속하지 않는다. desktop 창을 옮기거나 크기를 바꾸면 500ms 뒤에, 최대화·되돌림·닫기 때는 바로 마지막 자리를 쓴다. 최대화한 창은 되돌렸을 때의 자리(`getNormalBounds`)와 `maximized`를 둔다. 최소화와 전체 화면은 쓰지 않는다. 새 desktop 창(시작, tray, 단일 instance 요청)은 그 자리를 지금 화면 작업 영역 안으로 당겨(`desktop/work-area.ts`) 열고, 다른 desktop 창이 떠 있으면 32px 비켜 연다. detached 창은 이 값을 쓰지도 고치지도 않는다.
- **webview는 card의 아래 두 모서리를 직접 둥글게 그린다.** `<webview>`는 slot 부모로 잘리지 않고 그릇의 형제라 조상의 `overflow: hidden`이 닿지 않는다. 그릇의 page 요소(`webview-host.module.css`의 `.page`)가 `border-radius: 0 0 var(--radius-lg) var(--radius-lg)`와 `overflow: hidden`을 갖는다. 화면은 card·float 패널의 머리 줄 아래에 있어 위 두 모서리는 머리 줄에 닿는다. split이면 안쪽 아래 모서리도 둥글다(알려진 모양). 앱 전용 창은 창 전체를 쓰므로 `app-window.module.css`가 각지게 덮는다. native view(browser popup, DevTools, overlay)는 각진 채다.
- **Detach와 Dock은 transfer → main이 창을 열거나 닫고(native view가 있으면 옮김) → 성공했을 때만 layout 바꾸기 순서다.** 어느 단계가 실패해도 layout은 그대로라 탭이 사라지지 않는다. `TabKindDef.transfer`가 null을 내면 옮기지 않는다(editor는 `EditorSessions.flush`가 실패하면 null이라 저장 안 된 글을 잃지 않는다. `editor/transfer_test.ts`). 값은 `TabTransfer { value(JSON), views(옮길 native view의 view_session) }`이고 받는 창의 `receive`가 그리기 전에 받는다. terminal은 `terminal_ref`·`generation`(받는 창이 snapshot을 0부터 받는다), agent는 그 session의 composer draft(새 session 탭은 `new:` draft 전부, 받는 창의 글은 덮지 않는다), browser popup만 view_session과 state를 넘긴다(native view를 옮긴다). 앱 panel·artifact 탭은 transfer를 선언하지 않고(기본 `{ value: null, views: [] }`), 보통 browser 탭도 같은 값을 낸다. 받는 창이 다시 열며 page를 다시 load한다. 나머지 kind는 `toStored` 값으로 다시 연다. `noDetach` kind(browser DevTools 패널)는 Detach 항목과 단추가 없다. tab은 보내기 전에 `slimDetachedTab`으로 4096자를 넘는 `fields` 값(favicon data URL)을 뺀다(IPC 한 번이 64KiB까지다).
- **native view는 닫지 않고 창을 옮긴다. 그 항구를 쓰는 것은 browser의 크기 준 popup과 DevTools뿐이다.** `AppViews.moveViews(from, to, sessions)`가 모든 view가 `from` 창의 것인지 먼저 보고(아니면 아무것도 옮기지 않고 `invalid_input`), 기다리던 bounds를 버린 뒤 browser registry(`main/browser/registry.ts`의 popup·DevTools 항목)의 `move`로 보낸다(`main/browser/native-bounds.ts`). 옮긴 view는 떼어 숨긴 상태이고 새 창 renderer가 bounds를 보내면 붙는다. 옛 창 renderer가 늦게 보내는 요청은 소유 검사로 거절되어 무해하다. renderer에서는 `ViewKeeps.lookup`/`track`이 mount된 view의 session과 최신 state도 찾게 한다. `<webview>` guest는 이 항구로 오지 않는다: 앱·artifact·보통 browser 탭은 보내는 창이 element를 지우고 받는 창이 새로 만든다(보통 browser 탭은 url로 다시 load되고 cookie는 partition에 남는다. 그 탭의 DevTools는 닫힌다). popup 탭의 DevTools는 같이 옮긴다(floated 패널이던 것은 탭 안으로 바꿔서).
- **detached 창의 ×는 dock이다.** main이 창 닫기를 가로채 renderer에 `dock-request`를 보내고 renderer가 [Dock]과 같은 흐름을 돈다. 실패하면 창이 그대로 남는다. 앱을 끄는 중에는 가로채지 않고 자동으로 dock하지도 않는다(다음 실행에 `detached`로 돌아온다). 창이 예기치 않게 사라지면(renderer crash 등) main이 저장된 값으로 `docked`(transfer 없음)를 보내 탭이 layout에 남는다. project 창을 닫거나 같은 창에서 다른 공간으로 가면 그 창의 detached 창이 조용히 닫히고 상태는 `detached`로 남는다. 다시 열면 `PlaceWindow`가 저장된 값과 bounds(지금 화면 작업 영역 안으로 당긴 것)로 창을 연다. 같은 실행 안이면 terminal은 PTY에 다시 붙는다: detached 창이 kind의 `resume`(terminal은 `terminal_ref`·`generation`)을 `changed`로 알려 main이 들고(`DetachedRegistry`의 kept, 메모리에만), 조용히 닫힐 때(`close({ key: null })`, project 창 닫힘) (project, key)로 남겨 두었다가 같은 key의 `open({ transfer: null })`에 한 번 쓰고 지운다. 다시 열 때 쓰든 말든 지워 같은 PTY가 두 창에 붙지 않고, 개별 close·dock·remove와 앱 종료에서도 지운다. 앱을 다시 띄우면 transfer가 없어 재시작과 같다(PTY에 못 붙는다). 같은 (project, key)의 창이 이미 있으면 새로 띄우지 않고 앞으로 가져온다(`conflict`).
- **detached 창은 탭 하나만 그린다.** `Desktop`의 `detached` route이고 탭 줄도 sidebar도 floats 층도 없다(`<webview>` 그릇 하나가 자기 탭의 화면을 담는다). 그 안의 `openTab`은 project 창에 docked로 열고(agent 새 탭의 key가 project 창의 다른 session 탭과 겹치면 project 창이 새 번호로 바꿔 연다), 크기 준 browser popup은 또 하나의 detached 창으로 연다(popup view를 그 창으로 옮겨 `window.opener`를 지킨다). floats 층이 없어 browser 탭의 DevTools 자리 menu에서 floated를 뺀다. toast와 전역 palette intent는 이 route에서 끄고, tray와 전역 palette 키는 detached 창을 "가장 최근 창"으로 고르지 않는다.
- **`dockFloat`·`reattachTab`은 tabs 끝에 넣고 고른다.** preview와 transient 표시를 지운다. 떠나기 전 자리는 저장하지 않는다.
- **minimized는 floated에서만 간다.** 접혀도 `rect`는 접기 전 값을 지킨다. 접힌 float은 mount하지 않고(keep kind도) title bar 오른쪽 칸의 아이콘으로 있으며, 아이콘을 누르면 펴서 맨 위로 온다(`restoreFloat`). 펴진 float의 아이콘은 눌린 모양이다.
- **`transient` 탭은 저장하지 않는다.** popup처럼 잠깐 뜬 패널이다. `layoutToStored`가 `tabToStored`에서 transient를 거른다. Dock하면 사람이 고른 것이라 저장한다.
- **rect는 stage(card를 감싸는 칸) 왼쪽 위 기준 정수 CSS px다.** 가장 작은 크기는 320×200이다. 그릴 때는 지금 stage 안으로 당겨(`clampFloatRect`) 그리고 저장된 rect는 사람이 옮기거나 크기를 바꿀 때만 바뀐다. 창이 줄었다 커지면 원래 자리로 돌아온다. stage를 아직 못 쟀거나 0이면 float 층을 그리지 않고 rect를 저장하지 않는다.
- **패널 DOM 순서는 탭 key 순으로 고정하고 위아래는 z-index로만 정한다.** raise할 때 요소를 재배열하면 안에 있던 focus와 scroll(terminal, editor)이 날아간다. 누르거나 focus가 들어오면 맨 위로 온다.
- **`<webview>`는 창의 그릇 하나에 탭 key(앱 card는 그 화면의 view_session)당 한 번 만들고 옮기지 않는다.** 다른 부모로 옮기면 guest가 다시 만들어져 page가 다시 load된다. floats 층은 stacking context를 만들지 않고 패널 z-index가 --z-sticky + 층 번호 × 2라서, card 화면은 z-index 1, floated 화면은 자기 패널 위·다음 패널 아래(--z-sticky + 2L+1)에 놓인다. browser 탭의 층 번호는 펴진 float 중 몇 번째인지다(`host.desk.floats`에서 접힌 것을 빼고 센다). browser element는 `partition`·`allowpopups`를 직접 적고, 앱·artifact element는 `src`만 적는다(partition·preload는 main이 붙일 때 강제한다). main이 새 `src`를 내면 같은 자리에서 element를 새로 만든다. 자리는 사각형만 알린다(`renderer/app-frame/webview-host.tsx`).
- **focus는 split의 한 쪽(`split.focus`)이다.** card의 반쪽을 누르거나 tab 줄의 반쪽을 누르면 옮긴다. kind의 `render`가 받는 `active`는 split이 아니거나 focus 쪽일 때 true이고 floats 안의 탭은 늘 true다. terminal의 사람 입력은 DOM focus가 있는 곳에만 간다. resize는 보이는 terminal의 칸 크기를 따르고, 숨은 xterm의 질의 응답은 별도로 처리한다. 탭 단축키(Ctrl+W 등)는 focus 쪽 탭에 듣는다(`focusedKey`).
- **native view는 overlay뿐이고, 그 위아래는 `viewOrder`가 정한다.** browser의 크기 준 popup·DevTools는 `main/browser/view-order.ts`가 card 화면 < floated 화면 순으로 쌓고, overlay native view는 `app-frame/view-order.ts`의 `viewOrder`가 늘 그 위에 둔다. native view는 shell DOM 위에 그려지지만 앱·artifact 화면은 DOM(`<webview>`)이라 그 문제가 없다.
- **DOM 패널은 `<webview>` 위에 z-index로 그린다.** floated 패널은 `<webview>` 그릇의 층보다 높고(--z-sticky + 2L), 오른쪽 sidebar는 card 옆 열이라 화면을 덮지 않는다. 화면을 줄이던 cover 장치는 없다.
- **앱 panel·앱 화면·artifact 탭의 `<webview>`는 탭이 사는 동안 산다.** Float, Dock, 접기, desk 바꾸기로 `EmbeddedView`가 다시 mount되어도 그릇이 element를 들고 있어 page를 다시 load하지 않는다. `ViewKeeps`(창마다 하나, renderer)는 view_session과 마지막 state를 이어 탭이 다시 mount될 때 같은 view를 쓴다. 탭 key가 모든 desk에서 사라지거나 detached가 되면 그릇이 element를 지운다(`PlaceWindow`). 앱 card는 그 화면이 unmount될 때 닫는다. 열기 입력이 바뀌면 옛 view를 닫고 새로 연다.
- **앱 panel 탭에는 평소 shell 크롬 줄이 없다(사람).** 탭 이름이 이미 앱 이름이고, 탭 줄과 앱 화면 사이에 다른 바탕의 줄이 끼면 탭과 본문이 한 면으로 이어지지 않는다. 화면이 멈추거나 crash했을 때, 앱이 멈췄을 때(`stopped`·`unavailable`)만 `ViewChrome`이 상태와 [Open again]을 띄운다(`app-panel-tab.tsx`). 앱 template의 `src/surface.css`는 앱 바탕을 탭 본문과 같은 `--color-surface-base`로 둔다. 강제하지 않는다.
- **앱 icon은 사람이 올린 것이 선언한 것보다 앞서고 layout에 싣지 않는다.** 선언의 `icon`(bundle 안 `/…/x.svg|png|webp` 경로, 64 KiB 이하)은 release 준비가 source commit에 그 파일이 있는지 보고, core의 `apps.icon` read(`{app}` → `{icon: {content_type, data(base64)} | null, uploaded}`)가 먼저 사람이 올린 icon(`app_icons` 표, 아래)을 보고 없으면 active release의 bundle 사본에서 읽는다. bundle 밖을 가리키는 경로·symlink, 큰 파일, 선언 없음은 모두 `null`이고 오류가 아니다. 사람은 App details의 Icon 절에서 올리고 지운다(`app.set_icon {app, icon: {content_type, data} | null}`, 지우면 선언한 icon, 그것도 없으면 첫 글자 `PlaceMark`로 돌아간다). renderer는 `app-frame/app-icon.tsx`의 `useAppIcon(app)`로 data URL을 받아 앱 패널 탭 아이콘(`iconOf`), Places panel 앱 줄과 왼쪽 sidebar의 `PlaceMark`에 쓴다. 탭의 `toStored`에는 들어가지 않고 그릴 때마다 읽는다(10초 cache, 올리거나 지우면 cache를 버리고 떠 있는 표식이 다시 읽는다. `parts/icon-upload/icon-reader.ts`).
- **project icon은 사람이 올린 이미지만 있다.** project에는 선언이 없다. core `projects.icon`(`{project}` → `apps.icon`과 같은 출력)과 `projects.set_icon`(`{project, icon | null}`)이고, renderer는 `parts/project-icon/project-icon.tsx`의 `useProjectIcon(project)`·`ProjectPlaceMark`로 Places panel project 줄과 왼쪽 sidebar에 쓰고, 올리는 칸은 `ProjectIconField({project, name})` 하나다. 올리는 줄(`parts/icon-upload`)은 앱과 project가 같이 쓴다.
- **올린 icon의 저장과 검사.** 올린 icon은 ledger 표(`app_icons`·`project_icons`, schema step `apps.registration.icons`·`projects.registry.icons`)에 base64 글 그대로 앱·project당 한 줄로 둔다(64 KiB 이하라 blob 저장소의 준비·중계를 거치지 않고, revision도 event도 올리지 않는다). 검사는 `protocol/base/icon.ts`의 `checkIconUpload` 하나다: svg·png·webp만, 64 KiB 이하, 선언한 type과 바이트 앞부분이 맞아야 하고 아니면 `invalid_input`, 없는 앱·project는 `not_found`다.
- **앱 전용 창은 shell 문서 하나다.** main이 `sizes`에 `full`을 적은 첫 screen을 골라 `openDesktopWindow`로 `#app-window=<app>/<release>/<screen>`(각 부분 `encodeURIComponent`) hash의 desktop 창을 연다. 앱 하나에 창 하나이고 다시 요청하면 그 창을 앞으로 가져온다. renderer의 `app-window` route(`renderer/app-frame/app-window.tsx`)가 앱 이름과 창 단추가 있는 위쪽 bar와 그 화면 하나를 창 본문 전체의 `<webview>`로 그린다(`mode: live`). `webviewTag`·shell preload는 다른 shell 창과 같고, 전역 palette·tray의 "가장 최근 창"에서 detached 창과 같이 빠진다(`ctx.appWindows`).
- **여는 길은 tab 메뉴(tab 줄 오른쪽 클릭과 card 머리 줄 ⋯가 `shell/tab-menu.tsx`의 같은 항목: Rename·Close·Close others·Close to the right·Close saved·Close all·Split right·Split down(split이면 다른 방향 하나)/Unsplit·Float·Move to new window·Copy path·Copy relative path·Reveal in Explorer·Keep open), 패널 bar의 Minimize·Dock·Close, title bar 오른쪽 칸의 아이콘(누르면 펴고 접는다), tab 줄 끌어 순서 바꾸기, 단축키 `pane.split`·`pane.focus`·`tab.*`, 명령 palette(Float tab, Dock panel, Minimize panel), detached 창 bar의 [Dock]이다.** Detach는 palette 명령이 없다. palette의 Dock·Minimize 대상은 맨 위의 접히지 않은 패널이다. 접힌 패널은 먼저 펴야 Detach할 수 있다. 칸 사이로 옮기는 command(`tab.to-prev-pane`·`tab.to-next-pane`)는 칸이 없어 아무것도 하지 않는다.

## split과 이동 기록

- **split은 tabs에서 붙은 두 tab 하나뿐이다.** `split { a, b, focus, dir: "row" | "column", ratio }`이고 b는 a 바로 뒤다. `dir`은 좌우(row)·위아래(column), `ratio`는 a의 몫(0.15~0.85, 기본 0.5)이다. card의 두 반쪽 사이 선을 끌면 `ratio`가 바뀌어 저장되고(놓을 때 한 번), tab 줄의 반쪽 사이 아이콘이 `dir`을 보인다. `pane.split`은 좌우로 붙이거나 푸는 토글이다. tab 줄에서 한 칸이고(key는 a) card에서는 반쪽마다 머리 줄을 가진다. `splitWith(a, b, dir)`는 b를 a 바로 뒤로 옮기고 a를 고른다(몫은 0.5)(이미 있던 split은 풀린다). 구성원을 닫거나 띄우거나 떼면 split이 풀리고 짝이 선택된다. 순서 바꾸기(`moveTab`)는 짝을 함께 옮기고 둘 사이로는 못 든다. 읽을 때 어긋난 split은 버리고 tab은 남긴다(`layout-source.ts`의 `repaired`).
- **이동 기록은 창 하나의 메모리에만 있다.** `{ desk, key(고른 칸), focus }` 최대 50개이고(`place-window.tsx`의 `trail`) 저장하지 않는다. desk·고른 칸·split 쪽이 바뀔 때 쌓고, 뒤로 간 뒤 새로 쌓으면 앞은 잘린다. 닫은 tab·지운 desk의 자리는 건너뛴다. ← →로 걸을 때는 걷는 자리가 이미 기록의 현재 자리라 더 쌓지 않는다. layout을 다 읽은 뒤부터 쌓는다.

## place layout (판 8)

project 창이 읽고 쓰는 저장과 model이다. 옛 project layout 파일은 읽어 올리는 데만 쓴다.

- **파일은 place마다 하나다.** `<data>/shell/places/<place>.json`이고 place는 `home`, project id, app id다(`main/workspace/place-layout*.ts`). 파일 이름이 되는 key는 `[A-Za-z0-9_-]{1,64}`만 받아 폴더 밖으로 나갈 수 없다(`invalid_input`). 원자 교체와 mode는 `layouts/`와 같다(`atomic-file.ts`).
- **모양은 `{ schema_version: 8, active_desk, desks: { <key> → { label, workflow?, tabs, selected_tab, split: {a, b, focus, dir, ratio} | null, floats: [{tab, rect, minimized}], detached: [{tab, bounds}] } } }`다.** 칸 tree는 없다. desk는 1~200개이고 `_default`(Main)가 늘 있다. 한 desk 안에서 tab key는 tabs·floats·detached를 통틀어 한 번만 나오고, `selected_tab`과 split의 a·b는 tabs 안에 있으며 b는 a 바로 뒤다. schema가 이를 거절한다. `split.dir`·`split.ratio`가 없는 판 8 파일(초기 개발 data)은 좌우 반반으로 읽는다. renderer의 순수 model은 `renderer/shell/desk-model.ts`가 같은 불변 조건을 지키고, 저장된 값과의 변환은 `renderer/shell/layout-source.ts`가 kind registry로 한다.
- **읽는 순서.** place 파일이 있으면 판 8만 읽는다(다른 판은 `unsupported_schema`이고 파일은 그대로다). 없고 place가 project면 `layouts/<prj_id>.json`을 `parseLayoutFile`(판 5·6 → 7)로 읽어 판 8로 올린다(`upgradeFromV7`). 둘 다 없으면 `absent`이고 renderer가 Main 하나인 기본 layout을 쓴다. 옛 파일은 읽기만 하고 고치지 않으며, 다음 저장이 place 파일을 만들어 그 뒤로는 옛 파일을 보지 않는다.
- **판 7 → 8.** desk마다 칸의 tab을 칸 순서(왼쪽·위에서부터)로 한 줄에 합치고, 같은 key는 처음 것만 남긴다(float·detached 포함). `selected_tab`은 focus 칸의 선택(없으면 첫 tab), split은 없다. float은 `tab`·`rect`·`minimized`만 남고 `origin_pane`·`docked_at`은 버린다. `rail_apps`는 버린다. `_default`는 label `Main`이고 다른 desk는 workflow desk라 key(workflow 이름)가 label이자 `workflow`다. tabs 상한은 옛 칸 6개 × 200을 잃지 않도록 1200이다(`place-layout_test.ts`).
- **IPC.** `shell:place-layout-read`(`{ place }`)와 `shell:place-layout-save`(`{ place, layout: { active_desk, desks } }`)다. desktop 창 본문만 부르고, 저장할 때 main이 살아 있는 detached 창의 bounds로 덮는 것은 옛 저장과 같다. preload는 `lophnLayout.readPlace/savePlace`다.
- **renderer의 길.** `PlaceWindow`는 `source.layout`(`WorkspaceSource.layout: LayoutSource`, `createLayoutSource()`가 preload의 `lophnLayout`을 감싼다)으로 `{ kind: "project", id }`의 layout을 읽고(null이면 `defaultPlaceLayout()`) 바뀔 때마다 저장한다. 읽던 위치·입력처럼 잦은 바뀜은 200ms 모아 쓴다. 옛 `layout:read`·`layout:save` IPC는 renderer가 더는 부르지 않는다.

## 왜 이 모양인가

- **layout 파일은 place마다 하나다.** 하나를 앱 전체가 쓰면 다른 project를 열어 저장할 때 앞 project의 layout을 덮어써 workflow desk를 모두 잃는다. 이름은 `project.update`로 바뀌므로 id다.
- **desk key는 workflow desk면 그 project 안의 workflow 이름이고 기본 desk는 `_default`다.** 사람이 만든 desk는 `desk-<시각>-<번호>`이고 label은 "Desk N"이다. project 이름을 넣지 않아 project 이름을 바꿔도 desk가 남는다. `_`로 시작하는 값은 slug가 아니라 workflow 이름과 겹치지 않는다. renderer `shell/desk-model.ts`와 main `place-layout.ts`가 같은 값을 따로 적는다. workflow 폴더 이름을 바꾸면 옛 desk는 Main으로 합쳐진다(바뀌지 않는 workflow id가 없다).
- **desk를 건너 탭 key가 겹치는지는 schema가 거절하지 않는다.** 거절하면 읽기가 손상이 되어 layout 전체를 잃는다. 겹침은 model과 그 위험 test가 막는다.
- **desk를 바꿀 때 detached 창은 "보일 key 목록" 한 번으로 맞춘다.** 창마다 부르면 중간에 일부만 바뀐 채 남을 수 있다. 창이 없는 key를 main이 열지 않는 까닭은 열기에 필요한 탭 값과 bounds를 renderer가 갖고 있고, 이미 있는 창에 `open`을 부르면 앞으로 가져와 focus를 뺏어서다. 보이기는 focus 없이(`showInactive`) 한다.
- **project 창에는 place switcher가 없다.** Home으로 가는 줄(왼쪽 sidebar의 Home)과 Settings 단추는 왼쪽 sidebar에 있고, 파일 경로는 card 머리 줄의 crumb이다. place 이동은 왼쪽 sidebar가 새로 만들어지면 그쪽이 맡는다.
- **floats 개수(20)는 schema만 막는다.** 사람이 20개를 띄울 일이 없다.
- **새 패널은 stage 가운데 60% 크기로 겹쳐 뜬다.** 비껴 놓기(cascade)는 하지 않는다.
- **겹치는 패널은 `<webview>` 위에 그린다.** native view 때는 화면이 DOM 위에 그려져 겹치는 동안 view를 cover로 줄여야 했다. 앱·artifact 화면은 DOM(`<webview>`)이라 패널이 그 위에 바로 겹친다. 버린 안: 겹치는 동안 마지막 `capturePage` 그림을 보이기(page가 멈춘다), DOM 패널도 native view로 띄우기(패널마다 shell renderer 하나라 가장 크다). 잃는 것은 없다. 밑의 page가 패널에 가려진 채 계속 돈다.
- **view 보관소는 renderer에 둔다.** `<webview>` element는 창의 그릇이 들고 view_session·state는 `ViewKeeps`가 든다. main registry가 이미 view와 붙은 guest를 구분하므로 새 IPC가 필요 없다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 layout에 없으면 닫는다.
- **옛 layout 파일(판 1, 2)은 읽지 않는다.** 새로 만든다(AGENTS.md "호환성").
- **detached 창은 탭 하나만 갖는다.** 탭 줄이 있는 detached 창은 workspace를 하나 더 만드는 일이다. 탭 여럿을 보려면 창을 여럿 띄운다. dock은 그 desk의 tabs 끝에 붙이고 떼기 전 자리는 저장하지 않는다(floated였어도 docked로 온다).
- **값은 창이 뜬 뒤 `take()`로 당겨 받는다.** hash `#detached=<key>`는 route 선택용이다. 탭 key가 4096자까지이고 transfer가 커질 수 있다.
- **두 방향(project 창, detached 창)을 IPC 하나(`ipc/detached.ts`, `window.lophnDetached`)로 묶는다.** 같은 renderer bundle과 preload를 쓰는 창이고 main이 보낸 창으로 역할을 가른다. 통로를 둘로 가르면 preload·노출·type이 두 벌이 된다.
- **browser 탭·앱 화면·artifact 화면은 Detach하면 다시 load된다(사람).** `<webview>`는 그것을 띄운 shell 문서에 묶여 다른 부모로 옮기면 guest가 다시 만들어진다. 쓰던 form, scroll, 그 page가 연 popup의 `window.opener`를 잃는다. 다시 load 없이 옮길 수 있는 곳은 native view뿐이고 그것이 `window.opener`가 걸린 browser popup과 DevTools다.
- **detached 창 안의 popup은 또 하나의 detached 창이다.** 가장 단순하게 `window.opener`를 지킨다. 대안인 project 창 floats 층으로 옮기기는 opener 소유 이동이 더 필요하다. `open`의 bounds에 opener 창 가운데 features의 크기를 넣고, 화면 작업 영역 안으로 당긴다. detached 창만 최소 크기가 320×240이다(다른 창과 bounds가 없는 detached 창은 960×600).
- **split은 tab 둘을 붙인 값 하나다(사람).** 칸 tree는 칸마다 탭 줄·focus·drop zone을 따로 갖게 해 탭이 어느 칸에 있는지가 복잡했다. tab 줄이 하나이고 같이 보고 싶은 두 tab만 한 칸으로 붙이면 탭 줄·선택·저장이 모두 한 줄로 끝난다.
- **고정 앱 패널(`rail_apps`)은 없다.** activity bar가 없어서 판 8로 올릴 때 버린다. 앱 패널은 + menu의 App panel이나 앱 place의 열기로 연다.
- **판 5 파일은 읽을 때 올린다.** 좌우 두 칸이던 `split_ratio`는 `row` 나눔 하나가 된다(`layout.ts`의 `upgradeFromV5`). 쓰던 탭 배치를 새로 만들지 않으려는 것이고 다음 저장에서 판 6 파일이 된다(AGENTS.md "호환성").
- **앱 화면도 `<webview>`로 옮겼다(사람, 2026-10-31).** native view는 shell HTML 위에 그려져 menu·popover·floated 패널·toast가 앱 page 밑에 깔렸고, 피하려고 층·cover·bounds relay가 쌓였다. browser 탭이 같은 이유로 이미 `<webview>`를 쓰고 그 뒤로 겹침 문제가 없다. iframe은 preload의 isolated world, 앱별 partition, sender 신원을 잃고, remote UI는 앱이 자기 DOM·CSS component를 못 쓰게 해서 버렸다. Electron은 `<webview>`를 권하지 않지만 browser 탭이 이미 그 위험을 지고 있어 새 위험이 아니다.
- **artifact 탭도 같이 옮겼다(agent).** 같은 겹침 문제를 갖고 있었다. 남겨 두면 앱 쪽 장치를 지우지 못한다.
- **붙이기 ticket은 `src` 하나이고 한 번만 쓴다(agent).** registry의 `acceptGuest(window, src)`가 그 창의 view이고 그 src를 아직 안 쓴 때만 받는다. renderer가 적은 partition·preload·webPreferences는 버리고 main이 정한 값만 쓴다. renderer가 붙이기 값을 위조해도 다른 session이나 preload로 갈 수 없다.
- **앱 저장소 partition 이름은 그대로다(agent).** `persist:app-<app>:live`·`persist:app-<app>:preview-<bundle hash>`를 바꾸지 않아 사람의 `~/.lophn` cookie·localStorage·IndexedDB가 이어지고 migration이 없다.
- **`<webview>`는 layout에 있는 동안 숨기기만 한다.** desk를 떠났다 돌아오면 쓰던 form·scroll을 잃던 결함(`issues/workspace-layout.md`)이 있었다. 탭 key가 어느 desk에든 있는 동안 element를 들고 있으면 desk 전환에 드는 것이 없고, detached 탭만 그 창에 넘긴다(page가 두 창에 살지 않게).
