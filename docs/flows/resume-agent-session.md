---
type: flow
concerns: [lophn-agent/conversation, lophn-agent/handoff, lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery, lophn-agent/harness/prompt-assemble, lophn-agent/questions, platform/approvals, platform/backup-and-migration, platform/notifications, shell/desktop, shell/workspace]
screens: [conversation, things-to-confirm, project-workspace]
---
# 끊겼던 세션과 남은 일을 이어 간다

창을 닫았거나 연결이 끊겼거나 lophn이 비정상 종료한 뒤 사람이 돌아왔을 때 시작한다. 창을 닫는 것은 agent의 일을 멈추는 것이 아니며, 돌아온 사람에게 원래 요청을 다시 입력시키지 않는다.

지키는 약속: lophn-agent#I3, lophn-agent/harness#I2, lophn-agent/harness#I3, platform#I1, shell#I1.

## 흐름

1. **[screen: conversation]** 사람은 같은 열린 세션에서 확정 메시지·결정·각 메시지를 맡은 일·실제 결과와 남은 입력을 찾는다. 연결 중단 뒤에는 마지막 확인 상태와 시각을 보고, 재연결하면 현재 기록으로 맞춘 결과를 확인한다. (lophn-agent/conversation#R2, lophn-agent/conversation#R3, shell/desktop#R7, shell/desktop#R21)
2. machine은 SQLite 복구와 schema 점검 뒤 저장된 경계에서 미완료 일을 실제 관측으로 확인한다. 완전 응답·확정 tool 결과는 반복하지 않고, 결과 없는 쓰기·external은 결과 조회나 중복 효과 없음 확인 없이 재전송하지 않는다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R15, platform/backup-and-migration#R16, platform/backup-and-migration#R17, lophn-agent/harness/waiting-and-recovery#R8, lophn-agent/harness/waiting-and-recovery#R10)
3. machine은 사람이 멈추지 않은 일만 현재 담당·범위·안전·대상·credential·누적 한도를 다시 검사해 같은 run의 저장 경계에서 복구한다. 질문·approval의 원래 결정·기한과 실제 미시작 근거를 확인하고 유효한 미반영 결정만 한 번 사용한다. 사람에게는 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R7, lophn-agent/harness/waiting-and-recovery#R9, lophn-agent/harness/waiting-and-recovery#R11, platform/approvals#R11, platform/approvals#R12, lophn-agent/questions#R7)
4. **[screen: conversation]** 사람은 같은 일의 진행·내 답 기다림·실제 끝 결과를 구별한다. 이미 생긴 효과와 결과 불명을 따로 확인하고, 복구가 불가능하면 남은 일과 다음 행동을 본다. 사람이 멈춘 일은 자동으로 이어지지 않으며 다시 맡기기를 선택한 경우에만 이전 결과와 남은 입력을 참조하는 새 run이 생긴다. (lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18, lophn-agent/harness/run-loop#R19, lophn-agent/harness/waiting-and-recovery#R6, lophn-agent/harness/waiting-and-recovery#R10)
5. **[screen: things-to-confirm]** 사람은 놓친 질문·approval의 현재 상태와 지난 결정·실제 결과를 찾는다. 창을 닫았다고 결정되지 않고 만료·취소·미답을 새 승인으로 바꾸지 않는다. notification을 보거나 읽어도 일이 재시작되거나 닫힌 세션이 다시 열리지 않는다. (lophn-agent/questions#R8, lophn-agent/questions#R10, platform/approvals#R4, platform/approvals#R9, platform/approvals#R12, shell/desktop#R9, platform/notifications#R6, platform/notifications#R7, platform/notifications#R11)
6. **[screen: conversation]** 역할 사이에 맡긴 일이 있다면 원래 요청·무엇을 왜 맡겼는지·고정 근거와 실제 수신 역할의 결과를 이어 확인한다. 같은 handoff의 재전달로 일을 늘리지 않고 권한이나 사람 승인을 다른 역할에 옮기지 않는다. 중복 검사와 수신 범위 검사는 사람에게는 보이지 않는다. (lophn-agent/handoff#R3, lophn-agent/handoff#R6, lophn-agent/handoff#R8, lophn-agent/handoff#R9, lophn-agent/harness/run-loop#R7)
7. **[screen: conversation]** 세션이 이미 끝났다면 사람은 같은 담당의 새 세션에서 이어 갈 원문 구간을 선택한다. lophn은 선택한 원문과 출처를 참조하고 필요한 요약만 준비하며 메시지·미답 질문·approval·진행 일·외부 효과를 복제하지 않는다. 요약 조립은 사람에게는 보이지 않는다. (lophn-agent/conversation#R8, lophn-agent/conversation#R9, lophn-agent/conversation#R10, lophn-agent/harness/prompt-assemble#R19, lophn-agent/harness/prompt-assemble#R23)

## 다른 갈래

- 1에서 작성하던 말의 전송 결과가 불명확하면 **[screen: conversation]** 초안을 유지하고 접수부터 조회한다. 화면을 다시 열었다는 이유로 같은 입력을 재전송하지 않는다. (shell/desktop#R8)
- 3에서 만료된 approval·끝난 질문·이미 끝난 일이 발견되면 옛 결정을 쓰지 않는다. **[screen: things-to-confirm]** 이유와 실제 결과를 확인하고, 필요한 새 결정은 해당 결정 flow에서 받는다. (lophn-agent/questions#R9, lophn-agent/harness/waiting-and-recovery#R3, lophn-agent/harness/waiting-and-recovery#R5, platform/approvals#R13)
- 3에서 현재 담당이 멈췄거나 회수됐으면 복구가 담당을 자동 재개하지 않는다. **[screen: conversation]** 남은 입력과 실제 끝 결과를 보고 다시 맡길 일을 고른다. (lophn-agent/harness/waiting-and-recovery#R9, lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18)
- 7에서 요약이 실패해도 원문과 사람의 종료를 막지 않는다. **[screen: conversation]** 원문이 입력 한계 안이면 그대로 이어 가고, 밖이면 실패 이유를 보고 선택 구간을 줄이거나 새 세션을 시작한다. 미완성 요약으로 시작하지 않는다. (lophn-agent/conversation#R10, lophn-agent/harness/prompt-assemble#R22)
- **[screen: project-workspace]** 사람이 프로젝트를 다시 열면 탭 순서·배치·문서 읽던 위치를 찾는다. lophn은 현재 대상과 권한을 다시 검사한다. 탭 복원에 승인·credential·앱 업무 상태를 함께 넣지 않으며 이 안쪽 확인은 사람에게는 보이지 않는다. (shell/workspace#R6, shell/workspace#R7, shell/workspace#R8)
- 늦은 notification·tool 결과는 지난 사실의 보완일 뿐 닫힌 세션이나 끝난 일을 되살리지 않는다. **[screen: conversation]** 이어 갈 때 관련 이후 변화는 원래 시각의 이미 생긴 사실로 구별한다. (lophn-agent/conversation#R11, lophn-agent/harness/run-loop#R16, platform/notifications#R7)

## 끝

사람은 같은 세션에서 복구된 일의 현재 진행·결정 대기·실제 결과를 찾거나, 복구할 수 없는 이유와 남은 일을 확인한다. 끝난 세션은 선택한 원문만 새 세션의 근거로 이어지며 옛 승인이나 외부 효과는 다시 적용되지 않는다. (lophn-agent/conversation#R2, lophn-agent/conversation#R9, lophn-agent/harness/waiting-and-recovery#R10, lophn-agent/harness/waiting-and-recovery#R11)
