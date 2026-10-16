# screens-conversation-source

Agent 탭이 core에 묻고 쓰는 통로를 새 모양으로 정한다. 새 interface `AgentTabSource`, 그 fake 구현, 화면이 store와 event로 읽는 hook, 보내기 상태의 이름 바꾸기다. 화면 부품(thread, cards, composer, sessions)이 모두 이 타입 위에 선다. 옛 `agent-source.ts`와 core source는 이 task에서 지우지 않는다(옆에 더한다). 옛것은 `screens-conversation-view`가 지운다.

- 단위: screens-conversation (wave 3)
- 선행: screens-data-events (`useSessions`, `useSessionEvents`, `useWaiting`을 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/agent-tab-source.ts` (새로: interface와 화면 값 type)
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts` (새로)
  - `packages/shell/renderer/conversation/agent-tab-data.ts` (새로: hook)
  - `packages/shell/renderer/conversation/delivery-state.ts`, `drafts.ts`, `bodies.ts`, `window-deps.tsx` (이름과 모양을 고친다)
  - `packages/shell/renderer/desktop/dev-mock/agent.ts` (추가 소유, lead 승인 2026-10-16: `desktop/`은 screens-workspace 소유다. 이 file만 이 task가 가진다)
  - `packages/design/wording/catalog/conversation.ts`와 생성물 `catalog/conversation.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S1 8장(store와 반응 층, 열린 대화 탭은 그 session의 agent event를 받고 처음과 다시 붙을 때만 snapshot을 읽는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S3 3~5장(call 봉투, 받는 곳, 답 방식과 상태) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S4 3장(질문 tool), 7장(commands) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S8 3~5장(session 수명, session rewind와 앱 rewind, fork) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S2 6장(request 선택지) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `U2.1#1`, `U2.2#4`(보내기 방식의 상태 쪽), `U2.2#17`, `U1.1#7`(dock·Roles·provider 계정 흔적 가운데 이 task가 만지는 이름)
  - 결정: `../README.md` 3장 #18·#23·#57(`run` → turn, `correction` → steer, `command` → app-api, Context Engineer → `project_manager`), #4(session 입력함은 메모리, 사람 메시지는 접수할 때 기록에 쓴다)
  - 지금 코드: `conversation/agent-source.ts`(407줄, `AgentViewSource`), `agent-view-data.ts`(3초 polling), `agent-core-source*.ts`(core 구현. 이 task가 읽기만 한다), `testdata/fake-agent-source.ts`, `agent-view-model.ts`
  - 본보기(화면 값의 모양): `tools/wireframes/frames/compositions/agent-tab/data.ts`(보낸 쪽 `Sender`·`Envelope`, `CallView`, `AskedQuestion`, `ApprovalContent`·`ApprovalResultView`, rewind의 `RewindApp`, `GrantRow`), `compositions/agents-data.ts`(`SessionRow`, `SlashCommand`), `compositions/conversation.tsx`(`Turn`, 이야기 장면)
- 계약:
  - 쓰는 것:
    - `packages/protocol/lophn-agent`의 `agent-sessions.ts`(`openAgentSession`, `agentSessionRead`, `agentSessionList`, archive·delete·fork·rename·compact), `session-rewinds.ts`(`sessionRewind`, `sessionRewindPreview`: `choice`는 `restore_all | messages_only | summarize`와 `apps`), `turns.ts`·`turn-reads.ts`(`turnList`, `turnResult`, `turnBody`), `calls.ts`(call 봉투, 읽기), messages·questions·commands·models·traces (contract-calls-places, contract-agent-tools): route와 type 이름은 그 파일을 그대로 따른다. `undo`·`redo`는 새 계약에 없다.
    - `packages/protocol/events`의 agent event (contract-events): `MessageReceived {message, body, from, call, reply_to, steer}`가 사람 메시지·call·답·reaction을 모두 보인다. `TurnStarted`·`TurnEnded {turn, outcome, messages, error}`·`ToolCallStarted/Ended`·`PermissionRequested/Resolved`·`QuestionAsked {group, turn, tool_call}`(질문 내용은 싣지 않는다)·`QuestionResolved`·`CompactStarted/Ended`·`SessionStarted/Ended`. `useSessions`·`useSessionEvents`·`useWaiting` (screens-data-events)
    - `packages/protocol/approvals` (contract-approvals)의 결정 결과 상태(접수·적용·거절·cancelled)와 `TurnPermissionRequest.choices`
  - 내놓는 것(다른 task가 기대는 모양):
    - `AgentTabSource`(아래 표)와 화면 값 type: `AgentFace`, `SessionEntry`, `ThreadView`(`entries`, `turn`, `tasks`, `queued`, `pending`), `ThreadEntry`(message·tools·edit·call·questions·approval-result·turn-end·hidden·provider-error), `Envelope`(보낸 쪽 chip과 panel이 읽는 것), `CallView`, `AskedQuestion`, `ApprovalCardRequest`, `RewindPreviewView`, `GrantRow`
    - `AgentTabSourceFactory`: agent 하나의 source를 얻는 함수. 호스트(project 창 `workspace/kinds/host.ts`, 앱 공간 `app-frame/agent-pane.tsx`, `desktop/entry.tsx`·`main.tsx`)가 지금 부르는 인자 모양 `{ assignment, place: { kind, id } }`를 이 task에서는 바꾸지 않는다(칸 이름 `assignment`의 값은 agent id가 된다. 호스트가 새 모양으로 갈아탈 때 이름을 바꾸는 일은 cleanup이 한다). 옛 `AgentViewSourceFactory`가 호스트에서 쓰이는 이름이라 view task가 이 새 factory로 가리킨다.
    - `createFakeAgentTabSource()`: wireframe 장면 전부를 낼 수 있는 fake. `desktop/dev-mock/agent.ts`가 쓴다.
    - `useAgentTabData(source, session)`: 읽은 값과 연결 상태를 돌려주는 hook

`AgentTabSource`가 가져야 할 것(이름은 contract의 것을 따르고, 화면 쪽 별칭만 이 task가 정한다):

| 구분 | 칸 |
|---|---|
| 읽기 | `agent()`(role: `lophn`·`project_manager`·`app_engineer`·`operator`, 이름, profile, place, 권한 요약 한 줄), `sessions()`, `thread(session)`, `body(message)`, `envelope(message)`(보낸 쪽 chip을 누르면 맡긴 글·근거 링크·보낸 session), `callState(call)`(call 블록을 누르면 그때의 상태), `model*`, `commands(session, query)`(전역 built-in에 `recap` 추가), `permissions(session)`(agent grant와 "이 session 동안" 허락), `recap(session)`(이력에 들어가지 않는 요약) |
| 쓰기 | `send({ session, id, key, text, delivery: "next_turn" \| "steer" })`, `sendQueuedNow(queued)`(= steer로 올림), `removeQueued(queued)`, `stop(turn)`, `answerQuestions`, `decidePermission(entry, choice, reason?)`(waiting의 결정과 같은 route), `retryTurn(turn)`, `openSession`, `renameSession`, `archiveSession`, `deleteSession`, `forkSession`, `compactSession`, `cancelCall(call)` |
| rewind | `rewindPoints(session)`, `rewindPreview(session, message)`(파일 목록, 앱별 write 목록 `app_writes`, 함께 되돌아갈 다른 변경, 되돌아가지 않는 external, 되돌릴 수 없는 write), `rewind(session, message, { files: boolean, apps })`(`files`가 참이면 contract의 `choice: "restore_all"`, 거짓이면 `"messages_only"`. 화면은 `summarize`를 내지 않는다) |

## 할 일

1. `agent-tab-source.ts`를 짠다. 위 표와 type을 만든다. 말을 바꾼다: `run` → `turn`, `correction` → `steer`, `assignment` → agent와 place, `context_engineer` → `project_manager`, `handoff` → call. 질문은 기한·추천·Skip이 없고 header·선택지 2~4개(label+description)·`multiSelect`·늘 붙는 Other뿐이다. 상태는 answered/unanswered와 outcome(`submitted`, `cancelled`, 사람 메시지로 끝남)이다. 확인 창 열기는 없다. rewind는 화면이 `files`와 `apps`를 고르고 source가 contract의 `choice`로 바꾼다. `undoEdit`·`redoRewind`는 없다(contract에 undo·redo route가 없다). 근거: `U2.1#1`, `U2.2#17`, S3·S4·S8.
2. `agent-tab-fake-source.ts`를 짠다. `testdata/fake-agent-source.ts`와 wireframe `agent-tab/data.ts`·`agents-data.ts`의 장면(Weekly report 이야기, 질문, 승인, call 열림·답·실패·취소, 보낸 쪽 chip 다섯, rewind의 앱 둘, 권한 보기, recap, 요청 오류)을 한 fake에 모은다. gallery의 각 장면이 이 fake를 `scene` 이름으로 골라 쓸 수 있게 한다(`createFakeAgentTabSource({ scene })`).
3. `agent-tab-data.ts`를 짠다. 3초 polling(`agent-view-data.ts`의 `POLL_MS`, `intervalTicks`)을 대신해 `useSessionEvents(session)`을 합친다. 처음과 다시 붙을 때만 `thread(session)`으로 snapshot을 읽고, 그 사이는 agent event로 줄을 이어 붙인다(`MessageReceived`는 `body`를 싣고, 응답 글은 `TurnEnded.messages`(msg id)로 `body(message)`를 읽는다. 진행 중 부분 응답은 event가 없다). 끊기면 마지막 내용과 확인 시각을 둔다. 근거: `U2.1#1`, S1 8장.
4. `delivery-state.ts`, `drafts.ts`, `bodies.ts`, `window-deps.tsx`는 옛 `agent-view.tsx`가 아직 쓰므로 호환되게 더하기만 한다. `Delivery = "next_turn" | "steer"`와 새 `Outgoing` 칸(`delivery`)을 더하고 옛 `SendMode`·`correction` 이름과 `Ticks`·`intervalTicks` 의존은 그대로 둔다(view task가 지운다). 결과를 모르는 전송은 다시 보내기 전에 접수 조회를 먼저 낸다는 규칙과 같은 id·key로 다시 보낸다는 규칙은 그대로 둔다. 시각 블록의 `SaveRecord`도 건드리지 않는다. 근거: `U2.2#4`.
5. `desktop/dev-mock/agent.ts`가 새 fake를 내놓게 고친다(`mockAgentViewSource`가 새 factory를 돌려준다). 옛 `AgentViewSourceFactory` 쪽 조립은 `screens-conversation-view`가 새 factory로 갈아탄다. 두 factory가 한동안 같이 있어도 된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "결과를 모르는 전송(unavailable·internal)은 못 보냄이 아니라 접수 확인 안 됨으로 두고, 접수 조회가 없다고 답한 뒤에만 다시 보내기를 내놓는다. 다시 보낼 때 같은 id·key를 쓴다" — `conversation/delivery-state_test.ts`(순수 함수, 오류 code 표 하나). 메시지가 두 번 접수되는 것을 막는 규칙이다.
- 남지 않음: 없음 (옛 `SendMode`·`correction`·`agent-source.ts`는 옛 `agent-view.tsx`가 아직 쓰므로 `screens-conversation-view`가 지운다)

## 보고

- 바꾼 file
- 등록할 것: `desktop/dev-mock/mod.ts`의 `agentViewSource` 조립(lead). 영역 `conversation`의 새 key.
- 안 쓰게 된 export: 옛 `agent-source.ts`의 `AgentViewSource`·`SendInput`·`RewindChoice`·`RewindBlock` 등, `agent-view-data.ts`의 `POLL_MS`·`intervalTicks`·`Ticks`(view task가 지운다)
- 정한 것: event를 줄로 접는 규칙(어느 event가 어느 `ThreadEntry`가 되는가), `queued`를 snapshot에서 읽는지 event로 접는지, `Delivery` 이름
- 계약 바꾸기 요청(wave 3): agent event나 thread snapshot에 모자란 칸이 있으면 여기 적는다
