---
type: flow
concerns: [platform/install-and-update, platform/responsiveness, platform/backup-and-migration, documents/versions, documents/outline-and-search, shell/workspace, shell/editor, shell/app-frame, shell/desktop, shell/wording, apps/runtime, apps/sdk, apps/invocations, apps/automations, lophn-agent/harness/provider, lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery, coding-agent/connection]
---
# 인터넷이 끊겨도 하던 로컬 일을 계속한다

외부 연결이 끊기거나 provider·외부 서비스가 응답하지 않을 때 시작한다. 사람은 로컬 자료와 외부 연결이 필요 없는 앱을 계속 쓰고, 연결이 필요한 일만 별도로 다룬다.

지키는 약속: platform#I1, platform#I5, apps#I6, lophn-agent/harness#I1, lophn-agent/harness#I2.

## 흐름

1. **launcher 화면 project-workspace 화면 document 화면 app-space 화면** 사람은 이미 설치된 문서와 고정 이력, 외부 연결이 필요 없는 앱을 계속 연다. 프로젝트에서는 읽던 탭과 위치를 이어 쓰고, 문서 저장·판 확정·검색 반영을 서로 다른 결과로 확인한다. (documents/versions#R8, documents/versions#R17, documents/outline-and-search#R15, shell/workspace#R6, shell/editor#R2, apps/runtime#R21)
2. lophn이 동봉한 runtime·고정 의존성과 앱의 pinned SDK만 사용해 로컬 동작을 제공한다. 플랫폼 시작·앱 시작·패키지 MCP 연결에 다운로드를 요구하지 않는다. 사람에게는 보이지 않는다. (platform/install-and-update#R4, apps/runtime#R23, apps/sdk#R10, coding-agent/connection#R16)
3. **project-workspace 화면 document 화면 app-space 화면** 외부 연결이 필요한 동작만 연결 실패·기다림·결과 모름을 구별해 안내한다. 마지막 확인 내용을 유지하고 지금 필요한 다음 행동만 보여 주며, 한 앱이나 오래 걸리는 model 요청 때문에 무관한 로컬 문서와 앱을 멈추지 않는다. (apps/runtime#R12, shell/desktop#R7, lophn-agent/harness/waiting-and-recovery#R6, platform/responsiveness#R1, platform/responsiveness#R5, shell/wording#R10)
4. harness가 일시적인 provider 통신 실패만 정해진 횟수와 대기 안에서 retry하고, 불완전한 model 응답의 tool call은 시작하지 않는다. 다른 provider나 model로 몰래 바꾸지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/provider#R10, lophn-agent/harness/provider#R20, lophn-agent/harness/run-loop#R11, lophn-agent/harness/run-loop#R23)
5. **project-workspace 화면 app-space 화면** 사람이 지금 필요한 준비나 다시 시도할 행동을 확인한다. 확인된 예정 시각이 있는 기다림과 사람 행동이 필요한 연결 준비를 구별하고, 모르는 대기 시간을 만들어 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R6, shell/wording#R10)
6. 연결이 돌아오면 lophn이 확정 결과와 미완료 상태를 먼저 조회한다. 이미 확인된 call은 반복하지 않고, 결과를 모르는 쓰기·external은 결과 조회나 중복 효과 없음이 확인되기 전 재호출하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R8, lophn-agent/harness/waiting-and-recovery#R9, lophn-agent/harness/waiting-and-recovery#R10, apps/invocations#R12)
7. **project-workspace 화면 document 화면 app-space 화면** 사람은 현재 확인된 결과·아직 끝나지 않은 일·확인 불가를 구별하며 로컬 일을 이어 간다. 재시작까지 있었으면 실제 관측으로 확인한 결과만 표시하고, 검색 재생성 중이라도 고정 판 읽기는 기다리지 않는다. (platform/backup-and-migration#R15, platform/backup-and-migration#R16, documents/outline-and-search#R14, documents/outline-and-search#R15, apps/invocations#R10)

## 다른 갈래

- 연결 실패가 아니라 credential 사용 불가나 model 사용 불가이면 그 실패를 구별한다. 같은 provider의 다른 credential(provider에는 하나뿐이다)이나 다른 provider·model을 자동으로 선택하지 않는다. 필요한 설정 준비는 별도의 설정 flow로 이어 간다. (lophn-agent/harness/provider#R10, lophn-agent/harness/provider#R19, lophn-agent/harness/provider#R24)
- 앱의 쓰기 요청 뒤 연결이 끊기면 app-space 화면 결과 모름을 표시한다. timeout이나 중단을 외부 효과 없음으로 바꾸지 않으며, 사람에게 재시도를 권하기 전에 원래 결과를 확인한다. (apps/runtime#R12, apps/invocations#R11, apps/invocations#R12)
- 사람이 run을 멈췄으면 연결 회복이나 재시작만으로 다시 돌리지 않는다. 비사용자 중단만 저장된 경계에서 현재 권한·credential·한도를 다시 검사해 복구한다. 사람에게는 보이지 않는다. (lophn-agent/harness/run-loop#R17, lophn-agent/harness/waiting-and-recovery#R9)
- 앱 중단·절전 중 놓친 automation 회차는 몰아서 실행하지 않는다. 돌아온 뒤 가까운 미래 간격부터 이어 가며, 결과 미확인도 재실행의 근거로 삼지 않는다. 사람에게는 보이지 않는다. (apps/automations#R7, apps/automations#R11)
- 문서를 고친 뒤 저장 실패나 충돌이 생기면 document 화면 저장과 판 확정 결과를 구별한다. 연결 단절이나 확인 못한 접수를 저장 성공으로 표시하지 않는다. (shell/editor#R2, shell/editor#R12, documents/versions#R4, documents/versions#R5)

## 끝

외부 연결 없이 할 수 있는 로컬 일은 계속되고, 외부 연결이 필요한 일만 기다림·실패·확인 불가로 남는다. 연결 회복 뒤에는 확인된 경계부터 이어 가며, 미확인 외부 효과와 놓친 automation을 다시 실행하지 않는다. (apps/runtime#R21, lophn-agent/harness/waiting-and-recovery#R10, apps/automations#R7)
