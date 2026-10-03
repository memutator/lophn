---
type: flow
concerns: [lophn-agent/roles/app-engineer, lophn-agent/conversation, lophn-agent/questions, documents/versions, apps/blueprint, apps/sdk, coding-agent/tickets, coding-agent/connection, problems/tests, apps/preview, apps/releases, apps/data, apps/permissions, apps/runtime, platform/approvals, shell/confirmation-window, shell/wording, lophn-agent/presets, coding-agent/harnesses, coding-agent/sessions, shell/terminal]
---
# 쓰던 앱을 원하는 방식으로 바꾼다

사람이 쓰던 앱의 기능·화면·동작을 바꾸거나 새 공용 SDK를 사용하는 변경을 원할 때 시작한다. 새 구현을 준비하는 것과 운영 앱을 바꾸는 것은 별개다.

지키는 약속: apps#I2, apps#I3, lophn-agent#I2, coding-agent#I4, coding-agent#I5, platform#I5.

## 흐름

1. conversation 화면 사람이 담당 App Engineer에게 원하는 결과를 말한다. App Engineer는 기존 설계·blueprint·release·확인된 사용 동작과 비교하고, 이미 자료로 확인할 수 있는 사실은 다시 묻지 않으며 필요한 결정만 설명과 추천을 붙여 묻는다. (lophn-agent/roles/app-engineer#R1, lophn-agent/roles/app-engineer#R2, lophn-agent/questions#R1, lophn-agent/questions#R3, lophn-agent/conversation#R4)
2. App Engineer가 기존 동작 중 보존할 것과 바꿀 범위·사용 동작·acceptance check를 설계 문서의 고정 판으로 남긴다. 최신 판을 덮어쓰지 않고 실제 읽은 판을 기준으로 저장한다. 사람에게는 보이지 않는다. (lophn-agent/roles/app-engineer#R9, lophn-agent/roles/app-engineer#R11, lophn-agent/roles/app-engineer#R12, documents/versions#R2, documents/versions#R4)
3. conversation 화면 사람이 실제 확인한 고정 설계 판을 채택한다. App Engineer는 같은 판과 채택 답을 근거로 같은 bundle의 app test와 실행 가능한 test command를 가진 구현 ticket을 남긴다. 실제 사용까지 맡긴 경우에는 정확한 release의 activation 확인도 조건에 넣는다. (lophn-agent/questions#R16, lophn-agent/roles/app-engineer#R17, coding-agent/tickets#R3, coding-agent/tickets#R8)
4. 사람은 변경할 ticket을 확인한 뒤 [Start]로 선택한 harness를 해당 project 터미널 탭 TUI로 열거나 자기 터미널에서 ticket을 지정한다. 기존 connection scope·ticket·project 폴더를 검증하고 첫 prompt는 한 번만 전달한다. session 시작은 claim이 아니며 coding agent는 MCP claim 후 구현·보고한다. (coding-agent/sessions#R1, coding-agent/sessions#R3, coding-agent/sessions#R5, coding-agent/sessions#R9, coding-agent/tickets#R11, shell/terminal#R12)
5. coding agent가 새 blueprint·구현을 준비하고 test runner가 같은 bundle의 필수 검사와 ticket의 확인을 실제로 수행한다. 운영 데이터·backup·실계정에 접근하지 않고 테스트 대역에서 확인하며, 필요한 migration은 빈 DB와 이전 schema에서 새 schema로 가는 두 경우를 검사한다. coding agent가 현재 claim을 재확인하고 같은 bundle의 app test 통과 결과로 release를 준비한다. 사람에게는 보이지 않는다. (apps/blueprint#R1, problems/tests#R6, problems/tests#R7, problems/tests#R8, problems/tests#R13, problems/tests#R15, apps/releases#R5, apps/releases#R6, coding-agent/tickets#R15)
6. app-detail 화면 사람이 실제 테스트 결과와 기존 앱에서 바뀔 내용을 보고 app-space 화면에서 운영과 분리된 preview를 확인한다. 사람이 요청한 release 검토에서 App Engineer는 실제 결과를 저장된 설계와 대조하고 어긋남·후속 변경 후보를 남긴다. preview 성공이나 schema 일치만으로 동작·업무 의미가 맞다고 단정하지 않는다. (apps/preview#R1, apps/preview#R2, apps/preview#R7, apps/preview#R10, lophn-agent/roles/app-engineer#R1, lophn-agent/roles/app-engineer#R18, apps/releases#R9, apps/releases#R10, problems/tests#R12)
7. confirmation-window 화면 사람이 정확한 release의 실제 동작 변경·추가와 축소 권한·데이터 변경·손실 가능성을 확인하고 승인하거나 보류한다. 새 host·경로·secret 등은 필요한 범위를 따로 허락하며, 기존 grant나 설계 채택으로 권한을 넓히지 않는다. (apps/releases#R8, apps/releases#R9, apps/releases#R11, apps/permissions#R1, apps/permissions#R3, platform/approvals#R5, shell/confirmation-window#R6)
8. machine이 대상·현재 release·grant·schema·사람 결정을 다시 확인한다. 기존 업무 쓰기를 멈추고 필요한 보호 backup을 확인한 뒤 격리된 migration과 실제 시작 확인을 수행하며, 모두 준비된 뒤에만 새 release를 적용한다. 사람에게는 보이지 않는다. (apps/releases#R12, apps/releases#R13, apps/releases#R14, apps/data#R4, apps/data#R5, apps/data#R6, apps/runtime#R1, apps/runtime#R2)
9. coding agent의 완료 보고를 받은 machine이 같은 release의 acceptance check를 조건별로 확인한다. 보고 접수·실제 통과·운영 적용·미실행을 각각 남기며 시작 성공을 업무 정확성으로 대신하지 않는다. 사람에게는 보이지 않는다. (coding-agent/tickets#R17, coding-agent/tickets#R18, coding-agent/tickets#R19, apps/runtime#R3, apps/data#R14)
10. app-detail 화면 사람이 실제 적용 결과와 맡긴 확인 결과, 남은 행동을 구별해서 보고 app-space 화면에서 변경된 앱을 쓴다. 안쪽 처리와 식별자를 기본 안내로 내보내지 않으며, 준비만 된 변경을 운영 앱에 적용됐다고 표시하지 않는다. (platform/approvals#R9, apps/runtime#R13, coding-agent/tickets#R19, shell/wording#R1, shell/wording#R2, shell/wording#R8)

## 다른 갈래

- 1·3에서 의도나 acceptance check의 답이 없으면 해당 ticket을 보류한다. 미루기·무응답·창 닫기를 채택이나 activation 승인으로 보지 않는다. (lophn-agent/roles/app-engineer#R8, lophn-agent/questions#R8, platform/approvals#R4)
- 채택 뒤 목표를 바꾸려면 사람이 기존 ticket을 취소하고 이전 ticket을 근거로 새 ticket을 만든다. 이미 남은 파일·보고·test result를 삭제하거나 외부 coding agent가 멈췄다고 표시하지 않는다. (coding-agent/tickets#R6, coding-agent/tickets#R22, coding-agent/tickets#R23)
- 새 SDK가 목적이면 담당 앱 변경을 설계와 ticket으로 내리되 SDK 자체 수정이나 전체 앱의 적용 순서를 App Engineer에게 맡기지 않는다. 설치 update만으로 운영 앱의 SDK가 바뀌지 않는다. (lophn-agent/roles/app-engineer#R19, apps/sdk#R11)
- 연결 회수·claim 만료면 해당 credential과 낡은 claim의 쓰기·release 준비·완료 보고를 거절한다. 남은 결과를 보존하고 사람이 다시 맡긴 뒤 이어 간다. (coding-agent/connection#R8, coding-agent/connection#R9, coding-agent/tickets#R11, coding-agent/tickets#R13, coding-agent/tickets#R14)
- 테스트 실패·timeout·미실행이면 app-detail 화면에서 그 결과와 다음 행동을 본다. 같은 bundle의 app test 통과 없이 release를 준비하지 않고 기존 운영 앱은 바뀌지 않는다. (problems/tests#R4, problems/tests#R5, apps/releases#R5, apps/releases#R8)
- 7에서 보류하면 승인 없이 기존 앱을 유지한다. 거절·취소·만료는 변경 미실행이며, 확인 중 대상·입력이 바뀌면 옛 결정으로 적용하지 않는다. (platform/approvals#R4, platform/approvals#R5, platform/approvals#R11, platform/approvals#R15)
- migration 또는 새 업무 쓰기 전 시작이 실패하면 backup을 복원하고 무결성과 schema를 확인한 뒤에만 이전 앱을 다시 시작한다. app-detail 화면에서 실패와 실제 복구 결과·다음 행동을 보며, 복구 시도만으로 사용 가능을 표시하지 않는다. (apps/releases#R15, apps/data#R7, apps/data#R11, apps/runtime#R2, apps/runtime#R13)
- 새 앱이 업무를 받은 뒤 문제를 발견하면 옛 backup을 자동으로 덮어쓰지 않는다. 이전 release 선택도 데이터와 외부 효과의 취소가 아니다. (apps/data#R12, apps/releases#R16)
- 화면을 닫거나 대화 연결이 끊겨도 요청·결정은 남는다. conversation 화면에서 다시 열어 이어 가며 실패·멈춤 뒤 다음 요청을 자동 시작하지 않는다. (lophn-agent/conversation#R2, lophn-agent/conversation#R6, lophn-agent/questions#R10)

## 끝

사람은 무엇이 달라졌는지와 실제 적용·ticket 확인·남은 업무 확인을 구별한다. 보류·거절·실패이면 기존 앱 또는 확인된 복구 결과를 보고, 새 구현 준비만으로 쓰던 동작과 데이터가 몰래 바뀌지 않는다. (apps/releases#R8, apps/releases#R14, apps/data#R12, coding-agent/tickets#R19, platform/approvals#R9)
