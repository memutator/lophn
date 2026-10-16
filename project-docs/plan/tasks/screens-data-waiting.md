# screens-data-waiting

대기 목록을 짓는다. 위쪽 바 안의 pill, 그것을 펼친 panel, 요청 카드 다섯 종류(권한 요청, coding agent 물음, 질문, activation 허락, 물음인 reaction), 거절 이유 입력, 결정 직후 남는 줄이다. wireframe 코드(`compositions/waiting/waiting-list.tsx`)를 renderer로 옮겨 store와 결정 route에 잇는다. 옛 확인 창 대신 카드에서 바로 결정한다.

- 단위: screens-data (wave 3)
- 선행: screens-data-events (`useWaiting`, store, fake Gateway를 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/waiting/` (새로)
  - `packages/shell/renderer/desktop/dev-mock/requests.ts` (추가 소유, lead 승인 2026-10-16: `ownership.md`에서 screens-workspace 몫인 `desktop/` 아래의 이 file만 이 task가 가진다. 옛 `RequestSource` fake를 지우고 fake Gateway에 대기 항목을 채우는 모양으로 다시 쓴다)
  - `tools/wireframes/frames/compositions/waiting/waiting-list.tsx`, `waiting-data.ts`, `waiting.module.css`(대기 목록 쪽 규칙), `waiting-pages.tsx`
  - `packages/design/wording/catalog/data.ts`와 그 생성물 `catalog/data.placeholders.ts` (wording-split이 만든 영역 file. 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S1 8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S2 4장(grant와 기본값)·6장(request 두 길, 선택지, 결정 규칙)·8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S6 2장 5(coding agent의 권한 물음은 터미널 탭으로) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - spec: S7 6장(활성화 때 선언 비교) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory: `U3.1#5`, `U3.1#6`, `U3.1#7`, `U3.1#8`, `U1.1#4`, `U6.5#6`(대화 단위에서 넘어온 줄. 아래 정한 것 참고), `U6.1#1`(단추는 줄 오른쪽 끝)
  - 결정: `../README.md` 3장 #3(Gate 호출은 core 한 곳)
  - 계약 file(읽는다): `packages/protocol/approvals/`의 `requests.ts`(`TurnPermissionRequest`: `{id, session, turn, tool_call, intent, choices, fingerprint, created_at}`, `PendingApproval`: `{id, intent, choices, status, reject_reason, applied, ...}`, 상태 `pending | granted | rejected | cancelled`, 적용 결과 `applied | failed`, 거절 이유 `rejectReasonSchema`), `intent.ts`(`intent`: `kind`, `actor`, `target`, `effect`, `input`, `origin`), route `approvalsPending`·`approvalsDecide`·`approvalsDecideTurn`(`protocol/approvals`), `packages/protocol/events`의 `PermissionRequested`·`PermissionResolved`·`ApprovalRequested`
  - 본보기(화면): `tools/wireframes/frames/compositions/waiting/waiting-list.tsx`(627줄), `waiting-data.ts`(331줄), `waiting.module.css`(431줄), `waiting-pages.tsx`
- 계약:
  - 쓰는 것:
    - `useWaiting()`, `EventsProvider`, `createFakeEvents` (screens-data-events)
    - 결정 route: 보류 request(activation, reaction)는 `approvalsDecide`(`{request, choice: {kind: "allow"} | {kind: "reject", reason?}}`), turn 안 request는 `approvalsDecideTurn`(`{session, request, choice: {kind: "once" | "session" | "always" | "allow"} | {kind: "reject", reason?}}`, memory route). 질문 답은 contract-agent-tools가 고정한 질문 답 route. `CoreSource.call`로 부른다.
    - `useSessions()`로 session 제목과 agent 이름을 붙인다
    - `@lophn/design/components`의 `Avatar`, `Button`, `DiffMark`, `Field`, `IconButton`, `StatusMark`, `Textarea`, `VendorIcon`(ui-chrome이 `frames/vendors`에서 design으로 옮긴 것)
  - 내놓는 것:
    - `desktop/connection/waiting/waiting-layer.tsx`: `WaitingLayer({ onOpenSession(session), onAnswerInTerminal(session) })`. pill과 그 아래로 열리는 panel이다. 위쪽 바(ui-chrome `desktop/top-bar`)의 오른쪽 slot에 꽂는다. 다른 단위(project 창, 앱 공간, 런처)가 호스트 callback만 주어 마운트한다.
    - `useWaitingPanel(): { open: boolean; setOpen(open: boolean): void }`: toast의 [Review]가 panel을 열 때 쓴다.
    - `desktop/connection/waiting/model.ts`: `cardOf(entry: WaitingEntry): CardView`(제목, 한 줄 설명, 대상·입력·효과 줄, 늘어난 선언·손실 단계). 대화 안 승인 카드(screens-conversation-cards)도 같은 함수를 쓴다.
    - `desktop/connection/waiting/decide.ts`: `decideWaiting(core, entry, choice, reason?)`. 대화 쪽 core source도 같은 호출을 쓴다.
    - `desktop/connection/waiting/fake-source.ts`: `waiting-data.ts`의 `ALL_ITEMS`와 시나리오를 옮긴 fake 항목(gallery와 dev-mock이 쓴다).

## 할 일

1. `waiting-list.tsx`를 renderer로 옮긴다. 쪼개는 모양:
   - `desktop/connection/waiting/waiting-layer.tsx`: `WaitingPill`, `WaitingLayer`, 열림 상태
   - `waiting-panel.tsx`: `WaitingPanel`, 묶음 `GROUPS`(Permission requests / Questions / Approvals), `SettledList`
   - `cards/head.tsx`: `Head`(avatar 또는 vendor 아이콘, 제목, 한 줄 설명, 누가·어느 session·어느 앱 또는 project, 시각, 오른쪽 끝 펼침 토글)
   - `cards/permission-card.tsx`, `cards/coding-card.tsx`, `cards/question-card.tsx`, `cards/activation-card.tsx`, `cards/reaction-card.tsx`
   - `cards/decision.tsx`: `Decision`, `Reason`(거절 이유 입력. 비워도 되고 적으면 요청한 agent의 tool 결과로 간다. 요청한 agent가 없는 reaction 카드에는 이유 칸이 없다)
   - `waiting.module.css`: wireframe의 대기 목록 쪽 규칙을 옮긴다.
   근거: `U3.1#5`, `U6.5#6`(pill은 위쪽 바 안, 항목 세부는 기본으로 접힘, 단추는 오른쪽 끝), `U6.1#1`.
2. 카드 내용을 만드는 순수 함수 `waiting/model.ts`를 둔다.
   - 내용은 request의 `intent`(대상, 정규화한 입력, 효과)에서 program이 만든 문구로 보인다. 요청한 agent가 쓴 설명 칸은 없다.
   - 선택지는 request가 가진 `choices`를 그대로 그린다. 앱 api·MCP tool은 Allow once / Allow for this session / Always allow / Deny, 설정 고치기·activation·reaction은 Allow / Deny다. 화면은 선택지를 따로 판정하지 않는다(core가 `choicesFor(kind)`로 정했다).
   - activation 카드는 이전 release와의 비교에서 늘어난 선언(network host, secret, file, 다른 앱 app-api 쓰기)과 손실 단계(지우는 표나 칸, 좁히는 type)만 보인다. 첫 activation이면 선언 전부가 늘어난 것이다. 비교 값의 모양은 contract-releases-problems가 `intent.input`에 정한 것을 따른다.
   - reaction 카드는 어떤 domain event로 어떤 agent의 session을 열지 보인다.
   근거: `U3.1#6`, `U3.1#7`.
3. 결정을 route에 잇는다. `waiting/decide.ts`가 위 route를 부른다. 결정이 접수되면 항목은 `SettledList`에 "Allowed, applying"(접수, status `granted`) → "Allowed, applied"(`applied`) / "Denied"(`rejected`) / "Cancelled"(`cancelled`: 원래 일이 끝남)로 남고, 접수와 적용 성공을 구별한다. 항목을 목록에서 빼는 것은 `PermissionResolved`·`QuestionResolved`와 snapshot 읽기이지 단추 누름이 아니다. 질문 카드는 선택지를 눌러 답한다. 근거: `U3.1#8`, S2 6장.
4. coding agent의 물음(`kind: "coding"`) 카드는 lophn에서 답하지 않는다. [Answer in terminal]이 `onAnswerInTerminal(session)`을 부른다. 질문 카드의 [Open session]은 `onOpenSession(session)`이다. 호스트가 이 callback으로 터미널 탭에 focus를 옮기거나 session 탭을 연다.
5. 카드 문구를 wording key로 바꾼다. 영역 `waiting`(`waiting.label.*`, `waiting.title.*`, `waiting.button.*`, `waiting.notice.*`)의 key를 `catalog/data.ts`에 더하고 `generate.ts`를 돌려 `catalog/data.placeholders.ts`를 갱신한다. 옛 `common.label.decisions-waiting`을 쓰던 pill 문구는 `waiting.label.pill`("{count} waiting")로 대신한다. 핵심은 색이 아니라 글로 읽는 것이다.
6. gallery를 옮긴 component로 바꾼다.
   - `waiting-pages.tsx`의 `over()`는 `WaitingLayer`를 `ProjectApp`의 `titleExtra`로 꽂되 `EventsProvider`에 `fake-source.ts`를 끼워 그린다. 페이지 이름(`WaitingList`, `WaitingPermission`, `WaitingDenyReason`, `WaitingActivation`, `WaitingFirstActivation`, `WaitingReaction`, `WaitingSettled`, `WaitingToasts`)은 그대로 둔다.
   - `waiting-list.tsx`와 `waiting-data.ts`는 지운다(옮겼다).
   - `waiting-list.tsx`의 `WaitingLayer`가 gallery용으로 들고 있던 toast 쌓기(`toasts` prop, `ToastStack`, `WaitingToast`)는 renderer로 옮기지 않는다. `WaitingToasts` 페이지가 계속 그려지도록 그 부분만 `waiting-pages.tsx` 안 작은 wrapper로 옮기고 `waiting-toast.tsx`는 지우지 않는다. 그 페이지의 toast 그림은 `screens-data-toast`가 고친다.
7. `desktop/dev-mock/requests.ts`를 다시 쓴다. `mockCore()`는 남기고(provider 읽기 답), `mockRequests()`와 `RequestSource` import는 지운다. 대신 fake Gateway에 `fake-source.ts`의 항목을 채워 `DevMock.events`로 내놓는다. `dev-mock/mod.ts`의 `DevMock` 필드와 조립은 lead가 고친다.
8. 옛 3초 polling의 흔적을 이 폴더에 두지 않는다. `desktop/notification-chip/space-decisions.tsx`(옛 pill. `useRequestOverview`가 polling한다)는 이 task가 지우지 않는다. 부르는 곳(project 창, 앱 공간, 런처)이 `WaitingLayer`로 갈아탄 뒤 cleanup이 지운다. 근거: `U1.1#4`.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면과 호출. 선택지는 core가 준다)
- 남지 않음: `grep -rn "useRequestOverview\|things-to-confirm" packages/shell/renderer/desktop/connection`이 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-waiting-list`, `new-waiting-permission`, `new-waiting-deny-reason`, `new-waiting-activation`, `new-waiting-first-activation`, `new-waiting-reaction`, `new-waiting-settled`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: gallery `pages.ts`는 바뀌지 않는다(ScreenId 유지). 호스트 마운트(project 창 `workspace.tsx`는 screens-project-reactions, 앱 공간은 screens-app-space-frame, 런처는 screens-workspace-screens)는 각 단위 brief가 한다. `catalog/data.ts`의 새 key와 지운 key.
- 안 쓰게 된 export: `common.label.decisions-waiting`, `desktop/notification-chip/space-decisions.tsx`의 `WaitingPill`·`SpaceDecisions`·`useRequestOverview`
- 정한 것: `U6.5#6`은 대화 단위(screens-conversation) 줄이었으나 pill과 panel이 이 task의 것이라 여기서 맡았다. 결정 직후 남는 줄(`SettledList`)을 store에 두는지 컴포넌트 state로 두는지. 질문 카드가 읽을 질문 내용 route.
- 계약 바꾸기 요청(wave 3): 결정 결과 상태(접수·적용·거절·cancelled)를 화면이 받을 event나 반환값이 계약에 없으면 여기 적는다
