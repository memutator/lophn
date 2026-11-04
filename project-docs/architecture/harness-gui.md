# harness-gui

`claude gui`(또는 `codex gui`, `opencode gui`)를 치면 그 CLI의 TUI 대신 lophn 창이 뜬다. 뒤에서는 사람이 설치하고 로그인한 그 CLI가 그대로 돌고, extension `harness-gui`의 adapter가 CLI의 이벤트를 lophn ACP 갱신으로, 창의 ACP 입력을 CLI 호출로 옮긴다. 창은 lophn 채팅 화면이 ACP만 보고 그린다. 그 session은 CLI 자신의 session이고 lophn ledger에 기록하지 않는다. 계약은 `packages/protocol/extensions/acp-session.ts`, shell main 쪽은 `packages/shell/main/desktop/wiring/extensions.ts`(handle과 창 port)와 `packages/shell/main/desktop/open-intent.ts`, extension은 `packages/shell/main/extensions/bundled/harness-gui/`, CLI는 `packages/cli/commands/gui.ts`다.

## 흐름

```
lophn gui <harness> [--resume <id>]   (packages/cli/commands/gui.ts, core를 부르지 않는 local 명령)
  ─▶ lophn 앱 실행 파일을 --harness-gui <harness> --cwd <친 곳> [--resume <id>]로 떼어 띄운다
       └ 이미 떠 있으면 second-instance가 argv를 받는다
shell main readOpenIntent(argv) ─▶ {kind:"harness-gui", harness, cwd, resume?}
  ─▶ openHarnessGui(intent)   core가 starting이면 준비될 때까지 줄에 둔다
       ─▶ registry.sync()
       ─▶ ctx.acp.onOpenIntent로 건 함수가 없으면(꺼짐) ─▶ desktop 창에 intent extension-settings
                                                          ─▶ Settings › System › Extensions
       ─▶ 있으면 extension harness-gui의 open(intent)
            ─▶ ctx.acp.open({harness, cwd, title}) ─▶ AcpSessionHandle  ║ shell main: 창 port.open(AcpWindowHandle)
            ─▶ HARNESS_GUI_ADAPTERS[harness].start({cwd, resume, session: handle, spawn, clock, ids})
                 ├ 실패: 오류를 끝난 turn(turn_ended failed)으로 publish하고 창은 열어 둔다
                 └ 성공: adapter가 CLI 이벤트 → handle.publish(AcpUpdate)
                         창 입력(AcpInput) → handle.onInput → adapter → CLI
창을 닫음 ─▶ AcpWindowHandle.close() ─▶ handle onClose ─▶ adapter stop()
extension을 끔 ─▶ deactivate() ─▶ intent 함수를 풀고 연 handle을 모두 닫는다
```

## 지키는 것

- **harness는 `claude`, `codex`, `opencode` 셋이다.** 목록은 `GUI_HARNESSES` 하나이고 CLI 입력, open intent, adapter 표가 모두 이것을 쓴다.
- **open intent는 모양만 본다.** `--harness-gui`가 있으면 그 꼴로만 읽는다: harness가 목록에 있고, `--cwd`가 절대 경로이고, `--resume`이 있으면 `-`로 시작하지 않는다(CLI의 flag가 되지 않게). flag는 하나씩만 있어야 한다. 틀리면 기본 창이다. 폴더가 있는지는 여는 쪽이 본다.
- **`lophn gui`는 core 자격이 없어도 된다.** core가 꺼져 있어도 user token 없이 앱을 띄운다. CLI는 앱과 같은 Electron binary를 Node로 돌리므로, `ELECTRON_RUN_AS_NODE`만 빼고 같은 binary를 띄운다. 저장소 실행(shell main bundle `packages/shell/main/dist/main.cjs`가 있으면)은 그 bundle을 인자로 준다. agent의 `lophn` 도구 목록에는 없다(표의 명령이 아니다).
- **handle 하나는 창 하나다.** `id`(`win_…`)는 lophn session id가 아니다. handle은 창이 닫히거나 `close()`될 때까지 publish된 갱신을 모두 쌓고, 창 쪽이 `attach`하면 처음부터 다시 보낸 뒤 이어서 보낸다(창이 늦게 열려도 같은 상태). `close()`는 창과 extension이 같이 쓰는 한 길이고 두 번 불러도 `onClose`는 한 번이다.
- **adapter는 harness마다 하나이고 `Result`로 시작한다.** `start`가 실패하면 창은 닫지 않고 오류를 끝난 turn으로 보인다. 사람이 닫는다.
- **extension은 `ctx`로만 닿는다**([extension.md](extension.md)). CLI는 `ctx.spawn`으로 띄우고 사람의 PATH, 설정, login을 그대로 쓴다.

## 왜 이 모양인가

- **CLI 코어는 두고 화면만 바꾼다(사람, 2026-11-04 "CLI 화면을 대체하는 GUI").** Claude·Codex 데스크톱이 CLI 코어를 두고 화면만 바꾸는 것과 같은 꼴이라, session·resume·설정은 CLI의 것을 쓴다. 그래서 lophn ledger에 기록하지 않고 lophn project가 아닌 폴더에서도 돈다.
- **각 CLI의 공식 GUI 경계로 붙는다.** Claude Code는 Agent SDK, Codex는 `codex app-server`, OpenCode는 `opencode acp`다. TUI 화면을 긁지 않는다.
- **handle이 갱신을 쌓는다.** adapter는 창이 뜨기를 기다리지 않고 바로 publish한다. 창 쪽이 snapshot 없이 처음부터 접으면 되어 snapshot route가 필요 없다.
- **open intent를 extension이 건다.** 꺼진 extension은 code를 load하지 않으므로(extension.md) intent를 받을 함수가 없는 것이 곧 "꺼짐"이다. 그때 Settings를 연다.
