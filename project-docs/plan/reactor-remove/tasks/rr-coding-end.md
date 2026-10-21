# rr-coding-end

coding session의 끝이 domain event와 Reactor를 거치지 않게 한다. 끝을 아는 command가 같은 tx에서 맡긴 call을 닫고 맡긴 App Engineer에게 알린다. 꺼졌던 사이의 것은 켤 때 Router의 call 복구(`RecoverCalls`)가 닫는다. coding 쪽 Reactor handler와 `close_call` 신호를 지운다.

- 단위: coding-end (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/coding/`(앞 계획 land 뒤 path 확인. ae-builds가 이 폴더를 ticket 밖으로 옮긴다)
  - `packages/core/main/daemon/wiring/coding-sessions.ts`
  - `packages/core/router/router.ts`(72줄 `close` 주석만)
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "정한 것"(coding session의 끝은 그 command가 같은 tx에서 맡긴 call을 닫는다, 켤 때 sweep, 남는 domain event를 모두 지운다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "정한 것(agent)" 가운데 "coding session 끝은 하나다", "Reactor를 지운다", "모양"의 "program이 agent를 부르지 않는다" 끝 줄(맡긴 call이 닫히고 맡긴 App Engineer에게 한 번 알린다. 끌 수 없다)
  - 앞 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer가 coding agent에게 맡기는 흐름을 막는다"(끝 셋이 "맡긴 call이 닫혔다" 하나가 되고, 그 끝을 Reactor 없이 닫는 일은 이 계획이다). land 뒤에는 `project-docs/products/change-log/`의 그 계획 항목
  - architecture: `project-docs/architecture/agent-call.md`의 "같은 사실을 두 길로 알리지 않는다"와 "입력함은 메모리라 꺼지면 사라진다"(켤 때 `lophn_restarted`), `project-docs/architecture/coding-agent.md`의 끝나는 길 표, "끝나는 길마다 call은 한 번만 닫힌다", "lophn이 꺼져도 PTY를 살려 두지 않는다", `project-docs/architecture/event.md`의 "call 닫음 handler는 … 같은 tx에서 한다". 모두 지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `events`, `app-tickets`, `coding-agent`; `project-docs/module-catalog.yaml`의 `packages/core/router`, `packages/core/main`
  - 코드(줄은 main `dd956b49f`. coding 폴더 안 file은 앞 계획 land 뒤 path 확인)
    - `close-call.ts`(`closeCall`, `CODING_REACTION_TEXTS`)
    - `sessions.ts`의 `endSession`(36-70), `lines.ts`의 `openNext`(43-73)
    - `signal.ts`(`close_call` 갈래 52-64, `closeByReceiver` 89-101, `case "close_call"` 124-130)
    - `relay.ts`(`closer` 146-173, 돌려주는 `reactor` 234-256, deps `run`과 `signal`의 `key`)
    - `recover.ts`(켤 때 정산과 행 정리)
    - `packages/core/main/daemon/wiring/coding-sessions.ts`(`CLOSING_KINDS` 62-67, `run`의 `idempotency` 149-158, `ctx.reactor.on` 183-192)
    - 켤 때 순서: `packages/core/main/daemon/assembly.ts`의 `WIRINGS`(start는 이 순서다. `routerWiring`이 `codingSessionsWiring`보다 앞이다), `packages/core/main/daemon/wiring/router.ts`의 `start`(`RecoverCalls`), `packages/core/router/router.ts`의 `failLostOnStart`(519-521), `packages/core/router/store.ts`의 `lost`(`state = 'accepted' and consumed = 0`)와 `markConsumed`(부르는 곳은 lophn session의 turn 시작뿐이다: `packages/core/lophn-agent/run-loop/commands.ts` 247)
    - 끝난 coding session 행을 읽는 곳: `packages/core/main/daemon/wiring/router-registration.ts`의 `withCodingSessions.find`(끝난 session을 `accepting: false`로 답한다), coding 폴더의 `lookup.ts`
- 계약:
  - 쓰는 것: Router의 `close`와 `route`(`packages/core/router/router.ts`), `RecoverCalls`(`packages/core/router/commands.ts`)
  - 내놓는 것: coding session의 끝은 domain event를 쓰지 않는다. coding 쪽은 `ctx.reactor.on`을 부르지 않는다. `ApplyCodingSignal` input에 `close_call` 갈래가 없다. `closeCall` 입력에 `seq`가 없다(봉투의 `from`은 rr-program-from 전까지 `{ kind: "program", event_seq: "0" }`이다). 끝 event의 정의는 `packages/protocol/events/domain.ts`에 남지만 쓰는 곳이 없다(rr-reactor가 지운다).

## 할 일

근거: README "정한 것"의 둘째·셋째 줄. 끝을 아는 command 안에서 닫으면 밀린 일이 남지 않아 Reactor가 켤 때 하던 몫이 없다.

1. 먼저 확인한다(앞 계획 land 뒤). 아래와 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - coding session 끝 event가 하나다: `packages/protocol/events/domain.ts`의 `DOMAIN_EVENTS`와 `git grep -n "tx.emit(" -- packages/core`. ae-builds README는 끝 셋(완료 보고, claim 만료, 보고 없는 끝)이 "맡긴 call이 닫혔다" 하나가 된다고 한다. main `dd956b49f`에는 셋(`TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`)이고, 내는 곳은 `packages/core/apps/tickets/report.ts` 70, `claims.ts` 90, `session-end.ts` 25다. 아래에서 남은 그 event를 "끝 event"라 부른다.
   - coding call은 `agent_calls.consumed = 0`으로 남는다: `git grep -n "markConsumed\|callSignals" -- packages/core`에 lophn session의 turn 시작 말고 부르는 곳이 없다. 그래야 켤 때 Router의 `RecoverCalls`가 열린 coding call을 모두 닫는다(할 일 5).
2. 끝을 command 안에서 닫는다.
   - 끝 event를 쓰는 곳(ae-builds 뒤에는 대개 `endSession`과 켤 때 정산)마다 event를 쓰지 않고 같은 tx에서 `closeCall`을 부른다. 지금 `endSession`의 보고 없는 끝 갈래(`sessions.ts` 57-68)가 그 모양이다.
   - 끝 event의 정의와 `DOMAIN_EVENTS` 줄은 지우지 않는다. 지우면 Reactor와 commit publisher가 compile되지 않는다. rr-reactor가 지운다.
   - `closeCall`에서 `seq` 입력과 그 주석("근거 domain event의 seq")을 지운다. 봉투의 `from`은 `{ kind: "program", event_seq: "0" }`으로 둔다(rr-program-from이 칸을 지운다). `event` 입력(받는 turn의 `<lophn-reaction event="…">` 값)은 끝 event의 이름을 사실 이름으로 그대로 쓴다.
   - 이미 끝난 call(취소, Router가 먼저 닫음)이면 닫지도 알리지도 않는 규칙(`close-call.ts` 29-31)은 그대로다.
3. Reactor 길을 지운다.
   - `relay.ts`: `closer`, 돌려주는 객체의 `reactor`, `ReactorHandler`·`DomainEvent` import, deps `run`과 `signal`의 `key` 인자. 머리 주석의 "Reactor handler"를 뺀다.
   - `signal.ts`: `close_call` 갈래, `closeByReceiver`, `case "close_call"`, 그것만 쓰던 import. 머리 주석의 "Reactor"를 뺀다.
   - `coding-sessions.ts`: `ctx.reactor.on` 셋(ae-builds 뒤에는 하나), `CLOSING_KINDS`의 `close_call`, `run`의 `idempotency` 인자(늘 `crypto.randomUUID()`), 46줄과 183줄 주석의 Reactor.
4. `packages/core/router/router.ts` 72줄 주석 "Reactor handler(coding-agent)가 맡긴 call을 닫는다"를 "coding session이 끝난 command가 맡긴 call을 닫는다"로 고친다.
5. 켤 때(`recover.ts`)
   - 끝 event를 쓰는 정산(main `dd956b49f`은 `TicketSessionEnd.settleAll`, 10-11줄. ae-builds 뒤 모양 확인)이 남았으면 지운다.
   - 정한 것: `recoverCoding`은 call을 닫지 않는다. 꺼졌던 사이 끝난 coding session의 call은 Router의 켤 때 복구(`RecoverCalls` → `failLostOnStart`)가 `failed(lophn_restarted)`로 닫고 보낸 App Engineer session에 한 번 알린다. 이유: coding call은 turn이 가져가는 입력이 아니라 `consumed`가 늘 0이라 이미 그 복구에 걸린다(1의 둘째 확인). 앱 줄에 선 call도 같은 길로 닫힌다(`architecture/agent-call.md` "입력함은 메모리라"). coding 쪽에 같은 sweep을 또 두면 같은 사실을 알리는 길이 둘이 되고, 한 번만 알리는 것이 start 순서에 기댄다.
   - 1의 둘째 확인이 틀리면(coding call이 consumed가 될 수 있으면) 위 대신 `recoverCoding`이 `ended = 0`인 행마다 같은 tx에서 `closeCall`을 부르고, `coding-sessions.ts`의 `CLOSING_KINDS`에 `recover`를 더해 고정 문구를 준비한다. 보고의 "정한 것"에 적는다.
   - 끝난 행을 다음 켤 때까지 남기는 것(`DELETE … WHERE ended = 1` 뒤 `UPDATE … SET ended = 1`)은 그대로 둔다. Router의 `find`가 앞 실행에서 끝난 coding session을 `closed`로 답하는 데 쓴다(`router-registration.ts`). 머리 주석의 "정산한 session의 call을 Reactor가 찾을 수 있게"를 이 이유로 고친다.
6. 위험 test(아래 "끝남"). coding 폴더의 test file(main `dd956b49f`은 `coding_test.ts`)에 둔다.
   - 준비: 그 file의 `setup` 꼴(in-memory SQLite에 `ROUTER_SCHEMA_STEPS`와 coding schema). Router는 `createRouter({ store: createCallStore(), directory, transport })`로 만든다. directory는 보낸 App Engineer session S 하나를 accepting으로 답하고, transport는 배달을 센다. `closeCall`이 `routerFor`를 부르는 길이 있으면 `installRouterEnvironment`로 같은 대역을 꽂는다.
   - 상황: S가 맡긴 coding call 하나(`accepted`, `consumed = 0`)와 그 call을 받은 끝나지 않은 coding session 행 하나(`ended = 0`). 신호 없이 켠다(lophn이 꺼진 사이 process가 끝났다).
   - 켤 때 두 순서를 표로 돈다: (a) `failLostOnStart(tx, true)` 뒤 `recoverCoding(tx)`, (b) 그 반대. 순서마다 이어서 그 session의 늦은 `terminal_exited`(`applyTerminalExited`)와 한 번 더 켜기(두 복구를 다시)를 한다.
   - 판정: call 행은 `failed`, 이유는 `lophn_restarted`다. S로 간 배달은 한 번이다. `ended = 0`인 coding session 행이 없다.
7. 남은 흔적을 grep해 주석과 오류 메시지를 고친다: `Reactor`, `close_call`, `idempotencyKey`, `closeCall`의 `seq`, 끝 event 이름.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 위험 test: "lophn이 꺼진 사이 끝난 coding session의 맡긴 call은 켤 때 한 번만 닫히고 맡긴 App Engineer session에 한 번만 알린다". rr-reactor가 지우는 `packages/core/events/reactor/reactor_test.ts`("꺼졌다 켜지면 … 같은 event에 두 번 반응하지 않는다")의 coding 몫을 이것이 대신한다.
- 남지 않음
  - `git grep -n -i "reactor\|close_call\|closeByReceiver\|idempotencyKey" -- <coding 폴더> packages/core/main/daemon/wiring/coding-sessions.ts`가 0줄이다.
  - `git grep -n "tx.emit(" -- <coding 폴더>`가 0줄이다(agent event는 `afterCommit`으로 낸다).
  - `git grep -nw "<끝 event의 정의 이름>" -- packages`가 `packages/protocol/events/domain.ts`뿐이다.
  - `git grep -n "Reactor" -- packages/core/router/router.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: `packages/core/events/mod.ts`의 `ReactorHandler`(coding 쪽이 마지막 바깥 사용처였는지)
- 1의 확인 결과: 끝 event 이름, 그것을 쓰던 곳, coding call의 consumed
- 정한 것: 문서에 답이 없어 worker가 정한 것(할 일 5의 정한 것을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
