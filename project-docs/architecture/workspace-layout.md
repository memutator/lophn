# workspace layout

project 창이 가진 탭이 어디에 있는가를 정하는 메커니즘이다. 탭은 pane의 탭 줄(docked), workspace 위에 뜬 패널(floated), 상단 bar의 span(minimized), OS 창 하나(detached) 중 한 곳에 있다. 모든 탭 kind가 같은 길을 쓴다. renderer의 순수 함수 layout model, main이 검증하는 `layout.json`, 패널을 그리는 floats 층, native view(app panel, browser의 크기 준 popup)를 쌓는 main의 층 순서, 탭을 창 사이로 옮기는 main 중계(`transfer`/`receive`)에 걸친다. 보통 browser 탭은 native view가 아니라 floats 층 안의 `<webview>`다(`browser-tab.md`).

## 흐름

```
 renderer/workspace/model.ts ── WorkspaceView { panes(1-2), splitRatio, focusedPane, floats[], detached[] }
   FloatItem { tab, rect, minimized, originPane }  배열 순서 = 위아래 순서(마지막이 맨 위)
   DetachedItem { tab, bounds }                    bounds = OS 화면 좌표, 배열 순서 = 뗀 순서
   순수 함수: floatTab, dockTab, openFloat, minimizeFloat, restoreFloat, raiseFloat, closeFloat, setFloatRect,
             detachTab, openDetachedTab, attachDetached, closeDetached
        │
        │ 바뀔 때마다 storableView(transient 탭 빼기) ─▶ toStoredLayout ─▶ layout:save
        ▼                                                   (main이 살아 있는 detached 창의 bounds로 덮는다)
 main/workspace/schema.ts ── layout.json (LAYOUT_SCHEMA_VERSION 3, floats·detached 각 최대 20) ── 판이 다르면 unsupported_schema, 새로 만든다

 Detach (project 창 workspace.tsx)                         detached 창 (#detached=<key>, renderer/workspace/detached/)
   kind.transfer(tab) ─▶ lophnDetached.open ─▶ main: 창 만들기 ─▶ moveViews(project 창 → 새 창)
   성공했을 때만 detachTab                                    take() ─▶ { project, tab, transfer } ─▶ kind.receive ─▶ 탭 하나 그리기
                                                            [Dock]·× ─▶ kind.transfer ─▶ dock ─▶ moveViews(새 창 → project 창)
   docked event ─▶ kind.receive ─▶ attachDetached ◀──────── main ◀┘
   changed·open-tab·closed·opened event ◀──────────────── main ◀── patchTab·openTab·removeTab·popup

 workspace.tsx
   .content ─┬─ Panes          (docked 탭. 고른 탭만 mount, keep kind는 숨긴 채 mount)
             └─ Floats         (.floats 층, stacking context 없음. 첫 자식이 browser `<webview>` 그릇. 패널마다 FloatPanel, z-index = --z-sticky + 층 번호 × 2)
   TopBar.leading ── Breadcrumbs ─ MinimizedBar (접힌 패널 span, 넘치면 +N menu)

 native view 층 (main/app-frame/view-order.ts appViewOrder, 창마다 하나)
   pane view (layer 0) < floated view (layer = floats index + 1) < overlay
   renderer: EmbeddedView가 ViewLayerProvider의 층을 setViewBounds{ layer }로 보낸다
   cover: useViewCover(ref, covering, layer). view는 자기 층보다 위 층의 cover만 뺀다
```

## 지키는 것

- **탭 하나는 한 곳에만 있다.** pane, floats, detached 중 하나다. 같은 탭을 두 자리에 그리면 editor는 session이 둘이 되어 conflict가 나고, terminal은 입력을 받을 수 있는 webContents가 하나뿐이다. model 함수가 이를 지키고 `model_test.ts`의 위험 test가 float, dock, minimize, restore, raise, detach, attach, close를 이어서 해도 탭이 사라지거나 둘이 되지 않고 옮긴 탭이 맞는 자리에 있는지 본다. `openTabIn`과 `reopenTab`은 floated·detached 탭을 새로 붙이지 않는다. `openTabIn`은 floated 패널을 펴서 맨 위로 올리고, detached 탭이면 `Workspace`가 그 창을 앞으로 가져온다.
- **탭을 찾고 바꾸는 곳은 pane, floats, detached를 모두 본다.** `findTab`, `allTabs`, `mapTabs`를 쓴다. pane만 보는 `holderOf`는 `model.ts` 밖에 내놓지 않는다. `host.openTab`, `patchTab`, `removeTab`, 닫은 탭 다시 열기, 파일 이름 바꾸기, 대기 목록의 terminal 고르기가 floated 탭에도 같다. 닫은 floated 탭은 docked로 돌아온다. detached 탭을 여는 길은 모두 그 창을 앞으로 가져오고, 닫는 길(`removeTab`)은 그 창을 닫고 항목을 버린다. palette 탭 행과 breadcrumb에는 pane과 floats의 탭만 나온다.
- **project 창 renderer가 detached 항목까지 layout 전체를 갖고 저장한다.** detached 창은 자기 탭 하나를 main을 거쳐 받고(`take`), 바뀐 값(`changed`), 탭 열기(`open-tab`, project 창에 docked로), 닫기(`closed`)를 main을 거쳐 project 창에 알린다. `layout.json`은 project 하나에 파일 하나이고 마지막에 쓴 것이 이기므로 저장하는 곳은 하나다. main은 탭 값을 열어 보지 않고(key와 kind만) 같은 project 창에만 중계하며, 보낸 창으로 역할을 가려 `forbidden`으로 막는다(`main/desktop/detached/ipc.ts`). 창 bounds는 main이 저장할 때 살아 있는 창 값으로 채우고, 창을 옮기거나 크기를 바꾸면 `moved`로 project 창에 다시 저장하게 한다.
- **Detach와 Dock은 transfer → main이 창을 열거나 닫고 view를 옮김 → 성공했을 때만 layout 바꾸기 순서다.** 어느 단계가 실패해도 layout은 그대로라 탭이 사라지지 않는다. `TabKindDef.transfer`가 null을 내면 옮기지 않는다(editor는 `EditorSessions.flush`가 실패하면 null이라 저장 안 된 글을 잃지 않는다. `editor/transfer_test.ts`). 값은 `TabTransfer { value(JSON), views(옮길 native view의 view_session) }`이고 받는 창의 `receive`가 그리기 전에 받는다. terminal은 `terminal_ref`·`generation`(받는 창이 snapshot을 0부터 받는다), agent는 그 session의 composer draft(새 session 탭은 `new:` draft 전부, 받는 창의 글은 덮지 않는다), app panel과 browser popup은 view_session과 state를 넘긴다. 나머지 kind는 `toStored` 값으로 다시 연다. `noDetach` kind(browser DevTools 패널)는 Detach 항목과 단추가 없다. tab은 보내기 전에 `slimDetachedTab`으로 4096자를 넘는 `fields` 값(favicon data URL)을 뺀다(IPC 한 번이 64KiB까지다).
- **native view는 닫지 않고 창을 옮긴다.** 항구는 하나다: `AppViews.moveViews(from, to, sessions)`가 모든 view가 `from` 창의 것인지 먼저 보고(아니면 아무것도 옮기지 않고 `invalid_input`), 기다리던 bounds를 버린 뒤 `routeFrame`이 view_session으로 앱 view registry(`app-frame/registry.ts`)와 browser registry(`main/browser/registry.ts`의 popup·DevTools 항목)의 `move`로 갈라 보낸다. 옮긴 view는 떼어 숨긴 상태이고 새 창 renderer가 bounds를 보내면 붙는다. 옛 창 renderer가 늦게 보내는 요청은 소유 검사로 거절되어 무해하다. renderer에서는 `ViewKeeps.lookup`/`track`이 mount된 view의 session과 최신 state도 찾게 한다. `<webview>` guest는 이 항구로 오지 않는다(`invalid_input`). 보통 browser 탭은 받는 창에서 url로 다시 load되고(cookie는 partition에 남는다) 그 탭의 DevTools는 닫힌다. project 창은 detached 탭의 `<webview>`를 지운다(page가 두 창에 살지 않게). popup 탭의 DevTools는 같이 옮긴다(floated 패널이던 것은 탭 안으로 바꿔서).
- **detached 창의 ×는 dock이다.** main이 창 닫기를 가로채 renderer에 `dock-request`를 보내고 renderer가 [Dock]과 같은 흐름을 돈다. 실패하면 창이 그대로 남는다. 앱을 끄는 중에는 가로채지 않고 자동으로 dock하지도 않는다(다음 실행에 `detached`로 돌아온다). 창이 예기치 않게 사라지면(renderer crash 등) main이 저장된 값으로 `docked`(transfer 없음)를 보내 탭이 layout에 남는다. project 창을 닫거나 같은 창에서 다른 공간으로 가면 그 창의 detached 창이 조용히 닫히고 상태는 `detached`로 남는다. 다시 열면 `Workspace`가 저장된 값과 bounds(지금 화면 작업 영역 안으로 당긴 것)로 창을 연다. 이때 transfer가 없어 재시작과 같다. 같은 (project, key)의 창이 이미 있으면 새로 띄우지 않고 앞으로 가져온다(`conflict`).
- **detached 창은 탭 하나만 그린다.** `Desktop`의 `detached` route이고 탭 줄도 sidebar도 floats 층도 없다. 그 안의 `openTab`은 project 창에 docked로 열고, 크기 준 browser popup은 또 하나의 detached 창으로 연다(popup view를 그 창으로 옮겨 `window.opener`를 지킨다). toast와 전역 palette intent는 이 route에서 끄고, tray와 전역 palette 키는 detached 창을 "가장 최근 창"으로 고르지 않는다.
- **`dockTab`은 떠나 온 pane(`originPane`)의 끝에 넣는다.** 그 번호가 지금 pane 수 밖이면 focus pane이다. preview와 transient 표시를 지운다.
- **minimized는 floated에서만 간다.** 접혀도 `rect`는 접기 전 값을 지킨다. 펴면(`restoreFloat`) 맨 위로 온다. 접힌 탭은 고르지 않은 docked 탭처럼 다룬다: `keep` kind(app panel)는 `hidden` 패널로 mount를 유지하고, 나머지는 unmount한다.
- **`transient` 탭은 저장하지 않는다.** popup처럼 잠깐 뜬 패널이다. `toStoredLayout`이 `storableView`를 먼저 거친다. 위험 test가 본다. Dock하면 사람이 고른 것이라 저장한다.
- **rect는 `.content` 왼쪽 위 기준 정수 CSS px다.** 가장 작은 크기는 320×200이다. 그릴 때는 지금 `.content` 안으로 당겨(`clampFloatRect`) 그리고 저장된 rect는 사람이 옮기거나 크기를 바꿀 때만 바뀐다. 창이 줄었다 커지면 원래 자리로 돌아온다. `.content`를 아직 못 쟀거나 0이면 floats 층을 그리지 않고 rect를 저장하지 않는다(0×0 rect는 schema가 거절해 저장이 통째로 실패한다).
- **패널 DOM 순서는 탭 key 순으로 고정하고 위아래는 z-index로만 정한다.** raise할 때 요소를 재배열하면 안에 있던 focus와 scroll(terminal, editor)이 날아간다. 누르거나 focus가 들어오면 맨 위로 온다.
- **browser `<webview>`는 floats 층 안의 그릇 하나에 탭 key당 한 번 만들고 옮기지 않는다.** 다른 부모로 옮기면 page가 다시 load된다. floats 층은 stacking context를 만들지 않고 패널 z-index가 --z-sticky + 층 번호 × 2라서, pane 탭의 `<webview>`는 z-index 1(pane의 경계 잡는 띠 `--z-sticky` 아래), floated 탭의 `<webview>`는 자기 패널 위·다음 패널 아래(--z-sticky + 2L+1)에 놓인다. pane 요소(경계 잡는 띠)는 docked page 위, floated 패널 아래에 그려진다. 탭 자리는 사각형만 알린다(`renderer/browser/webview-host.tsx`).
- **focus는 칸과 floats 층 중 한 곳에만 있다.** `workspace.tsx`의 `floatFocused`(저장하지 않는다)가 정한다. 패널을 누르거나 Float·펴기를 하면 floats 층, 칸을 누르거나 Dock하거나 맨 위 패널을 접거나 닫으면 칸이다. 접히지 않은 패널이 없으면 칸이다. focus 색 강조선(칸의 고른 탭, 맨 위 패널의 bar)과 kind의 `render`가 받는 `active`가 이것을 따른다. terminal은 active일 때만 입력과 PTY resize를 받으므로 둘이 동시에 입력을 받지 않는다. 칸 단축키(Ctrl+W 등)는 floats에 focus가 있어도 `focusedPane` 칸에 듣는다.
- **native view는 세 층으로 쌓인다.** pane view < floated view(floats 순서) < overlay. main의 `appViewOrder`가 view를 붙이거나 층이 바뀔 때만 다시 쌓는다(bounds만 바뀐 호출은 다시 쌓지 않는다). Electron의 `addChildView`가 이미 붙은 view를 맨 위로 옮기는 것을 쓴다.
- **DOM 패널이 아래층 native view 위에 뜨면 cover로 native view를 줄인다.** native view는 DOM 위에 그려진다. floated 패널은 자기 층으로 cover를 등록하고, native view는 자기 층보다 위 층의 cover만 뺀 칸 중 가장 큰 사각형에 그린다. 같은 층끼리는 빼지 않는다(floated app panel이 자기 패널 cover에 줄지 않는다). side panel과 project picker의 cover는 층이 없어 늘 위다. 패널을 옮기면 크기가 같아도 `ViewCovers.changed()`로 다시 잰다.
- **app panel의 native view는 탭이 사는 동안 산다.** Float, Dock, 접기로 `EmbeddedView`가 다시 mount되어도 view를 닫지 않고 `ViewKeeps`(창마다 하나, renderer)에 숨겨 두었다가 같은 탭 key로 다시 쓴다. page를 다시 load하지 않으므로 쓰던 page 상태와 popup의 `window.opener`가 남는다. 탭이 layout에서 사라지면(`allTabs`에 없으면) 닫고, `Workspace`가 unmount되면 모두 닫는다. 열기 입력이 바뀌면 옛 view를 닫고 새로 연다.
- **여는 길은 탭 menu의 Float·Detach, 패널 bar의 Minimize·Dock·Detach·Close, 상단 bar span(누르기, right-click의 Restore·Dock·Close), 명령 palette(Float tab, Dock panel, Minimize panel), detached 창 bar의 [Dock]이다.** 기본 단축키는 없고 Detach는 palette 명령도 없다. palette의 Dock·Minimize 대상은 맨 위의 접히지 않은 패널이다. minimized 패널은 먼저 펴야 Detach할 수 있다.

## 왜 이 모양인가

- **`originPane`은 번호다.** pane은 최대 둘이다. pane이 사라져 번호가 어긋나면 focus pane으로 보낸다.
- **floats 개수(20)는 schema만 막는다.** 사람이 20개를 띄울 일이 없다.
- **새 패널은 `.content` 가운데 60% 크기로 겹쳐 뜬다.** 비껴 놓기(cascade)는 하지 않는다.
- **겹치는 동안 native view를 cover로 줄인다.** 버린 안: 겹치는 동안 마지막 `capturePage` 그림을 보이기(page가 멈춘다), DOM 패널도 native view로 띄우기(패널마다 shell renderer 하나라 가장 크다). 잃는 것은 패널을 옮길 때마다 page 크기가 바뀌어 다시 layout되는 것이다.
- **view 보관소는 renderer에 둔다.** main registry가 이미 숨기기와 폐기를 구분하므로 새 IPC가 필요 없다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 layout에 없으면 닫는다.
- **옛 layout 파일(판 1, 2)은 읽지 않는다.** 새로 만든다(AGENTS.md "호환성").
- **minimized span은 고정 폭(140px, `+N` 40px)이다.** 글자 폭을 재려면 숨은 측정 요소가 필요하다.
- **detached 창은 탭 하나만 갖는다.** 탭 줄이 있는 detached 창은 workspace를 하나 더 만드는 일이다. 탭 여럿을 보려면 창을 여럿 띄운다. dock은 focus pane 끝에 붙이고 떼기 전 자리는 저장하지 않는다(floated였어도 docked로 온다).
- **값은 창이 뜬 뒤 `take()`로 당겨 받는다.** hash `#detached=<key>`는 route 선택용이다. 탭 key가 4096자까지이고 transfer가 커질 수 있다.
- **두 방향(project 창, detached 창)을 IPC 하나(`ipc/detached.ts`, `window.lophnDetached`)로 묶는다.** 같은 renderer bundle과 preload를 쓰는 창이고 main이 보낸 창으로 역할을 가른다. 통로를 둘로 가르면 preload·노출·type이 두 벌이 된다.
- **보통 browser 탭은 옮기지 않고 다시 load한다(사람).** `<webview>`는 그것을 띄운 shell 문서에 묶여 다른 부모로 옮기면 guest가 다시 만들어진다. 쓰던 form, scroll, 그 page가 연 popup의 `window.opener`를 잃는다. page를 지킬 수 있는 곳은 native view뿐이고 그것이 `window.opener`가 걸린 popup이다.
- **detached 창 안의 popup은 또 하나의 detached 창이다.** 가장 단순하게 `window.opener`를 지킨다. 대안인 project 창 floats 층으로 옮기기는 opener 소유 이동이 더 필요하다. features의 크기는 따르지 않는다(기본 960×600).
