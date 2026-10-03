---
type: domain-model
concerns: [apps/automations]
---
# apps/automations

automation의 주기 값과 회차 정책을 정의한다.

선언 필드의 정본은 → apps/blueprint의 AutomationDeclaration이다. 별도 entity·ID·ledger 표는 없다.

## AutomationClock (값)

앱 프로세스 메모리의 값이며 재시작 때 버린다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `release` | `rel` ID | 아니오 | → apps/releases | 고정 선언 |
| `key` | 문자열 | 아니오 | 같은 release의 automation key | 시계 대상 |
| `started_tick` | 0 이상 정수 ms | 아니오 | 프로세스 단조 시계 | 업무 통로가 열린 기준 |
| `next_tick` | 0 이상 정수 ms | 예 | interval에만; started_tick의 간격 배수 | 다음 회차 |
| `on_start_fired` | boolean | 아니오 | 최초 false; on_start의 접수 뒤 true | 시작 회차 중복 방지 |
| `running_invocation` | `inv` ID | 예 | → apps/invocations; 같은 release·automation | 진행 회차 |

## 정책

- **계기.** on_start는 업무 통로가 열릴 때 한 번, interval은 시작 기준 단조 시계로 계산한다. 최소 간격은 60000ms다. 재시작은 새 시작이다.
- **비중첩.** `(프로세스 구분값,release,key)`마다 진행 회차는 많아야 하나다. 진행 중 다음 회차는 skip하며 queue에 쌓지 않는다.
- **누락 회차.** 절전·멈춤 동안 놓친 회차는 replay하지 않는다. 복귀 시 다음 미래 간격만 잡는다.
- **실패.** 실패 직후 retry는 0회다. 다음 정해진 회차만 받는다. 기록 전달 실패는 회차를 다시 돌릴 근거가 아니다.
- **통로.** clock은 앱 프로세스 안에서만 돌고 직접 호출과 같은 handler·input 검사를 쓴다. actor는 machine, trigger는 automation key이며 read도 invocation을 남긴다(→ apps/invocations).
- **권한.** confirm=true, external effect 명령은 automation으로 선언하지 않는다. secret 사용은 grant를 따른다. confirm=false로 반복 허락을 대신하지 않는다.
- **닫힘.** 준비 모드·preview·교체 중·실행 허용 꺼짐·archive에서는 clock을 열지 않는다. 실행 허용의 정본 → apps/runtime.
- **event.** 회차의 시작·끝은 → apps/invocations의 event만 쓴다. 별도 automation 완료 event와 운영 ledger clock은 없다.

## 정할 것

- **H1.** 외부 효과의 정확한 release·automation·입력·범위에 대한 반복 사전 허락을 지원할지 정한다. 현재는 금지다.
- 달력 시각·파일 변경 계기의 도입 여부. 현재는 on_start·interval만 지원한다.
