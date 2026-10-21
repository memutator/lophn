# hr-runs-core

feature module `packages/core/runs/`를 만든다: `runs` 표, `CreateRun`·`SettleRun` command, `ReadRun`·`ListRuns` read, 그리고 lophn agent와 앱을 port로만 부르는 run service(시작, 기다리기, 취소, turn 끝으로 settle하기, 켤 때 맞추기, session이 끝날 때 닫기). 이 task보다 먼저 lead가 빈 `packages/core/runs/mod.ts`와 catalog 항목을 commit한다(README "뼈대 검토에서 정한 것").

- 단위: runs (wave 2)
- 선행: hr-contract-runs.
- 소유(이 task만 고친다):
  - `packages/core/runs/`
  - `tools/check-deps.ts`
- 읽을 것:
  - 계약: `project-docs/plan/headless-run/tasks/hr-contract-runs.md`의 "내놓는 것" 전부(run 기록, route 표, `StartRun` 입력·오류·순서, "끝"을 정하는 규칙)
  - 제품 결정: `project-docs/plan/headless-run/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것"(code fence 하나 벗기기, `invalid_output`은 run의 실패 이유, tool run 취소는 앱 호출을 멈추지 않는다, run 입력은 켤 때 다시 줄 세우지 않는다, `StartRun`은 이름을 다 푼 뒤 session을 연다, `ListRuns`는 `agent`와 `place`로 거르고 run은 만들 때 place를 기록한다, run의 session이 끝나면 running run은 `turn_interrupted`). roadmap `project-docs/products/roadmap/headless-schedule.md`의 "모양"과 "test"의 세 번째 줄
  - architecture: `project-docs/architecture/layers.md`("feature module", "규칙과 그 이유", "import를 지우려고 다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다"), `project-docs/architecture/event.md`("이어서 움직이는 일": 뒤에 꼭 움직여야 하는 일은 그 일을 아는 command가 같은 tx에서 한다, "events 표": 기록 event로 반응을 걸지 않는다, "Bus": Bus는 놓칠 수 있고 정본은 각 module의 표다), `project-docs/architecture/agent-call.md`("보낸 쪽을 막지 않는다. 동기 호출, timeout, 자동 재시도가 없다"), `project-docs/architecture/place-session.md`("lophn이 꺼졌다 켜져도" 줄)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `runs`(lead가 먼저 둔다), `core-api`; `project-docs/module-catalog.yaml`의 `packages/core/runs`
  - 코드(본보기와 이어 붙일 곳)
    - feature module 꼴: `packages/core/domains/register.ts`(`createLedgerRegistration`·`createReaderRegistration`), `packages/core/domains/schema.ts`, `packages/core/domains/commands.ts`, `packages/core/domains/reads.ts`(id cursor), `packages/core/domains/store.ts`, `packages/core/projects/register.ts`(`memoryRoutes`를 등록에 싣는 꼴)
    - `packages/core/router/schema.ts`(`agent_calls`: 끝난 행이 바뀌지 않는 trigger, enum check를 protocol 상수로 만드는 꼴)
    - `packages/core/lophn-agent/session/message-commands.ts`의 `nextCreatedSeq`(ledger event 없이 표 안에서 seq를 센다)
    - `packages/core/apps/calls/intake.ts`의 `Timers`·`systemTimers`(timer 주입 꼴. runs는 apps를 import하지 않으니 같은 꼴을 runs 안에 둔다)
    - `packages/core/main/daemon/registration.ts`(`assemble`이 읽는 칸), `packages/core/storage/ledger/team-module.ts`, `packages/core/main/daemon/core.ts`의 `memoryRouteMismatch`
    - `packages/protocol/apps/calls/call.ts`(`ToolCallOutput`와 outcome 넷), `packages/protocol/lophn-agent/turn-values.ts`(`TURN_OUTCOME_REASONS`), `packages/protocol/lophn-agent/calls.ts`(`NamedAgent`), `packages/protocol/lophn-agent/places.ts`(`AgentRef`, `placeOfAgentRef`: Operator의 place는 ref에 없다), `packages/protocol/lophn-agent/message-content.ts`(`MESSAGE_CONTENT_MAX_BYTES`, `serializeMessageContent`)
    - `tools/check-deps.ts`의 `CORE_FEATURES`와 `coreLayerViolation`
    - test: `.claude/skills/write-test/SKILL.md`, `packages/base/clock.ts`(`manualClock`), `packages/base/id.ts`(`createIdSource`), `packages/base/random.ts`(`seededRandom`)
- 계약:
  - 쓰는 것: hr-contract-runs의 `RUN_ROUTES`, run 기록, `RunPlace`, "끝"을 정하는 규칙. `packages/base`의 Clock·IdSource. zod 4.6.5의 `z.fromJSONSchema`. `packages/protocol/apps/calls/call.ts`의 `ToolCallOutput`(type만)
  - 내놓는 것(hr-runs-wiring이 잇는다):
    - `packages/core/runs/register.ts`: `createLedgerRegistration()`·`createReaderRegistration()`. schema step `runs.tables`, command `CreateRun`·`SettleRun`, read `ReadRun`·`ListRuns`, `memoryRoutes`에 `runStart`·`runWait`·`runCancel`.
    - `packages/core/runs/service.ts`: `createRunService(deps)`가 `start(input)`, `wait(run, timeout_ms)`, `cancel(run)`, `turnEnded(event)`, `sessionEnded(session)`, `reconcile()`, `close()`를 낸다. deps는 port다.
      - `agents`: `resolve(named) → { agent: AgentRef, place: RunPlace | null }`, `agentOf(session) → { agent, place }`, `open(agent, session id)`, `send(session, message id, text)`(unattended로 넣는다), `turnOf(message) → { turn, state, outcome } | null`, `answer(session, turn) → string | null`, `stop(turn)`, `unqueue(session, message)`
      - `tools`: `resolveApp(app) → app id`, `call(run, app, tool, input) → ToolCallOutput`
      - `store`: `create`, `settle`, `read`, `running()`
      - `ids`, `timers`
    - `runMessageText({ prompt, input, schema })`: agent에게 넣는 글. prompt 뒤에 입력 JSON과 schema 지시를 고정 영어 문장으로 잇는다.
    - `tools/check-deps.ts`: `CORE_FEATURES`에 `runs`를 더한다. runs는 다른 feature module과 lophn-agent를 import하지 않는다.

## 할 일

근거는 hr-contract-runs의 계약과 README다. runs는 base, protocol, zod만 import한다. lophn agent와 앱은 port로만 부르고 구현은 hr-runs-wiring이 끼운다(`layers.md`). 시각은 command의 `tx.now()`가 정하고, id와 timer는 deps로 받는다(AGENTS.md "코드").

1. `packages/core/runs/ports.ts`: service의 port type.
   - `RunAgents`: 계약의 여덟(`resolve`, `agentOf`, `open`, `send`, `turnOf`, `answer`, `stop`, `unqueue`). 모두 `Promise<Result<…>>`다.
     - `resolve(named: NamedAgent) → { agent: AgentRef, place: RunPlace | null }`. 못 풀면 `not_found`, 여럿이면 `invalid_input`이 그대로 온다.
     - `agentOf(session) → { agent: AgentRef, place: RunPlace | null }`. 없으면 `not_found`, 열린 session이 아니면 `conflict`.
       - 정한 것: `agentOf`를 둔다. 이유: `--session`으로 이어 쓰는 run도 기록의 `target.agent`가 있어야 한다(계약의 `runRecordSchema`).
       - 정한 것: 두 port가 place를 같이 돌려준다. 이유: run은 만들 때 place를 기록하는데(README) Operator의 place는 `AgentRef`에 없다(`placeOfAgentRef`가 undefined). runs는 다른 module의 표를 읽지 않으므로(`layers.md`) 이름을 푸는 쪽(wiring)이 준다.
     - `open(agent, session) → void`, `send(session, message, text) → void`(unattended로 넣는다), `turnOf(message) → { turn, state: "running" | "finished", outcome: TurnOutcome | null } | null`(아직 가져간 turn이 없거나 메시지가 지워졌으면 null), `answer(session, turn) → string | null`, `stop(turn) → void`(이미 끝났으면 ok), `unqueue(session, message) → void`(이미 가져갔으면 `conflict`).
   - `RunTools`: `resolveApp(app: string) → Id<"app">`(없으면 `not_found`), `call(run, app, tool, input) → ToolCallOutput`(`packages/protocol/apps/calls/call.ts`의 type만 import).
   - `RunStore`: `create(CreateRun 입력) → RunRecord`, `settle(SettleRun 입력) → RunRecord`(running이 아니면 `conflict`), `read(run) → RunRecord`(`not_found`), `running() → RunRecord[]`.
   - `Timers = { set(fn, ms): unknown; clear(handle): void }`와 `systemTimers`(`setTimeout`·`clearTimeout`).
     - 정한 것: `WaitRun`의 timer는 deps `timers`로 받는다. 이유: Clock에 timer가 없다. `packages/core/apps/calls/intake.ts`와 같은 꼴이다. `clock`은 시각을 command가 정해 service에 쓸 곳이 없으면 deps에 두지 않는다.
2. `packages/core/runs/schema.ts`: `runsSchemaSteps`, step id `runs.tables`. 표 `runs` 하나(strict).
   - 칸: `id` primary key, `kind`, `target`(JSON), `session`, `session_opened`(0·1), `input_message`, `turn`, `invocation`, `schema`(JSON), `state`, `result`(JSON 글. JSON `null`과 SQL NULL은 읽을 때 둘 다 null이다), `error_reason`, `error_message`, `created_at`, `finished_at`, `state_seq`, 그리고 `ListRuns` 거르기용 `agent_key`와 `place_key`.
     - `agent_key`: agent run만. `lophn`, `project_manager:<prj>`, `app_engineer:<app>`, `operator:<agt>`. tool run은 null. `place_key`: `CreateRun` 입력의 `place`에서 `project:<prj>` 또는 `app:<app>`, 없으면(lophn run) null. 둘 다 만들 때 정하고 바뀌지 않는다.
     - 정한 것: `target` JSON을 `json_extract`로 거르지 않고 칸 둘을 둔다. 이유: index로 바로 거르고, AgentRef와 place를 같은 글 하나로 비교한다. 같은 key를 만드는 함수(`agentKeyOf`, `placeKeyOf`)를 `CreateRun`과 `ListRuns`가 같이 쓴다.
   - check: enum 셋은 protocol의 `RUN_KINDS`·`RUN_STATES`·`RUN_FAIL_REASONS`로 만든다(`packages/core/router/schema.ts`의 `list`). `(state = 'failed') = (error_reason is not null)`, `(error_reason is null) = (error_message is null)`, `(state = 'running') = (finished_at is null)`, JSON 칸은 `json_valid`.
   - index: `(session, id)`, `(agent_key, id)`, `(place_key, id)`, `(state, id)`. trigger: 끝난 행(`old.state <> 'running'`)은 바뀌지 않는다.
   - 다른 module의 표를 참조하지 않는다(물리 FK 없음). 취소로 지워진 메시지를 `input_message`가 가리켜도 된다.
3. `packages/core/runs/store.ts`: 행 ↔ `RunRecord`, `insertRun`, `loadRun`, `listRuns(sql, { session?, agent?, place?, state?, after?, limit })`, `settleRow`. `listRuns`의 거르기는 준 칸을 모두 AND로 건다(`agent`는 `agent_key = agentKeyOf(agent)`, `place`는 `place_key = placeKeyOf(place)`). 계약 `ListRuns`의 거르기다(화면이 project sidebar와 앱 공간마다 자주 읽고 job이 run을 많이 만든다).
   - `state_seq`는 표 안에서 이어 센다(`select coalesce(max(state_seq), 0) + 1 from runs`). 만들 때와 settle할 때 새 값이다.
     - 정한 것: 기록 event(`tx.emit`)를 남기지 않는다. 이유: run의 끝을 기다리는 것은 메모리 waiter와 다시 읽기이고, 기록 event는 반응이나 화면 갱신의 계기가 아니다(`event.md` "events 표").
   - 목록은 새것이 앞이다: `order by id desc`(run id는 같은 IdSource가 낸 ULID라 만든 순서다). cursor는 page 마지막 run id이고 다음 page는 `id < cursor`다. page는 50.
4. `packages/core/runs/commands.ts`: `createRunCommands()` → `{ create, settle }`. 둘 다 `parseActor(ctx.actor)?.kind === "machine"`이 아니면 `forbidden`이다.
   - `CreateRun`: 같은 id가 있으면 `conflict`. `state: "running"`, `created_at: tx.now()`, `agent_key`·`place_key`를 정해 넣는다.
   - `SettleRun`: 없으면 `not_found`, `row.state !== compare.state`(running)면 `conflict`. done은 `result`(없으면 null), failed는 `error`, cancelled는 둘 다 없다. `turn`·`invocation`이 오면 채운다. `finished_at: tx.now()`.
5. `packages/core/runs/reads.ts`: `createRunReads()` → `{ read, list }`. user만 부르는 route다(actor 검사는 dispatch가 한다). 없는 run은 `not_found`. `list`는 입력의 `session`·`agent`·`place`·`state`·`cursor`를 `listRuns`에 그대로 넘긴다.
6. `packages/core/runs/register.ts`: 계약의 "내놓는 것" 그대로. `createLedgerRegistration()`은 `{ schemaSteps: runsSchemaSteps, commands: [create, settle], reads: [read, list], memoryRoutes: [runStart, runWait, runCancel] }`, `createReaderRegistration()`은 `{ reads: [read, list], ports: new Map() }`(`packages/core/domains/register.ts`의 꼴). `service.ts`를 import하지 않는다(Worker가 이 file을 싣는다).
7. `packages/core/runs/text.ts`: 순수 함수 둘. test는 두지 않는다(11).
   - `runMessageText({ prompt, input, schema })`. 정한 것(고정 영어 글. 빈 칸은 빈 줄 하나):
     - prompt 그대로
     - `input`이 있으면 `Input (JSON):` 줄과 `JSON.stringify(input, null, 2)`
     - `schema`가 있으면 `Reply with only one JSON value that matches this JSON Schema. Do not add any other text.` 줄과 `JSON.stringify(schema, null, 2)`
   - `readAnswer(text, schema) → { ok: true, value: JsonValue } | { ok: false, message: string }`(경계가 아니라 안쪽 함수다. 실패의 `message`는 service가 `invalid_output`의 글로 적는다). 계약의 completed 규칙대로: trim → 글 전체가 fence 하나(첫 줄이 `` ``` ``로 시작하고 끝 줄이 `` ``` ``)면 그 둘을 벗긴다 → `JSON.parse` → `z.fromJSONSchema(schema).safeParse`. 맞으면 읽은 값이다. 그 밖에는 글을 고치지 않는다.
8. `packages/core/runs/service.ts`: `createRunService({ agents, tools, store, ids, timers })`가 `start`, `wait`, `cancel`, `turnEnded`, `sessionEnded`, `reconcile`, `close`를 낸다. 모두 `Promise<Result<RunRecord>>`(turnEnded·sessionEnded·reconcile·close는 `Promise<void>`)다.
   - `start(input)`(입력은 `StartRun` 입력). **이름 풀기와 검사를 다 끝낸 뒤에만 session을 열고 run을 만든다.** 순서를 바꾸지 않는다(README "뼈대 검토에서 정한 것": CLI가 `operator:<x>/<이름>`을 project로 부르고 `not_found`면 앱으로 다시 부른다. 첫 시도가 session이나 run을 남기면 안 된다).
     - agent run
       1. `agent`와 `session`이 정확히 하나가 아니면 `invalid_input`. `agent.role === "coding_agent"`면 `invalid_input`.
       2. `schema`가 있으면 `z.fromJSONSchema(schema)`를 try로 불러 던지면 `invalid_input`.
       3. 글을 `runMessageText`로 만들고 `serializeMessageContent({ schema_version: 1, parts: [{ kind: "text", text }] })`가 `MESSAGE_CONTENT_MAX_BYTES`를 넘으면 `invalid_input`.
       4. 이름 풀기: `agent`면 `agents.resolve(agent)`, `session`이면 `agents.agentOf(session)`. 둘 다 `{ agent, place }`다. 오류는 그대로 돌려준다. 여기까지 아무것도 쓰지 않는다.
       5. id를 낸다: run(`run`), 메시지(`msg`), 새 session이면 session(`ses`).
       6. `store.create`(running, 4의 `place`, `session_opened`는 새 session이면 true).
       7. 새 session이면 `agents.open(agent, session)`. 그다음 `agents.send(session, message, text)`. 둘 중 하나가 오류면 `failed`·`start_failed`(message는 오류 code)로 settle하고 그 run을 돌려준다.
       8. run을 돌려준다(running).
     - tool run: `tools.resolveApp(app)`(오류는 그대로) → `store.create`(`place`는 `{ app }`) → 기다리지 않고 `tools.call(run, app, tool, input)`을 띄운다 → run을 돌려준다(running). call이 끝나면 계약의 tool 규칙으로 settle한다(succeeded → done과 `invocation`, failed → `tool_failed` `<code>: <message>`, denied → `tool_denied` denial code, unknown → `tool_unknown` reason).
       - 정한 것: call이 `err`이거나 던지면 `tool_denied`, message는 `<code>: <message>`. 이유: handler까지 가지 못한 것이다. 선언 안 된 tool은 call이 denied `not_declared`로 돌려주므로 `StartRun`이 tool `not_found`를 내지 않고 run이 `tool_denied`로 끝난다(tool 선언을 미리 볼 port가 없다).
   - 끝 맞추기 `settleFromTurn(run)`(안쪽 함수). 계약의 "끝" 규칙 그대로: `agents.turnOf(run.input_message)`가 null이거나 running이면 아무것도 하지 않는다. finished면 outcome으로 가른다. completed는 `agents.answer(run.session, turn)` → null이면 `no_answer`, schema가 있으면 `readAnswer`(실패면 `invalid_output`), 없으면 답 글이 `result`다. failed → `turn_failed`(message는 reason), interrupted `user_stopped`·`session_ended` → `turn_interrupted`, `restarted` → `lophn_restarted`. settle에 `turn`을 싣는다.
     - 끝은 늘 `run.input_message`를 가져간 turn에서만 본다. 이벤트가 알려 준 turn을 그대로 믿지 않는다. 같은 session의 다른 입력이 연 turn의 끝은 이 run을 바꾸지 않는다.
   - settle은 하나의 안쪽 함수로 한다. `store.settle`이 `conflict`면 이미 끝난 것이라 무시하고 지금 기록을 읽는다. settle이 되면 그 run의 waiter를 모두 푼다.
   - `turnEnded({ turn, messages })`: `store.running()`에서 agent run 가운데 `input_message`가 `messages`에 있는 것마다 `settleFromTurn`.
   - `sessionEnded(session)`: `store.running()`에서 `session`이 그 session인 agent run마다 먼저 `settleFromTurn`을 하고, 아직 running이면 `turn_interrupted`(message `session_ended`)로 settle한다. 이유: 입력이 줄에 있는 채로 session이 archive되거나 지워지면 입력함이 비워져 turn이 열리지 않고 `TurnEnded`도 오지 않는다(README "뼈대 검토에서 정한 것"). hr-runs-wiring이 `SessionEnded`에 잇는다.
   - `wait(run, timeout_ms)`: 읽어서 끝났으면 돌려준다. running인 agent run이면 먼저 `settleFromTurn`을 한 번 한다(Bus는 놓칠 수 있다, `event.md`). 아직 running이면 메모리 waiter를 걸고 `timers.set`으로 `timeout_ms`를 잰다. 먼저 오는 쪽에서 timer를 지우고 waiter를 뺀 뒤, timeout이었으면 `settleFromTurn`을 한 번 더 하고 지금 기록을 돌려준다.
   - `cancel(run)`: 읽어서 running이 아니면 `conflict`. 먼저 cancelled로 settle한다(conflict면 `conflict`). 그 뒤 agent run이면 `turnOf`가 null일 때 `unqueue`, `unqueue`가 `conflict`면(그 사이 가져갔다) `turnOf`를 다시 읽는다. turn이 running이면 `stop`. tool run은 앱 호출을 멈추지 않는다(README). 뒤 단계의 오류는 기록에 남기지 않고 cancelled 기록을 돌려준다.
   - `reconcile()`: 켤 때 한 번. `store.running()`마다 tool run은 `lophn_restarted`, agent run은 `settleFromTurn`을 하고, 그 뒤에도 `turnOf`가 null이면 `lophn_restarted`(그 메시지는 입력함에 다시 들어가지 않는다, hr-session-input). turn이 running이면 그대로 둔다(그 turn의 `TurnEnded`가 끝낸다).
   - `close()`: 걸린 waiter를 모두 풀고 timer를 지운다. 정한 것: `close`를 더한다. 이유: `server.stop`은 받은 요청이 끝나기를 기다리므로(`packages/core/main/daemon/core.ts`) 걸린 `WaitRun`이 종료를 60초까지 늦춘다.
   - 자동 재시도는 없다.
9. `packages/core/runs/mod.ts`(lead가 빈 file로 둔다): `createRunService`, `runMessageText`, `readAnswer`, `systemTimers`, port type, `createLedgerRegistration`·`createReaderRegistration`을 내보낸다.
10. `tools/check-deps.ts`: `CORE_FEATURES`(지금 `new Set(["projects", "apps", "domains"])`)에 `"runs"`를 더하고, 그 위 주석("core 안 층. … feature module(projects, apps, domains) …")의 feature module 목록에도 runs를 더한다. 그러면 runs와 다른 feature module, `agent-roles` 사이의 import가 막힌다. lophn-agent는 규칙상 import할 수 있지만 runs는 하지 않는다(아래 grep). feature module 사이의 예외 목록은 이제 없다.
11. test 하나(아래 "끝남"). 가짜 port다(`write-test` "모양": 준비는 가볍게).
    - `packages/core/runs/service_test.ts`: 가짜 `agents`(session 하나, 메시지마다 가져간 turn과 turn마다 답을 바꿀 수 있는 표), 메모리 `store`, 아무것도 하지 않는 `timers`, `createIdSource({ clock: manualClock(…), random: seededRandom(…) })`. `start({ kind: "agent", session, prompt })` 뒤, 같은 session에 먼저 들어온 메시지 A를 가져간 turn T1이 답 "first"로 끝나 `turnEnded({ turn: T1, messages: [A] })`를 부르면 run은 running이다. run의 메시지를 가져간 T2가 답 "second"로 끝나 `turnEnded({ turn: T2, messages: [run 메시지] })`를 부르면 run은 done이고 `result`는 "second", `turn`은 T2다. 판정은 `store.read`의 결과로만 한다(호출 횟수를 세지 않는다).
    - `readAnswer`(fence 벗기기)의 test는 두지 않는다(planner, 살 단계 뒤). data를 잃거나 권한을 넘는 일을 지키는 test가 아니다(`write-test`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "run의 결과는 그 입력이 연 turn의 답이다. 같은 session에 먼저 들어온 다른 입력의 답을 돌려주지 않는다"(`packages/core/runs/service_test.ts`)
- `grep -rn "core/lophn-agent\|core/apps\|core/projects\|core/domains\|core/router\|core/agent-roles\|core/main" packages/core/runs`가 0줄이다.
- `grep -rn "tx.emit" packages/core/runs`가 0줄이다(기록 event를 남기지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/core/main/daemon/assembly.ts`의 `TEAMS`에 `{ createLedgerRegistration: createRunsRegistration }`(`../../runs/register.ts`), `TEAM_MODULES`에 `new URL("../../runs/register.ts", import.meta.url).href`. 이 둘은 hr-runs-wiring의 `runsWiring`과 같은 commit으로 등록한다. memory route만 있고 handler가 없으면 core 기동이 "memory route와 handler가 맞지 않는다"로 멈춘다(`memoryRouteMismatch`). 계획 끝에 `project-docs/architecture/layers.md`의 feature module 목록에 runs를 더한다(lead). 그 밖에 lead가 고칠 목록 file
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"들을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
