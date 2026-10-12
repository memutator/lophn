---
type: flow
concerns: [lophn-agent/conversation, lophn-agent/commands, lophn-agent/harness/run-loop, lophn-agent/harness/prompt-assemble, lophn-agent/harness/waiting-and-recovery, lophn-agent/harness/safety, lophn-agent/questions, platform/approvals, platform/notifications, shell/desktop]
---
# 진행 중인 일을 고치거나 멈춘다

agent가 일하는 동안 방향을 고치거나 다음 일을 맡기거나 중단하고 싶을 때 시작한다. 사람은 말을 다시 입력하지 않고 접수·반영·실제 종료를 각각 확인한다.

지키는 약속: lophn-agent#I1, lophn-agent/harness#I2, lophn-agent/harness#I3, lophn-agent#I6.

## 흐름

1. **agent 화면** agent가 일하는 동안 header에 진행 chip("2/4")이 보이고 누르면 Tasks popover(✓ 끝남, ● 지금, ○ 남음)가 열린다. composer에는 일을 멈추는 Stop이 보인다. 사람은 질문·approval을 기다리는 중에도 입력칸에 말을 쓸 수 있다. (shell/desktop#R42, shell/desktop#R43, lophn-agent/conversation#R3)
2. **agent 화면** 일하는 중에 말을 보낼 때만 보내기 옆에 작은 select가 나와, 사람은 이 말이 현재 일의 수정(Change this work)인지 별도 다음 요청(Next request)인지 구분해 보낸다. 접수된 말과 실제 판단에 반영된 말을 구별해서 본다. (lophn-agent/conversation#R3, lophn-agent/conversation#R5, lophn-agent/conversation#R6, shell/desktop#R43)
3. harness는 수정 원문을 접수 순서로 보존하고 현재 요청과 미반영 수정을 다음 판단에 빠짐없이 넣는다. 새 수정이 있으면 다음 tool을 시작하기 전에 새 판단을 거치며 이미 시작한 효과를 없던 일로 만들지 않는다. 사람에게는 보이지 않는다. (lophn-agent/conversation#R5, lophn-agent/harness/prompt-assemble#R3, lophn-agent/harness/run-loop#R9, lophn-agent/harness/run-loop#R10, lophn-agent/harness/run-loop#R16)
4. **agent 화면** 사람은 수정이 접수됐는지 실제로 반영됐는지 확인한다. 중단을 원하면 composer의 Stop을 누르고, 중단 요청이 접수된 사실과 일이 실제 끝난 결과를 구별한다. 대화 안 승인 카드의 [Deny]는 Stop이 아니다. Deny는 그 호출 하나를 미실행으로 남기고, Stop은 일을 멈춘다. (lophn-agent/conversation#R3, lophn-agent/harness/run-loop#R18, lophn-agent/harness/run-loop#R19, shell/desktop#R42, shell/desktop#R47)
5. 멈춤이 접수되면 harness는 새 model·tool·retry·후속 요청을 즉시 막고 진행 중 호출에 중단을 요청한다. 확정 변경·미실행·결과 불명·미반영 입력을 실제 사실대로 남기며, 이미 생긴 변경을 중단만으로 되돌리지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/run-loop#R15, lophn-agent/harness/run-loop#R16, lophn-agent/harness/run-loop#R18)
6. 별도 다음 요청은 현재 일의 정상 종료 뒤 접수 순서대로 새 run에서 시작한다. 실패·멈춤 뒤에는 입력을 보존하되 자동 시작하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/conversation#R6, lophn-agent/harness/run-loop#R6)
7. 같은 tool·대상·입력이 계속 실패하면 harness는 정해진 반복 실패 경계에서 다음 같은 요청을 미실행으로 막는다. 차단 뒤 같은 요청을 다시 요구하거나 안전 중단이 확정되면 일을 끝내고 복구·retry로 차단을 풀지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/safety#R1, lophn-agent/harness/safety#R2, lophn-agent/harness/safety#R3, lophn-agent/harness/safety#R4)
8. **agent 화면** 일이 끝나면 진행 chip이 사라지고 회색 "Worked for 18s" 줄이 남는다. 사람은 끝난 결과와 멈춘 이유·이미 완료한 변경·남은 입력을 확인한다. 실패·중단 뒤 남은 일을 계속 맡길지 고르며, 사람이 멈춘 일은 다시 맡길 때 이전 결과와 남은 입력을 참조하는 새 run으로 시작한다. 멈춘 일을 다시 맡기는 것과 새 요청은 서로 다른 행동이라 한 단추에 합치지 않는다. (shell/desktop#R41, shell/desktop#R42, lophn-agent/harness/run-loop#R6, lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18)

## 다른 갈래

- 2에서 보낸 결과를 모르면 **agent 화면** 작성하던 말과 마지막 확인 화면을 유지하고 접수 여부부터 조회한다. 못 보냄과 접수 확인 안 됨을 구별하여 무작정 중복 전송하지 않는다. 다른 탭이나 confirmation window를 갔다 와도 초안과 커서는 남는다. (shell/desktop#R7, shell/desktop#R8)
- 질문·approval을 기다리는 동안 수정이나 Stop을 보내도 입력을 잃지 않는다. 명시 수정으로 옛 질문을 취소하면 답 없음으로 원래 일이 멈추고 새 담당 입력을 보존한다. 옛 approval을 취소하면 해당 호출을 미실행으로 남기고 같은 run에서 다시 판단한다. 안쪽 처리는 사람에게는 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R4, lophn-agent/questions#R8, platform/approvals#R13)
- 일하는 중에 `/` 명령을 쓰면 Rename·Archive 같은 것은 바로 되고, Compact와 skill 명령은 이번 일이 끝난 뒤 실행되며, Fork는 흐리게 보이고 이유를 말한다. 명령은 agent의 권한·승인을 넓히지 못한다. (lophn-agent/commands#R8, lophn-agent/commands#R10, shell/desktop#R45)
- 3에서 일이 끝나는 순간 수정이 도착해도 입력을 유실하지 않는다. 종료 확정 전이면 현재 run에, 확정 뒤면 새 담당 run에 한 번만 연결한다. **agent 화면** 사람은 실제 담당과 반영 여부를 확인한다. (lophn-agent/conversation#R7, lophn-agent/harness/run-loop#R14)
- 5 뒤 늦은 tool 결과는 감사 기록만 보완하고 끝난 일을 재개하거나 새 변경·후속 일을 시작하지 않는다. **agent 화면** 이미 시작한 외부 효과는 취소·미실행·성공으로 추측하지 않고 확인된 결과만 보여 준다. (lophn-agent/harness/run-loop#R16, lophn-agent/harness/run-loop#R18)
- 완료나 중단을 notification 도착 여부로 판단하지 않는다. run 종료 자체는 notification을 만들지 않고, notification을 열어도 새 일이 시작되지 않는다. (platform/notifications#R2, platform/notifications#R7)

## 끝

사람은 수정의 실제 반영 또는 실제 종료 결과를 확인한다. 남은 요청은 정상 종료 뒤의 새 일인지, 실패·중단 뒤 사람이 다시 골라야 하는 일인지 구별되어 있고 입력이나 이미 생긴 효과는 사라지지 않는다. (lophn-agent/conversation#R3, lophn-agent/conversation#R6, lophn-agent/harness/run-loop#R18)
