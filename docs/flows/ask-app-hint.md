---
type: flow
concerns: [shell/workspace, apps/agent-context, apps/blueprint, apps/runtime, apps/permissions, apps/invocations, apps/sdk, lophn-agent/harness/prompt-assemble, lophn-agent/harness/tools, lophn-agent/harness/tool-judgment, lophn-agent/conversation, platform/redaction]
---
# 지금 앱에서 보고 있는 내용에 힌트를 받는다

사람이 코딩 테스트 앱에서 코드 입력이나 지난 attempt를 보며 힌트를 요청한다. 사람은 자료를 따로 복사하지 않고, 앱이 허락한 현재 화면과 주석 자리에서만 도움을 받는다.

연결된 intent: apps#I9, shell#I1, lophn-agent/harness#I3, platform#I2, apps#I7.

## 흐름

1. project-workspace 화면 사람이 app-panel 화면 지금 보는 코드 입력이나 attempt를 둔 채 conversation 화면 힌트를 요청한다. 요청한 창의 탭·선택·focus와 관측 시각을 묶고, 매 turn 현재 시각과 초점 앱의 짧은 요약을 새로 모은다. 수집과 prompt 조립은 사람에게는 보이지 않는다. (shell/workspace#R9, shell/workspace#R11, lophn-agent/harness/prompt-assemble#R25, lophn-agent/harness/prompt-assemble#R26)
2. agent는 앱이 선언한 read command로 앱·release·화면·view session과 revision에 연결된 요약을 읽는다. 코드 입력이나 지난 attempt는 앱이 공개한 범위의 요약에서 확인하고 필요할 때만 같은 read command의 상세를 조회한다. 조회와 범위 검사는 사람에게는 보이지 않는다. (apps/agent-context#R1, apps/agent-context#R2, apps/agent-context#R3, apps/agent-context#R6, apps/permissions#R28, lophn-agent/harness/tools#R18)
3. lophn은 민감한 칸을 요약·상세·오류에서 제거하고 안전한지 확인할 수 없는 원문은 제외한다. agent에게는 선언된 command 결과만 주고 DOM·screenshot·터미널 출력을 자동 수집하는 통로로 대체하지 않는다. 이 처리는 사람에게는 보이지 않는다. (apps/agent-context#R4, shell/workspace#R11, lophn-agent/harness/tools#R1, platform/redaction#R5, platform/redaction#R14)
4. agent가 힌트를 준비하면 lophn이 앱이 선언한 write command와 주석 자리, 조회한 화면 revision을 검사한다. tool의 공개와 별개로 역할·현재 앱 허락·입력·effect·confirm·되돌리기 계약에 따라 실행 여부를 판정한다. 힌트 준비와 판정은 사람에게는 보이지 않는다. (apps/agent-context#R1, apps/agent-context#R5, apps/agent-context#R6, apps/blueprint#R22, lophn-agent/harness/tool-judgment#R10, lophn-agent/harness/tool-judgment#R12)
5. 현재 주석 쓰기가 바로 허용되는 경우 lophn은 같은 앱 command 통로로 힌트를 쓰고 revision을 다시 검사한다. 사람이 그사이 코드를 바꾸거나 다른 attempt로 이동해 revision이 달라졌으면 옛 주석은 적용하지 않는다. 직접 호출·revision 검사·후행 기록은 사람에게는 보이지 않는다. (apps/runtime#R10, apps/runtime#R11, apps/agent-context#R5, apps/invocations#R1, apps/invocations#R16, apps/sdk#R39)
6. app-panel 화면 사람은 허락한 자리의 힌트를 읽고, conversation 화면 필요한 설명과 실제 적용 여부만 확인한다. 미선언 화면·주석 자리와 회수된 권한에는 쓰지 않는다. (apps/agent-context#R1, apps/agent-context#R5, apps/permissions#R28, apps/permissions#R29, lophn-agent/conversation#R4)

## 다른 갈래

- 1~2에서 현재 화면 조회가 실패하거나 화면이 닫혔으면 없음과 이유를 남긴다. 이전 turn의 화면을 현재 화면으로 재사용하지 않고 현재 상태를 확인할 수 있을 때 다시 읽는다. (apps/agent-context#R2, lophn-agent/harness/prompt-assemble#R28)
- 3에서 redaction에 실패하면 원문 대신 생략 사실을 돌려준다. 상세나 오류를 다른 통로로 읽어 민감한 칸을 복원하지 않는다. (apps/agent-context#R4, platform/redaction#R14)
- 4에서 command 허락이 없거나 화면·자리 검사가 실패하면 쓰기를 거절한다. 화면을 열었다는 사실이나 일회 approval로 범위를 넓히지 않는다. (apps/permissions#R27, lophn-agent/harness/tool-judgment#R2, lophn-agent/harness/tool-judgment#R12)
- 4에서 write가 사람 확인을 요구하면 직접 쓰기를 멈추고 앱 command의 사람 확인 갈래로 넘긴다. 이 갈래는 flow/use-app-command를 따른다. (lophn-agent/harness/tool-judgment#R10, apps/agent-context#R6)
- 5에서 revision 충돌이면 옛 주석을 거절하고 새 화면을 다시 조회한 뒤 현재 상태에 맞는 힌트를 준비한다. 충돌을 승인으로 무시하지 않는다. (apps/agent-context#R2, apps/agent-context#R5, lophn-agent/harness/tool-judgment#R12)
- 5에서 연결이 끊겨 결과가 불명확하면 실제로 힌트가 적용됐다고 표시하거나 쓰기를 자동 반복하지 않는다. (apps/runtime#R12, apps/invocations#R10, apps/invocations#R12, lophn-agent/conversation#R4)

## 끝

사람은 지금 보는 attempt의 허락된 자리에 힌트를 받았는지 안다. 화면이 바뀌었거나 권한·결과를 확인하지 못한 경우에는 적용하지 못한 이유가 남고, 옛 attempt에 몰래 주석을 쓰지 않는다. (apps/agent-context#R5, lophn-agent/harness/tools#R11, lophn-agent/conversation#R4)
