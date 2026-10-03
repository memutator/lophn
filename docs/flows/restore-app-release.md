---
type: flow
concerns: [apps/releases, apps/data, apps/runtime, problems/tests, problems/reporting, platform/approvals, shell/confirmation-window, shell/desktop, shell/wording]
---
# 잘못 바꾼 앱을 이전 동작으로 돌린다

사람이 새 변경을 쓰다 마음에 들지 않거나 동작이 나빠져 이전 release를 다시 쓰고 싶을 때 시작한다. 이전 코드를 선택하는 것만으로 지금 데이터나 이미 생긴 외부 효과가 과거로 돌아가지는 않는다.

지키는 약속: apps#I6, apps#I3, platform#I7.

## 흐름

1. app-detail 화면 사람이 앱의 release 이력에서 돌아갈 동작과 당시 실제 테스트를 확인해 이전 release를 고른다. 당시 테스트는 그때의 고정 bundle과 검사 범위로 읽고 현재 앱까지 정확하다는 증명으로 쓰지 않는다. (apps/releases#R1, apps/releases#R16, apps/releases#R17, problems/tests#R2, problems/tests#R12)
2. lophn이 실제 현재 데이터 schema와 선택한 release가 요구하는 schema를 비교한다. 같은 schema일 때만 바로 activation 대상으로 진행하며 이전 코드 선택으로 데이터나 외부 효과를 되돌렸다고 판단하지 않는다. 사람에게는 보이지 않는다. (apps/releases#R16, apps/data#R3, apps/data#R12)
3. confirmation-window 화면 사람이 선택한 정확한 release와 현재 앱에서 바뀔 동작·권한·데이터 영향·남는 효과를 확인하고 새 activation을 승인한다. 과거에 했던 승인이나 당시 테스트 통과를 이번 결정 대신 사용하지 않는다. (apps/releases#R8, apps/releases#R9, apps/releases#R16, platform/approvals#R1, platform/approvals#R5, shell/confirmation-window#R6)
4. machine이 현재 release·bundle·grant·실제 schema·사람 결정이 그대로인지 다시 확인하고 해당 앱의 다른 activation과 겹치지 않게 교체한다. 기존 프로세스가 종료된 뒤 선택한 release를 현재 허용 범위에서 시작하며 실제 bundle·handler·schema·연결을 확인한 뒤에만 적용을 확정한다. 사람에게는 보이지 않는다. (apps/releases#R12, apps/releases#R13, apps/releases#R14, apps/runtime#R1, apps/runtime#R2)
5. app-detail 화면 사람이 실제 선택한 동작으로 바뀌었는지와 사용할 수 있는지 확인한다. 시작 확인은 업무 정확성이나 기존 문제의 수리 완료가 아니며, 필요한 결과와 다음 행동만 기본으로 본다. (platform/approvals#R9, apps/runtime#R3, apps/runtime#R13, apps/runtime#R14, shell/wording#R1, shell/wording#R2)

## 다른 갈래

- 2에서 schema가 맞지 않으면 app-detail 화면에서 적용할 수 없음과 데이터 호환을 먼저 해결해야 한다는 다음 행동을 본다. 별도 데이터 restore의 대상과 사람 결정이 정해지지 않은 상태에서 옛 backup을 자동으로 덮지 않는다. (apps/releases#R16, apps/data#R12, shell/wording#R10)
- 3에서 사람이 보류하거나 창을 닫으면 기존 앱을 유지한다. 거절·만료·취소는 미실행이며 침묵이나 화면 닫기를 승인으로 보지 않는다. (platform/approvals#R4, platform/approvals#R15, shell/confirmation-window#R4)
- 결정 중 다른 변경으로 대상·입력·현재 schema가 달라지면 옛 행동을 없애고 최신 내용을 다시 확인하게 한다. 이미 받은 허락으로 다른 release를 적용하지 않는다. (platform/approvals#R5, platform/approvals#R11, shell/confirmation-window#R5, apps/releases#R12)
- 4에서 시작이 실패하면 새 적용 실패와 이전 활성 참조를 남긴다. 데이터가 바뀐 경우 새 업무 통로를 열기 전의 복구만 수행하고 무결성·schema를 확인한 뒤에만 이전 release를 다시 시작한다. app-detail 화면에서 실제 복구 결과와 다음 행동을 본다. (apps/releases#R15, apps/data#R11, apps/runtime#R2, apps/runtime#R13, shell/wording#R10)
- 전송이 끊겨 결과를 확인하지 못하면 app-detail 화면에서 마지막 확인 상태와 시각을 유지하고 재연결 후 현재 기록을 다시 읽는다. 불명확한 결과를 성공으로 채우거나 같은 승인을 새 적용에 다시 사용하지 않는다. (shell/desktop#R7, platform/approvals#R7, platform/approvals#R9)
- 복원 뒤 앱 오류가 발생하면 실제 사용 중인 release의 보고 경로로 모은다. 옛 테스트 통과나 시작 성공만으로 해당 문제가 고쳐졌다고 처리하지 않는다. (problems/reporting#R2, problems/reporting#R3, problems/reporting#R5, apps/runtime#R3)

## 끝

사람은 선택한 이전 동작의 실제 적용·시작 결과 또는 적용하지 못한 이유와 다음 행동을 안다. 코드의 선택, 데이터 restore, 외부 효과 취소, 문제 해결은 서로 다른 것으로 남는다. (apps/releases#R14, apps/releases#R16, apps/data#R12, apps/runtime#R3, platform/approvals#R9)
