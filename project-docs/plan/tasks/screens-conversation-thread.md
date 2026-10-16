# screens-conversation-thread

대화 줄을 새 모양으로 옮긴다. agent의 말 한 덩어리와 내 말(오른쪽 bubble), 보낸 쪽 chip과 그 panel, 보낸 session의 call 블록과 취소, 답과 실패 메시지 이어 붙이기, steer 표시, tool 줄·편집 카드·진행 chip, 결과 링크(파일 경로), 요청 오류 메시지와 [Retry]다. wireframe 코드를 renderer의 `conversation/`으로 옮기고 `AgentTabSource` 값으로 그린다. 조립(`agent-view.tsx`, `agent-thread.tsx`)은 `screens-conversation-view`가 한다.

- 단위: screens-conversation (wave 3)
- 선행: screens-conversation-source (`AgentTabSource`, `ThreadEntry`, `Envelope`, `CallView`, fake source를 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/message-list/`
  - `packages/shell/renderer/conversation/activity/`
  - `packages/shell/renderer/conversation/result-links.tsx`, `result-links.module.css`
  - `packages/shell/renderer/conversation/thread/` (새로: 보낸 쪽 chip, call 블록, 오류 메시지)
  - `packages/design/wording/catalog/conversation.ts`와 생성물 `catalog/conversation.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S3 3~5장(call 봉투, 받는 곳, 답 방식과 상태, 닫힘) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S1 8장(call은 대화 안에서 보인다, 따로 구독하지 않는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S4 6장(Router 입력마다 들어가는 꼴, 입력 tag) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `U2.2#6`, `U2.2#8`, `U2.2#15`, `U3.2#1`, `U3.2#2`, `U3.2#3`, `U3.2#4`, `U3.2#5`, `U6.5#5`(provider 요청 오류는 대화 안 메시지와 [Retry]), `U6.1#1`
  - 결정: `../README.md` 3장 #18·#23(steer), #57(`project_manager`)
  - 지금 코드(옮길 곳): `conversation/message-list/{message-body, turns, thread-scroll}.tsx`, `activity/{tool-line, edit-card, progress-chip, view-detail-select, worked-for}.tsx`, `result-links.tsx`
  - 본보기(화면): `tools/wireframes/frames/compositions/agent-chat.tsx`(`AgentTurn` 423줄~, `UserMessage` 456줄~, `ToolRow`, `EditCard`, `WorkedFor`, `ProgressChip`), `compositions/agent-tab/sender.tsx`(125줄), `call-block.tsx`(111줄), `error-message.tsx`(18줄), `agent-tab.module.css`(보낸 쪽 chip·call 블록·steer 표시 규칙)
- 계약:
  - 쓰는 것:
    - `conversation/agent-tab-source.ts`의 `ThreadEntry`, `Envelope`, `CallView`, `AgentTabSource.envelope`·`callState`·`cancelCall`·`retryTurn` (screens-conversation-source)
    - `@lophn/design/components`의 `Avatar`, `StatusMark`, `Button`, `Card`, `Popover`, `Icon`, `VendorIcon`(harness 아이콘)
  - 내놓는 것: component들을 그리기만 한다. 조립은 view task가 한다.
    - `thread/sender-chip.tsx`: `SenderChip`, `SenderPanel`
    - `thread/call-block.tsx`: `CallBlock`(받는 곳, 맡긴 글 한 줄, 답 방식, 눌러서 읽은 상태, 끝나지 않은 call의 머리 줄 오른쪽 [Cancel])
    - `thread/provider-error.tsx`: `ProviderError`(오류 내용과 [Retry])
    - `message-list/`의 agent turn·user message(steer 표시, hover [Rewind to here] 단추는 sessions task의 rewind panel을 연다)
    - 이름과 props 모양은 wireframe의 `AgentTurn`, `Said`, `Quiet`, `UserMessage`, `ToolRow`, `CallBlock`과 같게 둔다. gallery의 다른 단위 page(`contexts/pm-session.tsx`, `app-space/side-pane.tsx`)가 이 이름들을 import하고, view task가 그 gallery file을 얇은 adapter로 이 component에 잇는다.

## 할 일

0. 공통 규칙. 옛 `agent-view.tsx`·`agent-thread.tsx`(view task가 바꾼다)가 이 폴더의 옛 export를 아직 쓴다. 옛 export의 이름이나 props가 깨지면 새 file을 옆에 만들고 옛 file은 그대로 둔다(view task가 지운다). 어느 경우에도 main의 `deno task check`가 통과해야 한다.
1. `message-list/`와 `activity/`를 wireframe 모양으로 고친다.
   - agent 말: 왼쪽 열에 avatar·이름·시각이 한 번, 이어지는 말과 tool 줄·카드는 이름 없이 그 아래에 이어진다. 카드는 열의 폭을 다 쓴다.
   - 내 말: 오른쪽 bubble, 이름·avatar 없음. hover하면 [Rewind to here] 단추가 보인다. 도는 turn에 steer로 들어간 메시지는 rewind 시점이 아니라서 단추 대신 steer 표시("Steer · went into the running turn")가 붙는다. `Change` 표시를 이 표시로 바꾼다. 근거: `U2.2#6`.
   - 보낸 쪽 구별: actor가 user·machine·agent 셋이던 것을 다른 session·program·coding agent가 보낸 입력도 나눠 그린다. 근거: `U2.2#8`.
   - tool 줄(접히는 줄), 편집 카드, "Worked for …", 진행 chip(Tasks popover), 보기 상세(Messages·Compact·Everything)를 wireframe 모양으로 옮긴다. 편집 카드의 [Undo]와 "Undid the edit" 상태는 옮기지 않는다(새 계약에 `undo` route가 없다. 보고 걱정에 적는다).
2. `thread/sender-chip.tsx`를 만든다. 사람이 직접 쓰지 않은 입력(다른 agent의 call, program의 reaction, coding agent 메시지, 배달 알림)에 "From …" chip을 붙인다. coding agent면 harness vendor 아이콘을 앞에 단다. 누르면 chip 아래로 panel이 열려 맡긴 글, 근거 링크(ticket·problem·파일 경로), 보낸 session 링크를 보인다(session 링크는 눌러 그 session 탭을 연다. host callback으로 받는다). panel은 `AgentTabSource.envelope(message)`로 읽는다. 근거: `U3.2#1`, `U3.2#2`.
3. `thread/call-block.tsx`를 만든다. 보낸 session의 call은 일반 tool 한 줄 대신 이 블록이다. 누르면 그때의 상태(진행 중·끝남·실패와 이유·취소됨)를 `callState`로 읽어 보이고, 상태가 바뀌어도 따로 알리지 않는다. 화면에 `call`, `accepted` 같은 안쪽 낱말을 그대로 내지 않는다(wording 규칙). 끝나지 않은 call은 머리 줄 오른쪽 [Cancel]로 사람이 취소한다. 답과 실패는 이 블록 안이 아니라 이어지는 새 메시지(받은 메시지 chip)로 보인다: 보낸 session에서 답과 실패가 그 call에 이어지게 `reply_to`로 묶는다. 근거: `U3.2#3`, `U3.2#4`, `U3.2#5`.
4. `thread/provider-error.tsx`를 만든다. provider가 요청을 거절하는 등 server 요청이 실패하면 어떤 오류인지와 [Retry]가 대화 안 메시지로 남는다. 근거: `U6.5#5`.
5. `result-links.tsx`를 파일 경로 링크로 바꾼다. `(document, version)`으로 열던 것을 경로로 연다. host callback은 새 칸 `openFile(path: string)`이다(`AgentViewHost`에 더하는 것은 view task다. 옛 `openResult`는 그대로 두고, project 창의 `workspace/kinds/host.ts`가 `openFile`을 채우는 일은 screens-project-window가 한다). context 링크의 `ContextLinks`는 남긴다. 근거: `U2.2#15`.
6. 문구를 wording key로 바꾼다(영역 `conversation`: `conversation.label.sender-*`, `conversation.title.call-*`, `conversation.label.steer`, `conversation.notice.request-failed` 등). `conversation.label.send-correction`·`send-request`, `conversation.title.dock`은 쓰는 곳이 없어지면 지운다. key는 `catalog/conversation.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/conversation.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
7. wireframe의 `agent-tab.module.css`·`agents.module.css`·`compose.module.css`는 여러 단위가 같이 쓰므로 고치지 않는다. 이 task의 component가 쓰는 규칙은 renderer의 module.css(`thread/thread.module.css`, 기존 `message-list/*.module.css`)로 복사한다. 쓰지 않게 된 wireframe 쪽 규칙은 cleanup이 지운다.
8. gallery(`tools/wireframes`)는 이 task가 고치지 않는다. wireframe의 `agent-tab/sender.tsx`, `call-block.tsx`, `error-message.tsx`, `agent-chat.tsx`의 해당 부품은 `screens-conversation-view`가 gallery를 한꺼번에 renderer component로 갈아탈 때 지운다. 조립 전에 화면을 보고 싶으면 `createFakeAgentTabSource`로 component를 개발용 화면에 잠시 그려 보는 것은 되지만 file로 남기지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 모양)
- 남지 않음: 새로 만들거나 고친 file에 옛 이름이 없다. 옛 file이 옆에 남으면 그 목록을 보고에 적는다(`screens-conversation-view`가 지운다). 확인은 `grep -rn "send-correction\|send-request\|\"correction\"" packages/shell/renderer/conversation/message-list packages/shell/renderer/conversation/activity`에서 새 file만 본다.
- (화면) gallery는 `screens-conversation-view`가 한꺼번에 바꾼다(같은 wireframe file `agent-chat.tsx`·`conversation.tsx`·`scenes.tsx`를 여러 task가 고치지 않게). 이 task의 component는 그때 `new-agent-conversation`, `new-agent-sender-chips`, `new-agent-call-open`, `new-agent-call-replies`, `new-agent-request-error`로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `conversation`의 새 key와 지운 key(생성물 `*.placeholders.ts`는 이 task가 `generate.ts`로 갱신한다)
- 안 쓰게 된 export: 옛 `agent-thread.tsx`가 아직 쓰는 `message-list/` export 중 모양이 바뀐 것(view task가 부르는 쪽을 바꾸고 지운다). `activity/tool-line.tsx`의 일반 call 줄.
- 정한 것: 보낸 쪽 chip과 call 블록이 `ThreadEntry`의 어느 칸에서 오는지, `openFile`의 모양
- 걱정: wireframe의 편집 카드에는 [Undo]가 있으나 contract-calls-places-places가 `undo`·`redo`를 옮기지 않았다. 둘 중 하나가 바뀌어야 한다(제품 동작이면 lead가 사람에게).
- 계약 바꾸기 요청(wave 3): call 읽기 route나 `reply_to` 칸이 계약에 없으면 여기 적는다
