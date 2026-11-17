# core-terminals

- 목표: 터미널과 coding agent(GUI session, harness adapter, 화면 없이 도는 harness turn)를 core가 띄우고 갖는다. desktop 화면과 폰이 같은 core route로 붙어 보고 시킨다. 창이 없어도 열리고 앱을 Quit해도 돈다.
- 재료: `project-docs/products/roadmap/shell-as-client.md`, `project-docs/architecture/terminal-agent.md`, `coding-agent.md`, `acp.md`, `harness-gui.md`, `platform.md`, `remote.md`, 조사 `reports/multi-device/survey-s3-shell-work.md`(지금 code, file 묶음 A~J, 이어 쓸 자리, 묶인 제약 5.4)
- 범위 밖: agent의 browser(`core-browser`), 처음 설정(`core-setup`), 다른 기계의 터미널을 내 화면에 섞어 보이기(`one-screen`), layout을 core로 옮기기, 폰이 날 글자 stream으로 터미널을 그리기(지금의 화면 사본 방식 그대로), Windows에서 안 되던 것을 되게 하기

## 정한 것

- **일을 가진 process는 core의 자식이다.** PTY를 쥔 process는 core가 띄우고 core와 수명을 같이한다. extension host(registry, CLI를 띄우는 spawner, bundled extension 둘)와 coding agent의 상태(tracker, hook socket, GUI handle, ACP state)는 core 안에서 돈다. core가 드는 것은 사본이 아니라 원본이다. (agent: 사람 "core가 좀 더 가져가고 shell은 client")
- **code는 core 쪽 package로 옮긴다.** `packages/shell/terminal-host`, `packages/shell/main/terminal`, `packages/shell/main/extensions`는 이미 Electron을 import하지 않는다. 옮기고(`move-files`) shell에 사본을 남기지 않는다. module catalog를 같이 고친다. (agent)
- **화면은 route로만 붙는다.** desktop 화면과 폰이 같은 core route를 쓴다. 폰이 이미 쓰는 `coding_sessions/*`, `acp/*`, `terminal_view/*`를 바닥으로 삼고, desktop에 필요한 것(터미널 열기·닫기·다시 시작·입력·크기, 날 출력 stream, 목록)을 더한다. shell의 터미널·harness-gui·coding IPC channel과 core가 shell에 시키던 요청(`coding_*`, `terminal_*`, `terminal_interrupt`, `tool_call`)은 지운다. core와 shell 사이 link에는 창이 있어야 하는 것(탭 열기·닫기·보이기, browser)만 남는다. (agent: 같은 일을 하는 길을 둘로 두지 않는다)
- **터미널은 core가 연다.** 탭이 mount될 때 PTY를 여는 지금 순서를 뒤집는다. 열라는 요청(사람의 화면, 폰, agent의 `lophn tab open`)이 core에 오면 core가 열고, 그 workspace를 보는 창이 있으면 탭으로 보인다. 창이 없어도 열린다. (agent)
- **출력 stream은 보는 쪽이 잡은 동안만 간다.** 터미널 보기의 lease와 같은 모양이다. 보는 화면이 없으면 core는 화면 상태만 유지한다. (agent)
- **입력 자격.** 그 기계의 화면은 지금처럼 focus한 창만 친다(검사는 shell에 남는다). 폰과 다른 기기는 터미널 입력 허락이 있어야 한다(지금 그대로). agent 자격은 터미널에 치지 못한다(지금 그대로). (agent)
- **앱을 Quit해도 터미널은 돈다.** Quit할 때 도는 터미널이 있으면 "그대로 두기"(기본)와 "다 닫기"를 묻는다. 터미널이나 coding session이 열려 있는 동안 core는 스스로 끝나지 않는다. tray의 `Stop lophn`은 다 닫는다. 다시 켜면 탭이 살아 있는 터미널에 붙는다. (agent: 사람 "앱을 꺼도 … 돌고")
- **사람의 환경은 core가 읽는다.** login shell의 env(PATH)를 core가 읽어 터미널과 CLI에 준다. "core는 사람의 PATH를 모른다"가 harness host를 shell에 둔 이유였고 그 이유가 없어진다. (agent)
- **OS에 붙은 것은 shell에 남는다.** OS 알림, clipboard, 터미널의 link를 lophn browser 탭으로 여는 것. 알림은 core의 event를 받아 shell이 띄운다(폰의 push와 같은 근거). shell이 없으면 터미널의 link는 OS의 browser로 간다. (agent)
- 저장된 것: `<data root>/shell/agent-sessions/`는 새 주인의 자리로 옮기는 data step을 둔다. 터미널 id의 꼴은 바꾸지 않는다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `term-contract` | 없음 | protocol: 터미널과 coding session의 route·event 모양(desktop과 폰이 같이 쓴다), 지울 link 요청 목록, extension host의 port. `architecture/terminal-agent.md` 초안 |
| 2 | `term-host` | `term-contract` | PTY host를 core의 자식으로: `terminal-host`와 supervisor 옮기기, core가 띄우기, login env, node-pty build와 packaging, `terminals/*` route와 출력 stream, core 수명 규칙 |
| 2 | `ext-host` | `term-contract` | extension host를 core로: registry, spawner, bundled extension(harness-gui adapter 다섯과 녹화, harness host)의 build와 자리, Settings › Extensions가 route를 쓰기, extension tool을 core가 바로 부르기 |
| 3 | `coding-core` | `term-host`, `ext-host` | coding agent의 상태를 core로: tracker, hook socket, GUI handle과 ACP state, GUI↔TUI 바꾸기, session 열기, TUI hold. core의 사본(coding relay)을 원본으로 바꾼다 |
| 4 | `term-desktop` | `coding-core` | desktop: 터미널 탭과 GUI 화면이 core route를 쓴다. shell의 터미널·harness-gui·coding IPC와 그 wiring 지우기, 알림을 core event로, Quit 흐름 |
| 4 | `term-phone` | `coding-core` | 폰 앱: 바뀐 route와 모양에 맞추기, 창 없이 열리는 것에 맞춘 문구와 기다림 |
| 5 | `term-cleanup` | `term-desktop`, `term-phone` | link의 옛 요청과 frame, `tools/fake-coding-host.ts`, flows·catalog, 남은 옛 이름 |

`term-host`와 `ext-host`는 build와 packaging file(`packages/shell/main/build.ts`, `tools/package/`)에서 만난다. 그 file은 `term-host`가 갖고 `ext-host`는 고칠 줄을 보고에 적는다.

## 위험 test (brief에 있다)

- agent 자격과 터미널 입력 허락이 없는 기기는 터미널에 치지 못한다.
- core가 끝나면 PTY가 남지 않는다(`terminal-agent.md` 16).
- 화면이 다시 붙어도 터미널의 출력을 잃거나 두 번 받지 않는다.
- 옮긴 뒤 harness-gui adapter의 녹화 60개가 그대로 통과한다.
- `shell/agent-sessions/`를 옮긴 뒤 이어 가기(resume)에 쓰는 session 기록이 남아 있다.

## lead가 할 일

- wave 4를 띄우기 전에 실제 Electron에서 한 번 돌려 본다(터미널 열기, 치기, `claude gui`, 앱 Quit 뒤 다시 켜서 붙기). unit test만으로는 이 길을 못 본다(이 영역에 e2e가 없다).
- node-pty를 core가 load할 수 있는지는 `term-host`가 가장 먼저 확인한다(조사에서 확인하지 못했다). 안 되면 멈추고 보고한다.
- `core-browser`가 같은 link와 host queue file을 고친다. `status.py ready`가 거르는 대로 따르고, 이 계획의 `coding-core`가 merge된 뒤에 `core-browser`의 core 쪽 task가 돈다.
- subprocess를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다. 실제 coding CLI와 실제 provider를 부르지 않는다(녹화 재생만).
- `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다.
- 끝나면: `architecture/terminal-agent.md`, `coding-agent.md`, `harness-gui.md`, `acp.md`, `platform.md`(core 수명, Quit), `remote.md`, boundary·module catalog, flows, `harness-gui` skill, change-log, roadmap `shell-as-client.md`.
- 사람에게: Quit해도 터미널이 도는 것은 사람이 보는 동작이 바뀌는 것이다. 끝난 뒤 확인을 부탁한다.
