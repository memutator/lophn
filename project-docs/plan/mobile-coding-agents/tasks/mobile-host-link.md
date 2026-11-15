# mobile-host-link

shell main과 core 사이에 양방향 연결 `/host-link`(WebSocket)를 짓는다. frame schema(coding session과 터미널 frame까지 전부), core의 endpoint, host queue가 연결 위로 요청을 보내고 답을 받는 길, 가짜 host test를 만든다. 이 task는 옛 route(`host/take`, `host/done`, `host/report`, `terminal_sessions/report`)를 지우지 않는다. 연결과 long-poll이 같은 queue를 쓰는 임시 이중 길이고 `mobile-host-link-cleanup`이 지운다.

- 단위: host-link (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/host-link`(새 폴더 전체: `frames.ts`, `mod.ts`)
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/core/host-queue`
  - `packages/core/server/host-link.ts`(새 file)와 `packages/core/server/host-link_test.ts`(새 file)
  - `packages/core/server/server.ts`
  - `packages/core/server/mod.ts`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/core/main/daemon/wiring/server.ts`
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `packages/core/main/daemon/wiring/context.ts`(`ctx.hostLink` 칸), `project-docs/module-catalog.yaml`(`packages/protocol/host-link` 항목), `project-docs/flows/`의 area file과 `tests/*.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 1.3(host 연결), 2(설계 1), 3(frame). 이 brief가 survey와 다르면 이 brief가 맞다
  - architecture: `project-docs/architecture/platform.md`("core가 shell을 띄운다"), `harness-gui.md`, `remote.md`; boundary `project-docs/boundary-catalog.yaml`의 `host-queue-interface`
  - 지금 long-poll: `packages/protocol/lophn-agent/host-queue.ts`(`hostTake`, `hostDone`, `hostReport`, `hostRequestSchema`, `HOST_TAKE_WAIT_MS`), `packages/core/host-queue/queue.ts`(`take`, `done`, `attached`, `ATTACHED_MS`, `isCall`, `call`), `hold.ts`(TUI hold heartbeat), `packages/core/main/daemon/wiring/host-queue.ts`(route 등록, `report`, `startShell`), `packages/shell/main/desktop/wiring/surface.ts`(shell 쪽 loop. 이 task는 고치지 않는다)
  - 본보기(upgrade와 frame): `packages/core/server/server.ts`의 `acceptUpgrade`와 `createGatewayUpgrade`(Host, Origin, Bearer 검사와 연결 한도), `packages/core/server/socket.ts`(Gateway의 frame 한도와 buffer 한도), `packages/protocol/events/gateway.ts`
  - 다른 계획: `project-docs/plan/mobile-push/`(`mobile-attention-*`)는 이 task의 file을 소유하지 않는다. `terminal_sessions/signal`은 거기서 오는 작은 HTTP route이고 이 task와 상관없다
- 계약:
  - 쓰는 것: `AcpState`, `AcpUpdate`, `AcpInput`(`packages/protocol/acp`), `TerminalSessionReport`(`packages/protocol/lophn-agent/session-lifecycle.ts`), `HostWorkspace`, `HostToolOutput`, `BrowserTabState`(`host-queue.ts`)
  - 내놓는 것(뒤 task들이 기댄다. 모양을 정확히 이대로 쓴다):
    - 연결: `GET /host-link`, subprotocol `lophn.host-link.1`, 상수 `HOST_LINK_PATH`와 `HOST_LINK_SUBPROTOCOL`을 `packages/protocol/host-link/frames.ts`에서 내보낸다. 자격은 loopback의 Host·Origin·Bearer 검사를 Gateway와 같게 하고 사람 자격(actor `user`)만 받는다. frame은 JSON 글 frame, 한 frame 최대 16 MiB(`REMOTE_FRAME_MAX_BYTES`와 같은 값을 import한다). 보내는 쪽 buffer가 1 MiB를 넘으면 연결을 닫는다(Gateway 규칙).
    - host가 core로(`hostFrameSchema`, `type`으로 가르는 discriminated union):
      - `hello {version: 1, workspaces: HostWorkspace[] (최대 64), tui: ses[] (최대 64)}`: 연결 뒤 첫 frame
      - `visible {workspaces, tui}`: 바뀔 때. `hello`와 같은 칸
      - `response {id: hrq, result: "done"|"retry", output?: HostToolOutput}`: `host/done`의 대신
      - `report {tab: tab, state: BrowserTabState | "closed"}`: `host/report`의 대신
      - `coding_report {sessions: TerminalSessionReport[] (최대 64)}`: `terminal_sessions/report`의 대신. 바뀔 때와 연결을 연 뒤 보낸다. `TerminalSessionReport`의 새 칸(`view`, `handoff`, `foreground`)은 `mobile-coding-state`가 schema에 더한다. 이 task는 import만 한다
      - `coding_sync {session: ses, snapshot?: AcpState, updates?: AcpUpdate[]}`: 한 session의 상태. 연결을 열 때마다 snapshot부터
      - `coding_closed {session: ses}`
      - `terminal_screen {terminal_ref, generation: int, seq: int, columns: int, rows: int, cursor: {x, y, hidden}, scrollback: TerminalLine[], lines: TerminalLine[]}`: 보는 중인 터미널의 지금 화면 전체(viewport는 `lines`, 그 위 scrollback의 끝쪽은 `scrollback`). 매번 전체이고 최신이 옛것을 대신한다
    - `TerminalLine = {runs: {text: string, fg?: string, bg?: string, bold?: boolean, dim?: boolean, italic?: boolean, underline?: boolean, inverse?: boolean, wide?: boolean}[], wrapped: boolean}`: `frames.ts`에 `terminalLineSchema`로 정의하고 `mobile-terminal-core`가 import한다. 색 값은 `#rrggbb` 글이거나 0~255 palette 번호의 글(`"p12"`)이다
    - core가 host로: `request {…HostRequest}`: 한 frame에 요청 하나. 기존 `hostRequestSchema`의 종류(`tab_open`, `tab_close`, `tab_show`, `tool_call`, `browser_call`, `terminal_interrupt`)에 다음을 더한다(workspace 칸이 없는 요청이고 `tool_call`처럼 연결이 끊기면 `unavailable`로 끝난다):
      - `coding_input {id, kind, payload: {session: ses, input: AcpInput}}`: 답은 `response`의 `output.content`(글 `ok`) 또는 `output.error`(`not_found`: handle 없음)
      - `coding_switch {…, payload: {terminal_ref, to: "gui"|"tui"}}`: 답은 content `ok` 또는 error(`conflict`·`unavailable`·`not_found`·`invalid_input`, `details.reason`은 `no_session|not_running|extension_off|unsupported_os|failed`)
      - `coding_open {…, payload: {project: prj, harness: string, resume?: {session: ses}}}`: 답은 content 글 하나(JSON `{"terminal_ref":"…"}`)이거나 error. `mobile-coding-open-host`가 구현한다
      - `terminal_stream {…, payload: {terminal_ref, on: boolean, tail: int (0~500)}}`: 터미널 화면을 밀어 올리기 켜고 끄기
      - `terminal_input {…, payload: {terminal_ref, text: string (최대 8192)}}`
    - queue(`packages/core/host-queue`)의 계약: 위 새 요청 다섯은 workspace 없이 아무 host에게 간다. `HostQueueService`에 `callCoding(payload)`(위 네 요청과 `terminal_interrupt` 같은 꼴. 이름은 정해도 된다)를 더해 `Result<HostToolOutput content>`로 돌려주고, 기한은 요청 종류마다 상수로 둔다(`coding_input` 10초, `coding_switch` 60초, `coding_open` 60초, `terminal_stream`·`terminal_input` 5초). 연결이 닫히면 `tool_call`·`browser_call`처럼 진행 중인 것을 `unavailable`로 끝낸다.
    - core의 서비스(`ctx.hostLink`): `attached(): boolean`, `onFrame(type, handler)`(`coding_report`, `coding_sync`, `coding_closed`, `terminal_screen` 같은 이 task가 처리하지 않는 frame을 다른 wiring이 받는 곳. 처리기는 연결 하나가 닫혀도 그대로이고 한 종류에 하나만 둔다), `onClose(handler)`(연결이 닫힌 뒤 호출. 유예 3초 뒤가 아니라 바로 부른다), `onOpen(handler)`(`hello`를 받은 뒤 부른다). 연결은 한 번에 하나만 받는다: 새 연결이 오면 옛 연결을 닫는다(shell main은 하나다)
    - `queue.attached()`는 연결이 열려 있거나 최근 `take`가 있으면 true다. 연결이 붙은 동안 queue는 `take`와 같은 규칙(그 workspace들의 가장 오래된, 빌려 가지 않은 요청, 빌린 요청은 `BORROW_MS` 뒤 되돌림, `tool_call`·`browser_call`은 되돌리지 않음)으로 요청을 `request` frame에 실어 보낸다. 가장 단순한 길은 연결마다 서버 쪽에서 `take` 루프를 돌리는 것이다(`visible`의 workspaces로 `take`, `AbortSignal`로 닫을 때 끝). `response`는 `done`에, `report`는 `host/report`의 기록에 그대로 이어진다.
    - TUI hold의 heartbeat: 연결이 열려 있는 동안 core가 마지막 `tui` 목록으로 hold를 5초마다 갱신한다(`take`가 하던 일). 연결이 닫히면 갱신이 멈춰 10초 뒤 풀린다.

## 할 일

1. `packages/protocol/host-link/frames.ts`에 위 frame과 상수와 `terminalLineSchema`를 zod로 쓰고(`z.strictObject`, 한 칸 한 줄 주석은 "왜"만) `mod.ts`로 내보낸다. `packages/protocol/lophn-agent/host-queue.ts`의 `hostRequestSchema`에 위 새 요청 종류를 더한다(옛 route 정의는 그대로 둔다).
2. `packages/core/host-queue/queue.ts`: 새 요청 종류를 `call`로 부르는 메서드, `isCall` 종류 확장, 연결이 붙은 동안의 attached 판정. `hold.ts`는 연결의 `tui`로 갱신하게 이어진다.
3. `packages/core/server/host-link.ts`: upgrade를 받아 frame을 검사하고(schema가 틀린 frame은 연결을 `1008`로 닫는다), 위 계약대로 `ctx.hostLink` 서비스와 queue를 잇는다. `server.ts`의 `acceptUpgrade`에서 path가 `HOST_LINK_PATH`일 때 이 file로 보내는 줄 하나를 더한다(Gateway와 같은 gate와 한도). `mod.ts`로 내보낸다.
4. `packages/core/main/daemon/wiring/host-queue.ts`와 `wiring/server.ts`에서 연결을 queue와 server에 꽂고 `ctx.hostLink`를 낸다(`wiring/context.ts`에 칸 한 줄).
5. 가짜 host로 `host-link_test.ts`를 쓴다: 메모리 WebSocket 쌍이나 실제 server를 띄우지 않는 in-process 전송으로(subprocess, 서버, 브라우저를 띄우는 test는 새로 만들지 않는다. 기존 `host_test.ts`·`queue_test.ts`의 메모리 전송 꼴을 따른다).
6. flows catalog를 맞춘다(새 연결 입구와 새 test file).

## 끝남

- `npm run check`가 통과한다. `queue_test.ts`, `hold_test.ts`, `wiring/host-queue_test.ts`, `wiring/extension-tools_test.ts`는 옛 길 test라 그대로 통과해야 한다(지우지 않는다).
- 위험 test:
  - "자격이 없거나 사람 자격이 아니거나 Origin이 다른 upgrade는 `/host-link`에서 거절된다"
  - "연결이 닫히면 진행 중인 `tool_call`·`browser_call`·`coding_*` 요청이 `unavailable`로 끝나고, 빌려 간 탭 요청은 다시 대기한다"
- 남지 않음: 없음(지우는 것이 없다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 내보낸 type과 상수 이름, queue에 더한 메서드 이름과 기한 상수, 서버 쪽 `take` 루프로 했는지, 옛 길과 연결이 동시에 붙으면 어떻게 되는지, lead가 flows·`host-queue-interface` boundary에서 고칠 것.
