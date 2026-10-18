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

## Router·command·read를 요청마다 만들고 `RouterEnvironment`를 전역에 놓는다

```yaml
kind: defect
modules: [packages/core/router, packages/core/main]
closed: kept
guard: 없음
```

지금: `router/environment.ts`가 모듈 변수 `installed`를 두고, writer·reader Worker가 `main/daemon/wiring/router-registration.ts`를 import하면 파일 끝의 `installRouterEnvironment(environment)`가 채운다. `routerFor(tx)`, `routerEnvironment()`가 이를 읽어 command·read마다 `createRouter`로 Router를 새로 만든다. 부르는 곳은 `router/commands.ts`, `router/reads.ts`, `apps/tickets/coding/{message,close-call}.ts`, `lophn-agent/register.ts`(`messageRouter`, `messageDirectory`, `failReceivedCalls`)다.

영향: 전역 mutable 상태를 두지 않는 규칙(AGENTS.md)에 어긋난다. import 순서에 기대서, 등록 파일을 import하지 않은 Worker에서는 `unavailable: the router is not wired`가 난다. 한 Worker 안에서 환경을 둘 둘 수 없다.

고치려면: `createRouterRegistration(environment)`이 환경을 받아 command·read를 닫아 두는 것으로 바꾼다. coding와 lophn-agent 쪽 호출자도 환경(또는 Router 만드는 함수)을 인자로 받아야 해서 호출 지점 다섯 곳이 같이 바뀐다. 비용 중간(반나절). 추천: 한다. 규칙 위반이고 지금 호출자가 적을 때 싸다.

닫음: writer·reader Worker가 등록 파일을 import하는 한 한 곳에서만 채워져 지금 틀린 적이 없고, 고치려면 호출 지점 다섯 곳과 Worker 조립을 함께 바꿔야 해서(반나절) 얻는 것보다 비용이 크다. 호출자가 늘어 다른 Worker가 `unavailable: the router is not wired`를 만나면 그때 한다. 이유는 `router/environment.ts` 머리 주석에 이미 있다.

## 본문과 고정 문구를 writer 앞 처리기에서 blob으로 미리 준비한다

```yaml
kind: defect
modules: [packages/core/main, packages/core/router]
closed: kept
guard: 없음
```

지금: 받는 session 기록의 본문이 blob이어야 하는데 tx 안에서는 blob을 못 만든다. 그래서 `main/daemon/wiring/router.ts`의 `createCallBodyPreparer`가 writer 앞에서 call 본문(redaction 포함)과 `FAILURE_TEXTS` 다섯 개(not_found, not_allowed, closed, receiver_ended, lophn_restarted)와 `CANCEL_TEXT`(빈 글)를 `prepareTexts`로 미리 blob에 둔다. `callSend`는 본문에 고정 문구 다섯을 모두 더해서 준비하고, 켤 때 `start`도 `lophn_restarted`를 따로 준비한다.

영향: call 하나를 보낼 때마다 쓰지 않을 수도 있는 고정 문구 blob 쓰기가 같이 돈다. 새 고정 문구나 command를 더하면 이 처리기에도 이름을 더해야 한다(빠뜨리면 tx 안에서 실패).

고치려면:
- A. 고정 문구는 blob 대신 짧은 inline 글로 기록한다. 받는 session 기록의 message 꼴(blob 참조)을 바꾸는 계약 변경이라 읽는 쪽도 같이 고친다. 비용 큼.
- B. 지금처럼 둔다. 고정 문구가 다섯 개뿐이라 실제 비용은 작다.
- 추천: B. 이유를 `createCallBodyPreparer` 주석에 한 줄 더한다.

닫음: 고정 문구가 다섯 개뿐이라 실제 비용이 작고, inline으로 바꾸려면 받는 session 기록의 message 꼴(계약)을 읽는 쪽까지 고쳐야 한다. 이유를 `createCallBodyPreparer` 주석에 둔다.

## commit 뒤 할 일(after-commit) 길

```yaml
kind: defect
modules: [packages/core/storage, packages/core/router, packages/core/main, packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: command는 writer Worker에서 돌고 입력함과 Bus는 main thread에 있다. tx가 "commit 뒤 할 일"을 `storage/ledger/after-commit.ts`에 모아 `CommandSuccess.after_commit`(`writer-message.ts`, `writer-worker.ts`)에 싣고, main이 `run-loop/work.ts`의 `createInboxApplier`로 commit 뒤에 입력함과 Bus에 적용한다. 되돌린 tx나 재전달이면 버린다. 켤 때(`wiring/router.ts`의 `start`)도 같은 길을 쓴다.

영향: 가장 단순한 구현보다 무겁다. 입력함이 Worker에서 보이지 않는 한 이 길이 없으면 "tx는 commit됐는데 입력이 안 들어간" 틈이 생긴다. 대안(입력함을 표로 옮기기)이 durable queue라 architecture 문서가 막은 방향이다.

고치려면: 추천: 남긴다(kept). 이유(입력함·Bus는 main thread, command는 Worker)는 `after-commit.ts` 머리 주석에 한 문단으로 둔다.

닫음: 입력함·Bus는 main thread, command는 Worker라서 이 길이 없으면 tx는 commit됐는데 입력이 안 들어간 틈이 생긴다. 대안(입력함을 표로)은 durable queue라 architecture 문서가 막았다. 이유는 `after-commit.ts` 머리 주석에 둔다.

## 켤 때 `RecoverCalls`가 별도 command다

```yaml
kind: defect
modules: [packages/core/router]
closed: kept
guard: 없음
```

지금: 켤 때 main이 `RecoverCalls`(`router/commands.ts`의 `recoverCallsCommand`, core 자격만)를 한 번 부른다. `failLostOnStart`가 `accepted`이고 `consumed = 0`인 call을 `lophn_restarted`로 닫고 보낸 session에 알리며, `interruptRunningTurns`로 돌던 turn도 같은 tx에서 `interrupted`로 닫는다. 같은 시점에 `coding/recover.ts`의 `recoverCoding`이 앱 줄과 대기열 표를 비운다.

영향: 별도 command 하나, 별도 route 하나, 켤 때 호출 순서(agent runtime이 turn을 읽기 전)에 기댄다. 대신 입력함·앱 줄이 꺼지면 사라지는 대신 조용히 사라지는 call이 없다는 보장이 이 한 곳에서 선다.

고치려면: 추천: 남긴다(kept). 입력함이 메모리인 한 켤 때 정산은 필요하고, 합칠 만한 기존 command가 없다.

닫음: 입력함이 메모리인 한 켤 때 정산은 필요하고 합칠 만한 기존 command가 없다.

## 가져간 call 글이 뒤 turn의 history에서 태그 없이 원문으로 들어간다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
closed: fixed
guard: packages/core/lophn-agent/run-loop/input-text_test.ts
```

지금: 받은 call·reply·notice는 그 turn의 입력일 때만 `packages/core/lophn-agent/run-loop/input-text.ts`의 `wrap`으로 `<lophn-call ...>` 같은 태그에 싸인다. 다음 turn부터는 `packages/core/lophn-agent/session/history.ts`의 `readSessionConversation`이 session 기록의 본문을 그대로 history에 넣는다. 그래서 "다른 agent가 보낸 것이고 이 session의 권한 안에서만 따른다"는 표지가 그 turn이 끝나면 사라진다. `tests/e2e/agent-call_test.ts`의 `inbox-order`를 고치며 찾았다(아직 가져가지 않은 call이 prompt에 섞이는 것은 고쳤다).

영향: 다른 agent(AI가 만든 글)가 보낸 지시가 다음 turn부터는 사람의 글과 구별되지 않는다. agent가 그 지시를 사람의 요청처럼 따를 수 있다.

고치려면:
- history도 입력과 같은 규칙으로 싼다(중간): `history.ts`가 message의 출처(`from_kind`, call·reply·reaction)에 따라 `input-text.ts`의 같은 함수로 본문을 싼다. compact 요약, rewind, fork처럼 history를 쓰는 모든 prompt가 같이 바뀐다.
- 그대로 둔다: 표지는 받은 turn에만 있다는 것을 architecture에 적는다.
- 추천: history도 싼다. 막는 것이 "AI가 만든 글"이라 AGENTS.md "속도"의 남기는 쪽이다.

닫음: `history.ts`가 사람 메시지가 아닌 받은 메시지를 `input-text.ts`의 `receivedText`로 싼다. 입력 종류는 봉투(`from`, `call`, `reply_to`)에서 되짚는다. compact와 prompt 조립은 `readSessionConversation`을 거쳐 같이 바뀐다.

## 받은 turn의 입력과 뒤 turn의 history가 bytes로 다르다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: packages/core/lophn-agent/run-loop/input-text_test.ts
```

지금: 받은 turn의 입력은 call의 답 방식(`reply`), reaction의 event type, 실패 답의 이유를 태그 속성에 싣는다(`packages/core/lophn-agent/run-loop/input-text.ts`). 뒤 turn의 history는 session 기록에 그 칸이 없어 `receivedText`가 속성을 비운다(`packages/core/lophn-agent/session/history.ts`). 태그와 escape는 같다.

영향: call·reaction을 받은 turn 다음 요청부터 그 메시지 자리의 prefix가 달라져 cache miss가 한 번 난다. 고치기 전(history가 원문)에도 같았다.

고치려면: 받은 turn의 입력도 history와 같은 속성만 싣는다(작음. 답 방식은 call tool 결과나 본문 한 줄로 알린다). 또는 messages 행에 답 방식과 event type을 저장한다(중간, schema 변경). 추천: 앞의 것.

닫음: 받은 봉투와 `messages` 표가 `reply`, `event`, `fail_reason`을 싣고, `receivedText`가 그것으로 받은 turn의 입력과 같은 글을 만든다. 답 방식 속성과 "answer with the reply tool" 줄은 그대로다. 개발 data는 새로 만든다.
