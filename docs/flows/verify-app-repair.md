---
type: flow
concerns: [problems/repairs, problems/tests, problems/closing, problems/grouping, problems/snapshots, coding-agent/repair-context, coding-agent/connection, apps/releases, apps/runtime, platform/approvals, shell/confirmation-window, shell/desktop]
---
# 고쳤다는 결과가 실제로 맞는지 확인한다

coding agent가 수리를 마쳤다고 보고했거나 사람이 ticket 없이 직접 수리를 시켰을 때 시작한다. 사람은 수리 주장·실제 확인·운영 적용·문제 닫힘을 혼동하지 않고 필요한 결정만 한다.

## 흐름

1. app-detail 화면에서 사람은 문제의 현재 진행·실제 담당·다음 행동을 먼저 보고 수리 기록을 펼치면 누가 무엇을 고쳤다고 했는지, 당시 release, 실제 테스트와 미실행 확인·한계를 구별한다. 당시 snapshot은 현재 자료로 덮어쓰지 않는다. (problems/grouping#R12, problems/repairs#R1, problems/repairs#R2, problems/tests#R5, problems/snapshots#R1)
2. ticket 없는 직접 수리도 coding agent가 이전·고친 release와 변경 설명·출처를 남기고 같은 테스트 통로로 요청한다. 작은 repair context에는 원래 문제와 지난 근거가 이어진다. 없던 ticket·claim이나 실제로 돌리지 않은 테스트를 만들지 않는다. 수리 자료 조립·출처 검사는 사람에게는 보이지 않는다. (problems/repairs#R1, problems/repairs#R4, problems/repairs#R6, coding-agent/repair-context#R2, coding-agent/repair-context#R3, coding-agent/repair-context#R18, coding-agent/connection#R5)
3. test runner는 고정 bundle·테스트·입력·기대로 이전 release의 원래 실패와 고친 release의 통과를 격리해 검사하고 실제 결과만 기록한다. 운영 DB·secret·사람 파일·실서비스에 접근하거나 원래 외부 요청을 다시 보내지 않는다. agent의 완료 문장을 통과로 받지 않는다. 테스트 과정은 사람에게는 보이지 않는다. (problems/tests#R1, problems/tests#R2, problems/tests#R4, problems/tests#R5, problems/tests#R10, problems/tests#R13, problems/tests#R15)
4. app-detail 화면에서 사람은 실제 통과·실패·판정 불가·미실행과 남은 확인을 구별한다. 고친 묶음의 app test 통과로 release를 준비해도 운영에 적용하지 않은 수리를 닫힌 문제로 보이지 않는다. (problems/tests#R4, problems/tests#R5, problems/repairs#R2, apps/releases#R5, problems/closing#R2, problems/closing#R4)
5. 운영 앱을 바꿀 필요가 있으면 confirmation-window 화면에서 사람이 정확한 release의 변경·영향을 보고 승인하거나 거절한다. lophn은 현재 기준과 실제 시작 준비를 확인해 적용하고 승인 접수와 적용 성공을 구별한다. 재검사·시작 확인 과정은 사람에게는 보이지 않는다. (apps/releases#R8, apps/releases#R9, apps/releases#R12, apps/releases#R14, platform/approvals#R9, shell/confirmation-window#R1)
6. lophn은 실제 reproduction 통과·그 고친 release의 현재 활성 상태·테스트 요청 기준 뒤 같은 문제의 새 운영 보고 없음이 함께 맞을 때만 자동으로 닫는다. 자동 판정은 사람에게는 보이지 않는다. 사람이 직접 확인하려면 confirmation-window 화면에서 현재 문제·쓰는 release를 보고 고쳐졌음 또는 아직 이상함을 명시적으로 답한다. 사람의 확인은 실제 테스트 통과를 만들지 않으며 agent는 닫지 못한다. (problems/closing#R1, problems/closing#R3, problems/closing#R4, problems/closing#R6, problems/closing#R10, shell/confirmation-window#R9)
7. app-detail 화면에서 사람은 닫힌 이유와 지금 필요한 주의를 보고 원할 때 실제 확인 범위·미확인 부분·지난 수리·테스트를 펼친다. 현재 활성 release에서 재발하면 lophn이 같은 문제를 다시 열고 기존 수리와 당시 근거를 보존한다. 재발 판정 과정은 사람에게는 보이지 않는다. (problems/closing#R11, problems/closing#R13, problems/closing#R14, problems/grouping#R10, problems/repairs#R3, problems/snapshots#R17)

## 다른 갈래

- 2에서 범위 밖이거나 회수된 연결의 수리 요청은 거절한다. ticket 수리는 현재 유효 claim 출처만 받으며 직접 수리에 가짜 claim을 붙이지 않는다. (coding-agent/connection#R5, coding-agent/connection#R8, problems/repairs#R4, problems/repairs#R5)
- 3~4에서 runner 상실·중단·timeout·근거 부족이면 판정 불가 또는 미실행으로 남긴다. 앱 시작·일반 command·app test·test command 성공은 reproduction 통과나 닫힘을 대신하지 않는다. code·보고 경로 삭제와 기대 약화도 수리 통과가 아니다. (problems/tests#R4, problems/tests#R11, problems/tests#R17, problems/closing#R2, problems/closing#R3)
- reproduction을 만들 수 없는 직접 수리는 confirmation-window 화면의 보호된 사람 확인으로 끝낼 수 있다. 설정·입력 조치에 수리 release를 억지로 만들지 않으며 현상이 안 보임이나 더 다루지 않음은 수리 성공과 구별한다. (problems/closing#R7, problems/closing#R8, problems/closing#R9, problems/repairs#R7)
- 5에서 거절·취소·만료하면 운영 적용은 미실행으로 남고 문제도 적용을 이유로 닫지 않는다. 적용 실패나 결과 모름을 완료로 표시하지 않는다. (platform/approvals#R9, platform/approvals#R15, apps/releases#R15, problems/closing#R2)
- 6에서 보고·현재 release·문제 기준이 바뀌면 옛 확인을 사용하지 않고 최신 근거로 다시 비교한다. 사람이 아직 이상하다고 하면 닫지 않거나 다시 열고 같은 release에 같은 확인을 반복 요청하지 않는다. 조용한 기간만으로 닫지 않는다. (problems/closing#R4, problems/closing#R5, problems/closing#R10, problems/closing#R14)
- 7에서 이전 release의 늦은 보고는 근거로 남기되 현재 release 재발로 다시 열지 않는다. 연결 단절 때에는 마지막 화면과 최신 확인 못함을 유지해 지난 상태를 현재 판정으로 오인하지 않게 한다. (problems/closing#R12, shell/desktop#R7)

## 끝

사람은 app-detail 화면에서 실제 근거로 닫혔는지, 자신의 확인으로 닫혔는지, 아직 무엇이 확인되지 않았는지 안다. 고쳤다는 주장과 운영 적용이 끝났다는 사실은 각각 확인할 수 있지만 그 자체가 문제 해결은 아니다. (problems/tests#R5, problems/closing#R2, problems/closing#R13)
