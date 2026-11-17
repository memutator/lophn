# term-contract

터미널, coding session, extension host를 core가 갖는 데 필요한 계약을 고정한다: desktop 화면과 폰이 같이 쓰는 route·event 모양, core 안 port, 옮길 자리, 나중에 지울 link 요청 목록. `architecture/terminal-agent.md`를 새 모양으로 초안한다. 구현은 하지 않는다.

- 단위: term (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/terminals.ts`(새 file), `packages/protocol/coding-agent/coding-agents.ts`(새 file), `packages/protocol/coding-agent/relay.ts`
  - `packages/protocol/extensions/routes.ts`(새 file), `packages/protocol/extensions/acp-session.ts`
  - `packages/protocol/events/transient.ts`, `packages/protocol/events/changes.ts`
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/core/terminals/ports.ts`(새 file), `packages/core/extensions/ports.ts`(새 file)
  - `packages/core/main/daemon/wiring/context.ts`
  - `tools/check-deps.ts`, `tools/check-deps_test.ts`
  - `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml`
  - `project-docs/flows/areas.yaml`, `project-docs/flows/areas/{harness,shell-desktop,sessions}.yaml`, `project-docs/flows/tests/core-extensions.yaml`(새 file)
  - `project-docs/architecture/terminal-agent.md`
- 읽을 것:
  - 계획 README "정한 것" 전부, roadmap `project-docs/products/roadmap/shell-as-client.md`
  - 조사 `reports/multi-device/survey-s3-shell-work.md`(2.2~2.4 표, 4 이어 쓸 자리, 5.4 제약)
  - architecture: `project-docs/architecture/terminal-agent.md`(지키는 것 11·12·16·18·19), `coding-agent.md`, `harness-gui.md`, `acp.md`, `remote.md`, `platform.md` "core 수명"
  - 지금 계약: `packages/shell/ipc/{terminal,harness-gui,coding,extensions}.ts`, `packages/protocol/coding-agent/{terminal-view,relay}.ts`, `packages/protocol/lophn-agent/host-queue.ts`, `packages/protocol/host-link/frames.ts`, `packages/protocol/extensions/{manifest,acp-session}.ts`, `packages/protocol/secrets/logins.ts`(`shell_capability` 입력의 본보기)
- 계약:
  - 쓰는 것: `packages/protocol/base/route.ts`(`defineRead`·`defineMemory`), `defineTransientEvent`, `WiringContext`의 늦게 채우는 칸(`Late`, `provide`·`peek`)
  - 내놓는 것: 아래 "고정할 모양". 뒤 task는 이 이름만 쓴다.

## 고정할 모양

**자리.** 옮긴 code는 core의 세 module로 간다. 모두 core의 바닥 층(feature module, `lophn-agent`, `agent-workspaces`, `main`을 import하지 않는다)이고 base·protocol만 쓰며, 다른 module이 필요하면 wiring이 port로 꽂는다.
- `packages/core/terminals/`: PTY host(`host/`, 지금 `packages/shell/terminal-host/`), supervisor(지금 `packages/shell/main/terminal/supervisor.ts`), 터미널 service(열기 순서, 출력 lease, route handler), 사람의 env와 `lophn` 경로. module catalog boundary `core`. wiring은 `packages/core/main/daemon/wiring/terminals.ts`.
- `packages/core/terminal-agents/`: tracker와 hook(지금 `packages/shell/main/terminal/agent/`), GUI handle(`terminal/gui.ts`), TUI hold(`terminal/harness-tui.ts`), coding session 열기, per-run 폴더와 `$BROWSER` bridge(지금 `packages/shell/main/browser-bridge/`), harness 감지(`desktop/coding-connection.ts`). boundary `core`. `packages/core/coding-relay/`(사본)를 대신한다. wiring은 `wiring/terminal-agents.ts`. 폴더는 `coding-core`가 만든다(이 task는 catalog에 올리지 않는다).
- `packages/core/extensions/`: registry, spawner, ACP handle, tool 호출, `bundled/harness/`, `bundled/harness-gui/`(녹화 포함). boundary `extension-host`. wiring은 `wiring/extensions.ts`.
- **옮기는 법.** wave 2·3은 shell 원본을 두고 core 자리에 사본을 만든다(`cp` 뒤 고친다). shell은 core를 import할 수 없어(`tools/check-deps.ts`의 `core를 import하는 것은 core뿐`) `tools/move-files.ts`로 옮기면 shell wiring의 import가 core를 가리켜 check가 깨진다. shell 원본은 wave 4 `term-desktop`이 지운다. 끝에는 사본이 남지 않는다.
- **type check.** core로 온 code는 core의 tsconfig 하나로 본다. shell main이 strict project(`noUncheckedIndexedAccess`)와 느슨한 wiring project(`tsconfig.node.json`)로 갈려 protocol을 import하지 못해 따로 두던 type(조사 5.4)은 core 쪽에 만들지 않는다: `ipc/terminal.ts`의 `TerminalLine`·`TerminalScreen`·`TerminalRuntime` 등, `gui.ts`의 `GUI_HANDOFF`, `ipc/coding.ts`의 `HARNESS_IDS`, `coding-connection.ts`의 `Detection`, `terminal/coding-relay.ts`·`terminal-view.ts`·`desktop/core/host-link.ts`의 frame type 사본.

**`packages/protocol/coding-agent/terminals.ts`.** schema는 `packages/shell/ipc/terminal.ts`의 같은 이름 type을 zod로 옮긴 것이다(칸 이름과 뜻은 그대로): `terminalFailureSchema`, `terminalAgentSchema`(`TerminalAgent`), `terminalRuntimeSchema`(`TerminalRuntime`), `terminalOutputSchema`(`TerminalOutput`), `terminalAgentSessionSchema`(`TerminalAgentSession`). 화면 줄은 `terminal-view.ts`의 `terminalLineSchema`를 쓴다. 터미널 참조 꼴(`trm_…`)은 바꾸지 않는다. route(resource `terminals`, 모두 actors `["user"]`, errors는 `terminal-view.ts`와 같은 여섯, 실패 이유는 `details.reason`)와 `TERMINAL_ROUTES`. 칸 `기기`는 기기 route 목록(`packages/protocol/remote/allowlist.ts`, lead가 고친다)에 드는가다:

| route | 종류 | 입력 → 출력 | 기기 |
|---|---|---|---|
| `terminals/list` | read | `{project?}` → `{terminals: TerminalRuntime[]}` | 아니다 |
| `terminals/open` | memory | `{project, folder_ref?, cwd?, command?(≤8192, 줄바꿈·tab 밖 제어 문자 없음), resume?: {harness, external_session}, key?, tab?: {relation: tabRelation \| null}}` → `{terminal, runtime}`. 같은 key는 같은 답. `tab`이 있으면 core가 그 project에 `tab_open {terminal: {terminal_ref}}`를 넣는다 | 된다 |
| `terminals/close` | memory | `{terminal, generation}` → `{runtime}` | 아니다 |
| `terminals/restart` | memory | `{terminal, generation, shell_capability}` → `{runtime}` | 아니다 |
| `terminals/input` | memory | `{terminal, generation?, text(1~8192), key?, respond?: boolean, shell_capability?}` → `{}` | 된다 |
| `terminals/resize` | memory | `{terminal, generation, columns(1~512), rows(1~256)}` → `{runtime}`. 폰이 잡은 크기를 놓는다 | 아니다 |
| `terminals/snapshot` | read | `{terminal, after_seq?}` → `{runtime, output: TerminalOutput[]}`(host `snapshot`과 같은 뜻) | 아니다 |
| `terminals/watch` | memory | `{terminal, watcher(1~64), on}` → `{}`. lease 30초, 10초마다 갱신, key는 (principal, watcher) | 아니다 |
| `terminals/name` | memory | `{terminal, name(0~200)}` → `{}`(runtime의 `tab_name`) | 아니다 |
| `terminals/saved_sessions` | read | `{project}` → `{sessions: TerminalAgentSession[]}`, reads `terminal_saved_sessions` | 아니다 |
| `terminals/rename_saved` | memory | `{project, harness, external_session, name \| null}` → `{sessions}` | 아니다 |

- **입력 자격**(README "입력 자격"): `terminals/input`은 부른 principal이 기기면 그 기기의 터미널 입력 허락(`ctx.peek.terminalInputGrant`)이 있어야 하고, 기기가 아니면 살아 있는 `shell_capability`(control `connect {client: shell}`가 준 값. `logins/release`처럼 `ctx.peek.shellCapabilities?.has`로 본다)가 있어야 한다. 둘 다 아니면 `forbidden`이다. `terminals/restart`는 늘 `shell_capability`가 있어야 한다(지금도 restart는 focus 검사를 거친다). agent 자격은 actors에서 막힌다. focus 검사는 shell main에 남고, shell main만 capability를 싣는다.
- **날 출력 stream.** event `TerminalOutputAppended`(subject `terminal:<ref>`, payload = `TerminalOutput`)를 core가 그 터미널에 `terminals/watch` lease가 하나라도 있는 동안만 Bus에 낸다. host가 16ms·64Ki 단위로 묶은 chunk 하나가 event 하나다. 붙는 쪽 규칙: `watch` → `snapshot{after_seq}` → seq가 받은 것보다 큰 event만 쓴다(다른 generation은 버린다). seq가 건너뛰거나 Gateway가 다시 열리면(`ready`) 마지막 seq로 `snapshot`을 다시 읽는다. back-pressure는 host의 묶기와 Gateway의 slow consumer 끊기(1 MiB)뿐이고 core는 터미널마다 queue를 두지 않는다.
- event `TerminalRuntimeChanged`(subject `terminal:<ref>`, `{runtime}`): runtime이 바뀔 때마다(lease와 상관없이). `shell:terminal-state` push와 `shell:terminal-agents` 읽기를 대신한다.

**`packages/protocol/coding-agent/coding-agents.ts`.** Settings › Coding agents와 hook 설치 물음. type `HarnessSettingsView`, `HarnessHookView`, `HookInstallStatus`, `HarnessDiscovery`는 `packages/shell/ipc/coding.ts`의 것을 옮기고 harness id는 protocol `HARNESS_IDS`를 쓴다. route(resource `coding_agents`, user만): `list`(read, `{}` → `{harnesses}`), `refresh`(memory), `hook_status`(read, → `{hooks}`), `install_hooks`·`uninstall_hooks`(memory, `{harness}` → `{hook}`), `hook_answer`(memory, `{request, accepted}` → `{}`). `CODING_AGENT_ROUTES`.

**`relay.ts`에 더할 것.** `coding_sessions/cli_sessions`(read, `{session}` → `{sessions: AcpCliSession[]}`), `coding_sessions/rewind_preview`(read, `{session, message}` → `{preview: AcpRewindPreview | null}`). `harness-gui:tab-sessions`·`tab-rewind-preview`를 대신한다. 나머지 harness-gui channel은 이미 있는 route로 간다: connect·update → `acp/snapshot` + `AcpUpdated`, input → `acp/send`, toggle·running → `coding_sessions/switch`·`switch_plan`, current → `coding_sessions/list`, tool-body·image·image-read → `acp/tool_body`·`image_upload`·`image_read`. 열림 ack(1.5초)는 없어진다(handle은 창과 상관없이 core에 있다).

**`packages/protocol/extensions/routes.ts`.** `ExtensionView`·`ExtensionStatus`를 `packages/shell/ipc/extensions.ts`에서 옮긴다. route(resource `extensions`, user만): `list`(read, → `{extensions}`), `install`·`remove`(memory, `{id}`), `run`(memory, `{command}`). `EXTENSION_ROUTES`. `acp-session.ts`에 `GUI_HANDOFF: Record<GuiHarness, "restart" | "shared">`를 둔다(`packages/shell/main/terminal/gui.ts`의 사본과 adapter 표가 이것을 쓰게 된다).

**event 더.** `TerminalAgentSignaled`(subject `terminal:<ref>`, `{terminal, project, harness, kind: waiting|finished|failed, name: string|null, body: string|null}`): tracker가 알릴 계기를 정한 순간 core가 낸다. shell main이 이것으로 toast·OS 알림을 고른다. `HookInstallAsked`(subject `terminal:<ref>`, `{request, terminal, harness, label, files}`), `HookInstallFinished`(subject null, `HookResult` 모양). `CHANGE_NAMES`에 `terminal_saved_sessions`.

**link.** `hostTabTargetSchema`의 `terminal` target을 `{terminal: {terminal_ref?: string}}`로 넓힌다(계획 동안만 optional, `term-cleanup`이 필수로 한다). 지우지 않고 목록만 적는다(`term-cleanup`이 지운다): 요청 `tool_call`, `terminal_interrupt`, `coding_input`, `coding_switch`, `coding_open`, `coding_body`, `coding_image_write`, `coding_image_read`, `terminal_stream`, `terminal_input`, `terminal_resize`, `terminal_open`과 `LINK_REQUEST_KINDS`; frame `coding_report`, `coding_sync`, `coding_closed`, `terminal_screen`, `hello`·`visible`의 `tui`; host 탭 target `coding`·`tui`; route `coding_sessions/wake`, `coding_sessions/list`의 `shell` 칸, `terminal_view/open`, `terminal_view/input`, `extension_tools/publish`, `terminal_sessions/signal`. 남는 것: `tab_open`·`tab_close`·`tab_show`, `browser_call`, frame `hello`·`visible`·`response`·`report`. 폰의 화면 사본(`terminal_view/snapshot|watch|resize`, `TerminalScreenChanged`)은 그대로다.

**core port.** `packages/core/terminals/ports.ts`: `Terminals`(open·close·restart·write(사람 입력인지 표지)·signal·resize(폰 크기 표지)·snapshot·screen·list·runtime·patch(agent, tab_name)·onRuntime·onOutput·onForeground·onHumanInput·anyOpen·stop), open 입력에 터미널마다 더할 env를 주는 hook(`coding-core`가 hook·bridge env를 꽂는다), `PersonEnv`(`env(): Promise<Record<string,string>>`, `cli: string | null`). `packages/core/extensions/ports.ts`: `ExtensionHost`(list·install·remove·run, callTool(extension, tool, input, 부른 session·workspace), catalog, tabHandlers(harness-gui의 `onTab`), sync, stop). `context.ts`의 `Late`에 `terminals`, `personEnv`, `extensionHost`를 더한다.

## 할 일

1. 위 protocol file과 칸을 만든다. 새 route 배열은 등록하지 않는다(handler가 생길 때 구현 task가 등록할 것을 보고한다). protocol 최상위 사이 순환이 생기면(`coding-agent` → `extensions`) type만 import하고, 막히면 `PROTOCOL_CYCLE_EXCEPTIONS`에 이유와 함께 둔다.
2. `ports.ts` 둘을 type만으로 쓰고 `context.ts`의 `Late` 칸과 그 표를 더한다.
3. `tools/check-deps.ts`의 `EXTENSION_DIR`를 목록(`packages/shell/main/extensions/bundled/`, `packages/core/extensions/bundled/`)으로 바꾸고 `check-deps_test.ts`를 맞춘다.
4. module catalog에 `packages/core/terminals`(boundary `core`)와 `packages/core/extensions`(boundary `extension-host`, notes: `bundled/<id>/`는 shell-extension이라 protocol·base·자기 폴더만 import)를 올린다. boundary catalog에서 `extension-host`를 core 쪽 설명으로 고치고 `harness-host-core` 설명의 "실행은 shell의 host가 한다"를 core 안 extension host로 고친다. host-link interface 설명은 그대로 둔다(줄이는 것은 `term-cleanup`).
5. flows: 새 route·event를 area(`harness`, `shell-desktop`, `sessions`)에 올린다(`flows` skill). `areas.yaml`의 `test_groups`에 `core-extensions`(paths `[packages/core/extensions/]`)를 `core-rest` 앞에 두고 빈 `tests/core-extensions.yaml`(`group: core-extensions`, `files: []`)을 만든다. `node tools/flows.ts check`가 통과한다.
6. `architecture/terminal-agent.md` 초안: 모델과 지키는 것에서 "shell main"이 갖던 것(PTY host, tracker, hook 받기, 상태, 저장)을 core로, 화면은 route로 붙고 focus 검사와 알림 띄우기와 clipboard만 shell에 남는다는 것, 출력 lease와 seq, Quit 뒤에도 도는 것을 고친다. code path는 쓰지 않는다. 다른 architecture 문서는 lead가 끝에 고친다.

### 정한 것
- 폰 화면 사본 route는 그대로 두고 열기·입력만 `terminals/*`로 합친다: README 범위 밖이 "폰이 날 글자로 그리기"이고 크기 잡기는 lease에 묶인 폰만의 규칙이다.
- 날 출력은 Bus의 남지 않는 event로 싣는다: renderer가 이미 쓰는 Gateway 하나로 가고, 놓쳐도 snapshot으로 맞추는 규칙(`event.md`)과 같아 새 연결이 필요 없다.
- `core-extensions` test group: wave 2의 두 task가 같은 `tests/core-rest.yaml`을 고치지 않게 한다.

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다.
- 위험 test: 없음(모양만 둔다).
- 남지 않음: 없음(더하기만 한다). 지울 것은 위 "link" 목록으로 `term-cleanup`이 지운다.

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
