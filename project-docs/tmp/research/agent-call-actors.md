# agent call protocol: 고전 messaging 설계 조사

조사일 2026-10-14. 모두 공식 문서를 직접 읽었다(코드는 읽지 않음). 문서에서 확인하지 못한 내용은 "(미확인)"으로 표시했다.

lophn 축: (1) 어디로: 새 session(spawn) / 열린 session(address). (2) reply: none / 결과 하나 / conversation. (3) sender는 turn을 block하지 않고 reply는 새 input으로 온다.

---

## 1. Erlang/OTP

출처:
- https://www.erlang.org/doc/apps/stdlib/gen_server.html
- https://www.erlang.org/doc/system/ref_man_processes.html

- fire-and-forget: `Pid ! Msg` 또는 `gen_server:cast`. cast는 서버나 node가 없어도 `ok`를 바로 돌려준다. 실패를 알려주지 않는다.
- request-reply: `gen_server:call`. 서버는 `handle_call`의 return 또는 나중의 `reply(From, Reply)`로 답한다. `{noreply, State}`로 답을 미루고 나중에 `reply/2`를 보낼 수 있다. 이게 "답은 나중에, 서버는 계속 일한다"의 원형이다.
- 비동기 call: `send_request/2`가 request id를 돌려주고, `receive_response` / `wait_response` / `check_response`로 나중에 받는다. 여러 request를 collection(`reqids`)으로 묶는다. `receive_response`는 timeout이면 request를 포기하고(늦은 reply는 무시), `wait_response`는 포기하지 않아 다시 기다릴 수 있다.
- reply address와 correlation: reply 주소는 `From`(pid + monitor/alias reference)이다. OTP 24부터 call은 process alias를 쓰므로 timeout 뒤 늦은 reply는 받지 않는다("Starting with OTP 24, gen_server:call uses process aliases, so late replies will not be received."). 그 전에는 늦은 `{Ref, Reply}`가 mailbox에 남아 caller가 버려야 했다.
- blocking: call은 caller process를 block한다. 기본 timeout은 5000ms이고 `infinity`도 된다. timeout이면 caller가 `{timeout, {gen_server, call, Args}}`로 exit한다.
- 죽음 처리: call 중 서버가 죽으면 caller가 exit한다. reason은 `noproc`(이름 없음 또는 이미 종료), `{nodedown, N}`, `shutdown`, 그 밖의 exit reason이다. monitor는 대상이 이미 없으면 즉시 `{'DOWN', Ref, process, Pid, noproc}`을 보낸다. link는 양방향이고 exit signal을 전파한다. monitor는 단방향이고 독립적이다.
- 주소: pid(id) 또는 registered name(atom). `{global, Name}`, `{via, Mod, Name}`으로 자기 registry를 꽂을 수 있다. 이름은 프로세스가 죽으면 자동으로 풀린다.
- 생성: 이름으로 보내도 없으면 만들어 주지 않는다. spawn은 명시적이다(`start_link`). 이름이 이미 있으면 `{error, {already_started, Pid}}`.
- 보장: 같은 sender에서 같은 receiver로 가는 signal의 순서만 보장한다. 받는 쪽이 죽었으면 signal은 그냥 사라진다. 로컬 registered name이 없으면 `!`는 동기로 실패한다(`badarg`).
- cancellation: 언어 차원의 cancel은 없다. `exit(Pid, Reason)`, link, monitor, supervisor로 프로세스를 끄는 것이 전부다. 요청 하나를 취소하는 개념은 앱이 만든다.

## 2. Akka (Typed)

출처:
- https://doc.akka.io/libraries/akka-core/current/typed/interaction-patterns.html
- https://doc.akka.io/libraries/akka-core/current/general/message-delivery-reliability.html
- https://doc.akka.io/libraries/akka-core/current/typed/actor-lifecycle.html

- fire-and-forget: `tell`(`!`). 도착, 처리, 실패 어느 것도 sender에게 알려주지 않는다. inbox가 차면 결국 OutOfMemoryError가 날 수 있다고 문서가 경고한다.
- request-reply: 요청 message 안에 `replyTo: ActorRef[Response]` 필드를 넣는다. 받는 쪽은 그 주소로 답을 `tell`한다. 문서가 직접 말하는 약점: sender가 유실이나 미처리를 쉽게 알 수 없고, 답을 맥락에 연결하려면 request id나 per-session actor가 필요하다.
- reply를 안 받기: `system.ignoreRef`를 replyTo로 넘기면 request-response가 fire-and-forget이 된다. 같은 프로토콜로 두 mode를 다 쓰는 방법이다. (바깥 ask에 쓰면 future가 영영 안 끝나 timeout이 난다.)
- adapted response: `context.messageAdapter`가 상대의 응답 타입을 내 프로토콜 message로 바꾼다. message class마다 adapter는 하나다. adapter가 예외를 던지면 actor가 멈춘다.
- ask: `context.ask`(actor 사이) 또는 바깥 `ask`(Future)가 임시 replyTo를 만들어 요청을 보내고, 결과나 실패를 내 message로 바꿔 mailbox로 돌려보낸다. 즉 sender turn은 block되지 않고 reply가 새 message로 온다. 이것이 lophn 축 (3)과 정확히 같은 모양이다. timeout은 caller가 정한다. 문서 인용: "When `ask` times out, the receiving actor does not know and may still process it to completion."
- `askWithStatus`와 `StatusReply`(Success / Error / Ack)로 성공, 실패, payload 없는 ack을 한 타입으로 표현한다.
- pipeToSelf: 비동기 결과(Future)를 자기 message로 바꿔 자기 mailbox에 넣는다. 상태 접근이 한 줄로 직렬화된다. 대가는 wrapper message 타입이 늘어나는 것이다.
- conversation: 여러 번 오가는 일은 요청 하나당 임시 자식 actor(per-session child)가 맡고 끝나면 stop한다. 문서 경고: 자식 lifecycle을 관리하지 않으면 자원이 샌다.
- 주소: `ActorRef`(path + uid). 이름이 아니라 참조를 message에 실어 보낸다. 참조는 actor 생명과 묶여 있어 재시작 후 같은 참조를 쓰려면 별도 장치(cluster sharding 등)가 필요하다(이 조사에서는 미확인).
- 죽음: `context.watch(other)`가 `Terminated` signal을 보낸다. 이미 죽은 actor를 watch해도 `Terminated`가 온다("independent of the order in which registration and termination occur"). `watchWith(other, msg)`는 내가 정한 message를 대신 보낸다. 임시 재시작에서는 안 온다.
- 보장: at-most-once("no guaranteed delivery"). 같은 sender-receiver 쌍은 순서가 유지되지만 transitive하지 않다.
- missing receiver: 종료된 actor에게 보낸 message는 best-effort로 `/deadLetters`로 간다. sender에게는 오류가 가지 않는다. event stream에서 `DeadLetter`를 구독해 볼 수 있다. 문서는 dead letter가 debugging용이고 guaranteed delivery를 만드는 데 쓸 수 없다고 못 박는다.
- cancellation: 요청 cancel 개념은 없다. actor를 stop하거나 ask timeout을 쓴다.

## 3. Microsoft Orleans

출처:
- https://learn.microsoft.com/en-us/dotnet/orleans/overview
- https://learn.microsoft.com/en-us/dotnet/orleans/grains/
- https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-identity
- https://learn.microsoft.com/en-us/dotnet/orleans/grains/request-scheduling
- https://learn.microsoft.com/en-us/dotnet/orleans/implementation/messaging-delivery-guarantees
- https://learn.microsoft.com/en-us/dotnet/api/orleans.concurrency.onewayattribute

- request-reply: grain method는 모두 `Task` / `Task<T>` / `ValueTask<T>`를 돌려준다. `await`은 thread를 block하지 않지만, 논리적으로는 호출 쪽 grain이 그 turn 안에서 답을 기다린다. 기본은 non-reentrant라서 A가 B를 await하는 동안 A는 다른 요청을 처리하지 못한다. A와 B가 서로 호출하면 deadlock이 나고 결국 timeout으로 풀린다(문서의 Case 2).
- fire-and-forget: `[OneWay]` method("no response message will be sent to the caller"). 반환 타입은 그대로 Task이지만 응답 message가 오지 않으므로 실패도 알 수 없다. 같은 호출 모양에 reply 유무를 attribute로 얹었다.
- conversation: 1급 개념 없음. grain이 서로의 reference를 들고 method를 번갈아 호출해서 만든다. `[AlwaysInterleave]`, `[Reentrant]`, `AllowCallChainReentrancy()`는 호출 cycle에서 deadlock을 피하려는 장치다.
- reply address와 correlation: runtime이 숨긴다. 앱은 request id를 직접 다루지 않는다.
- timeout: 모든 message에 자동 timeout이 있다. 기본 30초. method마다 `[ResponseTimeout]`로 바꿀 수 있다. 문서의 timeout best practice: 오래 걸리는 일은 timeout을 늘리지 말고 Reminders(영속 timer)를 쓰라.
- 주소: 논리 identity = grain type + key(`shoppingcart/bob65`). key는 Guid, long, string, 복합 키 중 호출자가 정한다. 단일 인스턴스는 `"default"` 같은 약속된 값을 쓴다. Guid key는 "새 job을 만들 때" 쓰라고 문서가 권한다.
- 생성: virtual actor. 존재를 만들거나 지우지 않는다("An actor cannot be explicitly created nor destroyed"). 처음 호출될 때 runtime이 activate하고 안 쓰면 내려서 메모리를 비운다. 그래서 reference는 "full system restart" 뒤에도 유효하고 저장해 둘 수 있다. 같은 호출이 "새로 만들기"와 "있는 것 부르기"를 겸한다. 호출자는 둘을 구분하지 않는다.
- 보장: 기본 at-most-once. 자동 retry는 꺼져 있다. retry를 켜면 중복 도착이 가능하고, Orleans는 "which messages have already arrived"를 영속 저장하지 않는다. 문서가 이유를 "quite costly"라고 쓴다.
- missing receiver: 개념상 없다. 항상 주소가 있기 때문이다. 대신 activation 실패나 timeout이 `Task` 예외로 돌아온다. `[OneWay]`는 이것도 모른다.
- 오류: grain method의 예외는 호출 stack을 타고 호출자에게 전파된다. 예외가 나도 grain은 deactivate되지 않는다(`InconsistentStateException` 제외).
- cancellation: 9.x부터 grain method에 `CancellationToken`을 넘길 수 있다(overview의 9.x 항목, 문서에서 세부 동작은 미확인).
- 상태와 영속: grain 상태는 storage에 저장해 두고 activation 때 읽는다. 앱이 재시작해도 같은 identity로 이어 간다. 이 점이 lophn session과 가장 닮았다.

## 4. Enterprise Integration Patterns (Hohpe/Woolf)

출처 (모두 https://www.enterpriseintegrationpatterns.com/patterns/messaging/ 아래): RequestReply.html, ReturnAddress.html, CorrelationIdentifier.html, MessageExpiration.html, DeadLetterChannel.html, ProcessManager.html, DocumentMessage.html

- fire-and-forget: 답 channel 없이 message만 보낸다. Command Message(해라) / Document Message(data만 넘긴다, 처리는 받는 쪽이 정한다) / Event Message(일어났다). lophn의 "none"은 이 셋 중 하나로 부르면 된다.
- request-reply: "한 쌍의 message, 각각 자기 channel". request channel(point-to-point 또는 pub-sub)과 reply channel(거의 항상 point-to-point).
- 동기 대 비동기 reply: 문서가 둘을 직접 비교한다.
  - Synchronous Block: sender thread가 block한다. 단순하지만 sender가 죽으면 block된 thread를 되살리기 어렵고, outstanding request가 thread마다 하나로 제한된다.
  - Asynchronous Callback: 요청을 보내고 callback을 등록한다. 별도 thread가 reply를 받아 callback을 부른다. 한 reply channel을 여러 요청이 나눠 쓸 수 있고, 죽은 requestor는 reply thread를 다시 띄워 복구한다. 대가는 callback에서 caller 맥락을 되살리는 복잡함이다.
- Return Address: requestor가 request header에 "답을 보낼 channel"을 적는다. replier에 답 주소를 하드코딩하지 않는다. 주소는 business data가 아니라 routing metadata이므로 header에 둔다.
- Correlation Identifier: 요청마다 unique request ID를 넣고, replier가 그 값을 reply의 correlation ID로 복사한다. requestor는 이걸로 reply를 원래 요청에 잇는다.
- Message Expiration: sender가 유효 기간을 정한다. 만료된 message는 없었던 것처럼 무시된다. 대부분 시스템은 만료 message를 Dead Letter Channel로 옮기고, 일부는 버린다. 받는 쪽이 처리 전에 만료됐음을 알면 버려야 한다.
- Dead Letter Channel: 시스템이 전달할 수 없거나 안 해야 한다고 판단한 message를 옮기는 곳. 어디서 죽었는지와 원래 목적 channel을 기록할 수 있다. 수신자가 없는 경우를 이 페이지가 직접 다루지는 않는다(미확인). 일반 원칙으로 그리 보낸다.
- Process Manager: 중앙 manager가 순서의 상태를 갖고, 중간 결과를 보고 다음 단계를 정한다. 모든 traffic이 hub를 지나서 bottleneck이 될 수 있다. 이 페이지는 correlation 방법을 설명하지 않는다(미확인). 책을 보라고 한다.
- 이름, role 주소: Point-to-Point Channel은 이름 있는 channel 하나를 competing consumer가 나눠 가진다(채널 이름이 role 주소 역할). 위 페이지들에서는 직접 확인하지 않았다.
- 보장: Guaranteed Delivery는 별도 pattern이다. channel을 영속 저장소로 받쳐서 보장한다(Document Message 페이지에서 언급).
- cancellation: 이 pattern 모음에는 없다.

## 5. Temporal

출처:
- https://docs.temporal.io/encyclopedia/workflow-message-passing
- https://docs.temporal.io/sending-messages
- https://docs.temporal.io/child-workflows
- https://docs.temporal.io/activity-execution
- https://docs.temporal.io/encyclopedia/workflow/cancellation-and-termination (검색 결과 요약만 읽음)

- fire-and-forget: Signal. "asynchronous write requests", sender는 결과나 예외를 기다릴 수 없다. worker가 떠 있어야 하는 것도 아니다.
- request-reply: Update. 동기, tracked write. sender가 완료나 실패를 기다린다. `startUpdate`는 handle을 돌려주고 Accepted(worker가 받았고 영속됨) 또는 Completed 단계까지 기다릴지 고른다. 즉 call 상태 sent / accepted / done을 API가 구분한다. Query는 read-only, 완료된 workflow에도 된다.
- 주소: Workflow ID(사람이 정하는 business key). Child의 ID를 hostname 같은 resource에 1:1로 대응시키면 그 resource에 대한 작업이 직렬화된다고 문서가 쓴다.
- 생성: Signal-With-Start. 해당 ID의 running execution이 있으면 거기로 Signal을 보내고, 없으면 새로 시작해서 바로 Signal을 준다. 한 호출로 "있으면 보내고 없으면 만들기"가 된다(virtual actor와 같은 효과). Update-With-Start는 원자적이지 않다. `WorkflowIDConflictPolicy`가 필요하고 Workflow ID와 Update ID가 idempotency key다.
- 재시작: Workflow는 event history로 복구된다. Update가 Accepted되면 history에 쓰인다("Accepted Updates write an entry to the Workflow Event History"). Signal이 history에 남는다는 점은 내가 알던 사실이지만 읽은 페이지에서는 확인하지 못했다(미확인).
- child workflow: parent가 spawn을 await하고, 결과는 선택적으로 await한다. Parent Close Policy(ABANDON 등)가 parent 종료 시 child의 운명을 정한다. parent와 child는 상태를 공유하지 않고 Signal로만 통신한다. parent가 Continue-As-New하면 진행 중인 child는 넘어가지 않는다.
- async activity completion: activity가 완료하지 않고 return하면 외부 시스템이 나중에 Temporal Client로 heartbeat와 결과를 보내 끝낸다. 식별은 Task Token 또는 Activity ID + Workflow ID. Task Token은 retry마다 달라 stale해질 수 있어서 ID 쌍이 낫다고 문서가 말한다. 긴 대기에는 Signal이 낫다고 한다.
- timeout: activity에는 Schedule-To-Close, Start-To-Close, Heartbeat가 있다. Heartbeat timeout이 지나면 activity를 실패로 본다. 유실 감지는 Start-To-Close가 맡는다. "몇 분 안에 끝나지 않으면 heartbeat하라"고 권한다. 긴 일에는 전체 timeout 대신 "살아 있다는 신호"를 본다.
- cancellation: 요청이다. 서비스가 workflow에 cancel을 전하고 workflow code가 정리하거나 무시할 수 있다(cooperative). Terminate는 강제라 정리 없이 닫힌다. 문서는 cancel을 기본으로 권한다. activity가 cancel을 받으려면 heartbeat해야 한다. 취소는 execution당 한 번만 요청할 수 있다.
- 보장: Signal 도달은 history에 기록되므로 worker가 죽어도 이어진다(위 미확인 단서 참조). 닫힌 workflow에 Signal을 보낼 때의 동작은 읽은 페이지에서 확인하지 못했다(미확인).

---

## 비교표

| 축 | Erlang/OTP | Akka Typed | Orleans | EIP | Temporal |
|---|---|---|---|---|---|
| fire-and-forget | `!`, `cast` | `tell`, `ignoreRef` | `[OneWay]` | Command / Document / Event Message | Signal |
| 답 하나 | `call`, `send_request` | `replyTo` message, `ask` | `Task<T>` 반환 | Request-Reply + Return Address + Correlation ID | Update, child result, async activity completion |
| conversation | 앱이 만듦(Pid 교환) | per-session child actor | grain이 서로 호출 | Process Manager | workflow 안 Signal 교환, child workflow |
| reply 주소 | `From`(pid+alias ref) | message 안 `replyTo: ActorRef` | runtime이 숨김 | header의 Return Address | caller handle / workflow ID |
| correlation | alias / monitor ref | request id 또는 임시 actor | runtime 내부 | Correlation Identifier | Update ID, Activity ID + Workflow ID |
| sender block | call만 block (5s 기본) | tell / ask 안 block, 답은 mailbox로 | await은 thread를 안 막지만 turn은 막힘 | sync block 또는 async callback 중 선택 | Signal 안 block, Update는 stage 선택 |
| timeout | call timeout | ask timeout(수신자는 모름) | 기본 30s, method별 지정 | Message Expiration | activity: Schedule / Start / Heartbeat |
| 수신자 죽음 | `noproc` exit, monitor `DOWN` | `watch` -> `Terminated`, dead letter | 재activate, timeout 예외 | Dead Letter Channel | history로 복구 |
| 주소 | pid 또는 registered name | ActorRef | type + key (논리 identity) | channel 이름 | Workflow ID |
| 없으면 생성 | 아니오(`spawn` 명시) | 아니오(`spawn` 명시) | 예(활성화 on demand) | 해당 없음 | Signal-With-Start |
| 보장 | 순서만, 유실 가능 | at-most-once | 기본 at-most-once, retry 켜면 at-least-once | Guaranteed Delivery는 별도 pattern | history 기반 복구 |
| 없는 수신자 | send는 조용히 사라짐, call은 `noproc` | dead letter(sender는 모름) | 없는 상태가 없음 | Dead Letter Channel | 닫힌 workflow는 미확인 |
| cancellation | exit / supervisor | actor stop | `CancellationToken` | 없음 | cancel(협조) / terminate(강제) |
| 재시작 후 | 프로세스 사라짐 | actor 사라짐(영속 별도) | identity로 유지 | broker 구현에 따름 | event history로 유지 |

---

## lophn에 비춰 본 점

- 기본 모양은 Akka의 `ask`에 가깝다. sender turn은 block하지 않고, reply는 새 input으로 sender session의 mailbox에 들어온다. `gen_server:call`의 5초 block과 Orleans의 turn 점유(서로 호출하면 deadlock)는 turn이 분 단위인 agent에는 맞지 않는다. 가져오지 말 것.
- 세 reply mode는 한 envelope로 표현한다. Akka `ignoreRef`처럼 같은 message에 reply mode만 바꾸고(none / one / conversation), 받는 쪽 코드는 같다. Orleans `[OneWay]`는 mode를 호출 모양에 얹은 선례다. 단, none이면 sender는 실패를 알 수 없다(tell과 `[OneWay]` 공통). lophn은 call state(sent / accepted / done / failed / cancelled)를 따로 남겨서 이 구멍을 막는다. Temporal Update의 Accepted / Completed 구분이 같은 생각이다.
- envelope에 `replyTo`와 correlation id를 명시한다. EIP의 Return Address(header의 routing metadata)와 Correlation Identifier(요청 id를 reply가 복사)가 그대로 맞는다. Erlang은 late reply 문제를 겪고 OTP 24에서 alias로 고쳤다. Akka는 "reply를 맥락에 잇는 일"이 앱 몫이라고 문서에서 밝힌다. lophn은 call id를 DB에 두면 reply가 app 재시작 뒤에 와도 어느 call의 답인지 알 수 있다. Akka의 참조나 Erlang의 pid/reference는 프로세스 수명과 묶여 이 점에서 약하다.
- 주소는 session id를 기본으로 하고, role@place 같은 논리 주소는 resolve 단계로 얹는다. Orleans는 논리 identity(type + key)를 쓰고 "reference는 restart 뒤에도 유효하며 저장해도 된다"고 한다. Temporal은 Signal-With-Start로 "있으면 보내고 없으면 만든다"를 한 호출에 묶는다. 이 방식은 spawn과 address 두 축을 하나로 합친다. 다만 LLM session은 만들 때마다 token과 context 비용이 들고 같은 role이 여럿 있을 수 있어, 호출자가 의도를 모르면 매번 새로 만들거나 엉뚱한 곳으로 가는 사고가 난다. 그래서 spawn과 address를 envelope에서 명시적으로 나누고(Erlang, Akka처럼 `spawn`이 명시), role@place 조회는 "열린 session이 있으면 그것, 없으면 실패 또는 spawn"을 호출자가 고르게 하는 편을 추천한다. 한 호출 안의 자동 create-on-demand는 비용 문제로 기본값으로 두지 않는다.
- timeout 대신 상태와 신호를 쓴다. 5초나 30초 timeout은 agent turn에 의미가 없다. Orleans 문서도 긴 일에는 timeout을 늘리지 말고 Reminders(영속 timer)를 쓰라고 하고, Temporal은 heartbeat를 권한다. lophn에서는 receiver session의 상태(running, idle)와 마지막 event 시각을 보고 "아직 일하는 중"과 "죽음"을 가른다. 그 위에 선택적 만료 시각(EIP Message Expiration)을 envelope에 둔다. 만료되면 받는 쪽은 처리하지 않고 call을 failed(expired)로 닫는다. Akka 문서가 경고하듯 ask timeout은 수신자가 모르게 일을 계속 시키므로, sender가 포기해도 receiver가 일을 이어 가는 낭비를 cancel과 연결해야 한다.
- 수신자가 없을 때는 즉시 failure를 돌려준다. Akka dead letter는 sender에게 오류를 안 알리고 문서도 "guaranteed delivery에 못 쓴다"고 한다. Erlang `cast`도 조용히 `ok`다. 두 쪽 모두 agent에게는 나쁜 설계다. agent는 오류 message를 읽고 다음 판단을 할 수 있으니 Erlang monitor의 `DOWN(noproc)`처럼 "없다"를 새 input으로 sender에게 보낸다. dead letter 기록은 사람이 볼 로그(EIP Dead Letter Channel)로만 따로 남긴다.
- 보장은 at-most-once를 기본으로 하되 call 기록은 SQLite에 영속한다. Orleans가 "중복 도착을 억제하려면 영속 기록이 필요하고 비싸다"고 쓴 그 영속 기록을 lophn은 이미 가진다. 입력 하나가 LLM turn 하나이므로 중복 delivery는 중복 token 비용이다. call id를 idempotency key로 쓰면 재시작 뒤 같은 call을 두 번 넣지 않을 수 있다(Temporal Update ID와 같은 역할). Orleans의 "retry를 켜면 at-most-once가 깨진다"는 점을 그대로 의식하고, 자동 retry는 두지 않는다.
- cancellation은 요청으로 만든다. Temporal처럼 cancel은 cooperative 요청이고 terminate와 분리한다. receiver session은 cancel을 새 input으로 받아 정리하거나 무시할 수 있다. call state는 cancelled(요청됨)와 닫힘을 구분하는 편이 안전하다. cancel은 call당 한 번만 허용해도 된다(Temporal activity의 규칙).
- conversation은 Akka의 per-session child처럼 call 하나에 대화 하나를 묶고, 양쪽 중 한 쪽이 닫을 때까지 같은 correlation(reply_to)을 유지한다. EIP Process Manager 경고처럼 모든 traffic을 한 hub에 모으지 말고(bottleneck, 단일 장애), 대화 당사자가 직접 주고받게 하는 편이 낫다. 닫히지 않은 conversation은 Akka 문서가 경고한 "자원 누수"가 되므로 최대 길이나 만료 같은 종료 장치를 envelope에 둔다.
- 베끼지 말 것: (a) 동기 call과 기본 timeout(Erlang, Orleans). (b) dead letter로 조용히 버리기(Akka). (c) 보이지 않는 자동 activation(Orleans)을 token 비용이 큰 session spawn에 그대로 쓰기. (d) pid나 ActorRef처럼 프로세스 수명에 묶인 주소(재시작에 약함). (e) 모든 흐름을 중앙 Process Manager로 몰기.

## 한계

- 코드는 읽지 않았고 문서만 읽었다. Akka ask의 내부 구현, Orleans 호출 경로, Temporal 서버 구현은 확인하지 않았다.
- Temporal에서 Signal이 event history에 남는다는 점, 닫힌 workflow에 Signal을 보냈을 때의 동작은 읽은 페이지로는 확인하지 못했다. 필요하면 docs.temporal.io의 Event History 페이지를 더 읽어야 한다.
- Akka 쪽은 Cluster Sharding(identity로 주소 지정)을 읽지 않았다. 필요하면 "address by id, create on demand"의 Akka 판으로 추가 조사할 가치가 있다.
- EIP는 구현이 아니라 vocabulary다. 위 표의 EIP 열은 pattern 이름이지 보장 수준이 아니다.
