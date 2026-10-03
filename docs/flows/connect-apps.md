---
type: flow
concerns: [apps/connections, apps/blueprint, apps/permissions, apps/runtime, apps/invocations, apps/sdk, platform/identity, platform/secrets, platform/approvals, shell/confirmation-window, shell/desktop]
screens: [app-detail, confirmation-window]
---
# 내 앱끼리 필요한 기능을 나눠 쓴다

예를 들어 계획 앱이 내가 만든 캘린더 앱의 조회나 일정 추가 기능을 써야 한다. 사람은 어떤 앱이 어느 앱의 무엇을 왜 사용하는지만 확인하고, 연결과 호출의 복잡한 처리는 lophn에 맡긴다.

연결된 intent: apps#I4, apps#I11, apps#I8, apps#I7, platform#I3, platform#I7.

## 흐름

1. **[screen: app-detail]** 사람은 부르는 앱이 선언한 대상 앱·command·목적을 확인한다. lophn은 현재 blueprint의 앱 연결 선언을 바탕으로 방향이 있는 앱 쌍과 필요한 command 범위를 준비한다. 선언 검사는 사람에게는 보이지 않는다. (apps/connections#R1, apps/blueprint#R22, apps/permissions#R26)
2. **[screen: confirmation-window]** 사람이 그 방향과 범위만 허락한다. 요청한 창의 앱 view는 숨기지 않고 입력만 막는다. 앱이 이 결정을 대신 제출하거나 한 앱의 허락을 다른 앱으로 재위임하지 못한다. (apps/connections#R1, platform/approvals#R3, platform/approvals#R10, shell/confirmation-window#R6, apps/connections#R5)
3. lophn이 부르는 앱의 현재 선언·앱 쌍의 active grant·대상 앱의 현재 command 목록의 교집합으로 연결을 준비한다. 새 command·새 대상·반대 방향은 자동 허락하지 않으며 SDK를 import한 사실도 grant가 아니다. 연결 준비는 사람에게는 보이지 않는다. (apps/connections#R2, apps/permissions#R26, apps/runtime#R30, apps/sdk#R40)
4. lophn은 별도 MCP 없이 대상 앱의 같은 handler·입력 검사·effect·confirm 규칙으로 호출을 준비하고 실제 caller 앱·당시 release·알려진 부모 호출을 검증한다. 입력 본문의 caller 주장이나 다른 앱의 허락을 합치지 않는다. 준비·검증은 사람에게는 보이지 않는다. (apps/connections#R3, apps/connections#R5, apps/blueprint#R7, platform/identity#R9)
5. 준비한 command가 사람 확인을 요구하면 **[screen: confirmation-window]** 사람은 실제 호출 주체와 정확한 대상 앱·release·command·입력·영향을 보고 결정한다. 연결 허락은 이 동작의 approval을 대신하지 않는다. lophn은 실행 직전 접수에 approval을 한 번만 사용하며, 접수 처리는 사람에게는 보이지 않는다. 확인이 필요 없는 command는 이 단계를 거치지 않는다. (apps/connections#R3, platform/approvals#R1, platform/approvals#R8, apps/invocations#R7, apps/invocations#R17)
6. 허용된 command는 대상 앱으로 직접 가며 일반 요청·응답은 core·supervisor·ledger queue를 기다리지 않는다. secret은 대상 앱의 자체 grant에 따라 목적지로 보낼 때만 붙이고 앱 사용자 코드와 agent에는 값을 주지 않는다. 실제 결과와 caller 근거는 후행 기록으로 남긴다. 전송·secret 처리·후행 기록은 사람에게는 보이지 않는다. (apps/connections#R4, apps/runtime#R10, apps/invocations#R16, apps/invocations#R18, apps/permissions#R14, apps/permissions#R16, platform/secrets#R5)
7. **[screen: app-detail]** 사람은 허락한 연결 범위를 확인하고 필요할 때 실제 호출 결과의 기록을 확인한다. 연결 선언과 grant, 실제 동작 결과를 혼동하지 않으며, 허락 접수만으로 command가 끝났다고 표시하지 않는다. (apps/connections#R1, apps/connections#R2, apps/invocations#R3, platform/approvals#R9)

## 다른 갈래

- 2에서 사람이 거절하거나 결정을 미루면 연결 범위를 열지 않는다. 창 닫기·침묵은 허락이나 거절로 해석하지 않는다. (platform/approvals#R3, platform/approvals#R4)
- 3에서 대상 앱의 command가 사라지거나 부르는 앱이 더는 선언하지 않으면 교집합에서 빠진 동작은 사용할 수 없다. 추가 command나 반대 방향이 필요하면 해당 방향과 범위의 새 결정을 받는다. (apps/connections#R1, apps/connections#R2)
- 4~6에서 대상 앱이 멈추거나 교체·연결 단절이 생기면 해당 호출만 사용 불가 또는 결과 모름으로 남긴다. 부르는 앱의 다른 기능과 다른 앱은 계속 쓰고 업무 쓰기를 자동 재호출하지 않는다. (apps/connections#R6, apps/runtime#R21, apps/invocations#R12)
- 4에서 호출 경로에 이미 있는 앱으로 돌아가거나 깊이 상한을 넘으면 handler를 시작하기 전에 해당 호출을 거절한다. (apps/connections#R7)
- 5에서 거절·취소·만료되면 그 command를 실행하지 않는다. 승인 뒤 대상·release·입력이나 현재 권한이 달라져도 옛 approval로 실행하지 않는다. (platform/approvals#R5, platform/approvals#R11, platform/approvals#R15, apps/invocations#R8)
- 사람이 연결을 거두려면 flow/manage-app-permissions를 따른다. 새 호출 차단과 실제 정리를 확인하고 이미 생긴 데이터·외부 효과가 취소됐다고 표시하지 않는다. (apps/permissions#R29, platform/identity#R7)

## 끝

사람이 허락한 방향과 command 범위 안에서만 앱끼리 기능을 사용한다. 확인이 필요한 동작은 여전히 사람의 정확한 결정을 기다리고, 대상 앱의 고장이나 결과 모름 때문에 다른 앱을 막거나 쓰기를 자동 반복하지 않는다. (apps/connections#R2, apps/connections#R3, apps/connections#R6)
