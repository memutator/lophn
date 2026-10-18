# workspace layout

project 창 안에서 탭이 어디에 있는가를 정하는 메커니즘이다. 탭은 pane의 탭 줄(docked), workspace 위에 뜬 패널(floated), 상단 bar의 span(minimized) 중 한 곳에 있다. 모든 탭 kind가 같은 길을 쓴다. renderer의 순수 함수 layout model, main이 검증하는 `layout.json`, 패널을 그리는 floats 층, native view(app panel, browser의 크기 준 popup)를 쌓는 main의 층 순서에 걸친다. 보통 browser 탭은 native view가 아니라 floats 층 안의 `<webview>`다(`browser-tab.md`).

## 흐름

```
 renderer/workspace/model.ts ── WorkspaceView { panes(1-2), splitRatio, focusedPane, floats[] }
   FloatItem { tab, rect, minimized, originPane }  배열 순서 = 위아래 순서(마지막이 맨 위)
   순수 함수: floatTab, dockTab, openFloat, minimizeFloat, restoreFloat, raiseFloat, closeFloat, setFloatRect
        │
        │ 바뀔 때마다 storableView(transient 탭 빼기) ─▶ toStoredLayout ─▶ layout:save
        ▼
 main/workspace/schema.ts ── layout.json (LAYOUT_SCHEMA_VERSION 2, floats 최대 20) ── 판이 다르면 unsupported_schema, 새로 만든다

 workspace.tsx
   .content ─┬─ Panes          (docked 탭. 고른 탭만 mount, keep kind는 숨긴 채 mount)
             └─ Floats         (.floats 층, z-index --z-sticky. 첫 자식이 browser `<webview>` 그릇. 패널마다 FloatPanel, z-index = 층 번호 × 2)
   TopBar.leading ── Breadcrumbs ─ MinimizedBar (접힌 패널 span, 넘치면 +N menu)

 native view 층 (main/app-frame/view-order.ts appViewOrder, 창마다 하나)
   pane view (layer 0) < floated view (layer = floats index + 1) < overlay
   renderer: EmbeddedView가 ViewLayerProvider의 층을 setViewBounds{ layer }로 보낸다
   cover: useViewCover(ref, covering, layer). view는 자기 층보다 위 층의 cover만 뺀다
```

## 지키는 것

- **탭 하나는 한 곳에만 있다.** pane이나 floats 중 하나다. 같은 탭을 두 자리에 그리면 editor는 session이 둘이 되어 conflict가 나고, terminal은 입력을 받을 수 있는 webContents가 하나뿐이다. model 함수가 이를 지키고 `model_test.ts`의 위험 test가 float, dock, minimize, restore, raise, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는지 본다. `openTabIn`과 `reopenTab`은 floated 탭을 새로 붙이지 않는다. `openTabIn`은 그 패널을 펴서 맨 위로 올린다.
- **탭을 찾고 바꾸는 곳은 pane과 floats를 모두 본다.** `findTab`, `allTabs`, `mapTabs`를 쓴다. pane만 보는 `holderOf`는 `model.ts` 밖에 내놓지 않는다. `host.openTab`, `patchTab`, `removeTab`, 닫은 탭 다시 열기, 파일 이름 바꾸기, 대기 목록의 terminal 고르기가 floated 탭에도 같다. 닫은 floated 탭은 docked로 돌아온다.
- **`dockTab`은 떠나 온 pane(`originPane`)의 끝에 넣는다.** 그 번호가 지금 pane 수 밖이면 focus pane이다. preview와 transient 표시를 지운다.
- **minimized는 floated에서만 간다.** 접혀도 `rect`는 접기 전 값을 지킨다. 펴면(`restoreFloat`) 맨 위로 온다. 접힌 탭은 고르지 않은 docked 탭처럼 다룬다: `keep` kind(app panel)는 `hidden` 패널로 mount를 유지하고, 나머지는 unmount한다.
- **`transient` 탭은 저장하지 않는다.** popup처럼 잠깐 뜬 패널이다. `toStoredLayout`이 `storableView`를 먼저 거친다. 위험 test가 본다. Dock하면 사람이 고른 것이라 저장한다.
- **rect는 `.content` 왼쪽 위 기준 정수 CSS px다.** 가장 작은 크기는 320×200이다. 그릴 때는 지금 `.content` 안으로 당겨(`clampFloatRect`) 그리고 저장된 rect는 사람이 옮기거나 크기를 바꿀 때만 바뀐다. 창이 줄었다 커지면 원래 자리로 돌아온다. `.content`를 아직 못 쟀거나 0이면 floats 층을 그리지 않고 rect를 저장하지 않는다(0×0 rect는 schema가 거절해 저장이 통째로 실패한다).
- **패널 DOM 순서는 탭 key 순으로 고정하고 위아래는 z-index로만 정한다.** raise할 때 요소를 재배열하면 안에 있던 focus와 scroll(terminal, editor)이 날아간다. 누르거나 focus가 들어오면 맨 위로 온다.
- **browser `<webview>`는 floats 층 안의 그릇 하나에 탭 key당 한 번 만들고 옮기지 않는다.** 다른 부모로 옮기면 page가 다시 load된다. 패널 z-index가 층 번호 × 2라서, pane 탭의 `<webview>`는 z-index 1(모든 패널 아래), floated 탭의 `<webview>`는 자기 패널 위·다음 패널 아래(2L+1)에 놓인다. 탭 자리는 사각형만 알린다(`renderer/browser/webview-host.tsx`).
- **focus는 칸과 floats 층 중 한 곳에만 있다.** `workspace.tsx`의 `floatFocused`(저장하지 않는다)가 정한다. 패널을 누르거나 Float·펴기를 하면 floats 층, 칸을 누르거나 Dock하거나 맨 위 패널을 접거나 닫으면 칸이다. 접히지 않은 패널이 없으면 칸이다. focus 색 강조선(칸의 고른 탭, 맨 위 패널의 bar)과 kind의 `render`가 받는 `active`가 이것을 따른다. terminal은 active일 때만 입력과 PTY resize를 받으므로 둘이 동시에 입력을 받지 않는다. 칸 단축키(Ctrl+W 등)는 floats에 focus가 있어도 `focusedPane` 칸에 듣는다.
- **native view는 세 층으로 쌓인다.** pane view < floated view(floats 순서) < overlay. main의 `appViewOrder`가 view를 붙이거나 층이 바뀔 때만 다시 쌓는다(bounds만 바뀐 호출은 다시 쌓지 않는다). Electron의 `addChildView`가 이미 붙은 view를 맨 위로 옮기는 것을 쓴다.
- **DOM 패널이 아래층 native view 위에 뜨면 cover로 native view를 줄인다.** native view는 DOM 위에 그려진다. floated 패널은 자기 층으로 cover를 등록하고, native view는 자기 층보다 위 층의 cover만 뺀 칸 중 가장 큰 사각형에 그린다. 같은 층끼리는 빼지 않는다(floated app panel이 자기 패널 cover에 줄지 않는다). side panel과 project picker의 cover는 층이 없어 늘 위다. 패널을 옮기면 크기가 같아도 `ViewCovers.changed()`로 다시 잰다.
- **app panel의 native view는 탭이 사는 동안 산다.** Float, Dock, 접기로 `EmbeddedView`가 다시 mount되어도 view를 닫지 않고 `ViewKeeps`(창마다 하나, renderer)에 숨겨 두었다가 같은 탭 key로 다시 쓴다. page를 다시 load하지 않으므로 쓰던 page 상태와 popup의 `window.opener`가 남는다. 탭이 layout에서 사라지면(`allTabs`에 없으면) 닫고, `Workspace`가 unmount되면 모두 닫는다. 열기 입력이 바뀌면 옛 view를 닫고 새로 연다.
- **여는 길은 탭 menu의 Float, 패널 bar의 Minimize·Dock·Close, 상단 bar span(누르기, right-click의 Restore·Dock·Close), 명령 palette(Float tab, Dock panel, Minimize panel)다.** 기본 단축키는 없다. palette의 Dock·Minimize 대상은 맨 위의 접히지 않은 패널이다.

## 왜 이 모양인가

- **`originPane`은 번호다.** pane은 최대 둘이다. pane이 사라져 번호가 어긋나면 focus pane으로 보낸다.
- **floats 개수(20)는 schema만 막는다.** 사람이 20개를 띄울 일이 없다.
- **새 패널은 `.content` 가운데 60% 크기로 겹쳐 뜬다.** 비껴 놓기(cascade)는 하지 않는다.
- **겹치는 동안 native view를 cover로 줄인다.** 버린 안: 겹치는 동안 마지막 `capturePage` 그림을 보이기(page가 멈춘다), DOM 패널도 native view로 띄우기(패널마다 shell renderer 하나라 가장 크다). 잃는 것은 패널을 옮길 때마다 page 크기가 바뀌어 다시 layout되는 것이다.
- **view 보관소는 renderer에 둔다.** main registry가 이미 숨기기와 폐기를 구분하므로 새 IPC가 필요 없다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 layout에 없으면 닫는다.
- **옛 layout 파일(판 1)은 읽지 않는다.** 새로 만든다(AGENTS.md "호환성").
- **minimized span은 고정 폭(140px, `+N` 40px)이다.** 글자 폭을 재려면 숨은 측정 요소가 필요하다.
- **detached(OS 창)는 아직 없다.** 계획 `workspace-detach`가 schema에 `detached`, 창 사이 탭 옮기기(`transfer`/`receive`), native view 옮겨 붙이기를 더한다.
