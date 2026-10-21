# rr-program-from

program이 보낸 입력의 보낸 쪽을 `{ kind: "program" }`로 줄인다. 근거 domain event가 없어졌으니(rr-reactor) `from.event_seq`를 protocol, Router, 받은 메시지 기록(`messages.from_ref`), 받은 turn의 태그 글에서 지운다. 같은 "session과 메시지에 남은 event seq" 정리로, 늘 null인 session의 `opening_context`(`sessions.opening_source_seq`, `opening_target`)도 지운다.

- 단위: program-from (wave 2)
- 선행: rr-reactor. `callsReact`(`packages/core/router/commands.ts`)가 `from.event_seq`를 채우는 마지막 곳이고 rr-reactor가 지운다. 둘 다 `packages/core/main/daemon/wiring/router.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{calls.ts,inputs.ts,input-tags.ts,sessions.ts,agent-sessions.ts}`
  - `packages/core/router/{model.ts,ports.ts}`
  - `packages/core/lophn-agent/run-loop/{input-text.ts,input-text_test.ts,work.ts}`
  - `packages/core/lophn-agent/run-loop/prepare.ts`(`noticeText`의 `from` 한 줄만)
  - `packages/core/lophn-agent/places/{messages.ts,lifecycle.ts,directory.ts}`
  - `packages/core/lophn-agent/session/{model.ts,commands.ts,fork.ts,history_test.ts}`
  - `packages/core/apps/coding/{close-call.ts,events.ts}`
  - `packages/core/main/daemon/wiring/router.ts`(`opening_context: null` 한 줄만)
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`(`opening_context: null` 한 줄만)
  - `tests/support/core/human.ts`(`opening_context: null` 한 줄만)
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "목표"(program call의 `from.event_seq`를 없앤다)와 "정한 것"(입력 종류 `reaction`, `<lophn-reaction>` tag, `messages.event` 칸은 남기고 `seq`만 지운다. session의 `opening_context`를 지운다)
  - architecture: `project-docs/architecture/agent-call.md`의 "흐름" 끝 문단(보낸 쪽 넷, "program(근거 domain event seq)")과 "지키는 것"의 "다른 agent·program이 보낸 입력은 … 같은 함수로 태그에 싼다"(받은 turn과 뒤 이력이 같은 bytes), `project-docs/architecture/agent-definition.md`의 "Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다"와 "고정 규칙은 영어 고정 본문 하나". 앞 것은 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `run-loop`, `agent-sessions`, `protocol`, `coding-agent`; `project-docs/module-catalog.yaml`의 `packages/core/router`, `packages/core/lophn-agent`, `packages/core/apps`, `packages/protocol`
  - 앞 task: `project-docs/plan/reactor-remove/tasks/rr-reactor.md`(`callsReact`, domain event, Reactor가 없다)
  - 코드(줄은 main `15f282fcd`. 다른 계획 `agent-definition`의 ad-discovery와 ad-fields도 `prepare.ts`를 고친다. 그쪽이 먼저 main에 land했으면 줄 대신 `noticeText`라는 이름으로 찾는다)
    - `packages/protocol/lophn-agent/calls.ts` 25-34(`fromSchemas`, 28-29 program 갈래), `inputs.ts` 50-52(`receivedEnvelopeSchema` 위 주석), `input-tags.ts` 18(`INPUT_TAG_ATTRIBUTES.reaction`)
    - `packages/core/router/model.ts` 37(`event` 주석), 99-107(`failureInput`), `ports.ts` 53
    - `packages/core/lophn-agent/run-loop/input-text.ts` 32-43(`fromText`), 95-102(`reaction` 태그), `receivedText` 151-192; `input-text_test.ts` 68-89; `work.ts` 133-136(취소 알림); `prepare.ts` 255-270(`noticeText`, 258 `from`)
    - `packages/core/lophn-agent/places/messages.ts` 41-55(`from_ref` 쓰기)
    - `packages/core/lophn-agent/session/model.ts` 95-122(`messages` 표, check 112, step `lophn-agent.sessions.tables`), 357-363(`receivedMessageOf`)
    - coding: `packages/core/apps/coding/close-call.ts`(머리 주석 2, 봉투의 `from` 40), `events.ts` 49-72(`messageReceived`의 call 없는 `from` 66). ae-builds가 `closeCall`의 `seq` 입력을 이미 지웠다.
    - `opening_context`(만드는 곳은 모두 null을 넘긴다: `packages/core/main/daemon/wiring/router.ts` 288, `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts` 243, `tests/support/core/human.ts` 139, `packages/core/lophn-agent/places/directory.ts` 81의 `opening: null`)
      - protocol: `packages/protocol/lophn-agent/sessions.ts` 52-63(`openingTargetSchema`, `openingContextFields`, `openingContextSchema`, `openingContextOutputSchema`와 "toast에서 연 첫 context" 주석), 80(`sessionFields.opening_context`), 102(`openSession` input); `agent-sessions.ts` 16-17(import), 34(`agentSessionSchema`), 52(`openAgentSession` input)
      - `packages/core/lophn-agent/session/model.ts` 58-59(칸), 78(check), 84-85(`sessions_identity_immutable` trigger의 칸 목록), 161-162(`AgentSessionRow`), 175(`SESSION_COLUMNS`), 191-192(`sessionRowOf`), 267-270(읽기 모양), 406-410(`eventExists`. 부르는 곳은 열기뿐이다)
      - `packages/core/lophn-agent/session/commands.ts` 35(`eventExists` import), 65-73(`sameOpening`), 107-129(`open`의 같은 id 비교, event 확인, `startSession`의 `opening`)
      - `packages/core/lophn-agent/session/fork.ts` 102-111(`opening` 이어받기), `places/lifecycle.ts` 67-114(`OpeningContext`, `startSession` 입력 75, insert 칸 99·113-114), `places/directory.ts` 78-82
      - `packages/core/lophn-agent/session/history_test.ts` 31
- 계약:
  - 쓰는 것: `CallFrom`(`packages/protocol/lophn-agent/calls.ts`), `RoutedInput`(`packages/core/router/ports.ts`)
  - 내놓는 것: `CallFrom`의 program 갈래는 `{ kind: "program" }`이다. 받은 메시지 기록에서 program의 `from_ref`는 null이다. `<lophn-reaction>` 태그의 속성은 `event` 하나다. program 보낸 쪽의 태그 글은 `from="program"`이다. 입력 종류 `reaction`과 `event` 칸은 남는다. session 읽기 모양과 `openAgentSession`·`openSession` input에 `opening_context`가 없고, `sessions` 표에 `opening_source_seq`·`opening_target`이 없다. `startSession` 입력에 `opening`이 없다.

## 할 일

근거: README "목표". 근거 event가 없으니 그 seq를 실을 곳이 없다. rr-reactor 뒤 program 입력은 Router의 늦은 실패 알림(`failureInput`), 취소 알림(`work.ts`), 도구 바뀜 알림(`prepare.ts`), coding session 끝 알림(`close-call.ts`)이고 모두 `event_seq: "0"`을 싣는다.

1. protocol
   - `calls.ts`: program 갈래를 `obj(strict, { kind: z.literal("program") })`로 한다. 28줄 주석 "근거 domain event의 seq다"를 "program이 낸 입력(늦은 실패 알림, 취소 알림, 도구 바뀜 알림, coding session 끝 알림)이다"로 고친다. `seqSchema` import가 안 쓰이면 지운다.
   - `input-tags.ts`: `INPUT_TAG_ATTRIBUTES.reaction`을 `["event"]`로 한다.
   - `inputs.ts` 50-52 주석의 "event는 reaction의 event type"을 "event는 reaction이 알리는 사실 이름"으로 고친다.
2. Router: `model.ts`의 `failureInput` `from`(107)을 `{ kind: "program" }`으로, 37줄 주석을 "reaction이면 그 사실 이름"으로, 99줄 주석의 "(근거 seq 없음)"을 지운다. `ports.ts` 53줄 주석도 37줄과 같다.
3. run-loop
   - `input-text.ts`: `fromText`의 program은 `"program"`이다. `reaction` 갈래(95-102)에서 `seq` 속성과 그 계산을 지운다.
   - `work.ts` 133-136: 주석 "취소 알림은 … 근거 seq가 없다"를 지우고 `from`을 `{ kind: "program" }`으로 한다. `prepare.ts` 258도 `from`만 같게 한다.
   - `input-text_test.ts` 68: `program`을 `{ kind: "program" }`으로 맞춘다. 이 test는 받은 turn의 글과 뒤 이력의 글이 같은지 본다. 판정은 그대로 둔다.
   - 정한 것: 입력 종류 `reaction`, 태그 `<lophn-reaction event="…">`, 받은 메시지의 `event` 칸은 남긴다. 남는 쓰임은 coding session 끝 알림 하나다(`packages/core/apps/coding/close-call.ts`, `event: "CodingSessionEnded"`). 이유: 이름을 바꾸면 입력 종류(`inputs.ts`의 `routedInputKindSchema`), 태그, 받은 메시지 기록(`messages.event`)이 같이 움직인다. coding agent 연결을 얼마나 남길지가 보류라(roadmap `problem-ticket.md` "정할 것" 1) 그때 같이 정한다(README "정한 것"). `PRODUCT_INSTRUCTIONS`(`packages/core/agent-roles/roles/prompts.ts`)에는 `<lophn-reaction>` 설명 줄이 이미 없다(`ae-builds`). 고치지 않는다.
4. 받은 메시지 기록
   - `places/messages.ts`: program이면 `from_ref`에 null을 쓴다.
   - `session/model.ts`: `messages` 표의 check `(from_kind = 'human') = (from_ref is null)`(112)을 `(from_kind in ('human', 'program')) = (from_ref is null)`로 고친다. step `lophn-agent.sessions.tables`를 그 자리에서 고친다. migration을 만들지 않는다. step hash가 바뀌어 옛 개발 data root는 뜨지 않으니 지우고 새로 만든다(AGENTS.md "호환성").
   - `receivedMessageOf`(357-363): program이면 `{ kind: "program" as const }`다. 위 주석 "program은 근거 event seq"를 고친다.
5. `opening_context`를 지운다. 근거: 만드는 곳이 모두 null을 넘기고, 가리키던 "toast에서 연 사건"(events 표 seq)의 길이 없다. 읽는 곳도 같은 id로 다시 열 때의 비교와 fork의 이어받기뿐이다.
   - protocol `sessions.ts`: `openingTargetSchema`, `openingContextFields`, `openingContextSchema`, `openingContextOutputSchema`와 그 주석, `sessionFields`와 `openSession` input의 `opening_context`를 지운다. `agent-sessions.ts`: import와 `agentSessionSchema`·`openAgentSession` input의 `opening_context`를 지운다. 안 쓰게 된 import(`seqSchema` 등)를 지운다.
   - `session/model.ts`: `sessions` 표의 `opening_source_seq`, `opening_target` 칸과 check, `sessions_identity_immutable` trigger의 칸 목록에서 둘을 지운다. 같은 step(`lophn-agent.sessions.tables`)을 4와 함께 그 자리에서 고친다. `AgentSessionRow`, `SESSION_COLUMNS`, `sessionRowOf`, 읽기 모양의 `opening_context`, `eventExists`를 지운다.
   - `session/commands.ts`: `sameOpening`과 event 확인을 지운다. 같은 id로 다시 열면 agent만 비교한다. `startSession`에 `opening`을 넘기지 않는다.
   - `places/lifecycle.ts`: `OpeningContext`, `startSession`의 `opening` 입력, insert의 두 칸을 지운다. `session/fork.ts`와 `places/directory.ts`는 `opening`을 넘기지 않는다.
   - 부르는 쪽 한 줄씩: `packages/core/main/daemon/wiring/router.ts` 288, `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts` 243, `tests/support/core/human.ts` 139, `session/history_test.ts` 31에서 `opening_context`를 뺀다.
6. coding: `close-call.ts` 봉투의 `from`(40)과 `events.ts` `messageReceived`의 call 없는 `from`(66)을 `{ kind: "program" }`으로 한다. `close-call.ts` 2줄 주석의 "domain event는 없다"를 뺀다(domain event라는 갈래가 없어졌다). `event: "CodingSessionEnded"`(54)는 그대로 둔다(3의 정한 것).
7. compile 오류가 가리키는 곳(`from.event_seq`나 `opening_context`를 읽는 곳)을 모두 고친다. 소유 밖이면 고치지 말고 file:줄을 보고한다(main `15f282fcd`에는 위 목록 밖에 없다. shell은 program을 `{ kind: "program", label: null }`로만 그린다: `agent-tab-core-source-thread.ts` 128-129, `agent-tab-data.ts` 74-75).

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(바뀐 schema step이 새 data root에서 돈다).
- renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음. 보낸 쪽 칸 하나와 늘 null인 session 칸을 지운다. 받은 turn과 뒤 이력이 같은 글을 만드는지는 기존 `input-text_test.ts`가 본다.
- 남지 않음
  - `git grep -n "event_seq" -- packages tools tests/support`가 `packages/core/lophn-agent/tools/{model.ts,commands.ts}`의 `tool_call_supplements.event_seq`(events 표 seq를 가리키는 다른 칸)뿐이다.
  - `git grep -n "program:\${\|근거 domain event\|근거 seq" -- packages`가 0줄이다.
  - `git grep -n -i "domain event" -- packages tools`가 0줄이다.
  - `git grep -n "\"seq\"" -- packages/protocol/lophn-agent/input-tags.ts`가 0줄이다.
  - `git grep -n "opening_context\|opening_source_seq\|opening_target\|openingContext\|sameOpening\|eventExists\|OpeningContext" -- packages tools tests/support`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- check 밖에 남은 것: `tests/e2e`, `tests/eval`, check 밖 `tests/support`에서 `event_seq`나 `opening_context`를 쓰는 file 목록
- 정한 것: 문서에 답이 없어 worker가 정한 것(할 일 3의 정한 것을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
