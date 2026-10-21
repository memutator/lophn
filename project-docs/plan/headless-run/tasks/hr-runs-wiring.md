# hr-runs-wiring

approval-simplify가 land한 뒤의 unattended 전파 위에서, run service를 core에 잇는다: memory route(`StartRun`, `WaitRun`, `CancelRun`) handler, lophn agent port(session 열기, unattended 메시지 넣기, 받은 메시지·turn·답 읽기, turn 멈추기, 입력함에서 빼기), 앱 port(사람 caller의 앱 tool 호출), Bus의 `TurnEnded` 구독, 켤 때 맞추기, core 안 자격 기록.

- 단위: runs (wave 3)
- 선행: hr-runs-core, hr-session-input.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/runs.ts`
  - `packages/core/main/daemon/wiring/runs-registration.ts`
- 읽을 것:
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 "내놓는 것"(route 표, `StartRun`의 순서, "끝"을 정하는 규칙), `project-docs/plan/headless-run/tasks/hr-runs-core.md`의 "할 일" 1(port)과 8(service), `project-docs/plan/headless-run/tasks/hr-session-input.md`의 "내놓는 것"
  - 제품 결정: `project-docs/plan/headless-run/README.md`의 "정한 것"(tool run의 부른 쪽은 사람이다, core는 그 입력이 들어간 turn과 `TurnEnded`로 끝을 안다)과 "뼈대 검토에서 정한 것"(coding session 안에서는 run route가 `forbidden`, tool run 취소, run 입력은 켤 때 다시 줄 세우지 않는다)
  - architecture: `project-docs/architecture/event.md` "Bus"(core 안에서 command를 내는 곳은 접힌 writer `ctx.writer`를 쓴다, Bus는 놓칠 수 있다), `project-docs/architecture/agent-call.md`(받는 쪽 이름은 정확히 맞아야 풀린다), `project-docs/architecture/place-session.md`(session을 여는 길은 같은 연산이다, 켤 때 돌던 turn은 interrupted), `project-docs/architecture/layers.md`(composition root는 `core/main`이다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `core`, `runs`, `router`, `agent-sessions`, `run-loop`, `apps`; `project-docs/module-catalog.yaml`의 `packages/core/main`
  - 코드(본보기와 이어 붙일 곳. 앞 계획 land 뒤 path 확인)
    - `packages/core/main/daemon/wiring/router.ts`: `ANNOTATION_DELIVERY_CONTEXT`(actor user인 core 안 자격과 `records`), `run`(접힌 writer로 command 내기), `agentOfApp`(`ledgerSnapshot`으로 main thread에서 짧게 읽기), `start`의 `createSessionDirectory({ ...placeDepsOf(sql), publish, sql })`, `ctx.runtime.reads.get(...)`로 `ReadMessageBody` 읽기
    - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`: `SESSION_INPUTS_CONTEXT`와 `remove`(`RemoveQueuedMessage` 뒤 `inbox.remove`), `ctx.bus.subscribe([{ types: ["TurnEnded"] }], …)`와 `closeIntake`의 해제, `ids.newId("idk")` idempotency key
    - `packages/core/main/daemon/wiring/context.ts`(hook 순서, `Built.memory`, `records`, 늦게 생기는 칸 `writer`·`appCallPath`·`inbox`·`runtime`·`bus`)
    - `packages/core/main/daemon/core.ts`(`memoryRouteMismatch`, `server.stop`이 받은 요청을 기다린다)
    - `packages/core/lophn-agent/places/mod.ts`(`placeDepsOf`, `createSessionDirectory`), `packages/core/main/daemon/wiring/lophn-agent-registration.ts`(`appByName`은 id, slug, 이름이 정확히 맞는 앱 하나), `packages/core/agent-roles/place/session-directory.ts`(`resolveNamed`: coding_agent는 `invalid_input`, Operator 이름이 여럿이면 `invalid_input`)
    - `packages/core/lophn-agent/session/rewind/files.ts`(`ledgerSnapshot`), `packages/core/lophn-agent/session/mod.ts`(`messageRemoveQueued`)
    - `packages/core/apps/mcp/serve.ts`(사람 caller로 `calls.call`), `packages/core/apps/calls/caller.ts`(`CallAuth`, person은 Gate를 거치지 않는다), `packages/protocol/apps/calls/call.ts`(`ToolCallInput`)
    - route: `packages/protocol/lophn-agent/agent-sessions.ts`(`openAgentSession`, `agentSessionRead`), `packages/protocol/lophn-agent/inputs.ts`(`sendMessage`), `packages/protocol/lophn-agent/received-messages.ts`(`receivedMessageRead`, `receivedMessageList`), `packages/protocol/lophn-agent/turn-reads.ts`(`turnRead`), `packages/protocol/lophn-agent/turns.ts`(`stopTurn`의 입력과 compare `state_seq`), `packages/protocol/lophn-agent/messages.ts`(`messageBody`)
- 계약:
  - 쓰는 것:
    - hr-runs-core의 `createRunService`와 port, 팀 등록
    - lophn-agent route: `openAgentSession`, `sendMessage`(`unattended: true`), `receivedMessageRead`, `turnRead`, `messagesList`, `messageBody`, `stopTurn`, `removeQueued`(또는 wiring의 `Inbox`). 사람 메시지를 넣는 core 안 자격은 annotation 전달(`packages/core/main/daemon/wiring/router.ts`의 `ANNOTATION_DELIVERY_CONTEXT`)과 같은 꼴이다.
    - 이름 풀기: Router의 `SessionDirectory.resolveAgent`(정확히 맞는 이름만)
    - 앱: `ctx.appCallPath.call(input, { actor: "user" })`, target `{ mode: "live", app, release: null }`, caller `{ kind: "person", view_session: <run id> }`(`packages/core/apps/mcp/serve.ts`가 principal을 같은 자리에 넣는 것과 같다). Gate를 거치지 않는 사람 길이다.
    - `ctx.bus.subscribe([{ types: ["TurnEnded"] }], …)`(`packages/core/main/daemon/wiring/lophn-agent-runtime.ts`와 같은 꼴)
  - 내놓는 것: `runsWiring`(WiringFactory)와, 이름 풀기에 tx port가 필요하면 팀 등록 file `runs-registration.ts`. assembly 등록(`WIRINGS`, `TEAMS`, `TEAM_MODULES`)은 lead가 한다.

## 할 일

`packages/core/main/daemon/wiring/runs.ts` 하나에 `runsWiring`을 만든다. 규칙은 hr-runs-core의 service가 갖고, 여기서는 port를 core에 잇기만 한다(`layers.md`: 조립은 업무 규칙을 두지 않는다). 앞 계획 land 뒤 path 확인: 위 "읽을 것"의 wiring file과 approval-simplify가 바꾼 `SendMessage` 칸 이름.

1. core 안 자격 둘을 만들고 `records`로 기동 때 기록한다(`router.ts`의 `ANNOTATION_DELIVERY_CONTEXT` 꼴). `scope.operations`에는 그 자격으로 부르는 route 이름을 모두 적는다(빠지면 `forbidden`).
   - `machine:runs` (actor `user`): `OpenSession`, `SendMessage`, `StopTurn`, `ReadSession`, `ReadReceivedMessage`, `ListReceivedMessages`, `ReadTurn`, `ReadMessageBody`, `ReadRun`, `ListRuns`. 사람 메시지를 넣고 session을 여는 route가 user만 받는다.
   - `machine:runs-settle` (actor `machine`): `CreateRun`, `SettleRun`, `RemoveQueuedMessage`.
2. 부르는 helper 둘.
   - command: `ctx.writer.command(자격, { command: route.name, input, idempotency_key: ids.newId("idk"), compare, prepared: [] })`, 성공이면 `done.value.result`. `ctx.writer`는 build가 다 끝난 뒤 채워지므로 부를 때 읽는다(`context.ts`). 날 writer(`ctx.runtime.writer`)를 쓰지 않는다(`event.md`: 본문 준비와 입력함 적용을 건너뛰어 turn이 열리지 않는다).
   - read: ``ctx.runtime.reads.get(`${route.resource}/${route.method}`)!(자격, input)``. pool read와 pool 밖 read(`ReadMessageBody`)가 같은 길이다.
3. `build(ctx)`에서 `createRunService`를 만든다. deps는 `ids: createIdSource({ clock: ctx.clock, random: ctx.random })`, `timers: systemTimers`(hr-runs-core)와 아래 port다. `ctx.appCallPath`, `ctx.inbox`도 부를 때 읽는다.
   - `agents`
     - `resolve(named)`: `ledgerSnapshot(ctx.ledgerPath, (lookup) => createSessionDirectory({ ...placeDepsOf(lookup.sql), publish: () => {}, sql: () => lookup.sql }).resolveAgent(named))`를 펴서 돌려준다. Router의 `SessionDirectory.resolveAgent`와 같은 이름 풀기다(정확히 맞는 이름만, coding_agent는 `invalid_input`).
       - 정한 것: `runs-registration.ts`는 만들지 않는다. 이유: 이름 풀기는 tx가 필요 없고, `router.ts`가 main thread에서 같은 길(`ledgerSnapshot`, `placeDepsOf`)로 읽는다.
     - `agentOf(session)`: `ReadSession` → `session.agent`. `lifecycle`이 `open`이 아니면 `conflict`. 없으면 `not_found`가 그대로 간다.
     - `open(agent, session)`: `OpenSession { id: session, agent }`.
     - `send(session, message, text)`: `SendMessage { id: message, session, content: { schema_version: 1, parts: [{ kind: "text", text }] }, delivery: "next_turn", refs: [], unattended: true }`.
     - `turnOf(message)`: `ReadReceivedMessage` → `message.turn`이 null이면 null, 메시지가 `not_found`(취소로 지워짐)여도 null. 아니면 `ReadTurn` → `{ turn, state, outcome }`.
     - `answer(session, turn)`: `ListReceivedMessages { session, turn }`를 `next_cursor`가 null일 때까지 읽고, `from.kind === "agent"`이고 `from.session === session`인 것(그 session의 agent가 `RecordMessage`로 남긴 것) 가운데 마지막 것을 `ReadMessageBody`로 읽어 text part를 `\n`으로 잇는다. 없으면 null.
       - 정한 것: `messagesList`(`ListMessages`)가 아니라 `ListReceivedMessages`를 쓴다. 이유: `ListMessages`는 core에 handler가 없어(`grep -rn "route: messagesList" packages/core`가 0줄) 부르면 늘 실패한다. `ListReceivedMessages`는 turn으로 거르고 `from`으로 보낸 쪽을 가른다.
     - `stop(turn)`: `ReadTurn` → running이면 `StopTurn { turn, request_key: "run:" + turn, reason: "user_stopped" }`, compare `{ state_seq }`. 이미 끝났으면 ok다. turn을 닫은 `TurnEnded`가 `lophn-agent-runtime.ts`의 구독으로 child에 `turn_stop`을 보낸다.
     - `unqueue(session, message)`: `RemoveQueuedMessage { session, message }`(machine 자격) → 성공하면 `ctx.inbox.remove(session, message)`(`lophn-agent-runtime.ts`의 `remove`와 같은 순서). 이미 가져갔으면 `conflict`가 그대로 간다.
   - `tools`
     - `resolveApp(app)`: `ledgerSnapshot(ctx.ledgerPath, (lookup) => placeDepsOf(lookup.sql).apps.appByName(app))` → null이면 `not_found`, 아니면 그 id.
     - `call(run, app, tool, input)`: `ctx.appCallPath.call({ target: { mode: "live", app, release: null }, tool, ...(input === undefined ? {} : { input }), caller: { kind: "person", view_session: run } }, { actor: "user" })`.
   - `store`: `create`·`settle`은 `CreateRun`·`SettleRun`(machine 자격, `SettleRun`의 compare는 `{ state: "running" }`). `read`는 `ReadRun`, `running()`은 `ListRuns { state: "running" }`를 cursor 끝까지(user 자격. 두 read는 user만 받는다).
4. memory handler 셋을 `build`가 `memory`로 낸다. key는 `${route.resource}/${route.method}`다. 입력 검사와 actor 검사(user)는 dispatch가 이미 했다(`packages/core/server/dispatch.ts`). coding token은 route actors에 없어 `forbidden`이다(README).
   - `StartRun` → `service.start(input)` → `{ run }`. `WaitRun` → `service.wait(input.run, input.timeout_ms)` → `{ run }`. `CancelRun` → `service.cancel(input.run)` → `{ run }`.
5. `start(ctx)`: 먼저 `ctx.bus.subscribe([{ types: ["TurnEnded"] }], { send(event) { if (event.type === "TurnEnded") void service.turnEnded({ turn: event.payload.turn, messages: event.payload.messages }); }, close() {} })`로 구독하고, 그 뒤 `await service.reconcile()`. reconcile이 실패해도 기동을 멈추지 않고 `console.error`로 한 줄 남긴다(`router.ts`의 `start`와 같다). 구독을 먼저 해 reconcile과 구독 사이에 끝난 turn을 놓치지 않는다. 같은 run을 둘이 settle해도 `SettleRun`의 compare가 하나만 받는다.
   - `start`는 `routerWiring`의 `start`(켤 때 잃어버린 call과 돌던 turn을 interrupted로 닫는다) 뒤에 돌아야 reconcile이 닫힌 turn을 본다. agent runtime은 `afterReady`에 떠서 그 전에는 새 turn이 없다. 순서는 lead가 `WIRINGS`에서 맞춘다(보고).
6. `closeIntake()`: 구독을 풀고 `service.close()`(걸린 `WaitRun`을 바로 돌려준다. `server.stop`이 받은 요청을 기다리기 때문이다).
7. 확인: assembly 등록이 없으면 core가 이 wiring을 싣지 않는다. `packages/core/main/daemon/assembly.ts`에 아래 "등록할 것" 셋을 임시로 넣고 `cd <worktree>; project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는지 본다(memory route와 handler 대조, route 중복, 자격 기록이 기동 때 드러난다). 임시 줄은 `git checkout -- packages/core/main/daemon/assembly.ts`로 되돌리고 commit하지 않는다.

추가(planner, 살 단계 뒤): `SessionEnded`도 구독한다. 입력이 아직 줄에 있는 채로 session이 archive되거나 지워지면 입력함이 비워져 turn이 열리지 않고 `TurnEnded`도 오지 않는다. 그 session의 running run은 `turn_interrupted`로 닫는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 위험 규칙은 hr-runs-core의 test가 본다. 여기는 port를 잇는 조립이다.
- 임시 등록으로 `boot.sh`가 두 번 `exit 0`이었다(보고에 적는다). `git diff --name-only`에 `assembly.ts`가 없다.
- `grep -n "messagesList\|runtime.writer" packages/core/main/daemon/wiring/runs.ts`가 0줄이다.
- `grep -n "unattended: true" packages/core/main/daemon/wiring/runs.ts`가 한 줄이다(approval-simplify의 칸 이름이 다르면 그 이름).

## 보고

- 바꾼 file
- 통과한 check(임시 등록으로 돌린 `boot.sh` 결과 포함)
- 등록할 것: `packages/core/main/daemon/assembly.ts`
  - `WIRINGS`: `runsWiring`(`./wiring/runs.ts`)을 `routerWiring`과 `appsWiring` 뒤, `lophnAgentRuntimeWiring` 앞 어디에 둔다(예: `annotationsWiring` 뒤). `start` 순서가 뜻을 가진다(위 5).
  - `TEAMS`·`TEAM_MODULES`: hr-runs-core 보고의 runs 등록 둘. 이 wiring과 같은 commit으로 넣는다(memory route만 있고 handler가 없으면 core 기동이 멈춘다).
  - 그 밖에 lead가 고칠 목록 file
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 둘을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
