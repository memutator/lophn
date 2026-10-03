---
type: flow
concerns: [platform/notifications, platform/approvals, lophn-agent/questions, lophn-agent/conversation, coding-agent/tickets, problems/grouping, shell/desktop, shell/workspace, shell/wording]
---
# 놓친 결과와 할 일을 다시 찾는다

사람이 일하는 동안 notification을 받거나, 한동안 닫아 둔 lophn으로 돌아와 놓친 결과와 필요한 결정을 찾을 때 시작한다. notification을 보는 일은 결정을 내리거나 끝난 일을 다시 실행하는 일이 아니다.

지키는 약속: platform#I9, platform#I5, shell#I1, shell#I8.

## 흐름

1. machine이 정해진 계기 표에 있는 문제의 변화·필요한 결정·ticket 검사 결과 등에서만 notification을 만든다. 같은 사실의 재전달은 새 notification을 만들지 않고, 일반 문서 저장이나 run 종료만으로 사람을 부르지 않는다. 사람에게는 보이지 않는다. (platform/notifications#R1, platform/notifications#R2, platform/notifications#R4)
2. 사람은 현재 탭과 입력 focus를 유지한 채 notification을 받는다. OS notification은 사람이 켠 경우에만 최소 제목과 대상 열기 경로를 제공하며, 내용을 보기 전 다른 문서나 탭으로 강제로 이동시키지 않는다. (shell/desktop#R10, platform/notifications#R9)
3. things-to-confirm 화면 사람이 notification의 보기 경로를 열거나, 돌아온 뒤 확인할 것을 연다. 지금 기다리는 결정과 이미 생긴 지난 결과를 구별하고, 필요한 사람 행동과 당시 발생 시각을 확인한다. (shell/desktop#R9, platform/notifications#R3)
4. lophn이 원래 사실에서 현재 결정의 유효성과 실제 결과를 확인한다. 이미 답하거나 끝난 question·approval request를 새 결정으로 되살리지 않고, ticket 완료 보고와 실제 검사 결과·문제 닫힘을 섞지 않는다. 사람에게는 보이지 않는다. (lophn-agent/questions#R9, platform/approvals#R13, coding-agent/tickets#R18, coding-agent/tickets#R21)
5. things-to-confirm 화면 사람은 지금 필요한 선택이나 다음 행동을 먼저 본다. 근거가 필요하면 원래 문서·문제·세션·ticket의 링크를 따라갈 수 있고, 결과가 없거나 확인하지 못한 이유도 결과와 구별해 읽는다. 복잡한 상세와 안쪽 상태 이름은 기본 안내에 내보내지 않는다. (platform/notifications#R3, shell/desktop#R9, problems/grouping#R11, problems/grouping#R12, shell/wording#R2)
6. things-to-confirm 화면 사람은 본 notification을 명시적으로 읽음 처리하거나 읽지 않음으로 남긴다. 읽음은 재시작 뒤에도 유지되지만, question 답·approval·문제 닫힘·ticket 확인을 대신하지 않는다. (platform/notifications#R5, platform/notifications#R6, platform/approvals#R4)

## 다른 갈래

- OS 전달이 실패하거나 사람이 창을 닫아도 notification은 남는다. things-to-confirm 화면 다음 조회에서 같은 사실과 안전한 전달 실패 이유를 볼 수 있다. 전달 실패를 별도 반복 업무로 만들거나 model로 다시 보내지 않는다. (platform/notifications#R8, platform/notifications#R10)
- 오래된 notification을 열었을 때 결정이 이미 끝났으면 당시 사실과 현재 결과만 확인한다. 끝난 세션을 다시 활성화하거나 외부 효과를 다시 실행하지 않는다. (platform/notifications#R7, lophn-agent/conversation#R11, lophn-agent/questions#R9, platform/approvals#R7)
- 실제 답이나 허락이 필요하면 해당 원래 요청의 결정 경로로 이동한다. notification 클릭과 결과 열기만으로 결정하지 않는다. 이 flow는 결정 제출 전까지다. (platform/notifications#R6, lophn-agent/questions#R6, platform/approvals#R3)
- 연결이 끊기면 마지막 화면과 최신 상태를 확인하지 못한 시각을 유지한다. 연결이 돌아오면 현재 기록으로 맞추고 놓친 진행 notification을 연속 재생하지 않는다. (shell/desktop#R7)
- 놓친 항목이 많아도 원래 사실을 임의의 종류나 고정 개수로 버리지 않는다. 지난 결과 목록에서 계속 찾아 읽고 각 항목의 개별 근거에 닿는다. (platform/notifications#R11, shell/desktop#R9)

## 끝

사람이 지금 자신이 결정해야 할 일과 이미 끝난 결과를 구별해 찾았고, 필요하면 원래 근거로 이어 갈 수 있다. 알림을 읽었다는 이유로 업무 상태나 결정은 바뀌지 않았다. (platform/notifications#R3, platform/notifications#R6)
