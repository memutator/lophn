# shell as client: 일은 core가 하고 shell은 화면 가운데 하나다

상태: 로드맵. 2026-11-17 사람이 방향을 내고 planner가 정리했다. 계획 셋으로 연다(아래 "순서와 계획"). `core-terminals`는 끝났다(2026-11-18). `core-setup`과 `core-browser`가 남았다. `standalone-core.md`(끝남. core가 shell 밖에서 스스로 선다)의 다음 걸음이고, `multi-device.md`의 순서 3이다.
배경 문서: `project-docs/architecture/platform.md`, `terminal-agent.md`, `coding-agent.md`, `acp.md`, `harness-gui.md`, `browser-tab.md`, `workspace-layout.md`, `remote.md`, `agent-definition.md`. 앞선 로드맵: `standalone-core.md`, `agent-browser-lifetime.md`, `secret-request.md`, `mobile.md`. 조사: `reports/multi-device/survey-s3-shell-work.md`, `survey-s4-setup-tabs.md`, `survey-s5-browser.md`.

## 사람의 말 (원문)

> 화면 없는 vm 처음 설정하기에 대해서 말해보자. 안 그래도 내가 shell의 renderer나 그런 것들을 좀 덜어내고 core가 좀 더 가져가고 shell은 client가 될 수 있는 그런 방향을 생각하고 있었거든? 앞으로는 lophn agent에게 더 많은 것을 할 수 있도록 열어줘야하고, 다른 데서도 client가 되기도 하고. 그러니까 이것도 꽤 volume 있는 계획이 될 것 같은데

> 근데 앱이 꼭 화면 있어야만 하는 거야? headless로는 동작 안 해? 지금도 app의 command를 agent가 cli로 쓰는 흐름이 있는데

> browse 작업 job 같은 것들 vm에서 돌리면 좋을 거 같은데 […] lophn agent가 화면 없는 환경에서 core에서 headless로 브라우저를 열 수 있게하는 길 하나만 추가해도 되는 거 아녀?

> (화면 없는 browser는 못 본다는 말에) 이 경우에 remote로 화면을 띄우는 건 쉬움? 기반은 다 있을 거 아니야 계획대로라면

## 왜

- 지금 lophn의 일 가운데 일부는 Electron 앱(shell)이 켜져 있어야 돈다. 그래서 화면 없는 기계(VM, 미니 PC)에서는 그 일을 못 하고, 폰이나 다른 기계는 shell이 켜진 기계의 그 일만 다룰 수 있다.
- 사람이 가려는 곳은 셋이다: lophn agent가 더 많은 것을 스스로 한다(shell이 가진 일은 agent가 못 시킨다), 화면이 여럿이다(desktop 창, 폰, 다른 기계의 lophn), 화면 없는 기계가 온전한 lophn이다.
- 셋 다 같은 것을 요구한다. 일은 core가 갖고, 화면은 core에 붙어 보고 시키기만 한다.

## 방향

- **일은 core의 것이다.** 돌아가는 것(process, 상태, 기록)은 core가 갖고 core의 route로 읽고 시킨다. shell이 꺼져도 돌고, 어느 화면이 붙어도 같은 것을 본다.
- **shell은 화면 가운데 하나다.** desktop 창, 폰, 다른 기계의 lophn이 같은 route로 붙는다. shell만 아는 길(shell IPC로만 되는 일)을 일에는 두지 않는다.
- **shell에 남는 것은 그 기계의 화면과 OS에 붙은 것이다.** 창과 탭을 그리기, 앱 화면과 사람 browser 탭을 그리는 `<webview>`, tray와 OS 알림, 전역 단축키, file 고르기 창, 자동 update.
- 앱은 이미 이 모양이다. 앱의 code와 command는 core에서 화면 없이 돌고 agent가 CLI로 쓴다. 화면만 붙은 쪽이 그린다. 이번에 나머지 일을 같은 모양으로 맞춘다.

## core로 옮기는 것

| 일 | 지금 | 옮긴 뒤 |
|---|---|---|
| 터미널 | 터미널을 돌리는 process가 Electron 앱의 자식이다. 앱을 Quit하면 다 죽는다. 터미널은 창의 탭이 mount될 때 열린다. 창이 없으면 못 연다 | core가 터미널을 열고 닫고 크기를 정한다. 화면은 붙어서 보고 친다 |
| coding agent | GUI session, harness adapter, 화면 없이 도는 harness turn이 모두 shell main 안에서 돈다. core는 사본만 든다. shell이 없으면 화면 없는 harness turn도 시작하지 못한다 | core가 띄우고 되살린다. shell 없이 시작하고 이어 간다 |
| 처음 설정과 secret 넣기 | secret 값은 Electron의 보호 입력 창으로만 들어간다. provider 연결 순서는 desktop 화면의 code가 쥐고 있다. 폰에는 "컴퓨터에서 하세요"가 뜬다 | 어느 화면에서나(폰, 다른 기계) 그 기계를 처음부터 설정한다. 값은 그 기계의 core로만 간다 |
| 열려 있는 것의 목록 | 터미널과 coding session의 목록은 shell이 알고 core는 폰이 볼 때만 사본을 받는다. agent가 연 탭은 창이 받아 주어야 생긴다 | 무엇이 열려 있나(터미널, coding session, agent의 page)는 core가 안다. 창이 없어도 열린다. 탭을 어디에 놓았나(layout)는 그 화면의 것으로 남는다 |
| agent의 browser | page는 창 안의 `<webview>`다. 화면 없는 Linux에서는 browser를 못 쓴다. 다른 기기에서 그 page를 볼 길이 없다 | 아래 "browser" |

옮기는 순서의 원칙: route를 core에 먼저 세우고, shell을 그 route를 쓰는 쪽으로 바꾸고, 마지막에 shell의 옛 길을 지운다. 같은 일을 하는 길을 둘로 남기지 않는다.

## browser

- agent가 쓰는 page를 주는 곳이 둘이 된다.
  - **창의 탭.** 화면이 있는 기계. 지금 그대로다(shell이 없으면 core가 앱을 띄운다. `agent-browser-lifetime.md` 단계 3). 사람의 로그인을 같이 쓴다.
  - **core가 띄운 화면 없는 browser.** display가 없는 기계. core가 browser를 화면 없이 띄우고 agent의 `browser.*`가 그 page를 다룬다.
- agent에게는 같은 tool이다. 어느 쪽인지는 lophn이 기계를 보고 고른다.
- **멀리서 보기.** 어느 쪽 page든 다른 화면(폰, 다른 기계)에서 열어 보고 끼어든다. 터미널 보기와 같은 길이고 글자 대신 그림이 간다. 화면 없는 기계의 로그인은 이 길로 사람이 한다.
- `agent-browser-lifetime.md`가 "하지 않는다"로 둔 둘(화면 없는 머신, 따로 띄운 browser와 screencast로 보기)을 이 로드맵이 연다. 그때 닫은 이유는 "서버에서 browser가 필요한 일이 아직 없다"였고, 지금은 VM에서 browse job을 돌리는 것이 목표다.

## 하지 않는 것

- 사람 browser 탭과 앱 화면을 그리는 길 바꾸기. 그 기계의 화면이 `<webview>`로 그린다.
- core 안에 화면 그리기(창, renderer)를 넣기.
- shell을 없애기. desktop에서는 shell이 가장 좋은 화면이다.
- 화면 있는 기계에서 agent page를 화면 없는 browser로 돌리기(사람의 로그인과 갈린다).
- 실제 폰의 앱을 다루기(`mobile.md`에 남는다).

## 순서와 계획

| 계획 | 무엇 | 기대는 것 |
|---|---|---|
| `core-terminals`(끝남) | 터미널, coding agent(GUI session, harness adapter, 화면 없는 harness turn), 그 상태와 알림의 근거를 core로 옮긴다. desktop 화면과 폰이 같은 route로 붙는다 | 없음 |
| `core-setup` | 처음 설정을 어느 화면에서나 한다: secret 넣기, provider 연결과 로그인, 기본 model, project 더하기. 순서를 쥔 code를 화면에서 core로 옮긴다 | 없음 |
| `core-browser` | 화면 없는 기계에서 core가 browser를 띄운다. agent의 page를 다른 기기에서 보고 끼어든다 | core와 shell이 주고받는 file이 `core-terminals`와 겹쳐 그 뒤에 합친다 |

셋은 같이 연다. `core-terminals`가 가장 크고 나머지의 바닥이다(core와 shell 사이 link의 모양을 바꾼다). 화면 없는 기계에서 remote를 켜고 pairing code를 보이는 CLI는 `multi-device.md`의 `device-roster`가 한다.

"탭 상태를 core로"는 따로 계획으로 열지 않는다. 필요한 것은 "창이 없어도 열려 있고, 어느 화면에서나 같은 목록을 본다"이고 이것은 `core-terminals`와 `core-browser`가 한다. layout을 core로 옮기는 것은 쓰는 곳이 생길 때 한다.

## 끝나면 되는 것

- 화면 없는 VM에 lophn core만 깔고, 폰이나 내 PC에서 붙어 provider 연결, secret, agent 설정을 처음부터 한다.
- 그 VM에서 coding agent와 터미널을 새로 열고 폰이나 내 PC에서 보고 친다.
- 내 PC의 lophn 앱을 꺼도 터미널과 coding agent가 돌고, 다시 켜거나 폰으로 붙으면 그대로 있다.
- VM에서 도는 job이 browser를 쓴다. 로그인이 필요하면 폰에서 그 page를 열어 직접 로그인한다.
- 폰과 desktop이 같은 기계의 같은 터미널과 coding session 목록을 본다.

## 끝난 것: core-terminals

- PTY host와 extension host(registry, CLI를 띄우는 spawner, bundled `harness`·`harness-gui`)가 core의 자식이다. 터미널 coding agent의 tracker, hook socket, GUI handle, TUI hold, hook 설치, harness 찾기, `$BROWSER` bridge도 core에 있다. core가 사람의 login shell env와 `lophn` 경로를 읽는다.
- desktop 탭과 폰은 같은 `terminals/*`, `coding_sessions/*`, `acp/*` route로 붙는다. 창이 없어도 열리고, 화면 없는 harness turn은 앱 없이 돈다. 앱을 Quit해도 터미널은 돈다(Quit이 "그대로 두기"와 "다 닫기"를 묻는다). 탭은 layout의 `terminal_ref`로 다시 붙는다. layout은 화면마다 그대로다.
- shell에는 focus 검사, clipboard, link를 browser 탭으로 여는 것, OS 알림(`TerminalAgentSignaled`)이 남는다. core와 shell 사이 link에는 `tab_open|tab_close|tab_show`와 `browser_call`만 남는다. 폰의 깨우기(`coding_sessions/wake`)는 없앴다.
- 설계는 `architecture/terminal-agent.md`, `coding-agent.md`, `harness-gui.md`, `extension.md`, `platform.md`다.

## 지금 code

조사한 날의 main(0.23.80)이다. 아래 "터미널과 coding agent"는 `core-terminals` 전의 모습이다. 자세한 것은 `reports/multi-device/survey-s3-shell-work.md`, `survey-s4-setup-tabs.md`, `survey-s5-browser.md`에 있다.

**터미널과 coding agent**
- PTY를 쥔 process(`packages/shell/terminal-host`)는 Electron 앱 한 번 실행에 하나이고 shell main의 자식이다. 수명이 그 pipe에 묶여 있다. 창을 다 닫아도 살지만 Quit하면 죽는다.
- 터미널, extension, harness adapter의 code(약 2만 줄)는 Electron을 import하지 않는다. `electron`을 import하는 36개 file은 모두 `shell/main/{app-frame,artifact,browser,desktop}`와 `preload`에 있다. 묶인 곳은 띄우는 자리, 수명, node-pty build, 화면에서 시작하는 제어 길이다.
- 터미널은 화면에서 시작한다. 탭이 mount될 때 PTY를 연다. 폰이 터미널이나 coding session을 열어도 desktop 창에 탭을 만들고 기다린다(최대 55초). 창이 없으면 실패한다.
- core는 shell에 16가지 요청을 보낸다(`/host-link`, 연결은 한 번에 하나). 그 가운데 창이 꼭 있어야 하는 것은 탭 열기·닫기·보이기, browser 다루기, coding session 열기, 터미널 열기다. 나머지 10가지는 shell main이 가진 일을 core가 대신 시키는 것이다.
- core가 가진 것은 사본이다. coding agent의 상태, hook socket, 알림 판단은 shell main에 있고 core에는 frame으로만 온다. 사본은 memory에만 있다.
- 화면 없이 도는 harness turn은 shell의 extension이 core를 1초마다 물어 가져간다. 그 자리인 이유는 "core는 사람의 PATH를 모른다"였다.
- harness GUI adapter 다섯(claude 3650줄, codex 3301, omp 3054, opencode 2956, antigravity 2007)과 녹화 60개가 shell main의 extension 안에 있다.
- 다른 기계의 창에서는 터미널, file, browser, 앱 화면이 다 꺼져 있다.

**처음 설정**
- secret 값이 들어가는 길은 Electron의 보호 입력 창 하나다. `secrets/put`은 화면도 CLI도 부르지 못한다. 창이 없는 기계에는 secret을 넣을 수 없다.
- "사람이 확인했다"는 표(decision handle)는 그 기계의 shell main만 받는다.
- provider 연결의 순서(id 만들기, 임시 secret, 충돌 확인, 연결)는 desktop 화면의 code에 있고, agent가 청한 입력 card를 위해 shell main에 같은 순서가 한 번 더 있다. 구독 로그인은 화면이 도는 poll이다. CLI에는 provider 연결, 로그인, 기본 model 명령이 없다.
- ChatGPT, Claude, Antigravity 로그인은 core가 있는 기계의 browser가 필요하다(loopback으로 돌아온다). SuperGrok만 아무 browser에서나 된다.
- project 더하기는 화면이 id와 slug를 만들고 폴더는 Electron 창으로 고른다. CLI 명령이 없다.
- `remote.*`는 CLI가 막는 설정이고 pairing을 시작하는 CLI가 없다. 화면 없는 기계는 remote를 켤 수 없다.
- 기기가 부를 수 있는 route 109개에는 secret, provider, 설정 쓰기, project와 agent 만들기가 일부러 빠져 있다.

**열려 있는 것과 layout**
- layout은 shell main이 `<data root>/shell/workspaces/`에 file로 둔다. agent가 연 탭은 저장하지 않는다.
- core가 아는 탭은 memory의 표 하나다(tab id, 주인, workspace, 종류). core가 꺼지면 없어진다.
- 다른 기계의 창은 layout을 저장하지 않고, 탭 종류 16가지 가운데 11가지가 "이 컴퓨터에서만 열린다"로 막혀 있다.

**browser**
- page를 다루는 driver(913줄)는 CDP만 말하고 Electron을 모른다. Electron에 닿는 것은 98줄짜리 file 하나다. page를 주는 곳을 바꿔 끼울 자리가 이미 있다.
- driver는 shell main에서 돈다. core는 요청을 link로 넘긴다.
- page는 화면이 `<webview>`를 만들고 알려 주어야 생긴다. 창이 보이지 않거나 최소화되어 있으면 그리지 않아 screenshot이 실패한다.
- 폰이 이미 둘째 provider다(폰의 앱 화면을 browser 동사로 다룬다). 다만 provider라는 틀이 아니라 갈래 셋으로 박혀 있다.
- 멀리서 보는 길로 가장 가까운 것은 터미널 보기다(보는 쪽이 lease를 잡으면 host가 화면을 밀고, core는 마지막 것만 들고, 내용 없는 event가 나면 보는 쪽이 읽어 간다). 실리는 것은 글자다. 그림 stream은 code에 없다.
- 제품에는 화면 없는 길이 없다. 개발용 `LOPHN_SHELL_HEADLESS`만 있다. Chromium은 Electron 안의 것 하나뿐이다.
- 실제로 돌려 본 것(`reports/multi-device/spike-headless-browser.md`, Linux): display가 없어도 Electron이 `--ozone-platform=headless`로 뜨고 offscreen page에서 screenshot, AX tree, click, 입력, 남는 cookie가 된다. CDP screencast가 offscreen page와 보이는 창의 `<webview>`에서 frame을 낸다(1280x800 JPEG 한 장에 5~9 KB, 10 fps에 core 하나의 5~16%). 창이 최소화되거나 숨겨지면 frame이 멈춘다. page 하나에 memory 110~140 MB다.
