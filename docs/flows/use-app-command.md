---
type: flow
concerns: [apps/blueprint, apps/permissions, apps/runtime, apps/invocations, platform/secrets, platform/approvals, lophn-agent/harness/tools, lophn-agent/harness/tool-judgment, lophn-agent/harness/run-loop, lophn-agent/conversation, shell/confirmation-window]
screens: [project-workspace, app-panel, conversation, confirmation-window]
---
# 내 앱의 기능을 agent에게 시킨다

사람이 만든 캘린더 등 앱의 조회나 동작을 자연어로 요청한다. 사람은 command 이름이나 별도 MCP 연결을 알 필요 없이 원하는 결과를 말하고, 꼭 필요한 결정만 직접 한다.

연결된 intent: apps#I11, lophn-agent/harness#I9, lophn-agent/harness#I4, apps#I7, platform#I8, lophn-agent#I4.

## 흐름

1. **[screen: project-workspace]** 사람이 쓰는 **[screen: app-panel]** 앱의 기능을 **[screen: conversation]** agent에게 요청한다. agent는 이미 허락된 command의 설명과 입력 계약에서 요청한 결과에 맞는 기능을 찾으며, 앱을 별도 MCP 서버로 연결하지 않는다. command 탐색은 사람에게는 보이지 않는다. (apps/blueprint#R20, lophn-agent/harness/tools#R16)
2. harness는 현재 역할·assignment 범위와 앱별 agent command 허락의 교집합만 tool로 제공한다. 화면을 열었거나 다른 앱 연결을 허락한 것만으로 agent 실행을 허락하지 않는다. 공개·범위 검사는 사람에게는 보이지 않는다. (apps/permissions#R27, apps/permissions#R28, lophn-agent/harness/tools#R17, apps/runtime#R32)
3. lophn은 blueprint의 입력을 검사·정규화하고 선언된 effect·confirm·되돌리기 지원으로 실행을 판정한다. 가져오기만 하면 read, 가져와 로컬 업무 데이터에 저장하면 write, 앱 밖 상태를 바꾸면 external이며 confirm은 이와 별도로 지킨다. 판정은 사람에게는 보이지 않는다. (apps/blueprint#R4, apps/blueprint#R5, apps/blueprint#R7, lophn-agent/harness/tool-judgment#R10, lophn-agent/harness/tool-judgment#R11)
4. 사람 확인이 필요하면 **[screen: confirmation-window]** 사람은 정확한 앱·release·command·입력에 해당하는 대상과 영향, 남는 결과를 보고 허락하거나 거절한다. 요청한 창의 앱은 계속 보이지만 입력은 막힌다. secret grant만 사용한다는 이유로 매번 approval을 만들지 않는다. (platform/approvals#R1, platform/approvals#R8, shell/confirmation-window#R6, apps/permissions#R14, apps/blueprint#R6)
5. lophn은 바로 허용된 호출 또는 사람이 허락한 호출의 현재 권한·대상·입력을 다시 검사해 대상 앱으로 보낸다. 일반 앱 요청·응답은 core·ledger queue를 기다리지 않으며, 사람 확인 호출은 실행 직전 접수에 approval을 한 번만 사용한다. secret은 대상 앱의 현재 grant와 목적지 범위 안에서 전송 직전에만 붙이고 앱 코드와 agent에는 주지 않는다. 재검사·전송·secret 처리·기록은 사람에게는 보이지 않는다. (apps/runtime#R10, apps/runtime#R11, apps/invocations#R1, apps/invocations#R7, apps/invocations#R8, lophn-agent/harness/tool-judgment#R6, apps/permissions#R14, apps/permissions#R16, platform/secrets#R4, platform/secrets#R5)
6. **[screen: conversation]** 사람은 실제 결과와 필요한 다음 행동을 확인한다. 결과 설명은 접수·실제 시작·성공·실패·결과 모름을 혼동하지 않으며, 필요한 상세는 결과 근거로 확인할 수 있다. **[screen: app-panel]** 앱의 현재 내용은 확인된 결과로만 읽는다. (lophn-agent/harness/tools#R11, lophn-agent/conversation#R4, apps/invocations#R9, apps/invocations#R10)

## 다른 갈래

- 2에서 agent command 허락이 없으면 해당 command를 공개·실행하지 않는다. 사람이 접근을 허락하는 일은 flow/manage-app-permissions를 따르며, 일회 동작 approval로 이 범위를 대신 열지 않는다. (apps/permissions#R27, lophn-agent/harness/tool-judgment#R2)
- 3~5에서 앱의 release·입력 계약·grant가 바뀌면 옛 tool 정의나 approval을 사용하지 않는다. 정확한 새 대상과 입력에 필요한 결정만 다시 받는다. (lophn-agent/harness/tools#R17, platform/approvals#R5, platform/approvals#R11)
- 4에서 사람이 거절하면 실행하지 않고 같은 원래 요청에서 같은 동작을 다시 묻지 않는다. 창 닫기·침묵·세션의 긍정은 approval이 아니다. (platform/approvals#R4, platform/approvals#R15, platform/approvals#R16)
- 5에서 앱이 멈추거나 연결 단절·timeout으로 결과를 확인하지 못하면 성공으로 표시하거나 업무 쓰기를 무작정 재호출하지 않는다. 읽기와 계약상 중복 효과가 없는 쓰기만 harness의 제한된 retry 대상이 될 수 있고, 미확인 confirm 호출을 다시 실행하는 데 원래 approval을 쓰지 않는다. (apps/runtime#R12, apps/invocations#R8, apps/invocations#R11, apps/invocations#R12, lophn-agent/harness/run-loop#R24)
- 도중 사람이 멈추면 새 tool 호출부터 막고 이미 시작한 동작의 실제 결과는 따로 확인한다. 멈춤 요청 자체를 외부 효과 취소로 표시하지 않는다. (lophn-agent/harness/run-loop#R15, lophn-agent/harness/run-loop#R16)
- secret이 잠겼거나 사용할 수 없으면 그 secret이 필요한 동작만 불가로 남기고 평문·환경 변수로 대체하지 않는다. secret 없는 로컬 기능은 계속 쓴다. (platform/secrets#R8)

## 끝

사람은 요청한 앱 기능의 실제 결과 또는 실행하지 못한 이유를 안다. 허락했다는 사실만으로 성공을 만들지 않고, 결과를 모르는 쓰기는 모른다고 남기며 secret 값은 어떤 agent에게도 전달되지 않는다. (platform/approvals#R9, apps/invocations#R10, platform/secrets#R4)
