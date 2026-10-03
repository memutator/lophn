---
type: flow
concerns: [coding-agent/tickets, coding-agent/connection, coding-agent/mcp-server, coding-agent/cli, coding-agent/repair-context, lophn-agent/roles/app-engineer, documents/versions, problems/tests, apps/releases, platform/notifications, shell/desktop]
screens: [app-detail, conversation]
---
# 맡길 일을 고르고 멈춘 작업을 다시 맡긴다

사람이 앱 구현·수리 일을 만들거나 취소하거나 버려진 세션의 작업을 다시 맡기려 할 때 시작한다. 사람은 원하는 결과와 담당을 고르며, 검사 계약·claim 기한·낡은 제출 차단은 lophn이 처리한다.

## 흐름

1. **[screen: app-detail]**에서 사람은 열린 문제 하나의 수리를 요청한다. 채택된 기획·설계의 고정 판과 채택 답, 고정 reproduction 기준이 갖춰졌으면 lophn이 기존 자료에서 제목·무엇과 왜·근거·acceptance check를 준비해 같은 생성 검사를 거친 repair ticket을 만들며 사람에게 작성 양식을 채우게 하지 않는다. 새 구현 요청이나 근거가 부족한 수리는 **[screen: conversation]**의 담당 App Engineer에게 이어 준다. App Engineer도 채택된 고정 근거와 실행 가능한 조건이 갖춰졌을 때만 ticket을 만든다. lophn이 필수 입력과 같은 문제의 열린 repair ticket 중복을 검사하는 과정은 사람에게는 보이지 않는다. 원할 때 전체 고정 근거를 읽을 수 있다. (coding-agent/tickets#R1, coding-agent/tickets#R2, coding-agent/tickets#R3, coding-agent/tickets#R4, coding-agent/tickets#R5, coding-agent/tickets#R7, coding-agent/tickets#R8, coding-agent/tickets#R9, coding-agent/tickets#R26, documents/versions#R14, lophn-agent/roles/app-engineer#R17)
2. **[screen: app-detail]**에서 사람은 맡길 일을 보고 자신이 직접 연 coding agent에게 특정 ticket을 시킨다. 필요한 복사 문장과 고정 자료를 사용하며 이미 허용된 연결 범위를 넘지 않는다. 열린 ticket을 발견했거나 수리 요청 표시가 있다는 이유만으로 자동 처리하거나 외부 세션을 시작하지 않는다. (coding-agent/tickets#R11, coding-agent/tickets#R24, coding-agent/connection#R1, coding-agent/connection#R5)
3. coding agent는 MCP 또는 CLI로 현재 ticket·작업 가능 여부를 확인하고 지시받은 ticket을 claim한다. 범위 안에서 필요한 고정 자료만 단계적으로 읽고 수리에는 작은 repair context를 사용한다. lophn이 현재 담당과 claim 기한을 확인하는 과정은 사람에게는 보이지 않는다. 담당 연결이 있다는 사실을 테스트나 앱 동작이 실제 시작됐다는 증거로 쓰지 않는다. (coding-agent/mcp-server#R10, coding-agent/mcp-server#R26, coding-agent/mcp-server#R27, coding-agent/cli#R1, coding-agent/cli#R36, coding-agent/tickets#R11, coding-agent/tickets#R12, coding-agent/repair-context#R11, coding-agent/repair-context#R20, problems/tests#R1)
4. 세션이 버려져 claim이 만료되거나 연결이 회수되면 lophn은 claim을 놓고 ticket을 다시 열린 상태로 둔다. 자료 읽기만으로 기한을 늘리거나 단순 무호출을 만료로 추정하지 않는다. 정리 과정은 사람에게는 보이지 않는다. claim 해제 자체는 notification을 만들지 않는다. (coding-agent/tickets#R12, coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/connection#R8, platform/notifications#R2)
5. **[screen: app-detail]**에서 사람은 다시 맡길 수 있는 일을 다음 coding agent에게 명시적으로 시킨다. 새 담당은 지난 문서·완료 보고·release·수리·실제 테스트를 읽을 수 있다. lophn이 이번 claim을 다시 검사하고 옛 담당의 만료된 claim에 따른 새 완료 보고·release 준비를 거절하는 과정은 사람에게는 보이지 않는다. (coding-agent/tickets#R11, coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/tickets#R15, apps/releases#R6, coding-agent/repair-context#R3)
6. coding agent가 결과를 보고하면 lophn은 완료 주장과 실제 acceptance check를 따로 남겨 조건별 통과·실패·미확인·이유를 비교한다. 비교 과정은 사람에게는 보이지 않는다. **[screen: app-detail]**에서 사람은 지금 결과·남은 확인과 다음 행동을 보고 실제 근거를 원할 때 펼친다. 운영 적용의 승인이나 문제 닫힘이 남았으면 그것을 완료 주장으로 채우지 않는다. (coding-agent/tickets#R17, coding-agent/tickets#R18, coding-agent/tickets#R19, coding-agent/tickets#R21, coding-agent/mcp-server#R28, coding-agent/cli#R36, problems/tests#R5, apps/releases#R8)

## 다른 갈래

- 1에서 범위·사용 동작·acceptance check에 필요한 답이 없으면 App Engineer는 관련 ticket 작성을 보류한다. 요구를 자동 보충하거나 실제 고정 판과 다른 채택 답으로 ticket을 만들지 않는다. (lophn-agent/roles/app-engineer#R8, coding-agent/tickets#R3, coding-agent/tickets#R9)
- 사람은 **[screen: app-detail]**에서 종료 전 ticket을 한 줄 사유와 함께 취소한다. lophn이 옛 claim 갱신·새 release 준비·완료 보고를 막는 과정은 사람에게는 보이지 않는다. 이미 남은 결과와 문제는 유지하며 외부 파일 편집이나 프로세스 종료까지 보장하지 않는다. (coding-agent/tickets#R22, coding-agent/tickets#R23, coding-agent/connection#R18)
- 맡길 내용 자체를 바꾸려면 기존 ticket을 취소하고 이전 ticket을 근거로 새 ticket을 만든다. 진행 중 목표·조건을 덮어쓰지 않는다. (coding-agent/tickets#R6)
- 3~6에서 연결이 끊기거나 응답 뒤 결과를 확인하지 못하면 최신 확인 못함과 마지막 화면을 유지하고 현재 ticket·release를 조회한다. 낡은 결과를 현재 담당 결과로 붙이거나 곧바로 재실행하지 않는다. (shell/desktop#R7, coding-agent/cli#R5, coding-agent/tickets#R15)
- 6에서 실제 실패가 있으면 확인 실패로, 미실행·승인·운영 확인만 남으면 남은 이유와 조건으로 구별한다. notification은 확인 완료·검사 실패에만 생기며 ticket 생성·claim·완료 보고·취소마다 만들지 않는다. (coding-agent/tickets#R18, coding-agent/tickets#R19, platform/notifications#R1, platform/notifications#R2)
- lophn 재시작 뒤에는 누락된 검사를 잇고 실제 테스트·문제 재발·release 교체로 조건이 달라지면 다시 비교한다. machine의 검사 진행은 사람에게는 보이지 않는다. (coding-agent/tickets#R20)

## 끝

사람은 **[screen: app-detail]**에서 누구에게 맡겼는지, 다시 맡길 수 있는지, 취소가 접수됐는지, 실제로 확인된 결과와 남은 일을 안다. 버려진 세션이 일을 계속 붙잡거나 완료 주장만으로 확인됨이 되지 않는다. (coding-agent/tickets#R14, coding-agent/tickets#R18, coding-agent/tickets#R19, coding-agent/tickets#R23)
