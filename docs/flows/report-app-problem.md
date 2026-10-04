---
type: flow
concerns: [shell/app-frame, shell/desktop, shell/workspace, apps/runtime, problems/feedback, problems/reporting, problems/snapshots, problems/grouping, platform/redaction, platform/responsiveness, platform/notifications]
---
# 깨진 앱 화면에서도 문제를 알린다

사람이 앱의 기대와 다른 결과를 보았거나 앱 화면이 멈췄을 때 시작한다. 사람이 이상한 점만 설명하면 lophn이 안전한 당시 근거를 붙여 남기며, 고장 난 앱 때문에 다른 일을 멈추지 않는다.

## 흐름

1. app-space 화면 또는 app-panel 화면에서 사람이 shell의 문제 알리기를 누른다. 앱 view가 깨지거나 멈춰도 버튼은 동작하고 실제로 보던 앱·release에 묶인다. 명세가 없거나 호출 응답이 성공이어도 기대와 다른 결과를 알릴 수 있다. (shell/app-frame#R31, shell/app-frame#R32, shell/app-frame#R34, problems/feedback#R2)
2. lophn은 dialog를 열기 전에 그 버튼의 app view만 캡처하고 안전한 화면 상태와 허용된 최근 근거를 준비한다. 보호 화면·다른 창·가려진 view와 업무 DB·입력 원문은 자동 수집하지 않는다. 실제 연결을 모르는 호출이나 확보하지 못한 증거는 만들지 않고 없는 이유를 남긴다. 수집 과정은 사람에게는 보이지 않는다. (problems/feedback#R5, problems/feedback#R7, problems/snapshots#R4, problems/snapshots#R6, problems/snapshots#R8, problems/snapshots#R9, problems/snapshots#R12)
3. report-problem 화면에서 사람은 무엇이 이상한지만 쓴다. 같은 앱의 기존 문제에 덧붙이고 싶으면 그 문제를 명시적으로 선택한다. lophn이 저장·표시 전에 redaction하는 과정은 사람에게는 보이지 않는다. 첨부는 제출 전 미리보기에서 각각 제외할 수 있고 screenshot은 가리지 않으며 사람이 확인해 선택한 경우만 저장한다. 글과 첨부를 secret 입력 통로로 쓰지 않는다. (problems/feedback#R1, problems/feedback#R6, problems/feedback#R13, platform/redaction#R3, platform/redaction#R14)
4. report-problem 화면에서 사람이 제출한다. lophn은 글·선택한 안전한 첨부·누락 이유를 당시 snapshot으로 고정하고 report·snapshot·problem 변경을 함께 확정한다. 사람이 고른 기존 문제가 있으면 연결하고 없으면 별도 문제를 만든다. 비슷한 글·증상을 같은 원인의 증거로 취급하지 않는다. 고정·묶기 과정은 사람에게는 보이지 않는다. (problems/feedback#R10, problems/reporting#R2, problems/reporting#R10, problems/snapshots#R1, problems/snapshots#R5, problems/grouping#R5, problems/grouping#R6)
5. report-problem 화면에서 사람은 접수 완료와 연결된 문제·다음 행동을 확인한다. 접수 대기와 영구 접수 완료를 구별하고 앱 호출을 다시 실행하지 않는다. 새 운영 문제가 열리면 정해진 notification만 생기며 notification을 읽는 것은 문제 닫힘이나 승인으로 쓰이지 않는다. (problems/feedback#R11, problems/feedback#R13, problems/reporting#R13, platform/notifications#R1, platform/notifications#R2, platform/notifications#R6)
6. 사람은 app-space 화면 또는 app-panel 화면로 돌아가거나 원래 열었던 다른 앱·문서를 계속 쓴다. 캡처·보고 수집·앱의 무한 loop나 crash가 다른 shell 화면을 막지 않는다. (shell/app-frame#R21, shell/app-frame#R27, platform/responsiveness#R2, platform/responsiveness#R5)

## 다른 갈래

- 2~3에서 화면이 없거나 수집을 껐거나 수집에 실패하면 그 이유를 구별하고 첨부 없이 글만 보낼 수 있다. 사람이 고르지 않은 screenshot은 저장하지 않는다. (problems/feedback#R10, problems/snapshots#R5, platform/redaction#R14)
- 3에서 입력 검사 때문에 command가 시작되지 않은 이상도 알릴 수 있다. 시작 전 실패로 남기고 존재하지 않는 invocation을 만들지 않는다. (problems/feedback#R4)
- 3~4에서 사람이 취소하면 미제출 자료를 저장하지 않는다. 이미 접수한 feedback은 화면을 닫아도 삭제하지 않는다. 초안은 메모리에만 있으며 지속 저장됐다고 보이지 않는다. (problems/feedback#R11, problems/feedback#R12)
- 4~5에서 접수가 실패하면 복사 가능한 글과 실패 이유를 유지한다. 일부 증거만 빠진 경우와 작은 보고도 저장하지 못한 접수 실패를 구별한다. 응답 단절로 접수가 확인되지 않으면 최신 상태를 확인하고 같은 발생의 재전송 규칙을 지키며 앱의 업무 command를 다시 부르지 않는다. (problems/feedback#R11, problems/snapshots#R5, problems/reporting#R9, problems/reporting#R13, shell/desktop#R7, shell/desktop#R8)
- 이미 직접 조치했지만 여전히 이상하면 새 feedback으로 남긴다. 이 제출은 무시·오탐 결정이나 고쳐짐 확인을 대신하지 않는다. (problems/feedback#R14)

## 끝

사람은 report-problem 화면에서 이상이 실제로 접수됐는지와 다음 행동을 알고 다른 일을 계속할 수 있다. 보고 접수는 원인 확인이나 수리 완료가 아니다. (problems/feedback#R11, problems/feedback#R13, problems/grouping#R5, platform/responsiveness#R5)
