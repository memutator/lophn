# events-bus-gateway

core 안 메모리 pub/sub인 Bus와, renderer가 건 조건으로 Bus를 걸러 보내는 Gateway(WebSocket)를 만든다. 옛 ledger 기반 구독(`events/list`, visibility, 이름 있는 구독의 ack 저장, 재생)은 이 둘로 바뀌고 지운다. 느린 구독자는 끊고, 붙는 쪽이 snapshot부터 다시 읽게 한다.

- 단위: events (wave 3)
- 선행: events-ledger (둘 다 `core/storage/ledger/mod.ts`를 고친다. ledger가 `approval-use` 줄을 빼고 이 task가 `../../events/*` re-export 줄을 뺀다)
- 소유(이 task만 고친다):
  - `packages/core/events/` — 아래는 뺀다.
    - 뺌(events-reactor의 것): `subscriber-registration.ts`, 새로 만들 `reactor/`
  - `packages/core/server/` — `identity/`와 `credentials.ts`는 뺀다(events-identity의 것)
  - `packages/core/storage/ledger/mod.ts`의 `../../events/*` re-export 줄, `reads.ts`·`reader-worker.ts`·`reader-registration.ts`의 event 읽기·visibility 부분
  - wiring file `packages/core/main/daemon/wiring/events.ts`(event operation 정책을 Bus 만들기로 바꾼다), `packages/core/main/daemon/wiring/server.ts`의 API 서버 시작 호출(`startApiServer`)에 `bus`를 잇는 줄만. 같은 file의 coding credential 줄은 events-identity의 것이다. 두 file은 core-wiring이 만든다. 없으면 보고하고 멈춘다
- 읽을 것:
  - spec: S1 3·4·8·10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.1#1`, `I1.1#2`, `I1.1#3`, `I1.1#5`, `I2.1#5`, `I2.1#18`, `I2.11#15`, `I3.1#1`, `I3.1#5` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 3장 #2(agent runtime의 agent event는 감독 pipe로 core Bus에 들어온다), #11, #12, 2.5의 B1 줄(위험 test)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
- 계약:
  - 쓰는 것: `packages/core/events/ports.ts`의 `Bus`, `BusSink`. `packages/protocol/events/`의 `BusEvent`, `EventCondition`, `eventConditionSchema`, Gateway frame(`GATEWAY_PATH`, `GATEWAY_SUBPROTOCOL`, `parseGatewayClientFrame`, server frame schema, close code, `GATEWAY_ACTORS`).
  - 내놓는 것: `createBus(): Bus`, `createGatewaySession(...)`, `core/server`의 `acceptSocket`·`attachSession` 새 모양, 연결된 Gateway client 하나에 Bus 밖 frame을 보내는 `GatewayFrames.send(frame)`(coding-agent가 터미널 요청을 shell main에 보낼 때 쓴다. frame의 모양은 contract-coding이 정하고 `GATEWAY_SERVER_FRAMES`에 lead가 더한다. 연결이 없으면 `unavailable`). events-reactor가 같은 `Bus`로 Reactor의 domain event를 소비하고, 다른 단위(run-loop, harness adapter, approvals)가 `Bus.publish`를 부른다. 만든 Bus 하나를 wiring이 모두에게 준다.

## 할 일

1. Bus — `core/events/bus.ts`(새), `I3.1#1`, S1 3·4장
   - `createBus(): Bus`. `publish`는 동기로 조건이 맞는 sink마다 `send`를 부른다. sink 하나가 던져도 다른 sink는 계속 받는다(던진 sink는 `close("shutdown")` 없이 해제만 하고 log).
   - 일치 규칙은 `core/events/ports.ts`의 주석대로다: 조건 여럿은 OR이고, 같은 event는 sink 하나에 한 번만 간다. `session`을 건 조건은 session이 없는 event와 맞지 않는다. 순수 함수 `eventMatches(conditions, event)`를 따로 export한다.
   - topic을 미리 나누지 않는다. 저장하지 않는다.
2. Gateway — `core/events/gateway.ts`(새), `I3.1#5`, `I2.1#5`, S1 3·4장
   - `createGatewaySession(socket: GatewaySocket, bus: Bus)`. `GatewaySocket`은 `send(text)`, `close(code)`, `bufferedAmount(): number`만 가진 작은 interface다(실제 `WebSocket`과 test fake가 둘 다 맞춘다).
   - client frame `watch{conditions}`를 받으면 이전 구독을 풀고 새 조건으로 `bus.subscribe`한 뒤 `{ type: "ready" }`를 보낸다. 조건 검사는 `eventConditionSchema`로 한다. 틀리면 `closed`를 보내지 않고 close code 1008로 끊는다.
   - Bus의 event는 `{ type: "event", event }` frame으로 보낸다. JSON 직렬화 뒤 `socket.bufferedAmount()`가 1 MiB를 넘으면 `{ type: "closed", reason: "slow_consumer" }`를 보내고 1013으로 닫고 구독을 푼다.
   - 연결이 끊기면 구독을 푼다. 재생도 ack도 없다(`I1.1#3`, `I1.1#5`).
   - Bus 밖 frame: `createGatewaySession`이 만든 session들을 모아 두는 `createGatewayFrames()`가 `send(frame)`(연결된 client로 보낸다. 사람 token으로 접속한 client는 하나다)를 가진다. 이 frame은 조건과 상관없이 간다. renderer로 중계하는 것은 shell main이 정한다(`ready`·`event`·`closed`만 중계한다).
   - 인증은 연결 때 한 번 본다(`../README.md` 3장 #12): `ctx.actor`가 `GATEWAY_ACTORS`(`user`)가 아니면 upgrade 전에 `forbidden`이다.
3. 서버 연결 — `core/server/socket.ts`, `server.ts`, `mod.ts` (`I2.1#5`, `I2.1#18`)
   - `acceptSocket`은 `GATEWAY_SUBPROTOCOL`만 받는다. 경로는 `GATEWAY_PATH`다. `attachSession(socket, ctx, { bus, onClose })`가 `createGatewaySession`을 쓴다.
   - `server.ts`의 `options.events`, `options.subscriptions`, `options.track`을 `options.bus`로 바꾸고 `isSubscribePath`를 새 경로에 맞춘다. 연결 한도 admission(`admission.enterEvent`)은 그대로 둔다.
   - `core/server/request.ts`의 방어 코드(`gateRequest`, `readLimitedBody`, `API_MAJOR` 등, `I2.11#15`)는 요구에서 빠졌지만 코드를 둘지는 선택이다. 손대지 않는다(AGENTS.md "속도").
4. 옛 구독을 지운다 — `I1.1#1`, `I1.1#2`, `I1.1#3`, `I1.1#5`
   - 지울 file: `core/events/list.ts`(`events/list` read), `backend.ts`, `subscribe.ts`(replay, dispatcher), `subscription-store.ts`, `subscription-store-worker.ts`, `operations.ts`. `ledger/mod.ts`의 해당 re-export, `ledger/reader-registration.ts`의 `createListEventsRead`·`ListEvents` operation gate, `ledger/reader-worker.ts`의 `collectEventRegistrations`, `ledger/reads.ts`의 `eventReads(registry)` 칸.
   - `core/events/visibility.ts`(공개 정책 장치)와 `protocol/server/registration.ts`의 `EventVisibilityDefinition`, 각 module의 `createEventRegistration`: 이 task는 Gateway가 visibility를 보지 않게만 한다. `visibility.ts`는 `grep -rn "createEventRegistration\|EventVisibilityDefinition\|collectEventRegistrations" packages/core packages/protocol`에서 이 task 소유 밖 사용이 0일 때만 지운다. 지금은 `core/apps/register.ts`, `core/projects/register.ts`, `core/problems/register.ts`, `core/apps/tickets/register.ts`, `core/lophn-agent/register.ts`, `core/main/daemon/platform-register.ts`가 쓴다. 0이 아니면 지우지 말고 남은 file 목록을 보고한다.
   - `core/events/internal-subscription.ts`(`I1.1#4`는 다른 단위 몫): 사용처 여섯(`core/lophn-agent/assignments/reactions.ts`, `core/apps/tickets/checker/connection.ts`, `core/problems/{grouping,closing}/connection.ts` 등)이 모두 사라졌을 때만 지운다. `grep -rn "internal-subscription" packages/core`가 0줄일 때다. 아니면 남은 file 목록을 보고한다.
   - 지운 뒤 `core/main/daemon/runtime.ts`의 `createReaderEventBackend`·`createEventDispatcher`·`subscriptions` 줄은 이 task가 못 고친다(daemon은 core-wiring과 platform의 것). 이 줄들을 wiring file로 옮기거나 지우는 일은 wiring file `events.ts`에서 새 `createBus()` 한 줄을 더하는 것까지 이 task가 하고, `runtime.ts`의 옛 줄은 보고에 file과 줄로 적는다.
5. `core/events/mod.ts`(새) — `createBus`, `eventMatches`, `createGatewaySession`, `Bus` 등 port type을 내보낸다. 다른 module은 이 file로만 import한다(code-map). events-reactor가 Reactor export를 이어서 더한다.
6. wiring — `wiring/events.ts`: `createBus()`를 만들어 `Core`가 서버에 넘기는 `options.bus`와 다른 단위에 줄 `Bus`로 내놓는다.
7. 위험 test
   - `packages/core/events/gateway_test.ts` 하나, 이름은 "느린 구독자는 끊기고 다시 붙으면 snapshot부터 다시 읽게 한다". fake `GatewaySocket`(`bufferedAmount`를 test가 정한다)과 실제 `createBus()`로: ① `watch` 뒤 `ready`가 먼저 오고 조건에 맞는 event만 한 번씩 온다. ② `bufferedAmount`를 한도 위로 올리면 `closed(slow_consumer)`와 1013이 오고 그 뒤 publish는 그 sink로 가지 않는다. ③ 새 session을 붙이면 `ready`를 다시 받는다. WebSocket, 서버, subprocess를 띄우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "느린 구독자는 끊기고 다시 붙으면 snapshot부터 다시 읽게 한다"
- 남지 않음: `grep -rn "createListEventsRead\|createSubscriptionStore\|resolveSubscriptionStart\|createEventDispatcher\|createReaderEventBackend" packages/core`가 `main/daemon/runtime.ts`(위 4의 보고 대상) 밖에서 0줄이다. visibility와 internal subscription은 위 조건이 맞을 때만 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음. wiring file은 이 task가 고친다. 단 `main/daemon/runtime.ts`·`core.ts`의 옛 event 줄(file과 줄)은 core-wiring 단위가 아니라 lead가 조립 목록을 고칠 때 지운다고 적는다.
- 안 쓰게 된 export: `protocol/events/stream.ts` 전부, `protocol/events/events.ts`의 `eventsList`·`eventsListInputSchema`·`EVENT_BATCH_LIMITS`, `protocol/server/registration.ts`의 `EventVisibilityDefinition`·`createEventRegistration` 관련 type, `protocol/events/events.ts`의 `eventEnvelopeSchema`(옛 `run` 칸). 남이 쓰던 것은 지우지 않는다.
- 정한 것
  - 자격은 연결 때만 본다. 연결 중 회수는 core가 token 회수 알림을 받는 쪽이 생길 때 `closed(credential_revoked)`로 연결한다(지금은 알림이 없으면 안 쓴다).
  - slow consumer 한도 1 MiB(옛 `BUFFER_BYTES`와 같은 값).
  - `shell/main/desktop/core/events.ts`의 재연결 backoff(`backoffReconnect`)는 platform이 살린다.
- 계약 바꾸기 요청(wave 3): 없으면 없음
