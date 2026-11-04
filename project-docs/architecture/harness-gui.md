# harness-gui

`claude gui`(또는 `codex gui`, `opencode gui`)를 치면 그 CLI의 TUI 대신 lophn 창이 뜬다. 뒤에서는 사람이 설치하고 로그인한 그 CLI가 그대로 돌고, extension `harness-gui`의 adapter가 CLI의 이벤트를 lophn ACP 갱신으로, 창의 ACP 입력을 CLI 호출로 옮긴다. 창은 lophn 채팅 화면이 ACP만 보고 그린다. 그 session은 CLI 자신의 session이고 lophn ledger에 기록하지 않는다. 계약은 `packages/protocol/extensions/acp-session.ts`, shell main 쪽은 `packages/shell/main/desktop/wiring/extensions.ts`(handle과 창 port)와 `packages/shell/main/desktop/open-intent.ts`, extension은 `packages/shell/main/extensions/bundled/harness-gui/`(adapter는 harness마다 file 하나, 지금 `claude.ts`), 창은 `packages/shell/main/desktop/gui-window.ts`와 `packages/shell/renderer/harness-gui/`, 채팅 화면의 source는 `packages/shell/renderer/conversation/agent-tab-gui-source.ts`, CLI는 `packages/cli/commands/gui.ts`, 터미널의 `claude gui`는 `packages/shell/terminal-host/shell-integration.ts`다.

## 흐름

```
lophn 터미널 탭: claude gui [--resume <id>]   (shell 시작 층의 함수. 첫 인자가 gui가 아니면 원래 명령)
  ─▶ <lophn CLI> gui claude [--resume <id>]
lophn gui <harness> [--resume <id>]   (packages/cli/commands/gui.ts, core를 부르지 않는 local 명령)
  ─▶ lophn 앱 실행 파일을 --harness-gui <harness> --cwd <친 곳> [--resume <id>]로 떼어 띄운다
       └ 이미 떠 있으면 second-instance가 argv를 받는다
shell main readOpenIntent(argv) ─▶ {kind:"harness-gui", harness, cwd, resume?}
  ─▶ openHarnessGui(intent)   core가 starting이면 준비될 때까지 줄에 둔다
       ─▶ registry.sync()
       ─▶ ctx.acp.onOpenIntent로 건 함수가 없으면(꺼짐) ─▶ desktop 창에 intent extension-settings
                                                          ─▶ Settings › System › Extensions
       ─▶ 있으면 extension harness-gui의 open(intent)
            ─▶ ctx.acp.open({harness, cwd, title}) ─▶ AcpSessionHandle  ║ gui-window.ts: desktop 창을 #harness-gui=<id>로 연다
            ─▶ 처음 한 번 사람의 login shell PATH를 읽는다($SHELL -ilc)
            ─▶ HARNESS_GUI_ADAPTERS[harness].start({cwd, resume, session: handle, spawn(PATH를 넣은), clock, ids})
                 ├ 실패: 오류를 끝난 turn(turn_ended failed)으로 publish하고 창은 열어 둔다
                 └ 성공: adapter가 CLI 이벤트 → handle.publish(AcpUpdate)
                         창 입력(AcpInput) → handle.onInput → adapter → CLI
창 renderer ─ IPC harness-gui:connect ─▶ 쌓인 갱신을 처음부터 harness-gui:update로 받고 이어서 받는다 ─▶ reduceAcp
창의 조작 ─ IPC harness-gui:input(AcpInput, main이 schema로 본다) ─▶ handle onInput ─▶ adapter
창을 닫음 ─▶ AcpWindowHandle.close() ─▶ handle onClose ─▶ adapter stop()
extension이 handle을 닫음 ─▶ 창도 닫는다
extension을 끔 ─▶ deactivate() ─▶ intent 함수를 풀고 연 handle을 모두 닫는다
```

## 지키는 것

- **harness는 `claude`, `codex`, `opencode` 셋이다.** 목록은 `GUI_HARNESSES` 하나이고 CLI 입력, open intent, adapter 표가 모두 이것을 쓴다.
- **open intent는 모양만 본다.** `--harness-gui`가 있으면 그 꼴로만 읽는다: harness가 목록에 있고, `--cwd`가 절대 경로이고, `--resume`이 있으면 `-`로 시작하지 않는다(CLI의 flag가 되지 않게). flag는 하나씩만 있어야 한다. 틀리면 기본 창이다. 폴더가 있는지는 여는 쪽이 본다.
- **`lophn gui`는 core 자격이 없어도 된다.** core가 꺼져 있어도 user token 없이 앱을 띄운다. CLI는 앱과 같은 Electron binary를 Node로 돌리므로, `ELECTRON_RUN_AS_NODE`만 빼고 같은 binary를 띄운다. 저장소 실행(shell main bundle `packages/shell/main/dist/main.cjs`가 있으면)은 그 bundle을 인자로 준다. agent의 `lophn` 도구 목록에는 없다(표의 명령이 아니다).
- **handle 하나는 창 하나다.** `id`(`win_…`)는 lophn session id가 아니다. handle은 창이 닫히거나 `close()`될 때까지 publish된 갱신을 모두 쌓고, 창 쪽이 `attach`하면 처음부터 다시 보낸 뒤 이어서 보낸다(창이 늦게 열려도 같은 상태). `close()`는 창과 extension이 같이 쓰는 한 길이고 두 번 불러도 `onClose`는 한 번이다.
- **adapter는 harness마다 하나이고 `Result`로 시작한다.** `start`가 실패하면 창은 닫지 않고 오류를 끝난 turn으로 보인다. 사람이 닫는다.
- **extension은 `ctx`로만 닿는다**([extension.md](extension.md)). CLI는 `ctx.spawn`으로 띄우고 사람의 설정과 login을 그대로 쓴다.
- **CLI는 사람의 login shell PATH로 찾는다.** 데스크톱 메뉴나 autostart로 뜬 앱의 PATH에는 사람의 shell 설정(nvm 등)이 없다. `index.ts`가 처음 열 때 한 번 `${SHELL:-/bin/sh} -ilc`로 PATH를 표시 사이에 찍어 읽고(rc file이 다른 글을 찍어도 된다), 5초 안에 못 읽으면 shell main의 PATH다. adapter에 넘기는 `spawn`이 그 PATH를 넣는다. 앱이 도는 동안 다시 읽지 않는다.
- **창은 desktop 창의 한 화면이다.** detached 창과 같이 desktop entry를 `#harness-gui=<id>` hash로 연다. 창 제목은 harness 이름과 cwd 끝 폴더다. main은 창이 보낸 id가 아니라 sender(webContents)로 handle을 찾는다. 창은 snapshot 없이 `EMPTY_ACP_STATE`부터 갱신을 `reduceAcp`로 접는다. `reread`가 서도 다시 읽을 것이 없다. 그래서 adapter가 `seq`를 1부터 빈틈없이 붙인다.
- **창은 lophn 채팅 화면(`AgentView`)을 그대로 쓰고 lophn 전용 기능을 숨긴다.** source의 `external: true`가 숨기는 칸이다: header의 session 바꾸기·이름·보관·fork·more 메뉴, model 고르기·skip·권한 요약, slash 메뉴(`/…`는 글로 보낸다), 메시지의 Rewind·Fork, 상태 footer와 `/status`, session 목록·검색. source가 답하지 못하는 읽기(model, 권한, call, envelope, tool 본문, 이미지 올리기)는 `unavailable`이나 `not_found`다. 입력창 글은 "Message <harness>…"이고, 승인 카드의 always는 "Allow for this session"이다(adapter가 그 CLI session 안으로 좁힌다).
- **입력의 `session`은 창이 만든 값이다.** adapter는 보지 않는다. 사람 메시지는 `send` 입력의 `id`로 `message_added`가 된다. turn·tool·승인 id는 adapter가 `ctx.ids`로 만들어 CLI의 id와 짝짓는다.
- **터미널 함수는 `gui`만 가로챈다.** shell 시작 층의 `claude`·`codex`·`opencode` 함수는 첫 인자가 `gui`면 shell main이 알려 준 CLI 경로(개발은 `LOPHN_CLI`, 설치본은 `lophn`. 터미널 env에서는 `LOPHN_*`가 빠진다)로 `gui <harness> …`를 부르고, 아니면 인자를 그대로 원래 명령에 넘긴다([terminal-agent.md](terminal-agent.md)).

## Claude Code adapter

`claude.ts`. Agent SDK(`@anthropic-ai/claude-agent-sdk`, 판 고정)의 `query()`를 streaming input으로 연다.
- `pathToClaudeCodeExecutable: "claude"`(사람 PATH의 것)를 늘 넘기고, process는 `spawnClaudeCodeProcess`로 `ctx.spawn`을 거친다. SDK가 끌고 오는 OS별 claude 사본은 root `package.json`의 `overrides`가 빈 package(`tools/empty-package`)로 바꿔 받지 않는다. extension bundle에는 SDK의 `sdk.mjs`(약 1.3MB)만 든다. SDK가 모듈 맨 위에서 `import.meta.url`을 써서 extension build(`buildExtensions`)만 그 값을 bundle file의 URL로 채운다.
- `settingSources` user·project·local, `systemPrompt` preset `claude_code`, partial message를 켠다. permission mode는 넘기지 않는다(사람 설정). `bypassPermissions`는 쓰지 않는다.
- SDK 메시지 → ACP: 흘러나오는 글과 reasoning, tool 줄(Edit·Write는 `edit`, AskUserQuestion은 `question`, 나머지 `generic`), `result`마다 turn 하나, 오류는 실패한 turn이다. subagent 메시지(`parent_tool_use_id`)는 빼고 부모 Agent tool 줄 하나로 둔다.
- 승인: `canUseTool`마다 pending approval. 한 번은 `allow`, 이 session 동안은 `updatedPermissions`에 SDK 제안을 `destination: "session"`으로 바꿔 넣는다(제안 그대로면 Bash 허락이 그 폴더의 Claude Code local 설정 file에 영구히 적힌다. 실제 claude로 확인했다), 거절은 `deny`. turn이 끝나거나 멈추면 기다리던 것은 취소된다. AskUserQuestion의 답은 `updatedInput.answers`다.
- 도는 중에 보낸 메시지는 adapter가 줄에 세웠다가(`message_queued`) `result` 뒤에 SDK에 넣는다(`message_taken`, 새 turn). 멈추기는 `interrupt()`이고 그 turn은 멈춘 turn으로 끝난다. 같은 query로 이어 보낸다.
- `--resume <id>`는 SDK `resume`이다. SDK는 앞 대화를 다시 흘리지 않아 `getSessionMessages(id, {dir: cwd})`로 앞 대화를 그린 뒤 입력을 받는다.

## 왜 이 모양인가

- **CLI 코어는 두고 화면만 바꾼다(사람, 2026-11-04 "CLI 화면을 대체하는 GUI").** Claude·Codex 데스크톱이 CLI 코어를 두고 화면만 바꾸는 것과 같은 꼴이라, session·resume·설정은 CLI의 것을 쓴다. 그래서 lophn ledger에 기록하지 않고 lophn project가 아닌 폴더에서도 돈다.
- **각 CLI의 공식 GUI 경계로 붙는다.** Claude Code는 Agent SDK, Codex는 `codex app-server`, OpenCode는 `opencode acp`다. TUI 화면을 긁지 않는다.
- **Claude는 stream-json을 직접 말하지 않고 SDK를 쓴다(사람, 2026-11-05).** 승인·멈추기·resume을 Anthropic이 맞춰 둔 것을 쓰고 CLI 판이 바뀌면 SDK 판을 올린다. 비용은 개발 `node_modules`의 SDK와 peer dependency(약 40MB)와 bundle의 1.3MB이고, 쓰지 않는 claude 사본(linux-x64 약 323MB)은 `overrides`로 뺐다.
- **창이 채팅 화면을 다시 짜지 않는다.** source만 바꿔 `AgentView`를 쓰고, 없는 기능은 source의 칸 하나(`external`)로 숨긴다.
- **handle이 갱신을 쌓는다.** adapter는 창이 뜨기를 기다리지 않고 바로 publish한다. 창 쪽이 snapshot 없이 처음부터 접으면 되어 snapshot route가 필요 없다.
- **open intent를 extension이 건다.** 꺼진 extension은 code를 load하지 않으므로(extension.md) intent를 받을 함수가 없는 것이 곧 "꺼짐"이다. 그때 Settings를 연다.
