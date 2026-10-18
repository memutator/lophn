# pt-received-input

받은 turn의 입력(`inputText`)과 뒤 turn의 history(`receivedText`)가 같은 bytes가 되게 한다. 배달할 때 받은 봉투에 call의 답 방식, reaction의 event type, 실패한 답의 이유를 같이 남기고, history가 그것으로 같은 속성과 줄을 만든다. 쓰는 곳이 test뿐인 `callInput`·`reactionInput`도 지운다.

- 단위: pt-received-input (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/inputs.ts`
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/core/lophn-agent/session/model.ts`
  - `packages/core/lophn-agent/session/fork.ts`
  - `packages/core/lophn-agent/places/messages.ts`
  - `packages/core/lophn-agent/places/places_test.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/core/lophn-agent/run-loop/input-text_test.ts`
  - `packages/core/lophn-agent/prompt-assembly/input-tags.ts`
  - `packages/core/lophn-agent/prompt-assembly/input-tags_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-call.md`의 "받은 turn의 입력과 뒤 turn의 history가 bytes로 다르다"(둘째 안: messages 행에 저장)
  - architecture: `project-docs/architecture/agent-call.md`, `project-docs/architecture/agent-definition.md`("Router가 넣는 입력은 모두 user role"). 제품 결정: `project-docs/products/AGENT-ROLE.md` T11(결과를 받는 call은 받은 agent가 답한다)
  - 사실 확인(읽기만): `packages/core/router/ports.ts`의 `RoutedInput`(`reply`, `event`, `outcome.reason`이 배달 입력에 이미 실린다), 실패 답은 `packages/core/router/model.ts`가 만든다(`outcome: { state: "failed", reason }`), history를 읽는 쪽 `packages/core/lophn-agent/session/history.ts`는 `receivedMessageList` route로 읽고 `entry.received`를 통째로 `receivedText`에 넘긴다. 다른 module의 표를 SQL로 읽지 않는다. 이 길을 그대로 쓴다.
  - 건드리지 않는다: `packages/protocol/lophn-agent/message-content.ts`와 `operators.ts`(계획 `settings-mcp` 소유). `packages/protocol/lophn-agent/received-messages.ts`는 `receivedEnvelopeSchema`를 extend하므로 고치지 않아도 새 칸이 따라온다. `session/history.ts`도 그대로 둔다.
- 계약:
  - 쓰는 것: `RoutedInput`(바꾸지 않는다), `receivedEnvelopeSchema`(`packages/protocol/lophn-agent/inputs.ts`)
  - 내놓는 것: 받은 봉투에 칸 셋을 더한다. 모든 칸이 `nullable`이고 해당 종류가 아니면 `null`이다. 사람 메시지는 셋 다 `null`이다.
    - `reply`: call의 답 방식(`CallReply`: `none`/`result`/`conversation`). call만 값이 있다.
    - `event`: reaction의 domain event type(문자열). reaction만 값이 있다.
    - `fail_reason`: 실패한 답의 이유(`CallFailReason`). program이 보낸 실패 답만 값이 있다.
  - 같은 메시지를 `inputText`로 싼 글과 `receivedText`로 싼 글이 byte까지 같다.

## 할 일

1. `packages/protocol/lophn-agent/calls.ts`: 안 내보내던 `callReplySchema`와 `callFailReasonSchema`를 `export`한다(봉투가 쓴다).
2. `packages/protocol/lophn-agent/inputs.ts`: `receivedEnvelopeSchema`에 `reply: callReplySchema.nullable()`, `event: z.string().nullable()`, `fail_reason: callFailReasonSchema.nullable()`을 더한다. 위 주석에 "무엇을 왜 싣는지"(history가 받은 turn의 입력과 같은 글을 만들게)를 한 줄 쓴다.
3. `packages/core/lophn-agent/session/model.ts`:
   - schema step `lophn-agent.sessions.tables`의 `messages` 표를 그 자리에서 고친다. nullable text 칸 `reply`(`check (reply in ('none','result','conversation'))`), `event`, `fail_reason`(`check`로 `CALL_FAIL_REASONS` 다섯)을 더한다. `messages_content_immutable` trigger의 `before update of …` 목록에도 셋을 더한다. 새 step을 만들지 않고 migration도 만들지 않는다. 개발 data(`.dev-data/`)는 지우고 새로 만든다(AGENTS.md "호환성"). 그 말을 보고에 적는다.
   - `MessageRow`, `MESSAGE_COLUMNS`, `messageRowOf`, `receivedMessageOf`에 세 칸을 더한다. 읽는 길(`session/reads.ts`의 `messages` handler)은 `MESSAGE_COLUMNS`를 쓰므로 따로 고치지 않는다.
4. `packages/core/lophn-agent/places/messages.ts`(`createReceivedRecorder.record`): `messages` insert에 세 칸을 더한다. 값은 `input.reply`(call일 때), `input.event`(reaction일 때), `input.outcome?.reason ?? null`이다. 종류가 아니면 `null`을 넣는다. `packages/core/lophn-agent/session/fork.ts`의 메시지 복사 insert에도 세 칸을 그대로 옮긴다. 사람 메시지를 쓰는 `session/message-commands.ts`의 insert는 세 칸이 `null`(기본값)이라 고치지 않는다.
5. `packages/core/lophn-agent/run-loop/input-text.ts`:
   - `receivedText`의 인자 타입을 `Pick<ReceivedMessage, "from" | "call" | "reply_to" | "refs" | "reply" | "event" | "fail_reason">`로 넓힌다. `base`에서 `reply: null`, `event: null`로 비우던 것을 종류별로 채운다: call은 `reply: message.reply`, reaction은 `event: message.event`, program의 실패 답은 `outcome: { state: "failed", reason: message.fail_reason }`.
   - `callText`의 "reply가 null이면 …" 분기와 주석을 없앤다. `reply`는 call이면 항상 있다(받은 쪽이 못 알면 null을 허용하지 않는다). 속성 `reply`와 "answer with the reply tool" 줄(`reply === "result"`일 때)은 지금 그대로 둔다. 두 길이 같은 값을 쓰므로 같은 글이 나온다.
   - `receivedText` 위 주석("session 기록에는 … 모르는 칸은 비운다")을 "봉투가 싣는 칸으로 받은 turn의 입력과 같은 글을 만든다"로 고친다.
6. `input-text_test.ts`: 두 번째 test(`다른 agent가 보낸 call 본문은 …`)를 확장한다. `reply`가 `none`/`result`/`conversation`인 call, `event`가 있는 reaction, `outcome: { state: "failed", reason: "closed" }`인 실패 reply를 각각 `inputText`로 싼 글과 같은 내용의 봉투를 `receivedText`로 싼 글이 같은지 본다. 봉투 fixture에 새 칸 셋을 채운다. 새 test를 더하지 않는다. `places/places_test.ts`에 받은 메시지를 기록하는 test가 이미 있으면 거기서 call의 `reply` 값이 읽혀 나오는지 한 줄만 더한다. 없으면 더하지 않는다.
7. 죽은 코드를 지운다. `prompt-assembly/input-tags.ts`의 `callInput`, `reactionInput`과 그것만 쓰던 `refText`, `CALL_NOTE`, `CALL_RESULT`, 안 쓰게 된 import(`CallRef`, `CallReply`)와 남는 고아 주석을 지운다(`noticeInput`, `steerInput`, `wrapUntrusted`, `renderTag`, `escapeTagBody`, `scrubAttribute`는 둔다). `input-tags_test.ts`의 첫 test에서 `callInput`·`reactionInput` 사례와 import를 뺀다(남은 사례가 그 test의 뜻을 유지한다). `INPUT_TAG_ATTRIBUTES`(`packages/protocol/lophn-agent/input-tags.ts`)의 call·reply·reaction 항목은 이 task가 건드리지 않는다. 쓰는 곳이 없어지면 보고에 적는다.

## 끝남

- `deno task check`가 통과한다. type 오류가 나는 곳(`ReceivedMessage` 리터럴을 만드는 test 등)은 새 칸 셋을 채워 고친다. `packages/shell/renderer/**`에서 오류가 나면 고치지 말고 보고에 적는다(계획 `settings-mcp` 소유). `deno task check:full`의 `tests/e2e/agent-call_test.ts`, `reaction_test.ts`가 통과한다.
- 위험 test: "같은 call(답 방식 셋 모두)·reaction·실패 reply를 받은 turn의 입력으로 싼 글과 뒤 turn의 history로 싼 글이 byte까지 같다"(`input-text_test.ts`의 한 test)
- 남지 않음: `grep -rn "callInput\|reactionInput" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 칸 이름(`reply`, `event`, `fail_reason`)과 column 이름. 개발 data를 지워야 한다는 것
- 넘길 줄: 다른 계획 소유 file에서 type 오류가 나면 여기에 적는다
- 안 쓰게 된 export: `INPUT_TAG_ATTRIBUTES`의 항목 중 쓰는 곳이 없어진 것
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
