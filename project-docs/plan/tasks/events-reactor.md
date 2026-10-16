# events-reactor

Reactor를 만든다. Ledger의 domain event를 cursor로 이어 읽고 event 종류마다 등록된 handler를 부른다. 꺼졌다 켜지면 cursor 뒤부터 잇고 같은 event에 두 번 반응하지 않는다. 새 일을 여는 domain event 다섯의 공통 handler(reaction grant를 보고 끔, 열고 묻지 않음, 물음으로 가른다)도 이 task가 둔다.

- 단위: events (wave 3)
- 선행: events-ledger (`createCommitPublisher`, `isDomainEvent`, 줄인 `events` 표), events-bus-gateway (`core/events/mod.ts`, `wiring/events.ts`, 같은 Bus)
- 소유(이 task만 고친다):
  - `packages/core/events/reactor/` (새 폴더)
  - `packages/core/events/subscriber-registration.ts`
  - `packages/core/events/mod.ts` (bus-gateway가 만든 것에 Reactor export를 더한다)
  - `packages/core/storage/ledger/reaction.ts`, `packages/core/storage/ledger/commands.ts`
  - `packages/core/storage/ledger/writer-assembly.ts`·`writer-registration.ts`의 subscriber gate 부분, `tx.ts`의 `advanceSubscriberCursor`
  - wiring file `packages/core/main/daemon/wiring/events.ts` (bus-gateway가 만든 것에 Reactor 줄을 더한다. `events-ledger`가 보고한 `onCommit` 연결 한 줄도 여기서 넣는다)
- 읽을 것:
  - spec: S1 3·5·9·10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`. 새 일 handler의 판정은 S2 4·8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I2.1#4`, `I3.1#6`, `I3.1#7` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 3장 #1(Router는 core에 산다), 2.5의 B1 줄(위험 test)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드(읽기만): `packages/core/storage/ledger/{reaction,commands,tx}.ts`(cursor와 idempotency), `packages/protocol/events/events.ts`(`advanceSubscriberCursor`, `reactionKeySchema`), `packages/core/lophn-agent/assignments/reactions.ts`(옛 반응기의 모양)
- 계약:
  - 쓰는 것: `packages/core/events/ports.ts`의 `Reactor`, `ReactorHandler`, `ReactorContext`. `packages/protocol/events/domain.ts`의 `DOMAIN_EVENTS`, `domainEventEnvelopeSchema`, `DOMAIN_EVENT_KINDS`. `packages/core/approvals/ports.ts`의 `Approvals`(`judge`, `createPending`, `registerApplier`). call 모양은 contract-calls-places의 `callEnvelopeSchema`·`callFromSchema`·`callAgentSchema`(`packages/protocol/lophn-agent/calls.ts`). Router를 부르는 함수는 router-calls(wave 3)가 `core/router/mod.ts`로 내놓는다. 다른 module이 Router를 부를 때는 자기 port를 선언하고 wiring이 끼운다는 규칙에 따라 이 task가 `ReactionRouter` type을 `new-work.ts`에 선언한다(`send(call: 봉투 중 call 제외): Promise<Result<{ call: cal }>>`). Approvals와 ReactionRouter는 이 task에서 fake로 짓는다.
  - 내놓는 것: `createReactor(...)`와 `registerNewWorkHandlers(reactor, { approvals, router, ... })`. 다른 단위는 `reactor.on(type, handler)`로 자기 handler를 등록한다: approvals-requests의 `ApprovalDecided`, coding-agent·router의 call 닫음 handler 셋, releases-problems의 `TicketVerified`.

## 할 일

1. cursor와 idempotency — `core/storage/ledger/{reaction,commands,tx}.ts`, `core/events/subscriber-registration.ts` (`I2.1#4`)
   - Reactor의 cursor는 하나다. 지금의 `subscriber_cursors` 표와 `AdvanceSubscriberCursor` command를 `subscriber = "reactor"` 한 행에 쓴다. 이름 있는 구독자가 여럿이던 일반성은 줄인다: `subscriber-registration.ts`의 gate와 `writer-assembly.ts`의 `subscribers` 모음은 Reactor 하나의 binding만 받게 줄인다. 다른 module이 아직 등록하는 옛 binding은 남아 있으면 지우지 않고 보고한다.
   - 반응의 idempotency key는 handler 단위로 산다: `reactionKey = { subscriber: <handler 이름>, cause_seq: <event seq>, reaction: <handler가 정한 이름> }`. 지금의 `reactionIdempotencyKey`(`core/storage/ledger/reaction.ts`)를 그대로 쓴다. handler가 부르는 command가 이 key를 idempotency key로 쓰면 두 번 불려도 효과가 한 번이다(replay).
2. Reactor — `core/events/reactor/reactor.ts`(새), `I3.1#6`, S1 3·10장
   - `createReactor({ reader, cursor, clock, log })`가 `Reactor`를 돌려주고 `start()`/`stop()`/`wake()`를 가진다.
   - 읽기: `events` 표에서 `seq > cursor`를 256개씩 읽는다. 행을 `domainEventEnvelopeSchema`로 검사한다. `DOMAIN_EVENTS`에 없는 type(지우는 중인 옛 event)과 검사에 실패한 행은 건너뛰고 cursor만 옮긴다(건너뛴 수를 log에 적는다).
   - 반응: event 하나마다 그 type에 등록된 handler를 등록 순서로 차례로 부른다. handler 이름이 같은 두 handler는 등록 때 거절한다. handler가 `ok`를 돌려주면 다음 handler로 간다.
   - 오류: handler가 `unavailable`을 돌려주거나 던지면 cursor를 올리지 않고 같은 event부터 1초에서 30초까지 두 배씩 늘려 다시 한다(최소 한 번). 그 밖의 오류 코드는 log(type, seq, handler 이름, code)를 남기고 그 handler를 끝난 것으로 보고 넘어간다. 한 event의 handler가 모두 끝나면 cursor를 그 seq로 올린다.
   - 깨우기: 시작할 때 한 번, wiring이 Bus의 domain event(commit 뒤)를 받아 부르는 `wake()`, 안전망으로 5초마다 한 번. Bus는 놓칠 수 있으므로 표가 정본이다(S1 4장).
   - 시작 때 정리(`I3.1#10`)는 이 task의 일이 아니다. 아래 "할 일" 5.
3. 새 일 handler — `core/events/reactor/new-work.ts`(새), `I3.1#7`, S1 5장, S2 8장 "domain event로 session 열기"
   - 다섯 event(`ProblemOpened`, `ProblemReopened`, `AppRestartHalted`, `ReleaseActivationFailed`, `ContextViolationFound`)마다 같은 모양의 handler 하나씩 `registerNewWorkHandlers`가 등록한다. 이름은 `new-work:<EventType>`이다.
   - 받는 곳: 앞의 네 event는 그 `payload.app`의 App Engineer 새 session, `ContextViolationFound`는 `payload.project`의 Project Manager 새 session이다(S1 5장 표).
   - 순서: ① `Approvals.judge`에 intent를 넣는다. `kind: "reaction"`, `actor: { kind: "program", seq: event.seq }`, `target: { kind: "reaction", event: type }`, `origin: { kind: "event", seq }`. ② `deny(reaction_off)`면 아무것도 하지 않고 `ok`를 돌려준다. ③ `run`이면 `ReactionRouter.send`로 call을 보낸다: `from` `{ kind: "program", event_seq: event.seq }`(contract-calls-places의 `callFromSchema`), 근거 seq, `to` 새 session의 role과 place, `reply` none, `body`는 program이 쓴 짧은 글(wording key로 만든다. 앱이 쓴 글을 섞지 않는다), `refs`에 근거(`callRefSchema`의 `problem`, `ticket` 가지 중 맞는 것. 맞는 가지가 없는 release·check id는 body 글에 적는다). call 모양은 S3 3장과 contract-calls-places의 봉투를 따른다(`to`는 `{ kind: "new_session", agent }`, `agent`는 `{ role: "app_engineer", app }` 또는 `{ role: "project_manager", project }`). `ContextViolationFound`는 위반 근거를 그 session 입력에 붙여야 하므로 body에 `check` id를 적고 Project Manager가 읽게 한다(첨부 방식은 router가 입력 tag로 정한다). ④ `ask`면 `Approvals.createPending(intent)`를 부른다.
   - 보류 request가 허락되면 다시 검사하고 실행하는 applier를 `registerApplier("reaction", ...)`로 등록한다: request의 intent에서 근거 seq의 event를 다시 읽어 ③과 같은 call을 보낸다. 같은 event에 Router call이 두 번 가지 않는다(call 보내기의 idempotency key는 `new-work:<EventType>`과 근거 seq로 만든다).
   - call 닫음 세 event(`TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`)와 `TicketVerified`, `ApprovalDecided`의 handler는 여기서 만들지 않는다(각 단위가 `reactor.on`으로 등록한다).
4. wiring — `wiring/events.ts`: `createReactor`를 만들어 Bus의 domain event 도착을 `wake()`로 잇고, `registerNewWorkHandlers`를 호출하고, events-ledger가 보고한 `createCommitPublisher`의 `onCommit` 연결을 넣는다. `Approvals`와 `ReactionRouter` 구현은 wiring에서 해당 단위의 것(approvals의 `Approvals`, router의 `send`)을 받아 쓴다. 아직 구현이 없으면 `registerNewWorkHandlers` 호출 줄을 넣지 않고 보고에 적는다(그 단위가 merge될 때 lead가 잇는다).
5. 하지 않는 것(다른 단위 몫): 켤 때 돌던 turn을 interrupted로 닫고 대기 권한 요청·질문을 cancelled로 두는 시작 때 정리(`I3.1#10`)는 run-loop 시작 경로(`core/lophn-agent/run-loop`, `waiting-and-recovery`)에 있어 router 몫이다. 이 task는 Reactor만 시작한다.
6. 위험 test
   - `packages/core/events/reactor/reactor_test.ts` 하나, 이름은 "꺼졌다 켜지면 Reactor가 cursor 뒤부터 이어 반응하고 같은 event에 두 번 반응하지 않는다". SQLite 하나(임시 폴더)에 domain event 셋을 쓴다. ① handler가 둘째 event에서 `unavailable`을 돌려주는 동안 Reactor를 멈추고 새 `createReactor`로 다시 켠다(같은 DB). ② 셋 모두에 효과가 정확히 한 번씩 났는지(handler가 idempotency key로 효과를 센다) 본다. ③ 첫 event가 두 번 불렸더라도 효과 key는 하나인지 본다. 시각과 backoff는 수동 clock으로 주입한다. 실제 시간을 기다리지 않는다.
   - 새 일 handler는 test하지 않는다(판정은 approvals-gate가 test한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "꺼졌다 켜지면 Reactor가 cursor 뒤부터 이어 반응하고 같은 event에 두 번 반응하지 않는다"
- 남지 않음: `grep -rn "advanceSubscriberCursor" packages/core`가 `core/storage/ledger/`와 `core/events/reactor/`뿐이다. 이름 있는 구독자가 여럿이던 흔적(`subscriber` 문자열 인자를 받는 일반 gate)이 `subscriber-registration.ts`에 없다. 다른 module의 옛 binding이 남아 있으면 file 목록을 보고한다.

## 보고

- 바꾼 file
- 등록할 것: `packages/protocol/registry.ts`·`protocol/mod.ts`의 `ALL_EVENTS`(lead). `AdvanceSubscriberCursor` command route는 그대로다. core 조립 목록에 `wiring/events.ts` 한 줄(lead).
- 안 쓰게 된 export: `core/storage/ledger/mod.ts`의 `createSubscriberGate`·`SubscriberBinding`을 쓰던 다른 module의 binding 목록
- 정한 것: handler 오류 처리(`unavailable`만 재시도, 나머지는 log하고 넘김), 안전망 5초 poll, Reactor cursor 한 행(`subscriber = "reactor"`)
- 계약 바꾸기 요청(wave 3): `Reactor`·`ReactorHandler` 모양을 바꿔야 하면 여기 적는다

- (lead가 더함, coding-agent-tickets가 넘긴 것. 추가 소유, lead 승인: `wiring/apps-tickets.ts`의 Reactor·기동 줄) `createTicketCheckHandler(client)`를 `TicketCompletionReported`에 등록한다. `client.work`는 `TicketCheckWork` read, `client.record`는 `RecordTicketChecks` command를 `ticketMachineContext`로 부르는 어댑터다(어댑터는 아직 없다). 기동 때 `TicketSessionEnd.settleAll()`을 부른다. releases-problems-activation의 `activation.handlers.ticketVerified`·`approvalDecided`도 이 Reactor에 등록된다(releases-problems-bundle이 줄을 넣는다).
- (lead가 더함, places-sessions-contexts-authority가 넘긴 것) `ContextViolationFound`(subject project, payload `{project, context, check}`)의 visibility와 reaction 연결. `projects/register.ts`의 `contextVisibility`는 아직 옛 `contextViolationsRecordedEvent`를 본다. 새 event로 바꾼다(추가 소유, lead 승인: 그 줄).
