# page-host

display가 없는 Linux에서 core가 띄우는 창 없는 page host를 짓는다. 같은 Electron binary를 `--page-host` intent로 띄운 것이고, 같은 `/host-link`에 host로 붙어 browser 탭 열기·닫기, `browser_call`, `page_*` 요청에 답한다. 탭마다 offscreen page 하나를 들고 desktop 앱과 같은 driver, 같은 stream, 같은 browser profile을 쓴다. 화면이 없어 browser를 못 쓴다고 말하던 옛 오류 문장을 고친다.

- 단위: page (wave 3)
- 선행: page-stream. `core-terminals`의 `coding-core`가 merge된 뒤에 띄운다(README "lead가 할 일").
- 소유(이 task만 고친다):
  - `packages/shell/main/page-host/`(새 폴더: `main.ts`, `pages.ts`)
  - `packages/shell/main/desktop/main.ts`, `packages/shell/main/desktop/launch-mode.ts`, `packages/shell/main/desktop/open-intent.ts`
  - `packages/shell/main/browser/agent/electron-page.ts`, `packages/shell/main/browser/agent/driver.ts`(문장 하나)
  - `packages/core/main/daemon/shell-launcher.ts`, `packages/core/main/daemon/shell-launcher_test.ts`
  - `packages/core/host-queue/queue.ts`(문장만)
  - `packages/cli/commands/tab.ts`(도움말 글만)
  - `project-docs/flows/areas/harness.yaml`, `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것 › 화면 없는 browser"
  - spike: `reports/multi-device/spike-headless-browser.md` 1(flag), 2(offscreen 창만 그린다, 크기 emulation을 먼저), 3(cookie가 남는다), 4(`setFrameRate`), 6(비용). script `.dev-data/spike-browser/q2.cjs`, `q4.cjs`
  - architecture: `project-docs/architecture/browser-tab.md`(page-contract가 쓴 "화면 없는 기계의 page" 절, 37, 41, 44~49), `platform.md` "core 수명"의 앱 띄우기와 launch intent
  - 본보기: `packages/shell/main/desktop/main.ts`의 `ensureCoreOnly`(창 없이 끝나는 launch mode), `desktop/wiring/surface.ts`(driver와 stream을 잇는 법, `BIND_OK`), `desktop/wiring/core.ts`의 `connectCore`, `desktop/wiring/context.ts`의 host link 만들기, `desktop/wiring/browser.ts`가 `installBrowserSession`(`browser/session.ts`)을 거는 법
- 계약:
  - 쓰는 것: `PAGE_HOST_INTENT`(`packages/protocol/lophn-agent/host-queue.ts`), `createPageStream`(`agent/stream.ts`), `createBrowserDriver`, `createTabControl`, `Page`·`PageLookup`, host-link 요청 `tab_open`·`tab_close`·`tab_show`·`browser_call`·`page_*`와 frame `report`·`page_frame`·`page_state`
  - 내놓는 것: 없음(끝 task)

시작 전에 다시 볼 것(lead가 2026-11-18 main 0.23.84에 대 보았다): `core-terminals`가 link에서 터미널·coding 요청을 지워 `hostRequestSchema`는 `tab_open|tab_close|tab_show|browser_call`과 page-contract가 더한 `page_*`다. merge된 schema에서 다시 센다. `visible`은 `{workspaces}` 하나다(TUI 칸이 없어졌다). `installBrowserSession`은 `packages/shell/main/browser/session.ts`에 있다.

## 할 일

1. 언제 띄우나(`shell-launcher.ts`): 앱을 띄우는 함수 안에서 env를 다 만든 뒤(service core면 지금처럼 user manager에서 화면 값을 가져온 뒤) `platform === "linux"`이고 그 env에 `DISPLAY`와 `WAYLAND_DISPLAY`가 둘 다 비었으면 page host로 띄운다: 인자 `[…sandbox, …entry, "--home", dataRoot, PAGE_HOST_INTENT, "--ozone-platform=headless", "--disable-gpu"]`. 그 밖은 지금 그대로 `--agent-window`다. `--no-sandbox`는 지금 규칙(개발이고 `ELECTRON_NO_SANDBOX=1`) 그대로 쓰고 새 규칙을 더하지 않는다. 기존 test의 기대값은 display 없는 linux env로 돌던 것이라 그 경우들에 `DISPLAY`를 준다.
2. launch mode: `launch-mode.ts`에 `pageHost`(argv에 `PAGE_HOST_INTENT`)를 더하고 `desktop/main.ts`가 `core`, `pageHost`, desktop 셋으로 가른다(`startDesktop`의 조립을 거치지 않는다: 창, tray, renderer, terminal-host, extension, 전역 단축키 없음). `open-intent.ts`는 이미 떠 있는 desktop 앱이 second-instance로 `--page-host`를 받으면 `--agent-window`로 읽는다(그 앱이 host다).
3. `page-host/main.ts`의 `startPageHost()`:
   - `resolveDataRoot()`, `app.setPath("userData", browserDataPath(dataRoot))`, `acquireSingleInstance`. 같은 userData의 lock이라 desktop 앱과 page host는 한 기계에서 같이 돌지 않는다(나중에 뜬 쪽이 끝난다). page host가 second-instance를 받으면 `--quit`과 `--page-host`가 아닌 것은 page host를 끝낸다(화면이 생긴 기계에서 사람이 다시 누르면 desktop 앱이 선다).
   - `app.on("window-all-closed", () => {})`: 마지막 page를 닫아도 끝나지 않게 한다(Electron 기본은 끝난다).
   - `connectCore`(창 집합은 빈 것, relay는 빈 목록, `handle`은 아무것도 하지 않는 것)와 `createHostLink`로 붙는다. `visible`은 workspaces가 빈 목록이다(workspace에 묶인 탭 요청은 page host로 오지 않는다). host link가 60초 넘게 닫혀 있으면 끝난다(core가 없다).
   - `installBrowserSession`을 desktop과 같은 규칙으로 한 번 건다(permission, download, user agent).
   - `createTabControl`(push는 `stream.controlChanged`만), `createBrowserDriver`(`viewSession(tab)`은 page가 있으면 tab 자체, `lookup.guest`만 page를 주고 app·artifact는 undefined, `releaseLogin`은 core 연결의 것), `createPageStream`.
   - 요청: browser target의 `tab_open`은 page를 만들고 `BIND_OK`와 같은 답을 준다. `tab_close`는 page를 닫고 done, `tab_show`는 done, `browser_call`은 `driver.run`, `page_*`는 stream. 처리기가 없는 요청은 host link가 `unavailable`로 답한다.
4. `page-host/pages.ts`(offscreen page 표):
   - `new BrowserWindow({show: false, webPreferences: {offscreen: true, partition: BROWSER_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}})`. spike에서 display 없이 그리는 그릇은 이것뿐이다.
   - 만든 뒤 load 전에 debugger를 owner `"emulation"`으로 붙여 두고 `Emulation.setDeviceMetricsOverride {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false}`를 보낸다(headless에서 창은 1x1이라 이것 없이는 screenshot과 click이 맞지 않는다. spike 2). owner는 page가 사는 동안 떼지 않는다(떼면 override가 풀린다). `webContents.setFrameRate(10)`(spike 4: 보는 쪽 없이 움직이는 page의 비용과 stream 상한).
   - navigation은 `decideNavigation`(`will-navigate`, `will-redirect`), `setWindowOpenHandler`는 거절, `<webview>` 붙이기 거절. 첫 주소도 같은 규칙을 지난다.
   - 상한은 창 하나의 agent page 상한과 같은 12개(`MAX_AGENT_PAGES`, `packages/shell/renderer/app-frame/workspace-views.tsx`)이고 넘으면 가장 오래 쓰지 않은 page를 닫는다. url·title·loading이 바뀌면 `report {tab, state}`, page가 닫히거나 죽으면(`render-process-gone`) `report {tab, state: "closed"}`와 `control.forget`, `stream.forget`.
   - `electron-page.ts`에서 webContents 하나에 Page 하나를 만드는 함수(`createPages`)를 export해 쓴다(`alive()`의 `webview` 검사는 desktop lookup에만 남긴다).
5. 문장: `queue.ts`의 `SHELL_NOT_ATTACHED`, `SHELL_START_FAILED`, `SHELL_LOST`와 `driver.ts`의 page가 없어진 문장에서 "lophn window"·"lophn app"만 원인으로 말하는 곳을 lophn의 browser(창의 탭이거나 화면 없는 기계의 page host)로 고친다. 원인, 다음 할 일, 되풀이가 통하는지는 그대로 둔다(`browser-tab.md` 36). `tab.ts`의 `--url` 도움말(영어)에 화면이 없는 Linux에서는 lophn이 창 없는 browser를 띄워 page를 든다는 것과 그때 상한 12개는 창마다가 아니라 그 기계 전체라는 것을 더한다.
6. flows(`flows` skill): `harness.yaml`의 `host-shell-launch`에 page host outcome을 더하고 page host가 요청에 답하는 `system:` flow 하나를 쓴다. `tests/core-rest.yaml`의 `shell-launcher_test.ts` covers를 고친다.

정한 것:
- page host는 shell main entry의 launch mode다(따로 entry를 build하지 않는다): core 연결, host link, browser session, driver, stream, 경로를 desktop과 같은 bundle에서 import하고 renderer가 필요 없다. `--core` mode가 같은 꼴이다.
- popup(`window.open`)은 거절한다: page host에는 둘 자리가 없다.
- flag는 `--ozone-platform=headless --disable-gpu`다: spike에서 `XDG_SESSION_TYPE`까지 없는 기계(S2)에서도 뜨고, `--headless`보다 page 하나에 약 200 MB 적고 GPU 오류 log가 없다(spike 1, 2, 6).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`shell-launcher_test.ts`, 가짜 spawn): "display가 있는 기계(env의 `DISPLAY`·`WAYLAND_DISPLAY`나 user manager에서 가져온 값)와 Linux가 아닌 기계에서는 page host를 띄우지 않고, display 없는 Linux에서만 `--page-host`와 headless flag로 띄운다". page host 자체를 띄우는 test(Electron, subprocess)는 만들지 않는다. 필요하면 먼저 사람에게 묻는다. lead가 끝난 뒤 display 없는 환경으로 한 번 돌려 본다.
- 남지 않음: `grep -rn "the lophn window that held it" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어 둘 것: 설치본이 `--no-sandbox` 없이 최소 server image에서 뜨는지(setuid `chrome-sandbox`, X11 library)는 확인하지 못했다. `lophn login request`의 보호 입력 창은 page host에 없다(사람은 멀리서 보며 직접 친다)
