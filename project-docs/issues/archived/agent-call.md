# agent-call (닫음)

## `AgentCallRecord.options`가 메모리에만 있다

```yaml
kind: bug
modules: [packages/core/router, packages/core/apps]
closed: fixed
guard: 없음
```

지금: 앱 줄에 선 coding 맡기기의 옵션(harness, model)이 transport 메모리에만 있어 재시작하면 잃는다고 했다.

영향: 줄에서 기다리던 call이 재시작 뒤 기본 옵션으로 열릴 수 있었다.

닫음: 옵션은 이제 `coding_lines.options` 열(`apps/tickets/coding/schema.ts`, `store.ts`의 `pushLine`)에 JSON으로 적히고, 줄에서 나중에 열릴 때 `launch.ts`의 `resolveLaunch`가 거기서 읽는다. 재시작 때는 `recoverCoding`이 줄을 비우고 `RecoverCalls`가 그 call을 `lophn_restarted`로 닫아 보낸 session에 알리므로, 옵션이 사라진 채 다른 설정으로 조용히 열리는 일이 없다.

## Router describe가 lophn session의 waiting을 내지 못한다

```yaml
kind: bug
modules: [packages/core/router, packages/core/main]
closed: fixed
guard: 없음
```

지금: `callSendable` read(`router/reads.ts`)가 session마다 상태를 `describe`로 얻는다. wiring의 `describe`(`main/daemon/wiring/router-registration.ts`)는 turns 표에 running turn이 있으면 `running`, 없으면 `idle`만 낸다. 반면 허락을 기다리는 turn은 turns 표에서 여전히 running이고, 기다림 자체(`approvals/turn-requests.ts`의 entries)는 core main thread 메모리에 있어 reader Worker가 못 본다. coding session은 `coding/store.ts`가 permissions 표로 `waiting`을 이미 낸다.

영향: 사람에게 허락을 기다리는 lophn session을 부르려는 agent가 그 session을 running으로 본다(`waiting`이어야 한다). 이 목록으로 "지금 말 걸어도 되나"를 고르는 agent의 판단이 흐려진다.

고치려면:
- A. 기다림을 표(예: turn 행의 칸)에 한 줄 적는다. reader가 읽는다. 허락 열기와 닫기 때마다 쓰기가 들어 turn 안 request를 메모리에만 두는 규칙(재시작이 끊는다)과 부딪친다. 비용 중간.
- B. 표시를 포기하고 STATES에서 lophn session의 waiting을 뺀다. 코드 한 줄.
- 추천: B. 보내는 쪽은 running이든 waiting이든 다음 turn 입력으로 같은 곳에 들어간다. 구별이 필요해지면 A.

정한 것: lophn session의 waiting 구별을 포기한다(B).

닫음: B로 했다. `router/reads.ts`의 `STATES`에서 `waiting`을 빼서 허락 기다림 중인 session은 `running`으로 보인다. 구별이 필요해지면 turn 행에 적는 쪽을 본다.

## 배달 실패의 응답 꼴이 보낸 쪽마다 셋이다

```yaml
kind: defect
modules: [packages/core/router]
closed: fixed
guard: router_test.ts
```

지금: `router.ts`의 `deliveryFailed`가 보낸 쪽에 따라 다르게 돌려준다. 사람은 `err({ code: failureCode(reason), message: FAILURE_TEXTS[reason] })`, program과 coding agent는 `ok({ call: null, state: "failed", fail_reason, session: null })`, agent는 `ok({ call, state: "failed", fail_reason })`에 더해 `notifyFailed`로 보낸 session에 `kind: "reply"` 입력(`failureInput`, 고정 영어 `FAILURE_TEXTS`)을 한 번 더 넣는다. agent는 같은 실패를 tool 결과와 새 입력 둘로 받는다(역할이 겹치는지는 확인이 필요하다).

영향: 실패를 받는 쪽마다 읽는 법이 다르다. 새 보낸 쪽을 더하면 넷째 꼴이 생긴다. 이중 통지는 agent가 같은 실패에 두 번 반응하게 할 수 있다.

고치려면: 모든 보낸 쪽에 오류 code 하나(`failureCode`)로 돌려주고 agent는 입력 통지만 둔다. 계약이 바뀌어 `RouteResult`를 쓰는 곳(tool, Reactor, coding CLI)을 같이 고친다. 비용 중간. 추천: agent의 이중 통지만 먼저 정리하고 나머지는 보낸 쪽이 늘 때 한다.

정한 것: agent가 같은 실패를 두 번 받는 것만 지금 고친다. 꼴 통일은 보낸 쪽이 늘 때 한다.

닫음: `deliveryFailed`의 agent 분기에서 `notifyFailed`를 지웠다. 바로 난 배달 실패는 call tool 결과로만 가고, 늦게 난 실패(`receiver_ended`, `lophn_restarted`)만 `failAll`이 입력으로 넣는다. `callSend`가 미리 준비하던 `FAILURE_TEXTS` blob도 지웠다. 보낸 쪽마다 다른 꼴의 통일은 정한 대로 보낸 쪽이 늘 때 한다.
