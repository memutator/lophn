---
type: flow
concerns: [lophn-agent/roles/context-engineer, lophn-agent/roles/operator, lophn-agent/roles/common, lophn-agent/role-definition, lophn-agent/assignments, lophn-agent/scheduling, lophn-agent/questions, documents/contexts, documents/versions, documents/series, apps/permissions, platform/approvals, shell/confirmation-window, shell/desktop]
screens: [contexts, confirmation-window, roles]
---
# 반복해서 살펴볼 일을 맡긴다

같은 자료를 반복 확인하며 판단을 매번 요청하던 사람이, 무엇을 살펴보고 어떤 결과를 남길지 말해 반복 판단을 맡긴다. 앱이 수행하는 수집·집계와 Operator가 맡는 판단을 구별한다.

지키는 약속: lophn-agent#I2, lophn-agent/roles#I5, lophn-agent#I4, platform#I5.

## 흐름

1. **[screen: contexts]** 사람이 반복해서 판단할 목적과 자료를 말한다. Context Engineer는 기존 context와 겹치는 책임을 읽고 반복 판단이 필요한 근거를 검토한다. 후보 검토는 최근 30일 watch 변화 4회 이상, 기준 자료 뒤처짐 14일 이상, 최근 30일 같은 수동 업무 4회 이상 중 하나의 근거가 있을 때 시작한다. (documents/contexts#R1, lophn-agent/roles/context-engineer#R1, lophn-agent/roles/context-engineer#R11, lophn-agent/roles/context-engineer#R13)
2. Context Engineer가 프로그램으로 처리할 수집·합계와 agent가 맡을 해석·판단을 나눈다. 단순 수집·집계뿐인 일을 Operator로 제안하지 않는다. 목적과 범위는 필요한 자료만 읽어 정리하며, 계산에 모델을 쓰지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/context-engineer#R3, lophn-agent/roles/context-engineer#R11, lophn-agent/roles/common#R9)
3. Context Engineer가 판단·제외·필요 근거·비교 기준·갱신 조건, context 하나, 실제 남길 기존 문서 최소 1개, 주기와 읽을 앱 명령·tool을 담은 고정 초안을 남긴다. 남길 문서가 없으면 최초 양식을 실제 문서 판으로 준비하되 판단 결과로 표시하지 않는다. 첫 예정 시점과 양수 간격은 명시하며 기본 주기로 대신하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/context-engineer#R12, lophn-agent/role-definition#R15, lophn-agent/assignments#R6, documents/versions#R14, lophn-agent/scheduling#R3)
4. **[screen: contexts]** 사람이 제안한 반복 판단과 읽을 자료·남길 문서·주기를 검토한다. 뜻이나 목적을 사람만 정할 수 있으면 필요한 결정 하나만 선택지·근거·추천 이유와 함께 묻는다. 실제 문서나 범위가 빠진 제안은 승인 가능한 초안으로 취급하지 않는다. (lophn-agent/roles/context-engineer#R12, lophn-agent/roles/context-engineer#R10, lophn-agent/questions#R1, lophn-agent/questions#R3, lophn-agent/assignments#R6)
5. **[screen: confirmation-window]** 사람이 정확한 정의·context·남길 문서·주기·읽을 앱 명령·tool 전체와 현재 값에서 달라지는 내용·이유를 보고 승인하거나 거절한다. 추천, 일반 질문 답, 무응답이나 창 닫기로 반복 판단을 시작하지 않는다. (lophn-agent/assignments#R4, lophn-agent/assignments#R5, platform/approvals#R3, platform/approvals#R4, platform/approvals#R10, lophn-agent/questions#R12, shell/confirmation-window#R5, shell/confirmation-window#R6)
6. machine이 승인한 고정 초안과 현재 전제를 다시 검사한 뒤 정의와 assignment를 적용하고 주기 접수를 준비한다. 읽을 앱 명령도 현재 앱별 agent 허락과 승인 범위의 교집합 안에서만 쓴다. 다른 역할에는 자동 주기를 붙이지 않는다. 사람에게는 보이지 않는다. (lophn-agent/role-definition#R11, lophn-agent/assignments#R4, lophn-agent/assignments#R5, apps/permissions#R27, apps/permissions#R28, platform/approvals#R7, platform/approvals#R11, lophn-agent/scheduling#R1)
7. **[screen: roles]** 사람이 맡긴 일의 목적·현재 진행·필요한 다음 행동을 확인한다. 범위·남길 문서·주기와 상세 기록은 필요할 때 확인한다. 승인 접수와 실제 적용 성공은 구별하며 아직 판단하지 않은 최초 양식을 보고 결과로 표시하지 않는다. (lophn-agent/assignments#R3, lophn-agent/roles/context-engineer#R12, platform/approvals#R9, shell/desktop#R4)

## 다른 갈래

- 1에서 같은 context에 겹치는 책임이 있으면 새 일을 늘리는 대신 기존 책임·남길 문서를 바꿀 초안을 제안한다. 기존 결과 문서 하나를 두 Operator가 함께 소유하지 않는다. (lophn-agent/roles/context-engineer#R13, lophn-agent/assignments#R8)
- 3에서 실제 첫 판이 없는 문서, 원본 연결·보관 문서, series나 동적 이름을 쓰기 대상으로 정하면 적용할 수 없다. 사람은 쓸 수 있는 기존 문서를 정한다. (lophn-agent/assignments#R6)
- 4에서 사람이 뜻·목적 결정을 미루면 관련 변경은 보류한다. 미정 내용과 추천을 승인된 정의에 넣지 않는다. (lophn-agent/roles/context-engineer#R10, lophn-agent/questions#R8)
- 5에서 거절·취소·만료하면 반복 판단은 시작되지 않는다. 창 닫기는 승인도 거절도 아니며 지정 기한이 있으면 그 시각 이후 승인할 수 없다. (platform/approvals#R4, platform/approvals#R12, platform/approvals#R15, shell/confirmation-window#R4)
- 6에서 초안·변경 전 판·권한·대상이 달라졌으면 옛 승인으로 적용하지 않는다. 새 내용을 확인하도록 안내하며 적용 오류는 이전 정의를 유지한다. (lophn-agent/assignments#R5, lophn-agent/role-definition#R11, lophn-agent/role-definition#R12, platform/approvals#R11)
- 연결이 끊겨도 승인 접수를 적용 완료로 바꾸지 않는다. 마지막 확인 상태를 유지하고 재연결 뒤 현재 기록으로 맞춘다. (platform/approvals#R9, shell/desktop#R7)

## 끝

사람이 승인한 반복 일이 실제로 적용됐음을 확인하고 다음 판단을 기다린다. 거절하거나 결정을 미뤘다면 반복 판단은 시작되지 않는다. 다음 결과 확인은 flow/receive-operator-report, 범위 변경·멈춤은 flow/manage-operator에서 이어진다. (lophn-agent/assignments#R3, lophn-agent/assignments#R4, platform/approvals#R9)
