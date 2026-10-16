# screens-conversation-cards

composer 위에 붙는 카드와 대화 안 panel을 새로 옮긴다. 질문 카드(한 번에 질문 하나, ‹ 1 of N ›), 답한 뒤 접힌 요약, 승인 카드와 결정 뒤에 남는 줄, `/permissions`가 여는 권한 보기, `/recap`의 결과 카드다. 확인 창은 없다. 카드에서 바로 결정한다. wireframe 코드(`agent-tab/cards.tsx`, `permissions-view.tsx`, `recap.tsx`)를 renderer `conversation/`으로 옮긴다.

- 단위: screens-conversation (wave 3)
- 선행: screens-conversation-source (`AskedQuestion`, `ApprovalCardRequest`, `GrantRow`, `AgentTabSource.answerQuestions`·`decidePermission`·`permissions`·`recap`), screens-data-waiting (`desktop/connection/waiting/model.ts`의 `cardOf`와 `decide.ts`를 쓴다. 대기 목록 카드와 같은 내용이다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/question-card/`
  - `packages/shell/renderer/conversation/approval-card/`
  - `packages/shell/renderer/conversation/permissions-view/` (새로)
  - `packages/shell/renderer/conversation/recap/` (새로)
  - `packages/design/wording/catalog/conversation.ts`와 생성물 `catalog/conversation.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S4 3장(질문 tool: 질문마다 header·선택지 2~4개·`multiSelect`·늘 붙는 Other, 기한과 고정 action 없음), 7장(commands) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S2 6장(선택지는 대상 종류가 정한다, 거절 이유, 접수와 적용을 구별, cancelled는 거절과 다르다), 4장(권한 보기에 보일 grant) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S1 7~8장(`QuestionAsked`·`QuestionResolved`, 질문은 대기 목록과 같은 목록에 있다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `U1.2#1`, `U2.2#1`, `U2.2#2`, `U2.2#3`, `U3.2#7`(`/recap`의 결과 카드), `U3.2#8`, `U6.5#2`, `U6.1#1`
  - 결정: `../README.md` 3장 #3
  - 지금 코드(고칠 곳): `conversation/question-card/{model.ts, question-card.tsx, answered-summary.tsx}`, `conversation/approval-card/{approval-card.tsx, model.ts}`
  - 본보기(화면): `tools/wireframes/frames/compositions/agent-tab/cards.tsx`(439줄: `QuestionCard` 33줄~, `QuestionSummary` 219줄~, `ApprovalCard` 288줄~, `ApprovalResult` 430줄~), `permissions-view.tsx`(73줄), `recap.tsx`(22줄), `agent-tab.module.css`
- 계약:
  - 쓰는 것:
    - `AgentTabSource.answerQuestions`, `decidePermission(entry, choice, reason?)`, `permissions(session)`, `recap(session)` (screens-conversation-source)
    - `cardOf(entry)`, `decideWaiting(...)` (screens-data-waiting의 `waiting/model.ts`, `decide.ts`): 카드 내용은 program이 intent에서 만든 것이고 대기 목록 카드와 같은 함수를 쓴다. 선택지는 request가 가진 `choices`(contract-approvals의 `TurnPermissionRequest.choices`)를 그대로 그린다.
    - `useWaiting()` (screens-data-events): 이 session의 대기 항목(권한 요청, 질문)을 걸러 composer 위 카드로 보인다.
  - 내놓는 것(view task가 조립한다):
    - `question-card/question-card.tsx`: `QuestionCard`, `QuestionSummary`
    - `approval-card/approval-card.tsx`: `ApprovalCard`, `ApprovalResult`
    - `permissions-view/permissions-view.tsx`: `PermissionsView({ agent, onClose, popover? })`
    - `recap/recap-card.tsx`: `RecapCard({ onDismiss })`

## 할 일

0. 공통 규칙. 옛 `agent-view.tsx`·`agent-thread.tsx`(view task가 바꾼다)가 이 폴더의 옛 export를 아직 쓴다. 옛 export의 이름이나 props가 깨지면 새 file을 옆에 만들고 옛 file은 그대로 둔다(view task가 지운다). 어느 경우에도 main의 `deno task check`가 통과해야 한다.
1. 질문 카드를 wireframe 모양으로 바꾼다.
   - 질문 하나씩 보이고 ‹ 1 of N ›로 넘긴다. 질문마다 header, 선택지(label과 description) 2~4개, `multiSelect`면 체크, 화면이 늘 붙이는 Other(글을 적는다)가 있다.
   - 지운다: 기한(`expires_at`), 추천 칸(`recommendation`), Details, 고정 action 적용 상태(applying·applied·apply_failed), Skip(`onSkip`). 근거: `U1.2#1`, `U6.5#2`.
   - 답한 뒤 `QuestionSummary`로 접힌다. outcome은 `submitted`(Answered N questions, 펼치면 header별 답), `cancelled`, 사람 메시지로 끝남(Ended by your message. 고른 답 없음을 header별로 보인다). 기다리는 중 사람이 메시지를 보내면 카드가 "사람 메시지로 끝남"으로 접힌다. 근거: `U2.2#3`.
2. 승인 카드를 확인 창 없이 바꾼다.
   - [Allow once] [Allow for this session] [Always allow] [Deny]는 app-api·MCP tool에만, 설정 고치기·activation·reaction은 [Allow] [Deny]다(request의 `choices`가 정한다. `allowSession` 플래그는 없앤다). [Deny]를 누르면 이유 칸이 열리고 비워도 된다. 카드를 닫거나 가만히 두는 것은 결정이 아니다. `openApproval`이 확인 창을 미리 고른 채 열던 흐름(`onOpenConfirmation`)은 없앤다. 근거: `U2.2#1`, S2 6장.
   - 내용은 대상, 정규화한 입력, 효과를 program이 만든 문구로 보인다(요청한 agent가 쓴 설명은 보이지 않는다).
   - `ApprovalResult`: 결정 뒤 대화에 남는 접힌 줄. 접수("Allowed, applying")와 적용 성공("Allowed, applied")을 나누고, 거절과 cancelled(원래 일이 끝남)를 나눈다. expired는 없다. 근거: `U2.2#2`.
3. 권한 보기 `PermissionsView`를 만든다. 그 agent의 agent grant(대상, 효과, 묻는지)와 이 session에서 "이 session 동안"으로 허락한 대상을 보인다. 고치기는 Agents 화면에서 한다([Edit in Agents] 단추는 host callback `openPermissions`). popover 안(입력칸 아래 권한 요약)과 대화 화면 안 panel(`/permissions`) 두 모양을 같은 component가 그린다. 근거: `U3.2#8`.
4. `RecapCard`를 만든다. session을 짧게 요약한 줄들을 대화 끝에 보이고 닫을 수 있다. 요약은 이력에 들어가지 않는다. 근거: `U3.2#7`.
5. 문구를 wording key로 바꾼다(영역 `conversation`: `conversation.title.question-*`, `conversation.button.allow-*`, `conversation.label.approval-*` 등). 승인·질문에 쓰던 옛 key 가운데 쓰는 곳이 없어진 것은 지운다. key는 `catalog/conversation.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/conversation.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
6. wireframe의 `agent-tab/cards.tsx`, `permissions-view.tsx`, `recap.tsx`와 `agent-tab.module.css` 규칙은 이 task가 고치지 않는다(gallery는 `screens-conversation-view`가 한꺼번에 바꾼다). 이 task의 component가 쓰는 CSS 규칙은 renderer module.css로 복사한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (선택지는 core가 준다)
- 남지 않음: 새로 만들거나 고친 file에 옛 이름이 없다. 옛 file이 옆에 남으면 그 목록을 보고에 적는다(`screens-conversation-view`가 지운다). 확인은 `grep -rn "allowSession\|onSkip\|expires_at\|recommendation\|onOpenConfirmation" packages/shell/renderer/conversation/question-card packages/shell/renderer/conversation/approval-card`에서 새 file만 본다.
- (화면) gallery는 `screens-conversation-view`가 한꺼번에 바꾼다. 이 task의 component는 그때 `new-agent-question`, `new-agent-question-answered`, `new-agent-question-ended`, `new-agent-approval`, `new-agent-approval-deny`, `new-agent-approval-settings`, `new-agent-approval-states`, `new-agent-permissions`, `new-agent-recap`로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `conversation`의 새 key와 지운 key
- 안 쓰게 된 export: 옛 `ApprovalChoice`·`ApprovalCardRequest`(옛 모양), `question-card/model.ts`의 `expires_at`·`recommendation` 관련
- 정한 것: composer 위에 한 번에 카드를 몇 개 올리는지(질문 하나와 승인 하나가 같이 있을 때 순서), Other 입력의 길이 한도
- 계약 바꾸기 요청(wave 3): 질문 묶음 한 번에 N개를 한 번에 제출하는 route가 없으면 여기 적는다
