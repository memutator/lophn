# wf-envelope-carry

`approval-simplify`가 unattended 표시를 나른 길을 따라, agent가 보낸 call의 `workflow`·`participant`를 Router, 받는 session 기록(messages 표), 받는 turn의 `<lophn-call>` tag와 뒤 turn 이력까지 같은 bytes로 나른다. 위험 test 하나를 둔다: workflow 안의 call도 보낸 turn의 mode를 그대로 따른다. workflow 칸이 mode나 할당을 바꾸지 않는다(README의 위험 test 1).

- 단위: envelope (wave 2)
- 선행: wf-contract-shapes
- 소유(이 task만 고친다):
  - `packages/core/router/{ports.ts,model.ts,router.ts,commands.ts,router_test.ts}`
  - `packages/core/lophn-agent/session/{model.ts,fork.ts}`
  - `packages/core/lophn-agent/places/messages.ts`
  - `packages/core/lophn-agent/run-loop/{input-text.ts,input-text_test.ts}`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`("지키는 것"의 "다른 agent·program이 보낸 입력은 … 같은 함수로 태그에 싼다"와 `agent_calls` 행 줄), `project-docs/architecture/agent-definition.md`("같은 재료는 같은 bytes다", "Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다"), `project-docs/architecture/place-session.md`("fork는 이력만 복사한다"), `project-docs/architecture/approval.md`(`approval-simplify`가 고친 판의 turn mode와 unattended 전파)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `agent-sessions`, `run-loop`. `project-docs/module-catalog.yaml`의 `packages/core/router`, `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/workflow/README.md`의 "뼈대 검토에서 정한 것"(봉투의 새 칸은 optional)과 "lead가 할 일"의 위험 test, `project-docs/products/roadmap/approval.md`의 "unattended는 call을 따라 간다"
  - 계약: `project-docs/plan/workflow/tasks/wf-contract-shapes.md`의 "봉투"와 "receiver tag"
  - 코드: `packages/core/lophn-agent/session/history.ts`(`readSessionConversation`이 `receivedMessageList`로 읽은 `ReceivedMessage`를 `receivedText`에 그대로 넘긴다), `packages/core/lophn-agent/run-loop/core-call.ts`의 `readOf`(core 답을 route output schema로 다시 검사한다)
- 계약:
  - 쓰는 것:
    - SendCall 입력의 `workflow?`·`participant?`(`packages/protocol/lophn-agent/calls.ts`)
    - `receivedEnvelopeSchema`의 `workflow?`·`participant?`(`packages/protocol/lophn-agent/inputs.ts`)
    - `INPUT_TAG_ATTRIBUTES.call`(`packages/protocol/lophn-agent/input-tags.ts`)
    - `approval-simplify`가 봉투에 실은 unattended 표시와 그 전파 길
  - 내놓는 것:
    - `RouteInput`·`RoutedInput`에 `workflow?: string`, `participant?: string`. kind `call`이고 보낸 쪽이 agent일 때만 있다.
    - SendCall에서 둘 가운데 하나만 오면 `invalid_input`이다.
    - messages 표에 열 `workflow`, `participant`(둘 다 있거나 둘 다 null). 고치지 못하는 열 목록(trigger)에 든다. fork가 같이 복사한다. 옛 표는 고치고 개발 data는 새로 만든다(migration 없음).
    - 받은 turn의 입력과 뒤 turn 이력(`receivedText`)이 같은 글을 만든다: `<lophn-call from="…" call="…" reply="…" workflow="<domain>/<name>" participant="<참가자>">`.
    - `agent_calls` 행은 바꾸지 않는다.

## 할 일

1. 시작 전에 앞 계약이 있는지 본다. 없으면 고치지 말고 멈춰 보고한다.
   - `grep -n "workflow" packages/protocol/lophn-agent/calls.ts packages/protocol/lophn-agent/inputs.ts packages/protocol/lophn-agent/input-tags.ts`가 `callSendInputSchema`, `receivedEnvelopeSchema`, `INPUT_TAG_ATTRIBUTES.call`에서 나온다(wf-contract-shapes).
   - `approval-simplify`의 unattended 표시가 `packages/core/router/model.ts`의 `RouteInput`과 `packages/core/router/ports.ts`의 `RoutedInput`에 있다. 2026-10-21 main(`e192a9d8c`)에는 아직 없다. 이름과 자리는 planner가 brief를 다시 맞출 때 적는다.
2. Router 입력 type(`router` boundary).
   - `packages/core/router/model.ts`의 `RouteInput`에 `workflow?: string`, `participant?: string`을 더한다.
   - `packages/core/router/ports.ts`의 `RoutedInput`에 같은 둘을 더한다. 주석은 "workflow 안의 call일 때 받는 쪽 tag가 싣는 workflow 열쇠와 보낸 참가자"처럼 왜만 쓴다.
3. `packages/core/router/commands.ts`의 `sendCallCommand.handle`.
   - `input.workflow`와 `input.participant` 가운데 하나만 있으면 `routerFor` 앞에서 `err({ code: "invalid_input", … })`로 돌려준다.
   - 둘 다 있으면 `router.value.route`의 입력에 둘을 싣고, 둘 다 없으면 key를 두지 않는다.
   - `approval-simplify`의 unattended 표시를 정하는 줄은 건드리지 않는다. workflow 칸은 그 판정에 들어가지 않는다.
4. `packages/core/router/router.ts`의 `inputOf`가 `RouteInput`의 `workflow`·`participant`를 있을 때만 `RoutedInput`으로 옮긴다.
   - 넣는 곳은 3의 SendCall 하나다. 그래서 kind와 보낸 쪽을 여기서 다시 보지 않는다.
   - `newRecord`(`agent_calls` 행), `deliveryFailed`, `launchCoding`, `reply`, `failureInput`(`packages/core/router/model.ts`)은 바꾸지 않는다.
   - 받는 곳 풀기(`resolve`)와 mode 표시에 workflow 칸을 쓰지 않는다.
5. messages 표(`agent-sessions`). `packages/core/lophn-agent/session/model.ts`를 고친다.
   - `conversationSchemaSteps`의 step `lophn-agent.sessions.tables` SQL을 그 자리에서 고친다. step을 더하지 않는다.
     - `create table messages`의 `fail_reason` 뒤에 `workflow text,`와 `participant text,`를 더한다.
     - check `((workflow is null) = (participant is null))`를 더한다.
     - trigger `messages_content_immutable`의 `before update of …` 열 목록에 `workflow, participant`를 더한다.
   - `MessageRow`, `MESSAGE_COLUMNS`, `messageRowOf`에 두 열을 더한다.
   - `receivedMessageOf`는 `workflow`가 null이 아닐 때만 `workflow`·`participant` key를 둔다. null이면 key를 두지 않는다.
6. `packages/core/lophn-agent/places/messages.ts`의 `createReceivedRecorder().record`가 insert에 두 열을 싣는다. 값은 `input.kind === "call"`일 때 `input.workflow ?? null`, `input.participant ?? null`이고 그 밖에는 null이다.
7. `packages/core/lophn-agent/session/fork.ts`의 `createForkCommand` 복사 insert에 두 열을 더해 `original.workflow`, `original.participant`를 그대로 옮긴다. fork 사본의 이력도 같은 tag를 만든다(`place-session.md` "fork는 이력만 복사한다").
8. tag(`run-loop`). `packages/core/lophn-agent/run-loop/input-text.ts`를 고친다.
   - `callText`의 속성 객체에서 `reply` 뒤에 `workflow`, `participant`를 이 순서로 둔다. `input.workflow`가 있을 때만 둔다.
     - 순서는 `INPUT_TAG_ATTRIBUTES.call`과 같다. `approval-simplify`가 그 목록에 속성을 더했으면 그 목록 순서를 따른다.
     - 값은 지금의 `wrap`/`open`(`scrubAttribute`)을 그대로 거친다.
   - 새 고정 문장 줄은 더하지 않는다. 두 속성의 뜻은 `wf-role-text`가 제품 고정 규칙에 적는다.
   - `receivedText`의 `Pick<ReceivedMessage, …>`에 `"workflow" | "participant"`를 더한다. call 가지(`message.reply_to === null`이고 보낸 쪽이 agent·coding agent)에서 둘을 있을 때만 `inputText`로 넘긴다. reaction, notice, reply 가지는 그대로다.
9. 고치지 않는 곳(새 칸이 이미 지나간다).
   - `packages/core/lophn-agent/session/message-commands.ts`의 insert는 열 이름을 적어 새 열이 null로 들어간다.
   - `packages/core/lophn-agent/session/reads.ts`는 `receivedMessageOf`를 쓴다.
   - `packages/core/lophn-agent/session/history.ts`는 읽은 `ReceivedMessage`를 그대로 넘긴다.
   - core와 agent runtime 사이 turn source 답은 `value: z.unknown()`이다(`packages/protocol/supervision/supervision.ts`). `RoutedInput`의 새 칸이 그대로 건너간다.
   - coding agent의 harness 배달(PTY)은 바꾸지 않는다. coding agent 참가자는 계획 범위 밖이다.
10. test(`write-test` skill).
    - `packages/core/lophn-agent/run-loop/input-text_test.ts`: 있는 test "받은 turn의 입력과 뒤 turn의 history는 call, reaction, 실패 답에서 같은 글이다"에 workflow call 한 줄을 더한다. 새 test는 만들지 않는다.
      - `workflow: "eval/eval"`, `participant: "runner"`인 call에서 `receivedText`와 `inputText`가 같은 글이다.
      - 그 글의 여는 tag가 `workflow="eval/eval" participant="runner">`로 끝난다. 두 길이 함께 속성을 빠뜨려도 같은 글이라 이 판정이 따로 있어야 한다.
    - `packages/core/router/router_test.ts`: 위험 test를 새로 쓴다(아래 "끝남"). 있는 `setup`(port 대역)을 쓴다.
      - 보낸 turn의 mode 둘(attended, unattended. `approval-simplify`의 표시)마다 같은 call을 workflow 없이 한 번, `workflow: "eval/eval"`·`participant: "runner"`로 한 번 보낸다. dedup은 따로 준다.
      - 판정은 배달된 입력으로 한다. 두 입력이 같은 받는 session으로 가고, mode 표시가 보낸 turn의 것과 같다. 두 입력은 `call`, `workflow`, `participant` 밖에는 같다.
      - `approval-simplify`의 mode 전파 test가 이 file에 있으면 그 준비를 같이 쓴다. 같은 판정을 두 test로 나누지 않는다.

정한 것:
- 새 열은 있는 step SQL을 고쳐 더한다. 이유: AGENTS.md "호환성"이 migration을 만들지 않고 개발 data를 새로 만들게 한다. step SQL hash가 바뀌어 옛 `.dev-data/`의 core는 켜지지 않는다(`packages/core/storage/migration/migrations.ts`의 `applyMigrations`).
- `receivedMessageOf`는 null인 열의 key를 두지 않는다. 이유: 봉투 schema의 두 칸이 optional이라 null을 받지 않는다. null을 실으면 core 출력 검사와 `readOf`가 떨어지고, 이력을 읽는 모든 turn이 실패한다.
- tag는 `input-text.ts`의 `wrap`을 그대로 쓴다. `packages/core/lophn-agent/prompt-assembly/input-tags.ts`의 `renderTag`로 바꾸지 않는다. 이유: 두 함수의 속성 scrub이 달라 바꾸면 지금 tag의 bytes가 바뀐다.
- messages 표 check는 짝 하나만 둔다. "kind call이고 agent가 보냈을 때만"은 표 check로 두지 않는다. 이유: 넣는 곳이 SendCall 하나다(AGENTS.md "속도").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "workflow 안의 call도 보낸 turn의 mode를 그대로 따른다. workflow 칸이 mode나 할당을 바꾸지 않는다"(`packages/core/router/router_test.ts`)
- `packages/core/lophn-agent/run-loop/input-text_test.ts`의 같은 글 test가 workflow call 줄을 넣고 통과한다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 두 번 찍는다. 고친 step이 새 data root에 적용된다.
- 빠진 길 없음: `grep -n "participant" packages/core/router/commands.ts packages/core/router/router.ts packages/core/lophn-agent/session/model.ts packages/core/lophn-agent/session/fork.ts packages/core/lophn-agent/places/messages.ts packages/core/lophn-agent/run-loop/input-text.ts`가 file마다 나온다.
- 안 바뀜: `grep -n "workflow\|participant" packages/core/router/store.ts packages/core/router/schema.ts`가 0줄이다(`agent_calls` 행).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 개발 data: messages 표 schema가 바뀌어 옛 `.dev-data/`로는 core가 켜지지 않는다. lead가 사람에게 알린다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
