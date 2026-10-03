---
type: requirements
concerns: [apps/automations]
---
# apps/automations

앱이 스스로 도는 automation의 선언과 주기, 직접 호출과 공유하는 동작, 회차의 겹침·누락·실패 처리와 secret·외부 효과 제한을 맡는다. lophn agent의 주기는 lophn-agent/scheduling을 따른다.

## 요구

### 선언과 계기

**[R1]** automation은 같은 release의 명령 하나와 검사를 통과한 고정 입력을 선언하고 직접 호출과 같은 명령 구현을 사용한다.
- 이유: 버튼과 automation이 서로 다른 동작이나 입력 검사를 갖지 않게 한다.
- 확인: 같은 입력으로 직접 호출과 automation을 실행하면 같은 구현이 호출되며 선언하지 않은 명령과 잘못된 입력은 거절된다.

**[R2]** 첫 판의 automation 계기는 앱 업무 통로가 열린 때 한 번과 일정 간격뿐이며 간격은 최소 60000ms로 제한한다.
- 이유: 달력·파일·event 처리의 추가 정책 없이 필요한 반복 동작부터 제공한다.
- 확인: 시작 때 한 번과 60000ms 간격 선언은 받아들이고 59999ms 간격, 5필드 cron, 파일 변경과 event 계기는 거절한다.

**[R3]** automation 시계는 1초마다 도래 여부를 확인하되 간격 회차를 앱 시작 기준 단조 시계의 배수로 계산하고 재시작은 새 시작으로 취급한다.
- 이유: 벽시계 변경과 긴 호출이 다음 회차를 임의로 밀거나 중복하지 않게 한다.
- 확인: 벽시계를 앞뒤로 바꿔도 간격 기준은 유지되며 재시작하면 시작 계기는 한 번 다시 실행되고 간격 기준은 새로 잡힌다.

**[R4]** automation은 앱과 실제 데이터 schema가 현재 release로 호출 가능한 때만 시작하며 준비·교체·preview 상태와 앱 실행 허용 여부는 apps/runtime 및 apps/preview를 따른다.
- 이유: 사용할 수 없는 앱에 회차를 성공으로 만들거나 운영 준비 전에 업무를 시작하지 않는다.
- 확인: 데이터 schema가 맞지 않거나 통로가 닫힌 앱에서는 handler가 호출되지 않고 회차를 시작하지 못한 이유를 읽을 수 있다.

### 겹침과 누락

**[R5]** 같은 automation의 진행 invocation은 최대 1개이며 이전 invocation이 끝나지 않은 다음 회차는 건너뛰고 대기열에 쌓지 않는다.
- 이유: 느린 반복 작업이 같은 데이터를 중복 처리하지 않게 한다.
- 확인: 1분 간격에 3분 걸리는 명령을 붙이면 동시에 1개만 돌고 그동안 도래한 회차가 끝난 뒤 몰아서 실행되지 않는다.

**[R6]** 서로 다른 automation은 병렬 실행할 수 있으며 전체 automation의 동시 invocation 기본 한도는 4개다.
- 이유: 독립 작업을 직렬로 기다리게 하지 않으면서 자원 사용을 유한하게 제한한다.
- 확인: 독립 automation 5개를 동시에 도래시키면 최대 4개만 시작하고 한도 때문에 시작하지 못한 회차가 대기열에 누적되지 않는다.

**[R7]** 앱 중단·절전 동안 놓친 회차는 다시 실행하지 않고 복귀 뒤 가장 가까운 미래 간격부터 이어 간다.
- 이유: 복귀 직후 밀린 작업이 실제 사용을 붙잡지 않게 한다.
- 확인: 1분 간격 앱을 1시간 멈췄다 켜면 지난 60회와 보충 1회 모두 실행되지 않는다.

### 실패와 관측

**[R8]** automation의 실패 직후 자동 retry는 0회이며 다음 정해진 회차만 새 호출로 시작한다.
- 이유: 실패한 업무를 무작정 반복하지 않고 회차와 retry를 혼동하지 않는다.
- 확인: 한 회차를 실패시키면 즉시 재실행이나 retry timer가 생기지 않고 다음 간격에만 새 호출이 시작된다.

**[R9]** automation 호출의 기본 timeout은 10분이며 timeout과 종료 요청 뒤의 실제 결과는 apps/invocations를 따른다.
- 이유: 응답하지 않는 회차를 무한히 진행 중으로 두지 않되 timeout을 효과 취소의 증명으로 쓰지 않는다.
- 확인: 응답하지 않는 명령이 10분을 넘으면 종료 요청과 timeout 사실을 찾을 수 있으며 실제 결과를 모르면 성공이나 미실행으로 표시되지 않는다.

**[R10]** automation의 선언·현재 실행 가능 여부·실제 호출 관측은 구분해서 보여 주며 호출 기록은 읽기 명령도 포함하여 apps/invocations에 남긴다.
- 이유: 꺼진 앱·부족한 권한·입력 source 없음 때문에 시작하지 못한 회차를 실제로 시작해 실패한 명령과 혼동하지 않는다.
- 확인: 선언만 있는 경우, 앱 꺼짐·권한 없음·입력 source 없음인 경우, 성공·실패한 호출에서 서로 다른 사실과 당시 release를 찾는다.

**[R11]** 기록 전달 실패나 재시작 뒤 결과 미확인은 automation을 다시 돌릴 근거가 아니며 후행 기록과 유실 처리는 apps/invocations를 따른다.
- 이유: 관측을 보충하려다가 업무 자체를 중복하지 않는다.
- 확인: invocation 전달을 실패시키고 앱을 다시 시작해도 해당 회차의 업무를 자동 반복하지 않는다.

**[R12]** 사람이 automation의 동작을 수동 확인할 때는 현재 명령의 직접 호출로 처리하고 운영과 preview를 명시하며 scope와 확인 규칙은 apps/runtime 및 apps/invocations를 따른다.
- 이유: 과거 개발 상태의 별도 호출 경로가 현재 호출 제한을 우회하지 않게 한다.
- 확인: 수동 호출이 주기 회차를 만든 것으로 보이지 않으며 preview 대상이 없을 때 운영 앱으로 대신 호출하지 않는다.

### secret과 외부 효과

**[R13]** 첫 판에서는 사람 확인이 필요한 명령(confirm)과 앱 밖에 영향을 주는 명령(external)을 automation으로 선언하거나 실행할 수 없고, secret 사용은 apps/permissions의 grant를 따르며 automation이라는 이유로 막지 않는다.
- 이유: H1이 정해지기 전 반복 허락이 일회 확인을 대신하지 않게 한다. secret은 앱에 준 grant가 허락이다.
- 확인: external·confirm 명령을 automation에 연결하면 확인 여부를 거짓으로 바꾸어도 거절되고, grant가 있는 secret을 쓰는 read·write 명령은 automation에서 실행된다.
- 의도: apps#I5

## 열린 질문

- apps/automations#Q1 H1의 외부 효과 반복 사전 허락을 도입할까?
- apps/automations#Q2 달력 시각·파일 변경·event 계기와 놓친 회차 처리 중 무엇을 추가할까?
- apps/automations#Q3 이전 최대 retry 10회와 현재 자동 retry 0회 중 어느 쪽을 유지할까?

## 버린 것

- 중단 중 놓친 회차를 automation마다 최대 1회 보충하는 catch-up: 현재 모델은 놓친 회차를 모두 건너뛴다.
- 앱 automation의 agent mode와 token 예산: 앱 automation과 lophn-agent/scheduling을 분리하며 비용 상한을 두지 않는다.
- event automation의 연쇄 순환 방지와 typed event stream·cursor·backpressure·fan-out·depth 예산: 첫 판에는 event automation과 앱 사이 호출이 없고 일반 workflow 언어도 만들지 않는다.
