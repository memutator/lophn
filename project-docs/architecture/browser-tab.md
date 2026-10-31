# browser-tab

workspace pane에서 인터넷 page를 여는 탭 kind `browser`의 메커니즘이다. lophn이 다루는 것 가운데 가장 믿지 못할 입력이 인터넷 page이므로, page가 닿는 길(navigation, popup, permission, download, IPC)은 shell main의 순수 규칙이 정하고, Electron 연결은 그 규칙을 부르기만 한다. page를 그리는 그릇은 둘이다. 보통 탭은 shell renderer의 `<webview>`(앱 화면·artifact 화면과 같은 창의 그릇)이고, `window.opener`를 지켜야 하는 크기 준 popup과 DevTools만 native `WebContentsView`다. 여러 곳에 걸친다. shell main(`packages/shell/main/browser/`, `desktop/wiring/browser.ts`, `wiring/bookmarks.ts`), 계약(`packages/shell/ipc/browser.ts`, `preload/browser-api.ts`), renderer(`packages/shell/renderer/browser/`(native popup·DevTools 자리), `renderer/app-frame/webview-host.tsx`(창마다 하나인 `<webview>` 그릇), `workspace/kinds/browser.tsx`, `kinds/browser-devtools.tsx`, Settings의 Browser pane)다. terminal이 연 URL을 browser 탭으로 넘기는 bridge는 `packages/shell/main/browser-bridge/`, `desktop/wiring/bridge.ts`, `renderer/terminal/use-bridge-open-requests.ts`다.

## 흐름

```
 renderer (project 창)
   browser 탭 (kinds/browser.tsx, keep) ─ BrowserTab ─ BrowserChrome(browser-chrome.tsx)가 card 머리 줄에 올린다: 뒤로·앞으로·새로 고침(card nav 덮어쓰기), 주소 칸(경로 자리), 별·bookmark menu·Open in browser(⋯ 앞), DevTools 묶음(⋯ menu 맨 위). floated 탭·detached 창은 card가 없어 본문 위 줄로 그린다(⋮ menu)
     │  page 자리 ─ useWebviewSlot ─▶ webview host (창마다 하나. project 창은 floats 층, detached 창·앱 전용 창은 본문의 층, 앱 place는 .content)
     │                                 <webview partition=persist:lophn-browser> 탭 key당 하나, 옮기지 않고 left/top/size/z-index/visibility만 바꾼다(앱·artifact 화면도 같은 그릇)
     │  DevTools 자리 ─ useViewBounds ─▶ shell:view-bounds (native)
     │  window.lophnBrowser (preload, shell 창에만. project 창과 detached 창): navigate·command·adopt·devtools·clearData·bookmarks, state·event 구독
     ▼
 shell main
   wiring/browser.ts ── shell 창에만 webviewTag ── will-attach-webview 하나 ─▶ webview-guest.ts hardenWebviewAttach
   │      (shell 문서에서 온 것만. browser는 partition 강제·preload 지우기·첫 src는 decideNavigation, 앱·artifact는 resolver가 받은 그 src일 때만 partition·preload 강제)
   │                   did-attach-webview ─▶ 받아 둔 붙이기를 순서대로(FIFO) bind: browser는 guest 항목 "wv-<guest id>", 앱·artifact는 registry의 그 view
   registry.ts ── guest 항목(webview) · native 항목(popup) · DevTools 항목
   │   hook(electron-view.ts adapt, guest와 native popup 같이):
   │     will-frame-navigate / will-redirect ─▶ decideNavigation (main frame은 will-frame-navigate가 먼저 오고, 막으면 will-navigate는 오지 않는다)
   │     input-event(mouseDown, rawKeyDown) ─▶ activation.mark
   │     setWindowOpenHandler ─▶ popup-host.ts ─▶ decidePopup
   │     before-input-event Ctrl/Cmd+D ─▶ bookmark-key event
   │     did-navigate·title·loading·favicon·crash ─▶ shell:browser-state push (favicon은 session.fetch로 받아 data URL)
   │   native 항목 위치: browser/native-bounds.ts(renderer 사각형 → DIP), 붙이기·떼기 규칙은 browser/native-view.ts의 createPlacement, 층은 창마다 하나인 browser/view-order.ts
   session.ts (첫 view나 지우기 때 한 번 설치)
   │   permission ─▶ decidePermission, device 거절 / will-download ─▶ activation.fresh 아니면 거절 / UA·client hints에서 Electron·앱 token 빼기
   bookmark-ipc.ts ── bookmarks.ts ── <dataRoot>/shell/bookmarks.json (atomic write, 0600) ── 바뀌면 모든 창에 shell:bookmarks-changed

 popup: page의 window.open (입력 5000ms 안)
   크기 준 것 ─▶ createWindow의 contents를 native view로 감싸 등록(adopted=false) ─▶ popup event ─▶ renderer가 transient floated 탭을 열고 adopt
                 dock하면 그 탭은 같은 주소의 <webview> 탭으로 다시 열린다
   크기 없는 것(target=_blank) ─▶ deny ─▶ open-tab event ─▶ renderer가 연 탭 바로 뒤에 <webview> 탭
   page의 window.close() ─▶ webContents "close" ─▶ close event ─▶ renderer가 탭을 지운다

 DevTools: ⋯ menu의 Inspector ─▶ devtools.open ─▶ 새 WebContentsView에 setDevToolsWebContents + openDevTools ─▶ "devtools-<page id>"
   자리: 탭 안 오른쪽·아래(경계 막대로 크기) / floated 패널(browser_devtools kind, transient. detached 창의 자리 menu에는 없다) / 따로 뜬 OS 창(devtools.window)
   자리를 바꿀 때 다시 열지 않고 view를 옮긴다

 terminal bridge (shell 탭만, Linux·macOS)
   앱 시작: wiring/coding.ts register ─▶ wiring/bridge.ts createBridgeWiring
     run-dir.ts prepareRunDir: <XDG_RUNTIME_DIR>/lophn 또는 <tmpdir>/lophn-<uid> / <data root sha256 12자> / shell-<pid>/ (0700)
     shim.ts writeShim: browser(sh, 0700: ELECTRON_RUN_AS_NODE=1 exec <execPath> browser.js) · browser.js(0600)
     socket.ts listenBridge: b.sock (0600)
   shell 탭 열기: terminal/ipc.ts open ─ bridge.issue() ─▶ {key(64 hex), env: {BROWSER: <shim>, LPN_BROWSER_BRIDGE: {"socket","key"}}}
     host open 요청의 env ─▶ host가 `terminalEnv`(stripPlatformEnv + `COLORTERM=truecolor`) 뒤에 덮는다(restart도 같은 env) ─ 답이 ok ─▶ bind(key, terminal_ref)
     탭을 닫아 close가 exited ─▶ revoke(terminal_ref)
   child가 $BROWSER <url>:
     shim ─ {v:1,key,url}\n ─▶ b.sock ─▶ bridge.handleLine: parseBridgeRequest → key 표 → 설정(web/local) linkTarget
       browser_tab이면 모든 shell 창에 shell:terminal-bridge-open push
         ─▶ 그 terminal 탭을 가진 창(어느 desk든)의 Workspace(useBridgeOpenRequests)가 browser 탭을 열고 ack
       1500ms 안의 첫 ack ─▶ {"result":"pane"}, 아니면 {"result":"declined"}
     shim: pane이면 끝, 그 밖(declined·접속 실패·3000ms)은 bridge env를 지운 env로 xdg-open/open
   terminal Ctrl/Cmd-click(@xterm/addon-web-links) ─▶ shell:terminal-link ─▶ bridge.openLink: 같은 판정·같은 push, 탭이 안 열리면 main이 OS browser로
```

## 지키는 것

- **navigation 결정은 `main/browser/navigation.ts`의 순수 함수 `decideNavigation` 하나가 한다.** main frame은 http/https(어느 host든, localhost와 사설 IP 포함)와 정확히 `about:blank`만 받는다. 최상위 `data:`·`blob:`은 막는다. subframe은 http/https와 `data:`·`blob:`·`about:`도 받는다. 그 밖의 scheme(`file:`, `lophn-*:`, `chrome:`, `devtools:`, `javascript:`, custom protocol)은 두 frame 모두 막는다. main frame의 userinfo(`user:pass@`) URL은 막는다. 표는 `navigation_test.ts`가 지킨다.
- **`<webview>`는 shell 창(shell renderer)에서만, 우리 설정으로만 붙는다.** `webviewTag`는 shell 창(`main/desktop/window.ts` `windowConfig`)만 켠다: project 창, detached 창, 앱 전용 창(`#app-window=`)이다. secret 입력 창은 끈다. `wiring/browser.ts`의 `will-attach-webview` 하나가 모든 kind를 판정한다. shell 문서(`lophn-shell://desktop`)가 아닌 곳은 거절한다. browser는 `persist:lophn-browser` partition이고 `lophn-*` src가 아닐 때만 받고, 첫 `src`를 `decideNavigation`에 지나게 한다(못 지나면 `about:blank`). 앱·artifact는 registry의 `acceptGuest(window, src)`가 받아 준 그 src·partition일 때만 받고 renderer가 적은 값을 쓰지 않는다. 어느 쪽이든 renderer가 넣은 `preload`·`webpreferences`·`disablewebsecurity`·`nodeintegration`·`useragent`·`allowpopups`를 지우고 hardened `webPreferences`로 덮은 뒤 partition·preload를 다시 넣는다(지우면 guest가 다른 session에 붙는다). 표는 `webview-guest_test.ts`가 지킨다.
- **`mailto:`·`tel:`만 OS로 넘기고, main frame에서 사용자 입력 직후일 때만 넘긴다.** subframe은 조용히 막는다. 주소 칸에 적은 `mailto:`는 page 입력이 아니라서 거절한다.
- **사용자 입력은 contents마다 마지막 mouseDown·keyDown 시각이고, 5000ms 안이어야 fresh다(`activation.ts`).** popup, download, OS 넘기기가 이것을 본다. 시각은 인자(`nowMs`)로 받는다.
- **크기 준 popup만 native view로 받아 `window.opener`를 남긴다.** Electron이 `createWindow`에 준 contents를 그대로 감싸야 opener가 남는다. 표준 Electron에는 그 contents를 `<webview>`에 넣는 길이 없다. popup contents는 opener의 session과 webPreferences를 물려받고 features로 바꾸지 못한다. 입력 없는 popup은 거절하고 `popup-blocked`를 알린다.
- **크기 없는 popup은 거절하고 새 `<webview>` 탭으로 연다.** opener가 끊긴다. Chrome도 `target=_blank`는 기본이 noopener다. 크기 없이 `window.open`을 쓰는 로그인은 깨질 수 있다.
- **popup view는 renderer가 탭을 만들어 adopt하기 전까지 state를 밀지 않는다.** adopt는 소유 창(opener의 창)에서 한 번만 된다. 다른 창은 `invalid_input`, 두 번째는 `forbidden`이다. adopt되지 않은 view는 그 창이 닫힐 때 같이 지운다. popup은 opener 탭을 닫아도 남는다.
- **`<webview>`는 다른 부모로 옮기지 않는다.** 옮기면 guest가 다시 만들어져 page가 다시 load되고 opener가 끊긴다. 창마다 하나인 webview host(`renderer/app-frame/webview-host.tsx`, project 창은 floats 층의 첫 자식)에 탭 key당 한 번 만들고, 탭 자리(pane 칸, floated 패널 몸통)는 사각형만 알린다. pane 탭의 `<webview>`는 z-index 1(pane의 경계 잡는 띠 아래, 패널 모두 아래), floated 탭은 자기 패널 위·다음 패널 아래다(`workspace-layout.md`). 탭이 **모든 desk**의 layout에서 사라지거나 Detach될 때 지운다. 다른 desk로 바꾸는 것만으로는 지우지 않으므로 desk를 떠났다 돌아와도 page를 다시 load하지 않는다.
- **guest의 `view_session`은 `wv-<guest contents id>`다.** main과 renderer가 IPC 없이 같은 이름을 안다(renderer는 `getWebContentsId()`). navigate·command·adopt·DevTools 요청은 caller 창이 그 항목의 창일 때만 받는다.
- **page에는 preload도 IPC도 없다.** 뒤로·앞으로·새로 고침·주소 이동·DevTools는 shell의 머리 줄(주소 칸과 단추)이 main IPC로 시킨다. 주소 칸 글은 main이 `normalizeAddress`·`decideNavigation`을 거쳐 `loadURL`한다.
- **native view(popup, DevTools)는 앱 view registry에 넣지 않는다.** browser registry의 자기 항목이고, 위치는 `browser/native-bounds.ts`가 `browser/native-view.ts`의 `createPlacement`로 정하며 층은 창마다 하나인 `browser/view-order.ts`다. 앱·artifact view는 `<webview>`라 이 표에 없다.
- **모든 browser 탭과 project가 persistent partition 하나(`persist:lophn-browser`)를 같이 쓴다.** 앱 저장소 partition과 나뉘어 page가 앱 화면의 cookie·storage를 보지 못한다. session 설치는 `userData`를 data root로 잡은 뒤 첫 view, 첫 `<webview>` attach, 첫 지우기 때 한 번 한다.
- **permission은 clipboard write(`clipboard-sanitized-write`)를 main frame의 http/https가 요청할 때만 허락한다.** 그 밖(clipboard read, media, 위치, 알림, device)은 모두 거절한다. 표는 `permission_test.ts`가 지킨다.
- **download는 저장 경로를 정하지 않아 Electron 저장 dialog가 뜬다.** 시작한 contents를 모르거나 입력 직후가 아니면 거절한다.
- **UA와 모든 요청 header에서 `Electron/x`와 앱 이름 token을 빼고 client hints를 Chrome처럼 맞춘다.** JS의 `navigator.userAgentData.brands`는 header만으로 고쳐지지 않는다.
- **favicon은 main이 그 page의 session으로 받아 data URL로 바꿔 싣는다.** shell CSP가 `img-src 'self' data: blob:`이고 shell 화면이 인터넷에 직접 요청하지 않는다. image type, 받은 byte 48KB, data URL 65536자까지다. 다른 origin으로 가면 비운다. 탭 favicon은 저장하지 않고, bookmark favicon은 더할 때 한 번 저장한다.
- **Clear browsing data는 `clearStorageData()`를 인자 없이 부르고 cache를 지운 뒤 열린 page를 다시 load한다.** Electron 44의 storage 이름이 rea·Chrome 문서의 이름과 달라 이름을 적으면 덜 지워진다.
- **DevTools는 page마다 새 native view 하나에 붙인다.** `<webview>`는 DevTools를 담지 못한다(frontend가 page에 붙지 않는다). 붙은 view는 탭 안, floated 패널, 다른 OS 창으로 옮겨도 끊기지 않는다. 닫을 때는 view를 부순다. `closeDevTools()` 뒤 같은 view로 다시 열면 붙지 않는다. 열린 상태는 main이 든다(`isDevToolsOpened()`가 이 방식에서는 늘 false다).
- **bookmark는 `<dataRoot>/shell/bookmarks.json` 하나에 main만 쓴다.** 쓰기는 `workspace/atomic-file.ts`(temp 뒤 rename, 폴더 0700·파일 0600)를 layout과 같이 쓰고, promise 줄로 세워 창 둘의 요청이 서로 덮지 않는다. 바뀌면 열린 모든 shell 창에 알린다.
- **깨진 `bookmarks.json`(JSON 아님, schema·version 불일치, 모르는 칸)은 어떤 쓰기도 덮어쓰지 않는다.** 목록은 `corrupt` 상태로 보이고 화면은 고치는 길을 열지 않는다. `bookmarks_test.ts`가 byte 단위로 지킨다.
- **bookmark url은 http/https이고 userinfo가 없는 것만, `href` 완전 일치로 하나만 둔다.** 1000개, title 200자, url 8192자까지다.
- **bridge의 권한 판정은 `main/browser-bridge/policy.ts`의 순수 함수가 한다.** 요청 줄은 JSON 한 줄, `v === 1`, key 64자 hex, 8192 byte 이하만 받는다. browser 탭으로 넘기는 URL은 절대 http/https, userinfo 없음, 8192자 이하다(`isRelayableUrl`). local은 `localhost`·`*.localhost`·`*.local`·loopback·사설·link-local IPv4와 `::1`·`fc00::/7`·`fe80::/10`이다. 표는 `policy_test.ts`, key·설정·ack 조건은 `bridge_test.ts`가 지킨다.
- **`pane`은 "창이 실제로 탭을 열었다"는 뜻이다.** main은 push만 하고 답하지 않는다. 그 terminal 탭을 가진 창의 renderer가 탭을 연 때만 `ackBridgeOpen`을 보내고, 1500ms(shim의 3000ms보다 짧다) 안에 ack가 없으면 `declined`다. Workspace가 없는 때(Settings·app space route)의 URL은 OS browser로 간다. detached 창에는 이 hook이 없지만, 뗄 때의 `terminal_ref`가 project 창의 `TerminalStore`에 남아(`transfer`가 지우지 않는다) project 창이 URL을 자기 focus pane 끝에 browser 탭으로 열고 ack한다. 다시 열어 복원한 detached terminal은 어느 창도 ref를 몰라 `declined`(OS browser)다. 조용히 사라지는 URL은 없다. Ctrl/Cmd-click도 탭이 안 열리면 main이 OS browser로 연다. bridge가 꺼져 있어도(win32, 준비 실패) link는 OS browser로 간다.
- **key는 terminal 탭마다 main이 발급한다.** `issue()`는 key와 env만 만들고, host `open`이 성공해야 `bind`한다. 묶이지 않은 key의 요청은 `declined`다. 탭을 닫아 `close`가 `exited`로 답할 때 `revoke`한다. 비교는 `Map` 조회다. socket이 `0700` 폴더 안의 `0600` file이라 같은 사용자만 닿고, 그 사용자는 env로 key를 이미 안다.
- **env는 `BROWSER`와 `LPN_BROWSER_BRIDGE` 둘이다.** `LOPHN_`로 시작하면 `stripPlatformEnv`가 지운다. host는 strip 뒤에 덮는다. 사용자가 앱 env에 `BROWSER`를 두었으면 넣지 않는다. 그 shell은 key도 없어(`issue()`가 null이라 `bind`하지 않는다) Ctrl/Cmd-click link도 OS browser로 간다. 단 `LPN_BROWSER_BRIDGE`가 같이 있으면 바깥 lophn의 shim이라 덮는다(`bridgeEnv`).
- **shim은 앱이 켜질 때마다 main이 per-run 폴더에 써 넣는다.** sh에 박는 `process.execPath`가 packaged와 dev에서 달라 설치 묶음에 싣지 않는다. Electron을 node로 띄워 사용자 PATH의 `node`를 기대하지 않는다. shim은 URL·key를 출력하지 않고, OS opener에 넘길 때 `BROWSER`·`LPN_BROWSER_BRIDGE`·`ELECTRON_RUN_AS_NODE`를 지운다(안 지우면 `xdg-open`이 shim을 다시 부른다).
- **폴더 자리는 core socket 폴더 규칙을 따른다.** socket 경로가 104 byte 이상이면 bridge를 켜지 않고 로그 한 줄만 남긴다. 앱과 shell 탭은 그대로 뜬다(OS browser). 폴더는 app ready 뒤 single-instance lock을 가진 process만 만든다(두 번째 instance는 ready 전에 `will-quit` 없이 끝나 지울 기회가 없다). 시작할 때 죽은 pid의 `shell-<pid>` 폴더를 지우고, 앱을 끌 때 자기 폴더를 동기로 지운다.
- **link를 열 곳은 core 선언 설정 `shell.browser.web_links`·`shell.browser.local_links`(`browser_tab` | `system_browser`, 기본 `browser_tab`)다.** main이 요청마다 `memory:settings/list`로 읽고, 못 읽으면 기본값이다. Settings › Browser › Links가 고친다. key 글자는 `packages/core/config/shell-settings.ts`와 `policy.ts`의 `LINK_SETTING_KEYS` 두 곳에 있다(shell은 core를 import하지 못한다).
- **여는 자리는 renderer의 `workspace/open-policy.ts`(`openAt`·`showAfter`)가 정한다.** 규칙은 `workspace-layout.md`의 "탭 안에서 연 것의 자리"다. terminal이 보이지 않는 desk에 있으면 그 desk로 넘어가 terminal 탭 바로 뒤에 연다(`openTab`의 `after`가 다른 desk의 탭이면 그 desk로 건너간다). 로그인 URL은 사람이 그 page를 봐야 해서 넘어간다. 그 desk의 view를 hook이 모르므로 반대쪽 pane 규칙은 보이는 desk에만 쓴다. 그냥 click은 text 선택이고 Ctrl/Cmd-click만 link다. OSC 8 자동 링크는 지금도 삼킨다.
- **browser 탭 layout은 `{key, url}`만 저장한다.** title, history, favicon, DevTools 자리는 저장하지 않는다. 다시 열면 그 url을 load한다.

## 왜 이 모양인가

- **보통 탭을 `<webview>`로 바꿨다(사람).** 처음에는 앱 화면과 같이 native `WebContentsView`였다. native view는 shell HTML 위에 그려져 toolbar menu, 별 popover, floated 패널이 page 밑에 깔렸고, 피하려고 page를 숨기거나 줄였다. `<webview>`는 DOM 안에 그려져 그 위에 DOM이 겹친다. ChatGPT desktop도 `<webview>` 탭이지만, popup을 `<webview>`에 adopt하는 것은 고친 Electron(`_createWebViewAdoptionLease`)으로 한다(rea `analysis/embedded-browser-reverse-engineering.md` 1.3). 표준 Electron에는 그 길이 없어 크기 준 popup만 native로 남겼다.
- **앱 화면과 artifact 화면도 이 그릇을 쓴다(사람, 2026-10-31).** 같은 겹침 문제를 갖고 있어서 한 그릇으로 모았다. 그래서 native view의 층 순서는 browser의 popup·DevTools만의 것이고, 앱 view와 같이 쌓던 `appViewOrder`는 없다(`workspace-layout.md`).
- **규칙을 rea `desktop-embeded-browser`에서 TS로 옮겨 짰다.** library를 dependency로 넣지 않았다. CommonJS 그대로는 Result·Clock 같은 lophn 규칙과 맞지 않는다.
- **localhost와 사설 IP를 막지 않는다.** 가장 많이 쓸 곳이 사람의 dev server다. core API는 token으로 막혀 있다.
- **subresource 요청 guard(`webRequest.onBeforeRequest`)는 두지 않는다.** 이 partition에는 `lophn-shell`·`lophn-app` protocol handler가 없어 그 요청은 어차피 실패한다.
- **tab 수 cap을 두지 않는다.** pane 탭 상한 200개가 이미 있다.
- **머리 줄의 bookmark menu와 card 밖 줄의 ⋮ menu는 overlay view로 띄운다.** card의 ⋯ menu는 DOM이라 열려 있는 동안 탭이 native view(DevTools 자리, popup)를 숨긴다(`menu.onOpenChange`). native popup 탭과 DevTools 위에서도 보여야 해서 한 길로 둔다. menu·popover의 overlay view는 창 본문 전체를 덮고(`ipc/overlay.ts`의 `fullBody`) 부르는 쪽은 trigger 사각형을 보낸다. 별 popover는 `<webview>` 탭에서는 DOM popover(이름 칸과 [Remove])이고, native popup 탭에서는 overlay(이름과 [Remove])다.
- **DevTools 경계 막대는 DOM drag다.** 끄는 동안 투명한 막을 page 위에 덮고 DevTools native view를 숨긴다. native view는 pointer를 삼킨다. overlay drag 표면으로 한 시도는 press가 shell에서 시작해 움직임을 받지 못했다.
- **page에 focus가 있을 때 Ctrl/Cmd+D는 main이 `bookmark-key` event로 보낸다.** 작업대 단축키 표에 넣지 않는다. terminal의 Ctrl+D(EOF)와 부딪힌다.
- **다른 OS 창으로 탭을 옮기면 `<webview>` 탭(browser·앱·artifact)은 다시 load되고 그 탭의 DevTools는 닫힌다.** `<webview>`는 그것을 띄운 page에 묶인다. 다시 load 없이 옮길 수 있는 것은 native 항목(popup, DevTools)뿐이고, 그 소유 창은 `registry.ts` 항목의 `window`다. Detach·Dock이 `moveViews`로 이 `window`를 바꾸므로 popup의 adopt·요청 검사는 옮긴 뒤의 창을 기준으로 한다(`workspace-layout.md`). 앱·artifact 탭은 보내는 창이 element를 지우고 받는 창이 새 view를 연다.
- **bridge에 ack를 두었다.** push만 하고 `pane`으로 답하면 그 terminal의 Workspace가 마운트되지 않은 때(Settings·app space route, 닫힌 창) URL이 조용히 사라진다. OAuth 로그인 URL을 잃으면 사람이 다시 할 길이 없다.
- **bridge는 `desktop/main.ts`가 아니라 `wiring/coding.ts`가 만든다.** terminal IPC가 만들어지는 곳이다.
- **설정은 renderer가 밀어 넣지 않고 main이 요청마다 읽는다.** 낡은 값을 들 일이 없고, terminal link도 main을 거치므로 판정이 한 곳이다.
