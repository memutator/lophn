# ap-mode-envelope

unattended 표시를 call 봉투에 싣는다. `SendCall`·`ReplyCall` 입력의 표시를 Router가 봉투, 입력함 입력, 받은 메시지 봉투, `agent_calls` 행까지 옮기고, 그 call에 대한 늦은 실패와 취소 알림은 call의 표시를 따른다. 표시를 채우는 쪽(call·reply tool)과 받는 turn의 mode는 ap-mode-turn이 한다.

- 단위: mode (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{calls.ts,inputs.ts,received-messages.ts}`
  - `packages/core/router/`
  - `packages/core/lophn-agent/places/messages.ts`
  - `packages/core/lophn-agent/run-loop/work.ts`(lophn transport의 취소 알림)
  - `packages/core/lophn-agent/run-loop/input-text.ts`(`inputText`의 인자 type 한 줄)
  - `packages/core/main/daemon/wiring/router-registration.ts`(transport의 `cancel`)
  - `packages/core/main/daemon/wiring/router.ts`(켤 때 다시 넣는 사람 메시지 한 줄)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`("실패는 조용히 버리지 않고 한 번만 알린다", "입력함은 메모리라 꺼지면 사라진다", "다른 agent·program이 보낸 입력은 … 같은 함수로 태그에 싼다"(같은 bytes, prompt cache), "입력함 순서 … steer는 사람 메시지만 고른다"), `project-docs/architecture/place-session.md`("lophn이 꺼졌다 켜져도 열린 session은 열린 채다"의 사람 메시지 다시 넣기)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `run-loop`, `agent-sessions`, `project-docs/module-catalog.yaml`의 `packages/core/router`(port만 안다), `packages/core/lophn-agent`, `packages/core/main`
  - 제품 결정: `project-docs/products/roadmap/approval.md`의 "turn mode"("unattended는 call을 따라 간다")와 "정한 것 (agent)"의 "unattended는 call을 따라 간다", `project-docs/plan/approval-simplify/README.md`의 "정한 것"(unattended는 call 봉투에 싣는다, reaction이 연 turn은 attended다)과 "뼈대 검토에서 정한 것"(unattended는 답과 늦은 실패, 취소 알림에도 실린다)
  - 본보기(코드): `packages/core/router/schema.ts`의 `consumed` 열(0/1 CHECK), `packages/core/router/router_test.ts`의 port 대역(`delivered`로 배달된 입력을 본다)
- 계약:
  - 쓰는 것: ap-contract `mode.ts`의 봉투 규칙
  - 내놓는 것: `callSendInputSchema`와 `callReply` 입력의 `unattended?: true`, `CallEnvelope.unattended: boolean`, `RoutedInput.unattended: boolean`, `receivedEnvelopeSchema.unattended: boolean`, `agent_calls.unattended`. 사람 메시지와 reaction의 입력은 `false`다. 답은 답한 turn이 실은 표시를 따르고, 늦은 실패(`receiver_ended`, `lophn_restarted`)와 취소 알림은 그 call 행의 표시를 따른다(`failureInput(call, reason, unattended)`, `InputTransport.cancel(tx, target, call, unattended)`). 받은 turn과 뒤 이력의 글(tag)은 이 표시로 바뀌지 않는다(prompt cache).

## 할 일

추가(planner, 살 단계 뒤): 할 일 9의 갈래는 A다. `receivedEnvelopeSchema.unattended`와 `messages.unattended` 칸을 두지 않는다. 읽는 곳이 없다: mode는 메모리의 `RoutedInput`에서 오고 결과는 `turns.mode`에 남는다. 그래서 `session/model.ts`와 `session/history_test.ts`를 고치지 않고, `ap-skip-session`과 겹치지 않는다. call 봉투, `RoutedInput`, `agent_calls`의 표시는 그대로다.

**띄우기 전에 planner가 9번을 정한다.** 2번과 9번은 함께 가거나 함께 빠진다.

줄 번호는 main `e192a9d8c` 기준이고 ap-call-judge(wave 1)가 `gate_allowed`와 `CallGate`를 지운 뒤라 밀려 있다. 이름으로 찾는다. 앞 계획 land 뒤 path 확인: `calls.ts`는 `pr-problem-refs`가, `input-text.ts`는 `pr-problem-refs`·`pr-reactions`가, `wiring/router.ts`는 `pr-reactions`(그 뒤 ap-reaction)가 먼저 고친다.

1. protocol(`packages/protocol/lophn-agent/calls.ts`)
   - `callSendInputSchema`(176)와 `callReply.input`(207)에 `unattended: z.literal(true).optional()`을 더한다. 주석: "보낸 turn의 mode가 unattended일 때만 tool이 싣는다. model 입력에는 없다(ap-mode-turn)".
   - `callEnvelopeSchema`(122)와 `agentCallRecordSchema`(141)에 `unattended: z.boolean()`을 더한다.
2. 받은 메시지 봉투(`packages/protocol/lophn-agent/inputs.ts`의 `receivedEnvelopeSchema` 53): `unattended: z.boolean()`을 더한다. 주석: "받은 turn의 mode를 정한 표시다. tag 글에는 넣지 않는다". `received-messages.ts`는 이 schema를 넓히므로 고칠 것이 없다. **뼈대 문제**: 이 칸을 읽고 쓰는 `packages/core/lophn-agent/session/model.ts`와 `session/history_test.ts`는 같은 wave의 ap-skip-session 소유다. 아래 9번을 보라.
3. Router port(`packages/core/router/ports.ts`)
   - `RoutedInput`(35-57)에 `unattended: boolean`을 더한다. 주석: "사람 메시지, reaction, coding agent 입력은 false. agent의 call과 답은 보낸 turn이 실은 표시. 늦은 실패와 취소 알림은 그 call의 표시".
   - `InputTransport.cancel`(81)에 넷째 인자 `unattended: boolean`을 더한다.
4. `packages/core/router/model.ts`
   - `RouteInput`(23-41)에 `unattended?: boolean`을 더한다. 주석: "agent의 SendCall·ReplyCall만 싣는다. 없으면 false". 사람 메시지(`packages/core/lophn-agent/session/message-commands.ts`), Reactor(`callsReact`, `packages/core/apps/tickets/coding/close-call.ts`), coding agent 메시지(`packages/core/apps/tickets/coding/message.ts`)의 입구는 고치지 않는다(정한 것 1).
   - `failureInput(call, reason)`(104)에 `unattended: boolean`을 더해 그대로 싣는다.
5. `packages/core/router/router.ts`
   - `inputOf`(197): `unattended: input.unattended === true`.
   - `newRecord`(237): 행에 `unattended: input.unattended === true`. `deliveryFailed`와 `launchCoding`의 행도 같은 함수로 만든다.
   - `reply`(408): 입력 type과 `Router.reply`의 입력에 `unattended?: boolean`을 더하고 배달하는 `RoutedInput`에 `unattended: input.unattended === true`를 싣는다. call 행의 표시를 쓰지 않는다: 사람이 끼어든 attended turn의 답은 attended다.
   - `notifyFailed`(220)에 call의 표시를 받아 `failureInput(..., unattended)`로 넘기고, `failAll`(498)이 `record.unattended`를 넘긴다.
   - `cancel`(459): `transport.cancel(tx, target, calId(record.call), record.unattended)`(480).
6. `packages/core/router/commands.ts`
   - `sendCallCommand`: `unattended: input.unattended === true`를 route 입력에 싣는다.
   - `replyCallCommand`: `input`을 그대로 넘기므로 `Router.reply` 입력 type만 맞으면 된다.
   - `reactCommand`: 표시를 싣지 않는다. 주석 한 줄 "reaction이 연 turn은 attended다(README)".
7. `agent_calls` 표(`packages/core/router/schema.ts`): `unattended integer not null default 0 check (unattended in (0, 1))`을 더한다. step을 새로 더하지 않고 있는 step의 글을 고친다. 옛 개발 data는 `history_mismatch`로 거절되니 `.dev-data/`를 지우고 새로 만든다(AGENTS.md "호환성"). `default 0`은 칸을 적지 않고 행을 넣는 `packages/core/apps/tickets/coding/coding_test.ts` 때문이다.
8. `packages/core/router/store.ts`: `COLUMNS`(20), `recordOf`(24)의 `unattended: Number(row["unattended"]) === 1`, `insert`(72)의 열과 값(0/1)을 더한다.
9. 받은 메시지 기록. **뼈대 문제: planner가 정하기 전에는 이 task를 띄우지 않는다.**
   - 계약대로면 `messages` 표에 열이 있어야 `receivedMessageOf`가 `receivedEnvelopeSchema.unattended`를 채운다. 표와 `receivedMessageOf`는 `packages/core/lophn-agent/session/model.ts`에 있고, 가짜 `/session_messages/list` 행은 `packages/core/lophn-agent/session/history_test.ts`에 있다. 둘 다 같은 wave의 ap-skip-session 소유이고 선행이 없다.
   - planner가 ap-skip-session을 이 task의 선행으로 두고 두 file을 이 task 소유에 더하면:
     - `packages/core/lophn-agent/places/messages.ts`의 `insert into messages`(39-61)에 `unattended`(0/1)를 넣는다.
     - `session/model.ts`: `create table messages`에 `unattended integer not null default 0 check (unattended in (0, 1))`을 더하고 `messages_content_immutable` trigger의 열 목록에 넣는다. `MessageRow`, `MESSAGE_COLUMNS`, `messageRowOf`, `receivedMessageOf`에 칸을 더한다. `default 0`은 사람 메시지 쓰기(`message-commands.ts`)와 칸을 적지 않는 test(`places/places_test.ts`, `session/message-commands_test.ts`, `session/rewind/rewind_test.ts`) 때문이다.
     - `session/history_test.ts`의 가짜 message 행에 `unattended: false`를 더한다.
   - planner가 `receivedEnvelopeSchema.unattended`를 계약에서 빼면 2번과 9번을 하지 않는다. turn mode는 입력함의 `RoutedInput`(메모리)에서 정하고 재시작 때 다시 넣는 것은 사람 메시지뿐이라 다른 동작은 같다.
10. lophn transport(`packages/core/lophn-agent/run-loop/work.ts`의 `createLophnInputTransport().cancel` 129-147): 넷째 인자를 받아 취소 알림 입력에 `unattended`로 싣는다.
11. wiring(`packages/core/main/daemon/wiring/router-registration.ts`의 transport `cancel`): 받은 `unattended`를 `lophn.cancel`에 넘긴다. harness 쪽(`CodingTransport.stop`)은 쓰지 않는다.
12. 켤 때 다시 넣는 사람 메시지(`packages/core/main/daemon/wiring/router.ts`의 `unstartedHumanMessages` 고리, `INBOX_PUT_TOPIC`의 `input` 488-502): `unattended: false`를 더한다. `data`가 type 검사를 받지 않으니 빠뜨리지 않는다.
13. 받은 입력 글(`packages/core/lophn-agent/run-loop/input-text.ts`의 `inputText` 76): 인자 type을 `Omit<RoutedInput, "unattended">`로 바꾸고 주석 "표시는 tag 글에 넣지 않는다. 받은 turn과 뒤 이력이 같은 bytes를 만든다"를 단다. 그래서 `receivedText`와 `packages/core/lophn-agent/run-loop/prepare.ts`의 `noticeText`는 고치지 않는다.
14. call tool과 reply tool(`packages/core/lophn-agent/tools/bundles/call.ts`)은 ap-mode-turn 소유다. 이 task가 merge된 뒤 ap-mode-turn이 merge될 때까지 plan branch에서 두 tool의 model 입력에 `unattended`가 보인다. 고치지 않고 보고에 적는다.
15. 위험 test(아래 "끝남")를 `packages/core/router/router_test.ts`에 쓴다. `setup`의 대역에 `transport.cancel`이 받은 표시를 모으는 배열과, `openReceivedBy`가 `rows`에서 받는 session의 accepted 행을 돌려주는 구현을 더한다.
16. 문서(`architecture/agent-call.md`의 봉투 mode)는 lead가 계획 끝에 고친다(README "lead가 할 일"). 고치지 않는다.

정한 것:
1. coding agent가 보낸 입력과 Reactor reaction은 표시가 없어 false다. 이유: README가 reaction이 연 turn을 attended로 정했고, coding agent에게 맡기는 흐름은 막혀 있다(README 범위 밖). `RouteInput.unattended`를 선택 칸으로 두어 그 입구들을 고치지 않는다.
2. 답의 표시는 call 행이 아니라 답을 보낸 turn에서 온다. 이유: 계약이 `ReplyCall` 입력에 표시를 두었다. unattended call을 받은 session에 사람이 끼어들어 attended turn이 답하면 그 답은 attended다.

## 끝남

- `deno task check`가 통과한다. schema step 글을 바꿨으니 `project-docs/plan/tools/lead/boot.sh`(새 data root)로 core가 뜨는지 본다.
- 위험 test: "attended turn이 보낸 call은 attended로 열린다. unattended가 attended 사슬로 새지 않는다"
  - `packages/core/router/router_test.ts`. 준비를 한 번 하고 표로 돈다. 판정은 배달된 `RoutedInput.unattended`, `agent_calls` 행(대역 `rows`)의 `unattended`, `transport.cancel`이 받은 표시다.
  - 표시 없는 call은 받는 쪽 입력과 행이 false다. 표시 있는 call은 true다.
  - unattended call에 표시 없이 온 답(사람이 끼어든 attended turn)은 false로 배달된다. 표시 있는 답은 true다.
  - 받는 session이 끝나(`failReceivedBy`) 보낸 쪽에 가는 실패 알림과, 보낸 쪽의 취소(`cancel`)가 받는 쪽에 보내는 취소 알림은 그 call의 표시와 같다(attended call은 false, unattended call은 true).
- 남지 않음: 없음(더하는 일이다). `grep -n "unattended" packages/core/lophn-agent/run-loop/input-text.ts`는 type 한 줄과 주석뿐이다(tag 글에 표시가 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 14번(ap-mode-turn 전까지 tool 입력에 표시가 보인다)을 여기 적는다.
