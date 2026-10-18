# browser tab: workspace pane에서 web page를 연다

상태: 로드맵. 아직 계획으로 열지 않았다. 2026-10-18 planner와 사람이 정했다.
배경 문서: `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/coding-agent.md`(terminal 탭 TUI), AGENTS.md "속도"·"호환성".
가져올 것: `../rea/project/desktop-embeded-browser`. ChatGPT·Claude desktop의 embedded browser를 분석하고(`analysis/`), 같은 동작을 Electron 44.5.1 위에 clean-room으로 다시 짠 CommonJS library다(`src/`, 2096줄). 아래에 필요한 사실을 path와 숫자로 옮겨 두었다.

## 왜

- workspace에는 terminal, document editor, app panel 같은 탭 kind가 8개 있다. 그런데 web page를 여는 kind는 없다. terminal에서 `vite`를 띄우거나 `gh auth login`을 하면 OS browser로 넘어가서, lophn 창과 browser 창을 오가야 한다.
- terminal의 child process가 여는 URL은 `$BROWSER`를 보지만 lophn은 이것을 다루지 않는다(packages/와 project-docs/ grep 결과 0건).
- lophn은 Electron 44.5.1을 쓰고, app 화면을 이미 `WebContentsView`로 pane 위에 겹쳐 띄운다. 그래서 browser는 탭 kind 하나를 더하고 그 view 길을 다시 쓰면 된다.

## 지금 코드

### lophn

- **탭 kind.** `document_editor`, `terminal`, `app_panel`, `contexts`, `context`, `search`, `agents`, `agent` 8개다.
  - main: `packages/shell/main/workspace/kinds/registry.ts`의 `BUILT_IN_TAB_KINDS`. kind마다 `defineTabKind`(`kinds/kind.ts`)로 strict zod `layout`과 `restore`를 둔다.
  - renderer: `packages/shell/renderer/workspace/kinds/registry.ts`. `TabKindDef`에 `render`, `keep`(안 보일 때도 mount를 유지), `beforeClose`, `fromStored`/`toStored`, `hasAppView`가 있다.
  - kind 하나를 더하려면 `kinds/<kind>.ts`와 `kinds/<kind>.tsx`를 쓰고, registry 둘에 한 줄씩 넣고, `packages/shell/renderer/workspace/add-tab-menu.tsx`를 고친다. 이 menu는 registry를 보지 않고 항목을 직접 적는다(Document, Terminal, Agent, Context, Search, App panel).
- **layout.** sidebar와 pane 최대 2개이고, pane마다 탭 줄이 있다(`renderer/workspace/model.ts`의 `WorkspaceView`, `PaneState`, `PANE_MIN` 480px). project별로 `<home>/shell/layout.json`에 저장한다(`main/workspace/layout-store.ts`, schema는 `main/workspace/schema.ts`, `LAYOUT_SCHEMA_VERSION = 1`, pane 하나에 탭 200개까지). 읽을 때 등록되지 않은 kind는 `skipUnregisteredTabs`가 건너뛴다.
- **native view 길(app panel).** `main/app-frame/`(27 file, 5066줄)이 맡는다.
  - `electron-app-frame.ts:49-98`: `WebContentsView`를 `window.contentView.addChildView`로 붙이고, app마다 partition, `preload-app`, navigation guard(`will-navigate`, `will-frame-navigate`, `will-redirect`)를 둔다.
  - 위치: `placement.ts`(첫 load 뒤에 붙이고, 숨기면 떼고 `generation`을 올린다), `visibility.ts`(16ms 묶음, CSS px를 DIP로 바꾸고 창 body로 자른다). renderer 쪽은 `renderer/app-frame/embedded-view.tsx`(ResizeObserver → `shell:view-bounds`)다.
  - native view는 DOM 위에 그려지므로 menu, toast, modal은 따로 `WebContentsView`를 띄워 위로 올린다(`overlay.ts`, `view-order.ts`).
  - session: `session-policy.ts`(permission 거절, `will-download`, `webRequest`, `lophn-app` scheme), `network-policy.ts`(https/wss이고 허락한 host만 가능, 자기 scheme 밖으로는 navigate하지 못함).
  - 그 밖에 crash·unresponsive 처리와 `capturePage`(PNG, 긴 변 1600px)가 있다.
- **보안 기본값.** `main/desktop/security.ts`의 `webPreferences(packaged)`를 모든 창과 view가 같이 쓴다: `sandbox`, `contextIsolation`, `webSecurity`, node 없음, `webviewTag:false`. 모든 contents에 `setWindowOpenHandler(() => deny)`와 `will-attach-webview` preventDefault가 걸려 있다.
- **OS browser로 보내기.** shell chrome은 `shell:open-external`(`main/desktop/open-external.ts`), app view는 `app:open-external`(`main/app-frame/external-link.ts`)를 쓴다. http/https만 받고, userinfo를 거절하고, 8192자까지만 받는다. 확인 없이 OS browser를 연다.
- **terminal.** Electron main → Node terminal host(`spawnNodeHost`, `main/terminal/supervisor.ts:249`. `process.execPath`를 `ELECTRON_RUN_AS_NODE=1`로 띄운다) → node-pty(`terminal-host/pty.ts:55`).
  - shell 탭 env는 `stripPlatformEnv(process.env)`다(`terminal-host/main.ts:242`). coding 탭은 여기서 `plan.env_delete`를 빼고 `plan.env`를 덮는다(`terminal-host/launch-plan.ts`).
  - `stripPlatformEnv`(`terminal-host/env.ts`)는 `LOPHN_`·`ELECTRON_`로 시작하는 이름, secret처럼 보이는 이름, `127.0.0.1:<port>`가 든 값을 뺀다. 그래서 `$BROWSER` 값은 strip이 끝난 뒤에 넣어야 한다.
  - xterm은 link handler를 일부러 두지 않고, OSC 8과 OSC 52를 삼킨다(`renderer/terminal/xterm-view.ts`). terminal에서 URL을 눌러도 아무 일이 없다.
- **문서.** shell·pane·desktop을 다루는 architecture 문서가 없다. boundary는 `shell` 하나다(`boundary-catalog.yaml:142`, `module-catalog.yaml:84-99`).

### desktop-embeded-browser

- `src/main/tabs.js` `BrowserTabs`: tab마다 `WebContentsView` 하나를 둔다. 모든 tab이 Electron session 하나를 같이 쓴다. navigation(main frame, subframe, redirect), popup, tab cap, OS로 넘기기를 이 class가 혼자 맡는다.
- `src/main/policy.js`: Electron을 import하지 않는 순수 함수다. `decideNavigation`, `decidePopup`, `decidePermission`, `isRelayableUrl`, `parseBridgeRequest`가 `{ action, reason }`을 돌려준다. 상수: popup activation 5000ms, tab 8개, bridge 요청 8KiB, 응답 1KiB, timeout 3000ms.
- `src/main/session.js`, `session-prefs.js`: permission은 기본 거절이고 clipboard write만 허락한다. download는 기본 거절이다. UA와 client hints에서 `Electron/x.y.z`와 product token을 뺀다.
- `src/main/bridge.js` + `src/shim/browser-shim.js`: `$BROWSER` bridge다.
  - shim은 sh/Node polyglot이다. http/https만 넘기고, userinfo가 있는 URL과 `file:`은 OS opener로 보낸다. OS opener를 부를 때는 bridge env를 지운다.
  - 서버는 unix socket(`0700` 폴더, `0600` socket)에 JSON 한 줄씩 `{v:1, key, url}` → `{result: "pane" | "declined"}`로 주고받는다.
  - key는 32 byte 무작위 값이다. `timingSafeEqual`로 비교하고 저장하지 않는다.
- `src/main/sandbox.js`: 로컬 문서용으로 봉한 partition이다. custom scheme으로 고정한 root에서만 읽고(`realpath` 안쪽인지 검사), CSP `connect-src 'none'`을 붙이고, 죽은 proxy로 network를 끊는다.
- `src/main/policy-settings.js`: site allow/block list, capability 4개(browse, download, upload, cdp)별 승인, storage mode 3개.
- `src/preload/guest.js`: page에 `embeddedBrowser` 동사 6개를 연다.
- `analysis/browser-settings.md`: 두 app의 browser 설정을 모두 모은 표다.
  - **ChatGPT**: 설정 화면 `/settings/browser-use`에 설정이 16개 있다.
    - link를 어디서 열지(`open-link-in-target-preference`)와 local URL을 어디서 열지(`open-local-url-in-target-preference`)가 따로다. 둘 다 `in-app-browser` | `external-browser`이고 기본은 `in-app-browser`다.
    - download 폴더, "Ask where to save downloads"(기본 꺼짐), "Show full URL"(기본 꺼짐)이 있다.
    - agent용 site 승인 matrix: 열이 browse, download, upload, CDP 넷이다.
    - browsing data 지우기는 종류를 정해 지운다. `cookies`, `siteData`, `cache`, `downloads`에 history를 더하거나 뺀다. `siteData`는 `fileSystems`, `indexedDB`, `localStorage`, `webSQL`, `serviceWorkers`로 풀린다.
    - 사이트 설정, password, 주소, extension은 `chrome://` page를 따로 만든 partition에 그대로 띄운다. 문서는 이것을 "liability"라고 본다.
    - browser view는 `devTools: true`로 붙인다.
  - **Claude**: desktop에 browser 설정 화면이 없다.
    - partition 수명 `launchPreviewStorage`(`none` | `shared` | `session`)가 있다.
    - 관리자 policy key 4개: 켜기, 기본 site policy, 허락 목록, 막는 목록(각 500개까지). policy를 못 읽으면 `["*"]`, 곧 모두 막는다.
    - localhost는 목록에 넣어도 지운다. "localhost dev servers are never blocked".
    - 나머지는 설정이 아니라 고정된 확인 문구다. `@` 앞에 진짜 목적지를 숨긴 link 경고, local network 이름 경고가 있다.
- **lophn 설정 길.** core가 `declareSetting`으로 설정 key를 선언한다(`packages/core/config/shell-settings.ts`에 `shell.*` 10개). shell은 `memory:settings/list`와 `memory:settings/update`로 읽고 쓴다.
  - General은 `shell.*`를 보이지 않는다(`renderer/desktop/settings/general/model.ts`의 `SHOWN_ELSEWHERE`). Appearance처럼 따로 만든 pane이 보인다(`SettingsPane`, `renderer/desktop/settings/model.ts`).
  - main은 renderer가 IPC로 보낸 값을 검사해서 쓴다(`main/desktop/wiring/appearance.ts`). 그 CSS는 `lophn-shell:`과 `lophn-app:` 문서에만 넣는다. 그래서 browser page에는 들어가지 않는다.
  - Chromium userData는 `<dataRoot>/shell/browser`다(`main/desktop/paths.ts:48` `browserDataPath`). persistent partition도 그 아래에 생긴다.
- `test/`: Node test 61개와 Electron check 5개.

## 무엇을 만드나

### 1. browser 탭 kind (shell)

- **kind `browser`.** layout은 `{key, url}`이다. 다시 열면 `url`을 load한다. title과 history는 저장하지 않는다.
  - icon은 lucide `Globe`, 탭 이름은 page title이다(없으면 host).
  - `keep()`을 쓴다. 다른 탭으로 가도 page가 살아 있다(app panel과 같다).
- **view.** `WebContentsView` 하나다. `main/app-frame/`의 placement, visibility, overlay 순서, crash 처리, bounds relay를 그대로 쓴다. 새로 짜지 않는다.
  - preload는 없다. `webPreferences`는 `security.ts` 것을 쓴다.
  - 뒤로, 앞으로, 새로 고침은 탭 위의 shell DOM toolbar가 main IPC로 시킨다. guest preload(`embeddedBrowser`)는 가져오지 않는다.
- **toolbar.** 뒤로, 앞으로, 새로 고침, 주소 칸, [Open in browser](`shell:open-external`)가 있다.
  - 주소 칸에 scheme 없이 적으면 `https://`를 붙인다. `localhost`와 `127.0.0.1`은 `http://`를 붙인다.
  - 검색어 처리는 하지 않는다.
- **열기.** 새 탭(+) menu에 Browser를 더한다. 빈 주소 칸으로 열리고 focus가 그 칸에 간다.
- **session.** 모든 browser 탭이 persistent partition 하나를 같이 쓴다(`persist:lophn-browser`). app view partition과 나누므로, browser page는 app 화면의 cookie와 storage를 보지 못한다.
- **navigation.** http/https는 어느 host든 허락한다. localhost와 사설 IP도 허락한다.
  - main frame은 http/https와 `about:blank`(popup)만 받는다. 최상위 `data:`, `blob:` navigation은 막는다(Chrome과 같다).
  - subframe과 subresource는 `data:`, `blob:`, `about:`도 받는다. 실제 site가 쓴다(rea `requests.js`의 `ALLOWED_OPAQUE_SCHEMES`).
  - 그 밖의 scheme(`file:`, `lophn-*:`, `chrome:`, `javascript:`, custom protocol)은 막는다. `mailto:`, `tel:`은 사용자 입력 뒤에만 OS로 넘긴다.
  - 결정은 `policy.js`처럼 순수 함수 하나가 `{allow, reason, external?}`로 낸다.
- **popup.** browser 탭 안의 page가 `window.open`이나 `target=_blank`로 새 창을 여는 것이다. terminal의 CLI가 URL을 여는 것(2)과는 다르다.
  - 사용자 입력 뒤 5000ms 안에 생긴 것만 받는다. 입력이 없었던 popup은 거절하고 탭 toolbar에 한 줄로 알린다.
  - `createWindow`로 새 view를 만들어 돌려준다. 그래야 `window.opener`가 남아 OAuth popup 로그인이 동작한다(ChatGPT의 adoption 방식).
  - `window.open`의 `features`에 `width`, `height`가 있으면 그 크기의 floated browser 탭으로 연다(`workspace-float.md`). 없으면 연 탭과 같은 pane에서 그 탭 바로 뒤에 docked 탭으로 연다. `target=_blank` link가 여기에 든다.
  - page가 `window.close()`를 부르면 그 탭을 닫는다. popup으로 생긴 floated 탭은 `layout.json`에 저장하지 않는다. 사용자가 dock하면 그때부터 보통 탭이다.
- **permission.** 기본은 거절이다. clipboard write는 사용자가 연 main frame에서만 허락한다. clipboard read, 카메라, 마이크, 위치, 알림은 거절한다.
- **UA.** session UA와 모든 요청에서 `Electron/x.y.z`와 `lophn/x.y.z`를 빼고, client hints도 같이 맞춘다. 빼지 않으면 Google 로그인 같은 곳이 막는다.
- **download.** Electron 기본 저장 dialog를 띄운다. 사용자 입력 뒤 5000ms 밖에 시작한 download는 거절한다.

### 2. `$BROWSER` bridge (shell, terminal-host)

- **shim.** shell 탭과 coding 탭의 env에 `BROWSER=<shim path>`를 넣는다. shell 탭은 `stripPlatformEnv` 뒤에 넣고, coding 탭은 `plan.env` 뒤에 넣는다. 사용자가 env에 `BROWSER`를 이미 두었으면 건드리지 않는다.
  - shim은 sh script다. 사용자 PATH에 `node`가 있는지 기대하지 않는다. 대신 `ELECTRON_RUN_AS_NODE=1`로 lophn의 Electron(`process.execPath`)을 띄워 JS 본문을 돌린다(terminal host와 같은 방식).
  - 보내는 URL은 절대 http/https이고 userinfo가 없는 것뿐이다. 나머지와 bridge 실패는 OS opener(`xdg-open`, `open`)로 보내고, 그때 bridge env를 지운다.
- **서버.** Electron main에 unix socket 하나를 둔다. protocol, 크기 한도, timeout, key 비교는 rea의 `bridge.js`를 따른다.
  - key는 terminal 탭마다 하나를 발급한다. 탭을 닫으면 버린다. 그래서 어느 terminal이 열었는지 안다.
  - 여는 자리: pane이 둘이면 terminal 반대쪽 pane에 열고, 하나면 같은 pane에서 terminal 바로 뒤에 열어 고른다. terminal이 floated이거나 detached이면 project 창의 focus pane에 연다.
  - socket 경로와 key를 담는 env 이름에는 `LOPHN_`을 쓰지 않는다. strip에 걸리기 때문이다. 예: `LPN_BROWSER_BRIDGE`.
- **terminal link.** xterm에 http/https link handler를 단다. Ctrl/Cmd-click은 browser 탭으로 연다. OSC 8은 지금처럼 삼킨다.
- Windows는 하지 않는다. Windows의 shell 탭은 지금처럼 OS browser를 쓴다.

### 3. 로컬 HTML 미리 보기 (나중)

- document editor에서 project 안의 `.html`을 browser 탭으로 연다. 봉한 partition(rea `sandbox.js`)에서 project root 밖은 읽지 못하고 network도 없다.
- 1, 2가 쓰인 뒤에 따로 계획으로 연다. 지금 쓰는 길(vite 같은 dev server)은 1로 된다.

### 4. 설정 (core 선언, shell)

- **link를 열 곳.** 선언 설정 둘이다. 값은 `browser_tab` | `system_browser`이고, 둘 다 기본은 `browser_tab`이다(ChatGPT와 같다).
  - `shell.browser.web_links`: 공개 web URL.
  - `shell.browser.local_links`: localhost, `*.localhost`, `127.0.0.0/8`, `::1`, 사설 IP, `.local`. rea `policy.js`의 `PRIVATE_HOST_PATTERNS`를 따른다.
  - 이 설정은 `$BROWSER` bridge와 terminal Ctrl/Cmd-click에 쓴다. `system_browser`이면 bridge 서버가 `declined`로 답하고, shim이 OS opener로 연다.
  - renderer가 값을 읽어 main에 IPC로 보낸다(appearance와 같은 길). 값을 못 읽으면 기본값을 쓴다.
  - 예: `gh auth login`은 이미 로그인된 OS browser로 보내고, `vite`는 browser 탭에 띄우려면 web은 `system_browser`, local은 `browser_tab`으로 둔다.
- **Settings에 Browser pane.** `SettingsPane`에 `browser`를 더한다. 담는 것:
  - 위 두 설정. Select로 고른다.
  - [Clear browsing data]: 확인 dialog를 띄운 뒤 `persist:lophn-browser`의 storage 전부(`clearStorageData()`를 인자 없이)와 cache를 지운다. rea가 쓴 storage 이름(`fileSystems`, `indexedDB` 등)은 Electron 44.5.1의 이름(`filesystem`, `indexdb`, `localstorage`, `serviceworkers`, `cachestorage`, `shadercache`)과 다르다. 열린 browser 탭은 다시 load한다. IPC 하나로 main이 한다.
- **DevTools.** browser 탭 toolbar의 overflow menu에 Inspect를 둔다. 누르면 `openDevTools({mode: "detach"})`다.
  - browser view만 packaged에서도 `devTools: true`다. 다른 view는 `security.ts`의 `!packaged`를 그대로 따른다.
- **dark mode.** `nativeTheme.themeSource`가 lophn theme을 따르므로, browser page의 `prefers-color-scheme`도 lophn theme을 따른다. 따로 만들 것은 없다.

### 5. bookmark (shell)

- **저장.** `<dataRoot>/shell/bookmarks.json` 파일 하나다. 모든 project가 같이 쓴다.
  - main이 갖고, renderer는 IPC로 읽고 바꾼다. 창이 여럿이어도 저장하는 곳이 하나다.
  - 쓰기는 `main/workspace/layout-store.ts`와 같다: atomic write, 0600.
  - 파일이 깨져 있으면 덮어쓰지 않는다. bookmark 화면에 오류를 보이고, 고치기 전까지는 더하거나 바꾸지 못한다.
  - 항목은 `{id, title, url, created_at}`이다. id와 시각은 `IdSource`, `Clock`으로 받는다(AGENTS.md "코드").
  - http/https URL만 받고, 같은 URL은 하나만 둔다. 상한은 1000개, title 200자, URL 8192자다.
- **더하기.** 주소 칸 끝의 별 단추를 누른다. 지금 page의 title과 URL로 더한다.
  - 이미 있는 page면 별이 채워져 보인다. 누르면 popover가 열려 title을 고치거나 [Remove]할 수 있다.
  - 단축키 Ctrl/Cmd+D.
- **열기.** 세 곳에서 연다.
  - toolbar의 bookmark 단추가 menu로 목록을 보인다. 누르면 지금 탭에서 열고, Ctrl/Cmd-click이면 새 browser 탭에서 연다.
  - 빈 주소 칸으로 연 새 browser 탭에 bookmark 목록을 보인다.
  - 명령 palette에 bookmark를 이름으로 찾는 항목을 더한다. 고르면 새 browser 탭에서 연다.
- **고치기.** Settings의 Browser pane에 목록을 둔다. 줄마다 title, URL, [Edit], [Remove]가 있다.
- 순서는 더한 순서다. folder, 끌어서 순서 바꾸기, favicon은 없다. icon은 `Globe`다.

### 6. shell

- Settings의 Browser pane.
- **wireframes gallery.** `tools/wireframes/pages/screens/project-workspace.tsx`에 다음을 더한다.
  - browser 탭(toolbar, page 자리)
  - 빈 주소 칸
  - popup 거절 안내
  - OAuth popup으로 뜬 floated browser 탭
  - Settings의 Browser pane, Clear browsing data 확인 dialog
  - toolbar overflow menu(Inspect)
  - 별 단추(빈 것, 채운 것)와 bookmark popover, toolbar bookmark menu
  - bookmark 목록이 있는 새 browser 탭, palette의 bookmark 항목
  - Settings Browser pane의 bookmark 목록, 파일이 깨졌을 때의 오류
  - terminal 옆 pane에 bridge로 열린 browser 탭
  - 새 탭 menu의 Browser
- **문구.** toolbar 단추, 주소 칸 placeholder, 거절 안내는 `wording` skill을 따른다.

## 정한 것

- browser는 새 탭 kind이고, terminal·editor와 같은 pane에 들어간다(사람).
- `desktop-embeded-browser`를 dependency로 넣지 않는다. 규칙을 `packages/shell/main/browser/`에 TS로 옮겨 짠다(agent). library는 `BrowserTabs`가 창과 tab 줄을 혼자 맡지만, lophn에는 placement·overlay·bounds 길이 이미 있다. CommonJS를 그대로 넣으면 Result, Clock 같은 lophn 규칙(AGENTS.md "코드")과 맞지 않는다.
- `<webview>`를 쓰지 않고 `WebContentsView`를 쓴다(agent). `webviewTag:false`와 `will-attach-webview` 거절을 그대로 둔다. rea 분석에서도 Claude desktop이 이 방식이고, renderer가 guest를 만들 길이 아예 없다.
- guest preload를 두지 않는다(agent). 뒤로, 앞으로, 새로 고침은 shell toolbar가 맡는다. 인터넷 page에 열린 IPC가 0개다.
- partition은 persistent 하나를 모든 탭과 project가 같이 쓴다(agent, rea와 같다). 한 번 로그인하면 남는다. tab마다, project마다 partition을 두면 cookie jar가 끝없이 늘어난다(rea `clean-room.md`).
- localhost와 사설 IP를 막지 않는다(agent). 가장 많이 쓸 곳이 사용자의 dev server다. core API(`127.0.0.1:<apiPort>`)는 token으로 막혀 있다(`main/desktop/core/client.ts:210`). 그래서 OS browser에서 같은 page를 여는 것보다 위험이 늘지 않는다.
- popup은 `createWindow`로 받아 `window.opener`를 남긴다(agent). rea `tabs.js`는 popup을 거절하고 새 tab을 따로 load해서 opener가 끊긴다. 그러면 GitHub, Google OAuth popup 로그인이 깨진다.
- 크기를 준 popup은 floated 탭으로 연다(사람). OAuth popup이 Chrome의 작은 로그인 창처럼 보이고, 접거나(minimized) dock할 수 있다.
- browser 탭도 다른 kind처럼 floated, minimized, detached가 된다(사람, `workspace-float.md`). browser에만 따로 만드는 것은 없다.
- tab 수 cap(rea 8개)을 두지 않는다(agent). pane 탭 상한 200개가 이미 있다.
- site list, capability별 승인, storage mode(`policy-settings.js`)는 가져오지 않는다(agent). 관리자 policy가 필요한 제품이 아니고, 사용자 한 사람이 쓰는 prototype이다.
- bridge shim은 Electron을 node로 띄운다(agent). rea shim은 PATH의 `node`를 찾고, 없으면 OS opener로 떨어진다. lophn은 terminal host를 이미 같은 방식으로 띄운다.
- terminal link는 Ctrl/Cmd-click만 browser 탭으로 연다(agent). 그냥 click은 text 선택과 부딪친다(VS Code, iTerm과 같다).

- download는 저장 dialog로 받는다(agent). 사용자가 고르기 전에는 아무것도 저장되지 않는다. 모두 막으면(rea 기본값) dev server의 결과를 받을 때마다 OS browser로 옮겨야 한다. 인터넷 page가 입력 없이 dialog를 띄우는 것은 activation 창으로 막는다.
- browser 설정은 link를 열 곳 둘, browsing data 지우기, DevTools뿐이다(agent). rea가 모은 설정 가운데 사용자 한 사람이 dev server와 로그인에 쓰는 데 필요한 것만 골랐다.
  - web과 local을 나눈 것은 ChatGPT를 따랐다. 이미 로그인된 OS browser로 보낼 web link와 탭에 띄울 dev server가 갈린다.
  - 지우기 단추를 둔 것은 partition을 persistent 하나로 정했기 때문이다. 로그인이 꼬이면 사용자가 풀 길이 있어야 한다. history는 모으지 않으므로, 종류를 고르지 않고 한 묶음으로 지운다.
  - DevTools를 둔 것은 사용자의 dev server page를 보는 것이 이 탭의 주된 쓰임이기 때문이다. DevTools가 닿는 것은 그 page뿐이다.
- 가져오지 않은 rea 설정과 이유(agent):
  - "Show full URL": 주소 칸은 늘 전체 URL을 보인다.
  - download 폴더, "Ask where to save": 늘 저장 dialog를 띄운다.
  - storage mode(`none` | `shared` | `session`): partition은 persistent 하나다.
  - site allow/block 목록, 기본 site policy, 관리자 policy, fail-closed 값: 관리자가 있는 제품이 아니다.
  - capability별 승인(browse, download, upload, CDP): agent가 browser를 다룰 때의 승인이다. 그 roadmap에서 lophn 승인(`project-docs/architecture/approval.md`)으로 다시 본다.
  - `chrome://` 설정 page, password manager, 주소 자동 완성, extension: Electron에 password manager가 없고, `chrome://` page를 띄우는 것은 rea 분석도 liability로 본다. 로그인은 cookie로 남는다.
  - Chrome profile 가져오기, debug `chrome://` page, WebMCP, annotation screenshot 설정, history 접근.
- bookmark를 둔다(사람).
- bookmark는 shell 파일 하나에 저장하고 main이 갖는다(agent). browser는 shell만 쓰는 것이라 core protocol을 바꿀 까닭이 없다. 선례 `layout.json`과 같은 꼴이다. 깨진 파일을 덮어쓰지 않는 것은 사람이 모은 목록을 잃지 않으려는 것이다.
- bookmark는 project마다 나누지 않는다(agent). partition과 로그인이 모든 project에 하나이므로 bookmark도 하나다.
- folder, 가져오기(Chrome, HTML), 동기화는 하지 않는다(agent). 목록이 길어지면 palette로 이름을 찾아 연다.
- bridge가 여는 자리는 terminal 반대쪽 pane, pane이 하나면 terminal 바로 뒤다(agent). `vite`를 띄우면 page가 terminal 옆에 보인다. pane을 lophn이 나누지 않는다. 사용자가 정한 layout을 바꾸지 않으려는 것이다.

## 단계

`workspace-float` 계획(`workspace-float.md`)이 land된 뒤 계획 둘로 연다. popup이 floated 탭으로 태어나고, floated 층의 native view 순서를 그 계획이 만든다.

1. **`browser-tab`**: 탭 kind, view, toolbar, session, navigation·popup·permission·UA, download, 새 탭 menu, Settings의 Browser pane과 Clear browsing data, DevTools, bookmark, gallery(1, 4의 지우기·DevTools, 5, 6).
   - navigation과 popup 결정 함수를 첫 task로 둔다. 다른 task가 모두 이것을 부른다.
2. **`browser-bridge`**: shim, socket 서버, terminal 탭별 key, env 주입, 여는 자리, terminal link, link를 열 곳 설정 둘, gallery의 bridge 상태(2, 4의 link 설정).

3(로컬 HTML 미리 보기)은 2가 끝난 뒤 다시 본다.

test(AGENTS.md "속도", `write-test` skill):
- 순수 함수 몇 개만 둔다: navigation(scheme 거절, OS로 넘기기), popup(activation 창), bridge 요청 parse와 key 거절, `isRelayableUrl`. 인터넷 page와 child process에서 들어오는 경계다.
- bookmark 저장: 깨진 파일을 덮어쓰지 않는다. 사람이 모은 data를 잃는 길이다.
- rea의 Electron check(`runtime-check.js`, `bridge-e2e.js`)처럼 Electron이나 child process를 띄우는 test는 새로 만들기 전에 사람에게 묻는다.

계획마다 끝에 고칠 것:
- `project-docs/architecture/browser-tab.md`를 새로 쓴다: view 길, session과 navigation 규칙, bridge 흐름, 지키는 것. `project-docs/context-component-registry.yaml`에 올린다.
- `project-docs/architecture/coding-agent.md`: coding 탭 env에 `BROWSER`가 들어가는 것.
- changelog 열린 판.
- 이 문서에서 그 계획 몫을 지운다.

## 끝남 기준

- 새 탭 menu에서 Browser를 열어 `https://github.com`에 로그인하고 lophn을 다시 띄워도 로그인이 남아 있고, 탭도 같은 URL로 돌아온다.
- terminal에서 `npx vite`가 낸 `http://localhost:5173`을 Ctrl-click하면 browser 탭에 page가 뜬다.
- terminal에서 `gh auth login --web`을 하면 OS browser가 아닌 browser 탭에 GitHub 화면이 뜨고, 로그인이 끝난다.
- "Sign in with Google"을 누르면 floated browser 탭이 뜨고, 로그인을 끝내면 그 탭이 닫히고 원래 탭이 로그인된다.
- browser 탭에서 `file:///etc/passwd`, `lophn-app://...`로 가는 navigation이 막힌다. 사용자 입력 없는 `window.open`도 막힌다.
- 사용자가 env에 `BROWSER`를 둔 경우와 bridge가 꺼진 경우에는, terminal의 URL이 지금처럼 OS browser로 간다.
- web link를 `system_browser`로 두면 `gh auth login`이 OS browser로 가고, `vite`의 localhost link는 그대로 browser 탭에 뜬다.
- page에서 Ctrl/Cmd+D를 누르면 별이 채워진다. lophn을 다시 띄워도 그 bookmark가 toolbar menu, 새 browser 탭, palette에 있다. 다른 project 창에서도 보인다.
- Clear browsing data를 하면 github.com 로그인이 풀린다. Inspect를 누르면 그 page의 DevTools가 뜬다.

## 하지 않는 것

- agent가 browser 탭을 보거나 다루기(CDP, `capturePage`를 agent tool로 주기, annotation을 browser page로 넓히기). browser 탭이 쓰인 뒤 따로 roadmap을 쓴다.
- site allow/block list, capability별 승인, 관리자 policy, storage mode(rea `policy-settings.js`).
- 방문 기록, 주소 칸 검색과 자동 완성, page 안 찾기, 확대·축소 UI.
- bookmark folder, bookmark bar, 가져오기와 내보내기, favicon.
- 위 "정한 것"에서 가져오지 않기로 한 rea 설정.
- 탭 하나 안의 여러 tab(rea `BrowserTabs`의 tab 줄). lophn은 pane의 탭 줄을 쓴다.
- Windows `$BROWSER` bridge.
- shell chrome과 app view의 `open-external`을 browser 탭으로 돌리기. 지금처럼 OS browser로 간다.
- 사용자 입력 없이 오래 숨은 page를 suspend하기(ChatGPT의 32 page 예산).
