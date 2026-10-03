---
type: flow
concerns: [lophn-agent/assignments, lophn-agent/presets, lophn-agent/instructions, lophn-agent/scheduling, lophn-agent/roles/operator, lophn-agent/roles/context-engineer, lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery, lophn-agent/conversation, platform/approvals, shell/confirmation-window]
---
# 맡긴 일을 바꾸거나 멈춘다

사람이 project/app에 붙인 Operator의 책임을 고치거나 잠시 멈추거나 거두려 할 때 시작한다.

## 흐름

1. 사람은 목적·지금 진행·다음 행동을 보고 상세에서 project/app 범위·고정 preset 판·출력 문서·주기를 확인한다. 자료 context를 담당 대상으로 표시하지 않는다. (lophn-agent/assignments#R2, lophn-agent/assignments#R3, lophn-agent/presets#R5)
2. 사람이 멈추거나 거두면 lophn은 현재 제한을 즉시 적용해 새 요청·주기 run을 막는다. run 중단은 새 model/tool/retry를 막고 진행 호출에 취소를 요청하며 이미 생긴 효과를 취소 성공이라고 하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/assignments#R9, lophn-agent/harness/run-loop#R25)
3. 사람은 preset 새 판·project/app 범위·읽을 자료·출력·주기의 변경안을 확인하고 보호 화면에서 exact 전체 변경을 승인한다. Context Engineer는 제안만 하고 agent가 자기 구성을 적용하지 않는다. (lophn-agent/presets#R12, lophn-agent/presets#R14, lophn-agent/assignments#R4, lophn-agent/assignments#R5)
4. lophn은 현재 revision·독점 출력·허용 범위를 검사하여 전체 적용하거나 전체 거절한다. 새 preset은 다음 run부터 적용하며 현재 지침은 다음 call부터 읽는다. 사람에게는 보이지 않는다. (lophn-agent/presets#R11, lophn-agent/presets#R12, lophn-agent/presets#R14, lophn-agent/instructions#R8, lophn-agent/assignments#R8)
5. 사람은 멈춘 일을 명시 재개하거나 회수된 일 대신 새 책임을 만든다. 지난 세션·문서·run 결과를 읽되 늦은 결과로 끝난 책임을 되살리지 않는다. (lophn-agent/assignments#R9, lophn-agent/conversation#R11, lophn-agent/harness/run-loop#R6)

## 다른 갈래

- preset을 복사·변경해도 기존 assignment가 자동 이동하지 않는다. 다른 책임의 실제 범위·grant·approval·이력은 복사되지 않는다. (lophn-agent/presets#R10, lophn-agent/presets#R14)
- 남길 문서에 사람이 나중 편집했으면 기존 결과를 덮지 않고 충돌로 남긴다. 멈춘 책임의 출력 독점은 회수 전 유지한다. (lophn-agent/assignments#R8, documents/versions#R6)
- scope 회수·연결 끊김·지침 읽기 실패는 고정된 옛 preset을 이유로 우회하지 않는다. (lophn-agent/presets#R8, lophn-agent/instructions#R7)

## 끝

사람은 맡긴 책임의 현재 구성과 켜짐·멈춤·회수, 실제 진행 결과를 구별한다. 다음 run의 새 preset과 다음 call의 지침도 별개다. (lophn-agent/assignments#R3, lophn-agent/instructions#R8)
