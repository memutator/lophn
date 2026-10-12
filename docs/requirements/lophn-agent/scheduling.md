---
type: requirements
concerns: [lophn-agent/scheduling]
---
# lophn-agent/scheduling

보류. Operator는 schedule 작업이 아니라 project나 app의 일을 하는 agent이고(lophn-agent/roles/operator) 첫 판에는 주기가 없다. 주기를 다시 할 때는 agent 정의(lophn-agent/agents) 위에 새로 정한다.

## 요구

없음. 모든 요구를 보류했다.

## 버린 것

이전 요구 R1~R7을 모두 보류로 옮겼다. 보류 — 다시 할 때 agent 정의 위에 새로 정한다. 이유는 아래와 같다.

- R1(주기 run은 Operator에만 두고 machine이 계산해 접수) — 사람이 정한 결정: Operator는 schedule 작업이 아니다. 주기 기능은 보류한다.
- R2(앱 runtime scheduler 재사용) — 주기 run이 없어 scheduler를 쓰지 않는다. 공용 주기 계산 코드도 scheduling만 쓰던 것이라 지운다.
- R3(UTC 첫 예정 시점과 양수 밀리초 간격) — assignment에서 주기 칸을 뗐다. 다시 할 때 정의의 칸으로 정한다.
- R4(같은 예정 회차를 중복 접수하지 않고 접수·건너뜀을 남김) — 회차 기록 표를 지운다.
- R5(끝나지 않은 run이 있으면 다음 회차를 건너뛰고 대기열을 쌓지 않음) — 주기 접수가 없어 해당 없음. run의 겹침은 lophn-agent/harness/run-loop가 session 단위로 맡는다.
- R6(기동·절전 복귀·사람 재개 뒤 가장 최근 회차 하나만 처리) — 주기 접수가 없어 해당 없음. 사람 재개도 없앴다.
- R7(책임·상태만 바꿔도 처리한 예정 시점 유지) — 처리한 예정 시점을 assignment에서 뗐다.
