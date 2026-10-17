# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.

## Router·command·read를 요청마다 만들고 `RouterEnvironment`를 전역에 놓는다

```yaml
kind: defect
modules: [packages/core/router, packages/core/main]
```

지금: `router/environment.ts`가 모듈 변수 `installed`를 두고, writer·reader Worker가 `main/daemon/wiring/router-registration.ts`를 import하면 파일 끝의 `installRouterEnvironment(environment)`가 채운다. `routerFor(tx)`, `routerEnvironment()`가 이를 읽어 command·read마다 `createRouter`로 Router를 새로 만든다. 부르는 곳은 `router/commands.ts`, `router/reads.ts`, `apps/tickets/coding/{message,close-call}.ts`, `lophn-agent/register.ts`(`messageRouter`, `messageDirectory`, `failReceivedCalls`)다.

영향: 전역 mutable 상태를 두지 않는 규칙(AGENTS.md)에 어긋난다. import 순서에 기대서, 등록 파일을 import하지 않은 Worker에서는 `unavailable: the router is not wired`가 난다. 한 Worker 안에서 환경을 둘 둘 수 없다.

고치려면: `createRouterRegistration(environment)`이 환경을 받아 command·read를 닫아 두는 것으로 바꾼다. coding와 lophn-agent 쪽 호출자도 환경(또는 Router 만드는 함수)을 인자로 받아야 해서 호출 지점 다섯 곳이 같이 바뀐다. 비용 중간(반나절). 추천: 한다. 규칙 위반이고 지금 호출자가 적을 때 싸다.

## 본문과 고정 문구를 writer 앞 처리기에서 blob으로 미리 준비한다

```yaml
kind: defect
modules: [packages/core/main, packages/core/router]
```

지금: 받는 session 기록의 본문이 blob이어야 하는데 tx 안에서는 blob을 못 만든다. 그래서 `main/daemon/wiring/router.ts`의 `createCallBodyPreparer`가 writer 앞에서 call 본문(redaction 포함)과 `FAILURE_TEXTS` 다섯 개(not_found, not_allowed, closed, receiver_ended, lophn_restarted)와 `CANCEL_TEXT`(빈 글)를 `prepareTexts`로 미리 blob에 둔다. `callSend`는 본문에 고정 문구 다섯을 모두 더해서 준비하고, 켤 때 `start`도 `lophn_restarted`를 따로 준비한다.

영향: call 하나를 보낼 때마다 쓰지 않을 수도 있는 고정 문구 blob 쓰기가 같이 돈다. 새 고정 문구나 command를 더하면 이 처리기에도 이름을 더해야 한다(빠뜨리면 tx 안에서 실패).

고치려면:
- A. 고정 문구는 blob 대신 짧은 inline 글로 기록한다. 받는 session 기록의 message 꼴(blob 참조)을 바꾸는 계약 변경이라 읽는 쪽도 같이 고친다. 비용 큼.
- B. 지금처럼 둔다. 고정 문구가 다섯 개뿐이라 실제 비용은 작다.
- 추천: B. 이유를 `createCallBodyPreparer` 주석에 한 줄 더하고 이 절을 닫는다(kept).

정한 것: 다이어트 계획에서 줄일지 정한다.

## commit 뒤 할 일(after-commit) 길

```yaml
kind: defect
modules: [packages/core/storage, packages/core/router, packages/core/main, packages/core/lophn-agent]
```

지금: command는 writer Worker에서 돌고 입력함과 Bus는 main thread에 있다. tx가 "commit 뒤 할 일"을 `storage/ledger/after-commit.ts`에 모아 `CommandSuccess.after_commit`(`writer-message.ts`, `writer-worker.ts`)에 싣고, main이 `run-loop/work.ts`의 `createInboxApplier`로 commit 뒤에 입력함과 Bus에 적용한다. 되돌린 tx나 재전달이면 버린다. 켤 때(`wiring/router.ts`의 `start`)도 같은 길을 쓴다.

영향: 가장 단순한 구현보다 무겁다. 입력함이 Worker에서 보이지 않는 한 이 길이 없으면 "tx는 commit됐는데 입력이 안 들어간" 틈이 생긴다. 대안(입력함을 표로 옮기기)이 durable queue라 architecture 문서가 막은 방향이다.

고치려면: 추천: 남긴다(kept). 이유(입력함·Bus는 main thread, command는 Worker)는 `after-commit.ts` 머리 주석에 한 문단으로 둔다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## 켤 때 `RecoverCalls`가 별도 command다

```yaml
kind: defect
modules: [packages/core/router]
```

지금: 켤 때 main이 `RecoverCalls`(`router/commands.ts`의 `recoverCallsCommand`, core 자격만)를 한 번 부른다. `failLostOnStart`가 `accepted`이고 `consumed = 0`인 call을 `lophn_restarted`로 닫고 보낸 session에 알리며, `interruptRunningTurns`로 돌던 turn도 같은 tx에서 `interrupted`로 닫는다. 같은 시점에 `coding/recover.ts`의 `recoverCoding`이 앱 줄과 대기열 표를 비운다.

영향: 별도 command 하나, 별도 route 하나, 켤 때 호출 순서(agent runtime이 turn을 읽기 전)에 기댄다. 대신 입력함·앱 줄이 꺼지면 사라지는 대신 조용히 사라지는 call이 없다는 보장이 이 한 곳에서 선다.

고치려면: 추천: 남긴다(kept). 입력함이 메모리인 한 켤 때 정산은 필요하고, 합칠 만한 기존 command가 없다. archived로 닫는다(kept).

정한 것: 다이어트 계획에서 줄일지 정한다.
