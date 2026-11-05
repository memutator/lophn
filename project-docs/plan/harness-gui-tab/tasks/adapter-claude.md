# adapter-claude

Claude adapter에 CLI의 채팅 기능 전부(README 정한 것 3)를 Agent SDK로 넣고, toggle(재시작, 정한 것 7)과 첫 판 결함을 고친다. 녹화는 lead가 돌린다(정한 것 13).

- 단위: adapter (wave 3)
- 선행: acp-core, acp-screen, tab-gui
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/claude.md` 전부(§0 결론, §1 기능표, §2 넘기기, §3 첫 판 결함 1~11, §4 만들 목록 1~14), `wrappers.md` §1(happy의 재시작과 session id 추적), §3(함정 표)
  - 본보기(데스크톱 앱, 복원한 minified JS): `/home/pyosechang/projects/harness-lab/claude-code/derived/claude-code-desktopapp/main/.vite/build/index.chunk-kLQCxBgD.js`의 `query()` option(27809-27880), 승인 답(9715-9765), steer·queue(37566-37577, 38537-38620), rewind(54600-54640, 28091-28097), 다시 띄울 때 규칙 다시 넣기(26715-26731), model 고르기(54134-54336); session 넘기기 `index.chunk-QNQW4OWi.js`(321-431). 분석 `/home/pyosechang/projects/harness-lab/claude-code/notes/claude-code-desktopapp.md`
  - SDK 0.3.318 type: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `sdk-tools.d.ts`(이 worktree). 설치된 claude는 2.1.318이다
  - 첫 판 code: `packages/shell/main/extensions/bundled/harness-gui/claude.ts`(842줄), `claude_test.ts`, `fixtures/claude/`; 앞 녹화 원본 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/`(README의 scrub 규칙, claude 10 scenario)
  - 계약: 이 계획의 `tasks/acp-session.md`(ACP 새 칸, `HarnessGuiAdapter`·`HarnessGuiRun`, `AcpTerminal`), `tasks/tab-gui.md`(탭이 adapter에 주는 것)
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`, `terminal-agent.md`(탭의 claude session id는 hook이 안다)
- 계약:
  - 쓰는 것: acp-session의 `HarnessGuiAdapter`(`handoff: "restart"`), `HarnessGuiRun`, `AcpTerminal`, `AcpSessionMeta`·`session_changed`, 새 `AcpInput`. Agent SDK 0.3.318
  - 내놓는 것: adapter 표의 `claude` 칸(같은 이름, lead가 이미 연결해 둠)

## 할 일

session과 시작
1. 새 session은 `sessionId`에 lophn이 만든 UUID를 넘긴다(`SDK:2176`). resume은 `resume: <id>`. 그래서 CLI session id를 첫 turn 전에 안다. `HarnessGuiRun.sessionId()`와 `AcpSessionMeta.cli_session`이 그 값이다(조사 §3-6).
2. `query()` option에 데스크톱 앱이 넘기는 것을 더한다: `perTaskStopAffordance: true`(§3-2), `enableFileCheckpointing: true`(§3-5), `includePartialMessages`, `settingSources: [user, project, local]`, `systemPrompt` preset `claude_code`(지금 그대로). permission mode는 사람 설정을 따른다(README 정한 것 12). `bypassPermissions`는 어떤 길로도 쓰지 않는다.
3. 시작하면 `system/init`, `query.supportedModels()`, `supportedCommands()`, `getContextUsage()`를 읽어 `session_changed`로 `AcpSessionMeta`를 낸다: `models`·`model`, `efforts`·`effort`(그 model의 `supportedEffortLevels`), `modes`(default, acceptEdits, plan, auto)·`mode`, `commands`(`terminal_slash_commands`는 뺀다), `usage`, `capabilities`(model, effort, mode, commands, rewind, rewind_files, fork, compact, rename, usage, steer, queue_edit, images, retry 모두 true). `SDKCommandsChangedMessage`가 오면 `commands`를 다시 낸다(§1 Slash, §4-1).

사람 입력(ACP → SDK)
4. 사람 메시지에 `uuid`를 붙이고(ACP `msg_` id와 짝지어 둔다) `priority`를 단다(§3-4). 쉬는 중 `send`는 그대로, 도는 중 `send`는 `priority: "next"`(CLI가 줄에 세운다), `send_queued`(지금 보내기)는 `cancelAsyncMessage(uuid)` 뒤 `priority: "now"`로 다시 넣는다, `remove_queued`는 `cancelAsyncMessage`, `edit_queued`·`move_queued`는 지우고 새 꼴로 다시 넣는다(§3-3). 첫 판의 adapter 안 queue(`resendQueue`)와 "SDK에 같은 동작이 없다" 주석(`claude.ts:815`)은 지운다.
5. `set_model {model, effort?}`: `query.setModel(model)`. CLI가 거절하면 다음 spawn에 쓰도록 기억하고 `session_changed`로 지금 값을 다시 낸다. effort는 다음 prompt 앞에 `/effort <level>`을 `priority: "later"`로 넣는다(`SDK:4588`). 데스크톱 앱 54134-54336과 같다.
6. `set_mode {mode}`: `query.setPermissionMode(mode)`. ExitPlanMode 승인은 plan 승인 카드로 낸다: 그 승인의 범위 고르기에 plan 뒤 mode(default, acceptEdits, auto)를 싣고, 고른 mode를 `updatedPermissions: [{type: "setMode", mode, destination: "session"}]`로 답한다(§3-8, 데스크톱 9715-9734).
7. `run_command {name, argument}`: `/<name> <argument>`를 사람 글로 보낸다. 출력(`SDKLocalCommandOutputMessage`)은 notice `info` 항목으로 낸다(§3-10).
8. `compact`: `/compact`를 보낸다. `compact_boundary`와 `status`(compacting)는 notice `info`로 낸다.
9. `rewind {message, files}`: 대화 rewind는 query를 닫고 `resume: <id>` + `resumeSessionAt: <그 사람 메시지 앞 assistant uuid>` + `forkSession: true` + 새 `sessionId`로 다시 연다. CLI session id가 바뀌므로 `session_changed`로 새 `cli_session`을 내고, 되돌린 사람 글은 ACP가 정한 길(acp-session의 rewind 결과)로 composer에 돌려준다. `files`가 true면 먼저 `query.rewindFiles(userUuid, {dryRun: true})`로 바뀔 file을 보이고, 확인 뒤 `rewindFiles(userUuid)`를 부른다(§1 Rewind, §4-8). 다시 열 때는 할 일 13의 규칙 다시 넣기를 쓴다.
10. `fork {message | null}`: library `forkSession(id, {upToMessageId})`로 새 CLI session을 만들고, 그 탭에서 새 session으로 다시 연다(같은 탭. 새 탭은 범위 밖). `session_changed`로 새 `cli_session`(§4-9).
11. `rename {title}`: `renameSession(id, title)`. `session_changed.title`.
12. `retry`: 그 turn의 사람 메시지를 새 `uuid`로 다시 보낸다(열린 이슈 "Retry가 아무 일 없음"을 닫는다).
13. "이 session 동안" 허락: SDK 제안의 `destination`을 `session`으로 바꿔 답한다(첫 판 그대로, 실제 claude로 확인함). 그 규칙을 adapter가 들고 있다가 query를 다시 열 때마다 `allowedTools`로 다시 넣는다(§3-11, 데스크톱 26715-26731). `always`(영구)는 SDK 제안을 그대로(`localSettings` 등) 돌려주는 선택으로 내놓고, 화면 문구에 "영구로 저장된다"와 저장 위치를 적는다(README 정한 것 12).

CLI → ACP
14. 멈춤: `result.terminal_reason`이 `aborted_streaming`·`aborted_tools`이거나 lophn이 interrupt한 turn이면 멈춘 turn이다. `background_requested`·`max_turns` 등은 그대로 끝난 turn이다(§3-1, `claude.ts:632`).
15. 버리던 메시지를 낸다(§3-10): `api_retry`·`rate_limit_event`·`permission_denied`·`session_state_changed`는 notice `info`, `task_*`·`background_tasks_changed`는 subagent·background task 줄(stop 단추는 `query.stopTask(taskId)`), `result`의 `usage`·`total_cost_usd`와 `getContextUsage()`는 `session_changed.usage`.
16. 이미지: `send`의 image block을 base64 image content block으로 넣는다(MIME은 bytes로 본다, `wrappers.md` §3 images). 열린 이슈의 이미지 칸을 닫는다(창의 이미지 올리기는 acp-screen·tab-gui 몫).

toggle(README 정한 것 2, 7)
17. `handoff: "restart"`. GUI → TUI: 탭이 부르는 `HarnessGuiRun.stop()`은 도는 turn을 interrupt하고 `query.close()` 뒤 claude process가 끝날 때까지 기다린다. `tuiCommand()`는 `claude --resume <id> --permission-mode <지금 mode> --model <지금 model> --effort <지금 effort> --allowedTools <이 session 규칙…>`이다(값은 shell quote). modal 문구는 tab-gui 몫이고, adapter는 "background task가 멈춘다"를 알 수 있게 `HarnessGuiRun`이 도는 task 수를 준다(acp-session이 칸을 정하지 않았으면 계약 바꾸기 요청으로 적는다).
18. TUI → GUI: `exitTui(terminal)`은 탭의 claude가 쉬는 중일 때(`AcpTerminal.state()`가 idle) `terminal.signal("SIGINT")`를 두 번 보내거나 `/exit`을 친다(조사 §2 clean stop). `terminal.onForegroundExit`가 불린 뒤에야 `start({resume: terminal.sessionId()})`가 query를 연다. 두 process가 한 session을 같이 쓰지 않는다(데스크톱 앱 `liveOwnershipRefusal`). 앞 대화는 지금처럼 `getSessionMessages`로 그린다.
19. 상위 session 표지: adapter가 받는 `spawn`은 tab-gui가 표지를 뺀 env를 준다. SDK가 `options.env`에 shell main env를 복사하므로, `spawnClaudeCodeProcess`에서 그 env를 그대로 쓰지 말고 받은 `spawn`의 env 규칙을 따른다(§3-7). `CLAUDE_CODE_ENTRYPOINT`는 SDK 기본값 그대로 둔다(정한 것은 보고에).

녹화(README 정한 것 13)
20. `fixtures/claude/record.ts`를 쓴다: 진짜 SDK `query()`를 사람 PATH의 `claude`로 돌려 아래 scenario를 차례로 몰고, scenario마다 SDK 메시지·`canUseTool` 인자와 답·`Query` method 결과를 JSONL로 `.dev-data/adapter-claude/<scenario>.jsonl`에 쓴다. 상위 session 표지(`CLAUDE*`)를 뺀 env로 띄운다. scenario: (a) 새 session에 `sessionId` 넘김 + `supportedModels`·`supportedCommands`·`getContextUsage`, (b) `setModel`과 `/effort`, (c) `setPermissionMode("plan")` 뒤 ExitPlanMode 승인(target mode acceptEdits), (d) 도는 중 `priority: "next"` 보내기와 `cancelAsyncMessage` 뒤 `now`로 다시 보내기, (e) tool이 도는 중 interrupt(`aborted_tools`)와 `perTaskStopAffordance`, (f) background task 하나와 `stopTask`, (g) Write 뒤 `rewindFiles` dry-run과 실제, (h) `resume` + `resumeSessionAt` + `forkSession` 대화 rewind, (i) library `forkSession`과 `listSessions({dir, includeProgrammatic: true})`·`renameSession`, (j) `/compact`, (k) `/context`(명령 출력), (l) image 하나 보내기, (m) SDK session을 `claude -p --resume <id>`(print mode)로 이어 받기와 그 반대(TUI 쪽 이어 받기의 대신). scenario를 다 쓰면 멈추고 보고한다. lead가 사람 허락 아래 돌려 같은 자리에 둔다. test는 record.ts를 돌리지 않는다.
21. lead가 돌린 녹화를 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 scrub 규칙대로 `fixtures/claude/`에 옮긴다(path, hook 출력, rate limit, init의 사람 MCP·plugin·skill 목록을 뺀다). 첫 판 fixture 중 이 계획에서 안 쓰는 것은 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`claude_test.ts`, 녹화로 만든 fixture로 가짜 `query()`를 돌린다. 진짜 claude를 띄우지 않는다):
  - "승인 요청은 창이 답하기 전까지 tool을 실행하지 않고, 거절하면 tool이 거절로 끝난다"(첫 판 test를 새 fixture로 남긴다)
  - "'이 session 동안' 허락은 영구 설정에 쓰지 않는다: 답의 `updatedPermissions`는 모두 `destination: "session"`이고, query를 다시 열 때 그 규칙을 `allowedTools`로 다시 넣는다"
  - "toggle은 한 session에 두 process를 같이 띄우지 않는다: TUI → GUI는 `onForegroundExit` 전에 query를 열지 않고, GUI → TUI는 `stop()`이 끝나기 전에 `tuiCommand()`를 내지 않는다"(가짜 `AcpTerminal`)
- 남지 않음: `grep -n "SDK에 같은 동작이 없다\|resendQueue" packages/shell/main/extensions/bundled/harness-gui/claude.ts`가 0줄. `grep -rn "aborted_streaming" packages/shell/main/extensions/bundled/harness-gui/claude.ts`는 멈춤 판정 한 곳뿐.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 녹화로 확인하지 못한 SDK 동작(TUI 쪽 이어 받기는 print mode로만 봤다는 것 등)과, 데스크톱 앱과 다르게 간 곳(entrypoint 등)을 적는다.

## lead가 더한 것

- (lead가 더함) adapter가 받는 `spawn`은 login shell env < 탭 hook env < 넘긴 key 순서로 합친다(`tab-gui`). adapter는 자기가 바꾸는 key만 넘기고 env 전체를 복사해 넘기지 않는다(그러면 login shell env를 덮는다).
- (lead가 더함) Agent SDK는 `spawnClaudeCodeProcess`에 shell main의 env 전체(`process.env` 복사)를 넘긴다. 그대로 넘기면 `tab-gui`의 합치기(login shell env < 탭 env < 넘긴 key)에서 shell main의 PATH 등이 login shell env를 덮는다. `spawnClaudeCodeProcess` 안에서 `process.env`와 값이 다른 key만 골라 `spawn`에 넘긴다.
- (lead가 더함) `tab-gui`가 상위 session 표지를 지울 때 `CLAUDE_CODE_ENTRYPOINT`도 지운다(`terminal-host/env.ts`의 목록). 그래서 GUI가 만든 session은 CLI session처럼 보이고 TUI의 `claude --resume` 목록에도 나온다(toggle에 맞다). "entrypoint는 SDK 기본값 그대로"인 할 일은 이것으로 바뀐다. `listSessions`에 `includeProgrammatic`이 없어도 GUI session이 보이는지 녹화로 확인한다.
