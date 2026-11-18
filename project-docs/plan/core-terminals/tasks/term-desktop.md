# term-desktop

desktop 화면을 core route의 client로 바꾼다: 터미널 탭, harness GUI 화면, Settings › Coding agents, hook 설치 물음, 저장한 session이 core route와 event를 쓴다. shell의 PTY host, tracker, extension host 사본과 터미널·harness-gui·coding IPC와 그 wiring을 지운다. 알림은 core event로 띄우고, Quit은 도는 터미널을 두거나 닫을지 묻는다.

- 단위: term (wave 4)
- 선행: `coding-core`.
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/`, `packages/shell/main/terminal/`, `packages/shell/main/extensions/`, `packages/shell/main/browser-bridge/`(모두 지운다)
  - `packages/shell/main/desktop/`, `packages/shell/main/build.ts`, `packages/shell/main/package.json`, `packages/shell/main/tsconfig.node.json`
  - `packages/shell/ipc/{terminal,harness-gui,coding}.ts`, `packages/shell/preload/`
  - `packages/shell/renderer/terminal/`, `packages/shell/renderer/workspace/`, `packages/shell/renderer/conversation/agent-tab-gui-source.ts`, `packages/shell/renderer/shell/`, `packages/shell/renderer/desktop/`, `packages/shell/renderer/conversation/message-list/run-code.ts`
  - `tools/wireframes/pages/screens/{harness-gui,bodies}.tsx`, `tools/wireframes/mock/fake-terminal.ts`, `tools/check-deps.ts`, `tools/check.ts`
  - `project-docs/module-catalog.yaml`, `project-docs/flows/areas.yaml`, `project-docs/flows/areas/{ipc,shell-desktop,shell-workspace,harness}.yaml`, `project-docs/flows/tests/shell.yaml`
- 읽을 것:
  - 계획 README "정한 것"(화면은 route로만, 터미널은 core가 연다, 출력 stream, 입력 자격, 앱을 Quit해도 터미널은 돈다, OS에 붙은 것은 shell에)
  - 계약: `project-docs/plan/core-terminals/tasks/term-contract.md` "고정할 모양"(`terminals.ts` 표, 입력 자격, 날 출력 stream의 붙는 쪽 규칙, harness-gui channel이 가는 route, event)
  - architecture: `project-docs/architecture/terminal-agent.md`(초안. 지키는 것 6~8·11~15), `harness-gui.md`, `workspace-layout.md`(터미널 탭 되붙기), `platform.md` "core 수명"(Quit, `Stop lophn`)
  - 조사 `reports/multi-device/survey-s3-shell-work.md` 1.7(Quit), 2.2(channel 목록), 그룹 B·C·I, 5.1
  - 지금 code: `packages/shell/main/desktop/wiring/{coding,agent,coding-relay,terminal-view,extensions,bridge,notice,surface,desktop,context}.ts`, `packages/shell/main/desktop/{quit,coding-connection,coding-ipc}.ts`, `packages/shell/main/desktop/core/{allowlist,host-link}.ts`, `packages/shell/renderer/terminal/{terminal-tab.tsx,store.ts,terminal-gui.tsx,use-gui-requests.ts,use-bridge-open-requests.ts}`, `packages/shell/renderer/workspace/use-surface-requests.ts`
- 계약:
  - 쓰는 것: `terminals/*`, `coding_sessions/*`, `coding_agents/*`, `acp/*` route, event `TerminalOutputAppended`·`TerminalRuntimeChanged`·`TerminalAgentSignaled`·`HookInstallAsked`·`HookInstallFinished`·`AcpUpdated`·`StateChanged{coding_sessions, terminal_saved_sessions}`, `tab_open`의 `{terminal: {terminal_ref}}`
  - 내놓는 것: 없음

## 할 일

1. **터미널 탭.** 탭이 mount될 때 PTY를 여는 길을 지운다. 새 터미널은 `terminals/open`(답의 `terminal`에 탭을 묶는다), 보기는 계약의 붙는 쪽 규칙(`terminals/watch` lease를 창마다 `watcher`로 잡고 10초마다 갱신, `terminals/snapshot{after_seq}`, `TerminalOutputAppended`의 seq로 겹침 빼기, Gateway `ready`나 seq 건너뜀에 snapshot 다시 읽기), runtime은 `terminals/list`와 `TerminalRuntimeChanged`, 크기는 `terminals/resize`, 닫기는 `terminals/close`, 탭 이름은 `terminals/name`이다. renderer가 바로 부르는 memory route(`terminals/open|close|resize|watch|name`, `terminals/rename_saved`, `coding_sessions/switch`, `coding_agents/refresh|install_hooks|uninstall_hooks|hook_answer`)를 `desktop/core/allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에, `acp/image_upload`·`acp/image_read`를 `RENDERER_UPLOAD_ROUTES`·`RENDERER_FILE_ROUTES`에 더한다(read는 저절로 열린다). `terminals/input`과 `restart`는 넣지 않는다.
2. **입력 자격(README).** 사람의 키 입력·질의 응답(`respond`)·다시 시작은 지금처럼 shell IPC로 main에 오고, main이 그 창이 그 터미널에 focus를 가졌는지(지금 `TerminalFocusTable`, `terminal/controller.ts`) 본 뒤 `terminals/input`·`restart`를 자기 `shell_capability`를 실어 부른다. focus 표와 이 짧은 IPC(입력, 응답, focus, 다시 시작)와 clipboard(copy, paste), link(Ctrl/Cmd-click을 browser 탭으로), 진단 trace는 shell에 남는다. 나머지 `shell:terminal-*` channel, `harness-gui:*` 15개, `shell:coding*` 3개는 지운다(목록 `packages/shell/ipc/terminal.ts`, `harness-gui.ts`, `coding.ts`).
3. **탭 열기 요청.** `use-surface-requests.ts`에서 `tab_open {terminal: {terminal_ref}}`는 그 터미널에 붙는 탭을 연다(새 PTY를 열지 않는다). `coding`·`tui` target 갈래와 renderer의 `handoffCommand` 사본(`packages/protocol/coding-agent/handoff.ts`로 옮겨졌다)을 지운다. 폰이나 agent가 연 터미널은 이 길로 탭이 된다.
4. **앱을 다시 켜면 붙는다.** 터미널 탭의 `terminal_ref`를 `sessionStorage`(`renderer/terminal/store.ts`) 대신 탭 layout 값으로 둔다. 다시 뜬 창은 `terminals/list`에 그 터미널이 살아 있으면 붙고, 없으면 지금처럼 새 shell을 연다. 없던 칸이 비어 있는 것이 지금 동작이라 data step은 없다.
5. **harness GUI 화면.** `terminal-gui.tsx`, `use-gui-requests.ts`, `agent-tab-gui-source.ts`가 계약의 표대로 `acp/snapshot`·`AcpUpdated`·`acp/send`·`acp/tool_body|image_upload|image_read`, `coding_sessions/list|switch_plan|switch|cli_sessions|rewind_preview`를 쓴다. 탭의 view는 `coding_sessions/list`(`StateChanged{coding_sessions}`)에서 읽는다. 열림 ack가 없어진다.
6. **Settings와 sidebar.** Settings › Coding agents(`renderer/desktop/settings/connections/`)는 `coding_agents/list|refresh|hook_status|install_hooks|uninstall_hooks`, hook 설치 물음(`renderer/desktop/hook-prompt/`)은 `HookInstallAsked`를 받아 그 터미널을 고른 창이 dialog를 띄우고 `coding_agents/hook_answer`로 답한다. 결과 알림은 `HookInstallFinished`. sidebar의 Recent는 `terminals/saved_sessions`, 이름 고정은 `terminals/rename_saved`다.
7. **알림.** `wiring/notice.ts`가 tracker 대신 `TerminalAgentSignaled`를 Gateway에서 받고, 보고 있는지(focus 표, 지킴 6의 표)로 없음·toast·OS 알림을 고른다. 누르면 지금처럼 `TerminalReveal`로 탭을 고른다. `presence/report`는 그대로다. lophn agent session 알림 길은 바꾸지 않는다.
8. **Quit(README "앱을 Quit해도 터미널은 돈다").** `desktop/quit.ts`·`wiring/desktop.ts`의 Quit 흐름: `terminals/list`에 `starting`·`running` 터미널이 있으면 "그대로 두기"(기본)와 "다 닫기"를 묻는다. "다 닫기"는 그 터미널마다 `terminals/close`를 부른 뒤 끝난다. 어느 쪽이든 core는 남긴다(`platform.md` 지키는 것 8). `stopAll`은 PTY를 끄지 않는다. tray `Stop lophn`은 지금처럼 core를 멈추고 core가 모두 닫는다. 문구는 i18n catalog(`packages/design/i18n/catalog/`)에 key로 더한다.
9. **지우기.** shell 원본 `packages/shell/terminal-host/`, `packages/shell/main/terminal/`, `packages/shell/main/extensions/`, `packages/shell/main/browser-bridge/`, `desktop/coding-connection.ts`, `desktop/coding-ipc.ts`, wiring `coding.ts`·`agent.ts`·`coding-relay.ts`·`terminal-view.ts`·`extensions.ts`·`bridge.ts`와 그 등록, `wiring/surface.ts`의 `tool_call`·`terminal_interrupt` 처리, shell `desktop/core/host-link.ts`의 coding·터미널 handler(`hello`·`visible`의 `tui`는 빈 목록을 보낸다. 칸은 `term-cleanup`이 지운다), `build.ts`의 `terminal-host` entry와 shell 쪽 extension build(새 자리는 lead가 이미 넣었다), `tsconfig.node.json`의 `../terminal-host/cli.ts`. node-pty는 `term-host`가 정한 build 자리가 계속 되게 두고 shell main에서 안 쓰게 되면 `package.json`에서 뺀다. `tools/check-deps.ts`의 `TERMINAL_HOST`와 옛 `EXTENSION_DIR` 자리를 뺀다. module catalog에서 `packages/shell/terminal-host`를 빼고 `packages/shell/main` notes를 고친다.
10. **gallery와 flows.** `tools/wireframes/pages/screens/{harness-gui,bodies}.tsx`, `tools/wireframes/mock/fake-terminal.ts`의 shell IPC type을 protocol type으로 바꾼다. 지운 channel·test file은 `areas/ipc.yaml`·`shell-desktop.yaml`·`shell-workspace.yaml`·`harness.yaml`, `tests/shell.yaml`에서 고치고, `areas.yaml`의 `entries`·`read`에서 지운 shell 자리를 빼고 core의 새 자리(`packages/core/terminals/`, `terminal-agents/`, `extensions/`)를 harness·shell-desktop area의 `read`에 둔다(`flows` skill).
11. **폰과 같이 쓰는 file.** `packages/mobile`이 `renderer/desktop/connection/events/{hooks.tsx,waiting-store.ts}`, `renderer/conversation/agent-tab-gui-source.ts` 같은 renderer file을 source로 읽는다. 이 file을 고치면 `cd packages/mobile && npm ci && npm run typecheck && npm test`를 돌리고, 깨지면 `packages/mobile`은 고치지 말고(`term-phone`의 것) 보고에 적는다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다(check가 보지 않는다). `npm run wireframes`가 되고 gallery의 harness-gui page가 그려진다. 11에 해당하면 mobile check도 통과한다.
- 위험 test: 없음(입력 자격은 `term-host`의 test가 core에서 본다). 지운 test가 지키던 권한 검사가 core 사본에 남아 있는지 본다.
- 남지 않음: `grep -rn "shell/terminal-host\|main/terminal/\|main/extensions/\|main/browser-bridge\|harness-gui:\|HARNESS_GUI_TAB_\|shell:coding\|CODING_CHANNEL\|TERMINAL_OUTPUT_CHANNEL\|TERMINAL_STATE_CHANNEL\|TERMINAL_SNAPSHOT_CHANNEL\|TERMINAL_AGENTS_CHANNEL\|TERMINAL_AGENT_SESSIONS\|handoffCommand\|GUI_HANDOFF" packages/shell tools tests`가 0줄이다(`GUI_HANDOFF`는 protocol에만 있다). 지운 화면 문구 key를 i18n catalog에서 한 번 더 grep한다.
- 새 E2E와 브라우저·subprocess를 띄우는 test는 만들지 않는다. lead가 merge 전에 진짜 Electron에서 터미널 열기, 치기, `claude gui`, Quit 뒤 다시 켜서 붙기를 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## lead가 더함

- core 쪽은 merge되어 lead가 돌려 봤다(창 없이 `terminals/open`, 입력 허락, `terminal_view/*` 화면, `terminals/watch`·`snapshot`의 seq, core가 멈추면 PTY도 끝남). 이 task는 화면을 그 route에 붙이고 shell의 옛 길을 지운다.
- hook 설치 물음: core는 shell link가 붙어 있을 때만 `HookInstallAsked`(subject `terminal:<ref>`)를 내고, link가 닫히면 거절로 본다. 그 터미널을 고른 창이 dialog를 띄우고 `coding_agents/hook_answer`로 답한다.
- Quit은 사람이 받은 결정이다: 도는 터미널이 있으면 "그대로 두기"(기본)와 "다 닫기"를 묻고, 어느 쪽이든 core는 남는다. tray `Stop lophn`은 core를 멈추고 core가 모두 닫는다.
- i18n은 desktop catalog file에 key를 더한다. `packages/design/i18n/catalog/mobile-app.ts`는 `term-phone`의 것이라 고치지 않는다. `packages/mobile`도 고치지 않는다(할 일 11).
- 실행 환경 주의: worker의 env에 `LOPHN_HOME=~/.lophn`과 `LOPHN_CLI=/usr/bin/lophn`이 있다(lead와 worker가 설치본 앱의 터미널 안에서 돈다). 앱이나 core를 띄울 때는 `ELECTRON_NO_SANDBOX=1 npm run dev`(저장소 `.dev-data`를 쓴다)나 `boot.sh`만 쓰고, `lophn`을 data root 없이 부르지 않는다.
- 진짜 Electron 확인(터미널 열기, 치기, `claude gui`, Quit 뒤 다시 켜서 붙기)은 lead와 사람이 merge 전에 한다. worker가 dev 앱을 띄워 볼 수 있으면 터미널 열기·치기·Quit 흐름까지만 보고, 실제 coding CLI(`claude` 등)는 부르지 않는다.
- 크다. 한 번에 끝나지 않으면 check가 통과하는 데까지 commit하고 남은 것을 정확히 보고한다. 두 번 실패하면 lead가 "터미널 탭과 Quit"과 "GUI, Settings, 알림"으로 쪼갠다.
