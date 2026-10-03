---
type: requirements
concerns: [lophn-agent/harness/run-loop]
---
# lophn-agent/harness/run-loop

run의 영속 접수·시작·turn·retry·유한한 한도·멈춤·최종 결과와 assignment 겹침·늦은 결과 경계를 맡는다. 기다림·복구는 lophn-agent/harness/waiting-and-recovery, assignment 연속 실패는 lophn-agent/assignments를 따른다.

## 요구

### 접수와 시작

**[R1]** 새 run은 사람 요청 하나·lophn-agent/scheduling이 허용한 Operator 회차 하나·lophn-agent/handoff로 이어진 원래 사람 요청 하나에 대응하며 자료 변경·결과 도착·notification만으로 새 run을 만들지 않는다.
- 이유: 판단의 시작은 사람의 의도나 승인된 주기에서 온다.
- 확인: 세 계기를 각각 접수하고 문서 변경·결과 도착·notification은 새 run을 만들지 않는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R2]** 입력과 run은 시작 전에 영속 접수하고 저장 성공 뒤 접수 완료를 답하며 같은 요청·회차·handoff 재전달은 platform/ledger의 중복 규칙으로 이전 결과를 반환한다.
- 이유: 재시작·재전송으로 입력 유실과 중복 작업이 생기지 않는다.
- 확인: 접수 직후 중단·재전송에도 하나의 run과 원문·순서·담당이 남는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R3]** 같은 assignment의 사람 요청은 여러 개 접수하되 진행 중 또는 사람을 기다리는 run은 하나만 두고 무관한 assignment는 기다리게 하지 않으며 실제 변경 충돌은 platform/ledger로 처리한다.
- 이유: 긴 대상 lock 없이 겹침과 무관한 일의 응답성을 함께 지킨다.
- 확인: 한 assignment의 두 run은 겹치지 않고 다른 assignment와 사람 편집은 진행되며 충돌은 자동 병합되지 않는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R4]** 시작 가능한 접수는 사람이 지금 기다리는 일·사람의 한 번짜리 일·주기 일 세 우선순위에서 FIFO로 선택하되 상위 일을 8개 연속 시작한 뒤 가장 오래 기다린 시작 가능한 하위 일에 다음 자리를 준다.
- 이유: 사람 응답을 우선하면서 주기 일의 영구 밀림을 막는다.
- 확인: 상위 8개 뒤 하위 최오래 접수가 시작되고 막힌 assignment가 무관한 후보를 막지 않는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R5]** assignment 자리 대기는 접수 순서를 보존하여 10분이 넘어도 폐기하지 않고 시작 필수 설정·역할·대상이 영구히 없으면 이유와 함께 끝내며 대기 중 사람 멈춤을 받는다.
- 이유: 오래 기다렸다는 이유로 받은 일을 잃지 않는다.
- 확인: 10분 넘는 단순 대기와 영구 불가능을 구별하고 접수 상태에서 멈춤이 되는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R6]** 선행 run이 completed면 다음 요청을 접수 순서대로 시작하고 failed·stopped면 다음 요청을 보존하되 사람이 계속할 요청을 확인하기 전 시작하지 않는다.
- 이유: 실패 뒤 원치 않는 다음 일이 자동으로 시작되지 않는다.
- 확인: 선행 세 결과별로 다음 요청의 시작·보존·사람 확인을 테스트한다.
- 의도: lophn-agent/harness#I2

**[R7]** handoff를 받은 run에서는 보낸 run·원래 사람 요청·맡긴 내용·근거 고정 version을 확인할 수 있으며 packet의 책임은 lophn-agent/handoff를 따른다.
- 이유: 받은 일의 출처를 독립 run에서 되짚는다.
- 확인: 수신 run에서 네 근거를 확인하고 같은 handoff 중복 시작이 없는지 확인한다.
- 의도: lophn-agent/harness#I2

### turn과 tool 묶음

**[R8]** 사람 요청과 주기 일은 provider에 독립적인 하나의 agent loop를 쓰며 model call·tool 동작·시간 대기는 platform/ledger의 쓰기 흐름을 점유하지 않고 platform/responsiveness를 따른다.
- 이유: 느린 호출이 무관한 상태 변경을 막지 않는다.
- 확인: model·tool·retry 대기 중 무관한 읽기·쓰기 응답을 확인한다.
- 의도: lophn-agent/harness#I2

**[R9]** turn은 멈춤 확인→접수 입력 선택→사람 기다림·한도 검사→prompt 조립→model call 하나·완전 응답 확인→tool 묶음→결과 영속 기록→계속·종료 판정 순서로 진행하고 조립 뒤 입력·멈춤을 다시 확인한다.
- 이유: 오래 조립하는 사이 도착한 수정과 멈춤을 놓치지 않는다.
- 확인: 조립 중 steering·멈춤을 넣어 옛 판단의 새 tool이 시작되지 않는지 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R10]** 현재 일을 고치는 입력이 접수되면 다음 tool을 시작하기 전에 그 입력을 반영하는 새 판단을 거친다.
- 이유: 진행 중 방향 수정이 실제 행동보다 늦게 적용되지 않게 한다.
- 확인: 여러 tool 응답 사이 steering을 넣어 미시작 tool 대신 새 판단이 시작되는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R11]** 출력 한도·단절·중단으로 불완전한 model 응답의 tool call은 하나도 시작하지 않고 출력 잘림 사실은 다음 판단에 전달한다.
- 이유: 완성되지 않은 인자나 판단으로 효과를 만들지 않는다.
- 확인: 부분 JSON·출력 잘림·스트림 단절 모두 tool 시작 0개인지 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R12]** 모든 call이 읽기로 확인된 묶음만 병렬로 처리할 수 있고 쓰기·external·미분류 call이 하나라도 있으면 전체를 요청 순서로 처리하며 병렬 결과도 요청 순서로 모은다.
- 이유: 동작 간 순서를 바꾸지 않으면서 독립 읽기를 빠르게 할 수 있다.
- 확인: 혼합 묶음은 순차이고 읽기 병렬 완료 순서가 달라도 반환 순서는 원래 요청과 같은지 확인한다.
- 의도: lophn-agent/harness#I2

**[R13]** 없는 tool·잘못된 인자·거절·최종 실패는 call별 결과로 반환하여 harness가 인자를 고치지 않으며 순차 쓰기·external이 거절되거나 최종 실패하면 나머지는 미실행 이유를 남기고 독립 읽기 결과는 보존한다.
- 이유: 실패 뒤 의존 동작을 추측해 계속하지 않는다.
- 확인: 혼합 묶음의 중간 실패에서 남은 쓰기는 시작되지 않고 이전 읽기 결과·원래 인자가 남는지 확인한다.
- 의도: lophn-agent/harness#I2

### 끝남과 멈춤

**[R14]** 정상 종료는 완전 응답에 tool call과 미반영 steering이 모두 없을 때 입력 접수와 원자적으로 확정하며 enabled에서 뒤에 도착한 steering은 새 run에 보존하고 다음 일 요청은 정상 종료를 막지 않는다. paused의 입력 보존은 lophn-agent/conversation을 따르고 새 run을 접수하지 않는다.
- 이유: 종료 경계에서 마지막 수정이 잃어버려지지 않는다.
- 확인: 종료 직전·직후 steering을 넣어 현재 반영 또는 새 담당이 반드시 남는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R15]** 사람 멈춤 접수 뒤 새 model·tool·retry·후속 요청 시작을 즉시 막고 진행 호출에 중단을 요청하며 미시작 call은 미실행으로 끝낸다.
- 이유: 멈춤이 실제 새 효과의 진입을 차단한다.
- 확인: 멈춤 직후 모든 새 진입 0개와 진행 호출의 중단 요청을 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R16]** 끝난 run의 늦은 결과는 감사 기록만 보완하고 그 run의 새 대상 변경·재개·새 run 생성을 거절하며 이미 시작한 외부 효과를 취소·미실행·성공으로 꾸미지 않는다.
- 이유: 늦은 응답이 멈춤 결정을 뒤집지 않는다.
- 확인: 중단 불가 호출의 1분 뒤 응답이 기록만 보완하고 대상·최종 결과·진행 상태를 바꾸지 않는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R17]** 사람이 멈춘 run과 남은 입력은 재시작·연결 회복·주기로 자동 재개하지 않고 사람이 다시 맡기면 이전 확정 결과·남은 입력을 참조하는 새 run으로 진행한다.
- 이유: 사람 멈춤을 복구가 무효화하지 않는다.
- 확인: 재시작 뒤 미시작 상태를 확인하고 명시 다시 맡김만 새 run을 만드는지 확인한다.
- 의도: lophn-agent/harness#I2

**[R18]** run은 completed·failed·stopped와 이유, 실제 시작 여부, 확정 변경·미실행·불명확 효과·미반영 입력과 다음 담당을 한 번만 확정하며 멈춤·실패 자체로 완료 변경을 되돌리지 않는다.
- 이유: 반복 실패 판정과 사람의 이어가기 판단에 확정 사실이 필요하다.
- 확인: 결과 세 종류를 구별하고 늦은 성공으로 결과가 덮이지 않으며 revert는 lophn-agent/revert에서 별도로 확인한다.
- 의도: lophn-agent/harness#I2

### 보이는 상태

**[R19]** run은 접수됨·진행 중·내 답 기다림·끝남과 현재 행동 한 줄·경과 시간·멈추기를 제공하고 실제 진척을 모르면 퍼센트·예상 종료·추론 원문·장식 문구로 진행을 만들지 않는다.
- 이유: 사람이 왜 기다리는지 실제 상태로 알 수 있어야 한다.
- 확인: 각 상태의 표시와 멈춤을 확인하고 근거 없는 퍼센트·종료 예측이 없는지 확인하며 모양과 위치는 shell/desktop을 따른다.
- 의도: lophn-agent/harness#I2

### 한도와 retry

**[R20]** 공통 run 한도는 model 시도 30회·진행 없는 시간 5분·사람 기다림을 뺀 전체 시간 30분이며 양의 정수만 받고 사람만 다음 run부터 바꿀 수 있고 역할이 늘리거나 0·무제한으로 둘 수 없다.
- 이유: 유한한 작업 경계와 공통 설정을 유지한다.
- 확인: 각 경계 도달을 테스트하고 retry·재시작이 횟수·시간을 초기화하지 않으며 사람 기다림은 두 시간에서 빠지는지 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R21]** 진행은 완전 model 응답 또는 확정 tool 결과만 인정하여 실패 시도도 model 횟수에 세고 부분 token은 무진행 시간을 초기화하지 않는다.
- 이유: 느린 부분 출력으로 run이 무한 지속되지 않게 한다.
- 확인: 부분 token만 계속 오는 호출이 5분 무진행에 멈추고 실패 시도 수가 줄지 않는지 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R22]** 한도 도달 뒤에는 judgment·organizing·마무리 model을 추가로 부르지 않고 machine이 확정된 사실만으로 결과를 정리한다.
- 이유: 종료 정리가 상한 우회가 되지 않는다.
- 확인: 30회·5분·30분 각 한도 이후 model call이 0개인지 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R23]** provider가 일시 실패로 분류한 model 통신만 같은 입력으로 최초 뒤 최대 2회 retry하고 서버 최소 재시도 시각을 지키며 없으면 2초·4초 기다리고 부분 응답은 채택하지 않는다.
- 이유: retry를 숨기거나 대기를 앞당기지 않는다.
- 확인: 최대 3개 실제 시도, 2·4초 간격과 120초 서버 최소 대기 보존을 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R24]** tool 자동 retry는 읽기 또는 최초 호출의 중복 효과 없음이 계약으로 보장된 쓰기에만 최초 뒤 최대 1회 허용하여 1초에 ±10% jitter를 준 대기 뒤 매번 재판정하고 거절·잘못된 입력·사라진 대상·문맥 초과·사람 멈춤은 동일 요청 retry하지 않는다.
- 이유: 중복 효과와 거절 반복을 막는다.
- 확인: 보장 없는 쓰기·external은 재호출되지 않고 허용 요청도 최대 2번 진입하는지 확인한다.
- 의도: lophn-agent/harness#I2, lophn-agent/harness#I3

**[R25]** provider를 끄거나 MCP 연결을 제거하면 새 진입을 막고 가능한 진행 요청은 취소하되 이미 전송·시작한 결과는 lophn-agent/harness/waiting-and-recovery의 확인 경계로 처리한다.
- 이유: 설정 변경이 이미 일어난 효과를 지우지 않는다.
- 확인: 설정 회수 직후 새 요청이 없고 중단 가능·불가능한 진행 요청의 결과가 각각 정확히 남는지 확인한다.
- 의도: lophn-agent/harness#I2

## 버린 것

- tool을 한 번도 시작하지 않은 배경 run 일시 실패에만 run 전체 자동 retry를 최대 5회, 30초·1분·5분·15분·1시간 간격으로 허용하고 대화·영구 실패·사람·안전 멈춤은 제외한다. — 14§14.4.3·P2: run 전체를 처음부터 자동 반복하는 규칙을 두지 않는다; 새 주기 회차와 같은 run 통신 retry만 구별한다.
- 한도 도달 뒤 일반 model·tool을 막되 확정 결과가 있으면 tool 없는 마무리 model call을 최대 1회·30초·retry 없이 허용하고 실패·사람 멈춤이면 harness가 확정된 일만 정리한다. — 14§14.4.3·14.6: 한도 뒤 마무리 model call 예외를 없애고 machine이 확정 사실만 정리한다.
- 일 하나의 동시 subagent는 최대 4개이고 생성 예약·실행·approval·입력·external 대기 자식 모두 종료 확정 전까지 수에 포함한다. — 유지 결정의 subagent 제외: subagent·4개 자리·부모 일 없음.
- subagent 생성 전에 동시 자리를 예약하고 초과는 즉시 거절하며 생성 실패·종료 확정 때만 반환해 숨은 대기열·상한 밖 동기 실행으로 우회하지 않는다. — 유지 결정의 subagent 제외·P2: subagent admission 구조 자체 불필요.
- 부모 일의 종료·멈춤·취소 때 생성 중·대기 중 자식을 모두 막고 멈춤을 요청하며 실제 종료 전 자리를 재사용하거나 부모 없이 계속하게 하지 않는다. — 유지 결정의 subagent 제외·lophn-agent/handoff: subagent 생애 없음; handoff 수신 run은 독립 역할 run.
- 실패·멈춤·취소 subagent를 다시 시키면 이전 시도를 근거로 새 시도를 만들고 이전 종료·결과를 덮지 않으며 늦은 옛 결과를 새 시도로 넣지 않는다. — 유지 결정의 subagent 제외: subagent 재시도 통로 없음; 일반 사람이 다시 맡긴 새 run은 run-loop에서 따로 유지.
- 문서 저장 event를 받은 lophn agent가 비동기로 summary Annotation을 만든다. — 공용 틀 8.4 event-trigger agent 없음; derived summary를 문서로 저장하지 않음.
