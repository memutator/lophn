---
type: flow
concerns: [lophn-agent/conversation, lophn-agent/commands, lophn-agent/handoff, lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery, lophn-agent/harness/prompt-assemble, lophn-agent/questions, platform/approvals, platform/backup-and-migration, platform/notifications, shell/desktop, shell/workspace]
---
# 끊겼던 session과 남은 일을 이어 간다

창을 닫았거나 연결이 끊겼거나 lophn이 비정상 종료한 뒤 사람이 돌아왔을 때, 또는 지난 session을 찾아 이어 가거나 갈라 쓰고 싶을 때 시작한다. 창이나 탭을 닫는 것은 agent의 일을 멈추는 것이 아니며, 돌아온 사람에게 원래 요청을 다시 입력시키지 않는다. 사람이 session을 끝내는 길은 없고, 치우는 길은 archive와 delete다.

지키는 약속: lophn-agent#I1, lophn-agent/harness#I2, lophn-agent/harness#I4, platform#I1, shell#I1.

## 흐름

1. **project-workspace 화면** 사람이 프로젝트를 다시 열면 Agent 탭이 같은 agent와 같은 session으로 복원된다. 복원은 현재 대상과 권한을 다시 검사해 없어진 Operator나 session은 이유와 닫기를 가진 자리표시로 남기고 다른 agent의 새 session으로 바꾸지 않는다. 탭 복원에 승인·credential·앱 업무 상태를 함께 넣지 않으며 이 안쪽 확인은 사람에게는 보이지 않는다. (shell/workspace#R33, shell/workspace#R6, shell/workspace#R7, shell/workspace#R8)
2. **agent 화면** 사람은 같은 열린 session에서 확정 메시지·결정·각 메시지를 맡은 일·실제 결과와 남은 입력을 찾는다. 연결 중단 뒤에는 마지막 확인 상태와 시각을 보고, 재연결하면 현재 기록으로 맞춘 결과를 확인한다. (lophn-agent/conversation#R2, lophn-agent/conversation#R3, shell/desktop#R7, shell/desktop#R21)
3. 다른 지난 session을 찾으려면 **agent 화면** 사람이 머리의 session 제목 ▾를 누른다. popover는 맨 위 제목 검색칸 아래에 그 agent의 session만 Today·Earlier로 묶어 상태 점(● Waiting for you, ◐ Working)·제목·상대 시각을 보이고 지금 session에 ✓를 둔다. 검색은 제목만 찾고 메시지 본문은 보지 않으며 다른 agent나 다른 자리의 session은 섞이지 않는다. 줄을 고르면 그 session이 열리고 [+ New session]은 같은 agent의 빈 session을 연다. (shell/desktop#R39, lophn-agent/conversation#R21, lophn-agent/conversation#R1, lophn-agent/conversation#R16)
4. machine은 SQLite 복구와 schema 점검 뒤 저장된 경계에서 미완료 일을 실제 관측으로 확인한다. 완전 응답·확정 tool 결과는 반복하지 않고, 결과 없는 쓰기·external은 결과 조회나 중복 효과 없음 확인 없이 재전송하지 않는다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R15, platform/backup-and-migration#R16, platform/backup-and-migration#R17, lophn-agent/harness/waiting-and-recovery#R8, lophn-agent/harness/waiting-and-recovery#R10)
5. machine은 사람이 멈추지 않은 일만 현재 담당·범위·안전·대상·credential·누적 한도를 다시 검사해 같은 run의 저장 경계에서 복구한다. 질문·approval의 원래 결정·기한과 실제 미시작 근거를 확인하고 유효한 미반영 결정만 한 번 사용한다. 사람에게는 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R7, lophn-agent/harness/waiting-and-recovery#R9, lophn-agent/harness/waiting-and-recovery#R11, platform/approvals#R11, platform/approvals#R12, lophn-agent/questions#R7)
6. **agent 화면** 사람은 같은 일의 진행·내 답 기다림·실제 끝 결과를 구별한다. 진행 중이면 header의 진행 chip이, 답을 기다리면 대화 안 질문·승인 카드가 보인다. 이미 생긴 효과와 결과 불명을 따로 확인하고, 복구가 불가능하면 남은 일과 다음 행동을 본다. 사람이 멈춘 일은 자동으로 이어지지 않으며 다시 맡기기를 선택한 경우에만 이전 결과와 남은 입력을 참조하는 새 run이 생긴다. (lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18, lophn-agent/harness/run-loop#R19, lophn-agent/harness/waiting-and-recovery#R6, lophn-agent/harness/waiting-and-recovery#R10, shell/desktop#R42)
7. **things-to-confirm 화면** 사람은 놓친 질문·approval의 현재 상태와 지난 결정·실제 결과를 찾는다. 창을 닫았다고 결정되지 않고 만료·취소·미답을 새 승인으로 바꾸지 않는다. notification을 보거나 읽어도 일이 재시작되거나 닫힌 session이 다시 열리지 않는다. (lophn-agent/questions#R8, lophn-agent/questions#R10, platform/approvals#R4, platform/approvals#R9, platform/approvals#R12, shell/desktop#R9, platform/notifications#R6, platform/notifications#R7, platform/notifications#R11)
8. **agent 화면** agent 사이에 맡긴 일이 있다면 원래 요청·무엇을 왜 맡겼는지·고정 근거와 실제 수신 agent의 결과를 이어 확인한다. 같은 handoff의 재전달로 일을 늘리지 않고 권한이나 사람 승인을 다른 agent에 옮기지 않는다. 중복 검사와 수신 범위 검사는 사람에게는 보이지 않는다. (lophn-agent/handoff#R3, lophn-agent/handoff#R6, lophn-agent/handoff#R8, lophn-agent/handoff#R9, lophn-agent/harness/run-loop#R7)

## 새 session으로 이어 가거나 정리하는 갈래

- **agent 화면** 사람이 composer에서 `/`를 쳐 Fork를 고르면 같은 agent·같은 자리의 새 session이 열려, 고른 지점까지의 확정 메시지가 복사되고 출처 session을 가리킨다. 진행 중 일·미답 질문·approval request·이미 생긴 효과·run 기록은 복사하지 않으므로 옛 승인이 새 session의 동작에 쓰이지 않고, 출처 session을 delete해도 복사본은 남는다. 일하는 중에는 Fork가 흐리게 보이고 이유를 말한다. (shell/desktop#R45, lophn-agent/commands#R2, lophn-agent/commands#R8, lophn-agent/commands#R9, lophn-agent/conversation#R9, lophn-agent/conversation#R12)
- **agent 화면** 긴 session은 `/`의 Compact로 줄인다. Compact는 사람이 부를 때만 같은 session의 앞 구간을 요약해 이후 call에 쓰고, 요약은 출처와 함께 일반 agent 답과 구별해 보이며 원문 메시지는 지우지 않는다. 일하는 중에 고르면 이번 일이 끝난 뒤 실행한다. (lophn-agent/conversation#R10, lophn-agent/commands#R8, lophn-agent/harness/prompt-assemble#R14, lophn-agent/harness/prompt-assemble#R19)
- **agent 화면** 목록을 정리하려면 popover 줄에서 Rename·Archive·Delete를 쓴다. 제목은 첫 사람 메시지 앞 60자가 자동으로 붙고 rename한 제목은 덮어쓰지 않는다. Archive는 목록에서 숨기기만 하고 메시지·run 기록·진행 중 일을 그대로 두며, popover 아래 Archived (n)에서 다시 열면 풀린다. Delete는 되돌릴 수 없다는 확인 뒤에 session·메시지·run 기록을 지우고, 진행 중이거나 사람을 기다리는 run이 있으면 먼저 멈추기 전에는 지우지 않으며, 그 run이 만든 문서·앱 변경은 지우지 않는다. (shell/desktop#R39, lophn-agent/conversation#R18, lophn-agent/conversation#R19, lophn-agent/conversation#R20, lophn-agent/commands#R2)
- session이 닫혀 읽기 전용이 되는 것은 담당 agent가 회수된 때뿐이다. 탭이나 칸을 닫거나 archive하거나 30일이 지나도 닫히지 않는다. 대상이 보관돼 멈춘 session(paused)은 원문을 읽을 수 있지만 새 입력은 받지 않는다. 사람이 session을 끝내는 단추는 없다. (lophn-agent/conversation#R8, lophn-agent/conversation#R2, shell/desktop#R37)

## 다른 갈래

- 2에서 작성하던 말의 전송 결과가 불명확하면 **agent 화면** 초안을 유지하고 접수부터 조회한다. 화면을 다시 열었다는 이유로 같은 입력을 재전송하지 않는다. 다른 session이나 탭으로 갔다 와도 초안과 커서가 남는다. (shell/desktop#R8)
- 5에서 만료된 approval·끝난 질문·이미 끝난 일이 발견되면 옛 결정을 쓰지 않는다. **things-to-confirm 화면** 이유와 실제 결과를 확인하고, 필요한 새 결정은 해당 결정 flow에서 받는다. (lophn-agent/questions#R9, lophn-agent/harness/waiting-and-recovery#R3, lophn-agent/harness/waiting-and-recovery#R5, platform/approvals#R13)
- 5에서 현재 담당이 멈췄거나 회수됐으면 복구가 담당을 자동 재개하지 않는다. **agent 화면** 남은 입력과 실제 끝 결과를 보고 다시 맡길 일을 고른다. 회수된 session은 읽기 전용이므로 같은 agent를 sidebar에서 다시 불러 새 session을 연다. (lophn-agent/harness/waiting-and-recovery#R9, lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18, lophn-agent/conversation#R8, shell/workspace#R34)
- Compact가 실패해도 session과 원문, 입력 접수는 그대로다. 원문이 입력 한계 안이면 그대로 이어 가고, 밖이면 **agent 화면** 실패 이유를 보고 Fork로 새 session을 열거나 [+ New session]으로 새로 시작한다. 미완성 요약으로 시작하지 않는다. (lophn-agent/conversation#R10, lophn-agent/harness/prompt-assemble#R17, lophn-agent/harness/prompt-assemble#R22)
- 늦은 notification·tool 결과는 지난 사실의 보완일 뿐 archive했거나 닫힌 session이나 끝난 일을 되살리지 않는다. Fork한 session에서 관련 이후 변화는 원래 시각의 이미 생긴 사실로 구별한다. (lophn-agent/conversation#R11, lophn-agent/harness/run-loop#R16, platform/notifications#R7)

## 끝

사람은 같은 session에서 복구된 일의 현재 진행·결정 대기·실제 결과를 찾거나, 복구할 수 없는 이유와 남은 일을 확인한다. 이어서 일할 때는 같은 session을 계속 쓰거나, 고른 지점까지의 메시지만 복사한 Fork의 새 session을 쓰며, 옛 승인이나 외부 효과는 다시 적용되지 않는다. (lophn-agent/conversation#R2, lophn-agent/conversation#R9, lophn-agent/harness/waiting-and-recovery#R10, lophn-agent/harness/waiting-and-recovery#R11)
