# mobile-terminal-shell

shell main이 폰이 보고 있는 터미널의 화면을 core에 밀어 올리고(`terminal_screen` frame), 폰의 입력을 터미널에 친다(`terminal_input`). terminal-host는 headless xterm의 화면을 styled row로 덤프하는 요청(`screen`)을 새로 받는다. PTY 크기는 바꾸지 않는다.

- 단위: terminal-view (wave 3)
- 선행: mobile-host-link-shell
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/screen.ts`와 `screen_test.ts`
  - `packages/shell/terminal-host/main.ts`와 `main_test.ts`
  - `packages/shell/main/terminal/terminal-view.ts`(새 file)와 `terminal-view_test.ts`(새 file)
  - `packages/shell/main/desktop/wiring/terminal-view.ts`(새 file. `main.ts`에 `terminal-view.register(ctx, coding)` 한 줄은 lead가 더한다. 보고에 쓴다)
  - `packages/shell/main/desktop/wiring/coding.ts`(`terminalIpc`의 `typeInto`와 terminal-host 요청을 위 wiring에 내주는 만큼만)
  - `packages/shell/main/terminal/ipc.ts`(`typeInto`와 host 요청을 내주는 만큼만)
  - `packages/shell/ipc/terminal.ts`(terminal-host 요청·답 type이 거기 있으면 `screen`을 더하는 만큼만)
  - `tools/fake-coding-host.ts`(터미널 화면을 올리고 입력을 받는 갈래를 더한다. `mobile-coding-state`가 만든 file이다)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `project-docs/flows/`의 area file와 `tests/shell.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.5, 2(설계 7), 7(7번: 글자 폭). 이 brief와 README의 "정한 것"이 다르면 그쪽이 맞다(row diff 없이 화면 전체를 매번, 입력은 `mobile-terminal-core`가 허락을 본 뒤에만 온다)
  - architecture: `project-docs/architecture/terminal-agent.md`, `workspace-layout.md`의 터미널 절
  - 이 계획이 먼저 낸 것: `packages/protocol/host-link/frames.ts`(`terminal_screen`, `terminalLineSchema`, 요청 `terminal_stream {terminal_ref, on, tail}`와 `terminal_input {terminal_ref, text}`), `ctx.hostLink`(`send`, `onRequest`, `onOpen`, `connected`. `mobile-host-link-shell` 보고)
  - 지금 코드: `packages/shell/terminal-host/screen.ts`(`Screen`: headless xterm, `snapshot()`, 서식은 addon-serialize의 ANSI 글이다), `main.ts`(`HostRequest`, `dispatch`, `snapshot` 갈래), `packages/shell/main/terminal/ipc.ts`(`typeInto`, `deps.host.request`), `controller.ts`의 `terminals.on({output})`(출력 chunk를 보는 길), `wiring/coding.ts`의 `terminalIpc`·`terminals`와 `interrupt()`(입력 뒤 `agent.tracker.humanInput`을 부르는 모양)
  - xterm 쪽: `@xterm/headless`의 buffer API(`buffer.active.getLine(y).getCell(x)`의 `getChars`, `getFgColor`, `isFgPalette`, `isBold` 등과 `getWidth()`)와 이 package가 고정한 판(`packages/shell/package.json`)
- 계약:
  - 쓰는 것: 위 frame과 요청. `terminal_input`은 이미 core가 허락을 본 것이라 여기서 다시 허락을 묻지 않는다
  - 내놓는 것: terminal-host 요청 `{id, type: "screen", terminal_ref, tail: int}` -> 답 `{ok: true, runtime, screen: {seq, generation, columns, rows, cursor: {x, y, hidden}, scrollback: TerminalLine[], lines: TerminalLine[]}}`. `lines`는 보이는 viewport 전체(`rows`줄), `scrollback`은 그 위 scrollback의 마지막 `tail`줄(없으면 빈 배열)이다. 한 칸 단위가 아니라 서식이 같은 칸을 이어 붙인 run이다(`wide`는 폭 2인 글자의 run). 서식 색은 `#rrggbb` 또는 `"p<0~255>"`(palette 번호)다. 빈 줄은 run 없이 `wrapped`만 가진다

## 할 일

1. `Screen`에 `rows(tail)`(이름은 정해도 된다)를 더한다: write 큐가 다 파싱한 뒤(`snapshot()`과 같은 `write("", callback)` 패턴으로 seq를 맞춘다) buffer의 줄을 읽어 서식이 같은 칸을 run으로 묶는다. `dropped`와 알 수 없는 서식은 기본값으로 둔다. `main.ts`의 `dispatch`에 `screen` 요청을 더한다(없는 터미널이면 `snapshot`처럼 `host_lost`). `screen_test.ts`: 색, 굵게, 폭 2 글자, 줄 바뀜(`wrapped`)이 run에 맞게 나온다.
2. `terminal-view.ts`: `terminal_stream {on: true, tail}`을 받으면 그 터미널을 보는 중으로 표시하고 지금 화면을 한 번 보낸 뒤, 터미널 출력(`terminals.on({output})`)이 있을 때마다 보내되 초당 최대 4번(250 ms 간격)으로 묶는다(마지막 출력 뒤 한 번은 꼭 보낸다). 보낼 때마다 `screen` 요청으로 전체를 받아 `terminal_screen` frame으로 `ctx.hostLink.send`한다. 연결이 없으면 보내지 않고 쌓지 않는다. `on: false`나 터미널이 끝나면 멈춘다. `ctx.hostLink.onOpen`마다 보는 중인 터미널을 다시 보내고(core가 다시 떴을 때 lease를 `terminal_stream`으로 다시 켜 준다) core가 켜 주기 전에는 보내지 않는다. 한 번에 보는 터미널은 몇 개여도 되지만 화면 크기가 한 frame 상한(16 MiB)을 넘지 않도록 `tail`은 core가 이미 500으로 막는다.
3. `terminal_input {terminal_ref, text}`: 터미널이 있으면 `terminalIpc.typeInto`로 친다(창 focus 검사를 거치지 않는 main의 입력 길) 그리고 `agent.tracker.humanInput(terminalRef, text)`를 부른다(사람이 친 것과 같다). 터미널이 없으면 error `not_found`. 크기를 바꾸는 요청은 만들지 않는다.
4. `wiring/terminal-view.ts`가 위를 만들어 `ctx.hostLink.onRequest("terminal_stream"|"terminal_input", …)`에 단다. 터미널이 목록에서 사라진 것은 core가 lease를 지우므로 여기서는 터미널이 끝날 때만 멈추면 된다.
5. `tools/fake-coding-host.ts`가 `terminal_stream`을 받으면 canned 화면(색 있는 줄 몇 개, 입력한 글이 한 줄에 쌓이는 모양)을 보내고 `terminal_input`을 받으면 그 글을 화면에 더한다.
6. flows catalog와 test.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면 변환의 정확성은 `screen_test.ts`가 본다. 입력 허락은 core의 test가 본다)
- 남지 않음: 없음
- 확인: 실제 shell은 띄우지 않는다(사람에게 묻는 일). terminal-host를 Node에서 직접 띄워 `screen` 요청에 색 있는 출력이 run으로 나오는지 한 번 본다(`main_test.ts`가 쓰는 가짜 PTY로 충분하면 그것으로). 끝나면 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 한 번 보내는 화면의 크기(바이트 예), 250 ms로 묶는 방법, CJK와 box drawing에서 본 것(조사의 열린 것 7), `wiring/coding.ts`와 `ipc.ts`에 내준 것, 등록할 것(`main.ts`의 한 줄), 확인한 것과 못 한 것.
