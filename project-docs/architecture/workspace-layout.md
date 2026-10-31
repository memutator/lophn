# workspace layout

project 창이 가진 탭이 어디에 있는가를 정하는 메커니즘이다. project 창의 layout은 desk로 나뉜다. desk는 기본 desk(`_default`, 화면 이름 "Main") 하나와 그 project의 workflow마다 하나이고, 상단 bar 왼쪽 경로 `project ▾ / desk ▾`로 바꾼다. desk마다 탭은 pane의 탭 줄(docked), workspace 위에 뜬 패널(floated), 상단 bar의 span(minimized), OS 창 하나(detached) 중 한 곳에 있다. 모든 탭 kind가 같은 길을 쓴다. renderer의 순수 함수 layout model, main이 project마다 검증해 저장하는 layout 파일, 패널을 그리는 floats 층, 창마다 하나인 `<webview>` 그릇과 그 z-index, 탭을 창 사이로 옮기는 main 중계(`transfer`/`receive`)에 걸친다. browser 탭 page, 앱 화면, artifact 화면은 native view가 아니라 그 `<webview>` 그릇에 산다(`browser-tab.md`, `renderer/app-frame/webview-host.tsx`). native view는 browser의 크기 준 popup·DevTools와 overlay뿐이다.

## 흐름

```
 renderer/workspace/model.ts ── WorkspaceDesks { active, desks: { _default | <workflow 이름> → WorkspaceView } }
   WorkspaceView { panes(1-6), layout(LayoutNode), focusedPane, floats[], detached[] }
   LayoutNode = "leaf" | { dir: row|column, ratio, a, b }  잎 순서 = panes 순서 (renderer/workspace/layout-tree.ts)
   FloatItem { tab, rect, minimized, originPane }  배열 순서 = 위아래 순서(마지막이 맨 위)
   DetachedItem { tab, bounds }                    bounds = OS 화면 좌표, 배열 순서 = 뗀 순서
   순수 함수: floatTab, dockTab, openFloat, minimizeTab, minimizeFloat, restoreFloat, raiseFloat, closeFloat, setFloatRect,
             splitTab, dropTabOnPane, detachTab, openDetachedTab, attachDetached, closeDetached
   desk 층: switchDesk, openAcrossDesks, deskOfTab, allDeskTabs, mapDeskTabs, vanishedDesks, mergeDeskIntoDefault
        │
        │ 바뀔 때마다 storableDesks(transient 탭 빼기) ─▶ toStoredLayout ─▶ layout:save { project, active_desk, desks, rail_apps }
        ▼                                                   (main이 모든 desk의 detached bounds를 살아 있는 창 값으로 덮는다)
 main/workspace/schema.ts ── <data>/shell/layouts/<prj_id>.json (LAYOUT_SCHEMA_VERSION 7, desk 1~200개, desk마다 floats·detached 각 최대 20, project마다 rail_apps 최대 20)
                             판 5·6은 읽을 때 판 7로 올린다(`upgradeFromV5`, `upgradeFromV6`). 그 밖의 다른 판은 unsupported_schema, 새로 만든다. 옛 <data>/shell/layout.json은 읽지 않는다
 activity bar의 고정 앱 패널 (rail_apps: [{ app, surface, title? }], app+surface 중복 없음)
   renderer workspace.tsx의 railApps state ─▶ 바뀔 때 persist ─▶ layout 파일의 rail_apps. desk와 달리 project 전체의 값이라 desk를 바꿔도 같다
   sidebar/rail-apps.tsx (ActivityBar 아래쪽 묶음, 바로 가기와 Settings 사이. host.appScreens가 false면 묶음·+·tab menu 항목이 없다)
     단추 ─▶ openPinnedAppPanel: 이 창 모든 desk·floated·minimized·detached 탭 중 같은 app+screen 탭이 있으면 openTab이 그 탭으로 가고, 없으면 app·screen·title을 채운 새 탭을 focus pane에 연다
     오른쪽 클릭 ─▶ 고정 해제. + ─▶ panelChoices(앱 패널 picker와 같은 목록)에서 골라 고정만 한다
     탭 menu(Panes) ─▶ kind.railApp(tab)이 값을 주는 탭(앱을 고른 app_panel)에 Pin to / Unpin from activity bar
 main/workspace/window-state.ts ── <data>/shell/window.json { bounds, maximized } 앱에 하나. desktop 창의 마지막 자리

 Detach (project 창 workspace.tsx)                         detached 창 (#detached=<key>, renderer/workspace/detached/)
   kind.transfer(tab) ─▶ lophnDetached.open ─▶ main: 창 만들기 ─▶ browser native popup·DevTools만 moveViews(project 창 → 새 창)
   성공했을 때만 detachTab                                    take() ─▶ { project, tab, transfer } ─▶ kind.receive ─▶ 탭 하나 그리기
                                                            [Dock]·× ─▶ kind.transfer ─▶ dock ─▶ moveViews(새 창 → project 창)
   <webview> 탭(browser·앱·artifact)은 보내는 창이 element를 지우고 받는 창이 src/url로 다시 연다(page는 다시 load된다)
   docked event ─▶ kind.receive ─▶ attachDetached ◀──────── main ◀┘
   changed·open-tab·closed·opened event ◀──────────────── main ◀── patchTab·openTab·removeTab·popup

 workspace.tsx
   .content ─┬─ Panes          (docked 탭. 고른 탭만 mount, keep kind는 숨긴 채 mount. `arrange`가 layout tree를 칸·divider 사각형으로 풀고 칸은 absolute로 놓는다)
             └─ Floats         (.floats 층, stacking context 없음. 첫 자식이 창의 `<webview>` 그릇(browser·앱·artifact 화면). 패널마다 FloatPanel, z-index = --z-sticky + 층 번호 × 2)
   TopBar.leading ── ProjectSelector ▾ / DeskSelector ▾ ─ MinimizedBar (접힌 패널 span, 넘치면 +N menu)
     (top-path/desk-selector.tsx의 PathMenu. desk 조각은 workflow가 있을 때만. 좁으면 span → desk 이름 → project 이름 순으로 준다)

 desk 바꾸기 (workspace.tsx switchTo)
   switchDesk ─▶ 저장 ─▶ lophnDetached.showOnly({ keys: 가는 desk의 detached }) ─▶ main: 그 project 창의 나머지 detached 창을 hide
                                                   └▶ missing(창이 없는 key) ─▶ open({ transfer: null, bounds })
   목록 읽기(project를 연 직후, selector를 열 때): source.workflows(project) 성공 ─▶ 목록에 없는 desk를 mergeDeskIntoDefault

 webview 그릇 (renderer/app-frame/webview-host.tsx, 창마다 하나. project 창은 floats 층, detached 창·앱 전용 창은 본문의 층, 앱 place는 .content)
   pane 화면(층 0) z-index 1 < floated 화면(층 = floats index + 1) z-index --z-sticky + 2L+1 < DOM 패널
   앱·artifact element는 src만 적고 첫 did-finish-load/did-fail-load 전까지 숨긴다. main이 새 src를 내면 element를 새로 만든다
 native overlay 층 (main/app-frame/view-order.ts viewOrder, 창마다 하나)
   browser native popup·DevTools는 main/browser/view-order.ts가 pane 화면 < floated 화면 순으로 쌓고, overlay가 그 위다
```

## 지키는 것

- **탭 하나는 한 곳에만 있다.** pane, floats, detached 중 하나다. 같은 탭을 두 자리에 그리면 editor는 session이 둘이 되어 conflict가 나고, terminal은 입력을 받을 수 있는 webContents가 하나뿐이다. model 함수가 이를 지키고 `model_test.ts`의 위험 test가 float, dock, minimize, restore, raise, detach, attach, close를 이어서 해도 탭이 사라지거나 둘이 되지 않고 옮긴 탭이 맞는 자리에 있는지 본다. `openTabIn`과 `reopenTab`은 floated·detached 탭을 새로 붙이지 않는다. `openTabIn`은 floated 패널을 펴서 맨 위로 올리고, detached 탭이면 `Workspace`가 그 창을 앞으로 가져온다.
- **"탭 하나는 한 곳에만 있다"는 desk를 건너서도 지킨다.** 같은 key의 탭은 두 desk에 없다. 다른 desk에 있는 탭을 여는 길(`openAcrossDesks`)은 그 desk로 바꿔 보인다(floated면 펴서 맨 위로, detached면 창을 앞으로). 새 탭이라도 `after`가 다른 desk의 탭이면 그 desk로 바꿔 그 탭 뒤에 연다(숨은 desk의 terminal이 연 URL, `architecture/browser-tab.md`). 처음 여는 desk는 seed로 만들되 다른 desk에 이미 있는 탭은 seed에서 뺀다(`switchDesk`). 탭을 빼앗아 오지 않는 까닭은 detached 창과 살아 있는 terminal이 딸려 있어서다. 사라진 workflow의 desk는 Main으로 합친다(`mergeDeskIntoDefault`): docked는 focus 칸 끝, floated는 floats 끝(rect·minimized 그대로), detached는 detached 끝이고 floats·detached 20개를 넘는 탭은 docked로 가며 그 창을 닫는다. 합치기는 workflow 목록 읽기에 성공했을 때만 한다(실패나 읽는 중에 합치면 desk의 탭이 모두 Main으로 옮겨진다). `model_test.ts`의 위험 test가 desk를 바꾸고, 건너 열고, 합쳐도 탭이 사라지거나 둘이 되지 않는지 본다.
- **화면이 그리고 고치는 것은 보이는 desk의 view뿐이고, `<webview>`는 탭이 사는 동안 모든 desk에서 산다.** 떠난 desk의 탭은 고르지 않은 docked 탭처럼 React에서 unmount한다. terminal은 창의 `TerminalDisplays`가 xterm·DOM·출력 구독을 유지해 돌아오면 다시 붙이며 과거 raw 출력을 다시 재생하지 않는다. browser 탭·앱 panel·artifact 탭의 `<webview>`는 탭 key가 어느 desk에서든 layout에 있으면 그릇이 숨긴 채 들고 있어 desk를 오가도 page를 다시 load하지 않는다(`workspace.tsx`가 이전 key와 지금 `allDeskTabs`의 차로 `webviews.release`를 부른다). 놓는 것은 탭 key가 모든 desk에서 사라졌거나 그 탭이 detached가 됐을 때다(detached 탭의 page는 그 창이 갖는다). `ViewKeeps`는 앱 panel·artifact 탭의 view_session과 마지막 state를 Float·Dock 사이에 잇는다. 떠난 desk의 detached 창은 닫지 않고 숨긴다(`showOnly`, main의 `DetachedEntry.hidden`). PTY와 그 창의 guest page가 그대로 산다. 숨은 창이 예기치 않게 사라지면 그 탭이 있는 desk의 view가 `docked`를 받는다. 복원 때는 보이는 desk의 detached 창만 열고, 다른 desk의 것은 그 desk로 갈 때 `showOnly`의 `missing`으로 연다. `showOnly`는 보낸 project 창의 detached 창만 건드리고 detached 창이 부르면 `forbidden`이다(`ipc_test.ts`). key를 만들거나 열린 탭을 찾는 곳(agent 탭 번호, 같은 session 재사용, 파일 이름 바꾸기, 닫은 탭 다시 열기, 대기 목록의 terminal)은 `host.windowTabs()`·`allDeskTabs`로 모든 desk를 본다.
- **workflow 탭은 자기 workflow의 desk에 산다.** `TabKindDef.homeDesk`가 있는 탭을 여는 길(sidebar의 workflow 줄, `openWorkflow`)은 어디에도 열려 있지 않으면 그 desk로 가서 연다. 그 desk가 보이면 sidebar Workflows의 그 줄이 강조된다.
- **탭을 찾고 바꾸는 곳은 pane, floats, detached를 모두 본다.** `findTab`, `allTabs`, `mapTabs`를 쓴다. pane만 보는 `holderOf`는 `model.ts` 밖에 내놓지 않는다. `host.openTab`, `patchTab`, `removeTab`, 닫은 탭 다시 열기, 파일 이름 바꾸기, 대기 목록의 terminal 고르기가 floated 탭에도 같다. 닫은 floated 탭은 docked로 돌아온다. detached 탭을 여는 길은 모두 그 창을 앞으로 가져오고, 닫는 길(`removeTab`)은 그 창을 닫고 항목을 버린다. palette 탭 행에는 보이는 desk의 pane과 floats의 탭만 나온다.
- **탭 안에서 연 것의 자리는 `workspace/open-policy.ts`의 `openAt` 하나가 정한다.** 터미널(shell, coding agent)의 URL·파일 경로, lophn agent 대화의 파일 link, 검색 결과처럼 탭(source) 안에서 연 새 탭은 source 자리로 정한다. source가 pane에 있고 pane이 둘 이상이면 다음 pane(칸 순서, 끝이면 처음) 끝(agent 옆에서 연 문서가 agent를 가리지 않고 문서 쪽에 모인다), pane이 하나면 source 바로 뒤(pane을 자동으로 나누지 않는다), source가 floated·minimized·detached이거나 없으면 focus pane 끝, 보이지 않는 desk면 source 바로 뒤(`openTab`이 그 desk로 건너간다)다. 대화 코드 블록의 실행(`run`)은 floated 새 터미널이다. 이미 열린 탭은 이 규칙을 거치지 않고 있는 자리에서 보인다(`openAcrossDesks`). 여는 쪽은 `openFile(host, path, { from })`처럼 source key만 넘기고 `after`를 스스로 계산하지 않는다. `open-policy_test.ts`가 표로 본다.
- **project 창 renderer가 detached 항목까지 layout 전체를 갖고 저장한다.** detached 창은 자기 탭 하나를 main을 거쳐 받고(`take`), 바뀐 값(`changed`), 탭 열기(`open-tab`, project 창에 docked로), 닫기(`closed`)를 main을 거쳐 project 창에 알린다. layout 파일은 project id마다 하나(`<data>/shell/layouts/<prj_id>.json`)이고 마지막에 쓴 것이 이기므로 저장하는 곳은 하나다. project 창은 project마다 `Workspace`를 새로 mount한다(`key`). 그렇지 않으면 저장된 layout이 없는 project로 갈 때 앞 project의 탭이 남아 그 project의 layout으로 저장된다. main은 탭 값을 열어 보지 않고(key와 kind만) 같은 project 창에만 중계하며, 보낸 창으로 역할을 가려 `forbidden`으로 막는다(`main/desktop/detached/ipc.ts`). detached 창 bounds는 main이 저장할 때 살아 있는 창 값으로 채우고, 창을 옮기거나 크기를 바꾸면 `moved`로 project 창에 다시 저장하게 한다.
- **desktop 창의 자리는 layout이 아니라 앱에 하나다(`window.json`).** 한 창이 런처·project·settings를 오가므로 창 자리는 project에 속하지 않는다. desktop 창을 옮기거나 크기를 바꾸면 500ms 뒤에, 최대화·되돌림·닫기 때는 바로 마지막 자리를 쓴다. 최대화한 창은 되돌렸을 때의 자리(`getNormalBounds`)와 `maximized`를 둔다. 최소화와 전체 화면은 쓰지 않는다. 새 desktop 창(시작, tray, 단일 instance 요청)은 그 자리를 지금 화면 작업 영역 안으로 당겨(`desktop/work-area.ts`) 열고, 다른 desktop 창이 떠 있으면 32px 비켜 연다. detached 창은 이 값을 쓰지도 고치지도 않는다.
- **앱 place의 오른쪽 패널 모양은 앱마다 localStorage에 기억한다(`app-frame/app-layout.ts`).** 패널 열림·고른 탭·details 탭 유무·보던 agent와 session을 `lophn.app-layout.<app>`에 쓰고 `AppSpace`가 mount할 때 읽는다. 앱 place에는 layout file이 없고 desk도 없다. manage pane은 저장하지 않는다. 새 session 요청(`startLophn`)은 저장값보다 먼저다. 폭은 앱 구분 없이 `panel-width.ts` 값 하나다.
- **Detach와 Dock은 transfer → main이 창을 열거나 닫고(native view가 있으면 옮김) → 성공했을 때만 layout 바꾸기 순서다.** 어느 단계가 실패해도 layout은 그대로라 탭이 사라지지 않는다. `TabKindDef.transfer`가 null을 내면 옮기지 않는다(editor는 `EditorSessions.flush`가 실패하면 null이라 저장 안 된 글을 잃지 않는다. `editor/transfer_test.ts`). 값은 `TabTransfer { value(JSON), views(옮길 native view의 view_session) }`이고 받는 창의 `receive`가 그리기 전에 받는다. terminal은 `terminal_ref`·`generation`(받는 창이 snapshot을 0부터 받는다), agent는 그 session의 composer draft(새 session 탭은 `new:` draft 전부, 받는 창의 글은 덮지 않는다), browser popup만 view_session과 state를 넘긴다(native view를 옮긴다). 앱 panel·artifact 탭은 transfer를 선언하지 않고(기본 `{ value: null, views: [] }`), 보통 browser 탭도 같은 값을 낸다. 받는 창이 다시 열며 page를 다시 load한다. 나머지 kind는 `toStored` 값으로 다시 연다. `noDetach` kind(browser DevTools 패널)는 Detach 항목과 단추가 없다. tab은 보내기 전에 `slimDetachedTab`으로 4096자를 넘는 `fields` 값(favicon data URL)을 뺀다(IPC 한 번이 64KiB까지다).
- **native view는 닫지 않고 창을 옮긴다. 그 항구를 쓰는 것은 browser의 크기 준 popup과 DevTools뿐이다.** `AppViews.moveViews(from, to, sessions)`가 모든 view가 `from` 창의 것인지 먼저 보고(아니면 아무것도 옮기지 않고 `invalid_input`), 기다리던 bounds를 버린 뒤 browser registry(`main/browser/registry.ts`의 popup·DevTools 항목)의 `move`로 보낸다(`main/browser/native-bounds.ts`). 옮긴 view는 떼어 숨긴 상태이고 새 창 renderer가 bounds를 보내면 붙는다. 옛 창 renderer가 늦게 보내는 요청은 소유 검사로 거절되어 무해하다. renderer에서는 `ViewKeeps.lookup`/`track`이 mount된 view의 session과 최신 state도 찾게 한다. `<webview>` guest는 이 항구로 오지 않는다: 앱·artifact·보통 browser 탭은 보내는 창이 element를 지우고 받는 창이 새로 만든다(보통 browser 탭은 url로 다시 load되고 cookie는 partition에 남는다. 그 탭의 DevTools는 닫힌다). popup 탭의 DevTools는 같이 옮긴다(floated 패널이던 것은 탭 안으로 바꿔서).
- **detached 창의 ×는 dock이다.** main이 창 닫기를 가로채 renderer에 `dock-request`를 보내고 renderer가 [Dock]과 같은 흐름을 돈다. 실패하면 창이 그대로 남는다. 앱을 끄는 중에는 가로채지 않고 자동으로 dock하지도 않는다(다음 실행에 `detached`로 돌아온다). 창이 예기치 않게 사라지면(renderer crash 등) main이 저장된 값으로 `docked`(transfer 없음)를 보내 탭이 layout에 남는다. project 창을 닫거나 같은 창에서 다른 공간으로 가면 그 창의 detached 창이 조용히 닫히고 상태는 `detached`로 남는다. 다시 열면 `Workspace`가 저장된 값과 bounds(지금 화면 작업 영역 안으로 당긴 것)로 창을 연다. 같은 실행 안이면 terminal은 PTY에 다시 붙는다: detached 창이 kind의 `resume`(terminal은 `terminal_ref`·`generation`)을 `changed`로 알려 main이 들고(`DetachedRegistry`의 kept, 메모리에만), 조용히 닫힐 때(`close({ key: null })`, project 창 닫힘) (project, key)로 남겨 두었다가 같은 key의 `open({ transfer: null })`에 한 번 쓰고 지운다. 다시 열 때 쓰든 말든 지워 같은 PTY가 두 창에 붙지 않고, 개별 close·dock·remove와 앱 종료에서도 지운다. 앱을 다시 띄우면 transfer가 없어 재시작과 같다(PTY에 못 붙는다). 같은 (project, key)의 창이 이미 있으면 새로 띄우지 않고 앞으로 가져온다(`conflict`).
- **detached 창은 탭 하나만 그린다.** `Desktop`의 `detached` route이고 탭 줄도 sidebar도 floats 층도 없다(`<webview>` 그릇 하나가 자기 탭의 화면을 담는다). 그 안의 `openTab`은 project 창에 docked로 열고(agent 새 탭의 key가 project 창의 다른 session 탭과 겹치면 project 창이 새 번호로 바꿔 연다), 크기 준 browser popup은 또 하나의 detached 창으로 연다(popup view를 그 창으로 옮겨 `window.opener`를 지킨다). floats 층이 없어 browser 탭의 DevTools 자리 menu에서 floated를 뺀다. toast와 전역 palette intent는 이 route에서 끄고, tray와 전역 palette 키는 detached 창을 "가장 최근 창"으로 고르지 않는다.
- **`dockTab`은 떠나 온 pane(`originPane`)의 끝에 넣는다.** 그 번호가 지금 pane 수 밖이면 focus pane이다. preview와 transient 표시를 지운다.
- **minimized는 floated에서만 간다.** 접혀도 `rect`는 접기 전 값을 지킨다. 펴면(`restoreFloat`) 맨 위로 온다. 접힌 탭은 고르지 않은 docked 탭처럼 다룬다: `keep` kind(app panel)는 `hidden` 패널로 mount를 유지하고, 나머지는 unmount한다.
- **`transient` 탭은 저장하지 않는다.** popup처럼 잠깐 뜬 패널이다. `toStoredLayout`이 `storableView`를 먼저 거친다. 위험 test가 본다. Dock하면 사람이 고른 것이라 저장한다.
- **rect는 `.content` 왼쪽 위 기준 정수 CSS px다.** 가장 작은 크기는 320×200이다. 그릴 때는 지금 `.content` 안으로 당겨(`clampFloatRect`) 그리고 저장된 rect는 사람이 옮기거나 크기를 바꿀 때만 바뀐다. 창이 줄었다 커지면 원래 자리로 돌아온다. `.content`를 아직 못 쟀거나 0이면 floats 층을 그리지 않고 rect를 저장하지 않는다(0×0 rect는 schema가 거절해 저장이 통째로 실패한다).
- **패널 DOM 순서는 탭 key 순으로 고정하고 위아래는 z-index로만 정한다.** raise할 때 요소를 재배열하면 안에 있던 focus와 scroll(terminal, editor)이 날아간다. 누르거나 focus가 들어오면 맨 위로 온다.
- **`<webview>`는 창의 그릇 하나에 탭 key(앱 card·앱 place는 그 화면의 view_session)당 한 번 만들고 옮기지 않는다.** 다른 부모로 옮기면 guest가 다시 만들어져 page가 다시 load된다. floats 층은 stacking context를 만들지 않고 패널 z-index가 --z-sticky + 층 번호 × 2라서, pane 화면은 z-index 1(pane의 경계 잡는 띠 `--z-sticky` 아래), floated 화면은 자기 패널 위·다음 패널 아래(--z-sticky + 2L+1)에 놓인다. pane 요소(경계 잡는 띠)는 docked 화면 위, floated 패널 아래에 그려진다. browser element는 `partition`·`allowpopups`를 직접 적고, 앱·artifact element는 `src`만 적는다(partition·preload는 main이 붙일 때 강제한다). main이 새 `src`를 내면 같은 자리에서 element를 새로 만든다. 자리는 사각형만 알린다(`renderer/app-frame/webview-host.tsx`).
- **focus는 칸과 floats 층 중 한 곳에만 있다.** `workspace.tsx`의 `floatFocused`(저장하지 않는다)가 정한다. 패널을 누르거나 Float·펴기를 하면 floats 층, 칸을 누르거나 Dock하거나 맨 위 패널을 접거나 닫으면 칸이다. 접히지 않은 패널이 없으면 칸이다. focus 색 강조선(칸의 고른 탭, 맨 위 패널의 bar)과 kind의 `render`가 받는 `active`가 이것을 따른다. terminal의 사람 입력은 active일 때만 보내므로 둘이 동시에 입력을 받지 않는다. resize는 보이는 terminal의 칸 크기를 따르고, 숨은 xterm의 질의 응답은 별도로 처리한다. 칸 단축키(Ctrl+W 등)는 floats에 focus가 있어도 `focusedPane` 칸에 듣는다.
- **native view는 overlay뿐이고, 그 위아래는 `viewOrder`가 정한다.** browser의 크기 준 popup·DevTools는 `main/browser/view-order.ts`가 pane 화면 < floated 화면 순으로 쌓고, overlay native view는 `app-frame/view-order.ts`의 `viewOrder`가 늘 그 위에 둔다. native view는 shell DOM 위에 그려지지만 앱·artifact 화면은 DOM(`<webview>`)이라 그 문제가 없다.
- **DOM 패널은 `<webview>` 위에 z-index로 그린다.** floated 패널은 `<webview>` 그릇의 층보다 높고(--z-sticky + 2L), 앱 place의 오른쪽 패널은 `--z-sheet`로 화면을 덮는다. 화면을 줄이던 cover 장치는 없다.
- **앱 panel·artifact 탭의 `<webview>`는 탭이 사는 동안 산다.** Float, Dock, 접기, desk 바꾸기로 `EmbeddedView`가 다시 mount되어도 그릇이 element를 들고 있어 page를 다시 load하지 않는다. `ViewKeeps`(창마다 하나, renderer)는 view_session과 마지막 state를 이어 탭이 다시 mount될 때 같은 view를 쓴다. 탭 key가 모든 desk에서 사라지거나 detached가 되면 그릇이 element를 지운다(`Workspace`). 앱 place 본문과 앱 card는 그 화면이 unmount될 때 닫는다. 열기 입력이 바뀌면 옛 view를 닫고 새로 연다.
- **앱 panel 탭에는 평소 shell 크롬 줄이 없다(사람).** 탭 이름이 이미 앱 이름이고, 탭 줄과 앱 화면 사이에 다른 바탕의 줄이 끼면 탭과 본문이 한 면으로 이어지지 않는다. 화면이 멈추거나 crash했을 때, 앱이 멈췄을 때(`stopped`·`unavailable`)만 `ViewChrome`이 상태와 [Open again]을 띄운다(`app-panel-tab.tsx`). 앱 template의 `src/surface.css`는 앱 바탕을 탭 본문과 같은 `--color-surface-base`로 둔다. 강제하지 않는다.
- **앱 icon은 선언의 선택 칸이고 layout에 싣지 않는다.** 앱 선언의 `icon`(bundle 안 `/…/x.svg|png|webp` 경로, 64 KiB 이하)은 release 준비가 source commit에 그 파일이 있는지 보고, core의 `apps.icon` read(`{app}` → `{icon: {content_type, data(base64)} | null}`)가 active release의 bundle 사본에서 읽는다. bundle 밖을 가리키는 경로·symlink, 큰 파일, 선언 없음은 모두 `null`이고 오류가 아니다. renderer는 `app-frame/app-icon.tsx`의 `useAppIcon(app)`로 data URL을 받아 앱 패널 탭 아이콘(`iconOf`), activity bar의 고정 앱 단추, 런처 앱 카드와 place switcher의 `PlaceMark`에 쓴다. 탭의 `toStored`에는 들어가지 않고 그릴 때마다 읽는다(10초 cache).
- **앱 전용 창은 shell 문서 하나다.** main이 `sizes`에 `full`을 적은 첫 screen을 골라 `openDesktopWindow`로 `#app-window=<app>/<release>/<screen>`(각 부분 `encodeURIComponent`) hash의 desktop 창을 연다. 앱 하나에 창 하나이고 다시 요청하면 그 창을 앞으로 가져온다. renderer의 `app-window` route(`renderer/app-frame/app-window.tsx`)가 앱 이름과 창 단추가 있는 위쪽 bar와 그 화면 하나를 창 본문 전체의 `<webview>`로 그린다(`mode: live`). `webviewTag`·shell preload는 다른 shell 창과 같고, 전역 palette·tray의 "가장 최근 창"에서 detached 창과 같이 빠진다(`ctx.appWindows`).
- **여는 길은 탭 menu의 Float·Detach, 패널 bar의 Minimize·Dock·Detach·Close, 상단 bar span(누르기, hover × 닫기, right-click의 Restore·Dock·Close, 탭 줄·칸 본문으로 끌기), 탭을 끌어 칸 본문(왼쪽·오른쪽·위·아래·가운데)에 놓아 화면을 나누거나 옮기기(`dropTabOnPane`), 탭 menu의 Split Right·Split Down과 칸 탭 줄 끝의 단추, 단축키 `pane.split`·`pane.split-down`(`splitTab`), 탭을 끌어 상단 titlebar에 놓아 최소화하기, 명령 palette(Float tab, Dock panel, Minimize panel), detached 창 bar의 [Dock]이다.** 기본 단축키는 없고 Detach는 palette 명령도 없다. palette의 Dock·Minimize 대상은 맨 위의 접히지 않은 패널이다. minimized 패널은 먼저 펴야 Detach할 수 있다.

## 칸 배치

- **`layout` tree의 잎 수는 늘 `panes` 수와 같다.** 칸을 넣고 뺄 때는 `panes`와 tree를 같은 index로 같이 고친다(`splitTab`은 `splitLeaf`, `dropEmptyPane`은 `removeLeaf`). schema가 어긋난 desk를 거절하고, 읽을 때 renderer(`layout-map.ts`)는 어긋나거나 모양이 틀린 tree를 같은 폭의 가로 배치로 바꿔 탭을 잃지 않는다.
- **칸이 비면 그 잎만 빠지고 형제가 그 자리를 채운다.** 나머지 배치와 비율은 남는다. focus는 같은 칸에 두고, 그 칸이 지워졌으면 그 자리로 온 칸이다.
- **모든 칸이 최소 크기(폭 320, 높이 240)로 들어가지 않으면 focus 칸 하나만 그린다.** 저장된 tree와 탭 소속은 바꾸지 않는다(`fitsArea`).
- **경계 drag는 양쪽 하위 배치의 최소 크기 안에서 비율을 바꾼다.** 놓을 때만 저장하고 두 번 누르면 50:50이다. 나눔은 root부터 `a`/`b`를 이은 경로로 가리킨다(`setRatio`).
- **칸 번호(`pane.focus` 1~6, palette의 Pane N)는 잎 순서(왼쪽·위에서 오른쪽·아래로)다.**

## 왜 이 모양인가

- **layout 파일은 project id마다 하나다.** 하나를 앱 전체가 쓰면 다른 project를 열어 저장할 때 앞 project의 layout을 덮어써 workflow desk를 모두 잃는다. 이름은 `project.update`로 바뀌므로 id다(`layout-store_test.ts`).
- **desk key는 그 project 안의 workflow 이름이고 기본 desk는 `_default`다.** project 이름을 넣지 않아 project 이름을 바꿔도 desk가 남는다. `_`로 시작하는 값은 slug가 아니라 workflow 이름과 겹치지 않는다. renderer `model.ts`와 main `schema.ts`가 같은 값을 따로 적는다. workflow 폴더 이름을 바꾸면 옛 desk는 Main으로 합쳐진다(바뀌지 않는 workflow id가 없다).
- **desk를 건너 탭 key가 겹치는지는 schema가 거절하지 않는다.** 거절하면 읽기가 손상이 되어 layout 전체를 잃는다. 겹침은 model과 그 위험 test가 막는다.
- **desk를 바꿀 때 detached 창은 "보일 key 목록" 한 번으로 맞춘다.** 창마다 부르면 중간에 일부만 바뀐 채 남을 수 있다. 창이 없는 key를 main이 열지 않는 까닭은 열기에 필요한 탭 값과 bounds를 renderer가 갖고 있고, 이미 있는 창에 `open`을 부르면 앞으로 가져와 focus를 뺏어서다. 보이기는 focus 없이(`showInactive`) 한다.
- **selector는 상단 bar 왼쪽 경로다(사람).** 가운데에 두면 minimized span 단추가 쓸 자리가 줄어든다. 파일 경로 breadcrumb은 project 창에서 뺐다. project 조각도 menu라 active project를 이 창에서 연다. place switcher(`top-path/place-selector.tsx`)의 trigger는 이름과 chevron 한 줄이고, 열면 Projects와 Apps 두 묶음이 각각 최근에 연 순서로 선다(Recent 묶음 없음, 검색 없음). 목록 줄에만 place 표식(`parts/place-mark`)이 붙고, 이미지가 없으면 첫 글자와 id로 고른 색이다. 앱 place의 menu는 앱 화면(`<webview>`) 위에 DOM으로 그려지므로 화면을 숨기지 않는다.
- **`originPane`은 번호다.** pane은 최대 여섯이다(`MAX_PANES`, schema와 renderer가 같은 값을 따로 적는다). pane이 사라져 번호가 어긋나면 focus pane으로 보낸다.
- **floats 개수(20)는 schema만 막는다.** 사람이 20개를 띄울 일이 없다.
- **새 패널은 `.content` 가운데 60% 크기로 겹쳐 뜬다.** 비껴 놓기(cascade)는 하지 않는다.
- **겹치는 패널은 `<webview>` 위에 그린다.** native view 때는 화면이 DOM 위에 그려져 겹치는 동안 view를 cover로 줄여야 했다. 앱·artifact 화면은 DOM(`<webview>`)이라 패널이 그 위에 바로 겹친다. 버린 안: 겹치는 동안 마지막 `capturePage` 그림을 보이기(page가 멈춘다), DOM 패널도 native view로 띄우기(패널마다 shell renderer 하나라 가장 크다). 잃는 것은 없다. 밑의 page가 패널에 가려진 채 계속 돈다.
- **view 보관소는 renderer에 둔다.** `<webview>` element는 창의 그릇이 들고 view_session·state는 `ViewKeeps`가 든다. main registry가 이미 view와 붙은 guest를 구분하므로 새 IPC가 필요 없다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 layout에 없으면 닫는다.
- **옛 layout 파일(판 1, 2)은 읽지 않는다.** 새로 만든다(AGENTS.md "호환성").
- **minimized span은 고정 폭(140px, `+N` 40px)이다.** 글자 폭을 재려면 숨은 측정 요소가 필요하다.
- **detached 창은 탭 하나만 갖는다.** 탭 줄이 있는 detached 창은 workspace를 하나 더 만드는 일이다. 탭 여럿을 보려면 창을 여럿 띄운다. dock은 focus pane 끝에 붙이고 떼기 전 자리는 저장하지 않는다(floated였어도 docked로 온다).
- **값은 창이 뜬 뒤 `take()`로 당겨 받는다.** hash `#detached=<key>`는 route 선택용이다. 탭 key가 4096자까지이고 transfer가 커질 수 있다.
- **두 방향(project 창, detached 창)을 IPC 하나(`ipc/detached.ts`, `window.lophnDetached`)로 묶는다.** 같은 renderer bundle과 preload를 쓰는 창이고 main이 보낸 창으로 역할을 가른다. 통로를 둘로 가르면 preload·노출·type이 두 벌이 된다.
- **browser 탭·앱 화면·artifact 화면은 Detach하면 다시 load된다(사람).** `<webview>`는 그것을 띄운 shell 문서에 묶여 다른 부모로 옮기면 guest가 다시 만들어진다. 쓰던 form, scroll, 그 page가 연 popup의 `window.opener`를 잃는다. 다시 load 없이 옮길 수 있는 곳은 native view뿐이고 그것이 `window.opener`가 걸린 browser popup과 DevTools다.
- **detached 창 안의 popup은 또 하나의 detached 창이다.** 가장 단순하게 `window.opener`를 지킨다. 대안인 project 창 floats 층으로 옮기기는 opener 소유 이동이 더 필요하다. `open`의 bounds에 opener 창 가운데 features의 크기를 넣고, 화면 작업 영역 안으로 당긴다. detached 창만 최소 크기가 320×240이다(다른 창과 bounds가 없는 detached 창은 960×600).
- **칸 배치는 칸 목록이 아니라 tree다(사람).** 좌우로만 나누는 값(`split_ratio`)으로는 위아래 나눔을 담지 못하고, VS Code처럼 칸 안을 다시 나누려면 중첩이 필요하다. 칸마다 사각형을 저장하는 안은 경계 하나를 옮길 때 이웃 칸을 모두 다시 계산해야 해서 버렸다. 칸은 최대 6개다.
- **판 5 파일은 읽을 때 올린다.** 좌우 두 칸이던 `split_ratio`는 `row` 나눔 하나가 된다(`layout.ts`의 `upgradeFromV5`). 쓰던 탭 배치를 새로 만들지 않으려는 것이고 다음 저장에서 판 6 파일이 된다(AGENTS.md "호환성").
- **고정 앱 패널(`rail_apps`)은 desk가 아니라 project 단위로 layout 파일에 둔다(agent).** 쓰임이 "이 project에서 자주 여는 앱"이라 desk마다 다르면 오히려 헷갈리고, 별도 파일을 두면 저장 길이 둘이 된다. 판 6 파일은 `upgradeFromV6`이 `rail_apps: []`를 붙여 읽는다. 단추가 열 탭은 key가 아니라 app+screen으로 찾는다(탭 key는 열 때마다 새로 만들어 저장된 탭과 이어지지 않는다).
- **앱 화면도 `<webview>`로 옮겼다(사람, 2026-10-31).** native view는 shell HTML 위에 그려져 menu·popover·floated 패널·toast가 앱 page 밑에 깔렸고, 피하려고 층·cover·bounds relay가 쌓였다. browser 탭이 같은 이유로 이미 `<webview>`를 쓰고 그 뒤로 겹침 문제가 없다. iframe은 preload의 isolated world, 앱별 partition, sender 신원을 잃고, remote UI는 앱이 자기 DOM·CSS component를 못 쓰게 해서 버렸다. Electron은 `<webview>`를 권하지 않지만 browser 탭이 이미 그 위험을 지고 있어 새 위험이 아니다.
- **artifact 탭도 같이 옮겼다(agent).** 같은 겹침 문제를 갖고 있었다. 남겨 두면 앱 쪽 장치를 지우지 못한다.
- **붙이기 ticket은 `src` 하나이고 한 번만 쓴다(agent).** registry의 `acceptGuest(window, src)`가 그 창의 view이고 그 src를 아직 안 쓴 때만 받는다. renderer가 적은 partition·preload·webPreferences는 버리고 main이 정한 값만 쓴다. renderer가 붙이기 값을 위조해도 다른 session이나 preload로 갈 수 없다.
- **앱 저장소 partition 이름은 그대로다(agent).** `persist:app-<app>:live`·`persist:app-<app>:preview-<bundle hash>`를 바꾸지 않아 사람의 `~/.lophn` cookie·localStorage·IndexedDB가 이어지고 migration이 없다.
- **`<webview>`는 layout에 있는 동안 숨기기만 한다.** desk를 떠났다 돌아오면 쓰던 form·scroll을 잃던 결함(`issues/workspace-layout.md`)이 있었다. 탭 key가 어느 desk에든 있는 동안 element를 들고 있으면 desk 전환에 드는 것이 없고, detached 탭만 그 창에 넘긴다(page가 두 창에 살지 않게).
