# harness-gui

lophn 터미널 탭에서 `claude gui`(`codex gui`, `opencode gui`, `omp gui`)를 치면 그 탭이 채팅 화면으로 바뀌고, 탭 머리의 toggle로 같은 대화를 GUI와 그 CLI 자신의 TUI 사이에서 오간다. 뒤에서는 사람이 설치하고 로그인한 그 CLI가 돌고, extension `harness-gui`의 adapter가 CLI의 이벤트를 lophn ACP 갱신으로, 화면의 ACP 입력을 CLI 호출로 옮긴다. 화면은 lophn 채팅 화면(`AgentView`)이 ACP만 보고 그린다. 그 session은 CLI 자신의 session이고 lophn ledger에 기록하지 않는다. 계약은 `packages/protocol/extensions/acp-session.ts`(handle, `AcpTerminal`, `onTab`)와 `packages/shell/main/extensions/bundled/harness-gui/adapter.ts`(`HarnessGuiAdapter`, `HarnessGuiRun`), 탭 쪽 shell main은 `packages/shell/main/terminal/gui.ts`, 탭 화면은 `packages/shell/renderer/terminal/terminal-gui.tsx`, 채팅 화면의 source는 `packages/shell/renderer/conversation/agent-tab-gui-source.ts`, extension은 `packages/shell/main/extensions/bundled/harness-gui/`(adapter는 harness마다 file 하나), 터미널 함수는 `packages/shell/terminal-host/shell-integration.ts`다.

## 흐름

```
터미널 탭: claude gui [--resume <id>]   (shell 시작 층 함수. gui, gui --resume <id>, gui --resume=<id>만 받고 id는 [A-Za-z0-9._-]
  │                                     200자까지. 첫 인자가 gui가 아니면 원래 명령)
  ─▶ {"resume":…} | <lophn CLI> hook claude lophn-gui   (hook.ts가 친 곳의 cwd를 더해 그 탭의 hook socket LPN_TERMINAL_HOOK로)
shell main hook ingress ─ key로 그 터미널 ─▶ main/terminal/gui.ts
  ─▶ tracker로 AcpTerminal(그 탭의 harness·session id·상태(shell이면 foreground에 harness 없음)·cwd, type·signal·onForegroundExit)
  ─▶ extension onTab.gui({terminal, harness, resume})   (extension이 꺼져 있으면 Settings › System › Extensions)
       ─▶ ctx.acp.open({terminal, harness, title, handoff}) ─▶ handle
       ─▶ 그 탭에서 TUI가 돌면 adapter.exitTui(terminal) ─ foreground가 끝나기를 5초까지 기다린다(SIGKILL 없음)
       ─▶ adapter.start({cwd, resume, session: handle, terminal, spawn, clock, ids}) ─▶ run
  ─▶ 모든 창에 "GUI 열림" push ─ 그 탭을 가진 창이 1.5초 안에 ack ─ 탭이 GUI view(AgentView)로 바뀐다. ack가 없으면 handle을 닫는다
탭 머리의 toggle
  GUI→TUI  restart(Claude·omp): modal(돌던 turn, run.running()의 background task 수) ─▶ run.stop ─▶ handle을 닫음 ─▶ PTY에 run.tuiCommand()
           shared(Codex·OpenCode): TUI client가 foreground에 없을 때만 tuiCommand를 친다. 보이는 쪽만 바뀐다
  TUI→GUI  restart: modal(tracker의 running·waiting) ─▶ exitTui ─▶ 새 handle과 start(resume)
           shared: 보이는 쪽만 바뀐다. 그냥 codex·opencode로 시작한 TUI는 처음 한 번 restart처럼 넘긴다
shared 대화의 CLI session id가 바뀌면(fork, /new) 붙은 TUI client를 SIGTERM하고 새 id로 tuiCommand를 다시 친다
터미널이 끝나거나 다시 시작하면 handle을 닫는다. extension을 끄면 연 handle을 모두 닫는다
```

## 지키는 것

- **harness는 `claude`, `codex`, `opencode`, `omp` 넷이다.** 목록은 `GUI_HARNESSES` 하나이고 터미널 함수와 adapter 표가 이것을 쓴다. omp adapter는 아직 `unavailable`이다.
- **handle 하나는 터미널 탭 하나다.** `id`(`win_…`)는 lophn session id가 아니다. 탭의 view(`view`·`gui` 칸)는 저장하지 않는다(앱을 다시 켜면 PTY도 CLI process도 남지 않는다). 창을 다시 load하면 view는 터미널로 돌아간다. 탭을 다른 창으로 옮기면 view와 handle이 따라간다. handle은 창이 닫히거나 `close()`될 때까지 publish된 갱신을 모두 쌓고, 창 쪽이 `attach`하면 처음부터 다시 보낸 뒤 이어서 보낸다(창이 늦게 열려도 같은 상태). `close()`는 창과 extension이 같이 쓰는 한 길이고 두 번 불러도 `onClose`는 한 번이다.
- **TUI 끄기와 쳐 넣기는 main이 한다.** main은 PTY에 글을 쳐 넣는다(`typeInto`, 이미 도는 shell이라 첫 출력을 기다리지 않는다). terminal-host의 `signal` 요청은 foreground process group에 SIGINT·SIGTERM을 보낸다(Linux만, foreground가 shell이면 아무것도 안 한다). foreground가 끝난 것은 1초마다 보는 foreground 변화로 안다. Windows는 foreground를 몰라 toggle이 없다.
- **adapter는 harness마다 하나이고 `Result`로 시작한다.** `start`가 실패하면 창은 닫지 않고 오류를 끝난 turn으로 보인다. 사람이 닫는다.
- **extension은 `ctx`로만 닿는다**([extension.md](extension.md)). CLI는 `ctx.spawn`으로 띄우고 사람의 설정과 login을 그대로 쓴다.
- **CLI는 사람의 login shell env로 띄운다.** 데스크톱 메뉴나 autostart로 뜬 앱의 env에는 사람의 shell 설정(nvm의 PATH, rc file의 API key)이 없다. `index.ts`가 처음 열 때 한 번 `${SHELL:-/bin/sh} -ilc`로 env 전체를 `env -0`으로 읽고(tmux·updater guard, 5초), login env < 탭 hook env < adapter가 넘긴 key 순서로 합친다. 상위 session 표지(`packages/shell/terminal-host/env.ts`의 `SESSION_MARKER_NAME`, `CLAUDE_CODE_ENTRYPOINT` 포함)는 지운다. CLI는 떼어 띄우고 process group째(`kill(-pid)`) 끈다.
- **창은 desktop 창의 한 화면이다.** detached 창과 같이 desktop entry를 `#harness-gui=<id>` hash로 연다. 창 제목은 harness 이름과 cwd 끝 폴더다. main은 창이 보낸 id가 아니라 sender(webContents)로 handle을 찾는다. 창은 snapshot 없이 `EMPTY_ACP_STATE`부터 갱신을 `reduceAcp`로 접는다. `reread`가 서도 다시 읽을 것이 없다. 그래서 adapter가 `seq`를 1부터 빈틈없이 붙인다.
- **창은 lophn 채팅 화면(`AgentView`)을 그대로 쓰고 lophn 전용 기능을 숨긴다.** source의 `external: true`가 숨기는 칸이다: header의 session 바꾸기·이름·보관·fork·more 메뉴, model 고르기·skip·권한 요약, slash 메뉴(`/…`는 글로 보낸다), 메시지의 Rewind·Fork, 상태 footer와 `/status`, session 목록·검색. source가 답하지 못하는 읽기(model, 권한, call, envelope, tool 본문, 이미지 올리기)는 `unavailable`이나 `not_found`다. 입력창 글은 "Message <harness>…"이고, 승인 카드의 always는 "Allow for this session"이다(adapter가 그 CLI session 안으로 좁힌다).
- **입력의 `session`은 창이 만든 값이다.** adapter는 보지 않는다. 사람 메시지는 `send` 입력의 `id`로 `message_added`가 된다. turn·tool·승인 id는 adapter가 `ctx.ids`로 만들어 CLI의 id와 짝짓는다.
- **터미널 함수는 `gui`만 가로챈다.** shell 시작 층의 `claude`·`codex`·`opencode` 함수는 첫 인자가 `gui`면 shell main이 알려 준 CLI 경로(개발은 `LOPHN_CLI`, 설치본은 `lophn`. 터미널 env에서는 `LOPHN_*`가 빠진다)로 그 shell main의 data root를 `LOPHN_HOME`에 넣어 `gui <harness> …`를 부르고, 아니면 인자를 그대로 원래 명령에 넘긴다([terminal-agent.md](terminal-agent.md)).

## Claude Code adapter

`claude.ts`(restart). Agent SDK(`@anthropic-ai/claude-agent-sdk`, 판 고정)의 `query()`를 streaming input으로 연다.
- `pathToClaudeCodeExecutable: "claude"`를 늘 넘기고 process는 `spawnClaudeCodeProcess`로 `ctx.spawn`을 거친다. SDK가 넘기는 env 중 shell main의 `process.env`와 값이 다른 key만 넘긴다(그러지 않으면 login shell env를 덮는다). SDK의 OS별 claude 사본은 root `package.json`의 `overrides`가 빈 package(`tools/empty-package`)로 바꿔 받지 않는다. extension build(`buildExtensions`)는 SDK가 모듈 맨 위에서 쓰는 `import.meta.url`을 bundle file의 URL로 채운다.
- 새 session은 `ids`로 만든 UUID를 `sessionId`로 넘겨 첫 turn 전에 CLI session id를 안다. `settingSources` user·project·local, `systemPrompt` preset `claude_code`, partial message, `perTaskStopAffordance`(멈춰도 background task는 산다), `enableFileCheckpointing`(파일 rewind)를 켠다. permission mode는 넘기지 않는다(사람 설정). `bypassPermissions`는 쓰지 않는다.
- meta: `supportedModels`(effort 축), `supportedCommands`(터미널 전용 명령은 뺀다), `getContextUsage`를 첫 메시지 전에 읽어 `session_changed`로 낸다. mode와 model은 첫 turn의 `system/init`에서야 안다(그 전과 resume 직후는 null).
- 사람 메시지마다 `uuid`를 붙인다. 도는 중에 보낸 것은 delivery가 steer면 `priority: "next"`, 다음 turn이면 `"later"`이고, CLI의 `command_lifecycle`(queued, started)이 줄과 `message_taken`을 정한다. 지금 보내기·빼기·고치기·옮기기는 `cancelAsyncMessage`(sdk.d.ts에는 없고 sdk.mjs에 있다)로 한다. 지금 보내기(`now`)는 도는 명령을 멈추고 그 turn은 멈춘 turn이다.
- 입력: `set_model`(CLI가 거절한 model은 다음 띄우기에 넘기지 않는다), `set_mode`(`setPermissionMode`), effort는 숨긴 `/effort`, `run_command`, `compact`, `retry`, `rename`, 이미지(`file://` link를 읽어 base64). local 명령(`/effort`, `/context`, `/compact`, `setModel`)의 답은 합성 메시지와 `local_command` result로 온다.
- 승인: `canUseTool`마다 카드. 이 session 동안은 SDK 제안을 `destination: "session"`으로 바꿔 돌려주고, always는 제안이 session 밖을 가리킬 때만 내놓고 그대로 돌려준다(영구). session 규칙과 폴더는 들고 있다가 다시 열 때 `allowedTools`·`additionalDirectories`로 넣는다. ExitPlanMode는 plan 카드이고 한 번은 `default`, 이 session 동안은 `acceptEdits`로 간다.
- rewind는 `rewindFiles`(dry run 뒤 실제)와 `resume` + `resumeSessionAt` + `forkSession` + 새 `sessionId`로 다시 연다. fork는 SDK `forkSession`으로 같은 탭에서 다시 연다. 둘 다 잘린 구간을 `hidden_added`로 숨기고(adapter가 `reduceAcp`로 상태를 접어 둔다) 새 `cli_session`을 낸다.
- toggle: 탭에 TUI가 보이면 `start`는 `conflict`다. `exitTui`는 SIGINT를 0·300·900ms에 보내고 foreground가 끝나면 돌아온다. `stop`은 도는 turn을 멈추고 query를 닫고 process가 끝나기를 기다린다. `tuiCommand`는 `stop`이 끝난 뒤에만 `claude --resume <id> [--permission-mode] [--model] [--effort] [--add-dir …] [--allowedTools …]`(GUI에서 고른 값만)를 낸다. `running`은 turn과 background task 수다.
- spawn env에 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`을 넣는다. SDK(비대화) mode의 CLI는 이 flag가 있어야 TUI처럼 TaskCreate·TaskUpdate·TaskList를 낸다. TaskCreate(id는 결과 글 "Task #N created")·TaskUpdate(성공한 결과만, deleted는 `cancelled`)와 TodoWrite가 `plan_changed`가 되고 그 tool 줄은 숨긴다. resume은 다시 읽은 tool 결과로 목록을 다시 만든다.
- 명령: SDK 줄은 출처(init의 skills·plugins와 이름 꼴)로 가르고 화면이 대신하는 CLI 줄과 TUI 전용 줄은 뺀다. adapter 줄은 model, effort, permissions(`opens: "mode"`), plan(toggle), rename, rewind, fork, status, usage(별칭 cost, stats), context, goal, clear(별칭 reset, new)다. `/clear`는 열린 query에 보내지 않고(session id가 바뀐다) 같은 탭에 새 query를 연다. 명령 출력(합성 `assistant` + `local_command_run`, user replay `local-command-stdout`, `system/local_command_output`)은 `command_output`, stderr는 warning이다.
- subagent: 대화마다 lane을 두고 자식 메시지(`parent_tool_use_id`)를 `child_update`로 낸다. Agent 줄이 subagent detail이고 `task_started`·`task_progress`·`task_updated`·`task_notification`이 `tool_detail_changed`로 바꾼다. 끝난 자식은 `getSubagentMessages`로 채운다(최종 글은 stream에 오지 않는다). `stop_child`·`stop_task`는 `stopTask`다. background task(`local_bash`)는 `tasks`이고 subagent(`local_agent`)는 Agent 줄로만 보인다.
- 사용 한도는 `rate_limit_event`(`unifiedWindows` five_hour·seven_day, utilization 0–1, `resetsAt` 초), `/context` 분해는 `getContextUsage`, 제목은 `getSessionInfo`다. 사람 메시지 `origin`은 SDK uuid이고 resume해도 같다. 빈 session(메시지 없음)은 `claude --resume`이 못 열어 `tuiCommand`가 `--session-id`를 쓴다. fast·thinking toggle은 TUI로 넘기는 flag가 없어 넘어가지 않는다.
- 상위 session 표지를 지우면 CLI가 transcript의 entrypoint를 `sdk-cli`로 쓴다. 그래서 `listSessions({includeProgrammatic:false})`에는 GUI session이 없다. resume은 id로 한다.

## Codex adapter

`codex.ts`(shared). 탭마다 `codex app-server --listen unix://<mkdtemp 0700>/codex.sock`를 띄우고(env key를 넘기지 않는다), GUI는 그 socket 위 WebSocket(`ws`) client이고 TUI는 `codex resume <thread> --remote 'unix://<sock>' --cd "$PWD"`로 같은 server에 붙는다. app-server는 thread 하나에 connection 여럿을 붙이고 이벤트와 승인 요청을 모두에게 보낸다.
- `initialize`에 `capabilities {experimentalApi: true}`. `config/read`로 사람 설정을 읽어 `never`이거나 `danger-full-access`일 때만 `approvalPolicy: "on-request"`, sandbox `workspace-write`로 덮는다. resume은 `thread/resume {excludeTurns: true}` 뒤 `thread/turns/list`를 나눠 읽어 앞 대화를 그린다.
- 다른 client(TUI)가 보낸 사람 메시지도 그린다: `turn/start`·`turn/steer`에 `clientUserMessageId`를 실어 제 것과 가른다. 설정 바꾸기는 `thread/settings/update`이고 `thread/settings/updated`가 양쪽에 온다. 다른 thread의 이벤트는 `threadId`로 거른다.
- 승인: 요청의 `availableDecisions`에 있는 것만 낸다(이 session 동안은 `acceptForSession`이 있을 때만). 거절은 `decline`이고 turn은 이어 간다. 영구 결정(execpolicy·network amendment)은 영구라고 표시한다. 다른 client가 먼저 답하면 `serverRequest/resolved`로 카드를 답 없이 닫는다. turn이 끝날 때 `cancel`을 보내지 않는다(남의 turn까지 멈춘다). 사람이 멈출 때만 아직 열린 승인에 `cancel`이다. patch 승인은 `file_change` subject다.
- 질문(`item/tool/requestUserInput`)은 질문 카드이고 답은 질문 id로 돌려준다. MCP elicitation은 거절하고 notice를 낸다.
- 기능: 사용량, model·effort, 권한 mode, rewind(마지막 메시지만, `thread/revert`, file은 그대로), fork(`thread/fork`가 부른 client를 바로 구독시킨다), `!` shell(`thread/shellCommand`, 제 turn을 연다), file mention. 명령 표는 `opens` 줄(model, permissions, status, usage, rename, fork, agents)과 adapter 줄(compact, review, goal, plan(`canPlan`일 때), new(별칭 clear), init(TUI의 내장 prompt 글), mcp, diff(`git`), ps, stop)이다. review 글은 뒤따르는 `agentMessage`로 그리고 `exitedReviewMode`는 무시한다(같은 글이 두 번 온다). warning·configWarning·`model/rerouted`는 warning info다. 이미지는 아직 끈다.
- subagent: 대화마다 lane을 두고 자식 thread의 이벤트를 `child_update`로 낸다. `spawnAgent` 줄이 subagent detail이고 `wait`·`closeAgent`·자식 turn 끝이 `tool_detail_changed`로 바꾼다. `stop_child`는 자식 turn에 `turn/interrupt`, `steer_child`는 `turn/steer`(쉬고 있으면 `turn/start`)다. 자식이 연 승인·질문은 root 카드다. lane이 열리기 전(spawn item이 끝나기 전)에 온 자식 이벤트는 버린다.
- background task는 `thread/backgroundTerminals/list`와 도는 subagent이고 root `turn/completed`, `/ps`, `stop_task` 뒤에 다시 읽는다. background 명령의 tool 줄은 turn 끝에 cancelled로 닫는다(`terminate` 뒤 `failed`로 다시 오는 `item/completed`는 무시한다).
- plan: `plan` toggle(`set_toggle`, `/plan`)이 collaboration mode를 바꾼다. plan mode turn이 `plan` item으로 끝나면 "Implement" 카드(plan subject)를 내고, 고르면 default mode로 바꾸고 "Implement the plan."을 보낸다(실제 `plan` item으로는 아직 확인하지 않았다). goal은 `thread/goal/*`(active goal을 정하면 turn이 스스로 시작한다), 사용 한도는 `account/rateLimits/read`·`updated`(`resetsAt` 초)다. 추가 권한 요청(`item/permissions/requestApproval`)은 승인 카드이고 답은 늘 `scope: "turn"`이다. 사람 메시지 `origin`은 `clientId ?? item.id`이고 resume해도 같다.
- `exitTui`는 PTY에 Ctrl+C(`\x03`)를 700ms 간격으로 네 번까지 친다(Codex TUI의 Ctrl+C는 한 번에 입력 지우기 → 멈추기 → 끝내기).
- turn이 없는 thread는 `thread/resume`이 "no rollout found"라 첫 메시지 전에는 TUI로 넘어가지 못한다(`tuiCommand`가 notice를 낸다).

## omp adapter

`omp.ts`(restart). `omp --mode rpc-ui --cwd=… [--resume=…]`(env key를 넘기지 않고 `--approval-mode`도 넘기지 않는다. 사람 설정이 없으면 yolo라 승인 카드가 뜨지 않는다). omp 18.8.7 기준이다.
- 시작: `negotiate_protocol` v2(`rpc_chunk`를 다시 붙인다), `set_ask_dialog`, `set_event_filter {events: null}`, `set_subagent_subscription events`. ready 전에 끝나면(잘못된 key 등) stderr 꼬리로 시작 실패다.
- meta: model과 thinking 축, 명령(`available_commands_update`, branch·fork 뒤 다시 온다), 사용량(context만), capability. todo는 `get_state.todoPhases`를 `plan_changed`로. 승인 mode를 바꾸면 그 자리에서 omp를 `--resume`·`--approval-mode`로 다시 띄운다(아직 저장되지 않은 session이면 `--resume` 없이). plan mode는 18.8.7에 RPC가 없다. 파일 rewind는 없다. 사용량은 `get_session_stats`와 `usageLimit`, goal은 `goal` op(`get_state.goal.goal`, 버리면 null), fast·slow는 toggle이다(cheap model에서는 fast가 거절된다. slow는 `slowModeScope`가 session일 때만 낸다. 전역이면 사람 설정을 쓴다). role은 `~/.omp/agent/config.yml`과 `<cwd>/.omp/config.yml`의 `modelRoles`를 읽고 `use_role`은 `prompt "/switch @role"`만 보낸다(설정은 쓰지 않는다).
- 흘러나오는 글은 `message_update`의 전체 snapshot을 앞 것과 diff한다. steer는 `steering: true`인 사람 `message_end`로 온다. 줄 고치기는 steer·follow-up·빼기·올리기(`promote_queued_message`)이고 고치기·옮기기는 빼고 다시 넣는다.
- 질문(`ask`)은 `extension_ui_request`가 그 tool의 `tool_execution_start`보다 먼저 와서 질문의 tool id로 tool 줄을 연다. 그 밖의 dialog(select, confirm, input, editor)는 질문 하나로 낸다. 승인은 "Allow tool:" select를 같은 이름의 가장 최근 tool에 맞춘다. 거절하면 tool이 `isError`로 끝나고 turn은 이어 간다.
- rewind·fork는 그때 `get_entries`로 사람 메시지 순서에 맞는 entry를 찾아 `branch`·`fork`하고 `hidden_added`로 숨긴다.
- 명령: 출처는 omp 자신의 목록에서 가르고 adapter가 new·clear(`new_session`), fork, branch·tree, goal을 더한다. 명령 출력(`command_output` frame, 자르지 않는다)은 늘 `turn: null` notice이고 ANSI를 지운다. frame에 이름이 없어 마지막에 보낸 명령을 기억한다. 도는 중 명령은 `prompt` + `streamingBehavior: "followUp"`(omp가 내장 명령을 streaming 검사 전에 돌린다)이고 turn을 열지 않는다. 입력칸에 친 `/이름`도 명령으로 가고 TUI 전용 이름은 막는다. `!cmd`는 `bash` RPC(멈추기는 `abort_bash`)라 model에 가지 않는다. `bash`는 tool event도 흘러나오는 출력도 없어 tool 줄은 보낼 때 열고 답에서 닫는다. model turn이 없는 session은 저장되지 않아 다시 열면 `!cmd`가 사라진다.
- subagent: `task` tool은 곧바로 "Spawned agent"로 끝나고 `subagent_lifecycle`(parentToolCallId, `detached`)이 뒤에 온다. 그래서 task 줄은 `child: null`인 subagent detail로 열고 lifecycle·progress가 `tool_detail_changed`로 채운다(turn이 끝난 뒤에 와도 `taskLines`로 찾는다). 자식은 대화마다 같은 `thread()` 상태로 `child_update`를 내고 모두 background task(`tasks_changed`)다. `stop_child`·`steer_child`는 `cancel_subagent`·`steer_subagent`다. background 일이 끝나면 omp가 스스로 turn을 연다.
- toggle: `exitTui`는 SIGTERM을 보내고 foreground가 끝나야 돌아온다(두 process가 한 session을 쓰면 omp가 새 id의 다른 file로 옮겨 대화가 갈라진다). `stop`은 도는 turn을 abort하고 마지막 `get_state`로 id를 읽고 stdin을 닫는다(lease를 놓는 omp의 정리 길). 5초 뒤에는 SIGTERM이다.
- lophn의 omp hook은 `session_switch`·`session_branch`도 알려 `/new`·`/resume`·`/branch`·`/fork` 뒤의 새 id를 tracker가 안다.

## OpenCode adapter

`opencode.ts`(shared). 탭마다 `opencode serve --stdio --port 0`을 탭 env로 띄우고 OpenCode 자신의 server API(HTTP와 `/api/event` SSE)를 손으로 짠 client로 쓴다(데스크톱 앱과 같은 경계). password는 `mkdtemp` 0700 아래 0600 file에 두고(터미널 env가 PASSWORD 이름을 지운다) TUI는 `OPENCODE_PASSWORD="$(cat '<file>')" opencode --server <url> --session <id>`로 같은 server에 붙는다. stdin을 열어 둔 것이 server의 lease다. 시작할 때 `server.info`의 판이 녹화한 2.1.4와 다르면 notice를 낸다.
- session은 `session.create`(새로) 또는 `session.get` + `session.messages`(resume, 짧은 page가 오면 멈춘다)로 연다. location의 plugin은 첫 session이 생겨야 load되므로 model·agent·명령 목록은 `model.updated`·`agent.updated`·`command.updated` 때마다 다시 읽는다.
- 흘러나오는 글은 `session.text.delta`·`session.reasoning.delta`, tool은 `session.tool.input.started`(이름)·`called`·`success`·`failed`(`write`·patch는 `edit`, `shell`, `subagent`는 `call`, `execute`는 그 code 한 줄 요약). 사람 메시지에 `metadata.lophn`을 실어 `inbox.enqueued`에서 제 것과 남의 것(TUI)을 가른다.
- 입력: `session.prompt`(도는 중이면 `delivery: "steer"` 또는 queue, inbox 고치기·빼기·옮기기는 `session.inbox.update`·`cancel`과 다시 넣기), `session.interrupt`, model·variant(`session.switchModel`), agent mode(`session.switchAgent`, build·plan 등), server 명령(`session.command`)과 client 명령, `!` shell(`session.shell`), compact, rename(`session.update`), undo·redo(`session.revert.stage`·`commit`·`clear`), 위치를 정한 fork(`session.fork`, 새 message id는 순서로 짝짓는다). 사용량은 `session.context`.
- 승인: V2 `permission.asked`(`action`, `resources`, `save`, `metadata.files`)가 카드를 연다. 한 번은 `once`, 이 session 동안은 `session.update {permissions}` 뒤 `once`, always는 그 project의 OpenCode 규칙에 영구로 저장된다고 적어 내놓는다. 거절은 이유를 실어 보내고(`permission.rejected`로 tool이 실패하고 turn은 이어 간다) 멈춘 turn으로 그리지 않는다. 다른 client가 답하면 `permission.replied`로 카드를 닫는다.
- 질문은 `form.created`가 카드를 열고 `form.reply`·`form.cancel`로 답한다(닫으면 tool은 `aborted`, 실행은 `interrupted`).
- 사람 설정을 바꾸지 않는다. OpenCode 기본 설정은 shell과 edit를 묻지 않아 ask 규칙이 없으면 승인 카드가 뜨지 않는다.
- `exitTui`는 PTY에 `/exit`와 Enter를 친다(Ctrl-C·Ctrl-D는 입력 상태와 dialog에 따라 뜻이 바뀐다).
- 새 session의 model은 server의 `/api/model/default`다(설정의 model이나 이름 순 첫 model). TUI가 쓰는 "최근 model"은 client 쪽 file이라 server가 내놓지 않는다.
- 명령: client 명령(new·clear, undo, redo, models, variants, agents, usage, status, stats, mcps, skills, export)은 `source: "harness"`이고 표의 `opens`·별칭을 싣는다. server 명령은 `/api/command`, skill 명령은 `GET /api/skill`에서 읽고 이미 있는 이름은 건너뛴다. status·stats·mcps·skills·export는 adapter가 답을 만들어 `command_output`으로 낸다(export는 `OpencodeDeps.writeExport`로 tmpdir에 쓴다). 도는 중 server 명령은 `delivery: "queue"`로 가서 같은 실행의 다음 step에 들어간다. server 명령의 사람 메시지는 펼친 template 글로 오지만 제가 보낸 것은 친 `/review` 그대로 그린다.
- undo·redo: undo가 숨긴 구간 id를 `revert.staged`에 기억하고 `session.revert.cleared`가 오면 `hidden_restored`로 되살린다(`committed`는 되살리지 않는다).
- subagent: 자식 session마다 lane(turn, seq, writing)을 두고 자식 갱신을 `child_update`로 낸다. 부모의 subagent 줄과 자식은 `session.tool.progress`의 `metadata.sessionID`로 짝짓고, detail(`child`, `state`, `last`)은 `tool_detail_changed`로 바꾼다. `background: true` 자식은 `tasks`이고 `stop_child`·`stop_task`는 `interrupt(child)`다. 다시 열면 자식 transcript를 읽어 채운다.
- todo는 `todowrite`의 `input.todos`를 `plan_changed`로 낸다(녹화한 판은 codemode라 실제 `todowrite`를 보지 못했다). 사용 한도는 `usage/limits`(실패하면 빈 목록), tool 줄은 입력·출력 `body`, 사람 메시지 `origin`은 OpenCode message id(`message_taken` 뒤 `origin_set`)다.
- auto-accept toggle: 켜면 승인 요청에 카드 없이 `once`로 답하고 이미 열린 카드도 답한다. always·session 규칙은 보내지 않는다. 상태는 adapter run에만 있다.

## 왜 이 모양인가

- **CLI 코어는 두고 화면만 바꾼다(사람, 2026-11-04 "CLI 화면을 대체하는 GUI").** Claude·Codex 데스크톱이 CLI 코어를 두고 화면만 바꾸는 것과 같은 꼴이라, session·resume·설정은 CLI의 것을 쓴다. 그래서 lophn ledger에 기록하지 않고 lophn project가 아닌 폴더에서도 돈다.
- **각 CLI의 공식 GUI 경계로 붙는다.** Claude Code는 Agent SDK, Codex는 `codex app-server`, OpenCode는 자기 server API(`opencode serve`), omp는 `omp --mode rpc-ui`다. TUI 화면을 긁지 않는다.
- **Claude는 stream-json을 직접 말하지 않고 SDK를 쓴다(사람, 2026-11-05).** 승인·멈추기·resume을 Anthropic이 맞춰 둔 것을 쓰고 CLI 판이 바뀌면 SDK 판을 올린다. 비용은 개발 `node_modules`의 SDK와 peer dependency(약 40MB)와 bundle의 1.3MB이고, 쓰지 않는 claude 사본(linux-x64 약 323MB)은 `overrides`로 뺐다.
- **Codex는 sandbox와 승인 정책을 늘 넘기고 OpenCode는 사람 설정을 그대로 쓴다.** brief가 full access를 금했고 Codex는 thread마다 정책을 받는다. OpenCode의 권한은 사람이 쓴 규칙표라 adapter가 덮어쓰면 사람의 규칙을 바꾸게 된다.
- **창이 채팅 화면을 다시 짜지 않는다.** source만 바꿔 `AgentView`를 쓰고, 없는 기능은 source의 칸 하나(`external`)로 숨긴다.
- **handle이 갱신을 쌓는다.** adapter는 창이 뜨기를 기다리지 않고 바로 publish한다. 창 쪽이 snapshot 없이 처음부터 접으면 되어 snapshot route가 필요 없다.
- **탭 요청은 extension이 건 함수가 받는다.** 꺼진 extension은 code를 load하지 않으므로(extension.md) `onTab` 함수가 없는 것이 곧 "꺼짐"이다. 그때 Settings › System › Extensions를 연다.
