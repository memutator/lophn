# platform-desktop

shell main의 `desktop/`(창, 연결, 단일 instance, 창 열기 intent, 폴더·파일 고르기, core 연결의 event 중계와 시작 실패 처리)를 새 계약에 맞춘다. 쓰는 곳이 사라진 통로(OS notification 연결, windowless confirmation 등록, 문서 판 worker route, `things-to-confirm`·ticket 링크 intent)를 걷고, 새 IPC(`event` 중계, 폴더·파일 고르기)를 구현한다. 위쪽 바가 36px로 바뀌므로 `TOP_BAR_HEIGHT`를 고친다.

- 단위: platform (wave 3)
- 선행: `screens-data-secret-input`(`packages/shell/main/build.ts`를 차례로 고친다), 계약 고정(contract-shell, contract-events, contract-platform), remove-platform(wave 1의 remove-platform-shell이 `desktop/os-notification.ts`, `desktop/core/restore*.ts`, `update-ipc.ts`를 지운다), ui-chrome-top-bar(위쪽 바 36px), platform-runtime(core가 보내는 시작 실패 frame)
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/` (단 `coding-connection.ts`와 `coding-ipc.ts`는 coding-agent 소유라 고치지 않는다)
  - `packages/shell/main/entry.ts`, `packages/shell/main/build.ts` (preload 번들 목록. 이 file들은 지금 어느 단위에도 적혀 있지 않아 소유 바꾸기가 필요하다)
- 읽을 것:
  - spec: S1 8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md` (Gateway는 shell main 하나가 사람 token으로 붙고 renderer에 중계한다. 끊기면 snapshot부터 다시 읽는다)
  - inventory: `I1.9#3`, `I1.9#4`, `I1.9#9`, `I2.1#6`, `I2.1#7`, `I2.9#5`, `I2.11#13`
    - 같이 볼 줄(배정이 다른 단위인 것): `I1.6#25`(ticket 링크 intent, contract-shell. main 쪽 사용을 이 task가 걷는다), `U2.6#2`(시작 실패 화면, screens-workspace), `I1.9#6`·`I1.9#8`(OS notification·update. remove-platform이 했는지 확인)
  - 결정: `../README.md` 3장 #11·12(event 구독은 shell main이 중계한다. Gateway에 붙는 쪽은 shell main 하나), #17(`refreshAppViews` 대신 남지 않는 event `AppViewChanged`)
  - 본보기(화면): `tools/wireframes/frames/compositions/workspace/start-failure-page.tsx`(시작 실패 이유 구별)
  - 지금 코드: `main/desktop/main.ts`(1,688줄. `osNotifications`·`arrived` 347~349행, `refreshAppViews` 946~957행, windowless confirmation 등록 1161행, intent 처리 930~940행·1334~1337행), `desktop/core/{events,connection,supervise,allowlist}.ts`, `desktop/open-intent.ts`, `desktop/single-instance.ts`, `desktop/folder-picker.ts`, `desktop/window.ts`(`TOP_BAR_HEIGHT = 48`)
- 계약:
  - 쓰는 것
    - `shell/ipc/folder-picker.ts`(`FOLDER_PICK_CHANNEL`의 `purpose`, `FILE_PICK_CHANNEL`), `shell/ipc/overlay.ts`(변경 없음, `tone`은 renderer 쪽) — contract-shell
    - `shell/ipc/core.ts`의 `CORE_WATCH_CHANNEL`, `CORE_EVENT_CHANNEL`, `coreWatchSchema`, `coreEventMessageSchema`, `ConnectionState.schemaFailure`, `protocol/events/gateway.ts`의 `GATEWAY_PATH`, `GATEWAY_SUBPROTOCOL`, client frame `watch`, server frame `ready`·`event`·`closed`, close code — contract-events
    - `protocol/supervision`의 `startFailedSchema`, `START_FAILURE_REASONS` — contract-platform
  - 내놓는 것: 이 task가 내놓는 새 계약은 없다. main이 등록하는 새 IPC handler의 쓰는 쪽 계약은 contract 단위가 정했다.

## 할 일

1. **event 중계** `desktop/core/events.ts` — `I2.1#6`
   - 지금은 main이 ledger를 `events.list`로 cursor 따라잡고 WebSocket으로 받아 `arrived`로 OS notification과 앱 view에만 먹인다. 이것을 contract-events의 Gateway로 바꾼다: main이 사람 token으로 `GATEWAY_PATH`에 `GATEWAY_SUBPROTOCOL`로 붙고, renderer가 `CORE_WATCH_CHANNEL`로 보낸 조건(통째로 바뀐다)과 main 자신의 조건(2번)을 합쳐 `{ type: "watch", conditions }` frame으로 건다. 받은 `ready`·`event`·`closed` frame은 `CORE_EVENT_CHANNEL`로 renderer에 그대로 민다. 연결이 새로 붙을 때마다 조건을 다시 걸고 `ready`를 renderer에 다시 민다(renderer가 snapshot부터 다시 읽는다).
   - 지금 것에서 살리는 것: 끊김 backoff, `stale` 상태, epoch·generation 처리. 없애는 것: `events.list` cursor와 catch-up read(backlog 구분), `EventSink.arrived`/`caughtUp`.
   - token은 main에만 있다. 느린 구독자로 끊기면(`closed`의 `slow_consumer`) 같은 방식으로 다시 붙는다.
   - `desktop/os-notification.ts`(remove-platform이 지웠다)를 부르는 `main.ts`의 `createOsNotifications`, `osNotifications.arrived` 연결을 걷는다.
2. **앱 view 새로고침** `main.ts`의 `refreshAppViews` — `I2.1#7`
   - `GrantCreated`·`GrantRevoked`·`ReleaseActivated`는 사라지는 domain event다. main이 자기 조건(`types: ["AppViewChanged"]`)을 1번의 `watch`에 합쳐 남지 않는 event `AppViewChanged`(subject `app`, payload `{ reason: "activation" | "grant" | "rewind" }`)를 받고 `appFrame.refresh(subject의 app)`을 부른다. 이 event는 renderer에도 같이 가지만 main이 먼저 쓴다.
   - 앱 view 새로고침을 호출하는 `appFrame`은 screens-app-space 소유이므로 인터페이스(`refresh(app?)`)만 쓰고 고치지 않는다.
3. **시작 실패 처리** `desktop/core/{supervise,connection}.ts` — `I2.11#13`(shell 쪽)
   - core가 부모 pipe로 보내는 `start_failed` frame(`startFailedSchema`)을 받는다. `reason`이 `newer_schema`, `history_mismatch`, `damaged_original`이면 연결 상태를 `failed-schema`로 세우고 `schemaFailure`에 같은 값을 싣는다. `other`나 frame 없이 끝난 core는 `failed-start`다(지금은 모두 `failed-start`다. `connection.ts` 약 170행).
   - sandbox 문제는 지금처럼 `failed-sandbox`다. 화면 문구와 안내는 screens-workspace가 그린다.
4. **창 열기 intent** `desktop/open-intent.ts`, `single-instance.ts`, `main.ts`의 `openIntent` — `I2.9#5`, `I1.9#9`, `I1.6#25`(main 쪽)
   - 읽는 intent를 `--quit`, `--open-app <app ID>` 둘로 줄인다(`OpenIntent`는 `window`, `quit`, `app`). `lophn://things-to-confirm/<id>` 링크와 `CODING_LINK`(`cac`·`tkt`·`app`)를 읽는 코드, `readConfirmLink`, `readCodingLink`, `openUrlIntent`, OS URL scheme 등록(`registerUrlScheme`, macOS `open-url`)을 지운다. 이 링크를 만드는 쪽(OS notification, coding CLI의 결정 링크)이 모두 없어진다.
   - 단일 instance는 남긴다(`I1.9#9`): OS 앱 바로가기가 `--open-app`으로 이미 떠 있는 main에 앱 창을 요청하는 데 쓴다. second-instance argv 처리도 남기되 위 두 intent만 읽는다. `--tray`(`protocol/shell/launch.ts`)와 tray·autostart·전역 shortcut은 보류 목록에 없으므로 그대로 둔다.
   - 이것은 `../../tmp/inventory/00-decisions.md` 123~126과 "확인 못함 3"에서 답이 갈린 부분이다. 보고의 "정한 것"에 적고 lead가 사람에게 확인한다.
   - renderer로 보내는 `DESKTOP_INTENTS`의 `things-to-confirm`·`coding` 가지(`ipc/shortcuts.ts`)는 이 task가 보내지 않는 것으로 끝낸다. 계약 file은 cleanup이 고친다.
5. **allowlist** `desktop/core/allowlist.ts` — `I1.9#4`
   - `READING_WORKER_ROUTES`에서 `worker:documents/section_history`, `worker:documents/diff`, `worker:projects/preview_tracking`, `worker:guides/list`·`get`·`outline`·`read`를 뺀다.
   - `RENDERER_MEMORY_ROUTES`에 contract-platform의 memory route를 더한다: `memory:settings/list`, `memory:settings/update`, `memory:secrets/status`, `memory:secrets/delete`, `memory:diagnostics/status`.
6. **windowless confirmation 등록** — `I1.9#3`
   - `main.ts`의 `WINDOWLESS_CONFIRMATION_CHANNEL` handler 등록(import 54~55행, `ipcMain.handle` 1161행, `removeHandler` 1264행)은 screens-data-secret-input이 확인 창 연결 블록과 함께 걷는다(그 task가 `main.ts`의 그 블록을 추가 소유로 요청했다). 이 task는 그 줄을 고치지 않고, 이 task가 시작할 때 이미 걷혔는지만 확인한다. 걷히지 않았으면 보고에 적는다. 질문은 대기 목록으로 가므로(S4 6장) 이 길이 필요 없다.
7. **폴더·파일 고르기** `desktop/folder-picker.ts` — contract-shell의 3번
   - `FOLDER_PICK_CHANNEL`이 `{ purpose?: "register" | "relocate" }`를 받는다. dialog 제목을 purpose로 정한다(문구는 `desktop/wording.ts` 옆의 wording 규칙을 따른다). 새 `FILE_PICK_CHANNEL`은 같은 guard로 한 파일의 절대 경로를 돌려준다. headless 확인은 지금처럼 개발 확인이 준 값만 돌려준다.
   - `main.ts`에 `FILE_PICK_CHANNEL` handler 등록 한 줄을 더한다.
8. **위쪽 바 높이** — ui-chrome-top-bar의 넘기는 일
   - `desktop/window.ts`의 `TOP_BAR_HEIGHT`를 36으로 바꾼다. 쓰는 곳(`main.ts` 468~470행의 앱 view bounds, `main/app-frame/electron-overlay.ts`)이 같은 값을 쓴다.
9. **새 IPC 등록** — 이 task는 이 둘의 handler를 구현하지 않는다. contract-shell의 `shell:file-*`(screens-project가 `main/editor/`에서 구현), `shell:secret-input-open`(screens-data가 `main/confirmation/`에서 구현)은 각 단위가 register 함수를 내놓고 lead가 `main.ts`에 한 줄씩 더한다(보고의 등록할 것). `main/build.ts`의 preload 번들 목록에 `preload/secret-input.ts`를 더한다.

- (lead가 더함) `shell:file-list`(`FilesApi.list`) handler는 폴더를 먼저, 그다음 파일을 내고 각 묶음 안은 이름순이다(wireframe과 screens-project-sidebar의 fake와 같다). 연결 폴더와 그 하위 폴더 밖 경로는 거절하고, 정규화와 symlink 처리도 이 handler에서 한다(renderer는 연결 폴더 아래 경로만 보낸다).

- (lead가 더함, screens-data-waiting이 넘긴 것) `shell/main/desktop/core/allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `memory:approvals/decide_turn`, `memory:ask/read`, `memory:ask/answer`를 더한다(대기 목록의 권한 결정과 질문 읽기·답). contract-coding-routes가 넘긴 `coding_agent_terminals.result|exited`, `coding_agent_harnesses.report|list`와 contract-platform이 넘긴 `settings/list|update`, `secrets/status|delete`, `diagnostics/status`도 같이 본다(`secrets/put`은 upload라 넣지 않는다).
- (lead가 더함, platform-runtime이 넘긴 것) core가 시작에 실패하면 부모 pipe로 `{type: "start_failed", reason}` frame을 보낸다(main `c4979bf6`). shell main이 이 frame을 받아 시작 실패 화면의 이유로 쓴다.

- (lead가 더함, screens-project-editor가 넘긴 것) shell CSP(`main/desktop/shell-protocol.ts`의 `SHELL_CSP`)에 `img-src blob:`과 `object-src blob:`(pdf `<embed>`)을 더한다. 편집기가 이미지와 pdf를 blob URL로 그린다. `settings/list`·`settings/update`는 renderer memory allowlist에 이미 위 목록에 있다.

- (lead가 더함, screens-project-window가 넘긴 것) `main/desktop/window.ts`의 `TOP_BAR_HEIGHT = 48`인데 renderer는 36이다. 앱 view y offset을 36으로 맞춘다. screens-conversation-core-source가 넘긴 것: shell main allowlist에 memory route `approvals/decide_turn`, `ask/read`, `ask/answer`, `session_inputs/steer_now`, `session_inputs/remove`를 더한다(대화 source와 `waiting/decide.ts`가 쓴다). `rewind/summary-*`는 이제 아무도 쓰지 않으니 뺀다.

- (lead가 더함, screens-agents-editor의 계약 바꾸기 요청, lead 승인) shell IPC `coreCallSchema`(`packages/shell/ipc/core.ts`)의 kind가 `read|command|worker|memory`뿐이라 renderer가 upload·file route(`profileImageUpload`·`profileImageRead`)를 부를 수 없다. kind `upload`(byte 본문)와 `file`(byte 응답)을 더하고 main의 core 호출 쪽에 구현한다(계약 file 추가 소유, lead 승인). 그 뒤 `workspace/agents/core-source.ts`의 `uploadImage`·`imageSrc` 두 함수를 이 길로 바꾼다(추가 소유). allowlist는 registry에서 만들어지니 upload·file route도 같이 열리는지 본다.

- (lead가 더함, app-calls-shell의 계약 바꾸기 요청, lead 승인) 앱 화면 byte를 위해 `desktop/core/client.ts`에 `fileStream(resource, method, body, signal)` → `{status, headers, body: ReadableStream}`을 더한다. 지금 `desktop/wiring/app-views.ts`는 `session.readStream`(전체를 32MiB까지 모으고 MIME은 확장자로)을 쓴다. 더하면 그 upstream이 core의 Content-Type과 취소를 쓰게 바꾼다(추가 소유: `app-frame/app-protocol.ts`의 upstream 줄).

## 끝남

- `deno task check`가 통과한다. (`packages/shell/main`의 check script도 통과한다.)
- 위험 test: 없음
- 남지 않음: `grep -rn "osNotifications\|createOsNotifications\|readConfirmLink\|readCodingLink\|registerUrlScheme\|section_history\|preview_tracking" packages/shell/main/desktop`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `main.ts`에 files IPC·secret input open IPC register 줄(lead), `shell/main/build.ts` preload 목록, 앱 view 새로고침을 이은 `appFrame.refresh`가 `app`을 받는지 확인
- 안 쓰게 된 export: `ipc/shortcuts.ts`의 `ConfirmTargetIntent`·`CodingTargetIntent`, `protocol/shell/launch.ts`의 `thingsToConfirmLinkSchema`, `ipc/windowless-confirmation.ts`(cleanup이 지운다)
- 정한 것: 문서에 답이 없어 정한 것(단일 instance와 `--open-app` 유지, URL scheme 등록 삭제, 시작 실패 reason → 상태 대응)
- 걱정: `desktop/main.ts`가 1,688줄이고 여러 단위의 IPC 등록이 모인다. 병렬로 고치면 충돌한다. core 조립처럼 module마다 register 함수로 쪼개는 작업(core-wiring와 같은 꼴)을 lead가 먼저 결정하는 것을 권한다
