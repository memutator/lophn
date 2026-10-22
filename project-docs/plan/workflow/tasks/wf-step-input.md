# wf-step-input

Router가 새 입력 종류 `step`을 받아 받는 session에 unattended로 넣고, 받은 봉투가 tag 속성을 저장해 뒤 turn의 이력에서도 같은 글이 나오게 한다. approval 코드는 건드리지 않는다.

- 단위: workflows (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/inputs.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/core/router/ports.ts`
  - `packages/core/router/model.ts`
  - `packages/core/router/router.ts`
  - `packages/core/router/router_test.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/core/lophn-agent/run-loop/input-text_test.ts`
  - `packages/core/lophn-agent/run-loop/inbox_test.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/run-loop/work.ts`
  - `packages/core/lophn-agent/places/messages.ts`
  - `packages/core/lophn-agent/session/model.ts`
  - `packages/core/lophn-agent/session/fork.ts`
  - `packages/core/lophn-agent/session/history_test.ts`(`/session_messages/list` fake 응답에 `step: null` 한 줄)
  - `packages/core/main/daemon/wiring/router.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`("지키는 것"의 unattended, 받은 순서와 turn 순서, 같은 bytes), `project-docs/architecture/approval.md`("turn mode"), `project-docs/architecture/run.md`("unattended", "켤 때와 session 끝"), `project-docs/architecture/place-session.md`(켤 때 입력함)
  - 제품 결정: `project-docs/products/roadmap/workflow.md`의 "agent가 아는 것 (캡슐화)", "묻기"
  - 본보기 코드: `packages/core/lophn-agent/session/message-commands.ts`의 `unstartedHumanMessages`(켤 때 되돌리는 대상을 `from_kind = 'human'`과 `unattended = 0`으로 거른다), `packages/core/lophn-agent/run-loop/turn-mode.ts`의 `turnModeOf`(입력의 `unattended`만 읽는다)
- 계약:
  - 쓰는 것: `wf-contract`의 "step 입력" 절(모양), `packages/core/router/router.ts`의 `route`(보낸 쪽 program, `unattended`)
  - 내놓는 것(다른 task가 기대는 모양):
    - `RoutedInputKind`에 `"step"`. `RouteInput`·`RoutedInput`에 `step: { instance: Id<"wfi">, step: string } | null`(`RouteInput`은 optional, `RoutedInput`은 필수).
    - `INPUT_TAGS.step = "lophn-step"`, `INPUT_TAG_ATTRIBUTES.step = ["instance", "step"]`.
    - `receivedEnvelopeSchema`에 `step: { instance, step } | null`. `messages` 표에 `step_instance`, `step_name` 칸(둘 다 null이거나 둘 다 있다. `kind`가 step일 때만).
    - `inputText`가 step 입력을 `<lophn-step instance="…" step="…">본문</lophn-step>` 한 줄 뒤에 고정 영어 한 줄("This was sent by lophn for a workflow instance. When your step is done, report it with the workflow.report tool.")로 싼다. `receivedText`가 같은 글을 다시 만든다. unattended 표시는 글에 싣지 않는다.
    - step 입력도 call처럼 rewind 시점(checkpoint)이다(`places/messages.ts`).

## 할 일

1. **protocol.** `packages/protocol/lophn-agent/input-tags.ts`에 `INPUT_TAGS.step = "lophn-step"`, `INPUT_TAG_ATTRIBUTES.step = ["instance", "step"]`를 더한다. `packages/protocol/lophn-agent/inputs.ts`에서 `routedInputKindSchema`에 `"step"`을 더하고, `receivedEnvelopeSchema`에 `step: z.object({ instance: idSchema("wfi"), step: z.string() }).nullable()`을 더한다(`received-messages.ts`는 이 schema를 `extend`하므로 고치지 않는다). 근거: `agent-call.md` "받은 메시지의 봉투가 ... 같이 저장한다". 이력의 글이 받은 turn의 글과 같은 bytes여야 cache가 깨지지 않는다. `wfi` id는 `wf-contract`가 `ids.ts`에 더한다.
2. **Router.**
   - `packages/core/router/ports.ts`의 `RoutedInput`에 `step: { instance: Id<"wfi">; step: string } | null`(필수)을 더한다. 사람 메시지·call·reply·reaction·notice는 모두 `null`이라, `RoutedInput` 리터럴을 만드는 모든 곳에 `step: null`을 더한다: `router/model.ts`의 `failureInput`, `router/router.ts`의 `reply`(전달 입력), `lophn-agent/run-loop/prepare.ts`의 `noticeText`, `run-loop/work.ts`의 취소 notice, `run-loop/input-text.ts`의 `receivedText`의 `base`, `main/daemon/wiring/router.ts`의 켤 때 되돌리는 사람 메시지, 두 test의 `input()`·`call` 리터럴(`inbox_test.ts`, `input-text_test.ts`). type check가 빠진 곳을 잡는다.
   - `router/model.ts`의 `RouteInput`에 `step?: { instance: Id<"wfi">; step: string } | null`을 더하고(`message`·`event`처럼 optional), `router/router.ts`의 `inputOf`가 `step: input.step ?? null`로 옮긴다. 이유: 보낸 쪽(`wf-commands`)이 `kind: "step"`, `step`, `unattended: true`를 실어 `route`를 부르면 입력함 입력이 같은 값을 갖는다. 새 route나 새 보낸 쪽 종류는 만들지 않는다(보낸 쪽은 기존 `{ kind: "program" }`이고 call 행이 없다).
3. **글.** `packages/core/lophn-agent/run-loop/input-text.ts`의 `inputText`에 `case "step"`을 더한다: `wrap(INPUT_TAGS.step, { instance, step }, input.body)` 뒤에 줄 하나 `This was sent by lophn for a workflow instance. When your step is done, report it with the workflow.report tool.`. `input.step`이 null이면 속성은 `""`다(다른 case와 같다). `receivedText`는 `Pick`에 `"step"`을 더하고 `base`에 `step: message.step`을 싣는다. program의 분기에서 `message.step !== null`을 `reply_to === null`(reaction) 검사보다 먼저 보고 `kind: "step"`으로 `inputText`를 부른다. 안 그러면 step이 reaction tag로 다시 만들어져 이력이 달라진다.
4. **표.** `packages/core/lophn-agent/session/model.ts`의 `messages` 표 DDL(schema step `lophn-agent.sessions.tables`)을 그 자리에서 고친다: `step_instance text`, `step_name text`, `check ((step_instance is null) = (step_name is null))`, `check (step_instance is null or from_kind = 'program')`, 확정 메시지를 못 덮어쓰게 하는 trigger(`messages_content_immutable`)의 칸 목록에 두 칸을 더한다. `MessageRow`, `MESSAGE_COLUMNS`, `messageRowOf`, `receivedMessageOf`에 두 칸을 더하고 봉투 `step`은 둘 다 있으면 `{ instance, step }`, 없으면 `null`이다. 옛 data root는 `history_mismatch`로 안 떠서 지우고 새로 만든다(`project-docs/products/change-log/0.6.0.md`의 선례, AGENTS.md "호환성"). migration을 만들지 않는다. `unattended` 열은 건드리지 않는다: 그 열은 사람 메시지에만 있고(`check (unattended = 0 or from_kind = 'human')`), step의 표시는 `RoutedInput`(메모리)에서 `turns.mode`가 된다.
5. **기록.**
   - `packages/core/lophn-agent/places/messages.ts`의 `record`가 insert에 두 칸을 싣고(`input.step?.instance ?? null`, `input.step?.step ?? null`), `createCheckpoint` 조건을 `call`·`reply`에 `step`을 더해 넓힌다(step도 turn을 시작하는 입력이라 rewind로 돌아갈 시점이다. `places/messages.ts` 위 주석의 같은 이유).
   - `packages/core/lophn-agent/session/fork.ts`의 복사 insert가 두 칸을 같이 복사한다. 안 그러면 Fork한 session의 이력에서 step tag가 reaction tag로 바뀐다(3과 같은 이유).
6. **켤 때(정한 것 참고).** 이 task는 되돌리지 않게 하는 데 코드를 더하지 않는다. `main/daemon/wiring/router.ts`의 켤 때 되돌리기는 `unstartedHumanMessages`(`from_kind = 'human'`)만 입력함에 되돌리므로 program이 보낸 step은 이미 되돌려지지 않는다. `callsRecover`·`failLostOnStart`는 `agent_calls` 행만 보므로 step(call 행 없음)과 상관없다. 이 사실을 `router_test.ts`나 `message-commands_test.ts`에 따로 test하지 않는다(그 test는 이 task 소유가 아니다). 가져가지 않은 step 메시지가 `turn is null`인 채 남는다는 것이 `lophn_restarted` 줄을 만드는 쪽(아래 "정한 것")의 근거다.
7. **본문 준비 export.** `main/daemon/wiring/router.ts`의 `prepareTexts`와 `textBytes`를 `export`한다(다른 변경 없음). 이유: `wf-service`의 wiring이 step 본문 blob을 같은 방식으로 준비할 때 베끼지 않게 한다. `wf-service`가 쓰지 않기로 하면 이 export는 되돌린다.
8. **test.** 위험 test 하나를 `router_test.ts`에 더한다(아래 "끝남"). `input-text_test.ts`는 새 test를 만들지 않고, 있는 "받은 turn의 입력과 뒤 turn의 history는 call, reaction, 실패 답에서 같은 글이다"의 반복에 step 한 경우를 더한다(`inputText`의 step 입력과 `receivedText`가 같은 글, 본문 안의 `<lophn-` 위조는 escape). `inbox_test.ts`는 리터럴에 `step: null`만 더한다. `session/history_test.ts`는 `/session_messages/list` fake 응답에 `step: null` 한 줄을 더한다(받은 봉투 schema가 `step`을 꼭 요구해 안 더하면 응답 검사가 `unavailable`이 된다).

## 정한 것

- **approval 코드는 고치지 않는다.** `turnModeOf`는 `RoutedInput.unattended`만 읽으므로 step 입력이 `unattended: true`를 실으면 skip session에서도 unattended turn이 된다. `turn-mode.ts`, `judge.ts`, `ask` 쪽은 바꾸지 않는다. 읽는 데 바꿀 곳이 있어 보이면 그 최소 변경을 보고에 적고 계약 바꾸기 요청으로 올린다.
- **step은 call이 아니다.** `agent_calls` 행도, `markConsumed`도, 답 방식도 없다(`reply: "none"`, `call: null`, `reply_to: null`). 받는 session이 이 step으로 일하고 `workflow.report`를 내는 것은 call의 답이 아니다.
- **`lophn_restarted` 줄은 이 task가 만들지 않는다.** 켤 때 step을 `lophn_restarted`로 남기는 일은 `wf-service`의 `reconcile`이 한다(README "시작과 멈춤"). 이 task는 그 reconcile이 쓸 근거를 `messages`에 남긴다: `step_instance`·`step_name`, 그 메시지를 가져간 `turn`(null이면 가져가지 않음). 찾을 때는 기존 index `messages_session_created`로 충분해서 index를 더하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "step 입력은 unattended 표시를 싣고 받는 session 하나에만 닿는다. 그 표시가 열 turn은 unattended지만 할당에 없는 앱 tool은 여전히 `deny`다".
  - `packages/core/router/router_test.ts`에 test 하나를 더한다. 이름은 결과 한 문장이다(기존 test처럼 "unattended가 attended 사슬로 새지 않는다" 꼴, 그 아래 "권한 경계다" 주석 곁에 둔다). `from: { kind: "program" }`, `kind: "step"`, `step: { instance, step }`, `unattended: true`, `reply: "none"`으로 `route`를 두 번 부른다: 열린 session 주소 하나, 이름(named) 주소 하나. 둘 다 받는 session 하나에만 입력이 정확히 한 번 전달되고, 그 입력의 `unattended`가 `true`, `kind`가 `"step"`, `step`이 보낸 값, `call`이 `null`이며 `agent_calls` 행이 생기지 않는다(`setup()`의 `rows`가 비어 있다).
  - 할당 판정은 새로 만들지 않는다. `packages/core/approvals/gate/judge_test.ts`의 "할당하지 않은 앱 tool과 뺀 tool은 어느 mode에서도 막는다"가 모든 mode(unattended 포함)에서 `not_assigned`를 `deny`로 돌려주는 것을 이미 본다. 보고에 이 test가 그대로 통과함을 적는다.
  - `turn-mode.ts`용 test는 만들지 않는다(입력의 `unattended`를 그대로 읽는 세 줄 함수고, 이 task는 고치지 않는다).
- 남지 않음: 없음(옛 이름을 지우는 task가 아니다). `RoutedInput` 리터럴 누락은 `deno task check`의 type check가 잡는다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: 없음(`INPUT_TAGS`는 이미 export되고, `ids.ts`의 `wfi`는 `wf-contract`).
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: type check가 요구해 최소로 맞춘 남의 file이 있으면 적는다.
- 계약 바꾸기 요청: (1) `turn-mode.ts` 등 approval 쪽을 고쳐야 했다면 이유와 최소 변경. (2) 이 task가 남긴 `messages.step_*`·`turn` 열로 `wf-service`의 reconcile이 가져가지 않은 step을 찾을 수 있는지 확인해 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".
