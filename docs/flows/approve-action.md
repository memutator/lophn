---
type: flow
concerns: [platform/approvals, platform/identity, platform/secrets, lophn-agent/conversation, lophn-agent/harness/tool-judgment, lophn-agent/harness/waiting-and-recovery, apps/invocations, apps/permissions, shell/confirmation-window, shell/app-frame, shell/desktop, shell/workspace]
---
# 중요한 일을 정확한 내용으로 승인하거나 거절한다

agent의 tool 호출, release 적용, 권한 변경, 되돌릴 수 없는 confirm command에 사람 결정이 필요할 때 시작한다. 사람은 무엇이 바뀌고 어떤 영향이 남는지만 보고 결정하며 승인 근거와 일회 적용 검사는 lophn이 처리한다.

지키는 약속: lophn-agent#I6, platform#I3, shell#I4.

## 흐름

1. lophn은 요청자·동작·정확한 대상·전체 입력·현재 비교 기준을 고정하고 필요한 approval request를 만든다. tool 판정에서 금지된 일은 승인으로 열지 않으며 결정 전에는 해당 동작을 시작하지 않는다. 요청 고정과 판정 과정은 사람에게는 보이지 않는다. (platform/approvals#R1, platform/approvals#R5, platform/approvals#R6, lophn-agent/harness/tool-judgment#R1, lophn-agent/harness/tool-judgment#R2, lophn-agent/harness/tool-judgment#R8)
2. **agent 화면** agent의 tool call 때문에 생긴 request는 composer 바로 위에 붙은 승인 카드로 뜬다. 카드는 요청 요약(제목·한 줄 이유·작은 변경 미리보기)과 [Allow ▾]·[Deny]를 보이고, 대화를 스크롤해도 composer 위에 남는다. 답을 기다리는 동안 이 Agent 탭은 탭 줄에서 "Waiting for you"로 보인다. 카드를 보거나 notification을 읽는 것만으로 결정되지 않는다. (shell/desktop#R47, platform/approvals#R17, lophn-agent/questions#R17, shell/workspace#R35, platform/approvals#R4)
3. **agent 화면** 사람이 [Allow ▾]에서 Allow once나 Allow for this session을 고르거나 [Deny]를 누른다. 단추는 결정을 제출하지 않고, 고른 범위를 미리 골라 confirmation window를 연다. Allow ▾에 "Always allow"는 없다. 오래 가는 허락은 Agents 탭과 Settings › Agents의 권한 규칙에서만 정한다. 단추를 눌러도 confirmation window에서 제출하기 전에는 request가 결정 대기로 남는다. (shell/desktop#R47, platform/approvals#R18, shell/workspace#R37, shell/desktop#R50)
4. **things-to-confirm 화면** 세션 없는 run의 request, 앱 permission, release 적용·복원처럼 대화에 카드가 없는 request와 놓친 request는 여기서 기다리는 결정과 다음 행동을 찾아 정확한 request의 확인을 연다. 이 화면은 그대로 둔다. 미리보기·notification을 보거나 읽는 것만으로 결정되지 않는다. (shell/desktop#R9, platform/approvals#R4, platform/notifications#R6)
5. **confirmation-window 화면** 창은 요청한 창의 child modal BrowserWindow이며 그 창의 앱 view는 숨기지 않고 입력만 막는다. 사람은 정확한 대상·변경·영향·위험·되돌릴 수 있는 범위와 남는 영향을 읽는다. 결정에 필요한 요청자·이유·근거·입력 상세도 확인할 수 있고 permission이라면 정확한 경로·host·secret 사용 범위를 본다. 창은 독립적으로 현재 요청을 다시 읽어 일치 확인 전에는 제출을 막는다. 재조회·일회 handle 준비 과정은 사람에게는 보이지 않는다. (shell/desktop#R47, shell/confirmation-window#R2, shell/confirmation-window#R5, shell/confirmation-window#R6, shell/confirmation-window#R8, shell/app-frame#R30, platform/approvals#R1, platform/approvals#R2, apps/permissions#R1, apps/permissions#R8, platform/identity#R14)
6. **confirmation-window 화면** 사람이 허락 또는 거절을 명시적으로 제출하거나 대기 요청을 취소한다. 허락·거절 단추를 눌러야 제출되고, 카드에서 미리 고른 범위가 있어도 결정을 대신하지 않는다. 거절에는 이유가 필수가 아니지만 적으면 요청한 agent에게 그대로 돌아간다. 기본 선택·Enter 즉시 제출·무응답·창 닫기·카드 단추를 누른 사실·앱 화면의 동의·agent 문장·일반 question 답은 승인 증거가 아니다. 거절은 composer의 Stop과 다르다. Stop은 일을 멈추는 것이고 거절은 그 호출 하나를 미실행으로 남긴다. (platform/approvals#R3, platform/approvals#R4, platform/approvals#R13, platform/approvals#R14, shell/confirmation-window#R1, shell/confirmation-window#R4, shell/confirmation-window#R9, shell/desktop#R47, lophn-agent/harness/tool-judgment#R7)
7. lophn은 해당 보호 화면의 일회 handle과 현재 권한·대상·입력·비교 기준·원래 일의 유효성을 검사하고 사람이 본 그 동작에만 허락을 한 번 쓴다. Allow for this session이었다면 그 request는 평소대로 한 번 허락하고 같은 session 안의 같은 tool의 같은 동작에 session 허락을 더한다. confirm command는 정확한 release·command·입력의 실행 직전 접수와 함께 사용하며 접수와 실제 시작을 구별한다. 재검사·handle 사용 과정은 사람에게는 보이지 않는다. (shell/confirmation-window#R9, platform/approvals#R5, platform/approvals#R7, platform/approvals#R8, platform/approvals#R11, platform/approvals#R19, apps/invocations#R7, apps/invocations#R8, apps/invocations#R9, lophn-agent/harness/waiting-and-recovery#R2)
8. **agent 화면** 허락하면 카드가 사라지고 agent가 같은 run에서 일을 이어 간다. **things-to-confirm 화면** 사람은 결정 접수와 실제 적용 성공·실패·결과 모름을 구별해 본다. 허락 저장은 완료가 아니며 결과를 모르면 자동 재실행하지 않는다. 거절한 같은 일을 retry·handoff·다른 통로로 우회하지 않는다. (platform/approvals#R9, platform/approvals#R16, shell/desktop#R9, apps/invocations#R10, apps/invocations#R12, lophn-agent/harness/waiting-and-recovery#R5, lophn-agent/harness/waiting-and-recovery#R10, lophn-agent/harness/tool-judgment#R9)

## 다른 갈래

- 1에서 필요한 동작 설명·입력·범위를 확인할 수 없거나 허용 범위를 벗어나면 요청을 실행하지 않는다. approval request로 금지된 권한을 늘리지 않는다. (platform/approvals#R1, lophn-agent/harness/tool-judgment#R2)
- 이미 session 허락이 있는 session에서 같은 tool의 같은 동작이 다시 ask로 판정되면 새 카드 없이 이어진다. 이 허락은 그 session이 닫히거나 archive·delete되면 사라지고 다시 열어도 되살아나지 않으며 다른 session·run으로 넘어가지 않는다. composer 아래 권한 요약은 이 session의 실제 권한을 보이고 누르면 Agents 화면의 Permissions로 간다. (platform/approvals#R19, lophn-agent/harness/tool-judgment#R14, shell/desktop#R43)
- session 허락은 agent tool call의 ask에만 있다. 앱 command의 confirm·앱 permission·release 적용·복원처럼 정확한 대상 하나를 보고 결정해야 하는 request에는 없다. session 허락 아래서도 호출 직전의 재검사와 사람이 거절한 같은 동작의 재질문 금지는 그대로다. (platform/approvals#R20, platform/approvals#R11, platform/approvals#R16)
- 2~6에서 사람이 창을 닫거나 잠시 답하지 않으면 결정되지 않은 request를 카드나 things-to-confirm 화면에서 다시 찾을 수 있다. 명시 기한이 있으면 원래 기한 뒤 허락과 새 사용을 거절하고 침묵을 승인으로 바꾸지 않는다. (platform/approvals#R4, platform/approvals#R12, shell/desktop#R9, shell/confirmation-window#R4)
- 5~7에서 대상 변경·다른 결정·조회 실패가 생기면 옛 행동을 제거하고 최신 내용을 확인하게 한다. 만료·중복·늦은 결정이나 끝난 일의 허락으로 새 동작을 시작하지 않는다. (shell/confirmation-window#R5, platform/approvals#R5, platform/approvals#R7, platform/approvals#R12, platform/approvals#R13, lophn-agent/harness/waiting-and-recovery#R5)
- 6에서 거절·취소·만료하면 그 호출은 미실행으로 남는다. agent는 같은 request의 거절을 우회하지 않고 남은 일에 대해 새 판단을 할 수 있으나 관련 없는 다른 대기는 유지한다. (platform/approvals#R14, platform/approvals#R15, platform/approvals#R16, lophn-agent/harness/waiting-and-recovery#R2)
- secret 사용은 사람이 앱에 준 정확한 grant가 허락이다. 호출 주체나 호출마다 secret 승인을 추가하지 않는다. secret 값 입력이 필요하면 **confirmation-window 화면**의 전용 보호 입력으로 받고 값은 agent·앱 코드에 주지 않으며 플랫폼이 허용된 전송 직전에 붙인다. (apps/permissions#R14, apps/permissions#R15, platform/secrets#R2, platform/secrets#R4, platform/secrets#R5, shell/confirmation-window#R6)
- permission 변경·회수는 새 호출 차단과 이전 프로세스 종료 확인·새 범위 재시작의 실제 결과를 구별한다. 결정 접수만으로 실제 회수 완료나 이미 일어난 외부 효과 취소를 표시하지 않는다. (apps/permissions#R20, apps/permissions#R21, apps/permissions#R22)
- 7~8에서 연결 단절·재시작이 생기면 실제 결정과 미시작 근거를 확인한 뒤 유효한 미반영 결정만 한 번 적용한다. 시작 또는 결과를 확인할 수 없으면 결과 모름으로 남고 쓰기·외부 효과를 자동 반복하지 않는다. (shell/desktop#R7, apps/invocations#R10, apps/invocations#R12, lophn-agent/harness/waiting-and-recovery#R10, lophn-agent/harness/waiting-and-recovery#R11)

## 끝

사람은 자신이 어떤 결정을 했고 정확히 무엇이 적용됐는지 또는 아직 확인되지 않았는지 안다. agent 화면에서는 카드가 사라지고 일이 이어지거나 호출이 미실행으로 남은 것을 보며, things-to-confirm 화면에서도 같은 결과를 읽는다. 거절·취소·만료한 일은 미실행이며 승인 접수와 실제 성공은 다른 사실로 남는다. (platform/approvals#R9, platform/approvals#R15, shell/desktop#R9)
