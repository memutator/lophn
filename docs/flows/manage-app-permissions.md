---
type: flow
concerns: [apps/blueprint, apps/permissions, apps/runtime, apps/connections, apps/automations, platform/secrets, platform/identity, platform/redaction, platform/approvals, shell/confirmation-window, shell/app-frame]
screens: [app-detail, confirmation-window]
---
# 앱 접근과 secret을 허락하거나 거둔다

앱이 파일·network·secret 접근을 요청하거나 사람이 앱의 접근을 줄이고 싶다. 사람은 목적에 필요한 범위만 정하며, 적용과 회수의 안전한 처리는 lophn이 맡는다.

연결된 intent: apps#I4, apps#I7, platform#I2, platform#I8, shell#I3, platform#I5.

## 흐름

1. **[screen: app-detail]** 사람은 앱의 목적과 필요한 접근 이유를 확인하고 **[screen: confirmation-window]** 정확한 앱·파일 경로·읽기 또는 쓰기·host와 port·secret 이름 등 요청 범위 중 필요한 것만 허락한다. blueprint 선언만으로 접근이 열리지 않으며 중요한 결정은 앱이 흉내 낼 수 없는 lophn 화면에서만 받는다. (apps/blueprint#R1, apps/permissions#R1, apps/permissions#R5, apps/permissions#R8, platform/approvals#R1, shell/confirmation-window#R1, shell/confirmation-window#R8)
2. secret 값이 필요하면 **[screen: confirmation-window]** 사람이 전용 보호 입력으로 넣는다. lophn은 OS keychain에 값을 보관하고 일반 문서·세션·앱 코드·환경 변수에는 넣지 않는다. keychain 저장과 참조 처리는 사람에게는 보이지 않는다. 입력 중에도 부모 창의 앱 view는 숨기지 않고 입력만 막는다. (platform/secrets#R1, platform/secrets#R2, platform/secrets#R5, apps/permissions#R15, shell/confirmation-window#R6, shell/app-frame#R30)
3. lophn은 호출마다 현재 release 선언과 active grant의 교집합을 강제한다. secret은 해당 앱의 이름별 grant와 목적지 범위 안에서 전송 직전에만 붙이며, 호출자가 사람 화면·agent·automation·다른 앱이라는 이유로 막거나 매번 approval을 받지 않는다. 검증·redaction 등록·전송은 사람에게는 보이지 않는다. (apps/permissions#R2, apps/permissions#R14, apps/permissions#R16, platform/secrets#R4, platform/secrets#R5, platform/redaction#R1)
4. secret grant와 별개인 command effect·confirm·실제 호출자의 command 허락은 계속 지킨다. 앱끼리의 confirm 호출은 사람 approval을 기다리고, 첫 판 automation은 external·confirm command를 돌리지 않는다. 이 판정은 사람에게는 보이지 않는다. (apps/blueprint#R4, apps/blueprint#R6, apps/connections#R3, apps/permissions#R27, apps/permissions#R28, apps/automations#R13)
5. **[screen: app-detail]** 사람이 permission·secret grant·앱 연결·agent command 허락을 줄이거나 거둔다. lophn은 관련 새 호출부터 차단하고 기존 프로세스의 실제 종료를 확인한 뒤 줄어든 범위로 재시작한다. 같은 범위의 다음 release는 기존 grant를 쓸 수 있지만 범위 확대는 새 결정을 받는다. 차단·종료 확인·재시작은 사람에게는 보이지 않는다. (apps/permissions#R3, apps/permissions#R20, apps/permissions#R29, apps/runtime#R1, platform/identity#R7)
6. secret 값을 교체·제거하는 경우 lophn은 참조 차단·OS 값 삭제·이전 값을 쓰던 프로세스 종료를 각각 실제로 확인한다. 이 처리는 사람에게는 보이지 않는다. **[screen: app-detail]** 사람은 회수 요청 접수와 실제 완료를 구별하고, 확인하지 못한 정리가 있으면 완료라고 보지 않는다. (platform/secrets#R7, apps/permissions#R17, apps/permissions#R21)

## 다른 갈래

- 1에서 전체 home·credential·다른 앱 저장소 같은 보호 범위나 wildcard host·전체 port를 요청하면 grant로 열지 않는다. 외부 파일 읽기와 network fetch를 함께 요청한 조합의 위험은 사람이 결정하기 전에 강조한다. (apps/permissions#R7, apps/permissions#R8, apps/permissions#R24)
- 1에서 사람이 거절하거나 결정을 그만두면 범위를 열지 않는다. 창 닫기·Escape·침묵은 결정으로 쓰지 않으며, 이미 허락한 다른 범위의 결정은 유지한다. (platform/approvals#R4, platform/approvals#R14, shell/confirmation-window#R4)
- 2~3에서 keychain이 없거나 잠겨 있으면 secret이 필요한 기능만 사용 불가로 두고 secret 없는 로컬 기능은 계속 쓴다. 평문 파일·별도 볼트·환경 변수로 대체하지 않는다. (platform/secrets#R8)
- 3에서 목적지가 바뀌거나 redirect가 확인한 범위를 벗어나면 재검사 없이 secret을 보내지 않는다. redaction 등록이나 검사가 실패하면 원문 대신 안전한 실패 이유만 남긴다. (apps/permissions#R16, platform/redaction#R14)
- 5~6에서 프로세스 종료나 정리 결과를 확인하지 못하면 회수 완료로 표시하지 않는다. 같은 데이터 저장소를 쓰는 다음 프로세스도 먼저 시작하지 않는다. (apps/permissions#R21, apps/runtime#R1)
- 권한 회수·secret 삭제·앱 연결 회수는 이미 읽은 자료나 이미 생긴 데이터·외부 효과의 취소가 아니다. 어떤 경우에도 secret 원문을 agent나 오류·기록에 전달하지 않는다. (apps/permissions#R22, apps/permissions#R29, platform/identity#R7, platform/secrets#R4, platform/redaction#R5)

## 끝

사람은 현재 앱이 어떤 범위를 쓸 수 있는지, 회수 요청과 실제 정리가 어디까지 끝났는지 안다. secret 값은 OS keychain과 전송 경계 밖으로 나오지 않으며, 접근을 거둔 일을 과거 데이터나 외부 효과의 취소로 오해하지 않는다. (apps/permissions#R2, apps/permissions#R21, apps/permissions#R22, platform/secrets#R1, platform/secrets#R5, platform/secrets#R7)
