---
type: flow
concerns: [lophn-agent/questions, lophn-agent/conversation, lophn-agent/harness/waiting-and-recovery, platform/identity, platform/ledger, platform/notifications, platform/approvals, shell/desktop, shell/workspace, shell/confirmation-window]
---
# 필요한 선택에만 답하고 원하면 미룬다

agent가 자료로 확인할 수 없는 의도·취향·결정을 정해야 할 때 시작한다. 사람은 대화 안에 뜬 질문 카드에서 필요한 결정에만 답하고, 답을 정하지 못하면 Skip으로 미룬다.

지키는 약속: lophn-agent#I6, lophn-agent#I4, platform#I5, lophn-agent/harness#I2.

## 흐름

1. agent는 기존 요청·답·읽을 수 있는 자료와 machine 확인으로 정할 수 없는 결정만 질문한다. 질문 tool 한 번에 질문 1~4개를 한 묶음으로 내며, 질문 하나는 독립된 결정 하나다. 이미 받은 답을 다시 묻거나 독립된 결정을 한 질문에 합치지 않고, 한 run에서 답을 기다리는 묶음은 하나뿐이다. 질문 준비는 사람에게는 보이지 않는다. (lophn-agent/questions#R1, lophn-agent/questions#R2)
2. **agent 화면** 묶음은 대화 안 카드 하나로 뜬다. 질문이 3개 이하이면 한 카드에 모두 펼쳐지고 넘으면 "1 of N"으로 넘겨 본다. 사람은 질문마다 설명 있는 선택지·번호 키·추천 표시와 추천 이유, 마지막의 Other 입력칸을 읽는다. 카드 머리는 "n of N answered"를, 아래는 "Work is paused until you answer"와 [Skip]·[Submit]을 보인다. 판단에 필요한 무응답 결과와 지정 기한도 확인할 수 있고, composer 위에 질문 칸은 따로 없다. (lophn-agent/questions#R3, lophn-agent/questions#R4, lophn-agent/questions#R17, shell/desktop#R46)
3. 답을 기다리는 동안 이 Agent 탭은 선택된 탭이 아니거나 다른 칸에 있어도 탭 줄에서 "Waiting for you"로 보인다. 표시는 focus와 스크롤을 바꾸지 않는다. (shell/workspace#R35)
4. **agent 화면** 사람이 질문마다 선택지를 고르거나 Other에 직접 쓴다. 선택 클릭만으로 답이 확정되거나 동작이 적용되지 않고, 모든 질문에 답해야 [Submit]이 켜진다. 사람이 해당 묶음의 [Submit]을 한 번 눌러야 답 전부가 함께 확정된다. 일반 메시지의 "동의"나 빈 답은 답으로 쓰지 않는다. (lophn-agent/questions#R4, lophn-agent/questions#R6, shell/desktop#R46)
5. 선택지에 되돌릴 수 있는 안쪽 동작이 고정돼 있으면 그 질문은 하나짜리 묶음이고, 사람이 그 선택지로 [Submit]하는 것이 적용 결정이다. 되돌릴 수 있는 안쪽 동작에는 별도 확인 창을 열지 않는다. machine은 사람이 확정한 동작의 대상·입력·비교 기준과 일회 적용 근거를 확인하고 그 내용만 사람의 결정으로 한 번 적용한다. agent에게 권한을 추가하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/questions#R13, platform/identity#R14, platform/ledger#R12, platform/ledger#R13)
6. **agent 화면** 카드가 접혀 "Answered 2 questions: …" 요약으로 그 자리에 남고, 사람은 답이 접수된 사실과 동작이 실제 적용된 결과를 따로 확인한다. 전제가 바뀌었다면 답은 남지만 동작은 적용되지 않으며 달라진 대상과 이유를 확인한다. 자유 답만으로 변경하지 않고 필요한 경우 정확한 내용을 고정한 새 선택지나 직접 요청으로 다시 확인한다. (shell/desktop#R46, lophn-agent/questions#R10, lophn-agent/questions#R14, lophn-agent/questions#R15, lophn-agent/harness/waiting-and-recovery#R5)
7. 답을 기다리던 일은 실제 답이 오면 같은 run에서 이어진다. 이 처리 자체는 사람에게는 보이지 않는다. (lophn-agent/questions#R7, lophn-agent/harness/waiting-and-recovery#R1)
8. **things-to-confirm 화면** 세션 없는 run(handoff로 받은 일)의 질문 묶음과 놓친 질문은 여기서 찾아 답한다. 남은 결정 또는 지난 답·실제 적용 결과를 확인한다. 이 화면은 그대로 둔다. notification을 보거나 읽음으로 표시해도 질문 답이 되지 않는다. (lophn-agent/questions#R2, lophn-agent/questions#R10, shell/desktop#R9, platform/notifications#R3, platform/notifications#R6, platform/notifications#R8)

## 다른 갈래

- 4에서 사람이 [Skip]하면 묶음 전체를 미루는 것이고 답으로 세지 않는다. 기본 선택이나 동의로 바뀌지 않고 답을 기다리던 일은 답 없음의 이유를 남기고 멈춘다. 만료와 취소도 같다. 기한 없는 무응답은 계속 기다릴 뿐 기본 선택이나 승인으로 바꾸지 않는다. (lophn-agent/questions#R6, lophn-agent/questions#R8, lophn-agent/harness/waiting-and-recovery#R1, shell/desktop#R46)
- 4에서 중요한 승인이나 권한 부여가 필요하면 질문 답으로 대신하지 않는다. **confirmation-window 화면** 사람이 별도 approval request의 정확한 대상·입력·영향을 보고 명시적으로 결정하며, 승인 접수와 실제 적용 결과도 구별한다. (lophn-agent/questions#R12, platform/approvals#R1, platform/approvals#R3, platform/approvals#R9)
- 4에서 secret이 필요하면 카드의 Other에 붙여 넣지 않는다. **confirmation-window 화면** 전용 보호 입력으로 안내하며 secret으로 판정한 답은 일반 session이나 model 입력에 남기지 않는다. (lophn-agent/questions#R11, shell/confirmation-window#R6)
- 2~4에서 사람이 다른 탭으로 가거나 Agent 탭을 닫아도 답으로 보지 않는다. 묶음이 유효한 동안 탭을 다시 열면 같은 카드를 다시 본다. 이미 끝난 묶음의 늦은·중복 답은 새 결정으로 적용되지 않는다. (lophn-agent/questions#R6, lophn-agent/questions#R9, lophn-agent/questions#R10)
- 4~6에서 연결이 끊기거나 전송 결과를 모르면 **agent 화면** 고르던 답과 마지막 확인 상태를 유지한다. 재전송보다 접수 조회를 먼저 하고, 재시작 뒤 실제 결정과 미시작 근거를 확인해 유효한 미반영 결정만 한 번 적용한다. 안쪽 복구는 사람에게는 보이지 않는다. (shell/desktop#R7, shell/desktop#R8, lophn-agent/harness/waiting-and-recovery#R11)
- 묶음 내용이 바뀌거나 원래 일이 끝나면 옛 묶음을 이유와 함께 닫고 필요할 때 새 묶음을 낸다. 옛 답으로 새 동작을 시작하지 않는다. archive했거나 닫힌 session에 늦게 온 변화로 session이 다시 열리지 않는다. (lophn-agent/questions#R5, lophn-agent/questions#R9, lophn-agent/conversation#R11)

## 끝

사람은 해당 묶음의 답 접수와 실제 적용 결과, 또는 답 없이 미룸·만료·취소된 이유를 확인한다. 답이 필요한 일이 이어졌는지 멈췄는지를 구별하고, 유효한 무응답 묶음은 끝났다고 표시하지 않는다. (lophn-agent/questions#R7, lophn-agent/questions#R8, lophn-agent/questions#R10, lophn-agent/harness/waiting-and-recovery#R1)
