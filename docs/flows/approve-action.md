---
type: flow
concerns: [platform/approvals, platform/identity, platform/secrets, lophn-agent/harness/tool-judgment, lophn-agent/harness/waiting-and-recovery, apps/invocations, apps/permissions, shell/confirmation-window, shell/app-frame, shell/desktop]
---
# 중요한 일을 정확한 내용으로 승인하거나 거절한다

release 적용·권한 변경·되돌릴 수 없는 tool 또는 confirm command에 사람 결정이 필요할 때 시작한다. 사람은 무엇이 바뀌고 어떤 영향이 남는지만 보고 결정하며 승인 근거와 일회 적용 검사는 lophn이 처리한다.

## 흐름

1. lophn은 요청자·동작·정확한 대상·전체 입력·현재 비교 기준을 고정하고 필요한 approval request를 만든다. tool 판정에서 금지된 일은 승인으로 열지 않으며 결정 전에는 해당 동작을 시작하지 않는다. 요청 고정과 판정 과정은 사람에게는 보이지 않는다. (platform/approvals#R1, platform/approvals#R5, platform/approvals#R6, lophn-agent/harness/tool-judgment#R1, lophn-agent/harness/tool-judgment#R2)
2. things-to-confirm 화면에서 사람은 기다리는 결정과 다음 행동을 찾고 정확한 요청의 확인을 연다. 미리보기·notification을 보거나 읽는 것만으로 결정되지 않는다. confirmation-window 화면는 요청한 창의 child modal BrowserWindow이며 그 창의 앱 view는 숨기지 않고 입력만 막는다. (shell/desktop#R9, shell/desktop#R47, shell/confirmation-window#R2, shell/confirmation-window#R6, shell/app-frame#R30, platform/approvals#R4)
3. confirmation-window 화면에서 사람은 정확한 대상·변경·영향·위험·되돌릴 수 있는 범위와 남는 영향을 읽는다. 결정에 필요한 요청자·이유·근거·입력 상세도 확인할 수 있고 permission이라면 정확한 경로·host·secret 사용 범위를 본다. 창은 독립적으로 현재 요청을 다시 읽어 일치 확인 전에는 제출을 막는다. 재조회·일회 handle 준비 과정은 사람에게는 보이지 않는다. (platform/approvals#R1, platform/approvals#R2, shell/confirmation-window#R2, shell/confirmation-window#R5, shell/confirmation-window#R8, apps/permissions#R1, apps/permissions#R8, platform/identity#R14)
4. confirmation-window 화면에서 사람이 허락 또는 거절을 명시적으로 제출하거나 대기 요청을 취소한다. 거절에는 이유가 필수가 아니다. 기본 선택·Enter 즉시 제출·무응답·창 닫기·앱 화면의 동의·agent 문장·일반 question 답은 승인 증거가 아니다. 창 닫기만으로 request 취소가 접수됐다고 하지 않는다. (platform/approvals#R3, platform/approvals#R4, platform/approvals#R13, platform/approvals#R14, shell/confirmation-window#R1, shell/confirmation-window#R4, shell/confirmation-window#R9, lophn-agent/harness/tool-judgment#R7)
5. lophn은 해당 보호 화면의 일회 handle과 현재 권한·대상·입력·비교 기준·원래 일의 유효성을 검사하고 사람이 본 그 동작에만 허락을 한 번 쓴다. confirm command는 정확한 release·command·입력의 실행 직전 접수와 함께 사용하며 접수와 실제 시작을 구별한다. 재검사·handle 사용 과정은 사람에게는 보이지 않는다. (shell/confirmation-window#R9, platform/approvals#R5, platform/approvals#R7, platform/approvals#R8, platform/approvals#R11, apps/invocations#R7, apps/invocations#R8, apps/invocations#R9, lophn-agent/harness/waiting-and-recovery#R2)
6. things-to-confirm 화면에서 사람은 결정 접수와 실제 적용 성공·실패·결과 모름을 구별해 본다. 허락 저장은 완료가 아니며 결과를 모르면 자동 재실행하지 않는다. 거절한 같은 일을 retry·handoff·다른 통로로 우회하지 않는다. (platform/approvals#R9, platform/approvals#R16, shell/desktop#R9, apps/invocations#R10, apps/invocations#R12, lophn-agent/harness/waiting-and-recovery#R5, lophn-agent/harness/waiting-and-recovery#R10, lophn-agent/harness/tool-judgment#R9)

## 다른 갈래

- 1에서 필요한 동작 설명·입력·범위를 확인할 수 없거나 허용 범위를 벗어나면 요청을 실행하지 않는다. approval request로 금지된 권한을 늘리지 않는다. (platform/approvals#R1, lophn-agent/harness/tool-judgment#R2)
- 2~4에서 사람이 창을 닫거나 잠시 답하지 않으면 결정되지 않은 요청을 다시 찾을 수 있다. 명시 기한이 있으면 원래 기한 뒤 허락과 새 사용을 거절하고 침묵을 승인으로 바꾸지 않는다. (platform/approvals#R4, platform/approvals#R12, shell/desktop#R9, shell/confirmation-window#R4)
- 3~5에서 대상 변경·다른 결정·조회 실패가 생기면 옛 행동을 제거하고 최신 내용을 확인하게 한다. 만료·중복·늦은 결정이나 끝난 일의 허락으로 새 동작을 시작하지 않는다. (shell/confirmation-window#R5, platform/approvals#R5, platform/approvals#R7, platform/approvals#R12, platform/approvals#R13, lophn-agent/harness/waiting-and-recovery#R5)
- 4에서 거절·취소·만료하면 그 호출은 미실행으로 남는다. agent는 같은 요청의 거절을 우회하지 않고 남은 일에 대해 새 판단을 할 수 있으나 관련 없는 다른 대기는 유지한다. (platform/approvals#R14, platform/approvals#R15, platform/approvals#R16, lophn-agent/harness/waiting-and-recovery#R2)
- secret 사용은 사람이 앱에 준 정확한 grant가 허락이다. 호출 주체나 호출마다 secret 승인을 추가하지 않는다. secret 값 입력이 필요하면 confirmation-window 화면의 전용 보호 입력으로 받고 값은 agent·앱 코드에 주지 않으며 플랫폼이 허용된 전송 직전에 붙인다. (apps/permissions#R14, apps/permissions#R15, platform/secrets#R2, platform/secrets#R4, platform/secrets#R5, shell/confirmation-window#R6)
- permission 변경·회수는 새 호출 차단과 이전 프로세스 종료 확인·새 범위 재시작의 실제 결과를 구별한다. 결정 접수만으로 실제 회수 완료나 이미 일어난 외부 효과 취소를 표시하지 않는다. (apps/permissions#R20, apps/permissions#R21, apps/permissions#R22)
- 5~6에서 연결 단절·재시작이 생기면 실제 결정과 미시작 근거를 확인한 뒤 유효한 미반영 결정만 한 번 적용한다. 시작 또는 결과를 확인할 수 없으면 결과 모름으로 남고 쓰기·외부 효과를 자동 반복하지 않는다. (shell/desktop#R7, apps/invocations#R10, apps/invocations#R12, lophn-agent/harness/waiting-and-recovery#R10, lophn-agent/harness/waiting-and-recovery#R11)

## 끝

사람은 things-to-confirm 화면에서 자신이 어떤 결정을 했고 정확히 무엇이 적용됐는지 또는 아직 확인되지 않았는지 안다. 거절·취소·만료한 일은 미실행이며 승인 접수와 실제 성공은 다른 사실로 남는다. (platform/approvals#R9, platform/approvals#R15, shell/desktop#R9)
