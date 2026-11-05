# tab-gui

터미널 탭이 xterm과 채팅 화면을 오가게 한다. 탭에서 친 `claude gui`(`codex gui`, `opencode gui`, `omp gui`)는 그 탭의 hook socket(`LPN_TERMINAL_HOOK`)으로 shell main에 닿고, shell main은 tracker로 그 탭의 harness·session id·상태를 알아 extension에 `AcpTerminal`을 넘긴다(README 정한 것 1, 6). toggle 단추와 modal(정한 것 2, 7), main이 PTY에 치는 길과 foreground에 signal을 보내는 길, CLI 환경(정한 것 11)을 만든다. 첫 판의 별도 창, open intent, `lophn gui`는 이 task에서 지우지 않는다(wave 3 `gui-cleanup`). 그때까지 옛 창 port(`AcpWindowPort`, `openHarnessGui`)와 그 type은 남겨 옛 code가 compile되게 한다.

- 단위: tab (wave 2)
- 선행: acp-session
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/terminal/terminal-tab.tsx`
  - `packages/shell/renderer/terminal/terminal-gui.tsx`(새 file)
  - `packages/shell/renderer/terminal/use-gui-requests.ts`(새 file)
  - `packages/shell/renderer/conversation/agent-tab-gui-source.ts`
  - `packages/shell/ipc/harness-gui.ts`
  - `packages/shell/ipc/terminal.ts`
  - `packages/shell/preload/harness-gui-api.ts`
  - `packages/shell/preload/shell.ts`
  - `packages/shell/main/terminal/gui.ts`(새 file)
  - `packages/shell/main/terminal/ipc.ts`
  - `packages/shell/main/terminal/agent/ingress.ts`
  - `packages/shell/main/terminal/agent/tracker.ts`
  - `packages/shell/main/desktop/wiring/extensions.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`
  - `packages/shell/main/desktop/main.ts`
  - `packages/shell/main/extensions/registry.ts`
  - `packages/shell/main/extensions/registry_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/index.ts`
  - `packages/shell/terminal-host/shell-integration.ts`
  - `packages/protocol/coding-agent/terminal-hook.ts`
  - `packages/coding-agent/local/hook.ts`
  - `packages/design/i18n/catalog/project.ts`
  - `tools/wireframes/pages/screens/harness-gui.tsx`
  - `packages/shell/terminal-host/main.ts`(host의 signal 요청)
  - `packages/shell/terminal-host/foreground.ts`
  - `packages/shell/terminal-host/env.ts`(상위 session 표지 목록 export)
  - `packages/shell/main/terminal/gui_test.ts`(새 file, 위험 test)
- 계약:
  - 쓰는 것: acp-session의 `AcpTerminal`, `ExtensionAcp.open`·`onTab`, `HarnessGuiAdapter.handoff`·`exitTui`, `HarnessGuiRun.stop`·`tuiCommand`, `AgentTabSource.act`
  - 내놓는 것: `AcpTerminal`의 구현(shell main), 탭의 GUI view와 toggle, 탭 요청 hook event, adapter가 받는 `spawn`(login shell env 전체, 상위 session 표지를 뺀 env, process group째 끄기)

- 읽을 것:
  - 계획: `project-docs/plan/harness-gui-tab/README.md`의 정한 것 1, 2, 6, 7, 8, 11
  - 계약: `project-docs/plan/harness-gui-tab/tasks/acp-session.md`의 "내놓는 것"(`AcpTerminal`, `ExtensionAcp.open`·`onTab`, `HarnessGuiAdapter`·`HarnessGuiRun`, `AgentTabSource.act`)
  - architecture: `project-docs/architecture/terminal-agent.md`(hook socket, tracker, shell 시작 층), `project-docs/architecture/harness-gui.md`(첫 판), `project-docs/architecture/extension.md`, `project-docs/architecture/workspace-layout.md`(detach)
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/code.md` §1~3·§5, `wrappers.md` §3·§4, `claude.md` §2, `omp.md` §3, `codex.md` §3, `opencode.md` §3
  - 본보기:
    - "이 터미널 안 program이 그 탭을 가진 창에 일을 시킨다": browser bridge `packages/shell/main/browser-bridge/bridge.ts:36-58`, `packages/shell/renderer/terminal/use-bridge-open-requests.ts:18-65`
    - main이 PTY에 치는 길: `packages/shell/main/terminal/ipc.ts:222-238`, `settled`(`packages/shell/main/desktop/wiring/coding.ts:246-264`)
    - card 머리: `packages/shell/renderer/shell/card-head.tsx`(`useCardHead`의 `actions`). `AgentView`의 `trailing`(`packages/shell/renderer/conversation/agent-view.tsx:108`)이 header를 거쳐 card 머리 actions에 선다(`header/agent-header.tsx:266-269`)
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery page)

## 할 일

1. 탭 요청 길(hook socket, 정한 것 6).
   - `packages/protocol/coding-agent/terminal-hook.ts`: 탭 GUI 요청 event 이름 `TERMINAL_GUI_EVENT = "lophn-gui"`와 payload schema `{cwd: 절대 경로, resume?: string}`(resume은 `[A-Za-z0-9._-]{1,200}`)을 더한다.
   - `packages/coding-agent/local/hook.ts`: event가 `lophn-gui`면 stdin JSON(`{resume?}`)에 `cwd: ctx.cwd`(그 함수를 친 shell의 폴더)를 더해 보낸다. 나머지 event는 지금 그대로다. main은 shell이 `cd`한 뒤의 폴더를 모른다(`terminal-agent.md` "shell이 `cd`한 뒤의 폴더는 모른다").
   - `packages/shell/terminal-host/shell-integration.ts`: `claude`·`codex`·`opencode` 함수의 gui 분기를 바꾸고 `omp` 함수를 새로 둔다(`__lophn_external omp`일 때만, gui 분기 밖은 `command omp "$@"`).
     - 받는 꼴은 셋뿐이다: `<harness> gui`, `<harness> gui --resume <id>`, `<harness> gui --resume=<id>`. id가 `[A-Za-z0-9._-]` 밖이거나 다른 인자가 있으면 사용법을 stderr에 찍고 2로 끝난다.
     - 맞으면 `{"resume":"<id>"}`(없으면 `{}`)를 `command '<cli>' hook <harness> lophn-gui`의 stdin으로 넘긴다. id를 고른 글자로 막아 JSON escape가 필요 없다.
     - `LOPHN_HOME=` 접두를 지운다(data root를 쓰지 않는다). `<cli>`는 지금처럼 shell main이 넣는 경로다(개발 앱에는 `lophn`이 PATH에 없다).
     - sh(bash·zsh)와 fish 둘 다 고친다. gui가 아닌 호출은 지금 그대로다.
   - `writeShellInit(fs, runDir, cli, dataRoot)`에서 `dataRoot`를 뺀다. 부르는 곳은 `packages/shell/main/desktop/wiring/agent.ts:246` 하나다.
   - `packages/shell/main/terminal/agent/ingress.ts`: `lophn-gui` 줄은 tracker로 보내지 않고 아래 2로 보낸다. key → `terminal_ref`는 지금 대응을 쓴다(모르는 key는 버린다).
2. shell main의 탭 GUI(`packages/shell/main/terminal/gui.ts`, 새 file). electron을 import하지 않는 부분(요청 처리, env 만들기)은 test할 수 있게 둔다.
   - 요청 `{terminal_ref, harness, cwd, resume?}`를 받는다. extension `harness-gui`가 꺼져 있으면 지금의 `showExtensionSettings()`를 부르고 끝낸다. 그 탭에 이미 GUI handle이 있으면 새로 열지 않고 그 탭을 GUI view로만 바꾼다.
   - 그 터미널의 `AcpTerminal`을 만든다:
     - `id` = `terminal_ref`, `harness`
     - `cwd` = 요청의 cwd(TUI→GUI 때는 tracker가 hook에서 읽은 cwd)
     - `env` = 그 터미널에 준 `LPN_TERMINAL_HOOK`. GUI가 띄운 CLI의 hook도 같은 탭으로 와서 GUI turn 동안에도 탭의 상태 점이 맞는다(`codex.md` §4의 11번).
     - `state()`·`sessionId()` = tracker(`packages/shell/main/terminal/agent/tracker.ts`)
     - `type(text)` = 아래 3, `signal(sig)` = 아래 4, `onForegroundExit` = tracker의 foreground가 harness에서 shell로 돌아올 때
   - `ExtensionAcp.onTab.gui(request)`를 부른다. extension이 handle을 열면 shell main은 "이 터미널에 GUI가 열렸다 `{terminal_ref, handle, harness, handoff}`"를 모든 창에 보내고, 그 탭을 가진 창이 ack한다(browser bridge와 같은 꼴). 1.5초 안에 ack가 없으면 handle을 닫는다.
   - 창의 toggle `{terminal_ref, to}`를 받는다(아래 6, 7).
   - 터미널이 닫히거나 restart되면 그 터미널의 handle을 닫는다.
   - handle registry는 지금 `packages/shell/main/desktop/wiring/extensions.ts`의 것(갱신 buffer, attach replay)을 쓰고 terminal_ref로도 찾게 한다. 첫 판 창 port(`AcpWindowPort`, `openHarnessGui`)는 남긴다(wave 3 `gui-cleanup`).
3. main이 PTY에 치는 길. `packages/shell/main/terminal/ipc.ts`가 열 때 치는 것(`:222-238`, host `{type: "input"}`)을 열린 뒤에도 쓰게 함수 하나로 뺀다: `typeInto(terminal_ref, text)`는 `settled`를 기다린 뒤 친다. main이 치는 글이라 사람 입력의 focus 검사와 humanInput 알림을 거치지 않는다. `HarnessGuiRun.tuiCommand()` 한 줄 뒤에 `\r`를 친다.
4. TUI 끄기.
   - foreground process group에 signal을 보내는 host 요청 `{type: "signal", terminal_ref, generation, signal: "SIGINT" | "SIGTERM"}`을 더한다. host는 Linux에서 `foregroundOf`가 이미 읽는 tpgid(`packages/shell/terminal-host/foreground.ts`)에 `process.kill(-tpgid, signal)`을 한다. tpgid가 shell pid면(foreground가 shell이면) 보내지 않는다. Linux 밖은 `unavailable`이다.
   - **소유 밖**: `packages/shell/terminal-host/main.ts`(`HostRequest`와 처리), `packages/shell/terminal-host/foreground.ts`(tpgid를 내는 함수). lead에게 추가 소유를 받는다(보고 "계약 바꾸기 요청").
   - 끄는 순서(키와 signal)는 adapter의 `exitTui(terminal)`가 정한다. 근거: Claude는 busy면 Esc 뒤 끄기(`claude.md` §2), omp는 SIGTERM이 Ctrl+C·Ctrl+D·`/exit`와 같은 teardown을 한다(`omp.md` §3). tab-gui는 `AcpTerminal.signal`·`type`·`onForegroundExit`만 준다.
   - foreground가 5초 안에 shell로 돌아오지 않으면 전환을 멈추고 창에 오류를 보인다. SIGKILL은 보내지 않는다(대화 기록을 덜 쓴 채 끊지 않는다).
5. 탭의 view와 toggle(renderer).
   - `packages/shell/renderer/workspace/kinds/terminal.tsx`:
     - tab `fields`에 `view: "gui" | "tui"`와 `gui: {handle, harness, handoff}`를 둔다. `render`는 `view === "gui"`면 `TerminalGui`, 아니면 지금 `TerminalTab`을 그린다. PTY는 host가, xterm은 `TerminalDisplays`(`packages/shell/renderer/terminal/displays.ts:32`)가 쥐어 둘 다 그대로 산다.
     - `toStored`·`fromStored`에는 넣지 않는다. 앱을 다시 켜면 PTY도 GUI process도 남지 않아(`terminal.tsx:1`) 다시 연 탭은 shell로 시작한다.
     - `transfer`·`resume`·`receive`(`:248-262`)는 `view`와 `gui`를 `terminal_ref`와 같이 옮긴다. detach한 창이 handle id로 다시 붙는다.
   - `packages/shell/renderer/terminal/use-gui-requests.ts`(새 file): main의 "GUI가 열렸다" push를 듣고, 이 창에 그 terminal_ref의 탭이 있으면 그 탭을 `view: "gui"`로 바꾸고 ack한다. 탭은 `use-bridge-open-requests.ts`처럼 `host.windowTabs()`와 `store.get(tab.key)?.terminalRef`로 찾는다.
   - `packages/shell/renderer/terminal/terminal-gui.tsx`(새 file):
     - `AgentView`를 그 handle의 source(`agent-tab-gui-source.ts`)로 그린다.
     - handle 갱신을 `EMPTY_ACP_STATE`부터 `reduceAcp`로 접는 feed는 이 file 안에 둔다. 첫 판 `packages/shell/renderer/harness-gui/acp-feed.ts`와 같은 일인데, 그 폴더는 wave 3 `gui-cleanup`이 지우므로 import하지 않는다.
     - toggle 단추는 `AgentView`의 `trailing`으로 card 머리에 올린다.
   - `packages/shell/renderer/terminal/terminal-tab.tsx`: 그 탭에 GUI가 붙어 있거나(fields `gui`), adapter가 있는 harness의 TUI가 foreground에 돌면(`store.agentOf(tabKey)`의 harness가 `GUI_HARNESSES`에 있다) `useCardHead({actions})`로 toggle 단추를 card 머리에 올린다.
   - modal은 옮기는 길이 restart일 때만 띄운다: `handoff === "restart"`이거나, shared harness지만 그냥 `codex`·`opencode`로 시작한 TUI 대화일 때(정한 것 8). shared 길은 modal 없이 바로 바꾼다. 문구는 `packages/design/i18n/catalog/project.ts`에 둔다.
     - 제목 "Restart {harness} to switch?"
     - 본문 "Switching stops {harness} and resumes the same conversation in the {target}."
     - 멈출 일을 한 줄씩 더한다. GUI 쪽은 run이 내는 도는 일을 읽는다(acp-session이 `HarnessGuiRun`에 더하는 member: 도는 turn이 있나, background task가 몇인가. 이름은 acp-session brief를 따른다). TUI 쪽은 run이 없으니 `store.agentOf`의 running·waiting만 본다.
       - turn이 돌면 "The running turn will stop."
       - background task가 있으면 "{count} background tasks will stop."
       - 둘 다 없으면 본문만 보인다.
     - 단추 "Switch"·"Cancel".
   - `packages/shell/ipc/terminal.ts`·`packages/shell/ipc/harness-gui.ts`·`packages/shell/preload/harness-gui-api.ts`·`packages/shell/preload/shell.ts`: 탭 GUI channel을 더한다. GUI 열림 push와 ack, handle id로 connect·갱신·입력, toggle `{terminal_ref, to}`이다. 첫 판 창의 channel과 type은 지우지 않는다(`gui-window.ts`가 wave 3까지 쓴다).
6. TUI → GUI(그 탭에서 harness TUI가 돌 때 toggle).
   - 그 대화가 `codex gui`·`opencode gui`로 시작한 shared 대화면(fields `gui`가 있고 `handoff === "shared"`) TUI를 끄지 않고 view만 바꾼다.
   - 그 밖이면 modal 뒤 main이 `exitTui`로 TUI를 끈다. foreground가 shell로 돌아오면 tracker의 session id와 cwd로 `onTab.gui({terminal, harness, resume})`를 부른다.
   - tracker가 session id를 아직 모르면(hook이 안 옴) 전환하지 않고 창에 알린다.
7. GUI → TUI.
   - restart: `run.stop()`이 끝나면(adapter가 process group째 끝낸다) handle을 닫고 `tuiCommand()`를 친다. 다시 GUI로 오면 6처럼 새 handle을 연다. 같은 handle을 다시 쓰면 adapter가 앞 대화를 다시 그릴 때 줄이 겹친다.
   - shared: TUI client가 foreground에 없으면 `tuiCommand()`를 치고, 있으면 view만 바꾼다. handle은 그대로 둔다.
   - shared run에서 CLI session id가 바뀌면(GUI의 fork, `/new`, fork하는 rewind) 그 server에 붙은 TUI client는 옛 session을 보고 있다. main이 그 handle의 갱신(`session_changed`의 `cli_session`)이나 `run.sessionId()`로 바뀜을 보고, TUI client가 foreground에 있으면 그 client만 끄고(signal, server와 turn은 그대로 돈다) 새 `tuiCommand()`(새 id로 붙는 client: `codex --remote …`의 resume, `opencode --server … --session <새 id>`)를 친다. 그 뒤 toggle은 새 id를 쓴다. client가 foreground에 없으면 다음 GUI → TUI 때 새 `tuiCommand()`를 친다.
   - restart형(Claude, omp)은 다음 toggle이 그때의 최신 id(`run.sessionId()`, TUI에서는 tracker)를 쓴다. 따로 다시 띄우지 않는다.
8. CLI 환경(정한 것 11).
   - `packages/shell/main/extensions/bundled/harness-gui/index.ts`: 첫 판의 PATH만 읽기(`loginPath`, `PATH_BEGIN`·`PATH_END`)를 login shell의 env 전체로 바꾼다.
     - `${SHELL:-/bin/sh} -ilc`로 표시 사이에 `env -0`을 찍고 NUL로 나눈다.
     - rc file이 tmux나 updater를 띄우지 않게 `DISABLE_AUTO_UPDATE=true`, `ZSH_TMUX_AUTOSTART=false`, `ZSH_TMUX_AUTOSTARTED=true`를 준다(Emdash, `wrappers.md` §3).
     - 5초 안에 못 읽으면 shell main의 env를 쓴다. 처음 열 때 한 번 읽고 extension이 도는 동안 둔다.
     - adapter에 넘기는 `spawn`은 env를 `{...login env, ...terminal.env, ...부른 쪽이 준 칸}`으로 준다. 부른 쪽(adapter)은 바꿀 칸만 넘긴다(보고 "등록할 것"에 adapter task가 지킬 것으로 적는다).
   - `packages/shell/main/desktop/wiring/extensions.ts`의 `nodeSpawn`:
     - 마지막 env에서 상위 session 표지를 지운다. 목록은 `packages/shell/terminal-host/env.ts`의 `SESSION_MARKER_NAME`을 그대로 쓴다. 지금 export가 아니어서 export 한 단어를 "넘길 줄"로 고친다. 사본을 만들지 않는다.
     - env를 만드는 순수 함수(표지 지우기, `LOPHN_HOME`, 준 칸 덮기)는 `main/terminal/gui.ts`에 두고 test한다. wiring은 electron을 import해서 test하지 못한다.
     - process group째 끄기: `detached: true`로 띄우고 `kill()`이 `process.kill(-pid, "SIGTERM")`을 한다. 이미 끝난 group이면 조용히 지나간다.
9. `packages/shell/renderer/conversation/agent-tab-gui-source.ts`: `external: true`를 뗀다. 무엇이 되는지는 ACP 상태의 `session.capabilities`가 말한다(acp-screen이 읽는다). 새 ACP 입력은 acp-session의 `act`로 handle에 보낸다.
10. gallery `tools/wireframes/pages/screens/harness-gui.tsx`: 첫 판의 창 page를 터미널 탭 page로 바꾼다. fake 갱신으로 GUI view(흘러나오는 글, 도는 tool, 승인 카드), card 머리의 toggle 단추, restart modal을 보인다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 harness-gui page가 터미널 탭 GUI와 modal을 그린다.
- 위험 test(`packages/shell/main/terminal/gui_test.ts`, 새 file. **소유 밖**이라 lead가 추가 소유로 준다):
  - "한 터미널의 `lophn-gui` 요청은 그 terminal_ref의 handle만 열고, 다른 터미널의 key나 모르는 key로는 아무 handle도 열지 않는다"(가짜 ingress·extension·창).
  - "GUI가 띄우는 CLI의 env에서 상위 session 표지(`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` 등)가 빠지고, login env의 provider key(`ANTHROPIC_API_KEY` 같은 이름)와 그 탭의 `LPN_TERMINAL_HOOK`은 남는다"(env를 만드는 순수 함수).
- shell 함수는 subprocess test를 새로 만들지 않는다(사람 승인이 필요하다). 생성한 시작 층을 bash에서 가짜 `claude`·`codex`·`opencode`·`omp`·`lophn`으로 돌려 확인하고 보고한다:
  - gui가 아닌 호출의 인자(빈칸·따옴표 포함)가 그대로 원래 명령에 간다.
  - `claude gui --resume abc`와 `--resume=abc`가 `hook claude lophn-gui`의 stdin `{"resume":"abc"}`로 간다.
  - 고르지 않은 글자의 id와 다른 인자는 2로 끝난다.
  - fish가 없으면 "확인 못 함"으로 적는다.
- 남지 않음:
  - `grep -n "LOPHN_HOME=" packages/shell/terminal-host/shell-integration.ts`가 0줄이다.
  - `grep -n "PATH_BEGIN\|loginPath" packages/shell/main/extensions/bundled/harness-gui/index.ts`가 0줄이다.
  - `grep -n "external: true" packages/shell/renderer/conversation/agent-tab-gui-source.ts`가 0줄이다.
  - `grep -n "child.kill()" packages/shell/main/desktop/wiring/extensions.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. bash로 확인한 shell 함수의 입출력, 그리고 Electron 창에서 돌려 보지 못한 것(view 바꾸기, toggle, modal, PTY 치기, signal)을 적는다.

등록할 것(lead): `packages/shell/preload/shell.ts`·`desktop/main.ts`의 조립 줄이 이 task 소유라 lead 등록은 gallery `tools/wireframes/pages/index.ts`(page 이름이 바뀌면)뿐이다. 안 쓰게 된 `AgentTabSource.external` 쓰기를 떼었다고 보고한다.
