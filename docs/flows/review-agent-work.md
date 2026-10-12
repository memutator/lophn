---
type: flow
concerns: [lophn-agent/observability, lophn-agent/revert, lophn-agent/harness/usage, lophn-agent/harness/provider, lophn-agent/harness/tools, lophn-agent/harness/run-loop, lophn-agent/conversation, platform/ledger, platform/redaction, shell/desktop, shell/workspace, shell/confirmation-window]
---
# agent가 한 일과 비용을 보고 되돌린다

agent 결과가 마음에 들지 않거나 무엇을 왜 했고 얼마나 썼는지 알고 싶을 때 시작한다. 사람은 결과와 다음 행동부터 확인하고, 필요할 때 근거·변경·비용을 펼쳐 본다. 별도 목록 화면은 없고 모두 그 일을 한 agent의 Agent 탭에서 한다.

지키는 약속: lophn-agent#I7, platform#I2, shell#I1.

## 흐름

1. **agent 화면** 사람은 agent 답 아래의 편집 카드 "Edited <경로> +n −m"에서 [Open]을 눌러 바뀐 문서를 탭으로 연다. 한 답에 4개 이상이면 첫 3개와 남은 개수가 보이고 나머지는 결과 보기로 연다. 기본으로 대상·실제 결과·필요한 다음 행동만 보이고, 계획 문장은 이미 만들어진 결과로 표시하지 않는다. (shell/desktop#R3, shell/desktop#R41, lophn-agent/conversation#R4, lophn-agent/observability#R20)
2. **agent 화면** 궁금하면 사람이 tool 줄("Read 3 documents ›")을 눌러 펼치거나, header의 보기 상세 select를 Everything으로 바꿔 모든 tool 줄을 펼친다. 기본은 Compact(tool 줄 접힘)이고 Messages는 tool 줄을 숨긴다. 보기 상세를 바꿔도 메시지와 카드는 그대로다. 펼친 줄에서 대상·한 일·성공·거절·실패·미실행·결과 불명을 구별하고, 필요할 때만 도구 이름·입력·안전한 원문 결과를 더 확인한다. 내부 사고 과정은 설명으로 요구하지 않는다. (shell/desktop#R41, shell/desktop#R42, lophn-agent/observability#R2, lophn-agent/observability#R5, lophn-agent/observability#R21, lophn-agent/observability#R22, lophn-agent/harness/tools#R11)
3. lophn은 별도 이력 사본을 만들지 않고 원래 기록·고정 판·tool 결과를 연결하는 run trace에서 tool 줄과 카드를 그린다. trace에 없는 줄은 그리지 않는다. 본문 조회는 현재 redaction을 다시 거치며 secret·민감한 원문·내부 추론을 보이지 않는다. 사람에게는 보이지 않는다. (lophn-agent/observability#R1, lophn-agent/observability#R8, lophn-agent/observability#R9, shell/desktop#R41, platform/redaction#R5, platform/redaction#R7, platform/redaction#R15, platform/redaction#R16)
4. **agent 화면** 사람이 header의 ⋯ 메뉴에서 Usage를 열어 실제 model 호출별 사용량·cache와 당시 가격으로 계산한 추정 비용을 확인한다. 실제 청구·추정·구독 포함·확인된 무료·금액 불명을 구별하며 보고되지 않은 사용량이나 금액을 0으로 보지 않는다. handoff 비용도 실제 일한 agent에 연결된다. (shell/desktop#R38, lophn-agent/harness/usage#R2, lophn-agent/harness/usage#R5, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R7, lophn-agent/harness/usage#R8, lophn-agent/harness/usage#R10, lophn-agent/harness/provider#R27)
5. **agent 화면** 마음에 안 들면 사람이 편집 카드의 [Undo]를 눌러 그 편집 하나를 되돌리거나, 내 메시지에 올려 나온 "Rewind to here"(또는 header ⋯ 메뉴의 Rewind…)로 menu를 연다. menu에는 Restore messages and documents · Restore messages only · Summarize from here가 있고 아래에 "Changes made outside this session are not restored."가 늘 보인다. 이 단추는 session이 살아 있는 동안만 있다. lophn은 그 메시지 이후 agent가 쓴 문서 파일의 지금 hash를 마지막 쓴 내용과 대조하고 앱 write의 revert command·receipt를 검사해 복원할 것·건너뛰는 것·남는 영향을 빠짐없이 나눈다. 검사는 사람에게는 보이지 않는다. (shell/desktop#R41, shell/desktop#R48, lophn-agent/revert#R1, lophn-agent/revert#R2, lophn-agent/revert#R3, lophn-agent/revert#R12, lophn-agent/revert#R15, lophn-agent/revert#R17, lophn-agent/revert#R19)
6. **confirmation-window 화면** 사람은 복원할 것, 사람이 고쳐서 건너뛰는 파일, 되돌릴 수 없는 앱 write 같은 남는 영향과 이유를 확인하고 명시적으로 결정한다. 남는 영향이 있으면 확인해야만 복원 가능한 것을 적용하고, 사람이 고친 파일은 이 결정으로 덮지 않는다. (lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R7, lophn-agent/revert#R18, shell/confirmation-window#R4, shell/confirmation-window#R5)
7. lophn은 앱 write를 선언된 revert command로 원래 호출 역순으로 먼저 되돌리고, 그 뒤 문서 파일을 쓰기 직전 내용으로 되돌린다. 뒤 메시지는 지우지 않고 숨기며 고른 메시지의 원문을 입력창에 채운다. 원래 이력·답·승인·관측·사용량은 지우지 않으며 같은 요청은 한 번만 적용한다. 사람에게는 보이지 않는다. (lophn-agent/revert#R8, lophn-agent/revert#R10, lophn-agent/revert#R13, lophn-agent/revert#R16, lophn-agent/conversation#R25, platform/ledger#R10, platform/ledger#R13)
8. **agent 화면** 사람은 실제 복원된 변경·건너뛴 파일·미시작·부분 결과·남은 영향·결과 불명을 확인하고, 다음 메시지를 보내기 전이면 redo로 되돌릴 수 있다. 이미 외부로 나간 효과나 activation·secret 사용·다른 사람이 고친 내용이 몰래 취소됐다고 표시하지 않으며, 단순 완료 문장이나 비용 집계로 성공을 대신하지 않는다. (lophn-agent/revert#R3, lophn-agent/revert#R4, lophn-agent/revert#R6, lophn-agent/revert#R11, lophn-agent/revert#R16, lophn-agent/conversation#R4)

## 다른 갈래

- 근거나 본문이 없거나 안전하게 보여 줄 수 없으면 **agent 화면** 부재·제외 이유와 읽을 수 있는 범위를 확인한다. 없는 사용량은 모름으로 남기며 가격 갱신이나 늦은 usage로 원래 비용을 덮지 않는다. (lophn-agent/observability#R20, platform/redaction#R14, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R9)
- 아직 진행 중이거나 사람을 기다리는 일은 먼저 composer의 Stop으로 멈춰 실제 종료를 확인한 뒤 되돌린다. 중단 그 자체가 이미 완료한 변경을 복원하지 않는다. (lophn-agent/revert#R1, lophn-agent/revert#R15, lophn-agent/harness/run-loop#R18, shell/desktop#R42)
- 5~6에서 사람이 고친 파일이 있으면 그 파일만 건너뛰고 나머지는 복원하며, 건너뛴 목록은 "Changes made outside this session are not restored." 아래 보인다. **confirmation-window 화면** 대상이 바뀌거나 현재 조회가 실패하면 옛 결정 행동으로 제출할 수 없고 이유와 최신 내용 경로만 확인한다. (lophn-agent/revert#R4, lophn-agent/revert#R17, shell/confirmation-window#R5)
- 7에서 앱 호출 실패·충돌·응답 유실이 생기면 앱 복원과 문서 복원을 하나의 transaction처럼 표시하지 않고 문서 복원은 시작하지 않는다. **agent 화면** 이미 복원된 변경·미시작 변경·불명확 결과를 각각 확인한다. (lophn-agent/revert#R11)
- 되돌리기는 session이 살아 있는 동안만 한다. session을 delete하면 그 session의 메시지와 run 기록, 되돌리기 단추와 되돌리기용 이전 내용 기록이 사라지지만, 그 run이 만든 문서와 앱 변경은 지워지지 않고 남는다. archive는 이전 내용 기록을 남긴다. (lophn-agent/conversation#R20, lophn-agent/revert#R20, shell/desktop#R48)
- 다른 agent가 한 일은 그 agent의 Agent 탭에서 같은 방식으로 본다. agent 전체의 일을 모아 보는 목록 화면은 없고, 답을 기다리는 탭은 탭 줄의 "Waiting for you" 점으로만 알아본다. 기록을 파일로 내보내는 단추도 없다. (shell/workspace#R33, shell/workspace#R35, shell/desktop#R38)

## 끝

사람은 실제 결과와 필요할 때 펼친 근거·비용을 이해하고 검토를 마친다. 되돌렸다면 복원·건너뜀·충돌로 미적용·결과 불명을 실제 결과대로 확인하며, 원래 이력과 남은 외부 영향은 그대로 읽을 수 있다. (lophn-agent/observability#R20, lophn-agent/harness/usage#R7, lophn-agent/revert#R3, lophn-agent/revert#R8, lophn-agent/revert#R11)
