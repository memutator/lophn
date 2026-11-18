# harness-gui reference

harness GUI를 고칠 때 보는 구현 쪽 참고다. 설계(문제, 지키는 것, 결정)는 `project-docs/architecture/harness-gui.md`에 있고, 여기는 그 설계가 어느 file·함수·CLI 호출로 이루어지는지와 CLI마다 겪은 세부를 모은다. code를 고쳐 어긋나면 같이 고친다. 작업 순서와 확인 방법은 SKILL.md다.

## 곳

| 무엇 | 곳 |
|---|---|
| 계약(handle, `AcpTerminal`, `onTab`) | `packages/protocol/extensions/acp-session.ts` |
| adapter 계약(`HarnessGuiAdapter`, `HarnessGuiRun`) | `packages/core/extensions/bundled/harness-gui/adapter.ts` |
| extension 본체(탭 요청, env, toggle, session id 따라가기) | 같은 폴더 `index.ts` |
| adapter(harness마다 하나) | 같은 폴더 `claude.ts`, `codex.ts`, `opencode.ts`, `omp.ts`, `antigravity.ts` |
| 받은 메시지 분류 | 같은 폴더 `received.ts`(`classifyReceived`) |
| 탭 쪽 core(handle 쥐기, 20ms 묶음, toggle, 이미지 tmp file) | `packages/core/terminal-agents/gui.ts` |
| 화면으로 내기(목록, `acp/snapshot`·`AcpUpdated`, 입력, 본문, 그림, switch) | `packages/core/terminal-agents/coding-sessions.ts`, `acp/*` 갈래는 `packages/core/main/daemon/wiring/acp.ts` |
| 폰의 열기(`coding_sessions/open`) | `packages/core/terminal-agents/open.ts` |
| route 계약(`coding_sessions/*`) | `packages/protocol/coding-agent/relay.ts` |
| extension host(registry, spawner, ACP handle) | `packages/core/extensions/`(`host.ts`, `spawner.ts`, `acp.ts`) |
| 탭 화면 | `packages/shell/renderer/terminal/terminal-gui.tsx`(`GuiSwitch`), `packages/shell/renderer/terminal/model.ts`(`terminalName`), session key는 `packages/protocol/lophn-agent/session-tag.ts`(`guiSessionId`) |
| 채팅 화면의 GUI source | `packages/shell/renderer/conversation/agent-tab-gui-source.ts` |
| 채팅 화면 key handler | `packages/shell/renderer/conversation/agent-view.tsx`(routes) |
| 터미널 함수 | `packages/core/terminals/host/shell-integration.ts` |
| hook 보내기 | `hook.ts`가 cwd를 더해 그 탭의 hook socket `LPN_TERMINAL_HOOK`으로 |
| 상위 session 표지 | `packages/core/terminals/host/env.ts`의 `SESSION_MARKER_NAME`(`CLAUDE_CODE_ENTRYPOINT` 포함) |
| keymap | extension `manifest.json`의 `contributes.keybindings`(context `agentView:<harness>`) |

## 탭의 흐름과 code

```
터미널 탭: claude gui [--resume <id>]   (shell 시작 층 함수. gui, gui --resume <id>, gui --resume=<id>만 받고 id는 [A-Za-z0-9._-]
  │                                     200자까지. 첫 인자가 gui가 아니면 원래 명령)
  ─▶ {"resume":…} | <lophn CLI> hook claude lophn-gui   (hook.ts가 친 곳의 cwd를 더해 그 탭의 hook socket LPN_TERMINAL_HOOK로)
core hook ingress(`packages/core/terminal-agents/ingress.ts`) ─ key로 그 터미널 ─▶ terminal-agents/gui.ts
  ─▶ tracker로 AcpTerminal(그 탭의 harness·session id·상태(shell이면 foreground에 harness 없음)·cwd, type·signal·onForegroundExit)
  ─▶ extension onTab.gui({terminal, harness, resume})   (extension이 꺼져 있으면 열지 않는다. 탭 머리 단추가 extension_off로 꺼진다)
       ─▶ ctx.acp.open({terminal, harness, title, handoff}) ─▶ handle
       ─▶ 그 탭에서 TUI가 돌면 adapter.exitTui(terminal) ─ foreground가 끝나기를 5초까지 기다린다(SIGKILL 없음)
       ─▶ adapter.start({cwd, resume, session: handle, terminal, spawn, clock, ids}) ─▶ run
  ─▶ acpOpened(handle) ─▶ gui.ts가 터미널에 handle을 쥐고 view = gui ─▶ StateChanged{coding_sessions}
  ─▶ 창의 TerminalStore가 coding_sessions/list를 다시 읽어 그 탭을 GUI view(AgentView)로 바꾼다(창의 ack는 없다)
탭 머리의 toggle(coding_sessions/switch_plan → 확인 → coding_sessions/switch {confirmed: true} ─▶ gui.toggle)
  GUI→TUI  restart(Claude·omp): modal(돌던 turn, run.running()의 background task 수) ─▶ run.stop ─▶ handle을 닫음 ─▶ PTY에 run.tuiCommand()
           shared(Codex·OpenCode): TUI client가 foreground에 없을 때만 tuiCommand를 친다. 보이는 쪽만 바뀐다
  TUI→GUI  restart: modal(tracker의 running·waiting) ─▶ exitTui ─▶ 새 handle과 start(resume)
           shared: 보이는 쪽만 바뀐다. 그냥 codex·opencode로 시작한 TUI는 처음 한 번 restart처럼 넘긴다
shared 대화의 CLI session id가 바뀌면(fork, /new) 붙은 TUI client를 SIGTERM하고 새 id로 tuiCommand를 다시 친다
터미널이 끝나거나 다시 시작하면 handle을 닫는다. extension을 끄면 연 handle을 모두 닫는다
```

탭의 GUI가 adapter에 묻는 읽기 둘(지난 session 목록, rewind 파일 미리보기)은 route `coding_sessions/cli_sessions`·`coding_sessions/rewind_preview` → `gui.ts`(session id의 터미널로 탭을 찾는다) → `ExtensionAcp.onTab.sessions`·`rewindPreview` → `index.ts` → `run.sessions?.()`·`run.rewindPreview?.(message)`로 간다. 폰은 이 route가 기기 route 목록에 없어 `[]`·`null`이다. 그 메서드가 없는 adapter는 `[]`·`null`이다.

## 구현 세부(설계 문서의 "지키는 것"이 이루어지는 방식)

- handle(`createAcp`, `packages/core/extensions/acp.ts`)은 publish된 갱신을 `reduceAcp`로 접은 `AcpState` 하나만 쥔다. core(`terminal-agents/gui.ts`의 `attachBatched`)는 snapshot을 먼저 받고 갱신은 handle마다 20ms(`UPDATE_BATCH_MS`) 모은다. `coding-sessions.ts`가 그 묶음을 redactor에 거쳐 하나씩 `AcpUpdated`로 내고, handle이 열리고 닫히면 `StateChanged{coding_sessions, id}`를 낸다.
- core는 PTY에 글을 `typeInto`(`packages/core/terminals/service.ts`)로 쳐 넣는다. PTY host의 `signal` 요청은 foreground process group에 SIGINT·SIGTERM을 보낸다(Linux만. foreground가 shell이면 아무것도 안 한다). foreground가 끝난 것은 250ms마다 보는 foreground 변화로 안다(`packages/core/terminals/host/foreground.ts`, win32는 null).
- login env는 core가 한 번 `${SHELL:-/bin/sh} -ilc`로 읽는다(`packages/core/terminals/person-env.ts`. Linux `env -0`, macOS는 BSD `env`라 줄 단위로 읽는다. tmux·updater guard, 5초). extension spawner가 GUI를 열기 전에 그 읽기를 기다린다. 합치는 순서는 login env < 탭 hook env < adapter가 넘긴 key다. CLI는 떼어 띄우고 process group째(`kill(-pid)`) 끈다.
- 탭 화면(`terminal-gui.tsx`)은 `acp/snapshot`으로 읽은 상태에서 시작해 `AcpUpdated`를 `reduceAcp`로 접고, 묶음 하나를 한 task 안에서 알려 화면이 한 번만 그린다. 화면이 붙은 뒤에 snapshot이 오면(창 다시 load) source의 `changed`로 화면이 다시 읽고, `reread`가 서면 feed의 지금 상태를 다시 읽는다. view(`gui`|`tui`)는 core가 들고 탭은 `coding_sessions/list`에서 읽는다(창 다시 load와 앱을 다시 켠 뒤도 같다).
- 탭 이름: `GuiSwitch`가 제목을 탭 field `guiTitle`에 두고 `terminalName`이 GUI view일 때만 그것을 쓴다. 다른 workspace의 탭 줄은 `agentTitle`을 쓴다. 화면의 session key는 터미널 ref `trm_<ULID>`의 ULID로 만든 `ses_<ULID>`(`guiSessionId`, `packages/protocol/lophn-agent/session-tag.ts`)다.
- GUI view에서는 `TerminalTab`이 서지 않으므로 `GuiSwitch`가 고른 GUI 탭을 shell main의 터미널 focus 표(`shell:terminal-focus`)에 적는다.
- 입력 history·Ctrl+R 검색·`agent.*` command의 handler는 `agent-view.tsx`의 routes에 있다. GUI 탭은 바깥 `agentView` 안쪽에 `agentView:<harness>`를 단다.
- 터미널 함수: bash·zsh·fish와 PowerShell 7·5.1 시작 층의 `claude`·`codex`·`opencode`·`omp`·`agy` 함수는 첫 인자가 `gui`면 `lophn hook <harness> lophn-gui`로 그 탭의 hook endpoint에 요청을 보낸다(lophn CLI 경로는 core가 시작 층 file을 쓸 때 넣는다. 터미널 env에서는 `LOPHN_*`가 빠진다). PowerShell 함수는 profile 뒤에 읽고 사용자 alias·function·execution policy는 바꾸지 않는다. Windows PowerShell 실기 확인은 별도다(`terminal-agent.md`).
- GUI source(`agent-tab-gui-source.ts`)는 adapter가 낸 `capabilities`·명령 표·model 축·mode를 그대로 내고 화면은 lophn agent와 같은 검사로 없는 기능의 칸을 숨긴다. tool 본문은 item의 `body`이고 화면은 `acp/tool_body`로 읽는다. 이미지는 `acp/image_upload`로 core가 tmp file(`<os tmp>/lophn-gui/<터미널 ref>/`)에 써 `file://` link로 싣는다.
- 받은 메시지: `classifyReceived`가 `<lophn-call>`·`<lophn-reply>` tag(`from="human"`은 사람)와 Claude transcript의 `origin.kind`로 가른다.
- 계약 이름: `GUI_HARNESSES`(`claude`, `codex`, `opencode`, `omp`, `antigravity`)가 목록의 한 곳이다. `antigravity`의 터미널 명령은 `agy`다.

## Claude Code adapter

`claude.ts`(restart). Agent SDK(`@anthropic-ai/claude-agent-sdk`, 판 고정)의 `query()`를 streaming input으로 연다.
- `pathToClaudeCodeExecutable: "claude"`를 늘 넘기고 process는 `spawnClaudeCodeProcess`로 `ctx.spawn`을 거친다. SDK가 넘기는 env 중 core의 `process.env`와 값이 다른 key만 넘긴다(그러지 않으면 login shell env를 덮는다). SDK의 OS별 claude 사본은 root `package.json`의 `overrides`가 빈 package(`tools/empty-package`)로 바꿔 받지 않는다. extension build(`buildExtensions`)는 SDK가 모듈 맨 위에서 쓰는 `import.meta.url`을 bundle file의 URL로 채운다.
- 새 session은 `ids`로 만든 UUID를 `sessionId`로 넘겨 첫 turn 전에 CLI session id를 안다. `settingSources` user·project·local, `systemPrompt` preset `claude_code`, partial message, `perTaskStopAffordance`(멈춰도 background task는 산다), `enableFileCheckpointing`(파일 rewind)를 켠다. permission mode는 넘기지 않는다(사람 설정). `bypassPermissions`는 쓰지 않는다.
- meta: `supportedModels`(effort 축), `supportedCommands`(터미널 전용 명령은 뺀다), `getContextUsage`를 첫 메시지 전에 읽어 `session_changed`로 낸다. mode는 SDK 시작 응답에 없어, 첫 turn의 `system/init` 전에는 사람 Claude 설정의 `permissions.defaultMode`(user `settings.json` < project `<cwd>/.claude/settings.json` < `<cwd>/.claude/settings.local.json`, 읽기만)를 내고, resume이면 transcript의 마지막 `permission-mode`를 낸다. init이 오면 init이 맞다. model이 "default" 줄이면 이름은 `getContextUsage().model`과 `resolvedModel`이 같은 줄의 이름이다(고르는 값은 그대로 default).
- 사람 메시지마다 `uuid`를 붙인다. 도는 중에 보낸 것은 delivery가 steer면 `priority: "next"`, 다음 turn이면 `"later"`이고, CLI의 `command_lifecycle`(queued, started)이 줄과 `message_taken`을 정한다. steer인지는 보낼 때의 priority(`next`)로 가른다: `next`는 도는 turn에 끼어들 때만 steer이고, `later`·`now`는 늘 next_turn이다. CLI는 가까이 보낸 `later` 여럿을 한 turn으로 묶어(SDK 문서: result의 `user_message_uuid`는 마지막 member) `started`를 잇따라 내므로, 첫 메시지가 연 turn에 나머지가 next_turn으로 붙는다. 줄의 항목은 priority를 들고 있어 고치기·옮기기가 그대로 다시 넣는다. 지금 보내기·빼기·고치기·옮기기는 `cancelAsyncMessage`(sdk.d.ts에는 없고 sdk.mjs에 있다)로 한다. 지금 보내기(`now`)는 도는 명령을 멈추고 그 turn은 멈춘 turn이다.
- 입력: `set_model`(CLI가 거절한 model은 다음 띄우기에 넘기지 않는다), `set_mode`(`setPermissionMode`), effort는 숨긴 `/effort`, `run_command`, `compact`, `retry`, `rename`, 이미지(`file://` link를 읽어 base64). local 명령(`/effort`, `/context`, `/compact`, `setModel`)의 답은 합성 메시지와 `local_command` result로 온다.
- 승인: `canUseTool`마다 카드. 이 session 동안은 SDK 제안을 `destination: "session"`으로 바꿔 돌려주고, always는 제안이 session 밖을 가리킬 때만 내놓고 그대로 돌려준다(영구). session 규칙과 폴더는 들고 있다가 다시 열 때 `allowedTools`·`additionalDirectories`로 넣는다. ExitPlanMode는 plan 카드이고 한 번은 `default`, 이 session 동안은 `acceptEdits`로 간다.
- rewind는 `rewindFiles`(dry run 뒤 실제)와 `resume` + `resumeSessionAt` + `forkSession` + 새 `sessionId`로 다시 연다. fork는 SDK `forkSession`으로 같은 탭에서 다시 연다. 둘 다 잘린 구간을 `hidden_added`로 숨기고(adapter가 `reduceAcp`로 상태를 접어 둔다) 새 `cli_session`을 낸다.
- toggle: 탭에 TUI가 보이면 `start`는 `conflict`다. `exitTui`는 SIGINT를 0·300·900ms에 보내고 foreground가 끝나면 돌아온다. `stop`은 도는 turn을 멈추고 query를 닫고 process가 끝나기를 기다린다. `tuiCommand`는 `stop`이 끝난 뒤에만 `claude --resume <id> [--permission-mode] [--model] [--effort] [--add-dir …] [--allowedTools …]`(GUI에서 고른 값만)를 낸다. `running`은 turn과 background task 수다.
- spawn env에 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`을 넣는다. SDK(비대화) mode의 CLI는 이 flag가 있어야 TUI처럼 TaskCreate·TaskUpdate·TaskList를 낸다. TaskCreate(id는 결과 글 "Task #N created")·TaskUpdate(성공한 결과만, deleted는 `cancelled`)와 TodoWrite가 `plan_changed`가 되고 그 tool 줄은 숨긴다. resume은 다시 읽은 tool 결과로 목록을 다시 만든다.
- 명령: SDK 줄은 출처(init의 skills·plugins와 이름 꼴)로 가르고 화면이 대신하는 CLI 줄과 TUI 전용 줄은 뺀다. adapter 줄은 model, effort, permissions(`opens: "mode"`), plan(toggle), rename, rewind, fork, status, usage(별칭 cost, stats), context, goal, clear(별칭 reset, new)다. `/clear`는 열린 query에 보내지 않고(session id가 바뀐다) 같은 탭에 새 query를 연다. 명령 출력(합성 `assistant` + `local_command_run`, user replay `local-command-stdout`, `system/local_command_output`)은 `command_output`, stderr는 warning이다.
- subagent: 대화마다 lane을 두고 자식 메시지(`parent_tool_use_id`)를 `child_update`로 낸다. Agent 줄이 subagent detail이고 `task_started`·`task_progress`·`task_updated`·`task_notification`이 `tool_detail_changed`로 바꾼다. 끝난 자식은 `getSubagentMessages`로 채운다(최종 글은 stream에 오지 않는다). 현재 CLI는 `run_in_background` 없이도 Agent를 비동기로 띄워 tool 결과가 바로 오므로, background인지는 입력이 아니라 결과의 `tool_use_result.status === "async_launched"`로 가른다. 그 Agent 줄은 tool 결과와 turn이 끝나도 running이고 task 알림이 끝낸다(replay에는 알림이 없어 done). `stop_child`·`stop_task`는 `stopTask`다. background task(`local_bash`)는 `tasks`이고 subagent(`local_agent`)는 Agent 줄로만 보인다.
- 사용 한도는 `rate_limit_event`(`unifiedWindows` five_hour·seven_day, utilization 0–1, `resetsAt` 초), `/context` 분해는 `getContextUsage`, 제목은 `getSessionInfo`다. 사람 메시지 `origin`은 SDK uuid이고 resume해도 같다. 빈 session(메시지 없음)은 `claude --resume`이 못 열어 `tuiCommand`가 `--session-id`를 쓴다.
- 상위 session 표지를 지우면 CLI가 transcript의 entrypoint를 `sdk-cli`로 쓴다. 그래서 `listSessions({includeProgrammatic:false})`에는 GUI session이 없다. resume은 id로 한다.
- 다시 열면(resume, TUI→GUI toggle, `open_session`) `restoreUsage`가 transcript 원본 줄(SDK `importSessionToStore`로 메모리 store에 받는다. `getSessionMessages`에는 없다)의 마지막 `cost-state`로 token 합계와 비용을 되살린다. 없으면 assistant `message.usage`를 `message.id:requestId`로 중복을 빼고 합한다. resume한 CLI의 `total_cost_usd`는 session 누적이라 되살린 비용은 `cost.last`다. 못 읽으면 조용히 넘어간다. 저장되지 않은 session(첫 메시지 전의 TUI. `getSessionInfo`가 없다)은 resume하지 않고 같은 id로 새 session(`sessionId`)을 연다.
- steer: turn 중 steer는 `priority: "next"`로 넣고, Claude desktop과 같이 root에서 3초 넘게 돈 Bash·PowerShell·Agent·Task를 tool_use id로 `q.backgroundTasks(id)`해 background로 보낸다(1초마다 15초 안에, steer가 줄에 있는 동안, 최대 2개). SDK mode의 CLI는 TUI와 달리 메시지가 와도 도는 tool을 스스로 옮기지 않아, 그대로면 steer가 tool이 끝날 때까지 기다린다. id 없는 `backgroundTasks()`는 tool 호출을 풀지 않고, control 요청 `interrupt {send_now}`는 tool을 멈춘다(녹화 `fixtures/claude/steer_*.jsonl`). 지금 보내기는 `priority: "now"`로 넣고 도는 그 tool들을 바로 background로 보낸다. subagent 안에서 시작한 task(`parent_task_id`나 자식 줄기의 tool_use)는 root에 "Started …" 안내를 내지 않는다. Agent 줄은 `task_started`가 와야 낸다(줄의 `at`이 실행 시작이어야 같이 띄운 subagent의 시간이 맞는다. ACP에는 `at`을 고칠 갱신이 없다). effort는 GUI에서 고르지 않았으면 init의 `effort`, 없으면 설정의 `effortLevel`(`modelSettings.<model>`이 먼저)을 보인다(그 model이 지원할 때만).
- 둘째 판: `!`는 adapter가 탭 env의 `spawn`으로 `/bin/sh -c`를 돌려 `by: "user"` tool item(출력은 끝날 때 한 번에)으로 그리고(cwd는 앞 `!`가 끝난 곳이다. 명령 끝에 표지와 `$PWD`를 찍게 해 읽고 출력에서 지운다), 끝나면 `<bash-input>`·`<bash-stdout>`·`<bash-stderr>` 사람 메시지를 `shouldQuery: false`, `client_composed: true`로 넣는다(Claude 데스크톱 앱과 같다. 도는 turn이 있으면 끝난 뒤에. 메시지마다 오는 `num_turns: 0` result는 무시한다). 다시 열면 그 entry를 shell 줄로 그린다. fast·thinking은 model의 `switch` 축(fast는 `supportsFastMode`, thinking은 `supportsThinkingOff`인 model만)이고 `tuiCommand`가 `--settings`로 넘긴다. resume은 `listSessions({dir, limit: 30, includeProgrammatic: true, includeWorktrees: false})`와 `open_session`(retire → `session_reset` → resume으로 다시 열기 → 다시 그리기)이다. CLI가 끝난(`dead`) 뒤의 send는 같은 session id로 다시 열고 그 메시지를 넣는다(못 열면 실패한 turn). rewind 미리보기는 `rewindFiles(uuid, {dryRun: true})`이고, 되돌릴 메시지를 transcript에서 못 찾으면 아무것도 하지 않고 warning이다. todo의 `deleted`는 목록에서 뺀다. fork·rewind 뒤 "Forked from …"·"Rewound to …" 줄과 제목.


## Codex adapter

`codex.ts`(shared). 탭마다 `codex app-server --listen unix://<mkdtemp 0700>/codex.sock`를 띄우고(env key를 넘기지 않는다), GUI는 그 socket 위 WebSocket(`ws`) client이고 TUI는 `codex resume <thread> --remote 'unix://<sock>' --cd "$PWD"`로 같은 server에 붙는다. app-server는 thread 하나에 connection 여럿을 붙이고 이벤트와 승인 요청을 모두에게 보낸다.
- `initialize`에 `capabilities {experimentalApi: true}`. `config/read`로 사람 설정을 읽어 `never`이거나 `danger-full-access`일 때만 `approvalPolicy: "on-request"`, sandbox `workspace-write`로 덮는다. resume은 `thread/resume {excludeTurns: true}` 뒤 `thread/turns/list`를 나눠 읽어 앞 대화를 그린다.
- 다른 client(TUI)가 보낸 사람 메시지도 그린다: `turn/start`·`turn/steer`에 `clientUserMessageId`를 실어 제 것과 가른다. 설정 바꾸기는 `thread/settings/update`이고 `thread/settings/updated`가 양쪽에 온다. 다른 thread의 이벤트는 `threadId`로 거른다.
- 승인: 요청의 `availableDecisions`에 있는 것만 낸다(이 session 동안은 `acceptForSession`이 있을 때만). 거절은 `decline`이고 turn은 이어 간다. 영구 결정(execpolicy·network amendment)은 영구라고 표시한다. 다른 client가 먼저 답하면 `serverRequest/resolved`로 카드를 답 없이 닫는다. turn이 끝날 때 `cancel`을 보내지 않는다(남의 turn까지 멈춘다). 사람이 멈출 때만 아직 열린 승인에 `cancel`이다. patch 승인은 `file_change` subject다.
- 질문(`item/tool/requestUserInput`)은 질문 카드이고 답은 질문 id로 돌려준다. MCP elicitation은 거절하고 notice를 낸다.
- 기능: 사용량, model·effort, 권한 mode, rewind(마지막 메시지만, `thread/revert`, file은 그대로), fork(`thread/fork`가 부른 client를 바로 구독시킨다), `!` shell(`thread/shellCommand`, 제 turn을 연다), file mention. 명령 표는 `opens` 줄(model, permissions, status, usage, rename, fork, agents)과 adapter 줄(compact, review, goal, plan(`canPlan`일 때), new(별칭 clear), init(TUI의 내장 prompt 글), mcp, diff(`git`), ps, stop)이다. review 글은 뒤따르는 `agentMessage`로 그리고 `exitedReviewMode`는 무시한다(같은 글이 두 번 온다). warning·configWarning·`model/rerouted`는 warning info다. 이미지는 아직 끈다.
- subagent: 대화마다 lane을 두고 자식 thread의 이벤트를 `child_update`로 낸다. `spawnAgent` 줄이 subagent detail이고 `wait`·`closeAgent`·자식 turn 끝이 `tool_detail_changed`로 바꾼다. `stop_child`는 자식 turn에 `turn/interrupt`, `steer_child`는 `turn/steer`(쉬고 있으면 `turn/start`)다. 자식이 연 승인·질문은 root 카드다. lane이 열리기 전(spawn item이 끝나기 전)에 온 자식 이벤트는 thread마다 50개, 모두 200개까지 쌓았다가 spawn item이 그 thread를 알리면 붓고, root turn이 끝나면 버린다. 다시 열면 자식 대화를 `thread/turns/list`로 그린 뒤 도는 자식마다 `thread/resume`으로 다시 구독한다.
- background task는 `thread/backgroundTerminals/list`와 도는 subagent이고 root `turn/completed`, `/ps`, `stop_task` 뒤에 다시 읽는다. background 명령의 tool 줄은 turn 끝에 cancelled로 닫는다(`terminate` 뒤 `failed`로 다시 오는 `item/completed`는 무시한다).
- plan: `plan` toggle(`set_toggle`, `/plan`)이 collaboration mode를 바꾼다. plan mode turn이 `plan` item으로 끝나면 "Implement" 카드(plan subject)를 내고, 고르면 default mode로 바꾸고 "Implement the plan."을 보낸다(실제 `plan` item으로는 아직 확인하지 않았다). goal은 `thread/goal/*`(active goal을 정하면 turn이 스스로 시작한다), 사용 한도는 `account/rateLimits/read`·`updated`(`resetsAt` 초)다. 추가 권한 요청(`item/permissions/requestApproval`)은 승인 카드이고 답은 늘 `scope: "turn"`이다. 사람 메시지 `origin`은 `clientId ?? item.id`이고 resume해도 같다.
- `exitTui`는 PTY에 Ctrl+C(`\x03`)를 700ms 간격으로 네 번까지 친다(Codex TUI의 Ctrl+C는 한 번에 입력 지우기 → 멈추기 → 끝내기).
- turn이 없는 thread는 `thread/resume`이 "no rollout found"라 첫 메시지 전에는 TUI로 넘어가지 못한다(`tuiCommand`가 notice를 낸다).
- 시작할 때 `thread/resume`이 "no rollout found"면(첫 메시지 전의 TUI thread) 실패하지 않고 `thread/start`로 새 thread를 연다.
- 둘째 판(사람이 써 본 것): Speed 축(model의 `serviceTiers`, Standard와 tier마다 값인 `choice`, `thread/settings/update {serviceTier}`, resume해도 남는다). `!`는 `run_shell`이나 `!`로 시작하는 send가 `thread/shellCommand`(도는 turn 중에도)를 보내고, `source: "userShell"`인 `commandExecution`을 `by: "user"` tool item(제목과 `body.input`은 보낸 명령이고 `/bin/bash -lc` wrapper가 아니다)으로 그린다. ACP turn은 첫 item에서 연다(shell만 있는 turn은 사람 메시지·꼬리가 없다). resume은 `thread/list {cwd, sortKey: "updated_at"}`와 `open_session`(`thread/resume` → `switchThread` → `session_reset` → 다시 그리기, 도는 turn이 있으면 거절)이다. fork 뒤 "Forked from …" 줄과 제목.


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
- 둘째 판: fast·slow toggle 대신 지금 model의 Speed 축(Standard, Fast, session 범위일 때만 Slow. 오류면 warning 뒤 다시 읽는다. 전역 slow는 쓰지 않는다). `!`는 `bash` RPC로 `by: "user"` tool item이고 turn 밖이면 turn을 열지 않는다(다시 열 때 `bashExecution`도 같다). model turn이 끝난 적 없는 session은 `tuiCommand`가 `--resume` 없이 띄운다. resume 목록은 `get_state.sessionFile` 폴더의 session file 머리(앞 두 줄)에서 읽고 `open_session`은 file이 있는지 본 뒤 `switch_session {sessionPath}`하고, 바뀐 session id가 고른 것과 다르면(없는 경로면 omp가 오류 없이 새 빈 session을 연다) 앞 session으로 돌아가고 warning이다. 명령 출력은 ANSI 없이 머리·목록 줄이 둘 이상이면 markdown이다. fork 뒤 "Forked from …" 줄.
- `--resume`으로 띄운 omp가 ready 전에 끝나면(저장되지 않은 session은 omp가 `Session … not found`로 끝난다) `--resume` 없이 다시 띄우고 앞 대화를 다시 그리지 않는다.


## OpenCode adapter

`opencode.ts`(shared). 탭마다 `opencode serve --stdio --port 0`을 탭 env로 띄우고 OpenCode 자신의 server API(HTTP와 `/api/event` SSE)를 손으로 짠 client로 쓴다(데스크톱 앱과 같은 경계). password는 `mkdtemp` 0700 아래 0600 file에 두고(터미널 env가 PASSWORD 이름을 지운다) TUI는 `OPENCODE_PASSWORD="$(cat '<file>')" opencode --server <url> --session <id>`로 같은 server에 붙는다. stdin을 열어 둔 것이 server의 lease다. 시작할 때 `server.info`의 판이 녹화한 2.1.4와 다르면 notice를 낸다.
- session은 `session.create`(새로) 또는 `session.get` + `session.messages`(resume, 짧은 page가 오면 멈춘다)로 연다. resume할 session이 404면(저장된 적 없음) 실패 줄 없이 새로 만들고, 그 밖의 실패만 실패 turn으로 알린다. location의 plugin은 첫 session이 생겨야 load되므로 model·agent·명령 목록은 `model.updated`·`agent.updated`·`command.updated` 때마다 다시 읽는다.
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
- 둘째 판: `!`는 `session.shell`이고 `by: "user"` tool item이다(turn을 열지 않고, 다시 열 때도 같다). resume 목록은 `GET /api/session?directory&parentID=null&order=desc&limit=30`(`time.updated`는 epoch ms), `open_session`은 session 상태를 비우고 `session_reset` 뒤 다시 그린다(도는 turn이 있으면 거절). server 명령 template에 `$ARGUMENTS`·`$<n>`이 있으면 `argument_hint`가 `[args]`다(`~/.config/opencode`와 `<cwd>/.opencode`의 `{command,commands}/**/*.md`를 읽는다). fork 뒤 "Forked from …" 줄.


## Antigravity adapter

`antigravity.ts`(restart). 사람 PATH의 `agy acp`(ACP stdio JSON-RPC, 1.5.9 녹화 `fixtures/antigravity/`)를 env key 없이 띄운다. 녹화 도구는 `fixtures/antigravity/record.ts`다.
- `initialize`는 `fs`·`terminal` false(agy가 file과 shell을 스스로 한다), `elicitation.form`, clientInfo `lophn`이다. `agentInfo.version`이 1.5.9가 아니면 경고를 한 번 낸다. 로그인은 agy의 것이라 `authenticate`를 부르지 않는다.
- 새로는 `session/new`, 다시 열기는 `<home>/.gemini/antigravity-cli/conversations/<id>.db`가 있을 때만 `session/load`다(없는 id면 agy가 빈 session을 조용히 열기 때문). load는 답 전에 지난 대화(`user_message_chunk`, 끝난 `tool_call`, `agent_message_chunk`)를 다시 보내므로 모았다가 한 묶음으로 낸다. 다시 그린 tool 제목은 path 꼴이 다르니 이름은 path에서 만든다.
- model·생각 단계·mode는 `configOptions`(`model`, `thought_level`, `mode`)가 진실이다. 바꾸기는 `session/set_config_option`, mode는 `session/set_mode`다. 생각 단계 축은 `session/new`의 legacy model id(`gemini-3.8-flash-low` 꼴)에서 만든다. Claude·gpt-oss model에는 없다.
- tool: shell 입력 칸 이름이 섞여 온다(`CommandLine`, `command_line`, `commandLine`, `command`). 출력 머리의 `Created At`·`Completed At` 줄은 뺀다. 편집은 `content`의 `diff`(oldText, newText)다. plan mode의 계획은 `brain/<id>/` 아래 `write_file`(ArtifactMetadata)로 오며 보통 편집 줄로 그린다. `start_subagent`도 보통 줄이다.
- 승인: `session/request_permission`의 선택지 kind(allow_once, allow_always, reject_once)만 낸다. 창이 고른 optionId로만 답하고, 멈추면 `cancelled`다. allow_always는 agy 설정에 영구로 남아 영구라고 적는다. toolCallId가 `interaction_`로 시작하면 질문 카드다.
- 질문: `elicitation/create`(form)의 `q1…`(oneOf const·title)과 `q1_other`(자유 답)를 질문 카드로 낸다. 답은 `{action: "accept", content: {q1: "<const>"}}`나 `{q1_other: "<글>"}`, 답이 없으면 `decline`, 멈추면 `cancel`이다.
- steer: 도는 turn에 `session/prompt`를 또 보내면 agy가 앞 prompt를 바로 `end_turn`으로 답하고 도는 tool이 끝난 뒤 새 메시지를 같은 흐름에 넣는다(`steer.jsonl`). 그래서 ACP turn은 마지막 prompt의 답에서 끝나고, steer 메시지는 그 `user_message_chunk` 메아리(앞뒤 공백 무시)가 오면 `message_taken`이다. 다음 turn으로 보낸 것은 adapter 줄에 선다. 멈춘 뒤에는 취소된 prompt가 답할 때까지 보내지 않는다(그 사이 보내면 agy가 거절한다).
- 우리 prompt가 없는데 agy가 내용을 내면(goal, schedule) turn을 열고 1.5초 조용하면 닫는다.
- 명령: agy가 알린 `available_commands_update` 목록을 `/이름 인자` 글로 보낸다. 글을 내지 않는 명령(`/compact`)은 `command_output` notice를 낸다. 도는 turn 중 명령은 경고로 거절한다.
- 서버 오류(503 과부하, quota)는 `⚠`로 시작하는 보통 답 글로 온다. 다른 내용이 없는 turn이면 `unavailable` 실패 turn이다.
- 사용량: `usage_update {used, size}`가 context, prompt 답의 `usage`가 turn token이다. 비용은 없다. 제목은 `session_info_update`다.
- 지난 session은 `session/list`(cwd를 거르지 않으므로 adapter가 이 cwd만 남긴다), `open_session`은 도는 turn이면 거절, `.db`를 본 뒤 앞 session을 `session/close` → `session_reset` → `session/load`, 실패하면 앞 session을 다시 load한다.
- toggle: `exitTui`는 PTY에 Ctrl+C를 400ms 간격으로 넷까지 친다(agy TUI는 Ctrl+C 두 번에 끝난다). `stop`은 도는 turn을 `session/cancel`하고 답을 3초까지 기다린 뒤 stdin을 닫고 3초 뒤 SIGTERM이다. `tuiCommand`는 `agy --conversation <id>`에 GUI에서 바꾼 값만 더한다: model이나 단계가 바뀌면 `--model <legacy id>`(agy는 legacy id와 `--effort`를 같이 받지 않는다), mode가 accept-edits·plan이면 `--mode`.
- agy가 죽으면 그 turn은 실패이고 다음 send가 `agy acp`를 다시 띄워 같은 id를 조용히 load한 뒤 보낸다.
