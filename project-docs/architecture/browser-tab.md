# browser-tab

workspace pane에서 인터넷 page를 여는 탭 kind `browser`의 메커니즘이다. lophn이 다루는 것 가운데 가장 믿지 못할 입력이 인터넷 page이므로, page가 닿는 길(navigation, popup, permission, download, IPC)을 shell main의 순수 규칙 하나가 정하고 Electron 연결은 그 규칙을 부르기만 한다. 여러 곳에 걸친다. shell main(`packages/shell/main/browser/`, `desktop/wiring/browser.ts`, `wiring/bookmarks.ts`), 계약(`packages/shell/ipc/browser.ts`, `preload/browser-api.ts`), renderer(`packages/shell/renderer/browser/`, `workspace/kinds/browser.tsx`, Settings의 Browser pane)다.

## 흐름

```
 renderer (shell 창)
   browser 탭 (kinds/browser.tsx, keep) ─ BrowserTab ─ toolbar(뒤로·앞으로·새로 고침·주소 칸·별·bookmark menu·Open in browser·Inspect)
        │  window.lophnBrowser (preload, shell 창에만)          page region <div> ─ useViewBounds ─▶ shell:view-bounds
        ▼                                                                                   │
 shell main                                                                                 ▼
   browser-ipc.ts ── caller가 desktop 창 본문인지, 입력이 schema에 맞는지 ──▶ registry.ts(createBrowserViews)
        │                                                       │  위치·숨김: app-frame/placement.ts를 그대로 부른다
        │                                                       │  frame-router.ts: view_session이 browser 것이면 browser로, 아니면 앱 registry로
        │                                                       ▼
        │                                         electron-view.ts ── WebContentsView 하나 (preload 없음, persist:lophn-browser, devTools)
        │                                               │ hook: will-navigate / will-redirect / will-frame-navigate ─▶ decideNavigation
        │                                               │       input-event(mouseDown, rawKeyDown) ─▶ activation.mark
        │                                               │       setWindowOpenHandler ─▶ popup-host.ts ─▶ decidePopup
        │                                               │       before-input-event Ctrl/Cmd+D ─▶ bookmark-key event
        │                                               │       did-navigate·title·loading·crash ─▶ shell:browser-state push
        │                                               ▼
        │                                         session.ts (첫 view나 지우기 때 한 번 설치)
        │                                               permission ─▶ decidePermission, device 거절
        │                                               will-download ─▶ activation.fresh 아니면 거절, 맞으면 저장 dialog
        │                                               UA·client hints에서 Electron/lophn token 빼기
        │
   bookmark-ipc.ts ── bookmarks.ts ── <dataRoot>/shell/bookmarks.json (atomic write, 0600) ── 바뀌면 모든 창에 shell:bookmarks-changed

 popup: page의 window.open (입력 5000ms 안) ─▶ Electron이 만든 contents를 새 view로 감싸 등록(adopted=false)
        ─▶ opener 창에 popup event ─▶ renderer가 연 탭 바로 뒤에 탭을 만들고 adopt ─▶ 그 뒤는 보통 view
        page의 window.close() ─▶ webContents "close" ─▶ close event ─▶ renderer가 탭을 지운다(closeView)
```

## 지키는 것

- **navigation 결정은 `main/browser/navigation.ts`의 순수 함수 `decideNavigation` 하나가 한다.** main frame은 http/https(어느 host든, localhost와 사설 IP 포함)와 정확히 `about:blank`만 받는다. 최상위 `data:`·`blob:`은 막는다. subframe은 http/https와 `data:`·`blob:`·`about:`도 받는다. 그 밖의 scheme(`file:`, `lophn-*:`, `chrome:`, `devtools:`, `javascript:`, custom protocol)은 두 frame 모두 막는다. main frame의 userinfo(`user:pass@`) URL은 막는다. 표는 `navigation_test.ts`가 지킨다.
- **`mailto:`·`tel:`만 OS로 넘기고, main frame에서 사용자 입력 직후일 때만 넘긴다.** subframe은 조용히 막는다. 제3자 iframe이나 입력 없는 script가 OS 앱을 열지 못한다. 주소 칸에 적은 `mailto:`는 page 입력이 아니라서 넘기지 않고 거절한다.
- **사용자 입력은 contents마다 마지막 mouseDown·keyDown 시각이고, 5000ms 안이어야 fresh다(`activation.ts`).** popup과 download와 OS 넘기기가 이것을 본다. 시각은 인자(`nowMs`)로 받는다.
- **popup은 입력 직후의 것만 받고, Electron이 만든 contents를 그대로 감싸 `window.opener`를 남긴다.** 따로 만든 contents로 바꾸면 opener가 끊겨 OAuth popup 로그인이 깨진다. popup contents는 opener의 session과 webPreferences를 물려받고 page의 features로 바꾸지 못한다. 입력 없는 popup은 거절하고 그 탭에 `popup-blocked`를 알린다. `width`·`height`가 둘 다 있으면 `placement`가 floated다.
- **popup view는 renderer가 탭을 만들어 adopt하기 전까지 state를 밀지 않는다.** adopt는 소유 창(opener의 창)에서 한 번만 된다. 다른 창은 `invalid_input`, 두 번째는 `forbidden`이다. adopt되지 않은 view는 그 창이 닫힐 때 같이 지운다. popup은 opener 탭을 닫아도 남는다.
- **browser view에는 preload가 없다.** page에 열린 IPC가 0개다. 뒤로·앞으로·새로 고침·Inspect는 shell toolbar가 main IPC로 시킨다. `<webview>`는 쓰지 않는다(`webviewTag:false`, `will-attach-webview` 거절).
- **browser view는 앱 view registry(`app-frame/registry.ts`)에 넣지 않는다.** 앱 연결에 묶인 registry라서다. 위치·숨김은 같은 `createPlacement`와 `createViewVisibility`를 쓰고 `frame-router.ts`가 `view_session`으로 가른다. `app-frame/`에서 browser 때문에 바뀐 것은 `placement.ts`의 `Pick` 한 줄이다.
- **모든 browser 탭과 project가 persistent partition 하나(`persist:lophn-browser`)를 같이 쓴다.** 앱 view partition과 나뉘어 page가 앱 화면의 cookie·storage를 보지 못한다. session 설치는 `userData`를 data root로 잡은 뒤 첫 view나 첫 지우기 때 한 번 한다. 그 전에 partition을 만들면 저장이 data root 밖에 생긴다.
- **permission은 clipboard write(`clipboard-sanitized-write`)를 main frame의 http/https가 요청할 때만 허락한다.** 그 밖(clipboard read, media, 위치, 알림, device)은 모두 거절한다. 표는 `permission_test.ts`가 지킨다.
- **download는 저장 경로를 정하지 않아 Electron 저장 dialog가 뜬다.** 시작한 contents를 모르거나 입력 직후가 아니면 거절한다. 사람이 고르기 전에는 아무것도 저장되지 않는다.
- **UA와 모든 요청 header에서 `Electron/x`와 앱 이름 token을 빼고 client hints를 Chrome처럼 맞춘다.** 빼지 않으면 Google 로그인 같은 곳이 막는다.
- **Clear browsing data는 `clearStorageData()`를 인자 없이 부르고 cache를 지운 뒤 열린 page를 다시 load한다.** Electron 44의 storage 이름이 rea·Chrome 문서의 이름과 달라 이름을 적으면 덜 지워진다.
- **bookmark는 `<dataRoot>/shell/bookmarks.json` 하나에 main만 쓴다.** 쓰기는 `workspace/atomic-file.ts`(temp 뒤 rename, 폴더 0700·파일 0600)를 layout과 같이 쓴다. 쓰기는 promise 줄로 세워 창 둘의 요청이 서로 덮지 않는다. 바뀌면 열린 모든 shell 창에 알리고 받은 쪽이 다시 읽는다.
- **깨진 `bookmarks.json`(JSON 아님, schema·version 불일치, 모르는 칸)은 어떤 쓰기도 덮어쓰지 않는다.** 목록은 `corrupt` 상태로 보이고 화면은 고치는 길을 열지 않는다. 사람이 모은 목록을 잃지 않으려는 것이다. `bookmarks_test.ts`가 byte 단위로 지킨다.
- **bookmark url은 http/https이고 userinfo가 없는 것만, `href` 완전 일치로 하나만 둔다.** 1000개, title 200자, url 8192자까지다.
- **browser 탭 layout은 `{key, url}`만 저장한다.** title과 history는 저장하지 않는다. 다시 열면 그 url을 load한다. url 검사는 load할 때 `decideNavigation`이 한다.

## 왜 이 모양인가

- **규칙을 rea `desktop-embeded-browser`에서 TS로 옮겨 짰다.** library를 dependency로 넣지 않았다. 그 library는 창과 tab 줄을 혼자 맡지만 lophn에는 placement·overlay·bounds 길이 이미 있고, CommonJS 그대로는 Result·Clock 같은 lophn 규칙과 맞지 않는다.
- **localhost와 사설 IP를 막지 않는다.** 가장 많이 쓸 곳이 사람의 dev server다. core API는 token으로 막혀 있어 OS browser보다 위험이 늘지 않는다.
- **subresource 요청 guard(`webRequest.onBeforeRequest`)는 두지 않는다.** 이 partition에는 `lophn-shell`·`lophn-app` protocol handler가 없어 그 요청은 어차피 실패하고, navigation은 `decideNavigation`이 막는다.
- **tab 수 cap을 두지 않는다.** pane 탭 상한 200개가 이미 있다.
- **toolbar menu(overflow, bookmark)와 채운 별의 popover는 overlay view(`kind: "menu"`, `"popover"`)로 띄운다.** native view는 DOM 위에 그려져 DOM menu가 그 밑에 깔린다. overlay는 native view 위에 그려지므로 page를 숨기지 않는다. overlay view는 `anchorRect` 크기로 잘리므로 부르는 쪽이 menu가 펼쳐질 상자 전체를 보낸다(`renderer/browser/overlay-menu.ts`). overlay에는 글 입력 칸이 없어 별 popover는 title과 [Remove]만 두고, title 고치기는 Settings의 Browser pane이 맡는다(사람). overlay가 없는 창(dev mock, gallery)은 DOM menu·popover를 그리고 열린 동안 native view를 숨긴다.
- **page에 focus가 있을 때 Ctrl/Cmd+D는 main이 `bookmark-key` event로 보낸다.** 작업대 단축키 표에 넣지 않는다. terminal의 Ctrl+D(EOF)와 부딪힌다.
