---
type: flow
concerns: [lophn-agent/assignments, lophn-agent/scheduling, lophn-agent/roles/operator, lophn-agent/role-definition, lophn-agent/roles/context-engineer, lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery, lophn-agent/conversation, platform/approvals, platform/notifications, shell/confirmation-window, shell/desktop]
---
# 맡긴 반복 일을 멈추거나 바꾼다

반복 판단이 필요 없어졌거나 범위·주기·남길 문서를 바꾸려는 사람이 맡긴 일을 찾는다. 반복 실패 때문에 저절로 멈춘 경우에도 사람이 이유를 보고 다음 행동을 정한다.

지키는 약속: lophn-agent#I2, lophn-agent/roles#I5, lophn-agent/harness#I2, platform#I5.

## 흐름

1. roles 화면 사람이 맡긴 일의 목적·현재 진행·결과와 필요한 다음 행동을 본다. 멈춘 이유가 있으면 확인하고, 바꾸려는 범위·문서·주기는 필요할 때 상세에서 확인한다. 한 번의 결과 완료를 반복 책임의 종료와 혼동하지 않는다. (lophn-agent/assignments#R3, lophn-agent/assignments#R10, shell/desktop#R3, shell/desktop#R4)
2. roles 화면 사람이 일시 멈춤·명시적 재개·책임 회수 중 필요한 행동을 선택한다. 회수한 책임은 재개할 수 없으며 다시 맡기려면 새 일을 만든다. 반복 실패로 멈춘 책임은 시간 경과·재시작·정의 변경으로 저절로 다시 켜지지 않는다. (lophn-agent/assignments#R9, lophn-agent/assignments#R12)
3. machine이 멈춘 책임에 새 요청과 주기 회차를 시작하지 못하게 한다. 이미 시작한 run에는 현재 멈춤을 검사하며, run 멈춤이 접수되면 새 model·tool·retry·후속 요청을 막고 진행 호출에 중단을 요청한다. 끝난 run의 늦은 결과는 감사 기록만 보완한다. 책임 회수로 세션을 끝낼 때에는 미완료 run과 대기 요청을 정리하고 읽기 전용으로 남긴다. 사람에게는 보이지 않는다. (lophn-agent/assignments#R9, lophn-agent/role-definition#R14, lophn-agent/harness/run-loop#R15, lophn-agent/harness/run-loop#R16, lophn-agent/conversation#R8)
4. roles 화면 사람이 요청 접수와 실제 멈춤·이미 완료한 결과·미실행이나 결과 모름을 구별해 확인한다. 책임을 일시 멈춘 것은 세션 종료가 아니며, 이미 생긴 변경을 되돌렸다는 뜻도 아니다. (lophn-agent/harness/run-loop#R18, lophn-agent/harness/run-loop#R19, lophn-agent/conversation#R3, lophn-agent/conversation#R8, lophn-agent/assignments#R3)
5. 범위·남길 문서·주기·tool이나 반복 판단 내용을 바꾸려면 Context Engineer가 현재·제안 값과 이유를 담은 새 고정 초안을 준비한다. 기존 Operator와 나눈 결과 해석이나 일반 대화 답만으로 정의를 바꾸지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/context-engineer#R12, lophn-agent/roles/context-engineer#R13, lophn-agent/roles/operator#R8, lophn-agent/assignments#R5)
6. confirmation-window 화면 사람이 정확한 변경 전후와 읽을 범위·쓸 문서·주기·tool을 보고 새로 승인하거나 거절한다. 이전 허락을 넓혀 쓰거나 일반 메시지·추천·무응답을 승인으로 읽지 않는다. (lophn-agent/assignments#R4, lophn-agent/assignments#R5, platform/approvals#R4, platform/approvals#R5, platform/approvals#R10, shell/confirmation-window#R5, shell/confirmation-window#R6)
7. machine이 승인 내용과 현재 전제를 다시 검사해 전체 변경을 적용한다. 바뀐 정의는 다음에 시작하는 run부터 사용하며 이미 시작한 run의 당시 정의와 이전 결과는 보존한다. 주기 변경은 미래 첫 시점으로 새 계산을 시작하지만 멈춤 상태의 변경은 재개가 아니다. 사람에게는 보이지 않는다. (platform/approvals#R7, platform/approvals#R11, lophn-agent/role-definition#R12, lophn-agent/role-definition#R13, lophn-agent/role-definition#R14, lophn-agent/scheduling#R7)
8. roles 화면 사람이 실제 변경 결과와 지금 필요한 다음 행동을 확인한다. 반복 실패로 멈췄다면 실패 종류·횟수·마지막 이유·이미 끝낸 일을 확인한 뒤 문제를 해결하고 재개를 명시한다. 재개와 이전 stopped run을 자동으로 다시 돌리는 것은 다르다. (lophn-agent/assignments#R3, lophn-agent/assignments#R10, lophn-agent/assignments#R12, lophn-agent/harness/run-loop#R17, platform/approvals#R9)

## 다른 갈래

- 2에서 재개하면 처리한 예정 시점을 유지하고 놓친 회차는 가장 최근 미처리 회차 하나만 접수한다. 지나간 회차를 몰아서 만들거나 멈춘 run 전체를 처음부터 다시 실행하지 않는다. (lophn-agent/scheduling#R6, lophn-agent/scheduling#R7, lophn-agent/harness/run-loop#R17)
- 3에서 질문·approval을 기다리는 일이 끝나거나 취소되면 해당 대기도 유효하지 않은 이유로 닫는다. 늦은 답·허락으로 새 동작을 시작하지 않는다. (platform/approvals#R13, lophn-agent/harness/waiting-and-recovery#R5)
- 3에서 호출이 이미 시작됐으면 멈춤 요청만으로 효과 없음·성공을 단정하지 않는다. 확정 변경·미실행·불명확 효과를 구별하며 이미 끝난 결과는 보존한다. (lophn-agent/harness/run-loop#R16, lophn-agent/harness/run-loop#R18, lophn-agent/harness/waiting-and-recovery#R10)
- 6에서 거절·취소·만료하면 변경을 적용하지 않는다. 승인 전후 판이나 검토 대상이 달라져도 옛 승인으로 적용하지 않고 이전 정의 전체를 유지한다. (platform/approvals#R15, lophn-agent/assignments#R5, lophn-agent/role-definition#R12)
- 대상이나 결과 문서가 보관되어 멈춘 일은 보관을 푸는 행동만으로 재개했다고 표시하지 않는다. 반복 실패 멈춤도 사람이 명시적으로 재개하기 전 유지한다. (lophn-agent/assignments#R12, lophn-agent/assignments#R14)
- 연결이 끊기면 마지막 확인 상태를 유지하고 재연결 뒤 실제 적용 상태를 조회한다. notification을 읽거나 여는 것만으로 재개·승인을 적용하지 않는다. (shell/desktop#R7, platform/notifications#R6)

## 끝

사람이 맡긴 일이 실제로 멈췄거나 회수됐는지, 승인한 변경이 적용됐는지, 재개 후 무엇을 할지 확인한다. 멈춤·변경 요청의 접수와 실제 결과를 구별하고 이전 결과는 읽을 수 있다. (lophn-agent/assignments#R3, lophn-agent/conversation#R8, lophn-agent/harness/run-loop#R18, platform/approvals#R9)
