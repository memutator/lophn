# mobile-host-link-shell

shell main이 core의 `/host-link`에 붙고, 지금 `host/take` long-poll로 하던 일(요청 받기, 답하기, browser 탭 상태 보고, 보이는 workspace와 TUI 목록 알리기)을 그 연결의 frame으로 한다. 끊기면 backoff로 다시 붙고 다시 `hello`부터 보낸다. coding session과 터미널 frame은 이 task가 보내지 않는다(`mobile-coding-shell`, `mobile-terminal-shell`). 이 task 뒤 shell main은 `host/take`, `host/done`, `host/report`를 부르지 않는다.

- 단위: host-link (wave 2)
- 선행: mobile-host-link
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/wiring/surface.ts`
  - `packages/shell/main/desktop/core/host-link.ts`(새 file)와 `host-link_test.ts`(새 file)
  - `packages/shell/main/desktop/wiring/context.ts`(`ShellContext.hostLink` 칸)
  - `packages/shell/main/desktop/wiring/core.ts`(연결이 core의 주소와 자격을 알아야 하는 만큼만)
  - `packages/shell/main/desktop/core/connection.ts`(위와 같은 이유로 필요한 만큼만)
  - `packages/shell/ipc/surface.ts`(주석과 type이 옛 route를 가리키는 만큼만)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `project-docs/flows/`의 area file(`areas/harness.yaml`의 `host/take`를 쓰는 shell 쪽 flow)과 `tests/shell.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.3, 2(설계 1)
  - 이 계획이 먼저 낸 것: `packages/protocol/host-link/frames.ts`(frame, `HOST_LINK_PATH`, `HOST_LINK_SUBPROTOCOL`), `mobile-host-link` brief의 "내놓는 것"(`hello`, `visible`, `response`, `report`, `request`의 의미와 `retry`)
  - 지금 loop: `packages/shell/main/desktop/wiring/surface.ts`(`loop()`, `done()`, `host/report` 호출 두 곳, `visibleWorkspaces()`, `tui.sessions()`), `packages/shell/main/browser/agent/driver.ts`(`browser_call` 결과를 `host/done`에 싣던 곳)
  - 본보기(연결과 backoff): `packages/shell/main/desktop/core/connection.ts`(Gateway의 `openGateway`, `x-lophn-shell-capability`, reconnect), `core/node-io.ts`(`nodeSockets()`: Node WebSocket에 Authorization header를 싣는 길), `packages/core/server/host-link.ts`(서버 쪽)
  - 다른 계획: `project-docs/plan/mobile-push/tasks/mobile-attention-desktop.md`는 `wiring/agent.ts`를 고친다. 이 task는 `agent.ts`를 고치지 않는다
- 계약:
  - 쓰는 것: `hostFrameSchema`와 `request` frame(위 `mobile-host-link`가 정했다). 요청 종류 중 `tab_open`, `tab_close`, `tab_show`, `tool_call`, `browser_call`, `terminal_interrupt`만 다룬다. 모르는 종류(`coding_*`, `terminal_stream`, `terminal_input`)는 `response`의 `output.error`(`unavailable`, 아직 처리기가 없다는 글)로 답한다
  - 내놓는 것(`mobile-coding-shell`, `mobile-terminal-shell`이 기댄다): `ctx.hostLink`:
    - `send(frame: HostFrame): boolean`(열려 있으면 보내고 true)
    - `onRequest(kind, handler)`(이 task가 처리하지 않는 요청 종류의 처리기를 다른 wiring이 단다. handler는 `(payload) => Promise<{content}|{error}>`를 돌려주고 `response`는 이 서비스가 보낸다. 한 종류에 하나)
    - `onOpen(handler)`(`hello`를 보낸 뒤 부른다. 다시 붙을 때마다 부른다. 다른 wiring이 snapshot과 보고를 다시 보내는 자리)
    - `connected(): boolean`

## 할 일

1. `core/host-link.ts`: `ShellContext`의 core 연결(주소, 사람 token, `x-lophn-shell-capability`)로 `nodeSockets()`의 WebSocket을 열고 `hello {version: 1, workspaces, tui}`를 보낸다. 끊기면 1초에서 30초까지 두 배로 늘리는 backoff로 다시 붙는다. core가 다시 떠 주소와 token이 바뀌면 새 값으로 붙는다(Gateway의 `relay.ready`와 같은 자리). frame은 `hostFrameSchema`로 검사해 보내고, 받은 frame은 `request`만 다룬다. 서비스는 파일 하나로 두고 Electron을 import하지 않는다(test가 돈다).
2. `surface.ts`: `loop()`의 `host/take` 호출을 지우고 연결의 `request` frame을 같은 분기(탭 열기·닫기, `tool_call`, `browser_call`, `terminal_interrupt`)로 처리한다. `done()`은 `response` frame을, `host/report` 호출은 `report` frame을 보낸다. 보이는 workspace와 TUI 목록(`visibleWorkspaces()`, `tui.sessions()`)이 바뀌면 `visible` frame을 보낸다(`take`가 매번 싣던 것을 바뀔 때만으로). 창이 못 받아 `retry`로 답한 요청은 core가 `RETRY_MS`(1초) 뒤 다시 보내도록 해야 한다(옛 loop는 `rest()`로 쉬었다). queue 쪽이 즉시 다시 보내지 않는지 `mobile-host-link`의 구현을 읽고 확인한다. 즉시 다시 보내면 shell 쪽에서 `retry`를 보내기 전에 1초 기다린다.
3. 연결이 끊긴 동안의 `tool_call`·`browser_call` 결과는 core가 이미 `unavailable`로 끝냈으므로 보내지 않고 버린다(끊긴 뒤 보낸 `response`를 core는 모르는 id로 무시한다).
4. `host-link_test.ts`: 가짜 socket으로 `hello`를 보낸다, 끊기면 다시 붙는다, `request`가 처리기를 거쳐 `response`로 간다를 본다.
5. 주석과 flows catalog에서 shell 쪽 `host/take` 설명을 연결로 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "\"host\", \"take\"\|\"host\", \"done\"\|\"host\", \"report\"" packages/shell`가 0줄이다.
- 확인: 실제 shell은 띄우지 않는다(사람에게 묻는 일). `npm run dev:core`로 core를 띄우고 `tools/fake-coding-host.ts`가 아니라 이 task의 `host-link.ts`를 Node에서 직접 열어 `hello`가 붙고 core의 `ctx.hostLink`가 attached가 되는지(`tabs/open`이나 `platform/status`로) 한 번 본다. 끝나면 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `ctx.hostLink`의 실제 시그니처, `retry`를 어떻게 처리했는지, 연결을 여는 시점, 확인한 것과 못 한 것(실제 shell을 띄우지 않았다는 것), lead가 flows와 `harness.md`·`extension.md` 같은 문서에서 고칠 것.
