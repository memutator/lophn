# mobile-coding-shell

shell main이 harness GUI handle의 상태를 core에 올리고(`coding_sync`, `coding_closed`), core가 보내는 `coding_input`과 `coding_switch`를 받아 handle과 tab toggle에 잇고, 터미널 coding agent 보고를 `terminal_sessions/report`가 아니라 연결의 `coding_report`로 보낸다(새 칸 `view`, `handoff`, `foreground` 포함). 폰이 시작한 TUI→GUI 전환은 창의 ack를 기다리지 않는다.

- 단위: coding-relay (wave 3)
- 선행: mobile-coding-state, mobile-host-link-shell
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/gui.ts`와 `gui_test.ts`
  - `packages/shell/main/terminal/coding-relay.ts`(새 file)와 `coding-relay_test.ts`(새 file)
  - `packages/shell/main/desktop/wiring/agent.ts`
  - `packages/shell/main/desktop/wiring/coding-relay.ts`(새 file. `coding.register`가 돌려주는 `gui`로 relay를 만들어 `ctx.hostLink`에 꽂는다. `main.ts`에 `coding-relay.register(ctx, coding)` 한 줄은 lead가 더한다. 보고에 쓴다)
  - `packages/shell/ipc/harness-gui.ts`(toggle 답의 이유가 늘어야 할 때만)
  - `wiring/coding.ts`는 `mobile-terminal-shell`의 것이다(같은 wave). 이 task는 고치지 않고 `coding.register`가 돌려주는 값(`gui`, `terminals`)만 쓴다
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `project-docs/flows/`의 area file(`areas/harness.yaml`, `areas/sessions.yaml`의 terminal report flow)과 `tests/shell.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.1, 1.4, 2(설계 2, 3, 5), 5(5번 위험)
  - architecture: `project-docs/architecture/harness-gui.md`(불변식 2, 4, 6과 "toggle"), `terminal-agent.md`
  - 이 계획이 먼저 낸 것: `packages/protocol/host-link/frames.ts`, `packages/protocol/coding-agent/relay.ts`, `TerminalSessionReport`의 새 칸과 `guiSessionId`(`packages/protocol/lophn-agent/session-tag.ts`), `ctx.hostLink`(`send`, `onRequest`, `onOpen`, `connected`. `mobile-host-link-shell`의 보고)
  - 지금 코드: `packages/shell/main/terminal/gui.ts`(`opened()`와 `ACK_TIMEOUT_MS`, `toggle()`, `open()`의 `showExtensionSettings`, `connect()`의 snapshot과 20 ms batch, `tabSessions()`, `input()`), `packages/shell/main/desktop/wiring/agent.ts`의 `reportToCore()`와 5초 주기, `wiring/coding.ts`의 `reportGuiTabs`와 `createTabGui` 조립(읽기만), `packages/shell/main/extensions/bundled/harness-gui/index.ts`(`gui()`, `tui()`, `adapter.handoff`)
  - 다른 계획(먼저 읽는다): `project-docs/plan/mobile-push/tasks/mobile-attention-desktop.md`가 `wiring/agent.ts`와 `tracker.ts`를 고친다(`terminal_sessions/signal` 보내기와 `unseen` 지우기). 이 task가 `agent.ts`의 터미널 보고(`reportToCore`)를 먼저 연결로 옮기고, 그쪽이 이 결과 위에서 `signal`을 더한다(README "정한 것"). `agent.ts`가 이미 그쪽 변경을 받았으면 그것을 지우지 않고 그 위에서 고친다
- 계약:
  - 쓰는 것: 위 frame과 요청. `coding_input`의 답은 handle이 있으면 content `ok`, 없으면 error `not_found`. `coding_switch`의 답은 content `ok` 또는 error(`conflict`는 이미 그 view, `unavailable`+`details.reason: "extension_off"`는 harness-gui가 꺼짐, `not_found`는 터미널 없음, `invalid_input`+`details.reason`은 `no_session`·`not_running`, 그 밖의 실패는 `unavailable`+`details.reason: "failed"`, Windows는 `unavailable`+`details.reason: "unsupported_os"`)
  - 내놓는 것: 없음(밖으로 내놓는 계약이 없다. `acp/snapshot`이 이 상태를 낸다)

## 할 일

1. `gui.ts`: handle이 열리면(`opened`) 밖에서 구독할 수 있게 한다(`TabGui`에 `onHandle(listener)` 같은 한 곳. 각 handle의 `attach`를 relay가 쓰고 window의 `connect()`와 같은 20 ms batch를 쓴다). 터미널 하나의 handle은 하나라 toggle로 handle이 바뀌면 새 snapshot이 가고 옛 것은 닫힌다.
2. `coding-relay.ts`(Electron을 import하지 않는다): handle마다 `coding_sync {session: guiSessionId(terminal), snapshot}`을 보낸 뒤 batch된 `updates`를 보낸다. `ctx.hostLink.onOpen`마다(core가 다시 떴거나 연결이 다시 붙었다) 모든 handle의 snapshot을 다시 보낸다. handle이 닫히면 `coding_closed`. 연결이 없을 때 쌓지 않는다(다시 붙을 때 snapshot이 전부다). 요청 처리기 둘(`ctx.hostLink.onRequest`): `coding_input`은 session id의 ULID에서 터미널의 handle을 찾아 `gui.input(handle, input)`로 넘긴다(없으면 `not_found`). `coding_switch`는 `gui.toggle`로 넘기고 위 계약의 오류 code로 옮긴다.
3. 폰이 시작한 switch는 ack를 기다리지 않는다: `gui.ts`에 phone 출처 표시를 두어(`toggle(input, {source})` 같은 한 갈래) `opened()`가 `ACK_TIMEOUT_MS`로 handle을 닫는 길을 이 경우에만 건너뛰고 view를 바로 `gui`로 둔다. 창이 없어도 탭이 다시 mount되면 `tab-current`(불변식 4)가 GUI view를 되찾는다. extension이 꺼져 있으면 `showExtensionSettings()`를 부르지 않고 `extension_off`를 돌려준다(desktop 창이 이유 없이 뜨지 않는다). desktop의 toggle 동작은 그대로다. TUI를 먼저 끄고 handle을 여는 순서(불변식 6)를 바꾸지 않는다: TUI 종료가 실패하면 `failed`이고 TUI는 남는다.
4. `agent.ts`: `reportToCore()`가 `ctx.hostLink.send({type: "coding_report", sessions})`를 보내게 한다. 각 줄의 `view`는 GUI 탭이 있으면 그 `view`, 없으면 `"tui"`; `handoff`는 handle이 있으면 `handle.handoff`, 없고 foreground TUI가 있으면 그 harness adapter의 handoff(`gui.ts`가 harness id로 아는 값. 없으면 harness-gui adapter 표에서 정적으로 찾는다), 둘 다 없으면 null; `foreground`는 tracker가 아는 foreground agent가 있는가. 바뀔 때와 `onOpen`마다 보내고 5초 주기 재전송은 지운다(core가 연결이 열려 있는 동안 표를 들고, 연결이 다시 열리면 `onOpen`이 다시 보낸다). `terminal_sessions/report` 호출은 지운다.
5. `wiring/coding-relay.ts`에서 relay를 만들어 `ctx.hostLink`에 꽂고 `agent.ts`의 `reportToCore`가 쓰는 `hostLink`도 거기서 받는다(agent 쪽 연결은 `agent.ts`가 맡는다).
6. test(`coding-relay_test.ts`, `gui_test.ts`): 가짜 handle과 가짜 `hostLink`로 snapshot-먼저와 닫힘, `onOpen` 재전송, 입력 전달, phone 출처 switch의 ack 건너뛰기를 본다.
7. flows catalog와 주석.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "폰이 시작한 GUI 전환도 TUI를 먼저 끄고 열며, TUI 종료가 실패하면 `failed`로 끝나고 TUI는 그대로 남는다(한 CLI session에 process 둘이 뜨지 않는다)"
- 남지 않음: `grep -rn "terminal_sessions\", \"report\"\|\"terminal_sessions\", \"report\"" packages/shell`이 0줄이다.
- 확인: 실제 shell은 띄우지 않는다(사람에게 묻는 일). `npm run dev:core`와 이 task의 relay를 Node에서 가짜 handle로 직접 붙여 core의 `acp/snapshot`이 가짜 session을 내는지 한 번 본다(`tools/fake-coding-host.ts`가 하던 일을 실제 relay code가 한다). 끝나면 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `TabGui`에 더한 메서드 이름, phone 출처 switch가 ack를 건너뛰는 방법, `handoff`를 정한 곳, `agent.ts`가 `mobile-push` 변경 위에서 고쳤는지, 확인한 것과 못 한 것(특히 창 없는 desktop에서 GUI view가 보이는지는 확인하지 못함), lead가 `harness-gui.md`·`terminal-agent.md`에서 고칠 것.
