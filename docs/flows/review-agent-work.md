---
type: flow
concerns: [lophn-agent/observability, lophn-agent/revert, lophn-agent/harness/usage, lophn-agent/harness/provider, lophn-agent/harness/tools, lophn-agent/harness/run-loop, lophn-agent/conversation, documents/versions, platform/ledger, platform/redaction, shell/desktop, shell/confirmation-window]
screens: [roles, conversation, confirmation-window]
---
# agent가 한 일과 비용을 보고 되돌린다

agent 결과가 마음에 들지 않거나 무엇을 왜 했고 얼마나 썼는지 알고 싶을 때 시작한다. 사람은 결과와 다음 행동부터 확인하고, 필요할 때 근거·변경·비용을 펼쳐 본다.

지키는 약속: lophn-agent#I5, lophn-agent/harness#I5, platform#I1, platform#I2, shell#I8.

## 흐름

1. **[screen: conversation]** 사람은 실제 결과 링크에서 관련 일을 연다. **[screen: roles]** 역할이 만든 결과에서도 같은 일을 찾는다. 기본으로 대상·실제 결과·필요한 다음 행동만 보고, 궁금할 때 상세를 연다. 계획 문장은 이미 만들어진 결과로 표시하지 않는다. (lophn-agent/conversation#R4, shell/desktop#R3, shell/desktop#R4, lophn-agent/observability#R20)
2. **[screen: conversation]** 사람은 상세에서 당시 주체·고정 근거·판단 이유의 요약과 실제 변경을 확인한다. 도구 활동을 펼치면 대상·한 일·성공·거절·실패·미실행·결과 불명을 구별하고, 필요할 때만 도구 이름·입력·안전한 원문 결과를 더 확인한다. 내부 사고 과정은 설명으로 요구하지 않는다. (lophn-agent/observability#R2, lophn-agent/observability#R5, lophn-agent/observability#R20, lophn-agent/observability#R21, lophn-agent/observability#R22, lophn-agent/harness/tools#R11)
3. lophn은 별도 이력 사본을 만들지 않고 원래 기록·고정 판·tool 결과를 연결해 조회한다. 본문 조회와 내보내기는 현재 redaction을 다시 거치며 secret·민감한 원문·내부 추론을 내보내지 않는다. 사람에게는 보이지 않는다. (lophn-agent/observability#R1, lophn-agent/observability#R8, lophn-agent/observability#R9, platform/redaction#R5, platform/redaction#R7, platform/redaction#R15, platform/redaction#R16)
4. **[screen: conversation]** 사람은 필요할 때 실제 model 호출별 사용량·cache와 당시 가격으로 계산한 추정 비용을 확인한다. 실제 청구·추정·구독 포함·확인된 무료·금액 불명을 구별하며 보고되지 않은 사용량이나 금액을 0으로 보지 않는다. handoff 비용도 실제 일한 역할에 연결된다. (lophn-agent/harness/usage#R2, lophn-agent/harness/usage#R5, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R7, lophn-agent/harness/usage#R8, lophn-agent/harness/usage#R10, lophn-agent/harness/provider#R27)
5. **[screen: conversation]** 사람이 끝난 일 하나의 revert를 요청하면 lophn은 확정 변경 전체의 현재 판·관계·권한과 후속 충돌을 검사하고, 복원 가능한 변경·불가능한 영향·남길 사실을 빠짐없이 분류한다. 검사는 사람에게는 보이지 않는다. (lophn-agent/revert#R1, lophn-agent/revert#R2, lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R9)
6. **[screen: confirmation-window]** 사람은 적용할 변경과 되돌릴 수 없는 영향·충돌·이유를 확인하고 명시적으로 결정한다. 복원 불가 업무 변경이 섞이면 기본으로 적용이 막히며, 남을 영향을 확인했더라도 안전하고 독립적인 복원 가능 변경 전체에만 적용한다. 후속 충돌은 이 결정으로 무시하지 않는다. (lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R7, shell/confirmation-window#R4, shell/confirmation-window#R5)
7. lophn은 복원 가능한 변경을 소유 concern의 새 변경으로 적용한다. 문서는 이전 내용을 새 version으로 남기고, 되돌리기 지원 앱 write는 저장된 근거와 현재 상태를 확인해 선언된 command를 역순으로 호출한다. 원래 이력·답·승인·관측·사용량은 지우지 않으며 같은 revert는 한 번만 적용한다. 사람에게는 보이지 않는다. (lophn-agent/revert#R5, lophn-agent/revert#R8, lophn-agent/revert#R10, documents/versions#R2, documents/versions#R10, platform/ledger#R10, platform/ledger#R13)
8. **[screen: conversation]** 사람은 실제 복원된 변경·미시작·부분 결과·남은 영향·결과 불명을 확인한다. 이미 외부로 나간 효과나 activation·secret 사용·다른 사람이 고친 내용이 몰래 취소됐다고 표시하지 않으며, 단순 완료 문장이나 비용 집계로 성공을 대신하지 않는다. (lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R6, lophn-agent/revert#R11, lophn-agent/conversation#R4)

## 다른 갈래

- 근거나 본문이 없거나 안전하게 보여 줄 수 없으면 **[screen: conversation]** 부재·제외 이유와 읽을 수 있는 범위를 확인한다. 없는 사용량은 모름으로 남기며 가격 갱신이나 늦은 usage로 원래 비용을 덮지 않는다. (lophn-agent/observability#R20, platform/redaction#R14, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R9)
- 아직 진행 중이거나 사람을 기다리는 일은 먼저 멈춰 실제 종료를 확인한 뒤 revert를 요청한다. 중단 그 자체가 이미 완료한 변경을 복원하지 않는다. (lophn-agent/revert#R1, lophn-agent/revert#R2, lophn-agent/harness/run-loop#R18)
- 5~6에서 후속 변경·관계 충돌이 있으면 어떤 복원도 시작하지 않는다. **[screen: confirmation-window]** 대상이 바뀌거나 현재 조회가 실패하면 옛 결정 행동으로 제출할 수 없고 이유와 최신 내용 경로만 확인한다. (lophn-agent/revert#R4, shell/confirmation-window#R5)
- 7에서 앱 호출 실패·충돌·응답 유실이 생기면 앱 복원과 ledger 복원을 하나의 transaction처럼 표시하지 않는다. **[screen: conversation]** 이미 복원된 변경·미시작 변경·불명확 결과를 각각 확인한다. (lophn-agent/revert#R11)
- 사람이 기록 export를 원하면 포함할 본문 종류와 대상·목적지를 별도로 고른다. 기본은 metadata뿐이며 redaction 뒤 내용만 내보낸다. export 실패는 원래 일의 결과를 바꾸거나 model을 재호출하지 않는다. (lophn-agent/observability#R10, lophn-agent/observability#R13, lophn-agent/observability#R16, lophn-agent/observability#R17)

## 끝

사람은 실제 결과와 필요할 때 펼친 근거·비용을 이해하고 검토를 마친다. revert를 했다면 전체·부분·충돌로 미적용·결과 불명을 실제 결과대로 확인하며, 원래 이력과 남은 외부 영향은 그대로 읽을 수 있다. (lophn-agent/observability#R20, lophn-agent/harness/usage#R7, lophn-agent/revert#R3, lophn-agent/revert#R8, lophn-agent/revert#R11)
