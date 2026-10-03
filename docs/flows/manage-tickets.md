---
type: flow
concerns: [coding-agent/tickets, coding-agent/connection, coding-agent/mcp-server, coding-agent/cli, coding-agent/repair-context, lophn-agent/roles/app-engineer, documents/versions, problems/tests, apps/releases, platform/notifications, shell/desktop, lophn-agent/roles/lophn, coding-agent/sessions, coding-agent/harnesses, shell/terminal]
---
# 맡길 일을 고르고 멈춘 작업을 다시 맡긴다

사람이 앱 구현·수리 일을 만들거나 취소하거나 버려진 세션의 작업을 다시 맡기려 할 때 시작한다. 사람은 원하는 결과와 담당을 고르며, 검사 계약·claim 기한·낡은 제출 차단은 lophn이 처리한다.

## 흐름

1. 사람은 구현·수리의 원하는 결과나 피드백만 말한다. lophn 또는 담당 App Engineer가 모든 coding 요청을 ticket으로 정리하고 같은 앱·수리 중복·고정 채택 판·실제 acceptance check를 검사한다. 사람에게 작성 양식을 채우게 하지 않고 ticket 생성은 묻지 않는다. 접수는 실행 준비와 별개라 근거가 부족하면 질문으로 필요한 결정을 받고 가짜 채택·빈 조건으로 채우지 않으며 Start·claim을 열지 않는다. 준비 과정은 사람에게는 보이지 않는다. (coding-agent/tickets#R1, coding-agent/tickets#R2, coding-agent/tickets#R3, coding-agent/tickets#R4, coding-agent/tickets#R5, lophn-agent/roles/app-engineer#R17)
2. 사람은 준비된 ticket에서 [Start]로 선택 harness의 project 터미널 TUI를 열거나 자기 터미널에서 직접 시작해 ticket을 지정한다. ticket이 있다는 이유만으로 자동 시작하지 않는다. exact 클릭·scope·폴더 검증과 첫 prompt 1회 전달은 start-coding-agent flow를 따른다. (coding-agent/sessions#R1, coding-agent/sessions#R2, coding-agent/sessions#R3, coding-agent/sessions#R5, shell/terminal#R12)
3. coding agent는 지정 ticket의 현재 준비·범위·담당 여부를 확인한 뒤 MCP로 claim하고 고정 자료를 읽어 작업·보고한다. repair context는 필요한 만큼 읽는다. CLI 조회와 MCP claim을 섞지 않으며 session ready/working이 claim 생성·갱신·완료를 대신하지 않는다. 검사는 사람에게는 보이지 않는다. (coding-agent/tickets#R11, coding-agent/tickets#R12, coding-agent/sessions#R9, coding-agent/repair-context#R11)
4. 세션이 버려져 claim이 만료되거나 연결이 회수되면 lophn은 claim을 놓고 ticket을 다시 열린 상태로 둔다. 자료 읽기만으로 기한을 늘리거나 단순 무호출을 만료로 추정하지 않는다. 정리 과정은 사람에게는 보이지 않는다. claim 해제 자체는 notification을 만들지 않는다. (coding-agent/tickets#R12, coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/connection#R8, platform/notifications#R2)
5. app-detail 화면에서 사람은 다시 맡길 수 있는 일을 다음 coding agent에 명시하거나 [Start]로 새 TUI를 연다. 기존 process·prompt 결과가 모르면 자동 재시작하지 않는다. 새 담당은 지난 문서·완료 보고·release·수리·실제 테스트를 읽을 수 있다. lophn이 이번 claim을 다시 검사하고 옛 담당의 만료된 claim에 따른 새 완료 보고·release 준비를 거절하는 과정은 사람에게는 보이지 않는다. (coding-agent/tickets#R11, coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/tickets#R15, apps/releases#R6, coding-agent/repair-context#R3)
6. coding agent가 결과를 보고하면 lophn은 완료 주장과 실제 acceptance check를 따로 남겨 조건별 통과·실패·미확인·이유를 비교한다. 비교 과정은 사람에게는 보이지 않는다. app-detail 화면에서 사람은 지금 결과·남은 확인과 다음 행동을 보고 실제 근거를 원할 때 펼친다. 운영 적용의 승인이나 문제 닫힘이 남았으면 그것을 완료 주장으로 채우지 않는다. (coding-agent/tickets#R17, coding-agent/tickets#R18, coding-agent/tickets#R19, coding-agent/tickets#R21, coding-agent/mcp-server#R28, coding-agent/cli#R36, problems/tests#R5, apps/releases#R8)

## 다른 갈래

- 1에서 범위·사용 동작·acceptance check에 필요한 답이 없으면 App Engineer는 실행 준비를 보류하고 필요한 결정을 질문한다. 요청 접수는 실행 준비와 별개이며 가짜 채택·빈 조건·없는 reproduction을 보충하지 않는다. reproduction test를 만들 수 없는 수리는 사람의 확인을 acceptance check로 받는다. (lophn-agent/roles/app-engineer#R8, coding-agent/tickets#R3, coding-agent/tickets#R9)
- 사람은 app-detail 화면에서 종료 전 ticket을 한 줄 사유와 함께 취소한다. lophn이 옛 claim 갱신·새 release 준비·완료 보고를 막는 과정은 사람에게는 보이지 않는다. 이미 남은 결과와 문제는 유지하며 외부 파일 편집이나 프로세스 종료까지 보장하지 않는다. (coding-agent/tickets#R22, coding-agent/tickets#R23, coding-agent/connection#R18)
- 맡길 내용 자체를 바꾸려면 기존 ticket을 취소하고 이전 ticket을 근거로 새 ticket을 만든다. 진행 중 목표·조건을 덮어쓰지 않는다. (coding-agent/tickets#R6)
- 3~6에서 연결이 끊기거나 응답 뒤 결과를 확인하지 못하면 최신 확인 못함과 마지막 화면을 유지하고 현재 ticket·release를 조회한다. 낡은 결과를 현재 담당 결과로 붙이거나 곧바로 재실행하지 않는다. (shell/desktop#R7, coding-agent/cli#R5, coding-agent/tickets#R15)
- 6에서 실제 실패가 있으면 확인 실패로, 미실행·승인·운영 확인만 남으면 남은 이유와 조건으로 구별한다. notification은 확인 완료·검사 실패에만 생기며 ticket 생성·claim·완료 보고·취소마다 만들지 않는다. (coding-agent/tickets#R18, coding-agent/tickets#R19, platform/notifications#R1, platform/notifications#R2)
- lophn 재시작 뒤에는 누락된 검사를 잇고 실제 테스트·문제 재발·release 교체로 조건이 달라지면 다시 비교한다. machine의 검사 진행은 사람에게는 보이지 않는다. (coding-agent/tickets#R20)

## 끝

사람은 app-detail 화면에서 누구에게 맡겼는지, 다시 맡길 수 있는지, 취소가 접수됐는지, 실제로 확인된 결과와 남은 일을 안다. 버려진 세션이 일을 계속 붙잡거나 완료 주장만으로 확인됨이 되지 않는다. (coding-agent/tickets#R14, coding-agent/tickets#R18, coding-agent/tickets#R19, coding-agent/tickets#R23)
