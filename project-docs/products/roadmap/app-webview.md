# app webview: 앱 화면을 native view에서 `<webview>`로 옮긴다

상태: 구현했다(2026-10-31, `project-docs/products/change-log/0.11.0.md`의 "앱 화면과 artifact 화면을 `<webview>` guest로 옮기고, desk를 오가도 page를 지킨다"). 앱 화면(app panel 탭, 앱 place 본문, 앱 card, 앱 전용 창)과 artifact 탭이 browser 탭과 같은 창의 `<webview>` 그릇에 산다. 흐름과 지키는 것은 `project-docs/architecture/workspace-layout.md`(그릇·z-index·desk 규칙·Detach), `browser-tab.md`(붙이기 규칙), `annotation.md`, `appearance.md`, `keybindings.md`, `artifact.md`다. 아래 "무엇을 만드나"·"열기 전에 확인할 것"·"단계"는 착수 전 계획 기록이다. 남은 것은 "하지 않는 것"뿐이다.
배경 문서: `project-docs/architecture/browser-tab.md`(`<webview>` 그릇과 붙이기 규칙), `project-docs/architecture/workspace-layout.md`(그릇·z-index·Detach), `project-docs/architecture/annotation.md`(앱 view 신원), `project-docs/architecture/appearance.md`, `project-docs/architecture/keybindings.md`, AGENTS.md "속도"·"호환성".

## 왜

- 앱 화면(project 창의 app panel 탭, 앱 place 본문, 앱 card, 앱 전용 창)과 artifact 탭은 native `WebContentsView`다. native view는 shell HTML 위에 그려져 shell의 menu, popover, floated 패널, toast가 그 밑에 깔린다.
- 그래서 우회 장치가 쌓였다: 층 순서(`appViewOrder`), cover(`useViewCover`, `createViewCovers`)로 view 줄이기, 위치를 IPC로 보내 main이 맞추기(`VIEW_BOUNDS_CHANNEL`, DIP 변환), 앱 place menu가 열린 동안 view 숨기기(`workspace-layout.md`), DOM 대신 overlay view에 그리는 toast(`use-view-toast.ts`).
- browser 탭은 같은 문제로 이미 native view에서 `<webview>`로 옮겼고(`browser-tab.md` "보통 탭을 `<webview>`로 바꿨다(사람)"), 그 뒤로 겹침 문제가 없다. 앱 화면도 같은 그릇으로 모은다(사람, 2026-10-31).

## 착수 전 코드(기록)

- main `packages/shell/main/app-frame/` 27 file 4747줄. Electron을 import하는 것은 `electron-app-frame.ts`(222줄)와 `electron-overlay.ts`(211줄) 둘뿐이다.
- 바꿀 이음매는 `AppViewHost`(`view-model.ts` 63–93줄: `hasWindow`, `create`, `attach`, `detach`, `focused`, `capture`, `pageUrl`, `focusShell`, `send`)다. 구현은 `electronAppViews()` 하나다(`wiring/app-views.ts`에서 만든다). browser·artifact registry도 같은 모양의 일부를 쓴다(`BrowserViewHost`, `ArtifactViewHost`).
- 신원은 contents id로 찾는다. `registry.ts`의 `byContents: Map<contents.id, Entry>`를 `mount()`가 쓰고 `senderView`·`senderAnnotateView`가 읽는다. `app-ipc.ts`, `annotate.ts`, `app-call.ts`, `view-error.ts`는 sender가 어떤 webContents든 이 표만 본다. guest webContents도 id가 있으므로 이 쪽은 그대로 쓴다.
- 앱 저장소는 partition이다(`session-policy.ts`의 `appPartition`: `persist:app-<app>:live`, `persist:app-<app>:preview-<bundle hash>`). `<webview>`도 partition을 받으므로 그대로 쓴다.
- 앱 전용 창(`desktop/app-window.ts`, `wiring/app-views.ts`)은 문서가 없는 빈 `BrowserWindow`에 native view 하나를 붙인 것이다. `webviewTag`가 꺼져 있고(`desktop/security.ts`), shell preload도 없다. 그래서 단축키 전달(`wiring/desktop.ts`의 `web-contents-created`)이 보낼 renderer가 없다.
- renderer `packages/shell/renderer/app-frame/`의 `embedded-view.tsx`(303줄)가 `EmbeddedView`, `useViewBounds`, `useViewCover`, `ViewLayerProvider`, `ViewCoversProvider`, `ViewKeepsProvider`를 낸다. `bounds.ts`(226줄)가 cover 빼기와 rAF 사각형 relay, `view-keeps.ts`(91줄)가 탭이 다시 mount되어도 view를 살리는 보관소다.
  - `EmbeddedView` JSX 3곳: `workspace/app-panel-tab.tsx`, `workspace/visuals/app-card-block.tsx`, `app-frame/app-space.tsx`.
  - `useViewCover` 3곳: `workspace/floats/floats.tsx`, `app-frame/side-panel.tsx`, `artifact/artifact-tab.tsx`.
  - `useViewBounds` 4곳: `embedded-view.tsx` 안, `artifact/artifact-tab.tsx`, `browser/browser-tab.tsx`(native popup), `browser/devtools-pane.tsx`.
- browser `<webview>` 그릇 `renderer/browser/webview-host.tsx`(`createWebviewHost`)는 창마다 하나, 탭 key당 `<webview>` 하나이고 옮기지 않고 위치·z-index·보임만 바꾼다. 붙이기 규칙 `main/browser/webview-guest.ts`의 `hardenWebviewAttach`는 `persist:lophn-browser`만 받는다.
- 떠난 desk의 `<webview>`는 놓아 다시 load된다(`issues/workspace-layout.md` "desk를 떠났다 돌아오면 일반 browser 탭의 page가 다시 load된다"). app panel native view는 `allDeskTabs`로 판정해 산다(`workspace/workspace.tsx` view 해제 effect).
- appearance CSS와 `data-lophn-locale`은 `wiring/appearance.ts`가 `web-contents-created`의 `dom-ready`에서 URL(`lophn-app://` 등)로 골라 넣는다. guest도 같은 길로 받는다[INFERENCE].
- 단축키는 `wiring/desktop.ts`가 guest를 `hostWebContents`로 창에 잇는다. browser guest에서 이미 쓴다.
- native view 장치(`placement.ts`, `view-order.ts`, `visibility.ts`, `bounds.ts`, `embedded-view.tsx`, `moveViews`)를 보는 test는 없다.

## 무엇을 만드나

### 그릇

- app view와 artifact view를 shell renderer의 `<webview>`로 그린다. browser 탭의 `createWebviewHost`를 kind와 상관없는 그릇 하나로 넓혀 셋(browser, app, artifact)이 같이 쓴다. 창마다 하나, 탭 key당 `<webview>` 하나, 옮기지 않고 위치·z-index·보임만 바꾼다.
- 그릇은 탭이 layout 어디(모든 desk의 pane, floats)에 있는 동안 `<webview>`를 숨긴 채 둔다. 탭이 `allDeskTabs`에서 사라질 때만 놓는다. 그래서 같은 창 안 Float·Dock·접기·desk 바꾸기에서 page가 다시 load되지 않는다. browser 탭도 같은 규칙이 되어 위 desk 이슈가 같이 닫힌다.
- 앱 place 본문과 앱 card도 같은 그릇이다. card(`app-card-block.tsx`)는 대화 글 안에 있어 탭 key가 없다. card key(message id + card 번호)로 같은 그릇에 둔다.

### 붙이기와 신원

- renderer는 지금처럼 `views.openApp`으로 열기를 부탁한다. main registry가 항목을 만들고 그 창에만 쓸 수 있는 1회 ticket과 붙일 값(partition, `lophn-app://` 주소)을 돌려준다.
- renderer가 `<webview>`에 그 값을 적으면 `will-attach-webview`가 ticket으로 registry 항목을 찾는다. partition, 주소, preload(`preload-app.cjs`, artifact는 `preload-artifact.cjs`), `webPreferences`는 항목 값으로 덮고 renderer가 적은 것은 버린다. ticket이 없거나 다른 창의 것이거나 이미 쓴 것이면 거절한다. `hardenWebviewAttach`는 kind별 규칙 하나로 넓힌다.
- `did-attach-webview`에서 guest contents id를 그 항목의 `byContents`에 묶는다. 그 뒤 `app-ipc.ts`, `annotate.ts`, `app-call.ts`, `view-error.ts`의 신원 검사는 바뀌지 않는다.
- navigation guard(`navigationAllowed`), 새 창 거절, `will-attach-webview` 거절(guest 안의 webview), packaged DevTools 닫기, crash·unresponsive 감시는 guest webContents에 지금 `electronAppViews.create`가 다는 것을 그대로 단다.

### 위치와 보임

- 위치는 renderer CSS다. `VIEW_BOUNDS_CHANNEL`, `visibility.ts`의 DIP 변환과 본문 자르기, `placement.ts`의 attach·detach는 app·artifact에서 쓰지 않는다.
- "첫 load 전에는 보이지 않는다"(`placement.ts`)는 그릇이 `did-finish-load` 전까지 `visibility: hidden`으로 지킨다.
- 숨김·보임은 `<webview>` 자신의 visibility다. focus를 shell로 돌리는 것(`focusShell`)은 숨길 때 renderer가 한다.

### 앱 전용 창

- 앱 전용 창을 shell 문서 `lophn-shell://app-window`로 바꾼다. 그 문서는 `<webview>` 하나를 창 본문 전체에 둔다. 창은 `webviewTag`를 켜고 shell preload 가운데 views·shortcut·appearance만 싣는다.
- 그러면 앱 화면을 그리는 길이 하나가 되고, 단축키는 project 창과 같은 `hostWebContents` 길로 shell renderer에 닿는다.

### screenshot, crash

- annotation screenshot은 guest webContents의 `capturePage`로 찍는다[INFERENCE]. 지금처럼 그 view만 찍히고 shell DOM은 찍히지 않는다.
- crash는 guest의 `render-process-gone`으로 알고, 다시 열기(`registry.reopen`)는 그릇이 그 `<webview>`를 새로 만든다.

### 지우는 것

- main: `electronAppViews`의 `create`·`attach`·`detach`·`capture`의 native 부분, `placement.ts`(app·artifact 쓰임), `view-order.ts`의 app·artifact 층, `visibility.ts`의 좌표 부분, `routeFrame`과 `moveViews`의 app·artifact 갈래.
- renderer: `useViewCover`, `createViewCovers`, `ViewCoversProvider`, `bounds.ts`의 cover 계산, `EmbeddedView`의 native 부분, app·artifact를 위한 `ViewKeeps`. `ViewLayerProvider`는 `<webview>`의 z-index 층으로 남았다.
- 남는 native view는 browser의 크기 준 popup과 DevTools뿐이다. 그 둘을 위한 층과 bounds는 browser 쪽 이름(`main/browser/view-order.ts`, `main/browser/native-bounds.ts`)으로 남았다.

## 정한 것

- 그릇은 `<webview>`다(사람, 2026-10-31). browser 탭에서 이미 쓰고 문제가 없다. iframe은 preload의 isolated world, 앱별 partition, `sender.id` 신원을 잃어 main을 다시 짜야 하고, 문서 경계(menu가 앱 밖으로 못 나감, scroll·선택·focus 경계)는 `<webview>`와 같다. remote UI는 앱이 자기 DOM·CSS component를 못 쓰게 해서 버렸다(사람). Electron은 `<webview>`를 권하지 않는다(https://www.electronjs.org/docs/latest/tutorial/web-embeds). browser 탭이 이미 이 위험을 지고 있어 새 위험은 아니다.
- Detach(다른 OS 창으로 떼기)하면 앱 화면이 다시 load된다(사람, 2026-10-31). browser 탭과 같다. `<webview>`는 띄운 문서에 묶인다. 앱 template `AGENTS.md`(lophn-managed 절)에 "잃으면 곤란한 화면 상태는 `localStorage`에 둔다"를 더해 잃는 것을 줄인다(agent). URL query는 다시 열 때 main이 새 `src`를 내므로 남지 않는다.
- artifact view도 같이 옮긴다(agent). 같은 cover 문제를 갖고(`artifact-tab.tsx`의 `useViewCover`), 남겨 두면 app 쪽 장치를 지우지 못한다.
- 앱 저장소 partition 이름을 바꾸지 않는다(agent). 사람의 `~/.lophn` 앱 data(cookie, localStorage, IndexedDB)가 그대로 이어져 migration이 필요 없다.
- overlay view(palette, dialog, toast, browser menu)는 이번에 손대지 않는다(agent). native popup과 DevTools 위에도 떠야 하므로 남는다. 앱 화면 위 toast를 DOM으로 돌리는 것은 지금 DOM fallback이 이미 있는 길(`use-view-toast.ts`)이라 그릇을 옮길 때 같이 한다.
- 붙이기 거절 규칙(ticket, 창, partition, preload 덮기)만 test로 지킨다(agent, AGENTS.md "sandbox 경계"). `webview-guest_test.ts`를 넓힌다. 그릇, 위치, 보임은 test하지 않는다.

## 열기 전에 확인할 것

Electron 44.5.1 개발 앱에서 throwaway로 본다.

- guest webContents에 앱 preload(`contextBridge`, `executeInMainWorld`)가 붙고 `lophnApp.callTool`이 `app:call-tool`에 닿는가.
- guest의 `capturePage`가 그 page만 찍는가. headless(offscreen) 개발 확인에서 guest의 `paint` event가 오는가. 오지 않으면 headless screenshot 길을 정한다.
- guest의 `render-process-gone`·`unresponsive`가 오는가.
- 앱 partition의 `webRequest`·`protocol.handle`(`lophn-app://`)이 guest 요청에도 걸리고 `details.webContentsId`가 guest id인가.
- `will-attach-webview`에서 `params`로 ticket을 넘길 수 있는가(`src`의 fragment나 `partition` 값 말고 쓸 칸).
- 숨긴(`visibility: hidden`) `<webview>`가 오래 있어도 guest가 버려지지 않는가.

## 단계

1. ~~위 확인을 spike로 본다.~~ Electron 44.5.1 개발 앱에서 봤고, 그 결과를 위 "무엇을 만드나"에 반영했다.
2. ~~계획 `app-webview`: 그릇 일반화와 desk 규칙, 붙이기·ticket, app panel·앱 place·card, 앱 전용 창 문서, artifact, 지우기, architecture 문서 고치기(`workspace-layout.md`, `browser-tab.md`, `annotation.md`, `appearance.md`, `keybindings.md`, `artifact.md`).~~ land했다.

## 하지 않는 것

- 앱 화면을 Detach해도 상태를 지키기. 표준 Electron에는 `<webview>` guest를 다른 문서로 옮기는 길이 없다(ChatGPT desktop은 고친 Electron으로 한다, `browser-tab.md`).
- 앱 menu·tooltip을 앱 영역 밖으로 내보내기(shell이 대신 그리기). 써 보고 거슬리면 따로 연다.
- browser popup과 DevTools를 `<webview>`로 옮기기. popup은 `window.opener` 때문에, DevTools는 `<webview>`가 담지 못해서 native로 남는다.
- overlay view를 줄이거나 없애기.
