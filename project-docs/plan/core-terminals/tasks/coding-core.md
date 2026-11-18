# coding-core

터미널 coding agent의 상태를 core가 원본으로 갖는다: tracker와 hook socket, GUI handle과 ACP state, GUI↔TUI 바꾸기, coding session 열기, TUI hold, harness 감지와 hook 설치, `$BROWSER` bridge. core의 사본(`packages/core/coding-relay/`)과 그것을 채우던 link frame 받기를 걷는다. 저장한 session 기록을 새 주인의 자리로 옮긴다.

- 단위: coding (wave 3)
- 선행: `term-host`, `ext-host`.
- 소유(이 task만 고친다):
  - `packages/core/terminal-agents/`(새 폴더), `packages/core/coding-relay/`(지운다), `packages/core/terminal-view/`, `packages/core/host-queue/hold.ts`, `packages/core/server/host-link.ts`
  - `packages/core/terminals/`, `packages/core/extensions/`(둘 다 이 일에 필요한 만큼. `ports.ts`는 계약)
  - `packages/core/main/daemon/wiring/{terminal-agents,coding-relay,terminal-view,session-lifecycle,attention,harness,host-queue,acp,context,terminals}.ts`(`terminal-agents.ts`는 새 file, `coding-relay.ts`는 지운다)
  - `packages/protocol/coding-agent/handoff.ts`(새 file), `packages/protocol/coding-agent/{relay,terminal-view}.ts`(주석과 설명만. 모양은 계약이다)
  - `project-docs/module-catalog.yaml`, `project-docs/flows/tests/{core-rest,core-extensions}.yaml`, `project-docs/flows/areas/{harness,sessions}.yaml`
- 읽을 것:
  - 계획 README "정한 것"(일을 가진 process, 화면은 route로만, 터미널은 core가 연다, 입력 자격, OS에 붙은 것은 shell에, 저장된 것)
  - 계약: `project-docs/plan/core-terminals/tasks/term-contract.md` "고정할 모양"(자리, `relay.ts`에 더한 것, `coding-agents.ts`, event `TerminalAgentSignaled`·`HookInstallAsked`·`HookInstallFinished`, link 목록)
  - architecture: `project-docs/architecture/terminal-agent.md`(이 계획의 초안. 지키는 것 1~10, 18~20), `harness-gui.md`(지키는 것, handle·toggle), `acp.md`(GUI session의 redaction), `coding-agent.md`(hook 설치, harness agent hold), `remote.md`(폰의 coding session과 터미널 보기), skill `.claude/skills/harness-gui/SKILL.md`
  - 조사 `reports/multi-device/survey-s3-shell-work.md` 1.1(hook path), 1.2, 1.3(hold), 그룹 C·D·E, 2.4 표, 2.6 표
  - 지금 code: `packages/shell/main/terminal/{gui,harness-tui,coding-open,coding-relay,terminal-view}.ts`, `packages/shell/main/terminal/agent/`, `packages/shell/main/browser-bridge/`, `packages/shell/main/desktop/coding-connection.ts`, `packages/shell/main/desktop/wiring/{agent,coding,coding-relay,terminal-view,bridge,notice}.ts`, `packages/shell/renderer/shell/agent-sections.tsx`의 `handoffCommand`, core 쪽 `packages/core/coding-relay/`, `packages/core/main/daemon/wiring/{coding-relay,session-lifecycle,attention,harness,host-queue,acp,terminal-view}.ts`
- 계약:
  - 쓰는 것: `ctx.terminals`·`ctx.personEnv`(`term-host`), `ctx.extensionHost.tabHandlers()`(`ext-host`), `packages/protocol/coding-agent/{terminals,coding-agents,relay}.ts`, `GUI_HANDOFF`, `hostTabTargetSchema`의 `{terminal: {terminal_ref}}`
  - 내놓는 것: `terminals/saved_sessions`·`rename_saved`, `coding_agents/*`, `coding_sessions/cli_sessions`·`rewind_preview` handler, event `TerminalAgentSignaled`·`HookInstallAsked`·`HookInstallFinished`. `term-desktop`과 `term-phone`이 이것만 본다.

## 할 일

1. **사본.** 계약의 "옮기는 법"대로 shell 원본은 두고 `packages/shell/main/terminal/agent/`(test 포함), `terminal/gui.ts`·`gui_test.ts`, `terminal/harness-tui.ts`, `packages/shell/main/browser-bridge/`(test 포함), `desktop/coding-connection.ts`·test를 `packages/core/terminal-agents/`로 복사해 고친다. `terminal/coding-relay.ts`, `terminal/terminal-view.ts`, `terminal/coding-open.ts`는 가져오지 않는다(link와 창 기다림이라 core에서는 필요 없다). 사라지는 사본: `gui.ts`의 `GUI_HANDOFF`(protocol 것을 쓴다), `ipc/coding.ts`의 `HARNESS_IDS`·`HarnessName`(protocol `HARNESS_IDS`), `coding-connection.ts`의 `Detection`(`harnessDetectionSchema`), shell의 frame type 사본들. module catalog에 `packages/core/terminal-agents`(boundary `core`)를 올리고 `packages/core/coding-relay`를 뺀다.
2. **per-run 폴더, hook, bridge.** core가 자기 per-run 폴더를 공통 socket 자리에 만든다(`platform.md`의 "hook·browser bridge도 공통 socket 자리를 쓴다"와 같은 규칙, 이름만 `core-<pid>`). hook socket(`LPN_TERMINAL_HOOK`)과 `$BROWSER` shim·bridge socket을 거기에 열고, `ctx.terminals`의 열기 env hook으로 터미널마다 key를 준다. 시작 층 file(`shell-init/`)도 여기 쓰고 `lophn` 경로는 `ctx.personEnv.cli`다. bridge의 열기는 shell이 붙어 있으면 그 터미널의 project에 `tab_open {browser: {url}}`를 넣어 답을 기다리고, 붙어 있지 않거나 창이 거절하면 declined로 답해 shim이 OS browser로 연다(README "OS에 붙은 것은 shell에 남는다").
3. **tracker.** tracker는 `ctx.terminals`의 foreground·출력(OSC 제목)·사람 입력(끊기 key)·runtime 바뀜을 듣고, 바뀐 agent 값과 탭 이름을 `ctx.terminals.patch`로 runtime에 싣는다(그래서 `TerminalRuntimeChanged`가 간다). 알릴 계기(지킴 6의 1.5초 debounce 뒤)에 core 안에서 attention의 terminal signal 처리(지금 `wiring/attention.ts`가 `terminal_sessions/signal`에서 하는 일)를 바로 부르고 `TerminalAgentSignaled`를 낸다. 새 turn과 터미널 끝에 unseen을 지우는 것도 core 안에서 부른다.
4. **저장한 session.** session store의 자리를 `<data root>/terminal-agents/sessions/<project>.json`으로 옮기고 `terminals/saved_sessions`·`rename_saved`를 둔다(바뀌면 `StateChanged{terminal_saved_sessions, id: project}`). `wiring/terminal-agents.ts`의 `dataSteps`에 `terminal-agents.sessions-move`를 둔다: `<data root>/shell/agent-sessions/*.json`을 내용과 mode 그대로 새 자리로 옮기고, 새 자리에 같은 file이 있으면 건드리지 않고, 다시 돌아도 같다. 옛 폴더는 다 옮긴 뒤 지운다. 모양은 바꾸지 않는다(README "저장된 것").
5. **GUI handle.** `TabGui`를 core에서 돌린다: `<harness> gui` hook(`lophn-gui`)과 toggle이 `ctx.extensionHost.tabHandlers()`를 부르고, `AcpTerminal`은 `ctx.terminals`와 tracker 위에 만든다. 창 ack(1.5초)와 `phoneOpening` 갈래는 지운다(handle은 창과 상관없이 core에 있다). 상태는 core가 바로 들고 `acp/snapshot`·`acp/send`·`AcpUpdated`·`acp/tool_body|image_upload|image_read`가 이것을 읽는다. 지금 사본에 거는 redaction(`wiring/coding-relay.ts`, `acp-build.ts`의 `redactDeep`)은 route와 event로 나가는 자리에 그대로 둔다(`acp.md`). `coding_sessions/cli_sessions`·`rewind_preview`는 handle의 `sessions`·`rewindPreview`다.
6. **coding session route.** `coding_sessions/list|switch_plan|switch`는 core의 tracker와 handle에서 만든다(목록은 shell 연결과 상관없다. `shell` 칸은 지금 뜻 그대로 link가 붙었는지다. 칸과 `wake`는 `term-cleanup`이 지운다). `coding_sessions/open`은 `ctx.terminals.open`에 `<harness> gui [--resume <cli_session>]`을 command로 주고 `tab: {}`로 연다(사람이 치는 것과 같은 길, 창이 없어도 열린다). 앱이 session을 멈추면(`wiring/session-lifecycle.ts`의 `callTerminalInterrupt`) host queue 대신 그 harness의 끊기 key를 core가 친다. session lifecycle의 터미널 session 표는 `coding_report`와 3초 유예 대신 core의 tracker에서 채운다.
7. **탭 열기.** `tabs/open`의 `coding`(handoff)과 `tui` target은 core가 터미널을 열고(`coding`은 `coding_agents` 설정의 `commands`와 handoff 문장으로 command를 만든다. 순수 함수를 `packages/protocol/coding-agent/handoff.ts`로 옮겨 `handoffCommand`와 같은 결과를 낸다. renderer의 사본은 `term-desktop`이 지운다. `tui`는 `resume`) `tab_open {terminal: {terminal_ref}}`를 넣는다(`wiring/host-queue.ts`). TUI hold는 hello·visible의 `tui` 대신 core가 resume으로 연 터미널에서 그 harness가 foreground로 도는 동안 건다: `ctx.harnessHold.heartbeat`(`wiring/harness.ts`, `host-queue/hold.ts`)를 tracker가 부르고, `packages/core/server/host-link.ts`의 `heartbeat` dep과 `wiring/host-queue.ts`의 그 연결을 지운다(frame의 `tui` 칸은 `term-cleanup`이 지운다).
8. **harness 감지와 hook 설치.** `coding_agents/list|refresh`는 `ctx.personEnv.cli`로 `lophn harness detect|refresh`를 부른다(지금 `coding-connection.ts`). `hook_status|install_hooks|uninstall_hooks`는 hook-install을 부른다. 처음 알아본 harness의 설치 물음은 `HookInstallAsked`를 내고 `hook_answer`를 기다린다(거절은 이 실행에서 다시 묻지 않는다, 지킴 9). 결과는 `HookInstallFinished`다.
9. **폰의 터미널 보기.** `packages/core/terminal-view/view.ts`의 deps를 link(`callCoding`) 대신 `ctx.terminals`로 바꾼다: lease가 있는 동안 250ms 간격으로 `screen`을 읽어 화면을 두고(`terminal_screen` frame을 받지 않는다), 입력은 허락을 본 뒤 사람 입력으로 쓰고, 크기는 폰 크기 표지로 잡고 lease가 다 끝나면 놓는다(지킴 18). `known`은 core의 coding session 목록과 폰이 연 터미널이다. `terminal_view/open|input`은 `term-cleanup`이 지울 때까지 `terminals/open|input`과 같은 길을 부른다.
10. **link 받기 걷기.** core에서 `coding_report`·`coding_sync`·`coding_closed`·`terminal_screen` frame handler, `callCoding`·`callTerminalInterrupt`를 부르는 곳, `packages/core/coding-relay/`, `wiring/coding-relay.ts`를 지운다. protocol의 frame·kind 정의는 `term-cleanup`이 지운다. `relay.ts`·`terminal-view.ts`의 주석에서 "host(shell main)가 갖는다"를 고친다.
11. flows: 새·지운 test file(`tests/core-rest.yaml`, `core-extensions.yaml`), 오류나 동작이 바뀐 route(`areas/harness.yaml`, `sessions.yaml`)를 고친다(`flows` skill).

### 정한 것
- per-run 폴더 이름 `core-<pid>`: wave 4 전까지 shell의 `shell-<pid>`와 같이 있고, 같은 공통 자리 규칙을 쓴다.
- 저장 자리 `<data root>/terminal-agents/sessions/`: 주인 module 이름을 따른다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(data step이 기동에서 돈다).
- 위험 test: "`shell/agent-sessions/`를 옮긴 뒤 이어 가기(resume)에 쓰는 session 기록이 남아 있다": 옛 자리에 project file 둘(resumable session 포함)을 둔 임시 data root에 step을 두 번 돌리면, 새 자리의 store가 같은 session(harness, external_session, folder_ref, cwd, name, pinned)을 읽고 옛 자리는 비었다. 새 자리에 이미 있는 file은 바뀌지 않는다.
- 옮긴 test(`agent_test`, `gui_test`, `session-store_test`, `hook-ask_test`, bridge test)는 단정을 바꾸지 않고 통과한다. 지운 test가 지키던 권한 검사(hook key, bridge key)는 사본 test에 남아 있다.
- 남지 않음: `grep -rn "coding-relay/\|createCodingRelay\|callCoding(\|callTerminalInterrupt(\|onFrame(\"coding_\|onFrame(\"terminal_screen\"" packages/core tests`가 0줄이다. `grep -rn "shell/agent-sessions" packages/core`는 data step 한 곳뿐이다.
- 새 E2E와 subprocess·서버를 띄우는 test는 만들지 않는다. 실제 coding CLI와 provider를 부르지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는 적어도 `CODING_AGENT_ROUTES`·`relay.ts`의 새 route 등록, `terminalAgentsWiring`의 `WIRINGS` 자리(`terminalsWiring`·`extensionsWiring` 뒤), 지운 `codingRelayWiring`, `packages/protocol/coding-agent/mod.ts`의 export를 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"(wave 4 전까지 desktop은 shell의 PTY와 tracker를 쓰므로 폰과 desktop이 다른 coding session을 보고, 옛 renderer는 `tab_open {terminal: {terminal_ref}}`를 받으면 그 터미널에 붙지 않고 새 shell을 연다. 둘 다 `term-desktop`이 풀 예정된 것이라 적지 않아도 된다)

## lead가 더함

- wave 2에서 merge된 것: `packages/core/terminals/`(`createTerminals`, `routes.ts`의 입력 자격·key·watch lease, `person-env.ts`, `wiring/terminals.ts`)와 `packages/core/extensions/`(`host.ts`, `spawner.ts`, `acp.ts`, `wiring/extensions.ts`). harness-gui·harness bundle은 core에서 load된다. `wiring/extensions.ts`의 `acpOpened`는 이 task가 GUI handle을 이을 때까지 아무것도 하지 않는다.
- 터미널마다 env를 더하는 길은 `ctx.terminals.useEnv(hook)`이다(`TerminalEnvHook`은 `{env, opened(runtime|null)}`).
- 추가 소유(등록 줄만): `packages/protocol/registry.ts`(지금 `TERMINAL_ROUTES`에서 `saved_sessions`·`rename_saved`를 거르는 filter를 걷고 전부 등록, `CODING_AGENT_ROUTES` 더하기, `CODING_RELAY_ROUTES`에 `cli_sessions`·`rewind_preview` 더하기), `packages/core/main/daemon/assembly.ts`(`terminalAgentsWiring` 자리, `codingRelayWiring` 빼기), `packages/protocol/coding-agent/mod.ts`의 export. handler를 둔 같은 commit에 등록해 core 기동의 route·handler 대조가 통과하게 한다.
- 추가 소유: `packages/protocol/lophn-agent/harness-host.ts`의 TUI hold 주석(17줄 근처, "shell main이 `/host-link`로 보낸다")을 core가 거는 것으로 고친다.
- `project-docs/flows/areas/harness.yaml`의 `terminals-*`·`coding-agents-*`·`coding-sessions-cli-sessions` 등 flow에 남은 "handler는 아직 없다(계약만)" `unclear` 줄을 지우고 `code:`에 실제 core path(`packages/core/terminals/`, `packages/core/terminal-agents/`, wiring file)를 넣는다. 이 task가 harness.yaml을 소유한다.
- 크다. 한 번에 끝나지 않으면 할 수 있는 데까지 commit하고 남은 것을 정확히 보고한다(lead가 쪼갠다).
