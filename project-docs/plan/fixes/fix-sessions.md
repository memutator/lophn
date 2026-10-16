# fix-sessions

계약 고정 전 고침. 질문 읽기·답 route, 받은 message의 읽기 모양, call·turn·session rewind 이름과 칸, 허락 결정 말, coding 실행 옵션의 한 벌 정의.

- 단위: contract-calls-places (계약 고정 전 고침)
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{calls,inputs,turn-values,turns,turn-reads,turn-blobs,agent-sessions,session-rewinds,places,ask-tool,questions,messages,message-content}.ts`와 새 file
  - `packages/protocol/events/agent.ts`, `packages/protocol/events/snapshot.ts`
  - `packages/protocol/approvals/requests.ts`
  - `packages/protocol/coding-agent/{launch-plan,transport}.ts`, 새 `packages/protocol/coding-agent/harness-id.ts`
  - `packages/core/router/ports.ts`, `packages/core/lophn-agent/ports.ts`
  - 이름을 바꾼 것을 쓰는 줄(core, shell, renderer, tools 어디든. 그 줄만)
- 읽을 것:
  - spec: `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md` 3장(ask), `event.md` 6·8장, `agent-call.md` 3·5장, `annotation.md` 7·8장, `place-session.md` 4장, `approval.md` 6장
  - 원래 brief: `/home/pyosechang/projects/lophn/project-docs/plan/tasks/contract-calls-places-{calls,turns,places}.md`, `contract-agent-tools-catalog.md`, `contract-events.md`, `contract-approvals.md`
  - 공통 규칙: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`
- 계약: 아래 할 일이 정하는 모양을 내놓는다.

## 할 일

1. **사람이 `ask` 질문을 읽고 답하는 route.** 지금은 `ask-tool.ts`의 입력·결과 schema와 `QuestionAsked`·`QuestionResolved`, snapshot의 `questions[]`(id만)뿐이다. 질문 내용을 읽는 read와 답을 내는 route가 없다(`ask-tool.ts` 주석이 가리키는 read가 없다).
   - 질문 묶음 읽기: session과 tool call로 찾아 `askQuestionSchema` 목록을 준다(메모리 route. 답하면 사라진다).
   - 답 내기: 묶음마다 `askAnswerSchema` 목록. 결과는 `askResultSchema`와 맞춘다. Skip은 없다(spec). actors는 `user`.
   - 옛 `questions.ts`의 `AnswerQuestionGroup`(durable, `qst`, Skip·defer)은 쓰지 않는다. 새 route 이름이 옛것과 겹치면 다른 이름을 쓰고 보고한다.
2. **받은 message의 읽기 모양.** `messageSchema`(`messages.ts`)는 옛 모양(`run`, `actor`, `mode` request·correction, `applied_at_call`, document·version link)이다. 새 읽기 모양을 둔다(새 이름. 옛것은 옛 화면이 쓰니 남긴다):
   - `inputs.ts`의 `receivedEnvelopeSchema`(`from`, `call`, `reply_to`, `refs`)와 `delivery`(`next_turn`|`steer`)를 싣는다. turn은 `trn`.
   - annotation 이미지는 message part로 싣지 않는다. `refs`의 annotation id로 가리키고, prompt 조립이 그 id로 screenshot을 읽는다(lead 결정). 그 뜻을 주석에 적는다.
   - message read route(목록·하나)가 새 모양을 내게 한다. 새 route 이름이 옛것과 겹치면 보고한다.
3. **call 칸.** `calls.ts`:
   - `callRefSchema`의 annotation 값은 `annotationIdSchema`(`protocol/apps/annotation.ts`)를 쓴다. 칸 이름은 ticket evidence와 같게 `{kind: "annotation", id}` 꼴로 맞출 수 있으면 맞춘다(안 되면 이유를 보고).
   - `callReply`의 `refs`는 optional(기본 `[]`)로 한다.
   - `created_at`·`state_at`은 `atSchema`로, `state_at`은 `state_changed_at`으로 바꾼다.
4. **coding 실행 옵션 한 벌.** 새 `coding-agent/harness-id.ts`에 `HARNESS_IDS`·`harnessIdSchema`(지금 `harnesses.ts`에 있는 값)와 zod `codingOptionsSchema = {harness?: harnessIdSchema, model?: string}`을 둔다. `calls.ts`가 그것을 import한다(lophn-agent → coding-agent는 순환이 없다). `launch-plan.ts`·`transport.ts`의 `CodingRunOptions`는 `CodingOptions = z.infer<...>`로 바꾸고 이름을 `CodingOptions` 하나로 한다. `harnesses.ts`는 새 file에서 가져다 쓰게 한다.
5. **turn 이름.** 새 turn file이 옛 `run-*.ts`의 이름에 기대는 것을 끊는다: `runLimits*`·`runElapsed*`·`DEFAULT_RUN_LIMITS`는 `turnLimits*`·`turnElapsed*`·`DEFAULT_TURN_LIMITS`로 `turn-values.ts`에 둔다. `readCursorSchema`, `blobSizeSchema`, `positiveSafeIntegerSchema`, `positiveRevisionSchema`는 `packages/protocol/base/values.ts`로 옮겨 새 file이 그것을 쓴다(옛 file은 base를 다시 export하지 말고 import만 바꾼다).
6. **turn 시작 입력 이름.** `events/agent.ts`의 `TurnStarted.trigger`를 `input_message`로 바꾼다(`turn-values.ts`·`turns.ts`와 같게). `SessionStarted`의 `kind`가 `agent.role`로 알 수 있으면 뺀다.
7. **허락 결정 말 한 벌: `allow`·`reject`·`cancelled`.** `events/agent.ts`의 `PermissionResolved`(지금 `allowed|rejected|cancelled`), `approvals/requests.ts`의 status(지금 `granted|rejected|cancelled`)와 turn 결정 `outcome`을 이 셋으로 맞춘다. "이 session 동안"·"항상" 같은 범위는 따로 칸으로 둔다(이미 있으면 그대로).
8. **session rewind id.** `session-rewinds.ts`의 id가 `rvt`(Revert)다. 앱 rewind와 같은 `rwd`로 바꾸고 compare 칸 `applying_revert`를 `applying_rewind`로 바꾼다. 옛 `reverts.ts`에서 가져오는 schema(`revertHeaderOutput`, `previewItemSchema` 등)는 새 file로 옮긴다.
9. **session 상태 enum 한 벌.** `events/snapshot.ts`의 `SESSION_STATES`와 `calls.ts`의 `SENDABLE_SESSION_STATES`가 같은 값이다. snapshot이 calls 것을 쓴다.
10. **router port.** `core/router/ports.ts`의 `RoutedInput.kind`, `delivery`, `move(to)`가 protocol의 같은 값을 literal로 복사했다. protocol type을 import한다. `core/lophn-agent/ports.ts`의 `AppWrites.writesAfter` 반환을 protocol `appWritesSchema` 모양(`{app, invocations[]}`)에 맞춘다. id 칸은 `Id<"ses">`처럼 `protocol/base/ids.ts`의 `Id` type을 쓴다.

## 끝남

- `deno task check`가 통과한다. `deno run -A tools/check-deps.ts`가 통과한다.
- 새 file(소유의 새 계약 file)에 `run`·`Run`·`run_`(turn 뜻), `rvt`, `revert`(rewind 뜻), `granted|allowed|rejected`(허락 결정 뜻), `CodingRunOptions`가 남지 않는다. 옛 file은 예외.
- 위험 test: 없음(type과 schema만).

## 보고

- 바꾼 file
- 등록할 것: 새 route와 그 목록(lead가 `registry.ts`에 올린다), 옛 route와 이름이 겹치는 것
- 이름을 바꾸며 고친 core·shell·renderer 줄
- 정한 것(문서에 답이 없어 정한 것)
- 계약 바꾸기 요청: 없으면 "없음"
