# stream-core

agent 글이 쓰이는 대로 core까지 흐르게 한다: adapter 셋이 글 delta를 run-loop가 준 callback에 넘기고, run-loop가 짧게 묶어 날 글을 감독 pipe로 core에 보내며, core가 쌓인 글 전체를 redaction해 `ModelOutputStreamed`로 낸다. model 응답마다 agent message를 저장하고 `MessageRecorded`를 낸다. core는 session마다 쓰는 중인 글을 메모리에 들고 session snapshot의 `writing`에 싣는다. retry한 attempt의 글은 버리고, 멈춘 답은 사람이 본 데까지 남긴다.

정한 것(planner): 사람이 멈춘 attempt의 글은 그때까지 쓰인 데까지 agent message로 저장한다. turn이 끝나기 전에 저장한다(지금 `RecordMessage`는 끝난 turn을 거절한다). provider가 끊어 retry하는 attempt(`partial`, `temporary`)의 글은 버린다. live delta의 redaction은 core가 `chat-protocol`의 규칙(쌓인 글 전체에 걸고 끝을 붙잡는다)대로 한다. tool call과 같이 온 글도 message로 저장하게 되므로, 다음 turn의 model 이력에 응답마다의 글이 한 번만 들어가는지 본다.

정한 것: tool call과 같이 온 글도 agent message로 저장한다(`chat-protocol`의 agent message 규칙. 지금은 `run-loop/turn.ts`의 `afterModel`이 이력에만 넣는다). delta 길은 처음부터 `text`·`reasoning` 두 kind를 다 나른다.

- 단위: stream (wave 2)
- 선행: 없음. `stream-redact`(wave 1)의 `redactSettled`를 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/providers/adapters/{messages,responses,chat-completions}.ts`
  - `packages/core/lophn-agent/providers/invoke.ts`
  - `packages/core/lophn-agent/providers/work.ts`
  - `packages/core/lophn-agent/models/binding.ts`
  - `packages/core/lophn-agent/run-loop/{core-ports,turn,ports,prepare,commands,turn-pipe,runtime}.ts`
  - `packages/core/lophn-agent/run-loop/live-turns.ts` (새 file)
  - `packages/core/lophn-agent/run-loop/live-turns_test.ts` (새 file)
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/session/message-commands_test.ts`
  - `packages/core/main/agent-runtime/turn-source-link.ts`
  - `packages/core/main/daemon/wiring/{session-snapshots,lophn-agent-runtime,context}.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(agent event는 저장하지 않는다, child가 감독 pipe로 내고 core가 Bus에 낸다, Bus는 core 안에 하나다, Bus에 내는 것은 commit 뒤, core 안 command는 접힌 writer `ctx.writer`를 쓴다, 늦게 붙은 화면은 snapshot으로 맞춘다), `project-docs/architecture/run.md`(run의 답은 그 turn에서 agent가 남긴 마지막 message의 글이다. 62줄)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 element `run-loop`, `models`, `agent-sessions`, `events`와 interface `child-supervision-protocol`, `event-stream`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`(wiring은 조립만 하고 wiring끼리 import하지 않는다)
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것"(streaming의 길, 뼈대 검토의 셋: 응답마다 message, 멈춘 답, live 글의 redaction은 core가 한다), `project-docs/products/roadmap/agent-chat.md` 4
  - 계약: `project-docs/plan/agent-chat/tasks/chat-protocol.md` "내놓는 것"(이 task가 기대는 모양 전부. 감독 pipe `model_output` 포함), `project-docs/plan/agent-chat/tasks/stream-redact.md` "내놓는 것"(`redactSettled`)
  - skill: `.claude/skills/write-test/SKILL.md`
  - 코드:
    - provider: `packages/core/lophn-agent/providers/work.ts`(`ModelCallInput`, `ModelCallOutput`), `packages/core/lophn-agent/providers/invoke.ts`(`collectorFor`, `invoke`의 stream·batch 두 길), `packages/core/lophn-agent/providers/adapters/{messages,responses,chat-completions}.ts`(`applyFrames`류가 `text`를 쌓는 곳: `messages.ts` 277줄, `responses.ts` 230줄, `chat-completions.ts` 241줄), `packages/core/lophn-agent/models/binding.ts`(`ModelBinding.invoke`는 type뿐이고 만드는 곳은 `models/resolve.ts`의 `createInvokeModelCall`. `chatMessages` 317줄)
    - run-loop(child): `packages/core/lophn-agent/run-loop/turn.ts`(`runTurn`, `callModel`, `afterModel`, `conclude`, `finishWith`), `packages/core/lophn-agent/run-loop/ports.ts`(`TurnPorts.answer`, `ModelAttempt`, `LoopDeps.wait`, `AgentEventSink` 72줄), `packages/core/lophn-agent/run-loop/core-ports.ts`(`modelAttempt`, `lastModelCall`, `answer`), `packages/core/lophn-agent/run-loop/prepare.ts`(`createCorePorts`를 부르는 598줄, `abortableWait`), `packages/core/lophn-agent/run-loop/retry.ts`(`abortableWait`)
    - 감독 pipe(child → core):
      - child가 보낸다: `packages/core/main/agent-runtime/turn-source-link.ts`(`events.publish`가 `agent_event`를 보낸다. 98줄), `packages/core/main/agent-runtime/main.ts`(`CoreCalls.events`가 그 sink다. 고치지 않는다), `packages/core/supervision/responsiveness/child.ts` 271줄(보내는 message를 `childMessageSchema`로 검사한다. 어긋나면 그 message만 거절되고 뒤는 간다), `packages/core/supervision/responsiveness/frames.ts`(frame을 순서대로 쓰고 하나를 빼고 이어 쓰지 않는다)
      - core가 받는다: `packages/core/lophn-agent/run-loop/runtime.ts`(`AgentRuntimeDeps` 171줄, `createTurnPipe` 273줄, child message를 가르는 `onMessage` 295줄), `packages/core/lophn-agent/run-loop/turn-pipe.ts`(`agent_event`를 검사해 Bus에 낸다), `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(`startAgentRuntimeChild` 211줄, `publish: ctx.bus.publish` 228줄. child는 `afterReady`에 뜬다), `packages/core/main/daemon/wiring/context.ts`(늦은 칸 `Late` 179줄, `LATE_KEYS` 252줄, `provide`·`peek`)
    - redaction(core): `packages/core/lophn-agent/run-loop/runtime-redaction.ts`(`redactSettled`. `stream-redact`가 더한다), `packages/core/main/daemon/wiring/secrets.ts` 49줄(`ctx.knownSecrets`)
    - 멈춤의 지금 길: `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`의 `stopTurnOf` → `packages/core/lophn-agent/run-loop/commands.ts`의 `stop`(같은 tx에서 행을 닫고 `publishTurnEnded`) → `packages/core/main/daemon/wiring/lophn-agent-runtime.ts` 298줄(Bus의 `TurnEnded`를 보고 child에 `turn_stop`) → `packages/core/main/agent-runtime/main.ts` 235줄(`driver.stop`) → `run-loop/loop.ts`의 `stop`. `run-loop/turn-events.ts`(handler는 writer Worker에서 돌아 Bus·core 메모리에 닿지 못한다)
    - 저장: `packages/core/lophn-agent/session/message-commands.ts`의 `recordAgent`(turn이 `running`일 때만 받는다), `packages/core/lophn-agent/session/message-body.ts`(`createMessageBodyPreparer`: command 앞에서 본문을 redaction해 blob을 준비한다. machine은 지금 글만)
    - 이력: `packages/core/lophn-agent/session/history.ts`의 `readSessionConversation`, `packages/core/lophn-agent/prompt-assembly/summary.ts`의 `sessionMaterial`, `run-loop/turn.ts`의 `historyOf`
    - core wiring: `packages/core/main/daemon/wiring/session-snapshots.ts`, `packages/core/main/daemon/wiring/context.ts`(`Built.writer`는 WIRINGS 순서로 접는다, `records`, `ctx.writer`, `ctx.bus`), `packages/core/main/daemon/assembly.ts`(WIRINGS 순서: `lophnAgentSessionWiring`이 `sessionSnapshotsWiring`보다 안쪽), `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(core 안 machine 자격 `SESSION_INPUTS_CONTEXT`의 본보기), `packages/core/events/bus.ts`(동기 메모리, 구독 해제 함수), `packages/core/storage/ledger/writer.ts`(`Writer`), `packages/core/storage/ledger/writer-message.ts`(`CommandEnvelope`)
    - test 본보기: `tests/support/loop/harness.ts`(`TurnPorts`를 구현한다. 소유 밖), `packages/core/lophn-agent/session/message-commands_test.ts`, `packages/core/apps/runtime/observations/log-file_test.ts`(진짜 `createKnownSecretRegistry`)
- 계약:
  - 쓰는 것: `chat-protocol`의 `ModelOutputStreamed`(두 kind), `MessageRecorded`, snapshot `writing`, agent message 규칙(응답마다 하나, 그 응답의 tool call보다 먼저 저장), 감독 pipe `model_output`(`modelOutputMessageSchema`, `ModelOutputMessage`, `MODEL_OUTPUT_UNITS_MAX`. `packages/protocol/supervision/supervision.ts`); `RecordMessage`(`packages/protocol/lophn-agent/messages.ts`); 감독 pipe의 `agent_event`(core 쪽은 `run-loop/turn-pipe.ts`가 Bus에 낸다); `stream-redact`의 `redactSettled(text, known)`(`run-loop/runtime-redaction.ts`); `ctx.knownSecrets`; Bus 구독(`ctx.bus`).
  - 내놓는 것:
    - adapter → run-loop delta callback: `ModelCallInput`(`providers/work.ts`)의 선택 칸 `onDelta(delta: {kind: "text" | "reasoning", text: string})`. adapter 셋은 글 delta를 `kind: "text"`로 넘긴다. `reasoning-core`는 같은 callback에 `kind: "reasoning"`을 넘기기만 하면 run-loop가 묶어 core로 보내고 core가 redaction해 `ModelOutputStreamed`로 낸다.
    - child → core 날 글 길: `AgentEventSink.output(batch: Omit<ModelOutputMessage, "type">)`(`run-loop/ports.ts`). child의 `createLiveOutput`이 묶어 부르고 `turn-source-link.ts`가 `model_output`으로 보낸다.
    - model 응답의 agent message를 저장하는 한 자리(run-loop). `reasoning-core`가 같은 자리에 reasoning part를 더한다.
    - core 메모리 `run-loop/live-turns.ts`의 `createLiveTurns`: agent runtime이 보낸 날 글을 session마다 쌓아 redaction해 `ModelOutputStreamed`를 내고, Bus의 agent event로 비우며, `writing`(text·reasoning 둘 다, redaction을 거친 글)을 든다. `main/daemon/wiring/session-snapshots.ts`가 만들어 늦은 칸 `ctx.liveTurns`로 내고 snapshot에 싣는다. `clock-core`가 같은 module에 `elapsed`를 더한다.
    - Bus에 실제로 흐르는 `ModelOutputStreamed`·`MessageRecorded`. `stream-shell`이 기댄다.

## 할 일

planner 검토(아래와 다르면 이것이 우선이다):
- **live 글의 redaction은 core가 한다**(README "정한 것"). child는 날 delta를 약 50ms씩 묶어 감독 pipe `model_output`으로 보내고, core `live-turns.ts`가 attempt마다 쌓인 날 글 전체를 `redactSettled`(`stream-redact`)로 가리고 secret이 시작됐을 수 있는 끝을 붙잡은 뒤 `ModelOutputStreamed`를 낸다. child는 live 글을 redaction하지 않는다. `LIVE_HOLD_CHARS`도, redact 응답의 `hold_from`도, child 쪽 `redactSettled`(`PreparerDeps`)도 두지 않는다. child가 redact pipe에 "이 끝이 secret의 앞부분인가"를 물을 수 있으면 글을 골라 secret 값을 한 글자씩 알아낼 수 있고, 상수로 붙잡으면 그보다 긴 token(OAuth, JWT)의 앞부분이 나간다.
- **마지막 응답(tool call이 없는 것)은 지금처럼 글이 비어도 저장한다.** 중간 응답은 글이 있거나 reasoning이 있었을 때만 저장한다. 그래야 run의 답(`wiring/runs.ts`, `architecture/run.md:62`)이 지금과 같다.
- **한 model 호출의 message는 하나만 저장된다.** message id를 그 `model_call`에서 정해, 멈춤 wrapper와 child가 같은 응답을 동시에 저장해도 둘째는 `conflict`로 끝난다(`message-commands.ts`의 같은 id 규칙). 보고의 "같은 순간 멈추면 두 번 저장" 미완 동작은 이것으로 닫는다.
- `TurnResumed`는 core가 낸다(`chat-protocol` 계약). 계약 바꾸기 요청 셋은 planner가 받았다: 붙잡기는 core(`stream-redact`의 `redactSettled`), `TurnResumed`는 core, delta를 내는 곳은 `invoke.ts`의 collector(`ModelCallInput.onDelta` 모양은 같다).

정한 것(살 단계):
- **멈춤의 길.** 지금 `StopTurn`은 core command다. 사람 자격으로 오면 `run-loop/commands.ts`의 `stop`이 같은 tx에서 turn 행을 interrupted(user_stopped)로 닫고, commit 뒤 `TurnEnded`를 본 `wiring/lophn-agent-runtime.ts`가 child에 `turn_stop`을 보낸다. child가 알 때 turn은 이미 끝나 `RecordMessage`가 거절한다. handler는 writer Worker에서 돌아 core 메모리를 읽지 못하고, 본문 blob은 command 앞에서 준비해야 한다(`message-body.ts`). 그래서 core의 writer 앞 처리기(`withLiveTurns`)가 `StopTurn` 앞에서 그 turn의 쓰는 중인 글을 machine 자격 `RecordMessage`로 저장하고 `MessageRecorded`를 낸 뒤 `StopTurn`을 넘긴다. 저장하는 글은 core가 들고 있는 `writing` 그대로, 곧 사람이 본 글이다. `ctx.writer`를 지나는 모든 `StopTurn`(shell, runs, workflows)이 같은 길이다. 저장이 실패해도 멈춤은 그대로 간다. `run-loop/commands.ts`와 `session/message-commands.ts`는 고치지 않는다.
- **날 글과 낸 글은 core의 `live-turns.ts` 하나가 든다.** 날 글을 받는 곳(`runtime.ts`의 감독 pipe, `lophn-agent-runtime` wiring)과 `writing`을 싣는 곳(`session-snapshots` wiring)이 다르다. wiring끼리 import하지 않으므로 `session-snapshots`가 만든 것을 늦은 칸 `ctx.liveTurns`(`context.ts`)로 내고 runtime wiring이 부를 때 읽는다. child는 `afterReady`에 뜨고 그때는 모든 build가 끝났다. 한 곳에 두어야 retry·저장·멈춤에서 날 글과 낸 글이 같이 비워진다.
- **child가 보내는 것은 앞 조각에 이어지는 날 글이고 offset이 없다.** 감독 pipe는 frame을 순서대로 쓰고 하나를 빼고 이어 쓰지 않는다(`frames.ts`). 다만 `childMessageSchema`에 어긋난 message는 그것만 거절되고 뒤는 간다(`child.ts` 271줄). 그래서 `MODEL_OUTPUT_UNITS_MAX`를 넘는 조각은 `turn-source-link.ts`가 순서대로 나눠 보낸다. 조각이 빠지면 core가 이은 글에서 secret이 갈려 지워지지 않는다.
- **delta는 `invoke.ts`의 collector가 낸다.** push 앞뒤로 adapter 결과의 `text` 길이를 비교해 늘어난 부분을 `onDelta`에 넘긴다. 세 adapter와 batch 길을 한 자리에서 덮고 adapter file은 고치지 않는다. 밖에서 보는 계약(`ModelCallInput.onDelta`)은 같다.
- **`TurnPorts.answer(text)`의 모양은 그대로 둔다.** 그 응답의 model call은 `core-ports.ts`가 이미 들고 있는 `lastModelCall`이다(답 저장의 멱등 key도 그것이다). 모양을 바꾸면 `TurnPorts`를 구현하는 `tests/support/loop/harness.ts`(소유 밖)를 고쳐야 한다. `turn.ts`는 완전한 응답마다 tool 묶음 앞에서 `answer`를 부르고 저장할지는 `core-ports.ts`가 정한다.
- **attempt가 끝나면 남은 글을 더 내지 않는다.** child는 아직 보내지 않은 묶음을 버리고(`stop`), core가 붙잡은 꼬리는 나가지 않는다. 저장된 message(`MessageRecorded`)가 live 글을 대신한다. 버리는 attempt(partial, 실패, 취소)는 꼬리가 아예 나가지 않는다.
- **core는 `ToolCallStarted`에서도 쓰는 중인 글(날 글과 낸 글)을 버린다.** 글이 있는 응답은 tool call보다 먼저 저장되어 `MessageRecorded`가 먼저 온다. 그래서 이때 남은 글은 버린 attempt의 것이다(retry한 attempt가 글 없이 tool만 낸 때). 저장했거나 다음 것으로 바뀐 `model_call`과 끝난 turn의 늦은 조각도 버린다.
- **다음 turn의 model 이력.** `session/history.ts`의 `readSessionConversation`은 앞 turn들이 가져간 message를 하나씩 읽고 이 turn의 message는 뺀다(`entry.turn !== requestTurn`). 이 turn 안의 이력은 loop의 `state.history`(attempt의 글)다. 그래서 응답마다 저장한 글은 다음 turn 이력에 한 번씩 들어가고 이 turn 안에서는 겹치지 않는다. 한 turn의 agent message 여럿은 `sessionMaterial`이 assistant message 하나의 text part 여럿으로 잇는다. Chat Completions 번역(`binding.ts`의 `chatMessages`)만 그 part를 `join("")`으로 붙여 글이 맞붙으므로 `"\n\n"`으로 잇는다.

1. `packages/core/lophn-agent/providers/work.ts` (근거: 계약 "adapter → run-loop delta callback", element `models`)
   - `export type ModelOutputDelta = { kind: "text" | "reasoning"; text: string }`.
   - `ModelCallInput`에 `onDelta?: (delta: ModelOutputDelta) => void`. 주석: 받은 글이 늘 때마다 늘어난 조각을 넘긴다. redaction 전 날 글이고 core가 화면에 내기 전에 가린다(`run-loop/live-turns.ts`). compactor(`session/compactor.ts`)는 넘기지 않는다.
2. `packages/core/lophn-agent/providers/invoke.ts` (근거: 위와 같다)
   - `collectorFor(protocol, onDelta?)`(101줄). 세 갈래의 `push`가 같은 작은 함수를 거친다: 결과의 `text.length`를 재고, `applyFrames`류를 부르고, 늘었으면 `onDelta?.({ kind: "text", text: out.text.slice(before) })`.
   - `invoke`의 `collectorFor(input.model.protocol)`(307줄)에 `input.onDelta`를 넘긴다. batch 성공 응답(`framesFromBatch`)도 같은 `push`라 한 번에 넘어간다.
3. `packages/core/lophn-agent/run-loop/live-turns.ts` (새 file. 근거: 계약 "core 메모리 `run-loop/live-turns.ts`", README "live 글의 redaction은 core가 한다", `event.md`)
   - 상수: `LIVE_BATCH_MS = 50`.
   - `createLiveOutput(deps: { session: Id<"ses">; turn: Id<"trn">; modelCall: Id<"mcl">; send: AgentEventSink["output"]; wait: LoopDeps["wait"] })`. child 쪽이고 model 호출(attempt) 하나의 묶음이다. `{ push(delta: ModelOutputDelta): void; stop(): void }`를 낸다.
     - `push`는 kind마다 아직 보내지 않은 날 글에 더하고, 걸린 보내기가 없으면 `wait(LIVE_BATCH_MS, signal)` 뒤 보내기를 건다. 시계와 timer는 인자로 받는다(AGENTS.md "코드").
     - 보내기는 kind마다(reasoning, text 순) 쌓인 조각이 있으면 `send({ session, turn, model_call, kind, text })`로 보내고 비운다. redaction하지 않는다.
     - `stop`은 걸린 wait를 끊고 보내지 않은 조각을 버린다. 닫힌 뒤의 `push`는 버린다.
   - `createLiveTurns(deps: { known(): KnownSecretMatch | undefined; publish(event: AgentEvent): void; clock: Clock })`. core 쪽이다. `{ output(batch: Omit<ModelOutputMessage, "type">): void; apply(event: BusEvent): void; writing(session: string): Writing | null; byTurn(turn: string): { session: string; writing: Writing } | null }`. `Writing`은 `NonNullable<SessionSnapshot["writing"]>`, `LiveTurns`는 `ReturnType<typeof createLiveTurns>`다. session마다 model 호출 하나의 날 글(kind마다)과 낸 글(`writing`)을 든다.
     - `output`: 저장했거나 다음 것으로 바뀐 `model_call`과 끝난 turn의 조각은 버린다(session마다 마지막 하나씩 기억한다). 그 session의 쓰는 중인 글이 없거나 `model_call`이 다르면 빈 글로 새로 시작한다(retry는 앞 날 글과 낸 글을 버린다). 그 kind의 날 글에 `text`를 잇고 쌓인 날 글 전체를 `redactSettled(raw, deps.known())`에 건다.
       - null이면 내지 않는다(fail-closed). 다음 조각에서 다시 전체를 건다.
       - 결과가 앞서 낸 글로 시작하지 않으면(앞서 낸 자리를 redaction이 바꿨다) 그 attempt의 그 kind는 더 내지 않는다.
       - 늘어난 부분이 있으면 `ModelOutputStreamed { turn, model_call, kind, offset: 앞서 낸 길이, text: 늘어난 부분 }`(envelope `session`, `at: deps.clock.now()`)을 `deps.publish`로 내고 낸 글을 결과로 바꾼다.
     - `apply`: `MessageRecorded`는 같은 `model_call`이면 비운다. `ToolCallStarted`·`TurnStarted`·`TurnEnded`는 비운다(위 정한 것). `ModelOutputStreamed`는 자기가 낸 것이라 받지 않는다.
   - `withLiveTurns(inner: Writer, deps: { live: LiveTurns; context: AuthenticatedContext; writer(): Writer; ids: IdSource; clock: Clock; publish(event: AgentEvent): void }): Writer`. core의 writer 앞 처리기다. `stopTurn.name`이 아닌 command는 그대로 `inner`로 간다.
     - `StopTurn`이면 `live.byTurn(input.turn)`을 본다. 있고 글(`text.trim()`)이나 reasoning이 있으면 `deps.writer().command(deps.context, { command: recordMessage.name, input: { id: ids.newId("msg"), session, turn, content: { schema_version: 1, parts } }, idempotency_key: ids.newId("idk"), compare: {}, prepared: [] })`. parts는 reasoning(비지 않으면 `{kind: "reasoning", text, duration_ms: null}`), 글(비지 않으면 `{kind: "text", text}`) 순이다. 이 task 동안 reasoning은 늘 비어 있다(adapter가 아직 내지 않는다). 그 뒤 reasoning이 오는 것은 `reasoning-core`가 machine 자격의 schema를 바꾼 뒤다.
     - 저장되면 `MessageRecorded { turn, message: <보낸 id>, model_call: writing.model_call }`을 `deps.publish`로 내고 `live.apply`에도 넘겨 비운다(Bus 구독으로 다시 와도 같은 결과다). 저장이 실패해도 `StopTurn`은 `inner`로 간다.
     - `deps.writer()`는 접힌 writer 전체(`ctx.writer`)라 `RecordMessage`가 본문 준비(`withMessageBody`)를 지난다(`event.md` "core 안에서 command를 내는 곳").
4. `packages/core/lophn-agent/run-loop/core-ports.ts` (근거: 계약 "model 응답의 agent message를 저장하는 한 자리", agent message 규칙)
   - `CorePortsDeps`에 `wait: LoopDeps["wait"]`.
   - `modelAttempt`: `lastModelCall = id`(251줄) 뒤에 `const live = createLiveOutput({ session: seat.session, turn: seat.turn, modelCall: id, send: (batch) => deps.events.output(batch), wait: deps.wait })`를 만들고 `model.invoke({ ..., onDelta: live.push })`(257줄)에 넘긴다. `invoke`가 돌아오면 바로 `live.stop()`이다(이 뒤로 그 attempt의 delta는 없다).
   - `answer(text)`(685줄): 글이 비면 저장하지 않는 것은 그대로다. `recordMessage`가 되면 `MessageRecorded { turn: seat.turn, message: recorded.value.message, model_call: lastModelCall }`을 `deps.events`로 낸다. `publish` 도우미의 type 이름 목록에 `"MessageRecorded"`를 더한다. 주석: 그 응답의 tool call보다 먼저 불리므로 `MessageRecorded`가 그 응답의 `ToolCallStarted`보다 먼저 간다.
5. `packages/core/lophn-agent/run-loop/ports.ts` (근거: agent message 규칙, 계약 "child → core 날 글 길")
   - `TurnPorts.answer`의 주석 "완전한 tool 없는 답을 남긴다(RecordMessage)"를 "완전한 model 응답 하나의 글을 그 응답의 agent message로 남긴다(RecordMessage). 비면 남기지 않는다. 그 응답의 tool call보다 먼저 부른다"로 고친다. 모양은 그대로다.
   - `AgentEventSink`(72줄)에 `output(batch: Omit<ModelOutputMessage, "type">): void`를 더한다. 주석: 쓰는 중인 model 글(날 글)을 감독 pipe로 core에 보낸다. core가 redaction해 `ModelOutputStreamed`로 낸다. 위 주석("agent event를 Bus로 보내는 길이다")도 맞게 고친다.
6. `packages/core/lophn-agent/run-loop/prepare.ts` (근거: AGENTS.md "시각, id, 무작위 값 … 인자로 받는다")
   - `createCorePorts({ ... })`(598줄)에 `wait: abortableWait`를 넘긴다(이미 import돼 있다).
7. `packages/core/lophn-agent/run-loop/turn.ts` (근거: README "model 응답 하나가 agent message 하나다", 계약 agent message 규칙)
   - `afterModel`(503줄) 맨 앞, tool call 유무를 가르기 전에 `const answered = await ports.answer(attempt.text)`. 실패하면 지금 `conclude`처럼 `failWith(state, "configuration_unavailable")`다. 사람이 먼저 멈춰 거절된 것이면 `finishWith`가 멈춤으로 끝낸다(지금 그대로).
   - `conclude`(567줄)에서 `deps.ports.answer` 호출과 그 실패 처리를 뺀다. 미반영 steering이 있으면 끝내지 않고 이력에 넣는 것은 그대로다. 이제 steering 때문에 다시 판단하는 응답의 글도 저장된다.
   - partial 응답(`runTurn` 479줄)은 저장하지 않는다(README "provider가 끊어 retry하는 attempt의 글은 버린다"). 지금 그대로다.
   - `afterModel`·`conclude` 위 주석과 머리 주석(46~48줄)의 순서 설명을 고친다: model call 하나 → 응답 저장 → tool 묶음.
8. `packages/core/main/daemon/wiring/session-snapshots.ts` (근거: 계약 "`main/daemon/wiring/session-snapshots.ts`가 만들어 늦은 칸 `ctx.liveTurns`로 내고 snapshot에 싣는다", `event.md`)
   - core 안 machine 자격 `LIVE_TURNS_CONTEXT`(principal `machine:live-turns`, actor `machine`, operations `[recordMessage.name]`)를 두고 `records: () => [LIVE_TURNS_CONTEXT]`로 기록한다(`lophn-agent-runtime.ts`의 `SESSION_INPUTS_CONTEXT`와 같은 꼴).
   - `build`에서 `const live = createLiveTurns({ known: () => ctx.peek.knownSecrets, publish: (event) => ctx.bus.publish(event), clock: ctx.clock })`, `ctx.provide("liveTurns", live)`, `ctx.bus.subscribe([{ types: ["MessageRecorded", "ToolCallStarted", "TurnStarted", "TurnEnded"] }], { send: (event) => live.apply(event), close() {} })`. 해제 함수는 `closeWork`에서 부른다.
   - `snapshotsOf`의 lophn 행에 `writing: live.writing(row.id)`. coding 행은 싣지 않는다.
   - `build` 결과에 `writer: (inner) => withLiveTurns(inner, { live, context: LIVE_TURNS_CONTEXT, writer: () => ctx.writer, ids: createIdSource({ clock: ctx.clock, random: ctx.random }), clock: ctx.clock, publish: (event) => ctx.bus.publish(event) })`. 이 wiring은 `lophnAgentSessionWiring`보다 바깥이고(assembly.ts), `ctx.writer`는 부를 때 읽는다.
9. `packages/core/lophn-agent/models/binding.ts` (근거: 위 정한 것 "다음 turn의 model 이력")
   - `chatMessages`의 assistant 글 `join("")`(326줄)을 `join("\n\n")`로 고친다. user 쪽(350줄)은 그대로다.
10. 감독 pipe 길 (근거: 계약 "child → core 날 글 길", `chat-protocol`의 `model_output`, interface `child-supervision-protocol`, 위 정한 것 "날 글과 낸 글은 … 하나가 든다", "offset이 없다")
    - `packages/core/main/agent-runtime/turn-source-link.ts`: `events`(98줄)에 `output(batch)`를 더한다. `{ type: "model_output", ...batch }`를 `options.send`로 보낸다(`publish`처럼 실패는 버린다). `batch.text`가 `MODEL_OUTPUT_UNITS_MAX`보다 길면 그 길이씩 잘라 순서대로 보낸다. 머리 주석에 `model_output`을 더한다.
    - `packages/core/lophn-agent/run-loop/turn-pipe.ts`: `createTurnPipe`의 options에 `output(batch: ModelOutputMessage): void`. `onMessage`가 `model_output`이면 `modelOutputMessageSchema`로 검사해 맞으면 `output`에 넘기고 `{ handled: true }`다. 머리 주석에 더한다: 날 글은 Bus에 싣지 않고 core의 `live-turns.ts`가 redaction한 뒤 낸다.
    - `packages/core/lophn-agent/run-loop/runtime.ts`: `AgentRuntimeDeps`(171줄)에 `output?: (batch: ModelOutputMessage) => void`와 주석(child가 보낸 쓰는 중인 model 날 글. 없으면 버린다), `createTurnPipe`(273줄)에 `output: deps.output ?? (() => {})`.
    - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`: `startAgentRuntimeChild({ ... })`(211줄)에 `output: (batch) => ctx.liveTurns.output(batch)`. 칸은 부를 때 읽는다.
    - `packages/core/main/daemon/wiring/context.ts`: `Late`(179줄)에 `liveTurns: LiveTurns`와 주석(session-snapshots가 낸다. agent runtime이 보낸 쓰는 중인 model 글을 받아 snapshot의 `writing`을 든다), `LATE_KEYS`(252줄)에 `liveTurns: true`.
11. 위험 test `packages/core/lophn-agent/run-loop/live-turns_test.ts` (근거: README "위험 test", `write-test`. 순수 함수와 가짜 writer만 쓰고 subprocess·timer가 없다)
    - "두 batch에 걸친 secret도 live delta에 나오지 않는다": `createLiveTurns`에 `createKnownSecretRegistry()`로 만든 matcher(`{ ready: true, match, prefixFrom }`, 300자가 넘는 값 L 하나), 낸 event를 모으는 `publish`, 가짜 clock을 준다. 같은 `model_call`로 `output`에 긴 앞글 + L 앞 절반, 그다음 L 나머지 절반 + 뒷글을 넣는다. 낸 `ModelOutputStreamed` text를 이은 글에 L의 어느 절반도 없고(L 자리는 `REDACTION_REPLACEMENT`다), 조각마다 `offset`이 앞 조각까지의 길이이며, `writing(session).text`가 이은 글과 같다. 진짜 `redactSettled`를 지나므로 상수로 붙잡지 않는 것도 같이 본다.
    - "retry된 attempt의 글은 쓰는 중인 글에 남지 않는다": `createLiveTurns`(값 없는 ready matcher)에 표로 넣는다. A의 `output` 뒤 B의 `output`이면 B의 글만 남는다. A의 `output` 뒤 글 없는 B의 `ToolCallStarted`(`apply`)면 비었다. B로 바뀐 뒤 늦게 온 A의 `output`은 버린다.
    - "멈추면 사람이 본 글이 turn이 끝나기 전에 agent message로 남는다": `createLiveTurns`에 A의 `output`(`"Hello wor"`)을 넣고 가짜 writer(받은 envelope을 적는다)로 `withLiveTurns`를 만든다. `StopTurn` envelope을 넣으면 `RecordMessage`(그 session·turn, parts `[{kind: "text", text: "Hello wor"}]`)가 `StopTurn`보다 앞에 적히고 `MessageRecorded`(model_call A)가 나가며 `writing`은 null이다. 순서는 index로 비교하고 목록 전체를 비교하지 않는다(`clock-core`가 같은 자리에 `CheckpointTurn`을 끼운다).
    - `message-commands_test.ts`는 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "두 batch에 걸친 secret도 live delta에 나오지 않는다", "retry된 attempt의 글은 쓰는 중인 글에 남지 않는다", "멈추면 사람이 본 글이 turn이 끝나기 전에 agent message로 남는다"(셋 다 `live-turns_test.ts`). `deno test --no-check packages/core/lophn-agent/run-loop/live-turns_test.ts`로 돌린다.
- 남지 않음:
  - `grep -n "ports.answer" packages/core/lophn-agent/run-loop/turn.ts`가 `afterModel` 안의 한 줄뿐이다. `grep -n "완전한 tool 없는 답" packages/core/lophn-agent/run-loop/ports.ts`가 0줄이다.
  - `grep -n "onDelta" packages/core/lophn-agent/providers/invoke.ts packages/core/lophn-agent/run-loop/core-ports.ts`가 각 file에 한 줄 이상이다.
  - `grep -n "model_output" packages/core/main/agent-runtime/turn-source-link.ts packages/core/lophn-agent/run-loop/turn-pipe.ts`가 각 file에 한 줄 이상이고 `grep -n "redactSettled" packages/core/lophn-agent/run-loop/live-turns.ts`가 한 줄 이상이다.
  - `grep -rn "LIVE_HOLD_CHARS" packages`가 0줄이다.
- loop harness(`tests/harness/loop`)가 그대로 통과한다(`TurnPorts` 모양을 바꾸지 않았다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없을 것이다(새 machine 자격은 이 wiring의 `records`가 기록하고, 늦은 칸 `liveTurns`는 이 task가 `context.ts`에 더한다). 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 이 task 뒤에도 남는 것:
  - batch마다 쌓인 날 글 전체를 core에서 redaction한다(계약). pipe로는 조각만 가지만, 아주 긴 답은 core의 redaction 비용이 글 길이의 제곱으로 는다. 재어 보고 느리면 보고한다.
  - 화면(`stream-shell`)도 `ToolCallStarted`에서 live 글을 버리고 저장한 `model_call`·끝난 turn의 늦은 delta를 버려야 같은 규칙이다.
