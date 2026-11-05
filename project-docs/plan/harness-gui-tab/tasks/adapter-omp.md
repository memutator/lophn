# adapter-omp

omp adapter를 새로 만든다. `omp --mode rpc-ui`(README 정한 것 10)로 CLI의 채팅 기능 전부를 넣고, toggle은 재시작이다(정한 것 7). omp hook이 `/new`·`/resume`·`/branch`·`/fork` 뒤에도 session id를 갱신하게 고친다. 녹화는 lead가 돌린다(이 기계의 omp 18.8.7).

- 단위: adapter (wave 3)
- 선행: acp-core, acp-screen, tab-gui
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`(새 file)
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/`(새 폴더)
  - `packages/coding-agent/harnesses/hook-bodies.ts`(omp extension 본문)
  - `packages/protocol/coding-agent/harness-adapter.ts`(omp 칸의 hook event 목록)
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/omp.md` 전부(§1 RPC 경계, §2 기능표, §3 넘기기와 lease·SIGTERM·session id 빈틈·env, §4 adapter 모양·capability·shell 함수·녹화 scenario 13), `wrappers.md` §3(함정 표)
  - 판: 이 기계의 omp는 18.8.7(`~/.bun/bin/omp`, 설치 package `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/`에 `src/`가 같이 있다). lab 문서와 소스는 18.14.2다. 동작은 설치본 `src/`로 확인한다. 18.8.7에 없는 것: 승인의 "for this session" 선택지, `navigate_tree`·`set_label`, `dictation_*`, plan mode와 승인 mode를 바꾸는 RPC 명령
  - protocol: lab `/home/pyosechang/projects/harness-lab/omp/omp-cli/docs/rpc.md`(frame, `negotiate_protocol`, `rpc_chunk`, 명령 목록), 설치본 `src/modes/rpc/rpc-types.ts`(18.8.7의 실제 명령), 승인 `src/extensibility/extensions/wrapper.ts:403-421`, `src/tools/approval.ts:366-384`
  - 본보기(데스크톱 앱): apoc `/home/pyosechang/projects/harness-lab/omp/omp-desktopapp-apoc/src-tauri/src/agent/`(`spawn.rs:200-256` 띄우기, `mod.rs:57-126` event filter와 명령, `approvals.rs`·`approval.rs:82-105` 승인 맞추기), nornzach `/home/pyosechang/projects/harness-lab/omp/omp-desktopapp-nornzach/src/main/`(`sidecar.ts:357-361`, `shell-env.ts:1-28`), gooey-pi `/home/pyosechang/projects/harness-lab/gooey-pi/gooey-pi-desktopapp/electron/main/agent-rpc/harness-adapter.ts:253-301`
  - lophn: 본보기 adapter `packages/shell/main/extensions/bundled/harness-gui/claude.ts`(이 wave에 adapter-claude가 고치는 중. 꼴만 맞춘다), omp hook 본문 `packages/coding-agent/harnesses/hook-bodies.ts:141-215`(`ompExtension`), omp 칸 `packages/protocol/coding-agent/harness-adapter.ts:285-311`, `project-docs/architecture/terminal-agent.md`(hook이 session id를 알리는 길)
  - 계약: 이 계획의 `tasks/acp-session.md`, `tasks/tab-gui.md`
- 계약:
  - 쓰는 것: acp-session의 `HarnessGuiAdapter`(`handoff: "restart"`), `HarnessGuiRun`, `AcpTerminal`, `AcpSessionMeta`·`session_changed`, 새 `AcpInput`. omp 18.8.7 RPC
  - 내놓는 것: adapter 표의 `omp` 칸(lead가 `unavailable` stub을 이 adapter로 바꾼다)

## 할 일

띄우기와 시작
1. 받은 `spawn`으로 `omp --mode rpc-ui --cwd=<cwd> [--resume=<id>]`를 띄운다(`--resume`은 값이 선택이라 `=` 꼴이어야 한다, apoc `spawn.rs:200-212`). `--approval-mode`는 넘기지 않는다(사람 설정. 이 기계는 설정이 없어 yolo라 승인 카드가 뜨지 않는다. 보고에 적는다). login shell env 전체와 상위 session 표지 빼기는 tab-gui가 준 `spawn`이 한다(README 정한 것 11, nornzach가 env 전체를 받는 이유: provider key가 rc file에 있다).
2. `ready` frame 뒤 `negotiate_protocol {protocolVersion: 2}`를 보내고 `rpc_chunk`를 다시 붙인다. `set_ask_dialog {enabled: true}`, `set_event_filter {events: null}`(18.8.7에서는 `message_update`의 전체 snapshot을 받아 앞 길이와 비교해 새 글만 낸다. delta는 18.13.2부터 믿을 만하다, apoc `mod.rs:57-62`).
3. 시작 상태: `get_state`(sessionId, model, thinking, contextUsage, todoPhases, sessionName, isSettled), `get_available_commands`, `get_available_models`, `get_available_thinking_levels`를 읽어 `session_changed`로 `AcpSessionMeta`를 낸다: `cli_session`, `title`, `models`·`model`(provider/modelId), `efforts`·`effort`(thinking level), `commands`(name, description, `input.hint` → `argument_hint`), `usage`(contextUsage), `modes`는 비운다(18.8.7에 plan mode RPC가 없다), `capabilities`: model, effort, commands, rewind, fork, compact, rename, usage, steer, queue_edit, images, retry는 true, mode·rewind_files는 false. `available_commands_update`·`model_changed`·`thinking_level_changed`가 오면 다시 낸다.
4. resume이면 `get_messages_page`로 앞 대화를 그린 뒤 입력을 받는다(`rpc.md:254-262`).

CLI → ACP
5. 사람 `message_start/end`는 창이 낸 `message_added`와 겹치지 않게 거른다. assistant `message_update` → `writing_streamed`, `message_end` → `message_recorded`(text와 thinking → reasoning). `tool_execution_start/end` → `tool_started/ended`: edit·write는 `edit`(path), `ask`는 `question`, 나머지 `generic`. `isError`이고 글이 `Tool call denied by user:`로 시작하면 거절로 끝난 tool이다(`wrapper.ts:416-421`).
6. turn: `prompt_result {status}`와 `agent_end`로 끝낸다(`aborted` → 멈춤, `error` → 실패와 `error.message`). `session_settled`/`get_state.isSettled`가 쉬는 중이다.
7. `queue_update {steering[], followUp[]}` → ACP 줄(omp는 queue id가 없어 글 → ACP id 표를 둔다). `auto_retry_*`, `notice`, compaction event(`manual_compaction_*`, `auto_compaction_*`), `command_output` → notice `info`. `subagent_lifecycle/progress`(`set_subagent_subscription progress`) → subagent 줄. `todoPhases` → todo.
8. 승인: `extension_ui_request method:"select"`의 title 첫 줄이 `Allow tool: <name>`이면 그 이름으로 가장 최근에 도는 tool에 `approval_opened`를 낸다(select에 toolCallId가 없다. apoc `approval.rs:82-105`와 같다). once → `extension_ui_response {value: "Approve"}`, reject → `"Deny"`. "이 session 동안"은 선택지 가운데 `Approve `로 시작해 `for this session`으로 끝나는 것이 있을 때만(18.14.2) 내놓고 그 값을 답한다. 18.8.7에는 없으니 내놓지 않는다. 영구 규칙(`always`)은 내놓지 않는다.
9. 그 밖의 `select`/`confirm`/`input`/`editor`는 ACP 질문 하나, `ask`는 질문 묶음(`answers[{id, selectedOptions, customInput?}]`), `open_url`·`notify`는 notice `info`.

사람 입력(ACP → RPC)
10. `send`: 쉬는 중이면 `prompt {message, images?}`, 도는 중 delivery steer면 `prompt {streamingBehavior: "steer"}`, 다음 turn이면 `follow_up`. `send_queued` → `promote_queued_message`, `remove_queued` → `remove_queued_message`, `edit_queued`·`move_queued` → 지우고 다시 넣는다. `stop` → `abort`. `retry` → 그 turn의 사람 글을 다시 `prompt`.
11. `set_model {model, effort?}` → `set_model {provider, modelId}`와 `set_thinking_level`. `run_command` → `prompt "/<name> <argument>"`(`data.agentInvoked: false`면 명령만 돈 것). `compact` → `compact`. `rename` → `set_session_name`.
12. `rewind {message}`: 매 turn 뒤 `get_entries {since}`로 ACP 사람 메시지 id ↔ omp entry id 표를 둔다(RPC의 `messageId`는 process마다라 entry id가 아니다, `rpc.md:921`). rewind = `branch {entryId}`(돌려준 `text`를 composer에 돌려준다. 새 session file이라 `get_state`로 새 sessionId를 읽어 `session_changed.cli_session`). `files`는 omp에 없으니 capability가 false다. `fork {message}` = `fork {entryId}`. 둘 다 도는 중이면 omp가 거절하니(`session_busy`) 쉬는 중에만 보낸다.
13. images: `prompt.images`(ImageContent). `@file`은 RPC에서 거절되니 글로 넣지 않는다(`rpc.md:23`).

toggle(README 정한 것 2, 7)
14. `handoff: "restart"`. omp는 session마다 OS lease(`~/.omp/run/session-owners/<id>`)를 잡고, 두 번째 process가 쓰면 새 id의 형제 file로 옮겨 대화가 말없이 갈라진다(`omp.md` §3). 그래서:
    - GUI → TUI: `HarnessGuiRun.stop()`은 쉬는 중이 아니면 `abort` 뒤, RPC process에 SIGTERM을 보내고 끝날 때까지 기다린다. `tuiCommand()`는 `omp --resume=<지금 id>`(branch·fork·`new_session` 뒤에는 `get_state`의 새 id).
    - TUI → GUI: `exitTui(terminal)`은 탭의 omp가 쉬는 중일 때 `terminal.signal("SIGTERM")`를 보낸다(Ctrl+D는 입력창이 비었을 때만 끝나고 사람이 바꿀 수 있어 쓰지 않는다. SIGTERM은 Ctrl+D와 같은 정리를 한다, 설치본 `src/modes/interactive-mode.ts:2036-2058`). `terminal.onForegroundExit` 뒤에야 `start({resume: terminal.sessionId()})`.
    - 잃는 것: 도는 subagent·background job, 이 session의 덮어쓴 설정(fast mode 등). modal 문구는 tab-gui 몫이다.

omp hook의 session id(README 정한 것 7, `omp.md` §3 "Session id tracking gap")
15. `hook-bodies.ts`의 `ompExtension` 본문에 `session_switch`와 `session_branch` 처리를 더해 새 `session_id`를 알린다(`/new`·`/resume`·`/branch`·`/fork` 뒤. omp는 `session_start`를 시작할 때만 낸다). `harness-adapter.ts` omp 칸의 `events`에 `session_switch: "SessionStarted"`, `session_branch: "SessionStarted"`를 더한다(tracker는 id가 바뀌면 session을 바꾼다, `terminal-agent.md`).

녹화(README 정한 것 13)
16. `fixtures/omp/record.ts`를 쓴다: 사람 PATH의 `omp`를 `--mode rpc-ui`로 띄워 아래 scenario를 차례로 몰고, 보낸 줄과 받은 줄을 JSONL로 `.dev-data/adapter-omp/<scenario>.jsonl`에 쓴다. scenario(`omp.md` §4의 13과 하나 더): (1) thinking이 있는 글 turn, `negotiate_protocol` v2와 `set_event_filter` 답, (2) 기본 yolo의 tool turn(read와 bash), (3) `--approval-mode=write`에서 bash 승인 Approve, 다른 것 Deny, (4) `set_ask_dialog` 뒤 `ask` tool 답, (5) 도는 중 steer, follow-up 줄, `remove_queued_message`, `promote_queued_message`, `queue_update`, (6) `abort`와 `abort_and_restore_queue`, (7) `get_available_*`, `set_model`, `set_thinking_level`, (8) `compact`, (9) `get_entries` 뒤 사람 entry에 `branch`(돌려준 글, `get_state`의 새 sessionId)와 `fork {entryId}`, (10) TUI가 만든 session id를 `--mode rpc-ui --resume=<id>`로 이어 받기와 `get_messages_page`, 그 반대(앞 process가 끝난 뒤면 형제 file이 생기지 않음을 확인), (11) `/usage` 또는 `/context`의 `command_output`, (12) `task` subagent와 `set_subagent_subscription progress`, (13) provider 오류 turn(`prompt_result.status: "error"`), (14) 가짜 `LPN_TERMINAL_HOOK` socket을 준 채 `new_session`과 `branch`를 해 할 일 15의 extension이 새 session id를 알리는지. 다 쓰면 멈추고 보고한다. lead가 사람 허락 아래 돌린다. test는 record.ts를 돌리지 않는다.
17. 녹화를 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 scrub 규칙대로 `fixtures/omp/`에 옮긴다(path, provider key, 사람 config, model 목록은 test가 읽는 만큼만).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`omp_test.ts`, 녹화로 만든 fixture로 가짜 process를 돌린다. 진짜 omp를 띄우지 않는다):
  - "승인 select는 창이 답하기 전까지 `extension_ui_response`를 보내지 않고, 거절하면 tool이 거절로 끝난다"
  - "'이 session 동안'은 18.8.7의 선택지(Approve, Deny)에서는 내놓지 않고, 영구 규칙은 어느 판에서도 답하지 않는다"
  - "toggle은 한 session에 두 process를 같이 띄우지 않는다: TUI → GUI는 `onForegroundExit` 전에 omp를 띄우지 않고, GUI → TUI는 RPC process가 끝나기 전에 `tuiCommand()`를 내지 않는다"(가짜 `AcpTerminal`)
- 남지 않음: 없음(새 adapter).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 18.8.7에서 안 되어 뺀 기능(plan mode, 승인 mode 바꾸기, "이 session 동안")과, 녹화로 확인하지 못한 RPC 동작을 적는다.

## lead가 더한 것

- (lead가 더함) adapter가 받는 `spawn`은 login shell env < 탭 hook env < 넘긴 key 순서로 합친다(`tab-gui`). adapter는 자기가 바꾸는 key만 넘기고 env 전체를 복사해 넘기지 않는다(그러면 login shell env를 덮는다).
