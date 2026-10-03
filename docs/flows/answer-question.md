---
type: flow
concerns: [lophn-agent/questions, lophn-agent/conversation, lophn-agent/harness/waiting-and-recovery, platform/identity, platform/ledger, platform/notifications, platform/approvals, shell/desktop, shell/confirmation-window]
screens: [conversation, things-to-confirm, confirmation-window]
---
# 필요한 선택에만 답하고 원하면 미룬다

agent가 자료로 확인할 수 없는 의도·취향·결정을 정해야 할 때 시작한다. 사람은 필요한 결정 하나에만 답하고, 답을 정하지 못하면 미루거나 취소한다.

지키는 약속: lophn-agent#I7, lophn-agent#I4, platform#I5, lophn-agent/harness#I2.

## 흐름

1. agent는 기존 요청·답·읽을 수 있는 자료와 machine 확인으로 정할 수 없는 결정 하나만 질문한다. 이미 받은 답을 다시 묻거나 독립된 결정을 한 질문으로 묶지 않는다. 질문 준비는 사람에게는 보이지 않는다. (lophn-agent/questions#R1, lophn-agent/questions#R2)
2. **[screen: conversation]** 사람은 질문·설명 있는 선택지·추천 이유와 선택 뒤 생길 동작을 읽는다. 판단에 필요한 무응답 결과와 지정 기한도 확인하고, 선택하거나 자유 입력·미루기·취소를 고른다. 선택 클릭만으로 답이 확정되거나 동작이 적용되지 않는다. (lophn-agent/questions#R3, lophn-agent/questions#R4, lophn-agent/questions#R6)
3. **[screen: confirmation-window]** 선택지에 적용 동작이 붙었다면 사람은 고정된 대상·내용을 다시 확인하고 해당 질문의 답을 명시적으로 확정한다. 동작 없는 질문도 해당 질문을 지정해 답해야 하며 일반 세션의 긍정이나 빈 답은 답으로 쓰지 않는다. (shell/confirmation-window#R5, shell/confirmation-window#R6, shell/confirmation-window#R9, lophn-agent/questions#R6, lophn-agent/questions#R13)
4. machine은 사람이 확정한 되돌릴 수 있는 안쪽 동작의 대상·입력·비교 기준과 일회 적용 근거를 확인하고 그 내용만 사람의 결정으로 한 번 적용한다. agent에게 권한을 추가하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/questions#R13, platform/identity#R14, platform/ledger#R12, platform/ledger#R13)
5. **[screen: conversation]** 사람은 답이 접수된 사실과 동작이 실제 적용된 결과를 따로 확인한다. 전제가 바뀌었다면 답은 남지만 동작은 적용되지 않으며 달라진 대상과 이유를 확인한다. 자유 답만으로 변경하지 않고 필요한 경우 정확한 내용을 고정한 새 선택지나 직접 요청으로 다시 확인한다. (lophn-agent/questions#R10, lophn-agent/questions#R14, lophn-agent/questions#R15, lophn-agent/harness/waiting-and-recovery#R5)
6. 답을 기다리는 일은 실제 답이 오면 같은 run에서 이어지고, 미루기·만료·취소면 답 없음의 이유를 남겨 멈춘다. 기한 없는 무응답은 계속 기다릴 뿐 기본 선택이나 승인으로 바꾸지 않는다. 이 처리 자체는 사람에게는 보이지 않는다. (lophn-agent/questions#R7, lophn-agent/questions#R8, lophn-agent/harness/waiting-and-recovery#R1)
7. **[screen: things-to-confirm]** 사람은 세션 없는 Operator 질문과 놓친 질문도 찾고, 남은 결정 또는 지난 답·실제 적용 결과를 확인한다. notification을 보거나 읽음으로 표시해도 질문 답이 되지 않는다. (lophn-agent/questions#R2, lophn-agent/questions#R10, shell/desktop#R6, shell/desktop#R9, platform/notifications#R3, platform/notifications#R6, platform/notifications#R8)

## 다른 갈래

- 2에서 중요한 승인이나 권한 부여가 필요하면 질문 답으로 대신하지 않는다. **[screen: confirmation-window]** 사람이 별도 approval request의 정확한 대상·입력·영향을 보고 명시적으로 결정하며, 승인 접수와 실제 적용 결과도 구별한다. (lophn-agent/questions#R12, platform/approvals#R1, platform/approvals#R3, platform/approvals#R9)
- 2에서 secret이 필요하면 일반 질문 답에 붙여 넣지 않는다. **[screen: confirmation-window]** 전용 보호 입력으로 안내하며 secret으로 판정한 답은 일반 세션이나 model 입력에 남기지 않는다. (lophn-agent/questions#R11, shell/confirmation-window#R6)
- 3에서 창만 닫으면 답이나 승인으로 보지 않는다. 질문이 유효한 동안 나중에 다시 열 수 있고, 이미 끝난 질문의 늦은·중복 답은 새 결정으로 적용되지 않는다. (lophn-agent/questions#R6, lophn-agent/questions#R9, lophn-agent/questions#R10, shell/confirmation-window#R4)
- 3~5에서 연결이 끊기거나 전송 결과를 모르면 **[screen: conversation]** 작성하던 답과 마지막 확인 상태를 유지한다. 재전송보다 접수 조회를 먼저 하고, 재시작 뒤 실제 결정과 미시작 근거를 확인해 유효한 미반영 결정만 한 번 적용한다. 안쪽 복구는 사람에게는 보이지 않는다. (shell/desktop#R7, shell/desktop#R8, lophn-agent/harness/waiting-and-recovery#R11)
- 질문 내용이 바뀌거나 원래 일이 끝나면 옛 질문을 이유와 함께 닫고 필요할 때 새 질문을 낸다. **[screen: things-to-confirm]** 지난 질문은 결과로 남으며 옛 답으로 새 동작을 시작하지 않는다. (lophn-agent/questions#R5, lophn-agent/questions#R9, lophn-agent/conversation#R11)

## 끝

사람은 해당 질문의 답 접수와 실제 적용 결과, 또는 답 없이 미룸·만료·취소된 이유를 확인한다. 답이 필요한 일이 이어졌는지 멈췄는지를 구별하고, 유효한 무응답 질문은 끝났다고 표시하지 않는다. (lophn-agent/questions#R7, lophn-agent/questions#R8, lophn-agent/questions#R10, lophn-agent/harness/waiting-and-recovery#R1)
