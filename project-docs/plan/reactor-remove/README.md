# reactor-remove: 반응할 domain event가 없으니 Reactor를 지운다

- **목표:** Reactor, cursor, reaction 멱등 key, 정의만 남은 domain event `CodingSessionEnded`와 그 type·schema·commit publisher를 지운다. program call의 `from.event_seq`를 없앤다. coding session의 끝은 이미 그 command가 맡긴 call을 바로 닫고, 꺼졌던 사이의 것은 켤 때 Router의 call 복구가 닫는다(`ae-builds`).
  - ae-builds가 남긴 것: test 자식의 죽은 갈래를 지우고, release 준비 실패 이유가 고칠 곳을 가리키게 한다(`project-docs/products/change-log/0.6.0.md`의 "후속" 첫 두 줄).
- **재료:**
  - roadmap `project-docs/products/roadmap/problem-ticket.md`의 "정한 것(agent)"의 "Reactor를 지운다", "coding session 끝은 하나다", "지우는 것" 표의 Reactor 줄, "단계"의 `reactor-remove`
  - 앞 계획: `project-docs/products/change-log/0.6.0.md`의 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다"(coding 연결 장치가 `packages/core/apps/coding/`으로 옮겨졌고, 끝을 아는 command가 같은 tx에서 call을 닫는다. `DOMAIN_EVENTS`에 `CodingSessionEnded`만 남았다. "후속"의 `reactor-remove` 줄)
  - architecture: `event.md`(Bus와 Reactor, domain event의 셋 갈래), `agent-call.md`(program call, coding session의 끝), `coding-agent.md`, `place-session.md`(session을 여는 길)
  - `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`의 events, router, coding-agent
  - 이슈: `project-docs/issues/code-health.md`의 "test runner를 지운 뒤 test 자식의 갈래가 남았다"(`rr-test-child`), `project-docs/issues/activation.md`의 "release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다"(`rr-prepare-reasons`)
- **범위 밖:**
  - `events` 표 자체. 앱 상태 기록(`AppStarted` 등)과 compare token이 쓴다(roadmap).
  - Bus와 남지 않는 event(toast, 화면 갱신)
  - coding session의 끝과 켤 때 call 닫기의 동작. `ae-builds`가 끝냈다. 이 계획은 봉투의 `from`만 줄인다.
  - coding agent 연결의 크기(보류. `problem-ticket.md` "정할 것" 1)
  - eval과 e2e test(사람)
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `rr-`로 시작한다.
- **시작 조건:** `ae-builds`(main `15f282fcd`)와 `approval-simplify`가 land했다. 바로 연다. `agent-definition`과는 순서가 상관없다(roadmap "단계"). 두 계획이 같이 고치는 file: `packages/core/lophn-agent/run-loop/prepare.ts`(rr-program-from ↔ ad-discovery, ad-fields), `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-fake-source.ts}`, `tools/wireframes/pages/screens/agent.tsx`, `packages/design/wording/catalog/conversation.ts`와 생성물 `conversation.placeholders.ts`(rr-screens ↔ ad-commands), `packages/core/lophn-agent/register.ts`(rr-test-child의 `workers: []` 한 줄 ↔ ad-discovery, ad-commands). 같이 돌면 `status.py ready`가 소유가 겹치는 task를 함께 띄우지 않고(wording catalog는 겹쳐도 띄운다), 뒤에 merge하는 쪽이 줄을 다시 본다.
- **brief의 기준:** brief는 main `15f282fcd`(2026-10-21, `ae-builds` land 뒤) 기준으로 썼고, path와 줄 번호는 그 commit에서 확인했다. coding 쪽 일을 맡던 `rr-coding-end`는 `ae-builds`가 다 해서 지웠다. 남은 `CodingSessionEnded` 정의는 `rr-reactor`가 지운다. ae-builds가 남긴 것을 맡는 `rr-test-child`와 `rr-prepare-reasons`는 main `083e55064`에서 더했고, 그 commit까지 코드는 `15f282fcd`와 같아 줄 번호도 같다.

## 정한 것

roadmap `problem-ticket.md`의 "정한 것(agent)"을 따른다. 아래는 이 계획에서 더 정한 것이다(agent, 2026-10-21).

- **남은 domain event를 모두 지운다.** `ae-builds` 뒤 남은 것은 정의만 있는 `CodingSessionEnded` 하나이고 `tx.emit`으로 쓰는 곳이 없다(test 둘뿐). 근거: `architecture/event.md` "domain event는 그 뒤에 꼭 움직여야 하는 일에만". 받는 쪽이 같은 tx에서 움직일 수 있으면 event가 필요 없다.
- **coding session의 끝은 그 command가 같은 tx에서 맡긴 call을 닫는다.** `ae-builds`가 이미 그렇게 했다(event 없이. `packages/core/apps/coding/sessions.ts`의 `endSession`이 `close-call.ts`의 `closeCall`을 부른다. 띄운 뒤 끝나거나 띄우기가 실패한 session은 `done`, 줄에서 띄우지 못한 call은 `failed(receiver_ended)`). 맡긴 App Engineer에게 마지막 메시지와 함께 알리는 것은 Router의 `route`로 넣는 reaction 입력이다. 이 계획은 그 동작을 바꾸지 않는다.
- **꺼졌던 사이에 끝난 coding session의 call은 Router의 켤 때 call 복구(`RecoverCalls`)가 닫는다.** `ae-builds`가 그렇게 두었다(`packages/core/apps/coding/recover.ts`는 call을 닫지 않는다). coding call은 turn이 가져가는 입력이 아니라 `consumed = 0`이라(`markConsumed`를 부르는 곳은 lophn session의 turn 시작뿐이다) `packages/core/router/store.ts`의 `lost`에 걸린다. coding 쪽 sweep을 따로 두지 않는다. 근거: 같은 사실을 두 길이 알리게 된다. roadmap의 "켤 때 sweep"은 이 복구다.
- **입력 종류 `reaction`, `<lophn-reaction>` tag, `messages.event` 칸은 남기고 `seq`만 지운다.** 남은 쓰임이 coding session 끝 알림 하나다(`close-call.ts`가 `event: "CodingSessionEnded"`를 싣는다. domain event가 아니라 받는 turn에 보이는 사실 이름이다). 이름을 바꾸면 입력 종류, 태그, 받은 메시지 기록이 같이 움직여서 coding agent 연결의 크기가 정해질 때 함께 본다. 지금은 Router가 `coding_agent`로 가는 call을 거절해(`ae-builds`) 이 알림이 나가는 길이 쓰이지 않는다(`AGENT-ROLE.md` R3).
- **Diagnostics의 `events` 점검을 지운다.** Reactor 연결만 보던 점검이고, events 표 읽기는 `ledger` 점검이 이미 본다. `issues/platform.md`의 "events 점검이 Reactor backoff를 보지 못한다"가 같이 닫힌다.
- **session을 여는 길은 "사람과 Router 둘"이 된다.** `architecture/place-session.md`의 "사람, Router(call의 새 session), program(reaction)"을 고친다. program 알림(coding session 끝)도 Router의 `route`가 연다(`open_session_or_new`). Reactor가 따로 여는 길(`session-opening.ts`)은 `ae-builds`가 지웠다.
- **session의 `opening_context`(`opening_source_seq`, `opening_target`)를 지운다.** 값을 넣는 곳이 없다(core와 shell 모두 null). event seq를 session에 다는 같은 갈래라 `rr-program-from`이 한다.
- **정의만 남은 `CodingSessionEnded`를 Reactor와 함께 지운다(`rr-reactor`).** `DOMAIN_EVENTS`가 비면 Reactor와 commit publisher의 type이 서지 않아 `ae-builds`가 남겼다. `close-call.ts`의 `event: "CodingSessionEnded"` 문자열은 이 정의를 읽지 않으므로 그대로 둔다(위 `reaction` 줄).
- **domain event 표나 type을 비워 두지 않는다.** 읽는 곳이 없어지면 type, schema, wiring을 지운다. 옛 schema step은 그 자리에서 고치거나 지운다(AGENTS.md "호환성").
- **"lophn이 꺼진 사이 끝난 coding session의 call이 켤 때 한 번만 닫힌다"는 위험 test를 이 계획에서 쓰지 않는다.** 그 test는 `reactor_test.ts`의 coding 몫을 대신하려던 것이다. `ae-builds`가 Reactor의 coding handler를 이미 지웠고, `reactor_test.ts`는 자리표 event로 Reactor cursor만 본다. 이 계획은 `RecoverCalls`와 `recoverCoding`을 바꾸지 않는다.
- **test 자식의 죽은 갈래를 지운다(`rr-test-child`).** `issues/code-health.md` "test runner를 지운 뒤 test 자식의 갈래가 남았다"의 정한 것을 따른다: 켜는 곳이 없어 잃는 기능이 없는 죽은 코드다(AGENTS.md "속도"). lophn runtime의 mode는 `"live" | "preview"`만 남는다. SDK host(`cap-store`의 `openStore({ host })` 등)의 `"test"`는 앱이 자기 test에서 임시 DB를 여는 공개 입력이라 남긴다(agent). `XDG_RUNTIME_DIR`은 앱 socket 폴더가 쓰므로 두고 `DBUS_SESSION_BUS_ADDRESS`만 core env에서 뺀다. 이슈가 하나로 적은 `workers`는 실제로 둘(team 등록의 `workers`, wiring의 `Built.workers`)이고 둘 다 지운다. API server의 worker route 통로(늘 `unavailable`인 `packages.guide` 포함)는 이슈 밖이라 둔다. `packages/core/storage/ledger/`와 wiring `context.ts`를 rr-reactor가 고쳐 wave 2다.
- **release 준비 실패 이유가 고칠 곳을 가리키게 한다(`rr-prepare-reasons`).** (agent, 2026-10-21) 셋 다 한다: 각각 작고 App Engineer가 고칠 곳을 모르면 같은 실패를 되풀이한다(`issues/activation.md` "release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다"의 "고치려면": migration 단계와 SQLite 오류 글, deno stderr의 앞 몇 줄, 빠지거나 더해진 tool 이름과 schema 차이). 덧붙이는 글은 몇 줄·몇백 자로 자른다. build는 blueprint 평가에 더해 화면 build와 의존 받기도 같은 꼴로 붙인다(셋 다 code만 남고 고칠 것이 deno 출력에만 있다). activation의 `migration_failed` summary는 바꾸지 않는다: data job 자식의 결과가 core에 닿기 전에 지워져(`packages/core/main/app-supervisor/data-runner.ts`) data job protocol과 activation port를 같이 바꿔야 하고, 같은 단계 SQL은 준비 검사가 먼저 돌린다.

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다. `rr-reactor`와 `rr-prepare-reasons`(wave 1, 소유가 겹치지 않는다)가 끝난 뒤 `rr-program-from`, `rr-screens`, `rr-test-child`(wave 2, 선행 `rr-reactor`)가 돈다. wave 2의 셋은 소유가 겹치지 않는다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh reactor-remove`다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill).
- 다 끝나면
  - 문서: `architecture/event.md`(흐름 그림의 Reactor 줄, "domain event" 갈래와 21줄의 `CodingSessionEnded`, "지키는 것"의 domain event 절과 "Bus와 Reactor" 절, "왜 이 모양인가"의 Reactor 줄), `agent-call.md`(22줄 "program(근거 domain event seq)", 55줄 "reaction의 event type"), `place-session.md`(13·31줄 session을 여는 길)
  - `project-docs/boundary-catalog.yaml`의 `events` 설명("domain event의 기록과 배달"), `project-docs/context-component-registry.yaml`의 `architecture-event` 설명("domain event와 agent event가 기록되고 배달되는 길")
  - `ae-builds`가 이미 맞춘 것(고치지 않는다): `coding-agent.md`(끝나는 길과 켤 때 복구), `activation.md` 70줄(지운 옛 계기를 말하는 이유 줄), `AGENT-ROLE.md` R3, catalog의 `router` 설명("program의 반응(reaction)"은 남는다)
  - 이슈: `issues/event.md`(머리 글만 남았고 주제가 Reactor다)를 정리하고, `issues/platform.md`의 events 점검 이슈를 닫는다(`issue` skill).
  - 이슈: `issues/code-health.md`의 "test runner를 지운 뒤 test 자식의 갈래가 남았다"(rr-test-child)와 `issues/activation.md`의 "release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다"(rr-prepare-reasons)를 닫는다(`issue` skill). rr-prepare-reasons의 "알려진 미완 동작"으로 오는 activation `migration_failed` summary(단계와 SQLite 오류 글이 없다)는 `issues/activation.md`에 새 이슈로 남긴다.
  - 문서(rr-test-child): `architecture/testing.md` 51줄 끝의 "`DBUS_SESSION_BUS_ADDRESS`는 주지 않는다"를 지운다(core가 그 env를 더 읽지 않는다). rr-prepare-reasons는 문서를 고치지 않는다: reason의 모양을 적은 architecture 문서가 없다(`activation.md`, `app-call.md`).
  - roadmap `problem-ticket.md`에서 land된 것을 지운다. `reactor-remove`가 그 roadmap의 마지막 단계지만 "정할 것" 1(coding agent 연결의 크기)이 열려 있어 file은 지우지 않고 그 항목과 근거만 남긴다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
