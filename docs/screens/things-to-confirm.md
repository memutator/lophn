---
type: screen
concerns: [lophn-agent/questions, platform/approvals, platform/notifications]
---
# things-to-confirm

사람이 기다리는 결정과 지난 결과를 한 자리에서 본다.

lophn 공간의 형제 화면이며(shell/desktop#R28), 창 오른쪽 아래 notification chip을 누르면 여기로 온다(platform/notifications#R1, shell/desktop#R10). **Waiting**과 **Past** 두 탭으로 나눈다(shell/desktop#R9).

## 보이는 것

### Waiting

1. 종류별 개수 먼저: "N decisions waiting"(질문), "N approvals needed"(승인). 기한이 있는 항목이 있으면 먼저 온다(shell/desktop#R6).
2. 각 질문 행: 질문 문장 한 줄 + 추천 선택지 하나(이유는 짧게) + 기한이 있으면 남은 시간. 누르면 그 자리에서 펼쳐 선택지 설명·자유 입력·Confirm을 보인다(lophn-agent/questions#R3, R4).
3. 각 approval 행: 무엇을 왜 허락받는지 한 문장(대상·효과). 누르면 **confirmation-window**가 뜬다(platform/approvals#R1, R3). 이 화면에서 승인·거절 버튼을 직접 누르지 않는다.
4. 세션이 없어도 뜬 질문·approval도 똑같이 여기서 보고 답한다(lophn-agent/questions#R2).

### Past

5. 최신순으로: 질문 답한 결과, approval 결정 결과, 그리고 운영 보고의 열림·재발·닫힘, ticket 확인 완료·검사 실패, 반복 실패로 멈춘 일, watch 변화, release 적용 실패(platform/notifications#R1)만 올라온다. 각 줄은 무엇이 바뀌었는지와 그 일로 이어지는 링크다(platform/notifications#R3).
6. 아직 안 읽은 줄은 표시가 있고, 답 없이 끝난 질문·approval은 "No answer"로 구별해서 보인다(lophn-agent/questions#R8, platform/approvals#R15).
7. 역할·기간 filter(shell/desktop#R9).

## 숨긴 것

- 질문 한 줄 아래 "View details"를 펼치면 역할·관련 일·질문의 자세한 이유·답 기다림 여부가 나온다(lophn-agent/questions#R4).
- 같은 사실의 중복 notification 제거, ledger 쓰기, run·assignment·handoff 식별은 화면에 전혀 안 나온다(platform/notifications#R2, R4). "읽음"은 그 자체로 결정이 아니다(platform/notifications#R6).
- 답을 Confirm한 뒤 실제로 적용되는 안쪽 동작(lophn-agent/questions#R13)과, approval 허락 뒤 실제 적용 검사(platform/approvals#R11)는 과정 없이 결과만 "Applying…" → 성공/실패로 보인다(G3).

## 행동

- **주 행동 없음** — 목록 화면이라 항목마다 자기 행동(Answer·Review·View details)을 가진다.
- Waiting의 질문: 선택지 클릭만으로는 아무 일도 안 나고, Confirm을 눌러야 답이 확정된다(lophn-agent/questions#R4, R6).
- Waiting의 approval: Review를 누르면 confirmation-window로 간다. 여기서 결정이 나지 않는다(platform/approvals#R3).
- Past: Mark as read, 열람(원래 문서·Issue·세션으로 이동).

## 상태

- **빈 Waiting**: "Nothing to confirm" 한 문장.
- **빈 Past**: "No past results yet".
- **불러오는 중 / 오류**: 공통 패턴.
- **연결 끊김**: 마지막으로 확인한 목록과 확인 시각을 유지한다(shell/desktop#R7).
- **Applying…**: 답·허락을 보낸 뒤 실제 적용 전. 실패하면 Past에 "Couldn't apply this decision"으로 남고 결정 자체는 취소되지 않는다(platform/approvals#R9).
- **전제가 바뀜**: 질문·approval 대상이 그사이 바뀌었으면 선택지 대신 바뀐 이유와 "다시 확인" 안내를 보인다(lophn-agent/questions#R14, platform/approvals#R11).
- **기한 지남 / 취소됨**: Waiting에서 사라지고 Past에 "No answer (expired/canceled)"로 남는다(lophn-agent/questions#R7, R8, platform/approvals#R12, R13).

## 문구

| key | en |
|---|---|
| things-to-confirm.title | Things to confirm |
| things-to-confirm.tabs.waiting | Waiting |
| things-to-confirm.tabs.past | Past |
| things-to-confirm.waiting.questions.count | {count, plural, one {# decision waiting} other {# decisions waiting}} |
| things-to-confirm.waiting.approvals.count | {count, plural, one {# approval needed} other {# approvals needed}} |
| things-to-confirm.item.answer | Answer |
| things-to-confirm.item.review | Review |
| things-to-confirm.item.view_details | View details |
| things-to-confirm.item.recommended | Recommended: {choice} |
| things-to-confirm.item.deadline | Closes {time} |
| things-to-confirm.item.confirm | Confirm |
| things-to-confirm.item.applying | Applying… |
| things-to-confirm.item.apply_failed | Couldn't apply this decision |
| things-to-confirm.item.no_answer | No answer ({reason}) |
| things-to-confirm.item.changed | This changed since you opened it |
| things-to-confirm.filters.role | Role |
| things-to-confirm.filters.period | Time range |
| things-to-confirm.mark_read | Mark as read |
| things-to-confirm.empty.waiting.title | Nothing to confirm |
| things-to-confirm.empty.past.title | No past results yet |
| things-to-confirm.stale.label | Last checked {time} |
| things-to-confirm.error.title | Couldn't load things to confirm |

## 크기와 접근성

- Waiting 행과 Past 행은 shell/design-system#R30의 표 치수를 따른다.
- 키보드만으로 탭 전환·행 펼침·선택지 이동·Confirm까지 가능하고(shell/design-system#R2), Confirm 전에는 Enter 한 번으로 결정이 나지 않는다(lophn-agent/questions#R6).
- 질문 확정·approval 상태 변화는 screen reader에 polite로 전달하고, 적용 실패는 assertive로 전달한다.
- 좁은 창에서는 Waiting/Past 각 한 화면씩 보이며 filter는 접힌 패널로 옮긴다(shell/design-system#R24).
