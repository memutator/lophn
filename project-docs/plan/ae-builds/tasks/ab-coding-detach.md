# ab-coding-detach

coding agent 연결 장치가 ticket을 모르게 한다. 맡긴 coding session의 끝 셋(완료 보고, claim 만료, 보고 없는 끝)을 "맡긴 call이 닫혔다" 하나로 모은다(README "연결 장치는…", roadmap "coding session 끝은 하나다"). 새 domain event를 두지 않는다. session이 끝난 것을 아는 command가 같은 tx에서 맡긴 call을 닫고 맡긴 App Engineer에게 한 번 알린다(README "새 event를 두지 않고 그 command가 같은 tx에서 맡긴 call을 `done`으로 닫는다", `coding/close-call.ts`의 event 없는 닫기). 그래서 coding 쪽의 ticket event Reactor handler 셋과 정산도 지운다. ticket 모듈과 옛 event 정의는 남는다(ab-ticket-delete가 지운다).

정한 것:
- `CodingTransport.start`의 `ticket`은 `prompt`(맡긴 글. call 본문이 그 자리다)가 된다. 이유: roadmap "지우는 것" 표가 ticket 대신 call 본문을 둔다. Router는 이미 coding agent를 받지 않아(ab-router) 지금 부르는 곳은 없다. 연결 장치는 보류라 남긴다.
- 맡긴 call은 session이 끝나면 `done`으로 닫고 고정 글 하나로 맡긴 App Engineer에게 알린다. 이유: 보고가 없어져 "다 됐는가"를 program이 알 수 없다. App Engineer가 coding agent의 마지막 메시지와 앱 source를 보고 정한다(roadmap "'고쳐졌나'를 program이 판정하지 않는다").
- (flesh) "마지막 메시지"는 coding agent가 `lophn message send`로 보낸 마지막 메시지다. 그 메시지는 이미 따로 App Engineer에게 간다. lophn은 harness의 대화 글을 받지 않는다(hook이 싣지 않고 `TurnEnded`의 `messages`는 비어 있다). 그래서 알림 글은 고정이고, 첫 prompt가 "끝나면 한 일과 남은 일을 `lophn message send`로 알린다"를 말한다. 알림 글이 고정인 이유는 지금과 같다: writer 앞 처리(`coding-sessions.ts`의 `withCodingBody`)가 본문 blob을 미리 준비한다.
- (flesh) 줄에 섰다가 띄우지 못한 call(`lines.ts`의 `openNext`)은 session이 없었으므로 `failed`(`receiver_ended`)로 닫고 다른 고정 글("시작하지 못했다")로 알린다. "끝났다"로 알리면 App Engineer가 일이 된 줄 안다.
- (flesh) 켤 때는 coding 쪽이 call을 닫지 않는다. coding call은 turn이 가져가는 입력이 아니라 `consumed = 0`이라, lophn이 꺼진 사이 열린 채 남은 것은 Router의 켤 때 복구(`RecoverCalls` → `failLostOnStart`)가 `failed(lophn_restarted)`로 닫고 보낸 session에 한 번 알린다(`architecture/agent-call.md` "입력함은 메모리라"). coding 쪽에 sweep을 또 두면 같은 사실을 알리는 길이 둘이 된다.

- 단위: coding (wave 2)
- 선행: 없음. 뼈대의 선행 ab-reaction-core는 `packages/protocol/events/domain.ts`를 같이 고쳐서였다. 새 event를 두지 않아 이 task는 그 file을 고치지 않는다. wave 1의 ab-coding-move, ab-router, ab-source, ab-coding-tab, ab-cli가 고친 file 위에서 일하므로 wave 2다.
- 소유(이 task만 고친다):
  - `packages/core/apps/coding/`
  - `packages/protocol/coding-agent/{transport.ts,launch-plan.ts,message.ts,token.ts,terminal-requests.ts}`
  - `packages/core/main/daemon/wiring/{coding-sessions.ts,router-registration.ts,session-snapshots.ts}`
  - `packages/core/apps/tickets/commands.ts`(`stopCodingCalls`와 그 부르기, `CodingTransport` import만. 뼈대에 없던 줄이다. `CodingAppLine`의 `ticket`과 `stop`의 `ticket_cancelled`를 쓰는 곳이라 지우지 않으면 compile이 깨진다)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer가 coding agent에게 맡기는 흐름을 막는다"(연결 장치는 ticket을 모른다, coding launch는 call 본문을 첫 prompt로 받는다, 끝 셋은 하나, 새 event 없음, 연결 장치는 그대로 둔다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "program이 agent를 부르지 않는다" 끝 줄(맡긴 call이 닫히고 마지막 메시지와 함께 한 번 알린다. 끌 수 없다), "정한 것(agent)"의 "coding session 끝은 하나다", "Reactor를 지운다"
  - architecture: `project-docs/architecture/coding-agent.md`의 끝나는 길 표, "끝나는 길마다 call은 한 번만 닫힌다", "첫 prompt는 argv의 한 인자로 넘기고 …", `project-docs/architecture/agent-call.md`의 "같은 사실을 두 길로 알리지 않는다"와 "입력함은 메모리라 꺼지면 사라진다". 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent`, `router`, `app-tickets`
  - 코드(줄은 main `dd956b49f`의 `packages/core/apps/tickets/coding/`. ab-coding-move 뒤 `packages/core/apps/coding/`, wave 1 뒤 줄은 조금 다르다)
    - `close-call.ts`(`CODING_REACTION_TEXTS` 9~16, `closeCall` 18~67)
    - `sessions.ts`의 `ensureStarted`(25~34), `endSession`(37~70. 57~68줄의 보고 없는 끝 갈래가 event 없이 닫는 지금 모양이다)
    - `recover.ts`(`TicketSessionEnd.settleAll`과 행 정리), `lines.ts`(`codingLines` 1~40, `openNext` 43~73)
    - `transport.ts`(`start`의 `loadTicket` 검사 43~53, `stop`의 `ticket_cancelled` 갈래 105~108), `launch.ts`(`openSession`), `store.ts`(`SessionRow`, `LineRow`, `COLUMNS`, SQL), `schema.ts`(step `coding-agent.sessions.tables`), `hook.ts` 93줄(`firstPromptOf`), `message.ts`(`applyMessage`의 ticket refs)
    - `relay.ts`(`message` handler의 `tickets` 95~101, `closer` 146~173, 돌려주는 `reactor` 234~256, deps `run`의 `key`), `signal.ts`(`message`의 `tickets` 40~45, `close_call` 갈래 52~64, `closeByReceiver` 89~101, `case "close_call"` 124~130)
    - test: `coding_test.ts`(`setup`이 tickets 표와 `TicketSessionEnd` 대역을 쓴다), `store_test.ts`(INSERT의 `ticket` 칸)
    - protocol: `transport.ts`(`CodingStartInput`, `CODING_START_FAILURES`, `CodingAppLine`, `stop`), `launch-plan.ts`(`CodingLaunchPlan`, `codingLaunchPlanSchema`, `firstPromptOf` 92~103, `launchPlanOf`, title 184줄), `message.ts`(`refs`), `token.ts` 36줄 주석, `terminal-requests.ts` 15줄 주석
    - wiring: `coding-sessions.ts`(`CODING_CONTEXT` 주석 46, `CLOSING_KINDS` 62~67, `run`의 `idempotency` 149~158, `ctx.reactor.on` 183~192, `start` 주석 224), `router-registration.ts` 120줄(`stop`의 `reason`), `session-snapshots.ts`(ticket을 읽지 않는다. 고칠 것이 없을 것이다)
    - Router: `packages/core/router/router.ts`의 `close`, `route`, `failLostOnStart`, `packages/core/router/environment.ts`의 `installRouterEnvironment`·`routerFor`(test에서 대역을 꽂는 자리), `packages/core/router/store.ts`의 `lost`(`state = 'accepted' and consumed = 0`), `markConsumed`(부르는 곳은 lophn session의 turn 시작뿐이다)
    - 켤 때 순서: `packages/core/main/daemon/assembly.ts`의 `WIRINGS`(`routerWiring`이 `codingSessionsWiring`보다 앞이다)
    - ticket 쪽: `packages/core/apps/tickets/commands.ts`의 `cancel`(177줄의 `stopCodingCalls` 부르기), `stopCodingCalls`(224~249)
- 계약:
  - 쓰는 것: Router의 `close`와 `route`(`packages/core/router/router.ts`, `routerFor`), `CallRef`(`packages/protocol/lophn-agent/calls.ts`. ticket 갈래는 만들지 않는다)
  - 내놓는 것:
    - `CodingStartInput`은 `{ call, app, prompt: string, options }`이다. `CodingStartFailure`에 `ticket_unavailable`이 없다. `CodingAppLine`은 `{ app, active: { session, call } | null, waiting: { call }[] }`이다. `CodingTransport.stop`의 입력은 `{ call }`이다(reason 칸이 없다).
    - launch plan(`launchPlanOf` 입력, `codingLaunchPlanSchema`)에 `ticket`이 없고 `launchPlanOf` 입력은 `prompt`를 받는다. 첫 prompt는 `firstPromptOf(app, prompt)`다: lophn이 붙이는 고정 줄(앱 id, 연결된 source에서 일한다, 막히면 `lophn message send`, 끝나면 한 일과 남은 일을 `lophn message send`로 알린다)과 `<assignment>`로 싼 맡긴 글. token은 싣지 않는다. 탭 title은 `lophn coding · <harness label>`이다.
    - 표 `coding_sessions`와 `coding_lines`의 `ticket` 열은 `prompt`가 된다. step `coding-agent.sessions.tables`를 그 자리에서 고친다(개발 data는 지우고 새로 만든다).
    - `codingMessageSend` 입력은 `{ body }`다(ticket id `refs`가 없다).
    - coding session의 끝은 domain event를 쓰지 않는다. 끝을 아는 command(`ApplyCodingSignal`의 `terminal_exited`, 실패한 `terminal_result`)가 `endSession`에서 같은 tx로 `closeCall`을 부른다. `closeCall(tx, { call, session: string | null, app })`
      - 이미 끝난 call(취소, Router가 먼저 닫음)이면 닫지도 알리지도 않는다(지금 규칙).
      - `session`이 있으면 call을 `done`으로 닫는다. 없으면(줄에서 띄우지 못함) `failed`(`receiver_ended`)다.
      - 보낸 쪽이 agent면 `open_session_or_new`(그 session, 없으면 그 앱의 새 App Engineer session)로 `kind: "reaction"`, `event: "CodingSessionEnded"`, `reply: "none"`, 고정 글, refs `[{ kind: "session", session }]`(session이 없으면 `[]`), `from: { kind: "program", event_seq: "0" }`을 한 번 보낸다.
    - `CODING_REACTION_TEXTS`는 `{ ended, not_started }` 두 고정 글이다(예: "The coding session ended. Its last message to you says what it did.", "The coding session could not start.").
    - `ApplyCodingSignal`에 `close_call` 갈래가 없고 `message` 갈래에 `tickets`가 없다. relay는 `reactor`를 돌려주지 않고 deps `run`은 `key`를 받지 않는다. `coding-sessions.ts`는 `ctx.reactor.on`을 부르지 않는다.
    - `recoverCoding`은 call을 닫지 않고 ticket을 정산하지 않는다. 끝나지 않은 session 행을 `ended = 1`로, 줄과 대기 입력을 비운다(지금처럼). 열린 coding call은 Router의 `RecoverCalls`가 닫는다.
    - coding 폴더는 `../tickets/`와 `TicketSessionEnd`를 import하지 않는다.
    - ticket 취소(`ticket.cancel`)는 coding call을 멈추지 않는다(`stopCodingCalls`가 없다). ticket을 실은 coding call이 더는 없다.
    - `TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`의 정의(`packages/protocol/events/domain.ts`)와 그것을 내는 ticket 쪽 코드는 남는다. 듣는 coding handler가 없다. 정의는 ab-ticket-delete가 ticket 모듈과 함께 지운다.
  - 등록할 것(lead): `packages/protocol/coding-agent/mod.ts`의 export(이름이 바뀌면. `firstPromptOf`, `launchPlanOf`는 이름이 그대로일 것이다).

## 할 일

1. 먼저 확인한다(wave 1 뒤). 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - Router가 coding session을 열지 않는다: `git grep -n "coding\.start\|launchCoding\|CodingTransport).start" -- packages`가 0줄이다(ab-router).
   - shell이 launch plan의 `ticket`을 읽지 않는다: `git grep -n "plan\.ticket\|coding\.ticket" -- packages/shell`이 0줄이다(ab-coding-tab).
   - coding 폴더가 `packages/core/apps/coding/`이고 `scaffold-source.ts`가 없다(ab-coding-move, ab-source).
   - coding call은 consumed가 되지 않는다: `git grep -n "markConsumed" -- packages/core ':!packages/core/router'`가 lophn session의 turn 시작(`packages/core/lophn-agent/run-loop/commands.ts`)뿐이다. 다르면 "정한 것"의 켤 때 규칙이 틀린다.
2. protocol(근거: 계약)
   - `transport.ts`: `CodingStartInput.ticket` → `prompt`, `ticket_unavailable`을 지운다, `CodingAppLine`에서 `ticket`을 지운다, `stop` 입력을 `{ call }`로.
   - `launch-plan.ts`: `CodingLaunchPlan`과 schema에서 `ticket`과 `ticketIdSchema` import를 지운다. `launchPlanOf` 입력 `ticket` → `prompt`. `firstPromptOf(app, prompt)`를 계약대로 다시 쓴다(지금처럼 줄 배열을 `\n`으로 잇는다. 지금 글처럼 한국어다). title은 `lophn coding · ${adapter.label}`.
   - `message.ts`: `refs`와 `ticketIdSchema` import를 지운다.
   - 주석: `token.ts` 36줄 "ticket 쪽이 …" → 앱 하나 범위를 보는 쪽(annotation 읽기 등)이 쓴다. `terminal-requests.ts` 15줄의 "ticket 취소"를 지운다.
3. coding 폴더
   - `schema.ts`: 두 표의 `ticket TEXT NOT NULL` → `prompt TEXT NOT NULL`. step id는 그대로다.
   - `store.ts`: `SessionRow.ticket`, `LineRow.ticket` → `prompt`. `COLUMNS`, `rowOf`, `insertSession`, `pushLine`, `lineOf`, `shiftLine`, `allLines`의 SQL을 맞춘다. 107줄의 빈 주석("끝난 session도 찾는다 …")을 지운다.
   - `transport.ts`: `start`의 `loadTicket` 검사와 import를 지우고 줄에 `prompt`를 싣는다. `stop`의 `ticket_cancelled` 갈래와 그것만 쓰던 `createCallStore` import를 지운다.
   - `launch.ts`: `launchPlanOf`와 `insertSession`에 `prompt`.
   - `hook.ts`, `sessions.ts`의 `ensureStarted`: `firstPromptOf(row.app, row.prompt)`.
   - `close-call.ts`: 계약대로 고친다. `seq`, `ticket`, `event` 입력과 ticket ref를 지운다. 머리 주석은 지금 뜻(같은 tx에서 닫으니 Router의 실패 알림이 겹치지 않는다)을 둔다.
   - `sessions.ts`의 `endSession`: `TicketSessionEnd` 정산과 import를 지우고, 늘 `closeCall(tx, { call: row.call, session, app: row.app })`을 부른 뒤 `openNext`.
   - `lines.ts`: `codingLines`는 `session, call`만 읽는다. `openNext`의 실패 갈래는 `closeCall(tx, { call: line.call, session: null, app })`.
   - `recover.ts`: `settleAll`과 import를 지운다. 돌려주는 값은 `Result<void>`로 줄인다(부르는 곳 `signal.ts`를 맞춘다). 머리 주석의 "정산한 session의 call을 Reactor가 찾을 수 있게"를 "Router의 `find`가 앞 실행에서 끝난 coding session을 닫힌 것으로 답하게(`router-registration.ts`의 `withCodingSessions`)"로, "claim이 남은 session을 정산한다"를 지운다.
   - `message.ts`: 입력에서 `tickets`를 지우고 refs는 `[{ kind: "session", session: row.session }]`.
   - `signal.ts`: `close_call` 갈래, `closeByReceiver`, `case "close_call"`, `message`의 `tickets`와 그것만 쓰던 import(`ticketIdSchema`, `closeCall`, `CODING_REACTION_TEXTS`, `createCallStore`, `loadSession`)를 지운다. 머리 주석의 "Reactor"를 뺀다.
   - `relay.ts`: `closer`, 돌려주는 `reactor`, `ReactorHandler`·`DomainEvent` import, `message` handler의 `tickets`, deps `run`과 내부 `signal`의 `key` 인자를 지운다. 머리 주석의 "Reactor handler"를 뺀다.
4. wiring
   - `coding-sessions.ts`: `ctx.reactor.on` 셋과 183줄 주석을 지운다. `CLOSING_KINDS`에서 `close_call`을 뺀다(남는 `terminal_result`, `terminal_exited`가 `endSession`으로 call을 닫는다). `run(signal)`은 늘 `crypto.randomUUID()`를 key로 쓴다. 46줄 주석의 "Reactor가 받은 일"과 224줄 주석의 "claim이 남은 session을 정산한다"를 고친다.
   - `router-registration.ts`: `stop(tx, { call })`.
   - `session-snapshots.ts`: 고칠 것이 없으면 두고 보고에 적는다.
5. `packages/core/apps/tickets/commands.ts`: `cancel`의 `stopCodingCalls` 부르기(176~178), `stopCodingCalls` 함수, `CodingTransport` import를 지운다. 다른 줄은 고치지 않는다.
6. test
   - `store_test.ts`: INSERT의 `ticket`을 `prompt`로.
   - `coding_test.ts`의 `setup`: `ticketSchemaSteps`, tickets 행, `TicketSessionEnd` 대역, `settled`를 지운다. `start`는 `prompt: "do it"`을 넘긴다. Router 대역을 꽂는다: `installRouterEnvironment({ deps: () => ({ directory, transport, store: createCallStore() }) })`. `directory.find`는 보낸 App Engineer session `SENDER`를 `{ transport: "lophn", agent: { role: "app_engineer", app: APP }, accepting: true }`로 답하고, `transport.deliver`는 받은 입력을 배열에 쌓는다. 같은 file의 다른 test가 이 환경을 그대로 써도 되게 `setup` 안에서 꽂는다.
   - 위험 test(첫 test를 넓힌다. 아래 "끝남"): 지금의 "앱 하나에 session은 하나뿐이고 끝나면 줄의 다음 call이 새 session으로 열린다"에 판정을 더한다. 첫 session의 `applyTerminalExited`를 두 번 부른다. call 1의 `agent_calls.state`가 `done`이고, `SENDER`로 간 배달이 하나이며 그 입력이 `kind: "reaction"`, `event: "CodingSessionEnded"`, 본문 `CODING_REACTION_TEXTS.ended`다. 줄의 다음 call은 지금처럼 새 session으로 열린다. 판정은 바깥 결과(행 상태, 배달 목록)다.
7. 남은 흔적을 grep해 주석과 오류 글을 고친다(아래 "남지 않음").

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(schema step과 Reactor 등록이 바뀌었다. 개발 data는 지우고 새로 만든다).
- 바꾼 곳의 test: `deno test --no-check packages/core/apps/coding packages/core/apps/tickets packages/core/router`
- 위험 test: "coding session이 끝나면 맡긴 call은 `done`으로 한 번만 닫히고 맡긴 App Engineer session에 한 번만 알린다"(`packages/core/apps/coding/coding_test.ts`의 첫 test. `architecture/coding-agent.md` "끝나는 길마다 call은 한 번만 닫힌다"). 켤 때의 길(Router `RecoverCalls`)은 Router 쪽 코드가 바뀌지 않아 이 task에서 따로 보지 않는다.
- 남지 않음
  - `git grep -n -i "ticket" -- packages/core/apps/coding packages/protocol/coding-agent/transport.ts packages/protocol/coding-agent/launch-plan.ts packages/protocol/coding-agent/message.ts packages/protocol/coding-agent/token.ts packages/protocol/coding-agent/terminal-requests.ts packages/core/main/daemon/wiring/coding-sessions.ts`가 0줄이다.
  - `git grep -n -i "reactor\|close_call\|closeByReceiver\|idempotencyKey" -- packages/core/apps/coding packages/core/main/daemon/wiring/coding-sessions.ts`가 0줄이다.
  - `git grep -n "tx.emit(" -- packages/core/apps/coding`가 0줄이다.
  - `git grep -n "TicketSessionEnd\|tickets/" -- packages/core/apps/coding`가 0줄이다.
  - `git grep -n "ticket_cancelled\|ticket_unavailable\|stopCodingCalls" -- packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 할 일 1의 확인 결과
- 등록할 것: lead가 고칠 목록 file. 없으면 "없음"
- 안 쓰게 된 export: `TicketSessionEnd` port와 그 구현(`packages/core/apps/tickets/session-end.ts`, `ports.ts`의 등록)은 coding 쪽에서 부르는 곳이 없어진다(ticket 쪽 `settle.ts`는 아직 부른다). ticket 모듈이라 지우지 않는다(ab-ticket-delete). `packages/core/events/mod.ts`의 `ReactorHandler`가 coding 쪽의 마지막 바깥 사용처였는지 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(첫 prompt의 글, 두 고정 글)
- 넘길 줄: `packages/core/apps/tickets/commands.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 맡긴 글(call 본문)이 길면 첫 prompt를 넘기지 못할 수 있다. 붙여 넣는 제품은 터미널 입력 상한(`TERMINAL_INPUT_MAX_CHARS` 8192자)을 넘으면 `input` 요청이 schema에 걸린다. 부르는 곳이 없는 연결 장치라 막지 않았다. 고치려면 `launchPlanOf`가 길이를 보거나 긴 글을 file로 넘긴다. 그 밖에 있으면 적는다.
