# browser tab: workspace pane에서 web page를 연다

상태: 로드맵. 1단계 `browser-tab`(browser 탭 kind, `<webview>` page, popup, session·navigation 규칙, DevTools, bookmark, favicon, Settings Browser pane)과 2단계 `browser-bridge`(shell 탭의 `$BROWSER` shim과 socket bridge, terminal Ctrl/Cmd-click, Settings › Browser › Links)가 land했다. 둘 다 `project-docs/architecture/browser-tab.md`다. 남은 것은 아래 "남은 bridge 일"이다. 로컬 HTML 미리 보기는 계획 `artifact`가 artifact 탭으로 했다(`project-docs/architecture/artifact.md`).
배경 문서: `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/coding-agent.md`(terminal 탭 TUI), AGENTS.md "속도"·"호환성".
가져올 것: `../rea/project/desktop-embeded-browser`. ChatGPT·Claude desktop의 embedded browser를 분석하고(`analysis/`), 같은 동작을 Electron 44.5.1 위에 clean-room으로 다시 짠 CommonJS library다(`src/`, 2096줄).

## 왜

- workspace에는 terminal, document editor, app panel 같은 탭 kind가 8개 있다. 그런데 web page를 여는 kind는 없다. terminal에서 `vite`를 띄우거나 `gh auth login`을 하면 OS browser로 넘어가서, lophn 창과 browser 창을 오가야 한다.
- lophn은 Electron 44.5.1을 쓴다. browser는 탭 kind 하나를 더해 해결했다. 보통 탭은 shell renderer의 `<webview>`이고, 크기 준 popup과 DevTools만 app 화면처럼 native `WebContentsView`다(`project-docs/architecture/browser-tab.md`).

## 지금 코드

- browser 탭과 bridge의 흐름과 지키는 것은 `project-docs/architecture/browser-tab.md`다.

## 무엇을 만드나

### 남은 bridge 일

- **coding 탭의 `BROWSER`.** coding 탭은 app space 패널에 붙고 그 route에는 Workspace(pane)가 없어 browser 탭을 열 곳이 없다. 지금은 OS browser로 간다. 하려면 app space에서 project 창 Workspace로 가는 길(누구의 project인가, route 전환을 허락하는가)을 먼저 정하고, `terminal-host/launch-plan.ts`가 `plan.env`를 덮은 다음에 `TerminalBridge.issue()`의 env를 더한다.
- **detached 창 안의 terminal.** bridge push를 받는 hook(`useBridgeOpenRequests`)이 project 창 Workspace에만 있다. 뗀 terminal의 `terminal_ref`가 project 창 store에 남아 있어서 같은 실행에서는 project 창이 URL을 browser 탭으로 열지만(detached 창이 아니라 project 창에 뜬다), 다시 열어 복원한 detached terminal은 어느 창도 ref를 몰라 `declined`(OS browser)다. 복원 쪽은 `issues/workspace-layout.md`의 terminal 재연결이 고쳐지면 같이 풀린다.
- **host가 죽은 뒤 사람이 다시 시작한 shell**(supervisor의 `reopenMessage`)은 env 없이 열려 bridge가 없다.

## 정한 것

- browser 설정은 link를 열 곳 둘, browsing data 지우기, DevTools뿐이다(agent). rea가 모은 설정 가운데 사용자 한 사람이 dev server와 로그인에 쓰는 데 필요한 것만 골랐다.
  - web과 local을 나눈 것은 ChatGPT를 따랐다. 이미 로그인된 OS browser로 보낼 web link와 탭에 띄울 dev server가 갈린다.

## 단계

1. ~~`browser-tab`~~ land했다.
2. ~~`browser-bridge`~~ land했다.
3. 위 "남은 bridge 일"은 1, 2가 쓰인 뒤 다시 본다.

## 하지 않는 것

- annotation을 browser page로 넓히기. (agent가 자기가 연 browser 탭을 보고 다루는 것은 계획 `browser-use`가 `lophn browser` 명령으로 열었다: `architecture/browser-tab.md` "agent가 다루는 browser 탭".)
- site allow/block list, capability별 승인, 관리자 policy, storage mode(rea `policy-settings.js`).
- 방문 기록, 주소 칸 검색과 자동 완성, page 안 찾기, 확대·축소 UI.
- bookmark folder, bookmark bar, 가져오기와 내보내기.
- 위 "정한 것"에서 가져오지 않기로 한 rea 설정.
- 탭 하나 안의 여러 tab(rea `BrowserTabs`의 tab 줄). lophn은 pane의 탭 줄을 쓴다.
- Windows `$BROWSER` bridge.
- shell chrome과 app view의 `open-external`을 browser 탭으로 돌리기. 지금처럼 OS browser로 간다.
- 사용자 입력 없이 오래 숨은 page를 suspend하기(ChatGPT의 32 page 예산).
