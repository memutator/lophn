---
type: flow
concerns: [problems/problem-codes, problems/reporting, problems/snapshots, problems/grouping, platform/redaction, platform/notifications, lophn-agent/roles/app-engineer, lophn-agent/questions, coding-agent/tickets, coding-agent/repair-context, coding-agent/connection, problems/tests, problems/repairs, apps/releases, apps/data, problems/closing, platform/approvals, shell/confirmation-window, lophn-agent/presets, coding-agent/harnesses, coding-agent/sessions, shell/terminal]
---
# 앱 이상을 확인하고 수리를 맡긴다

앱의 선언된 오류나 처리되지 않은 exception을 lophn이 먼저 수집했을 때 시작한다. 사람은 증상과 다음 행동을 보고 수리를 맡기며 실제 고침이 확인됐는지 안다.

## 흐름

1. 가계부 앱이 은행 파일을 읽지 못하는 등 선언한 실패를 보고하거나 lophn이 앱 process·view의 처리되지 않은 exception을 수집한다. 당시 release·출처와 snapshot을 고정하고 확보하지 못한 증거는 없는 이유를 남긴다. 자동 수집은 허용 범위에 한정하며 화면 증거는 사람이 선택한 안전한 자료만 남긴다. 수집 과정은 사람에게는 보이지 않는다. (problems/problem-codes#R2, problems/reporting#R1, problems/reporting#R2, problems/reporting#R5, problems/snapshots#R1, problems/snapshots#R4, problems/snapshots#R6, problems/snapshots#R15)
2. lophn은 저장·표시·agent 전달 전에 redaction하고 불확실한 원문을 제외한다. 같은 발생의 재전송은 중복 접수하지 않고 과다 보고를 제한하되 이미 남은 발생을 지우지 않는다. 같은 분류를 problem 하나로 묶는 과정은 사람에게는 보이지 않는다. 같은 분류를 같은 원인의 증명으로 쓰지 않는다. (platform/redaction#R5, platform/redaction#R14, problems/reporting#R9, problems/reporting#R11, problems/reporting#R12, problems/grouping#R1, problems/grouping#R2, problems/grouping#R5)
3. app-detail 화면 사람은 문제 열림 notification에서 앱의 증상·진행·다음 행동을 보고 봐 달라고 요청한다. 반복 report마다 notification을 만들거나 App Engineer를 자동 시작하지 않는다. 당시 증거는 원할 때 펼쳐 본다. (platform/notifications#R1, platform/notifications#R2, platform/notifications#R3, platform/notifications#R7, problems/grouping#R11, problems/grouping#R12, lophn-agent/roles/app-engineer#R1)
4. App Engineer는 당시 snapshot·설계·release·실제 테스트를 비교해 사실과 원인 가설을 구별한 해석 문서를 고정하고 problem에 연결한다. 확인할 수 있는 사실은 다시 묻지 않는다. 코드로 고칠 같은 원인 가설과 해결 조건이 모이고, 사람이 채택한 기획·설계의 고정 판과 그 판의 채택 답, app test·각 문제의 고정 reproduction test·모든 연결 문제의 닫힘 조건이 갖춰졌을 때만 repair ticket을 만든다. 같은 채택 판을 그대로 쓰면 다시 채택을 묻지 않고, 새 설계 판이 필요하면 conversation 화면에서 사람이 확인한 그 판을 명시적으로 채택한 뒤 만든다. 문제당 열린 repair ticket은 하나다. 근거 비교와 작성 과정은 사람에게는 보이지 않는다. (lophn-agent/roles/app-engineer#R14, lophn-agent/roles/app-engineer#R15, lophn-agent/roles/app-engineer#R16, lophn-agent/questions#R1, lophn-agent/questions#R16, coding-agent/tickets#R3, coding-agent/tickets#R4, coding-agent/tickets#R9)
5. 사람은 가설·다음 행동과 맡길 ticket을 보고 [Start]로 선택 harness를 해당 project 터미널 탭에서 열거나 자기 터미널에 ticket을 명시한다. 첫 prompt는 ticket 읽기·MCP claim·작업·보고를 지시하고 원문 secret은 포함하지 않는다. ticket 생성만으로 자동 시작하지 않고 새 수리의 claim 없는 제출도 허용하지 않는다. (coding-agent/sessions#R1, coding-agent/sessions#R3, coding-agent/sessions#R5, coding-agent/tickets#R11, problems/repairs#R4, problems/repairs#R5)
6. coding agent는 범위 안에서 ticket을 claim하고 작은 repair context로 당시 근거와 지난 수리를 읽는다. ticket에 고정된 reproduction test·입력·기대로 이전 release의 원래 실패와 수리한 묶음의 기대 충족을 검사한다. 생성 뒤 검사 조건을 새 테스트로 바꾸거나 기대를 약화하지 않는다. 격리된 test runner만 실제 결과를 남긴다. 자료 조립·claim 검사·테스트 과정은 사람에게는 보이지 않는다. app-detail 화면에서는 유효한 claim이 있을 때만 고치는 중으로 보인다. (coding-agent/tickets#R6, coding-agent/tickets#R9, coding-agent/tickets#R11, coding-agent/repair-context#R1, coding-agent/repair-context#R3, coding-agent/repair-context#R11, coding-agent/repair-context#R19, problems/tests#R1, problems/tests#R10, problems/tests#R13, problems/tests#R15, problems/grouping#R9)
7. coding agent는 동일 bundle의 app test를 통과한 새 release·수리 기록·완료 보고를 남긴다. lophn의 acceptance check 비교 과정은 사람에게는 보이지 않는다. app-detail 화면에서 사람은 고쳤다는 주장·실제 확인·남은 일을 구별하고 운영 앱을 바꾸려면 변경 내용을 확인한다. 보고 접수와 release 준비는 문제 닫힘이 아니다. (apps/releases#R5, apps/releases#R6, problems/repairs#R1, problems/repairs#R2, problems/repairs#R6, coding-agent/tickets#R17, coding-agent/tickets#R18, problems/tests#R5, apps/releases#R9, problems/closing#R2)
8. confirmation-window 화면 사람은 정확한 새 release의 변경·영향·보존할 데이터·검증 기준을 보고 승인하거나 거절한다. lophn은 결정과 현재 기준을 재검사하고 필요한 데이터 변경 전 backup과 실제 시작 준비 확인을 거쳐 적용한다. backup·비교·시작 확인 과정은 사람에게는 보이지 않는다. 승인 접수와 실제 적용 성공은 구별한다. (apps/releases#R8, apps/releases#R12, apps/releases#R14, apps/data#R4, platform/approvals#R2, platform/approvals#R9, shell/confirmation-window#R1)
9. lophn은 실제 reproduction 통과·그 고친 release의 현재 활성 상태·테스트 요청 기준 뒤 새 운영 보고 없음이 함께 확인될 때만 자동으로 닫는다. 자동 판정 과정은 사람에게는 보이지 않는다. 또는 사람이 confirmation-window 화면에서 현재 문제와 쓰는 release를 보고 고쳐짐을 명시적으로 확인한다. app-detail 화면에서는 닫힌 이유와 지금 필요한 주의를 먼저 보고 확인 범위는 펼친다. agent는 닫지 못한다. (problems/closing#R1, problems/closing#R3, problems/closing#R4, problems/closing#R6, problems/closing#R13)

## 다른 갈래

- 1~2에서 일부 증거 수집·redaction이 실패하면 없는 이유와 안전한 자료만 남긴다. 작은 보고와 snapshot도 저장하지 못하면 접수 실패이며 수집 성공으로 보이지 않는다. (problems/snapshots#R5, platform/redaction#R14, problems/reporting#R10)
- 4에서 근거·채택 답·고정 reproduction이 부족하면 실행 준비를 보류하고 필요한 결정만 질문한다. 요청 접수는 실행 준비와 별개이며 가짜 채택·빈 조건으로 채우지 않는다. reproduction test를 만들 수 없는 코드 수리도 ticket과 claim을 거치고, 닫힘은 보호 화면에서 사람이 “내가 확인함”으로 남긴 확인을 acceptance check로 쓰되 테스트 통과와 구별한다. 코드 수리를 ticket 없는 fallback으로 잇지 않는다. 사람 설정·입력 조치만 필요하면 verify-app-repair의 보호된 사람 확인으로 잇되 가짜 release·채택·검사 조건을 만들지 않는다. (lophn-agent/roles/app-engineer#R8, lophn-agent/roles/app-engineer#R16, lophn-agent/questions#R1, coding-agent/tickets#R3, coding-agent/tickets#R9, problems/repairs#R7, problems/closing#R9)
- 5~7에서 연결 회수·claim 만료가 생기면 옛 작업의 새 제출을 거절하고 다시 맡길 수 있게 한다. 지난 근거는 유지하며 단절을 수리 완료로 보이지 않는다. (coding-agent/connection#R8, coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/tickets#R15)
- 6~7에서 재현 실패·판정 불가·미실행이 있으면 실제 결과와 남은 확인을 구별한다. 보고 경로 삭제나 기대 약화로 통과시켜 닫지 않는다. (problems/tests#R4, problems/tests#R5, problems/tests#R11, problems/closing#R2)
- 8에서 거절·취소·만료하면 적용하지 않는다. 적용 실패는 실패 근거와 이전 활성 참조를 남기고 새 업무 쓰기 전의 복구만 backup으로 처리한다. (platform/approvals#R15, apps/releases#R15, apps/data#R11, apps/data#R12)
- 사람이 작업을 그만두려면 ticket에 사유를 남겨 취소한다. 이후 제출은 막지만 외부 coding agent 프로세스까지 끝났다고 보장하지 않는다. (coding-agent/tickets#R22, coding-agent/tickets#R23)
- 9 뒤 현재 활성 release에서 같은 문제의 운영 보고가 접수되면 같은 문제를 다시 열고 지난 수리·테스트를 이어 본다. 이전 release의 늦은 보고는 남기되 현재 release의 재발로 바꾸지 않는다. (problems/closing#R11, problems/closing#R12, problems/repairs#R3)

## 끝

사람은 app-detail 화면에서 수리가 확인되어 닫힌 이유를 보거나 아직 열린 이유와 다음 행동을 안다. 적용 성공·완료 문장·조용한 기간만으로 고쳐졌다고 보이지 않는다. (problems/grouping#R12, problems/closing#R2, problems/closing#R4, problems/closing#R13)
