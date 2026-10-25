# reasoning-core

adapter가 읽을 수 있는 reasoning 글(Anthropic `thinking_delta`, OpenAI Responses `reasoning_summary_text.delta`, Chat Completions `reasoning_content`)을 opaque 상태와 따로 모아 delta 길로 흘리고, 응답의 agent message에 redaction을 거친 reasoning part(글과 잰 시간)로 저장한다. OpenAI Responses는 요청에 `reasoning.summary`를 싣는다. reasoning 글은 model 이력으로 가지 않는다.

- 단위: reasoning (wave 2)
- 선행: stream-core. adapter 셋과 run-loop의 같은 file을 고치고 그 delta 길을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/providers/adapters/{messages,responses,chat-completions}.ts`
  - `packages/core/lophn-agent/providers/invoke.ts`
  - `packages/core/lophn-agent/providers/work.ts`
  - `packages/core/lophn-agent/models/binding.ts`
  - `packages/core/lophn-agent/models/wire.ts`
  - `packages/core/lophn-agent/run-loop/{core-ports,turn,ports}.ts`
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/session/message-body.ts`
  - `packages/core/lophn-agent/session/message-body_test.ts` (새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(agent event는 저장하지 않는다, 정본은 session 기록)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 element `models`, `run-loop`, `agent-sessions`와 interface `core-api`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것"의 reasoning 절, `project-docs/products/roadmap/agent-chat.md` 5("provider가 읽을 글을 주지 않으면 "Thought"만 보인다")
  - 계약: `project-docs/plan/agent-chat/tasks/chat-protocol.md` "reasoning 저장", `project-docs/plan/agent-chat/tasks/stream-core.md`("정한 것(살 단계)"와 할 일 1~4: `onDelta`, collector의 delta, `createLiveOutput`, `answer`)
  - skill: `.claude/skills/write-test/SKILL.md`
  - 코드:
    - adapter: `packages/core/lophn-agent/providers/adapters/messages.ts`(머리 주석 11~13줄 opaque 상태, `StreamResult` 173줄, `content_block_start` 258줄, `thinking_delta`를 버리는 289줄), `packages/core/lophn-agent/providers/adapters/responses.ts`(`ResponsesStreamResult` 142줄, `collectReasoning` 173줄은 `encrypted_content`만 모은다, 무시 목록 271~283줄의 `startsWith("reasoning_summary")`는 실제 event 이름 `response.reasoning_summary_*`와 맞지 않는다), `packages/core/lophn-agent/providers/adapters/chat-completions.ts`(머리 주석 4줄, `applyChoice` 229줄. 요청 쪽 `applyPadding`의 DeepSeek `reasoning_content` 채움은 그대로 둔다), `packages/core/lophn-agent/providers/adapters/batch.ts`(batch 응답은 thinking을 버린다. 소유 밖)
    - 호출: `packages/core/lophn-agent/providers/invoke.ts`(`collectorFor`, `Collected`, `done`, `extra`), `packages/core/lophn-agent/providers/work.ts`(`ModelCallOutput`)
    - 요청: `packages/core/lophn-agent/models/wire.ts`(`messagesEffort` 51줄, `responsesEffort` 87줄, `chatEffort` 98줄, `translateOptions`), `packages/core/lophn-agent/models/binding.ts`(packer 셋. 이 task는 고치지 않는다), `packages/core/lophn-agent/models/user-info_test.ts`(effort가 요청으로 가는 test)
    - 저장: `packages/core/lophn-agent/run-loop/core-ports.ts`(`modelAttempt`, `answer`. `stream-core`가 고친 뒤), `packages/core/lophn-agent/session/message-body.ts`(`createMessageBodyPreparer` 149~155줄이 자격으로 schema와 상한을 고른다), `packages/protocol/lophn-agent/message-content.ts`(`machineMessageContentInputSchema`, `MESSAGE_CONTENT_MAX_BYTES`), `packages/base/redaction/product-redactor.ts`(`createProductRedactor`), `packages/core/storage/blobs/prepare-relay.ts`(`PreparedRelayResult`)
    - 이력: `packages/core/lophn-agent/session/history.ts`(text part만 읽는다), `run-loop/turn.ts`의 `afterModel`(이 turn 이력은 `attempt.text`만 쓴다)
    - 소유 밖에서 `ModelAttempt`·`TurnPorts`를 만드는 곳: `tests/support/loop/model.ts`, `tests/support/loop/harness.ts`
- 계약:
  - 쓰는 것: `chat-protocol`의 reasoning part(`{kind: "reasoning", text, duration_ms}`)와 `machineMessageContentInputSchema`, `ModelOutputStreamed`의 `kind: "reasoning"`(core가 redaction해 낸다); `stream-core`의 `onDelta` callback, 응답 저장 자리, `live-turns.ts`의 `writing.reasoning`; 본문 준비 단계의 redaction(`session/message-body.ts`의 `createMessageBodyPreparer`).
  - 내놓는 것: 저장된 agent message의 reasoning part(`text`는 redaction을 거친 요약이고 읽을 글이 없으면 "", `duration_ms`는 첫 delta~마지막 delta)와 Bus의 reasoning delta. `reasoning-shell`이 기댄다. opaque 상태와 model 이력은 지금 그대로다.

## 할 일

planner 검토(아래와 다르면 이것이 우선이다):
- **시간은 reasoning block의 시작과 끝으로 잰다.** Anthropic은 `thinking`·`redacted_thinking` block의 `content_block_start`~`content_block_stop`, Responses는 `reasoning` item의 `response.output_item.added`~`.done`, Chat Completions는 첫~마지막 `reasoning_content` delta다. 읽을 글이 없이 암호화만 와도 "Thought for {d}"가 된다(roadmap 5). 글 delta로만 재면 그때 시간을 잃는다.
- reasoning이 있었으면(`""` 포함) part를 저장한다. 읽을 글이 없으면 화면은 펼치기 없이 시간만 보인다.

정한 것(살 단계):
- **reasoning은 `ModelAttempt`·`TurnPorts`에 싣지 않는다.** `core-ports.ts`가 직전 model 호출의 reasoning(글과 잰 시간)을 `lastModelCall` 곁에 들고 `answer`가 저장할 때 쓴다. `stream-core` 뒤로 `turn.ts`는 완전한 응답마다 `answer`를 부르므로 reasoning만 있는 응답도 이 자리에서 저장된다. `ModelAttempt`·`TurnPorts`를 바꾸면 그것을 만드는 `tests/support/loop/{model,harness}.ts`(소유 밖)를 고쳐야 한다. 그래서 `run-loop/turn.ts`, `run-loop/ports.ts`, `session/message-commands.ts`, `models/binding.ts`는 고치지 않는다.
- **reasoning이 있었는지와 읽을 글을 가른다.** adapter 결과와 `ModelCallOutput`의 `reasoning: string | null`이다. null은 reasoning이 없었다. ""는 reasoning은 있었는데 읽을 글이 없다(Anthropic `thinking` block의 글이 비었거나 `redacted_thinking`, Responses의 요약 없는 `reasoning` item). ""여도 reasoning part `{text: "", duration_ms}`를 저장한다(roadmap 5 "Thought"만 보인다).
- **시간은 읽을 글 delta로만 잰다.** `duration_ms`는 그 응답에서 첫 reasoning delta부터 마지막 reasoning delta까지(`core-ports.ts`가 `clock.nowMs()`로 잰다)이고 delta가 없으면 null이다(계약 "모르면 null"). 읽을 글 없이 암호화만 오면 시간도 null이다. roadmap 5는 그때도 시간을 잰다고 했지만 잴 delta가 없다(보고).
- **요약을 받는 요청은 effort 축이 있는 model에만 싣는다**(`models/wire.ts`의 effort 표).
  - Anthropic adaptive(`{type: "adaptive"}`)에 `display: "summarized"`를 더한다. 지금 Claude model(Opus 4.7 이후, Sonnet 5 이후, Haiku 5.5 등)은 기본이 `"omitted"`라 thinking 글이 빈 채로 온다. budget 쪽(`{type: "enabled", budget_tokens}`)은 그대로 둔다. 그 축을 쓰는 옛 model은 기본이 요약이다.
  - OpenAI Responses는 `off`(→ `"none"`) 밖의 effort 값에 `summary: "auto"`를 더한다(README "OpenAI Responses는 `reasoning.summary`를 요청한다").
  - Chat Completions(DeepSeek)는 요청 없이 `reasoning_content`가 온다. 고치지 않는다.
  - effort 축이 없는 model은 지금처럼 thinking 칸을 보내지 않는다. 받지 않는 model이 요청을 거절할 수 있다.
- **machine 본문 상한은 agent와 같은 `MESSAGE_CONTENT_MAX_BYTES`(240KiB)다.** 답 글에 reasoning이 붙으면 지금 상한 64KiB(`MESSAGE_TEXT_CONTENT_MAX_BYTES`)를 넘기 쉽고, 넘으면 `RecordMessage`가 거절해 turn이 실패한다(`turn.ts`의 `afterModel`). RPC 상한 256KiB 안이다(`message-content.ts` 머리 주석).
- **thinking block 여럿, 요약 part 여럿은 `"\n\n"`으로 잇는다.** 새 block·part의 첫 글이 올 때 앞에 쌓인 글이 있으면 붙인다. 빈 block은 아무것도 더하지 않는다.
- adapter와 요청 모양은 test하지 않는다(`write-test`: 내부 구현). 실제 provider로 확인하는 것은 사람에게 묻는다(README "사람에게 묻는 것"). 아래 frame으로 scratch에서 `applyFrames`류를 돌려 보고 commit하지 않는다.

1. `packages/core/lophn-agent/providers/adapters/messages.ts` (근거: README "adapter가 읽을 수 있는 reasoning 글을 opaque 상태와 따로 모은다", element `models`)
   - `StreamResult`(173줄)에 `reasoning: string | null`과 마지막으로 글을 더한 thinking block index를 둔다. `createStreamResult`는 `reasoning: null`이다.
   - `content_block_start`(258줄): `content_block.type`이 `"thinking"`이나 `"redacted_thinking"`이면 `out.reasoning ??= ""`.
   - `content_block_delta`: `delta.type === "thinking_delta" && typeof delta.thinking === "string"`이면 `out.reasoning`에 더한다(위 정한 것대로 block이 바뀌면 `"\n\n"`). `signature_delta`는 지금처럼 버린다.
   - 289줄 주석("thinking_delta는 사람이 읽을 본문이다. 제외한다.")을 지운다. 머리 주석(11~13줄)은 opaque 상태(signature·data)에 사람이 읽을 본문을 두지 않는다는 뜻을 지키고, 읽을 글은 결과의 `reasoning`으로 따로 간다는 것을 한 줄 더한다.
2. `packages/core/lophn-agent/providers/adapters/responses.ts` (근거: 위와 같다)
   - `ResponsesStreamResult`(142줄)에 `reasoning: string | null`과 마지막 요약 자리(`item_id`와 `summary_index`). `createResponsesStreamResult`는 null이다.
   - `response.output_item.added`와 `applyItemDone`에서 item `type`이 `"reasoning"`이면 `out.reasoning ??= ""`. `encrypted_content`를 모으는 `collectReasoning`은 그대로다.
   - `response.reasoning_summary_text.delta`의 `delta`(string)를 `out.reasoning`에 더한다(자리가 바뀌면 `"\n\n"`).
   - 무시 목록(271~283줄)의 `type.startsWith("reasoning_summary") || type.startsWith("reasoning_text")`를 실제 이름 `response.reasoning_summary`·`response.reasoning_text`로 고친다(delta는 위에서 먼저 받는다). 주석 "reasoning summary는 사람이 읽을 본문이므로 제외한다."와 `collectReasoning` 위 주석의 "summary text는 버린다"를 지금 뜻으로 고친다.
3. `packages/core/lophn-agent/providers/adapters/chat-completions.ts` (근거: 위와 같다)
   - `ChatStreamResult`(157줄)에 `reasoning: string | null`. `createChatStreamResult`는 null이다.
   - `applyChoice`: `typeof record.reasoning_content === "string"`이면 `out.reasoning = (out.reasoning ?? "") + record.reasoning_content`.
   - 머리 주석의 "DeepSeek reasoning_content 제외"와 `applyChoice` 위 주석(229~230줄)을 고친다: 응답의 `reasoning_content`는 `reasoning`으로 모으고, 요청에는 지금처럼 보내지 않는다(`applyPadding`).
4. `packages/core/lophn-agent/providers/work.ts`, `packages/core/lophn-agent/providers/invoke.ts` (근거: 계약 "`stream-core`의 `onDelta` callback")
   - `ModelCallOutput`에 `reasoning: string | null`. 주석: 사람이 읽을 reasoning 글이다. null은 reasoning이 없었고 ""는 읽을 글 없이 있었다. opaque 상태와 model 이력에는 가지 않는다.
   - `Collected`에 `reasoning`, 세 collector의 `finish`가 `out.reasoning`을 싣는다. `done`의 기본값은 `reasoning: null`이고 `extra`에 `collected.reasoning`을 싣는다.
   - `stream-core`가 만든 collector의 delta 비교에 reasoning을 더한다: `(out.reasoning ?? "").length`가 늘면 `onDelta({ kind: "reasoning", text: 늘어난 조각 })`.
5. `packages/core/lophn-agent/models/wire.ts` (근거: README "OpenAI Responses는 `reasoning.summary`를 요청한다", 위 정한 것)
   - `messagesEffort`(51줄)의 adaptive 조각을 `{ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: name } }`로. `off`와 budget 조각은 그대로다.
   - `responsesEffort`(87줄): 이름이 `"none"`이면 `{ reasoning: { effort: name } }`, 아니면 `{ reasoning: { effort: name, summary: "auto" } }`.
   - `chatEffort`는 그대로다. 주석 한 줄씩(왜 요약을 요청하는지).
6. `packages/core/lophn-agent/run-loop/core-ports.ts` (근거: 계약 "저장된 agent message의 reasoning part", "`duration_ms`는 첫 delta~마지막 delta", agent message 규칙의 part 순서)
   - `lastModelCall` 곁에 `lastReasoning: { text: string; duration_ms: number | null } | null`을 둔다. `modelAttempt`가 attempt마다 다시 쓴다.
   - `modelAttempt`: `onDelta`를 감싼다. kind가 reasoning이면 첫·마지막 시각(`clock.nowMs()`)을 적고 `live.push`로 넘긴다. `invoke`가 돌아오면 `lastReasoning = output?.reasoning == null ? null : { text: output.reasoning, duration_ms: 첫 시각이 없으면 null, 있으면 마지막 − 첫 }`.
   - `answer(text)`: parts는 `lastReasoning`이 null이 아니면 `{kind: "reasoning", text, duration_ms}`, 글이 비지 않으면 `{kind: "text", text}` 순이다. parts가 비면 저장하지 않는다(지금 "글이 비면" 자리). `MessageRecorded`는 `stream-core`대로다.
   - reasoning 글은 보내기 전에 손대지 않는다. 저장하는 글은 core의 본문 준비(아래 7)가 redaction한다. model 호출 출력 blob(`model_call_output`)에는 싣지 않는다(지금 그대로 `text`, `tools`).
   - live reasoning delta도 child에서 redaction하지 않는다. `live.push`로 넘기면 날 글로 core에 가고, core `live-turns.ts`가 `kind: "reasoning"`에도 글과 같은 redaction과 붙잡기(`redactSettled`)를 건다(`stream-core`, README "live 글의 redaction은 core가 한다"). 이 task가 더할 것은 없다.
7. `packages/core/lophn-agent/session/message-body.ts` (근거: 계약 "그 고르기를 machine에 맞추는 것은 `reasoning-core`다", element `agent-sessions`)
   - `createMessageBodyPreparer`(149~155줄)가 자격으로 고른다: agent는 `agentMessageContentInputSchema`·`MESSAGE_CONTENT_MAX_BYTES`, machine은 `machineMessageContentInputSchema`·`MESSAGE_CONTENT_MAX_BYTES`, 사람은 `userMessageContentInputSchema`·`MESSAGE_TEXT_CONTENT_MAX_BYTES`. 149줄 주석("사람과 machine은 글만, agent는 글과 카드다")을 고친다.
   - redaction(`redactValue`)은 문자열을 모두 지나므로 reasoning part의 `text`도 거친다. 고칠 것이 없다.
8. 위험 test `packages/core/lophn-agent/session/message-body_test.ts` (새 file. 근거: README 위험 test "reasoning 글은 지금의 redaction을 거친다", `write-test`. 가짜 준비 통로만 쓰고 subprocess가 없다)
   - "저장하는 reasoning 글은 redaction을 거친다": `createMessageBodyPreparer({ relay: () => 가짜 BodyPrepare(받은 bytes를 적고 PreparedRelayResult를 돌려준다), known: () => 가짜 matcher(ready, 알려진 값 하나) })`에 machine 자격(`actor: "machine"`)과 `RecordMessage` envelope을 넣는다. content는 reasoning part(pattern secret `sk-ant-…` 하나와 알려진 값 하나를 품은 글, `duration_ms` 숫자)와 글 part다. 결과가 ok이고, 돌려준 envelope의 reasoning 글과 준비 통로가 받은 bytes 어디에도 두 secret이 없다.

scratch로 볼 frame(lead가 `tests/fixtures/provider/`에 fixture로 더할 때도 쓴다):
- Anthropic: `content_block_start` `{"index":0,"content_block":{"type":"thinking","thinking":""}}` → `content_block_delta` `{"index":0,"delta":{"type":"thinking_delta","thinking":"Checking the file."}}` → `{"index":0,"delta":{"type":"signature_delta","signature":"sig"}}` → `content_block_stop` → 그 뒤 text block.
- OpenAI Responses: `response.output_item.added` `{"item":{"type":"reasoning","id":"rs_1","summary":[]}}` → `response.reasoning_summary_part.added` `{"item_id":"rs_1","summary_index":0}` → `response.reasoning_summary_text.delta` `{"item_id":"rs_1","summary_index":0,"delta":"Checking the file."}` → `response.reasoning_summary_text.done` → `response.output_item.done`(item에 `encrypted_content`).
- Chat Completions(DeepSeek): `{"choices":[{"index":0,"delta":{"reasoning_content":"Checking the file."}}]}` → `{"choices":[{"index":0,"delta":{"content":"Done."}}]}` → `finish_reason: "stop"`.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "저장하는 reasoning 글은 redaction을 거친다"(`message-body_test.ts`). `deno test --no-check packages/core/lophn-agent/session/message-body_test.ts`로 돌린다. `stream-core`의 `live-turns_test.ts`가 그대로 통과한다(reasoning delta도 core에서 같은 redaction과 붙잡기를 지난다).
- 남지 않음: `grep -rn "thinking_delta는 사람이 읽을 본문이다\|reasoning summary는 사람이 읽을 본문이므로\|DeepSeek reasoning_content 제외\|startsWith(\"reasoning_summary\")" packages/core/lophn-agent/providers/adapters`가 0줄이다. `grep -n "사람과 machine은 글만" packages/core/lophn-agent/session/message-body.ts`가 0줄이다.
- model 이력은 그대로다: `grep -n "reasoning" packages/core/lophn-agent/session/history.ts packages/core/lophn-agent/run-loop/turn.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없을 것이다. 위 frame 셋을 fixture로 더할지는 lead가 정한다(README "lead가 할 일").
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 이 task 뒤에도 남는 것:
  - effort 축이 없는 model은 요약을 요청하지 않는다. Anthropic 현재 model은 그때 thinking 글이 비어 "Thought"만 남는다.
  - 읽을 글 없이 암호화만 오면 `duration_ms`가 null이다.
  - batch(JSON) 성공 응답은 thinking·reasoning을 버린다(`providers/adapters/batch.ts`, 소유 밖).
  - Anthropic `display`와 Responses `summary`를 실제 provider가 받는지는 사람의 허락으로 live에서 본다.
  - reasoning만 있고 글이 빈 마지막 응답이면 run의 답(`wiring/runs.ts`의 `answer`)이 ""가 된다(소유 밖, lead에게).
