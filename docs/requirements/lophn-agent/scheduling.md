---
type: requirements
concerns: [lophn-agent/scheduling]
---
# lophn-agent/scheduling

Operator의 승인된 주기를 machine이 계산해 회차를 접수하거나 건너뛰는 규칙과 컴퓨터가 꺼진 동안·사람의 답을 기다리는 동안 처리를 맡는다.

## 요구

### 책임과 범위

**[R1]** 주기 run은 Operator assignment에만 두고 machine이 계산해 배경 요청으로 접수하며 사람의 직접 요청은 한 번짜리 run이고 주기 계산에 모델을 호출하지 않는다.
- 이유: lophn-agent/roles/app-engineer에 따라 다른 역할에 자동 주기를 두지 않는다.
- 확인: 사람 요청은 다음 예정 회차를 바꾸지 않고 lophn·App Engineer·Context Engineer에 주기 설정이 없는지 본다.

**[R2]** Operator 주기는 apps/automations와 계산 책임을 구분하되 기존 앱 runtime의 scheduler를 재사용한다.
- 이유: 같은 로컬 컴퓨터에서 별도 scheduler를 중복 운영하지 않는다.
- 확인: 앱 automation과 agent 주기의 접수 규칙은 서로 다르지만 scheduler가 두 개로 따로 돌지 않는지 확인한다.

**[R3]** 승인 주기는 UTC 첫 예정 시점과 양수 밀리초 간격으로 지정하고 기본 간격은 두지 않으며 현재 첫 판에는 cron·현지 시간대·달력 주기를 제공하지 않는다.
- 이유: 현재 domain model의 고정 간격을 명시하고 옛 달력 지원과의 차이를 숨기지 않는다.
- 확인: 간격 0·음수는 거절되고 시계가 현지 시간대로 바뀌어도 UTC 간격이 유지되는지 본다.

**[R4]** machine은 같은 예정 회차를 중복 접수하지 않고 접수 또는 건너뜀의 시각과 이유를 남긴다.
- 이유: 재전송·재시작 뒤 같은 판단을 두 번 하지 않는다.
- 확인: 같은 회차 처리를 반복해도 run이 하나이고 기록에서 결과를 확인할 수 있는지 본다.

**[R5]** assignment에 접수됨·진행·사람 기다림 중 끝나지 않은 run이 하나라도 있으면 다음 회차를 건너뛰고 기다리던 회차 대기열을 쌓지 않는다.
- 이유: lophn-agent/harness/run-loop에 따라 질문·approval 대기도 겹침으로 본다.
- 확인: 질문 답 전 여러 회차를 넘겨도 새 run이 없고 각 건너뜀 근거가 남는지 본다.

**[R6]** 기동·절전 복귀·사람 재개 뒤 놓친 회차는 현재까지 가장 최근 미처리 회차 하나만 처리하고 앞 회차의 구간·횟수는 놓침으로 남기며 과거 run을 몰아서 만들지 않는다.
- 이유: 꺼진 동안의 반복 판단이 재기동 때 폭주하지 않게 한다.
- 확인: 10회 놓친 뒤 가장 최근 1회만 처리하고 나머지 9회가 기록에서 구분되는지 본다.

**[R7]** 책임·상태만 바꿔도 처리한 예정 시점은 유지하고 주기를 승인해 바꿀 때만 미래 첫 시점으로 새 계산을 시작하며 멈춤 상태의 변경은 재개가 아니다.
- 이유: 옛 회차의 중복 접수와 승인 변경의 자동 재개를 막는다.
- 확인: 책임만 변경한 뒤 지난 회차가 다시 생기지 않고 주기 변경 뒤 과거를 다시 처리하지 않는지 본다.

## 열린 질문
- lophn-agent/scheduling#Q1 Operator에 cron 5칸·IANA 시간대의 현지 달력 주기를 추가할까.
- lophn-agent/scheduling#Q2 H8: Operator가 질문 답을 기다리는 동안 모든 회차를 건너뛰는 정책을 유지할까.

## 버린 것
- 문제 발생·release activation·SDK 공개에 따른 App Engineer 자동 유지보수 run은 lophn-agent/roles/app-engineer 및 event 깨움 금지로 제거했다.
- 별도 WebSocket event cursor로 lophn agent run을 깨우는 구조는 사람 요청·Operator 주기만 받는 결정으로 제거했다.
- 원본 SDK 새 version event만으로 agent가 차이를 요약하는 자동 run은 제거하고 사람 요청 검토로만 남겼다.
- 새 문서·stale 요약·미지정 자리·불확실 절·주기 sweep의 agent 작업 큐는 자동 판단 계기에서 제거했다.
