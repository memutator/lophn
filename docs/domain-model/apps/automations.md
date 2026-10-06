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

- **계기.** on_start는 업무 통로가 열릴 때 한 번, interval은 시작 기준 단조 시계로 계산한다. 시계는 1000ms마다 도래 여부를 검사하고 최소 간격은 60000ms다. 재시작은 새 시작이다.
- **비중첩.** `(프로세스 구분값,release,key)`마다 진행 회차는 많아야 하나다. 서로 다른 automation은 병렬이며 전체 동시 invocation 기본 한도는 4개다. 진행 중이거나 전체 한도 때문에 시작하지 못한 회차는 skip하며 queue에 쌓지 않는다. 실제 handler 종료나 자식 종료 확인 전에는 진행 점유를 풀지 않는다.
- **누락 회차.** 절전·멈춤 동안 놓친 회차는 replay하지 않는다. 복귀 시 다음 미래 간격만 잡는다.
- **실패.** 실패 직후 retry는 0회다. 다음 정해진 회차만 받는다. 기본 timeout은 600000ms이며 취소 요청·결과 미확인 처리는 → apps/invocations다. timeout 요청을 실제 종료나 효과 취소로 취급하지 않는다. 기록 전달 실패는 회차를 다시 돌릴 근거가 아니다.
- **통로.** clock은 앱 프로세스 안에서만 돌고 직접 호출과 같은 handler·input 검사를 쓴다. actor는 machine, trigger는 automation key이며 read도 invocation을 남긴다(→ apps/invocations).
- **권한.** confirm=true 명령은 automation으로 선언하거나 실행하지 않는다. external effect 명령은 사람이 automation을 켤 때 command·고정 입력·주기를 한 번 승인한 범위에서만 실행하고, 그 승인은 끄면 끝난다. 입력·command·주기를 바꾸면 새 승인이다. 켜기 승인의 저장 자리는 Grant kind `automation.run`(scope `{automation, command, input_hash, when}`)이고, 끄기는 `grant.revoke`다. 앱 clock은 회차마다 broker `try_acquire`를 부르고 broker가 그 요청의 현재 release 선언∩active grant를 다시 읽는다. 그래서 켜고 끄는 것은 프로세스를 다시 띄우지 않고 다음 회차부터 적용된다. 승인이 없으면 permit이 나가지 않고 회차는 시작하지 않는다(실패한 호출이 아니고 invocation도 없다). external이 아닌 automation은 별도 승인 없이 앱 실행 허용을 따른다. 실행 직전 현재 고정 command의 effect·confirm과 승인 범위를 다시 검사한다. secret 사용은 선언 이름∩grant와 실제 net.fetch host·port 범위를 따르며 caller가 automation이라는 이유로 막지 않는다.
- **닫힘.** 준비 모드·preview·교체 중·실행 허용 꺼짐·archive에서는 clock을 열지 않는다. 실행 허용의 정본 → apps/runtime.
- **시작하지 못한 회차.** 통로 닫힘·schema 불일치·진행 중·한도 초과·승인 없음·놓친 회차(절전)는 invocation이 아니다. clock은 이유만 메모리에 두고 `apps.automations` read는 선언(declared)·현재 실행 가능 여부(runnable과 reason)·실제 호출 관측(observed)을 서로 다른 값으로 낸다. 호출 관측은 그 release의 live invocation 중 trigger가 그 automation key인 것이 있는지다. 선언을 어긴 회차(confirm=true, 고정 입력 불일치)만 handler 없이 거절(deny) 사실로 남는다. 수동 확인은 trigger `direct`의 직접 호출이라 여기에 세지 않는다.
- **event.** 회차의 시작·끝은 → apps/invocations의 event만 쓴다. 별도 automation 완료 event와 운영 ledger clock은 없다.

## 정할 것

- 달력 시각·파일 변경 계기의 도입 여부. 현재는 on_start·interval만 지원한다.
