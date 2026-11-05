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

`claude.ts`. Agent SDK(`@anthropic-ai/claude-agent-sdk`, 판 고정)의 `query()`를 streaming input으로 연다.
- `pathToClaudeCodeExecutable: "claude"`(사람 PATH의 것)를 늘 넘기고, process는 `spawnClaudeCodeProcess`로 `ctx.spawn`을 거친다. SDK가 끌고 오는 OS별 claude 사본은 root `package.json`의 `overrides`가 빈 package(`tools/empty-package`)로 바꿔 받지 않는다. extension bundle에는 SDK의 `sdk.mjs`(약 1.3MB)만 든다. SDK가 모듈 맨 위에서 `import.meta.url`을 써서 extension build(`buildExtensions`)만 그 값을 bundle file의 URL로 채운다.
- `settingSources` user·project·local, `systemPrompt` preset `claude_code`, partial message를 켠다. permission mode는 넘기지 않는다(사람 설정). `bypassPermissions`는 쓰지 않는다.
- SDK 메시지 → ACP: 흘러나오는 글과 reasoning, tool 줄(Edit·Write는 `edit`, AskUserQuestion은 `question`, 나머지 `generic`), `result`마다 turn 하나, 오류는 실패한 turn이다. subagent 메시지(`parent_tool_use_id`)는 빼고 부모 Agent tool 줄 하나로 둔다.
- 승인: `canUseTool`마다 pending approval. 한 번은 `allow`, 이 session 동안은 `updatedPermissions`에 SDK 제안을 `destination: "session"`으로 바꿔 넣는다(제안 그대로면 Bash 허락이 그 폴더의 Claude Code local 설정 file에 영구히 적힌다. 실제 claude로 확인했다), 거절은 `deny`. turn이 끝나거나 멈추면 기다리던 것은 취소된다. AskUserQuestion의 답은 `updatedInput.answers`다.
- 도는 중에 보낸 메시지는 adapter가 줄에 세웠다가(`message_queued`) `result` 뒤에 SDK에 넣는다(`message_taken`, 새 turn). 멈추기는 `interrupt()`이고 그 turn은 멈춘 turn으로 끝난다. 같은 query로 이어 보낸다.
- `--resume <id>`는 SDK `resume`이다. SDK는 앞 대화를 다시 흘리지 않아 `getSessionMessages(id, {dir: cwd})`로 앞 대화를 그린 뒤 입력을 받는다.

## Codex adapter

`codex.ts`. 사람 PATH의 `codex`로 `codex app-server`를 stdio로 띄운다(JSON-RPC 줄, `jsonrpc` 칸이 없다). `initialize` → `initialized` → `thread/start`(resume이면 `thread/resume`).
- `thread/start`·`thread/resume`에 `approvalPolicy: "on-request"`, `sandbox: "workspace-write"`를 늘 넘긴다. 사람 설정이 `never`·`danger-full-access`여도 창은 승인 카드로 묻고 전부 허락 sandbox를 쓰지 않는다.
- item → ACP: `agentMessage`는 흘러나오는 글과 저장된 메시지, `reasoning`은 다음 메시지의 reasoning, `commandExecution`은 명령 tool, `fileChange`는 `edit`(path와 줄 수), `mcpToolCall`도 tool이다. `declined`는 거절로 끝난 tool이다.
- 승인: `item/commandExecution/requestApproval`·`item/fileChange/requestApproval`이 카드를 연다. 한 번은 `accept`, 이 session 동안은 `acceptForSession`(요청의 `availableDecisions`에 있을 때만 내놓는다), 거절은 `decline`, 멈춘 turn은 `cancel`이다. 다른 서버 요청(질문, 권한 확장, MCP elicitation)은 `-32601` 오류로 답한다(답하지 않으면 turn이 멈춘다).
- 도는 중에 보낸 메시지는 `turn/steer`로 같은 turn에 넣고, 다음 turn으로 보낸 것은 줄에 세웠다가 turn 뒤에 보낸다. 멈추기는 `turn/interrupt`, 다시 하기는 그 turn의 사람 메시지를 새 turn으로 보낸다. resume 응답의 `thread.turns`로 앞 대화를 그린다.

## OpenCode adapter

`opencode.ts`. 사람 PATH의 `opencode`로 `opencode acp`를 stdio로 띄워 표준 Agent Client Protocol(v1)을 손으로 짠 JSON-RPC로 말한다. 표준 protocol은 이 file 안에서만 쓴다. `initialize` → `session/load`(resume이고 `loadSession`이면) 또는 `session/new`. 불러오지 못하면 실패한 turn으로 알리고 새 session을 연다.
- `session/update` → ACP: `agent_message_chunk`·`agent_thought_chunk`는 글과 reasoning, `tool_call`·`tool_call_update`는 tool 줄(첫 `tool_call`은 제목과 입력이 비어 첫 `in_progress`나 승인 요청에서 줄을 연다). prompt 응답의 `stopReason`이 turn 끝이다(`end_turn` 완료, `cancelled` 멈춤, 나머지 실패).
- 승인: `session/request_permission`이 카드를 연다. 한 번은 `once`, 거절은 `reject`다. `always`는 내놓지 않는다(OpenCode의 always는 project 권한 표에 영구 규칙을 쓴다). 거절하면 OpenCode가 prompt 전체를 `cancelled`로 끝낸다. 모르는 요청은 `-32601`로 답한다.
- 사람 설정을 바꾸지 않는다. OpenCode 기본 설정은 shell과 edit를 묻지 않아, 사람이 ask 규칙을 두지 않았으면 승인 카드가 뜨지 않는다.
- 표준 protocol에는 steer가 없어 도는 중에 보낸 메시지는 줄에 세웠다가 prompt가 답한 뒤 보낸다. 멈추기는 `session/cancel`(기다리던 승인은 `cancelled`로 먼저 답한다), 다시 하기는 그 turn의 사람 메시지를 새 prompt로 보낸다. `session/load`가 응답 전에 다시 흘리는 `session/update`로 앞 대화를 그린다.

## 왜 이 모양인가

- **CLI 코어는 두고 화면만 바꾼다(사람, 2026-11-04 "CLI 화면을 대체하는 GUI").** Claude·Codex 데스크톱이 CLI 코어를 두고 화면만 바꾸는 것과 같은 꼴이라, session·resume·설정은 CLI의 것을 쓴다. 그래서 lophn ledger에 기록하지 않고 lophn project가 아닌 폴더에서도 돈다.
- **각 CLI의 공식 GUI 경계로 붙는다.** Claude Code는 Agent SDK, Codex는 `codex app-server`, OpenCode는 `opencode acp`다. TUI 화면을 긁지 않는다.
- **Claude는 stream-json을 직접 말하지 않고 SDK를 쓴다(사람, 2026-11-05).** 승인·멈추기·resume을 Anthropic이 맞춰 둔 것을 쓰고 CLI 판이 바뀌면 SDK 판을 올린다. 비용은 개발 `node_modules`의 SDK와 peer dependency(약 40MB)와 bundle의 1.3MB이고, 쓰지 않는 claude 사본(linux-x64 약 323MB)은 `overrides`로 뺐다.
- **Codex는 sandbox와 승인 정책을 늘 넘기고 OpenCode는 사람 설정을 그대로 쓴다.** brief가 full access를 금했고 Codex는 thread마다 정책을 받는다. OpenCode의 권한은 사람이 쓴 규칙표라 adapter가 덮어쓰면 사람의 규칙을 바꾸게 된다.
- **창이 채팅 화면을 다시 짜지 않는다.** source만 바꿔 `AgentView`를 쓰고, 없는 기능은 source의 칸 하나(`external`)로 숨긴다.
- **handle이 갱신을 쌓는다.** adapter는 창이 뜨기를 기다리지 않고 바로 publish한다. 창 쪽이 snapshot 없이 처음부터 접으면 되어 snapshot route가 필요 없다.
- **open intent를 extension이 건다.** 꺼진 extension은 code를 load하지 않으므로(extension.md) intent를 받을 함수가 없는 것이 곧 "꺼짐"이다. 그때 Settings를 연다.
