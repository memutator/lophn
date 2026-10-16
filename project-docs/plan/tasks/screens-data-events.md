# screens-data-events

renderer의 data 층을 새로 짓는다. event client 하나, store 셋, UI용 hook, 반응 층(event를 넣으면 반응 목록이 나오는 순수 함수), 그리고 gallery와 dev-mock이 쓸 fake Gateway다. 대기 목록·toast·대화가 모두 이 위에 선다. 화면 모양은 없다.

- 단위: screens-data (wave 3)
- 선행: 없음 (계약 고정 뒤 열린다. contract-events가 `CoreApi.watch`·`onEvent`와 `protocol/events`를 고정했다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/connection.ts`, `connection.tsx`, `provider-state.ts`, `connection.module.css` (고치거나 둔다)
  - `packages/shell/renderer/desktop/connection/events/` (새로)
- 읽을 것:
  - spec: S1 4장(봉투와 구독)·6장(agent event)·7장(남지 않는 event)·8장(renderer 쪽 계약)·10장(꺼졌다 켜질 때)·12장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S2 6장(request 두 길) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `U3.1#1`, `U3.1#2`, `U3.1#3`, `U3.1#4`
  - inventory(참고, 다른 단위 몫): `U5#1`, `U5#2`, `I6#6`, `I6#20` — 순서 제약이다. 이 task가 "새 대기 목록"과 짝인 event client·store 층 쪽을 한다.
  - 결정: `../README.md` 3장 #2(agent event는 감독 pipe로 core Bus에), #11(event 구독은 shell main이 중계), #12(Gateway에 붙는 쪽은 shell main 하나)
  - 계약 file(읽는다): `packages/shell/ipc/core.ts`(`CORE_EVENT_CHANNEL`, `CORE_WATCH_CHANNEL`, `coreEventMessageSchema`, `coreWatchSchema`, `ConnectionState.schemaFailure`), `packages/shell/ipc/core-api.ts`(`CoreApi.watch`, `CoreApi.onEvent`), `packages/protocol/events/`(`busEventSchema`, `eventConditionSchema`, `snapshot.ts`의 `sessionSnapshotsList`와 `sessionSnapshotSchema`, 남지 않는 event `ApprovalRequested`·`AppViewChanged`), `packages/protocol/approvals/`(`approvalsPending`, `TurnPermissionRequest`, `PendingApproval`)
  - 지금 코드(고칠 곳): `packages/shell/renderer/desktop/connection/connection.ts`(`CoreSource`, `windowCoreSource`), `connection.tsx`(`useConnection`)
  - 본보기(동작 규칙): `tools/wireframes/frames/compositions/waiting/waiting-data.ts`의 `Requester`·`WaitingItem`(store 항목이 들어야 할 칸을 가늠한다)
- 계약:
  - 쓰는 것:
    - `CoreApi.watch(conditions)`: 이 renderer 창의 조건 전체를 통째로 바꾼다(main이 다른 조건과 합쳐 Gateway에 건다). `CoreApi.onEvent(listener)`: main이 중계한 `ready`·`event`·`closed` 메시지를 듣는다. event 본문은 `unknown`으로 오므로 `busEventSchema`로 읽는다.
    - 연결이 새로 붙으면 main이 조건을 다시 걸고 `ready`를 renderer에 다시 민다. renderer는 `ready`를 받은 뒤에야 snapshot을 읽는다(`sessionSnapshotsList`, `approvalsPending`, 질문 내용 read는 contract-agent-tools).
    - agent event: `SessionStarted`·`SessionEnded`·`TurnStarted`·`TurnEnded`·`PermissionRequested {request: TurnPermissionRequest}`·`PermissionResolved`·`QuestionAsked {group, turn, tool_call}`(내용은 싣지 않는다)·`QuestionResolved`·`MessageReceived {message, body, from, call, reply_to, steer}`. 남지 않는 event: `ApprovalRequested {request: PendingApproval}`. domain event: `AppRestartHalted`, `ContextViolationFound {project, context, check}`.
  - 내놓는 것(다른 task가 기대는 모양. 이름은 이대로 둔다):
    - `desktop/connection/events/client.ts`: `createEventClient(core: CoreSource): EventClient`. `EventClient.subscribe(condition, onMessage): () => void`. 구독자가 여럿이어도 `CoreApi.watch`에는 조건을 합쳐 한 번에 통째로 건다. 연결이 새로 붙으면 구독자마다 `onReady`를 불러 snapshot부터 읽게 한다.
    - `desktop/connection/events/waiting-store.ts`: 대기 목록 store. 항목은 `WaitingEntry`(`id`, `kind`: `permission | coding | question | activation | reaction`, session·agent·place·받은 시각, 원래 request 값 그대로). `PermissionRequested`(session이 coding agent면 `coding`)·`ApprovalRequested`(`intent.kind`가 activation이면 `activation`, reaction이면 `reaction`)·`QuestionAsked`가 넣고 `PermissionResolved`·`QuestionResolved`와 결정 뒤 목록 읽기가 뺀다. `ready` 뒤 snapshot(`turn 안 request` + `approvalsPending` + 질문 목록)이 목록을 통째로 맞춘다.
    - `desktop/connection/events/sessions-store.ts`: session 목록과 상태(`running | waiting | idle | unknown`)와 archive 여부. `SessionStarted`·`SessionEnded`와 상태를 바꾸는 event, `sessionSnapshotsList`로 채운다.
    - `desktop/connection/events/session-events-store.ts`: 열어 둔 대화 탭의 session별 agent event. 처음과 `ready` 뒤에만 snapshot을 읽는다.
    - `desktop/connection/events/hooks.tsx`: `EventsProvider({ client, children })`, `useWaiting(): { entries: readonly WaitingEntry[]; count: number }`, `useSessions()`, `useSessionEvents(session: string)`(`{ events; status: "loading" | "live" | "reconnecting" }`), `useEventClient(): EventClient`(toast 호스트처럼 store 없이 event를 직접 듣는 쪽이 쓴다).
    - `desktop/connection/events/reactions.ts`: `reactionsOf(event, origin: "live" | "snapshot"): readonly Reaction[]`. `Reaction`은 toast 하나(`{ id; titleKey; bodyKey; params; action? }`, `action`은 `{ kind: "waiting" } | { kind: "session"; session: string | null; app?: string } | { kind: "project-manager"; project; context; check }`)다. `session`이 `null`이고 `app`이 있으면 호스트가 그 앱의 App Engineer 열린 session을 찾아 연다. 순수 함수다.
    - `desktop/connection/events/fake-source.ts`: `CoreApi`의 `watch`·`onEvent`와 같은 모양을 가진 fake Gateway(`emit(message)`, `disconnect()`, `reconnect(snapshot)`). gallery와 `desktop/dev-mock`이 쓴다.

## 할 일

1. `connection.ts`의 `CoreSource`에 `CoreApi.watch`·`onEvent`를 더한다(`watch(conditions)`, `onEvent(listener)`). `windowCoreSource()`가 preload 통로를 그대로 넘기고, 통로가 없으면 빈 구독을 돌려준다. 근거: S1 8장, `U3.1#1`.
2. `events/client.ts`를 짠다. 구독자별 조건을 합쳐 `watch`로 통째로 걸고, 같은 event를 구독자 조건에 맞는 쪽에만 한 번씩 나눠 준다(조건 일치 규칙은 `eventConditionSchema` 주석을 따른다). 끊김(`closed`, `ConnectionState`의 `stale`·`failed`)을 구독자에게 알리고, 다시 `ready`가 오면 `onReady`로 snapshot을 다시 읽게 한다. 근거: S1 8장 "event client", S1 10장, `U3.1#1`.
3. store 셋(`waiting-store.ts`, `sessions-store.ts`, `session-events-store.ts`)을 짠다. 규칙:
   - event로 고치고, 처음과 `ready` 뒤에는 snapshot을 읽어 통째로 맞춘다(사라진 요청은 남지 않는다).
   - 같은 `id`의 요청은 한 번만 들어 있다.
   - 구독 조건은 종류만으로 모든 session을 받는다(S1 8장 구독 표). 열어 둔 대화 탭은 그 session의 모든 agent event를 더 받는다.
   근거: `U3.1#2`.
4. `events/hooks.tsx`를 짠다. component는 이 hook으로 store만 읽고 event도 연결도 모른다. 근거: `U3.1#3`.
5. `events/reactions.ts`를 짠다. S1 8장 반응 표를 그대로 코드로 옮긴다.
   - `PermissionRequested`·`ApprovalRequested`·`QuestionAsked` → toast(`{ kind: "waiting" }`).
   - `AppRestartHalted` → toast(`{ kind: "session", session: null, app }`. reaction이 여는 App Engineer session은 나중에 `SessionStarted`로 생기므로 이 시점에는 session id를 모른다).
   - `ContextViolationFound` → toast(눌러야만 Project Manager session으로 간다. payload의 `project`, `context`, `check`를 action에 싣는다. 위반 파일과 규칙은 호스트가 읽는다).
   - 그 밖의 event → 반응 없음.
   - snapshot에서 온 항목(`origin: "snapshot"`)은 toast를 만들지 않는다(S1 8장: 놓친 toast는 다시 띄우지 않는다).
   toast 문구 key는 `screens-data-toast`가 만든다. 여기서는 key 이름을 `waiting.toast-<종류>` 꼴(`permission`, `approval`, `question`, `restart-halted`, `violation`)로 부르기만 한다. 근거: `U3.1#4`.
6. `events/fake-source.ts`를 짠다. 시나리오를 손으로 흘릴 수 있어야 한다(요청 넣기, 해결, 끊김, 재연결과 snapshot).
7. 3초 polling 장치를 이 폴더에서 쓰지 않는다. 근거: `U1.1#4`(이 task는 data 층 쪽만 한다. 옛 pill의 `useRequestOverview` polling은 `screens-data-waiting`이 pill을 바꿀 때 사라진다).
8. (lead가 맞추며 더함) session snapshot 읽기는 contract-events의 `protocol/events/snapshot.ts`(`sessionSnapshotsList`)다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "다시 붙을 때 snapshot이 대기 목록을 맞추고, 해결돼 사라진 요청은 남지 않으며, snapshot으로 들어온 항목은 toast 반응을 만들지 않는다. 같은 event를 두 번 받아도 대기 항목이 하나다" — `desktop/connection/events/waiting-store_test.ts`(수동 clock과 fake Gateway, 사건 표 하나).
- 남지 않음: `grep -rn "POLL_MS\|intervalTicks" packages/shell/renderer/desktop/connection`이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 창마다 `EventsProvider`를 한 번 마운트한다(`packages/shell/renderer/desktop/entry.tsx`·`main.tsx`는 screens-workspace 소유다. lead가 `screens-workspace-space` brief와 맞춘다). `tools/wireframes`의 mock 조립(`frames/mock-desktop.tsx`)에서 `fake-source.ts`를 `CoreSource`로 끼우는 줄은 lead 몫이다. wording key는 이 task에 없다.
- 안 쓰게 된 export: `CoreSource`에서 쓰이지 않게 된 것이 있으면 적는다(남이 쓰던 것은 지우지 않는다).
- 정한 것: store 항목이 request 값을 그대로 드는지, 질문 내용을 언제 읽는지(`QuestionAsked`는 내용을 싣지 않는다), `AppRestartHalted` toast에서 session을 찾는 규칙은 호스트 몫이라는 것
- 계약 바꾸기 요청(wave 3): event나 snapshot에 필요한 칸이 없으면 여기 적는다
