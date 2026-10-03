---
type: requirements
concerns: [apps/connections]
---
# apps/connections

앱이 다른 앱의 command를 쓰는 선언과 앱 쌍의 허락 범위, 직접 호출과 출처 전달을 맡는다. grant의 기록·회수는 apps/permissions, 전송과 프로세스 신원 검사는 apps/runtime, invocation 기록은 apps/invocations가 맡는다.

## 요구

**[R1]** 부르는 앱은 쓸 대상 앱·command 목록·목적을 blueprint에 선언하고 사람은 방향이 있는 앱 쌍과 그 command 범위를 한 번 허락한다.
- 이유: 한 앱의 허락이 모든 다른 앱이나 반대 방향 접근을 열지 않는다.
- 확인: A에서 B의 두 command를 선언해 허락하면 그 둘만 호출되며 B에서 A 호출과 A에서 C 호출은 거절된다.
- 의도: apps#I7

**[R2]** 호출 가능한 범위는 부르는 앱의 현재 선언·앱 쌍의 active grant·대상 앱의 현재 command 목록의 교집합이며 새로운 command나 대상 앱 추가는 새 사람 결정을 요구한다.
- 이유: 후속 release가 옛 허락을 넓히지 않는다.
- 확인: 같은 command 범위의 release는 다시 묻지 않지만 새 command를 추가한 선언은 옛 grant로 호출하지 못한다.
- 의도: apps#I7

**[R3]** 앱끼리도 대상 앱의 같은 command handler·입력 검사·효과·사람 확인 선언을 사용하며 확인이 필요한 command는 정확한 대상과 입력에 대한 사람 approval 없이 실행하지 않는다.
- 이유: 다른 앱 호출이 별도 API나 확인 없는 우회가 되지 않는다.
- 확인: 직접 쓰는 command와 다른 앱이 쓰는 command가 같은 handler를 호출하고 secret grant가 있는 대상 앱의 confirm=false command는 추가 approval 없이 실행되며 confirm=true command만 별도 approval을 요구한다.
- 의도: apps#I7

**[R4]** 연결 준비 뒤 앱끼리의 일반 command 요청·응답은 core·supervisor·ledger queue를 거치지 않고 대상 앱으로 직접 간다.
- 이유: 두 앱을 잇는 일이 플랫폼 업무 중계나 공용 병목을 만들지 않는다.
- 확인: ledger 기록을 지연시켜도 A에서 B의 일반 command가 응답하고 confirm의 선행 접수 예외만 apps/invocations를 따른다.
- 의도: apps#I7

**[R5]** 다른 앱 호출은 인증된 부른 앱·당시 release와 알려진 부모 invocation을 전달하고 대상 앱은 입력 본문의 caller 주장이나 다른 앱 허락의 재위임을 신뢰하지 않는다.
- 이유: 호출의 원인과 실제 부른 쪽을 남기면서 A의 허락이 B를 통해 C로 자동 이어지지 않는다.
- 확인: A가 B를 부른 기록에 A의 당시 release가 남고 부모 호출이 없으면 없음으로 표시되며 B에서 C는 B 자신의 선언·grant 없이는 거절된다.
- 의도: apps#I7

**[R6]** 대상 앱의 멈춤·교체·연결 단절은 해당 호출에 unavailable 또는 결과 모름을 돌려주고 부른 앱의 다른 일과 다른 앱 통로를 멈추거나 업무 쓰기를 자동 재호출하지 않는다.
- 이유: 앱 간 연결이 실패를 전체 앱으로 퍼뜨리거나 중복 효과를 만들지 않는다.
- 확인: B가 응답 중 종료되어도 A의 다른 화면과 C 호출은 동작하고 B 쓰기를 반복 실행하지 않는다.
- 의도: apps#I6

**[R7]** 앱끼리 이어 부르는 깊이는 최대 8개 앱으로 제한하고 현재 호출 경로에 이미 있는 앱으로 돌아가는 호출은 handler 실행 전에 거절한다.
- 이유: 상호 호출이 끝나지 않는 재귀나 기다림을 만들지 않는다.
- 확인: A→B→A와 아홉 번째 앱 호출은 거절되지만 서로 독립적인 A→B와 B→A 호출은 각 허락 안에서 가능하다.
- 의도: apps#I6

## 열린 질문

## 버린 것

- 별도 read model·provider export·PublicInterface는 되살리지 않는다. blueprint command가 유일한 앱 API다.
