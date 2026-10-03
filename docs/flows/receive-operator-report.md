---
type: flow
concerns: [lophn-agent/scheduling, lophn-agent/assignments, lophn-agent/roles/operator, lophn-agent/roles/common, lophn-agent/harness/run-loop, lophn-agent/harness/prompt-assemble, lophn-agent/harness/waiting-and-recovery, lophn-agent/questions, documents/contexts, documents/versions, apps/runtime, apps/permissions, apps/invocations, problems/grouping, platform/notifications, shell/desktop]
---
# 정해 둔 판단 결과와 새 이상을 확인한다

사람이 승인한 반복 판단의 주기가 도래한다. 사람은 계속 지켜보지 않아도 맡긴 일의 결과를 나중에 읽고, 꼭 자신의 선택이 필요한 일만 확인한다.

지키는 약속: lophn-agent/roles#I1, lophn-agent/roles#I5, lophn-agent/roles#I6, lophn-agent#I2, documents#I5, platform#I9.

## 흐름

1. machine이 승인한 Operator 주기만 계산해 한 회차를 중복 없이 접수한다. 같은 일에 접수됨·진행·사람 기다림의 끝나지 않은 run이 있으면 겹친 회차를 건너뛰고 대기열에 쌓지 않는다. 사람에게는 보이지 않는다. (lophn-agent/scheduling#R1, lophn-agent/scheduling#R3, lophn-agent/scheduling#R4, lophn-agent/scheduling#R5, lophn-agent/harness/run-loop#R2)
2. harness가 이번 목적과 승인한 책임·context 근거를 필요한 만큼 조립한다. Operator는 그 context 자료와 승인된 앱별 read command 결과만 읽고 실제 읽은 고정 판·확인 사실·판단·불확실함을 구별한다. 화면을 보고 있지 않은 사람의 이전 화면을 현재 화면으로 대신하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/prompt-assemble#R2, lophn-agent/harness/prompt-assemble#R4, lophn-agent/harness/prompt-assemble#R28, documents/contexts#R4, lophn-agent/roles/operator#R4, lophn-agent/roles/operator#R6, apps/permissions#R28, apps/runtime#R32)
3. Operator가 승인한 갱신 조건을 충족하면 지정한 기존 문서에 새 판을 남긴다. 사실·판단·부족한 근거를 나눠 쓰며 문서 자리·형식·쓰는 범위를 넓히지 않는다. 변화 없음이면 근거와 함께 끝내고 불필요한 새 판을 만들지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/operator#R6, lophn-agent/roles/operator#R7, lophn-agent/roles/common#R7, lophn-agent/roles/common#R10, lophn-agent/assignments#R6, documents/versions#R3, documents/versions#R4, documents/versions#R14)
4. 새 이상이나 미정 판단이 있으면 Operator는 승인 문서에 근거와 불확실함을 남기고, 기존 자료로 정할 수 없는 사람 결정만 질문으로 남긴다. 기획·수리 ticket·코드·바깥 효과·자기 책임 변경으로 이어 가지 않는다. 판단 문서를 썼다는 이유로 운영 문제를 만들거나 닫힘으로 표시하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/operator#R3, lophn-agent/roles/operator#R5, lophn-agent/roles/operator#R6, lophn-agent/roles/common#R1, lophn-agent/roles/common#R3, lophn-agent/roles/common#R5, lophn-agent/questions#R1, problems/grouping#R1)
5. roles 화면 사람이 맡긴 일의 결과와 만든 문서 링크를 찾아 document 화면에서 새 판과 근거를 읽는다. 변화 없음이면 결과 문서를 새로 만든 것처럼 보이지 않는다. 일의 결과와 반복 책임이 계속 켜져 있는 사실은 구별한다. (lophn-agent/assignments#R3, lophn-agent/roles/operator#R6, documents/versions#R6, documents/versions#R8, shell/desktop#R3, shell/desktop#R4)
6. things-to-confirm 화면 사람에게 필요한 질문, 운영 문제의 열림·재발 또는 반복 실패 멈춤처럼 notification 계기에 해당하는 일을 확인한다. 결과 링크가 있으면 document 화면로 이어 읽으며, 일반 보고 저장이나 run 완료마다 notification을 만들지 않는다. notification을 열거나 읽은 것은 답·승인·문제 닫힘이 아니다. (platform/notifications#R1, platform/notifications#R2, platform/notifications#R3, platform/notifications#R6, shell/desktop#R6, shell/desktop#R9)

## 다른 갈래

- 절전·재시작·사람 재개로 놓친 회차가 있으면 machine이 가장 최근 미처리 회차 하나만 처리하고 앞 회차는 놓침으로 남긴다. 과거 판단을 몰아서 수행하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/scheduling#R6)
- 2에서 자료·앱을 읽을 수 없으면 정상 0행·자료 미수집·부분 범위·신선도 부족을 구별한다. 보관된 대상이면 반복 일을 멈추고 일시 접근 불가이면 새 일을 시작하거나 호출하지 않는다. 없는 근거를 성공 보고로 채우지 않는다. (apps/invocations#R14, lophn-agent/assignments#R14, lophn-agent/roles/common#R10)
- 3에서 사람이 결과 문서를 고쳐 기준 판이 달라지면 저장을 충돌로 처리한다. 사람의 판을 덮어쓰거나 범위 밖 새 문서로 우회하지 않는다. (documents/versions#R4, lophn-agent/assignments#R8, lophn-agent/roles/operator#R7)
- 4에서 질문을 기다리면 다음 회차는 건너뛴다. 사람은 things-to-confirm 화면에서 질문과 선택지·추천 이유를 보고 명시적으로 답하거나 미룬다. 답이 필요한 동안 추정으로 진행하지 않고, 명시 미루기·취소·만료는 답 없음으로 끝낸다. (lophn-agent/scheduling#R5, lophn-agent/questions#R2, lophn-agent/questions#R3, lophn-agent/questions#R4, lophn-agent/questions#R6, lophn-agent/harness/waiting-and-recovery#R1, shell/desktop#R6)
- 실제 시작한 판단이 연속 3회 최종 실패하면 해당 반복 일만 멈춘다. roles 화면에서 실패 이유·이미 끝낸 일·다음 행동을 확인하며, 거절·답 없음·질문 대기는 실패 횟수에 넣지 않는다. 재개는 flow/manage-operator에서 사람이 정한다. (lophn-agent/assignments#R10, lophn-agent/assignments#R11, lophn-agent/assignments#R13, lophn-agent/harness/run-loop#R18, lophn-agent/harness/run-loop#R19)
- notification을 받을 때 현재 문서와 입력 focus를 바꾸지 않는다. OS 표시가 실패하거나 창이 닫혀도 같은 사실을 다시 찾을 수 있으며 연결 단절에는 마지막 확인 시각과 최신 확인 못함을 유지한다. (platform/notifications#R8, shell/desktop#R7, shell/desktop#R10)

## 끝

사람이 실제 남긴 보고를 읽거나 변화 없음·질문 대기·실패·멈춤을 서로 구별해 확인한다. 완료 결과가 없는 회차를 성공으로 채우지 않고 사람의 결정이 남았다면 다음 행동을 확인한다. (lophn-agent/roles/operator#R6, lophn-agent/roles/common#R10, lophn-agent/assignments#R3, lophn-agent/harness/run-loop#R18)
