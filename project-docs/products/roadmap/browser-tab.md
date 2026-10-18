# browser tab: workspace pane에서 web page를 연다

상태: 로드맵. 1단계 `browser-tab`이 land했다(browser 탭 kind, `<webview>` page, popup, session·navigation 규칙, DevTools, bookmark, favicon, Settings Browser pane. `project-docs/architecture/browser-tab.md`). 남은 것은 2단계 `browser-bridge`와 3이다.
배경 문서: `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/coding-agent.md`(terminal 탭 TUI), AGENTS.md "속도"·"호환성".
가져올 것: `../rea/project/desktop-embeded-browser`. ChatGPT·Claude desktop의 embedded browser를 분석하고(`analysis/`), 같은 동작을 Electron 44.5.1 위에 clean-room으로 다시 짠 CommonJS library다(`src/`, 2096줄). 아래에 필요한 사실을 path와 숫자로 옮겨 두었다.

## 왜

- workspace에는 terminal, document editor, app panel 같은 탭 kind가 8개 있다. 그런데 web page를 여는 kind는 없다. terminal에서 `vite`를 띄우거나 `gh auth login`을 하면 OS browser로 넘어가서, lophn 창과 browser 창을 오가야 한다.
- terminal의 child process가 여는 URL은 `$BROWSER`를 보지만 lophn은 이것을 다루지 않는다(packages/와 project-docs/ grep 결과 0건).
- lophn은 Electron 44.5.1을 쓰고, app 화면을 이미 `WebContentsView`로 pane 위에 겹쳐 띄운다. 그래서 browser는 탭 kind 하나를 더하고 그 view 길을 다시 쓰면 된다.

## 지금 코드

### lophn

- browser 탭은 land했다. 흐름과 지키는 것은 `project-docs/architecture/browser-tab.md`다. 보통 탭은 `<webview>`(view_session `wv-<guest id>`)이고, 탭을 여는 renderer 함수는 `packages/shell/renderer/workspace/kinds/browser.tsx`의 `openBrowserTab(host, url?)`, 탭 바로 뒤에 여는 옵션은 `TabHost.openTab(tab, { after })`다.
- **terminal.** Electron main → Node terminal host(`spawnNodeHost`, `main/terminal/supervisor.ts`. `process.execPath`를 `ELECTRON_RUN_AS_NODE=1`로 띄운다) → node-pty(`terminal-host/pty.ts`).
  - shell 탭 env는 `stripPlatformEnv(process.env)`다(`terminal-host/main.ts`). coding 탭은 여기서 `plan.env_delete`를 빼고 `plan.env`를 덮는다(`terminal-host/launch-plan.ts`).
  - `stripPlatformEnv`(`terminal-host/env.ts`)는 `LOPHN_`·`ELECTRON_`로 시작하는 이름, secret처럼 보이는 이름, `127.0.0.1:<port>`가 든 값을 뺀다. 그래서 `$BROWSER` 값은 strip이 끝난 뒤에 넣어야 한다.
  - xterm은 link handler를 일부러 두지 않고, OSC 8과 OSC 52를 삼킨다(`renderer/terminal/xterm-view.ts`). terminal에서 URL을 눌러도 아무 일이 없다.
- **설정 길.** core가 `declareSetting`으로 설정 key를 선언한다(`packages/core/config/shell-settings.ts`). shell은 `memory:settings/list`와 `memory:settings/update`로 읽고 쓴다. Settings의 Browser pane(`packages/shell/renderer/desktop/settings/browser/`)이 이미 있다.

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
- 위 두 설정을 Settings의 Browser pane에 Select로 둔다(pane은 1단계가 만들었다).

### 6. shell

- **wireframes gallery.** terminal 옆 pane에 bridge로 열린 browser 탭, Browser pane의 link 설정 둘.
- **문구.** `wording` skill을 따른다.

## 정한 것
- bridge shim은 Electron을 node로 띄운다(agent). rea shim은 PATH의 `node`를 찾고, 없으면 OS opener로 떨어진다. lophn은 terminal host를 이미 같은 방식으로 띄운다.
- terminal link는 Ctrl/Cmd-click만 browser 탭으로 연다(agent). 그냥 click은 text 선택과 부딪친다(VS Code, iTerm과 같다).
- browser 설정은 link를 열 곳 둘, browsing data 지우기, DevTools뿐이다(agent). rea가 모은 설정 가운데 사용자 한 사람이 dev server와 로그인에 쓰는 데 필요한 것만 골랐다.
  - web과 local을 나눈 것은 ChatGPT를 따랐다. 이미 로그인된 OS browser로 보낼 web link와 탭에 띄울 dev server가 갈린다.
- bridge가 여는 자리는 terminal 반대쪽 pane, pane이 하나면 terminal 바로 뒤다(agent). `vite`를 띄우면 page가 terminal 옆에 보인다. pane을 lophn이 나누지 않는다. 사용자가 정한 layout을 바꾸지 않으려는 것이다.

## 단계

1. ~~`browser-tab`~~ land했다.
2. **`browser-bridge`**: shim, socket 서버, terminal 탭별 key, env 주입, 여는 자리, terminal link, link를 열 곳 설정 둘, gallery의 bridge 상태(2, 4).

3(로컬 HTML 미리 보기)은 2가 끝난 뒤 다시 본다.

test(AGENTS.md "속도", `write-test` skill): bridge 요청 parse와 key 거절, `isRelayableUrl`. Electron이나 child process를 띄우는 test는 새로 만들기 전에 사람에게 묻는다.

계획 끝에 고칠 것: `project-docs/architecture/browser-tab.md`에 bridge 흐름, `project-docs/architecture/coding-agent.md`에 coding 탭 env의 `BROWSER`, changelog 열린 판, 이 문서에서 그 계획 몫 지우기.

## 끝남 기준

- terminal에서 `npx vite`가 낸 `http://localhost:5173`을 Ctrl-click하면 browser 탭에 page가 뜬다.
- terminal에서 `gh auth login --web`을 하면 OS browser가 아닌 browser 탭에 GitHub 화면이 뜨고, 로그인이 끝난다.
- 사용자가 env에 `BROWSER`를 둔 경우와 bridge가 꺼진 경우에는, terminal의 URL이 지금처럼 OS browser로 간다.
- web link를 `system_browser`로 두면 `gh auth login`이 OS browser로 가고, `vite`의 localhost link는 그대로 browser 탭에 뜬다.

## 하지 않는 것

- agent가 browser 탭을 보거나 다루기(CDP, `capturePage`를 agent tool로 주기, annotation을 browser page로 넓히기). browser 탭이 쓰인 뒤 따로 roadmap을 쓴다.
- site allow/block list, capability별 승인, 관리자 policy, storage mode(rea `policy-settings.js`).
- 방문 기록, 주소 칸 검색과 자동 완성, page 안 찾기, 확대·축소 UI.
- bookmark folder, bookmark bar, 가져오기와 내보내기.
- 위 "정한 것"에서 가져오지 않기로 한 rea 설정.
- 탭 하나 안의 여러 tab(rea `BrowserTabs`의 tab 줄). lophn은 pane의 탭 줄을 쓴다.
- Windows `$BROWSER` bridge.
- shell chrome과 app view의 `open-external`을 browser 탭으로 돌리기. 지금처럼 OS browser로 간다.
- 사용자 입력 없이 오래 숨은 page를 suspend하기(ChatGPT의 32 page 예산).
