---
type: flow
concerns: [apps/automations, apps/blueprint, apps/runtime, apps/permissions, apps/invocations, apps/data, documents/versions, platform/secrets, platform/ledger, platform/responsiveness, problems/reporting, problems/grouping, shell/desktop]
screens: [app-detail, app-space]
---
# 앱이 스스로 모은 결과를 나중에 본다

사람이 화면을 보고 있지 않을 때, 허락한 앱의 시작 계기나 정해진 간격이 도래한다. 사람은 앱이 수집·동기화·집계한 결과와 실제로 확인된 상태를 돌아와서 본다.

지키는 약속: apps#I5, apps#I7, apps#I8, platform#I1, platform#I3, platform#I8.

## 흐름

1. 앱이 blueprint에 선언한 같은 release의 command와 검사된 고정 입력으로 automation을 준비한다. 계기는 업무 통로가 열린 때 한 번 또는 최소 60000ms 간격이다. 가져오기만 하는 read와 가져와 저장하는 write는 가능하지만 external·confirm command는 선언하거나 실행하지 못한다. 사람에게는 보이지 않는다. (apps/blueprint#R5, apps/blueprint#R14, apps/automations#R1, apps/automations#R2, apps/automations#R13)
2. machine이 앱 실행 허용·현재 release·실제 데이터 schema와 현재 grant를 확인해 호출 가능한 때만 시작한다. 준비·교체·preview 중에는 운영 automation을 시작하지 않는다. 명령은 직접 호출과 같은 구현·입력 검사를 사용한다. 사람에게는 보이지 않는다. (apps/automations#R1, apps/automations#R4, apps/runtime#R2, apps/runtime#R3, apps/runtime#R11, apps/permissions#R2)
3. 앱에 준 secret grant가 있으면 automation에서도 같은 허락을 사용하고 호출마다 승인받지 않는다. 외부 요청은 허락한 정확한 host·port 안에서만 보낸다. secret 값은 앱 코드·automation·agent로 전달하지 않고 lophn이 허락한 목적지로 보내기 직전에 붙인다. 사람에게는 보이지 않는다. (apps/permissions#R8, apps/permissions#R14, apps/permissions#R15, apps/permissions#R16, platform/secrets#R4, platform/secrets#R5)
4. 앱이 수집·동기화·집계하고 자기 DB 또는 선언·grant가 있는 자기 앱 문서에 결과를 남긴다. 앱 데이터는 앱이 쓰고, 남긴 문서는 고정 판으로 보존한다. 결정적인 수집·집계에 model을 부르지 않으며 무거운 앱 일은 core의 짧은 command 밖에서 처리한다. 사람에게는 보이지 않는다. (apps/data#R1, apps/data#R2, apps/blueprint#R13, apps/permissions#R13, documents/versions#R14, platform/responsiveness#R1, platform/ledger#R4)
5. machine이 같은 automation의 진행 호출을 최대 1개로 유지하고 끝나지 않은 동안 도래한 회차는 건너뛴다. 절전·앱 중단으로 놓친 회차는 몰아서 처리하지 않고 미래 간격부터 잇는다. 한 호출 실패 직후 자동 retry는 하지 않는다. 사람에게는 보이지 않는다. (apps/automations#R3, apps/automations#R5, apps/automations#R7, apps/automations#R8)
6. 앱의 응답 뒤 automation의 read를 포함한 invocation 기록을 비동기로 남긴다. 기록 전달이 늦거나 실패해도 다른 앱의 호출·화면을 막거나 끝난 업무 결과를 바꾸지 않는다. 기록 재전송은 업무를 재실행하는 것이 아니다. 사람에게는 보이지 않는다. (apps/invocations#R1, apps/invocations#R2, apps/invocations#R5, apps/invocations#R6, apps/automations#R11, platform/responsiveness#R2, apps/runtime#R21)
7. **[screen: app-space]** 사람이 돌아와 결과와 지금 필요한 상태·다음 행동만 본다. 더 확인하려면 **[screen: app-detail]**에서 선언된 일·현재 실행 가능 여부·실제 호출과 마지막 확인 상태를 구별해 읽는다. 호출 성공을 업무 정확성이나 문제 닫힘으로 표시하지 않는다. (apps/automations#R10, apps/runtime#R13, apps/runtime#R14, apps/invocations#R3, apps/invocations#R10, apps/invocations#R13)

## 다른 갈래

- 1에서 external·confirm command를 automation으로 등록하려 하면 시작하지 못한다. secret 사용 자체가 external 또는 confirm이라는 이유는 아니며 가져오기·동기화는 선언 효과와 grant를 따르게 한다. (apps/blueprint#R5, apps/blueprint#R6, apps/automations#R13)
- 2에서 앱을 사람이 멈췄거나 현재 권한·데이터 준비가 맞지 않으면 호출을 시작하지 않는다. **[screen: app-detail]**에서 필요한 행동을 확인하며 사람이 다시 실행을 허용하기 전 자동 재시작하지 않는다. (apps/automations#R4, apps/automations#R10, apps/runtime#R15, apps/runtime#R16, apps/permissions#R2)
- 3에서 OS keychain이 없거나 잠겼으면 secret이 필요한 기능만 사용할 수 없다고 표시한다. 평문 fallback을 만들지 않고 secret 없는 로컬 앱 기능은 계속 쓸 수 있다. (platform/secrets#R8)
- 4에서 결과 문서의 기준 판이 바뀌면 저장을 충돌로 처리하고 사람의 판을 덮어쓰지 않는다. 문서 저장과 앱 DB 변경을 하나의 원자 성공이라고 보장하지 않는다. (documents/versions#R4, apps/data#R2)
- 4~6에서 앱이 실패하면 실제 실패 자리의 운영 보고를 문제 경로로 남긴다. 실패 설명과 다음 행동만 기본으로 보여 주고 raw 오류·stack·code는 내보내지 않는다. 유효한 운영 보고만 문제로 모으며 단순 기록 누락을 성공이나 새 문제의 근거로 꾸미지 않는다. (problems/reporting#R1, problems/reporting#R3, problems/reporting#R7, problems/reporting#R13, problems/grouping#R1, problems/grouping#R11)
- 호출이 기본 10분 timeout을 넘거나 연결이 끊기면 실제 결과를 모를 수 있다. 부분 저장이 없었다고 단정하지 않고 미확인·기록 없음·실패를 구별한다. 결과 모름·기록 유실을 이유로 그 업무를 자동 재호출하지 않는다. (apps/automations#R9, apps/runtime#R12, apps/invocations#R10, apps/invocations#R11, apps/invocations#R12)
- 사람이 동작을 직접 확인하려면 현재 명령의 직접 호출로 처리한다. 운영과 preview를 명시하고 preview 대상이 없다고 운영으로 대신 실행하지 않는다. (apps/automations#R12)
- 사람 화면의 연결이 끊기면 **[screen: app-detail]**에서 마지막 확인 상태·시각과 최신 확인 못함을 유지하고 재연결 뒤 현재 기록으로 맞춘다. 다른 앱과 로컬 문서·기록 조회는 한 앱의 장애를 기다리지 않는다. (shell/desktop#R7, apps/runtime#R21)

## 끝

사람이 앱의 실제 결과와 마지막 확인 상태를 보고 계속 쓰거나 필요한 다음 행동을 고른다. 실행 불가·실패·timeout·결과 모름·기록 없음은 성공으로 채우지 않고, 상세는 원할 때 확인한다. (apps/automations#R10, apps/invocations#R10, apps/invocations#R11, apps/runtime#R13)
