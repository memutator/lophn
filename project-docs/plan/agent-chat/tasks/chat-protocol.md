# chat-protocol

wave 2·3의 core·shell task가 기대는 계약을 한 번에 고정한다: 글·reasoning delta event와 그 날 글을 child가 core로 보내는 감독 pipe message, 답 저장 event, 다시 도는 event, `TurnEnded`의 active, session snapshot의 쓰는 중인 글과 도는 turn의 시간, tool call의 `{category, title}`, reasoning을 저장하는 message part. 새 칸이 빠진 event는 core(`run-loop/turn-pipe.ts`), shell main(`desktop/core/events.ts`), renderer(`connection/events/client.ts`)가 검사에서 버리므로, 바뀐 event를 내는 곳과 새 part를 읽지 못하는 renderer 한 곳을 같은 변경에서 맞춘다.

정한 것: delta event는 하나이고 `kind`로 글과 reasoning을 가른다. live 글의 redaction은 core가 한다(README "정한 것"): child는 날 글을 감독 pipe의 새 message `model_output`으로 보내고 `ModelOutputStreamed`는 core가 낸다. redact 응답(`redact_response`)은 바꾸지 않는다. reasoning은 message part로 저장한다. model 응답 하나가 agent message 하나다(지금 코드는 tool 없는 마지막 답만 저장하고 tool call과 같이 온 글은 이력에만 둔다). snapshot의 새 칸은 `harness`처럼 lophn session만 싣는 optional이다. display는 `ListToolCalls`에만 더하고 `ToolCallRead`와 command 출력의 `ToolCall`은 그대로 둔다. `ToolCallStarted`의 display는 새 file `tools/display.ts`의 함수로 만들어 `tool-title-core`가 run-loop를 고치지 않고 채운다. `FinishTurn`은 바꾸지 않는다. 모두 더하기라 옆에 남길 옛 모양이 없다.

- 단위: chat-protocol (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/events/agent.ts`
  - `packages/protocol/events/snapshot.ts`
  - `packages/protocol/lophn-agent/message-content.ts`
  - `packages/protocol/lophn-agent/messages.ts`
  - `packages/protocol/lophn-agent/tool-values.ts`
  - `packages/protocol/lophn-agent/tool-calls.ts`
  - `packages/protocol/supervision/supervision.ts`
  - `packages/core/lophn-agent/run-loop/turn-events.ts`
  - `packages/core/lophn-agent/run-loop/core-ports.ts`
  - `packages/core/lophn-agent/tools/display.ts` (새 file)
  - `packages/core/lophn-agent/tools/reads.ts`
  - `packages/core/lophn-agent/session/history.ts`
  - `packages/core/apps/coding/hook.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(agent event는 저장하지 않는다, 감독 pipe로 child가 내고 core가 Bus에 낸다, snapshot으로 맞춘다), `project-docs/architecture/approval.md`(shell `GateCall`, turn 안 request의 `subject`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 interface `event-stream`, `child-supervision-protocol`, `core-api`와 element `protocol`, `events`, `run-loop`, `agent-tools`, `agent-sessions`, `apps`, `shell`. `project-docs/module-catalog.yaml`의 `packages/protocol`(구현을 두지 않는다), `packages/core/lophn-agent`, `packages/core/apps`, `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것", `project-docs/products/roadmap/agent-chat.md` 4·5·6·7
  - skill: `.claude/skills/write-test/SKILL.md`
  - 코드:
    - protocol: `packages/protocol/events/agent.ts`, `packages/protocol/events/snapshot.ts`, `packages/protocol/events/bus.ts`, `packages/protocol/events/gateway.ts`, `packages/protocol/base/values.ts`(`durationMsSchema`, `atSchema`), `packages/protocol/base/ids.ts`(`mcl` 접두사가 이미 있다), `packages/protocol/lophn-agent/message-content.ts`, `packages/protocol/lophn-agent/messages.ts`, `packages/protocol/lophn-agent/tool-values.ts`, `packages/protocol/lophn-agent/tool-calls.ts`, `packages/protocol/supervision/supervision.ts`(`agentEventMessageSchema` 226줄, `redactRequestSchema`와 그 위 주석 231-238줄, `childMessageSchema` 390줄), `packages/protocol/base/frame.ts`(`CONTROL_MAX_BYTES`)
    - 감독 pipe: `packages/core/supervision/responsiveness/child.ts` 271줄(child가 보내는 message를 `childMessageSchema`로 검사한다), `packages/core/lophn-agent/run-loop/runtime.ts`(core가 child message를 가르는 `onMessage` 295줄)
    - core: `packages/core/lophn-agent/run-loop/turn-events.ts`, `packages/core/lophn-agent/run-loop/turn-pipe.ts`, `packages/core/lophn-agent/run-loop/commands.ts`(`publishTurnEnded`를 부르는 곳), `packages/core/lophn-agent/run-loop/interrupt.ts`, `packages/core/lophn-agent/run-loop/model.ts`(`TurnRow`), `packages/core/lophn-agent/run-loop/core-ports.ts`(`attemptTool`), `packages/core/lophn-agent/run-loop/blobs.ts`(`RedactText`), `packages/core/lophn-agent/tools/registry.ts`(`ToolDefinition`), `packages/core/lophn-agent/tools/reads.ts`, `packages/core/lophn-agent/session/message-body.ts`(`createMessageBodyPreparer`가 자격으로 schema를 고른다), `packages/core/apps/coding/hook.ts`
    - shell: `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`(`readBody`), `packages/shell/main/desktop/core/events.ts`, `packages/shell/renderer/desktop/connection/events/client.ts`
- 계약:
  - 쓰는 것: `packages/protocol/base/event.ts`의 이름 규칙(`<Entity><과거형 동사>` PascalCase)과 `defineAgentEvent`, 감독 pipe의 `agent_event`(`packages/protocol/supervision/supervision.ts`. child가 낸 event를 core가 `agentEventSchema`로 검사해 Bus에 낸다)와 `redact_request`(child가 날 글을 이미 core로 보낸다. 바꾸지 않는다), `messageContentSchema`, `toolCallOutputSchema`, `gateCallSchema`, `sessionSnapshotSchema`, turn 행의 `elapsed_active_ms`(`run-loop/schema.ts`), `durationMsSchema`·`atSchema`(`protocol/base/values.ts`).
  - 내놓는 것:
    - 새 agent event 셋(`packages/protocol/events/agent.ts`의 `agentEventSchema`에 더한다. 저장하지 않는다. coding agent는 내지 않는다):
      - `ModelOutputStreamed` `{turn: Id<"trn">, model_call: Id<"mcl">, kind: "text" | "reasoning", offset: number, text: string}`. model 호출(attempt) 하나에서 `kind`마다 이어지는 글 조각이다. `offset`은 같은 `model_call`·`kind`에서 앞서 낸 글의 길이(UTF-16 단위, 0 이상 정수)이고 `text`는 1자 이상이다. core가 낸다: agent runtime(child)이 날 delta를 짧게(약 50ms) 묶어 감독 pipe `model_output`(아래)으로 보내면, core가 그 attempt에서 쌓인 날 글 전체에 지금의 redaction(알려진 secret 값과 credential 규칙)을 걸고 앞서 낸 길이 뒤로 늘어난 부분만 낸다. offset도 redaction을 거친 글로 센다. 끝에서 secret이 시작됐을 수 있는 자리(`hold_from`, core 안의 `stream-redact` `redactSettled`)부터는 attempt가 끝날 때까지 붙잡는다. 그래서 두 batch에 걸친 secret도 live 글에 나오지 않는다. child는 live 글을 redaction하지 않는다. 다른 `model_call`의 조각이 오면 앞 model 호출의 쓰는 중인 글은 버린다(retry).
      - `MessageRecorded` `{turn: Id<"trn">, message: Id<"msg">, model_call: Id<"mcl">}`. agent runtime이 model 응답의 agent message를 `RecordMessage`로 저장한 뒤 낸다. 화면은 그 `model_call`의 쓰는 중인 글을 버리고 message 본문(`ReadMessageBody`)을 읽는다.
      - `TurnResumed` `{turn: Id<"trn">, active_ms: number}`. 사람 기다림(승인, 질문)이 끝나 turn이 다시 일하는 순간이다. envelope의 `at`이 그 순간이고 `active_ms`(`durationMsSchema`)는 그때까지 일한 시간(사람 기다림 제외)이다. core가 낸다: turn request와 질문 event를 접어 그 turn의 마지막 기다림이 닫힐 때다. child는 gate 판정마다 `paused()`가 돌아 진짜 기다림을 가르지 못한다(planner).
    - 감독 pipe의 새 child→core message `model_output`(`packages/protocol/supervision/supervision.ts`):
      - `modelOutputMessageSchema` `{type: "model_output", session: Id<"ses">, turn: Id<"trn">, model_call: Id<"mcl">, kind: "text" | "reasoning", text: string}`와 type `ModelOutputMessage`. `text`는 1자 이상, `MODEL_OUTPUT_UNITS_MAX`(32,768 UTF-16 단위) 이하다. `childMessageSchema`에 더한다. core는 답하지 않는다.
      - model 호출(attempt) 하나에서 `kind`마다 앞 message에 이어지는 날 글 조각(redaction 전)이다. agent event가 아니고 Bus에 싣지 않는다. core가 쌓아 redaction한 뒤 `ModelOutputStreamed`를 낸다.
      - 날 글을 core로 보내는 것은 새 노출이 아니다. child는 이미 `redact_request`로 날 글을 보낸다.
      - offset을 싣지 않는다. 감독 pipe는 frame을 순서대로 쓰고 하나를 빼고 이어 쓰지 않는다(`packages/core/supervision/responsiveness/frames.ts`). 다만 schema에 어긋난 message는 그것만 거절되므로(`child.ts` 271줄) 상한을 넘는 글은 child가 순서대로 나눠 보낸다. 상한은 `REDACT_UNITS_MAX`와 같은 값이고 JSON으로 써도 control frame(`CONTROL_MAX_BYTES` 256KiB)에 든다.
      - 보내는 쪽(child `main/agent-runtime/turn-source-link.ts`)과 받는 쪽(core `run-loop/turn-pipe.ts`)은 `stream-core`가 만든다.
    - 바뀌는 agent event:
      - `TurnEnded`에 `active_ms: number | null`. lophn agent는 turn 행의 `elapsed_active_ms`, coding agent는 null이다. `messages`는 그대로 둔다(빠진 message를 채우는 데 쓴다).
      - `ToolCallStarted`에 `display: ToolCallDisplay`.
    - session snapshot(`packages/protocol/events/snapshot.ts`). 둘 다 lophn session만 싣고(optional), 없으면 null이다:
      - `writing: {turn: Id<"trn">, model_call: Id<"mcl">, text: string, reasoning: string} | null`. 아직 저장되지 않은 model 호출 하나의 글(redaction을 거친 것)이다. `text.length`와 `reasoning.length`가 그 뒤 delta의 `offset`이다. offset이 맞지 않으면 화면은 snapshot을 다시 읽는다.
      - `elapsed: {turn: Id<"trn">, active_ms: number, at: string} | null`. 도는 turn이 `at` 시각까지 일한 시간이다. state가 `running`이면 화면은 `active_ms + (now − at)`을 보이고, 기다리는 동안은 세지 않는다.
    - tool 제목(`packages/protocol/lophn-agent/tool-values.ts`):
      - `TOOL_CALL_CATEGORIES = ["read", "list", "search", "command", "web", "other"]`와 type `ToolCallCategory`.
      - `toolCallDisplaySchema` `{category: ToolCallCategory, title: string}`와 type `ToolCallDisplay`. title은 1자 이상의 한 줄(줄바꿈 없음)이고 120자를 넘으면 잘라 `…`를 붙인다. 저장하지 않고 낼 때 만들며 지금의 redaction을 거친다.
      - `ListToolCalls`(`tool-calls.ts`) 출력 `tool_calls`의 item은 `ToolCall`에 `display: ToolCallDisplay`를 더한 것이다(type `ListedToolCall`).
      - `ListToolCalls` 입력에 선택 칸 `tool: string`(1자 이상)을 더한다. 주면 그 tool 이름의 call만 낸다. `session/history.ts`의 `readLoads`는 `tool: "tool.load"`로 읽는다. 이유: history는 turn마다 session의 tool call을 다 읽는데 쓰는 것은 `tool.load`뿐이다. 제목을 만들려고 입력 blob을 읽게 되면(`tool-title-core`) turn 시작마다 file·web·shell 입력을 다시 읽게 된다(planner).
    - shell 승인은 바꾸지 않는다. 카드 내용은 program이 GateCall에서 만들고 agent가 쓴 설명은 싣지 않는다(`project-docs/architecture/approval.md:51`). `shell.run`의 `description`은 tool 줄 제목에만 쓴다(planner).
    - reasoning 저장(`packages/protocol/lophn-agent/message-content.ts`):
      - message part `{kind: "reasoning", text: string, duration_ms: number | null}`를 part 입력·출력 schema에 더한다. `text`는 provider가 준 읽을 수 있는 reasoning(없으면 "")이고 다른 본문처럼 core가 저장 전에 redaction한다. `duration_ms`는 run-loop가 잰 그 reasoning의 첫 delta부터 마지막 delta까지다(모르면 null).
      - 자격마다 받는 part: 사람(`userMessageContentInputSchema`)은 글, agent 자격(`agentMessageContentInputSchema`, 예: `visual.show`)은 글·앱 카드, 새 `machineMessageContentInputSchema`(agent runtime의 답 저장)는 글·reasoning이다. `RecordMessage`(`messages.ts`) 입력의 `content`는 세 part를 다 받는 schema이고 owner(`session/message-body.ts`의 준비 단계)가 자격으로 고른다. 그 고르기를 machine에 맞추는 것은 `reasoning-core`다(그 전까지 machine은 지금처럼 글만 통과한다).
      - model 이력(`session/history.ts`)은 text part만 읽으므로 reasoning은 model로 가지 않는다.
    - agent message 규칙: model 응답 하나에 agent message 하나다. 글이나 reasoning이 있는 응답은 tool call과 같이 와도 저장한다. part 순서는 reasoning, text다. 그 응답의 tool call보다 먼저 저장해 `MessageRecorded`가 그 응답의 `ToolCallStarted`보다 먼저 온다. 한 turn에 agent message가 여럿일 수 있다.
    - `tool-title-core`가 채울 자리: 새 file `packages/core/lophn-agent/tools/display.ts`의 `toolCallDisplay(definition: ToolDefinition | undefined, name: string, input: unknown, redact: (text: string) => string | null | Promise<string | null>): Promise<ToolCallDisplay>`. title을 `redact`에 거친 값을 낸다. 못 만들거나 redaction을 끝내지 못하면 `{category: "other", title: name}`이다. 이 task에서는 늘 그 fallback이다. `run-loop/core-ports.ts`가 `ToolCallStarted`를 낼 때 `deps.redact`로 부르고, `tools/reads.ts`의 `ListToolCalls`는 같은 fallback(`other`, tool 이름)을 싣는다.
    - 같은 변경에서 맞추는 producer: `TurnEnded`는 `run-loop/turn-events.ts`(행의 `elapsed_active_ms`)와 `apps/coding/hook.ts`(null), renderer `agent-tab-core-source-thread.ts`의 `readBody`는 reasoning part를 건너뛴다(`reasoning-shell`이 그린다).
    - 바꾸지 않는 것: 감독 pipe의 `agent_event` 모양과 `redact_request`·`redact_response`(붙잡는 자리를 child에 답하지 않는다. 답하면 child가 글을 골라 거듭 물어 secret 값을 한 글자씩 알아낼 수 있다), `FinishTurn`(끝날 때 active는 child가 끝내기 직전 `CheckpointTurn`으로 마감한다), `ToolCallRead`, `TurnStarted`.

## 할 일

정한 것(살 단계):
- `ToolCallDisplay.title`의 schema는 1자 이상만 본다. 한 줄, 120자에서 자르고 `…`를 붙이는 것은 만드는 쪽(`tools/display.ts`, `tool-title-core`)의 규칙이고 schema에 넣지 않는다. 이유: 감독 pipe(`turn-pipe.ts`)는 검사에 어긋난 event를 조용히 버리고, shell main의 contract client는 `ListToolCalls` 출력에서 제목 하나만 어긋나도 목록 전체를 거절한다. 세는 단위(UTF-16과 글자)가 어긋나는 일로 tool 줄을 통째로 잃지 않게 한다.
- `machineMessageContentInputSchema`는 byte 상한을 schema에서 보지 않는다. `agentMessageContentInputSchema`처럼 owner(`session/message-body.ts`)가 준비 전에 본다. machine 상한을 지금 64KiB(`MESSAGE_TEXT_CONTENT_MAX_BYTES`)에서 바꿀지는 그 고르기를 맡은 `reasoning-core`가 정한다.
- `RecordMessage` 입력의 세 part를 받는 schema는 이미 있는 `messageContentInputSchema`를 export해 쓴다. 새 이름을 만들지 않는다.
- `ListedToolCall`은 `tool-values.ts`의 `toolCallOutputSchema` 옆에 둔다. 같은 field 묶음과 `callShape` refine을 같이 쓰기 때문이다.

1. `packages/protocol/lophn-agent/tool-values.ts` (근거: 계약 "tool 제목", interface `core-api`)
   - `TOOL_CALL_CATEGORIES = ["read", "list", "search", "command", "web", "other"] as const`, `toolCallDisplaySchema = z.object({ category: z.enum(TOOL_CALL_CATEGORIES), title: z.string().min(1) })`, type `ToolCallCategory`, `ToolCallDisplay`를 export한다. 주석은 "저장하지 않고 낼 때 만들며 지금의 redaction을 거친다"는 이유 한 줄과, 한 줄·120자에서 잘라 `…`를 붙이는 것은 만드는 쪽이 지킨다는 것을 적는다.
   - `toolCallOutputSchema`(184줄)의 field(`...toolCallFields`와 그 아래 output override 넷: `app_tool`, `extension`, `decision`, `outcome`)를 `const toolCallOutputFields`로 뺀다. `toolCallOutputSchema = z.object(toolCallOutputFields).refine(callShape, …)`는 그대로의 뜻이다.
   - `listedToolCallOutputSchema = z.object({ ...toolCallOutputFields, display: toolCallDisplaySchema }).refine(callShape, …)`(같은 message)와 type `ListedToolCall`을 export한다. zod 4의 `.extend()`는 refine이 걸린 object에서 던지므로 쓰지 않는다.
2. `packages/protocol/lophn-agent/tool-calls.ts` (근거: 계약 "`ListToolCalls` 출력 item")
   - `toolCallListOutputSchema`(249줄)의 `tool_calls`를 `z.array(listedToolCallOutputSchema)`로 바꾸고 import한다.
   - `toolCallReadOutputSchema`(`ReadToolCall`)는 `ToolCall` 그대로 둔다. 같은 file의 기록 event `toolCallStarted = defineEvent("ToolCallStarted", …)`(280줄, ledger)는 agent event와 다른 것이라 건드리지 않는다.
3. shell 승인(`packages/protocol/approvals/gate-call.ts`)은 고치지 않는다(계약 "shell 승인은 바꾸지 않는다").
4. `packages/protocol/lophn-agent/message-content.ts` (근거: 계약 "reasoning 저장", element `agent-sessions`)
   - `durationMsSchema`를 `../base/values.ts`에서 import한다.
   - reasoning part `{ kind: z.literal("reasoning"), text: z.string(), duration_ms: durationMsSchema.nullable() }`를 `messagePartInputSchema`(26줄, `z.strictObject`)와 `messagePartSchema`(30줄, `z.object`)에 더한다. 그래서 `messageContentSchema`(`ReadMessageBody` 출력)가 reasoning을 읽는다.
   - `messageContentInputSchema`(53줄)를 export한다. 세 part(글, 앱 카드, reasoning)를 다 받는다.
   - `agentMessageContentInputSchema`(75줄, 지금은 `messageContentInputSchema`와 같다)를 따로 만든다: `z.strictObject({ schema_version: z.literal(1), parts: z.array(<글 | 앱 카드 discriminated union>).min(1) })`. agent 자격이 reasoning part를 내지 못하게 한다. 받는 것은 지금과 같다.
   - `machineMessageContentInputSchema`를 새로 export한다: 같은 꼴이고 parts는 글 | reasoning이다. byte refine은 두지 않는다(위 정한 것).
   - 파일 머리 주석의 상한 설명("사람 말과 machine 확인은 글뿐이라 64KiB(스키마가 검사)")을 고친 뒤에도 맞게 고친다: 사람 말은 schema가 64KiB를 보고, agent·machine 본문은 owner가 준비 전에 본다. `agentMessageContentInputSchema` 위 주석("글, 시각 블록, 앱 카드")도 지금 받는 것(글, 앱 카드)으로 고친다.
5. `packages/protocol/lophn-agent/messages.ts` (근거: 계약 "`RecordMessage`(`messages.ts`) 입력의 `content`는 세 part를 다 받는 schema")
   - `recordMessageInputSchema`(121줄)의 `content`를 `messageContentInputSchema`로 바꾼다. 쓰지 않게 된 `agentMessageContentInputSchema` import를 뺀다.
   - 그 위 주석 "agent는 글·시각 블록, machine은 글만 낸다(owner가 actor로 검사한다)"를 "agent는 글·앱 카드, machine은 글·reasoning을 낸다(owner가 자격으로 고른다)"로 고친다.
   - `session/message-body.ts`는 고치지 않는다. agent는 `agentMessageContentInputSchema`(받는 것이 지금과 같다), 사람과 machine은 `userMessageContentInputSchema`(글만)를 그대로 고르므로 machine이 reasoning을 내면 이 task 뒤에도 `invalid_input`이다. machine을 새 schema로 바꾸는 것은 `reasoning-core`다.
6. `packages/protocol/events/agent.ts` (근거: 계약 "새 agent event 셋", "바뀌는 agent event", `event.md`)
   - import: `durationMsSchema`(`../base/values.ts`), `toolCallDisplaySchema`(`../lophn-agent/tool-values.ts`).
   - `const modelCall = idSchema("mcl")`를 `turn`·`toolCall` 옆에 둔다.
   - `modelOutputStreamed = defineAgentEvent("ModelOutputStreamed", z.strictObject({ turn, model_call: modelCall, kind: z.enum(["text", "reasoning"]), offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), text: z.string().min(1) }))`. 주석에 core가 낸다는 것, offset의 뜻(같은 `model_call`·`kind`에서 앞서 낸 글의 UTF-16 길이, redaction을 거친 글로 센다)과 다른 `model_call`의 조각이 오면 앞 것을 버린다는 것을 적는다. redaction을 쌓인 글 전체에 걸고 끝을 붙잡는 규칙은 계약 글이고 내는 쪽(core, `stream-core`)이 지킨다.
   - `messageRecorded = defineAgentEvent("MessageRecorded", z.strictObject({ turn, message: idSchema("msg"), model_call: modelCall }))`.
   - `turnResumed = defineAgentEvent("TurnResumed", z.strictObject({ turn, active_ms: durationMsSchema }))`. 주석: envelope의 `at`이 다시 일하는 순간이고 `active_ms`는 그때까지 사람 기다림을 뺀 시간이다.
   - `turnEnded`(80줄) payload에 `active_ms: durationMsSchema.nullable()`. 주석: coding agent는 null(harness가 사람 기다림을 알리지 않아 일한 시간을 모른다).
   - `toolCallStarted`(91줄) payload에 `display: toolCallDisplaySchema`.
   - 셋을 `agentEventSchema`(149줄) 목록에 더한다(`TurnResumed`는 `TurnStarted`·`TurnEnded` 곁, 둘은 `ToolCallEnded` 앞 등 읽기 좋은 자리).
   - 머리 주석(13~17줄)을 고친다: coding agent가 내는 목록은 그대로, lophn agent의 `MessageRecorded`는 agent runtime이 감독 pipe로 내고 core가 Bus에 낸다. `ModelOutputStreamed`(agent runtime이 보낸 날 글을 core가 redaction한 것)와 `TurnResumed`는 core가 낸다. "subagent와 model 호출은 event로 두지 않는다"는 "model 호출의 시작·끝은 event로 두지 않는다(쓰는 중인 글만 흐른다)"로 고친다.
7. `packages/protocol/events/snapshot.ts` (근거: 계약 "session snapshot", `event.md` "snapshot으로 맞춘다")
   - `sessionSnapshotSchema`에 둘을 더한다. `harness`처럼 `.optional()`이고 값은 `.nullable()`이다.
     - `writing: z.object({ turn: idSchema("trn"), model_call: idSchema("mcl"), text: z.string(), reasoning: z.string() }).nullable().optional()`. 주석: lophn session만 싣는다. 아직 저장되지 않은 model 호출 하나의 글(redaction을 거친 것)이고 `text`·`reasoning`의 길이가 그 뒤 delta의 offset이다.
     - `elapsed: z.object({ turn: idSchema("trn"), active_ms: durationMsSchema, at: atSchema }).nullable().optional()`. 주석: lophn session만 싣는다. 도는 turn이 `at`까지 일한 시간이고 `running`이면 화면이 `active_ms + (now − at)`을 보인다.
   - snapshot을 만드는 `packages/core/main/daemon/wiring/session-snapshots.ts`는 고치지 않는다(칸이 optional이고 `stream-core`·`clock-core`가 채운다).
8. `packages/core/lophn-agent/run-loop/turn-events.ts` (근거: 계약 "`TurnEnded`에 `active_ms`", element `run-loop`)
   - `publishTurnEnded` payload에 `active_ms`를 싣는다. 값은 같은 tx에서 `select elapsed_active_ms from turns where id = ?`로 읽는다(`messagesOf`와 같은 모양, 행이 없으면 null). 부르는 쪽(`commands.ts`의 finish·stop, `interrupt.ts`)은 고치지 않는다. 인자의 row를 쓰지 않고 다시 읽는 이유를 주석 한 줄로 적는다: "끝내는 handler가 같은 tx에서 active를 마감한 뒤의 값을 싣는다." 그 마감은 `clock-core`가 더한다.
9. `packages/core/apps/coding/hook.ts` (근거: 계약 "coding agent는 null", element `apps`)
   - `case "TurnEnded"`(114줄)의 payload에 `active_ms: null`. `emit`의 payload는 `unknown`이라 type check가 빠뜨림을 잡지 않는다. 빠지면 shell main이 그 event를 버려 coding session의 turn 끝이 화면에 오지 않는다.
10. `packages/core/lophn-agent/tools/display.ts` (새 file. 근거: 계약 "`tool-title-core`가 채울 자리", element `agent-tools`)
    - `export function toolCallDisplay(definition: ToolDefinition | undefined, name: string, input: unknown, redact: (text: string) => string | null | Promise<string | null>): Promise<ToolCallDisplay>`. 이 task에서는 늘 `Promise.resolve({ category: "other", title: name })`다. `async`로 쓰면 lint `require-await`가 막으니 `Promise.resolve`로 쓴다. 쓰지 않는 인자는 `_` 접두사(lint `no-unused-vars`)다.
    - `ToolDefinition`은 `./registry.ts`, `ToolCallDisplay`는 `../../../protocol/lophn-agent/mod.ts`에서 import한다. `RedactText`(`run-loop/blobs.ts`)는 import하지 않고 같은 모양을 인자 type으로 쓴다(tools가 run-loop를 import하지 않게).
    - 주석: 못 만들거나 redaction을 끝내지 못하면 tool 이름을 `other`로 낸다. 제목은 저장하지 않는다.
    - `tools/mod.ts`에 export하지 않는다(소유 밖. 부르는 쪽이 `../tools/display.ts`를 바로 import한다).
11. `packages/core/lophn-agent/run-loop/core-ports.ts` (근거: 계약 "`run-loop/core-ports.ts`가 `ToolCallStarted`를 낼 때 `deps.redact`로 부르고")
    - `attemptTool`의 `publish("ToolCallStarted", …)`(458줄) 앞에서 `const display = await toolCallDisplay(definition, definition?.name ?? call.name, call.input, deps.redact)`를 부르고 payload에 `display`를 싣는다. `toolCallDisplay`는 `../tools/display.ts`에서 import한다.
12. `packages/core/lophn-agent/tools/reads.ts` (근거: 계약 "`ListToolCalls`는 같은 fallback(`other`, tool 이름)을 싣는다")
    - `toCalls`(40줄)가 `ListedToolCall[]`을 내게 한다: `callFromRow`의 값에 `display: { category: "other", title: call.tool }`를 더한다. list handler는 동기 pool read라 `toolCallDisplay`(Promise)를 부르지 않는다. `read`(`ReadToolCall`) handler는 그대로다.
13. `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` (근거: 계약 "renderer `readBody`는 reasoning part를 건너뛴다")
    - `readBody`(72줄)의 `parts.map(… switch …)`을 `flatMap((part): BodyPart[] => …)`으로 바꾸고 `case "reasoning"`은 `[]`이다. `BodyPart`(`agent-tab-source.ts`)는 고치지 않는다. 주석에 task 이름을 쓰지 않는다.
14. `ListToolCalls`의 `tool` filter (근거: 계약 "`ListToolCalls` 입력에 선택 칸 `tool`")
   - `packages/protocol/lophn-agent/tool-calls.ts`의 `toolCallListInputSchema`에 `tool: z.string().min(1).optional()`을 더한다.
   - `packages/core/lophn-agent/tools/reads.ts`의 `list`가 `tool`이 있으면 `tool = ?`로 거른다.
   - `packages/core/lophn-agent/session/history.ts`의 `readLoads`가 `tool: "tool.load"`를 실어 읽는다. 안의 `call.tool !== "tool.load"` 거르기는 남겨도 되고 지워도 된다(지운다).
15. `packages/protocol/supervision/supervision.ts` (근거: 계약 "감독 pipe의 새 child→core message `model_output`", interface `child-supervision-protocol`, README "live 글의 redaction은 core가 한다")
   - `agentEventMessageSchema`(226줄) 아래에 `MODEL_OUTPUT_UNITS_MAX = 32_768`, `modelOutputMessageSchema = z.strictObject({ type: z.literal("model_output"), session: idSchema("ses"), turn: idSchema("trn"), model_call: idSchema("mcl"), kind: z.enum(["text", "reasoning"]), text: z.string().min(1).max(MODEL_OUTPUT_UNITS_MAX) })`, type `ModelOutputMessage`를 export한다.
   - 주석: agent runtime이 model 호출 하나에서 받은 글을 짧게 묶어 core에 보내는 날 글(redaction 전)이다. 앞 message에 이어지는 조각이고 pipe는 순서대로 간다. core가 쌓인 글 전체를 redaction해 `ModelOutputStreamed`로 낸다. 날 글은 `redact_request`로도 이미 core에 간다. 상한을 넘는 글은 child가 나눠 보낸다(넘는 message 하나만 거절되면 글 가운데가 빈다).
   - `childMessageSchema`(390줄)에 더한다. `parentMessageSchema`는 그대로다.
   - `redactRequestSchema`·`redactResponseSchema`와 그 위 주석은 바꾸지 않는다.
   - 이 task 뒤에는 `model_output`을 보내는 곳이 없다. core에 와도 `runtime.ts`의 `onMessage` 마지막 갈래(credential link)가 버린다. 보내고 받는 것은 `stream-core`다.
16. 고치지 않는 것을 확인한다(같은 변경에서 맞출 곳이 없다):
    - shell main `packages/shell/main/desktop/core/events.ts`는 `gatewayServerFrameSchema`(→ `busEventSchema` → `agentEventSchema`)를, renderer `packages/shell/renderer/desktop/connection/events/client.ts`는 `busEventSchema`를 protocol에서 import만 한다. core `run-loop/turn-pipe.ts`도 `agentEventSchema`를 import한다. 모두 새 schema를 그대로 쓴다.
    - `packages/protocol/{events,lophn-agent,approvals,supervision}/mod.ts`는 `export *`라 새 export가 저절로 나간다. 새로 export하는 이름(`TOOL_CALL_CATEGORIES`, `ToolCallCategory`, `toolCallDisplaySchema`, `ToolCallDisplay`, `listedToolCallOutputSchema`, `ListedToolCall`, `messageContentInputSchema`, `machineMessageContentInputSchema`, `MODEL_OUTPUT_UNITS_MAX`, `modelOutputMessageSchema`, `ModelOutputMessage`)은 protocol의 다른 file과 겹치지 않는다(지금 0건).
    - 메시지 본문을 읽는 core 쪽(`session/history.ts`, `main/daemon/wiring/runs.ts`, `main/daemon/wiring/router.ts`, `session/message-commands.ts`)과 renderer `agent-tab-core-source-commands.ts`, `agent-view-model.ts`는 `kind === "text"`만 골라 reasoning이 model 이력이나 복사 글로 가지 않는다.
    - `ToolCallStarted` agent event를 내는 곳은 `core-ports.ts` 한 곳, `TurnEnded`는 `turn-events.ts`와 `apps/coding/hook.ts` 두 곳이다(`grep -rn '"TurnEnded"\|"ToolCallStarted"' packages/core`).

## 끝남

- `deno task check`가 통과한다.
- renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음. 모양만 정하는 task다. zod가 보장하는 것은 test하지 않는다(`write-test`). live delta와 reasoning·tool 제목의 redaction test는 그것을 만드는 `stream-redact`·`stream-core`, `reasoning-core`, `tool-title-core`가 쓴다.
- 남지 않음: 지우는 이름이 없다. 맞춘 producer는 `grep -n "active_ms" packages/core/lophn-agent/run-loop/turn-events.ts packages/core/apps/coding/hook.ts`와 `grep -n "display" packages/core/lophn-agent/run-loop/core-ports.ts packages/core/lophn-agent/tools/reads.ts`가 각 file에 한 줄 이상이다. `grep -n "model_output" packages/protocol/supervision/supervision.ts`가 한 줄 이상이고, 그 file의 diff에서 `redactRequestSchema`·`redactResponseSchema`와 그 위 주석은 그대로다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없을 것이다(protocol `mod.ts`는 `export *`). 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 이 task 뒤에도 남는 것: machine 자격이 reasoning part를 내면 `invalid_input`(→ `reasoning-core`), `ToolCallStarted`·`ListToolCalls`의 제목은 늘 tool 이름(→ `tool-title-core`), `TurnEnded.active_ms`는 마지막 checkpoint 값(→ `clock-core`), snapshot `writing`·`elapsed`는 늘 빠진다(→ `stream-core`, `clock-core`), 감독 pipe `model_output`은 보내는 곳도 받는 곳도 없다(→ `stream-core`).
