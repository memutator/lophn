# reactor-remove: 반응할 domain event가 없으니 Reactor를 지운다

- **목표:** Reactor, cursor, reaction 멱등 key와 남은 domain event를 지운다. coding session의 끝은 그 command가 맡긴 call을 바로 닫고, 꺼졌던 사이의 것은 켤 때 sweep이 닫는다. program call의 `from.event_seq`를 없앤다.
- **재료:**
  - roadmap `project-docs/products/roadmap/problem-ticket.md`의 "정한 것(agent)"의 "Reactor를 지운다", "coding session 끝은 하나다", "지우는 것" 표의 Reactor 줄, "단계"의 `reactor-remove`
  - architecture: `event.md`(Bus와 Reactor, domain event의 셋 갈래), `agent-call.md`(program call, coding session의 끝), `coding-agent.md`, `place-session.md`(session을 여는 길)
  - `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`의 events, router, coding-agent
- **범위 밖:**
  - `events` 표 자체. 앱 상태 기록(`AppStarted` 등)과 compare token이 쓴다(roadmap).
  - Bus와 남지 않는 event(toast, 화면 갱신)
  - coding agent 연결의 크기(보류. `problem-ticket.md` "정할 것" 1)
  - eval과 e2e test(사람)
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `rr-`로 시작한다.
- **시작 조건:** `ae-builds`가 land했다. ticket·activation·reaction event를 지운다. `approval-simplify`(`ApprovalDecided`를 지움)는 land했다.
- **brief의 기준:** brief는 main `dd956b49f`(2026-10-21) 기준으로 썼다. `ae-builds`가 지울 것은 그 계획의 brief가 말하는 land 뒤 모양을 기준으로 하고 "앞 계획 land 뒤 path 확인"을 달았다. `ae-builds`가 land하면 planner가 path와 계약을 다시 맞춘 뒤 연다.

## 정한 것

roadmap `problem-ticket.md`의 "정한 것(agent)"을 따른다. 아래는 이 계획에서 더 정한 것이다(agent, 2026-10-21).

- **앞 두 계획 뒤 남는 domain event를 모두 지운다.** 남는 것이 coding session의 끝 하나라면 그것도 event가 아니라 command 안의 call 닫기가 된다. 근거: `architecture/event.md` "domain event는 그 뒤에 꼭 움직여야 하는 일에만". 받는 쪽이 같은 tx에서 움직일 수 있으면 event가 필요 없다.
- **coding session의 끝은 그 command가 같은 tx에서 맡긴 call을 닫는다.** 맡긴 App Engineer에게 마지막 메시지와 함께 알리는 것은 지금처럼 Router의 call 닫기 알림이다. 근거: `coding/close-call.ts`에 event 없이 닫는 길이 이미 있다.
- **꺼졌던 사이에 끝난 coding session의 call은 Router의 켤 때 call 복구(`RecoverCalls`)가 닫는다.** coding call은 `consumed = 0`이라 이미 거기에 걸린다. coding 쪽 sweep을 따로 두지 않는다. 근거: 같은 사실을 두 길이 알리게 된다. `ae-builds`가 coding call을 consumed로 바꾸면 그때만 `recoverCoding`이 닫는다(`rr-coding-end`).
- **입력 종류 `reaction`, `<lophn-reaction>` tag, `messages.event` 칸은 남기고 `seq`만 지운다.** 남은 쓰임이 coding session 끝 알림 하나다. 이름을 바꾸면 제품 지침과 화면까지 고쳐야 해서 coding agent 연결의 크기가 정해질 때 함께 본다.
- **Diagnostics의 `events` 점검을 지운다.** Reactor 연결만 보던 점검이고, events 표 읽기는 `ledger` 점검이 이미 본다. `issues/platform.md`의 "events 점검이 Reactor backoff를 보지 못한다"가 같이 닫힌다.
- **"사람, Router, Reactor 셋이 session을 연다"는 "사람과 Router 둘"이 된다.** `architecture/place-session.md`를 고친다.
- **session의 `opening_context`(`opening_source_seq`, `opening_target`)를 지운다.** 값을 넣는 곳이 없다(core와 shell 모두 null). event seq를 session에 다는 같은 갈래라 `rr-program-from`이 한다.
- **domain event 표나 type을 비워 두지 않는다.** 읽는 곳이 없어지면 type, schema, wiring을 지운다. 옛 schema step은 그 자리에서 고치거나 지운다(AGENTS.md "호환성").

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다. coding session의 끝을 command로 옮긴 뒤 Reactor를 지운다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh reactor-remove`다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill).
- 다 끝나면
  - 문서: `architecture/event.md`(Reactor와 domain event를 지운 모양), `agent-call.md`, `place-session.md`, `coding-agent.md`, `activation.md`(Reactor가 cursor로 다시 읽는다는 줄), `agent-definition.md`(reaction의 `event` 속성)
  - `project-docs/products/AGENT-ROLE.md`: R3(reaction을 domain event로 정의)와 Reactor를 말하는 줄
  - `project-docs/boundary-catalog.yaml`의 `events`("domain event의 기록과 배달")와 `router`("Reactor 반응") 설명, `module-catalog.yaml`의 Reactor와 router 설명
  - 이슈: `issues/event.md`(주제가 Reactor다)를 정리하고, `issues/platform.md`의 events 점검 이슈를 닫는다(`issue` skill).
  - roadmap `problem-ticket.md`에서 land된 것을 지운다. 세 계획이 다 land했으면 그 roadmap file을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
