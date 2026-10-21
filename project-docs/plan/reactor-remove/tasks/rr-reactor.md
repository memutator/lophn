# rr-reactor

Reactor, cursor(`subscriber_cursors`, `AdvanceSubscriberCursor`, cursor CAS), reaction 멱등 key, 정의만 남은 domain event `CodingSessionEnded`와 그 type·schema, commit 뒤 domain event를 Bus로 내는 publisher, 부르는 곳이 없는 `SendReactionCall`(`calls/react`)을 지운다. 그 연결을 보던 Diagnostics `events` 점검도 지운다. `events` 표, `tx.emit`, Bus, Gateway, 남지 않는 event, agent event는 그대로다.

- 단위: reactor (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/events/`
  - `packages/core/storage/ledger/`
  - `packages/protocol/events/{domain.ts,events.ts,bus.ts,mod.ts}`
  - `packages/protocol/registry.ts`
  - `packages/protocol/server/registration.ts`(`Tx.advanceSubscriberCursor`만)
  - `packages/core/main/daemon/wiring/{events.ts,context.ts,router.ts}`
  - `packages/core/router/{commands.ts,mod.ts}`(`callsReact`만)
  - `packages/core/apps/write-link.ts`(`advanceSubscriberCursor` 줄만)
  - `packages/core/apps/control.ts`(`wake` 칸만)
  - `packages/core/lophn-agent/providers/{login.ts,login_test.ts,model-list.ts,model-list_test.ts}`(`wake` 칸만)
  - `packages/core/lophn-agent/usage/commands.ts`(주석만)
- 읽을 것:
  - 계획: `project-docs/plan/reactor-remove/README.md`의 "목표"와 "정한 것"(남은 domain event를 모두 지운다, `CodingSessionEnded`를 Reactor와 함께 지운다, 표나 type을 비워 두지 않는다, Diagnostics의 `events` 점검을 지운다), "범위 밖"(`events` 표, Bus와 남지 않는 event)
  - 앞 계획: `project-docs/products/change-log/0.6.0.md`의 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다". "없어진 것"(domain event 여섯, reaction 설정과 새 일 handler)과 "`DOMAIN_EVENTS`에는 정의만 있는 `CodingSessionEnded` 하나가 남는다"(목록이 비면 Reactor와 commit publisher의 type이 서지 않아 남겼다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표의 Reactor 줄과 그 아래 "domain event 12개는 모두 빠진다. 다만 `events` 표는 …남는다"
  - architecture: `project-docs/architecture/event.md`("흐름", "Bus와 Reactor"). 지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - 이슈: `project-docs/issues/platform.md`의 "events 점검이 Reactor backoff를 보지 못한다". 이 task로 닫힌다(lead가 `issue` skill로 닫는다).
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `storage`, `router`, `diagnostics`; `project-docs/module-catalog.yaml`의 `packages/core/events`, `packages/core/storage`, `packages/core/main`, `packages/core/router`
  - 코드(줄은 main `15f282fcd`)
    - `packages/core/events/`: `reactor/`(`reactor.ts`, `store.ts`, `mod.ts`, `reactor_test.ts`), `subscriber-registration.ts`, `ports.ts`(15-17 주석, 28-45), `mod.ts`(12-28), `bus.ts` 6줄 주석
    - `packages/core/storage/ledger/`: `commit-publisher.ts`, `reaction.ts`, `domain-event_test.ts`, `commands.ts`(7-24), `writer-assembly.ts`(27, 75), `tx.ts`(32, 288-320), `executor.ts`(42, 111, 126, 156, 197, 273, 292-293), `dispatch.ts`(37, 68-73), `command-outcome.ts`(91, 104, `casAgrees` 108-142), `schema.ts`(`common-tables` step의 `subscriber_cursors` 55-58), `writer-message.ts`(28-29 `wake`), `writer.ts`(25-26 주석), `mod.ts`(17, 51-52, 63-65, 70, 97-107, 108-133)
    - `packages/protocol/events/`: `domain.ts`, `events.ts`(78-112), `bus.ts`(4, 8-14, 21), `mod.ts` 3; `packages/protocol/registry.ts`(1, 23); `packages/protocol/server/registration.ts`(49-54)
    - wiring: `packages/core/main/daemon/wiring/events.ts`(전체), `context.ts`(52, 222-223, 282), `router.ts`(`callsReact` import 47, `ROUTER_CONTEXT.scope.operations` 69, `createCallBodyPreparer`의 `callsReact` 갈래 145)
    - `packages/core/router/commands.ts`(`callsReact` 36-52, `reactCommand` 147-177, `ROUTER_COMMANDS` 179-185), `packages/core/router/mod.ts` 15
    - Diagnostics: `packages/core/diagnostics/components.ts`(`ledger` 점검이 표 읽기를 본다)
    - 남는 것: `packages/core/apps/coding/close-call.ts` 54줄 `event: "CodingSessionEnded"`는 domain event를 쓰는 곳이 아니다. Router에 넘기는 reaction 입력의 `event` 칸(받는 turn의 `<lophn-reaction event="…">` 값, `messages.event`에 저장)이고 `DOMAIN_EVENTS`의 type을 읽지 않는다. README "정한 것"대로 사실 이름으로 남긴다. `coding/coding_test.ts` 185와 `lophn-agent/run-loop/input-text_test.ts` 75·84도 같은 값이다.
- 계약:
  - 쓰는 것: `Tx`(`packages/protocol/server/registration.ts`), `busEventSchema`(`packages/protocol/events/bus.ts`)
  - 내놓는 것: `packages/protocol/events/domain.ts`가 없다. `busEventSchema`는 agent event와 남지 않는 event의 union이다. `Tx`에 `advanceSubscriberCursor`가 없다. route `events/advance-cursor`와 `calls/react`가 없다. ledger schema에 `subscriber_cursors`가 없다. `CommandSuccess`에 `wake`가 없다. `casAgrees`는 compare가 객체인지만 본다. `WiringContext`에 `reactor` 칸이 없다. events wiring은 Bus, Gateway frame, `eventNames`만 낸다. core는 `events` component 점검을 내지 않는다(protocol `DIAGNOSTIC_COMPONENTS`의 `"events"`는 rr-screens가 뺀다).

## 할 일

근거: README "정한 것"의 "남은 domain event를 모두 지운다", "정의만 남은 `CodingSessionEnded`를 Reactor와 함께 지운다", "domain event 표나 type을 비워 두지 않는다". main `15f282fcd`에서 Reactor에 handler를 거는 곳은 없다(`git grep -n "ctx\.reactor" -- packages`가 `wiring/events.ts` 38줄 주석뿐이다). `DOMAIN_EVENTS`의 `CodingSessionEnded`를 `tx.emit`으로 쓰는 곳도 없다(test 둘뿐: `reactor_test.ts`, `domain-event_test.ts`). `SendReactionCall`을 부르는 곳도 없다(ae-builds가 새 일 handler를 지웠다). 지우는 이름마다 먼저 `git grep -nw`로 읽는 곳을 본다. 읽는 곳이 check 밖(`tests/e2e`, `tests/eval`, `tools/check.ts`의 `NOT_CHECKED`)에만 남으면 그대로 지우고 보고에 적는다.

1. protocol
   - `packages/protocol/events/domain.ts`를 지운다. `mod.ts`의 export(3줄)를 뺀다. `DomainEvent`, `DomainEventType`, `domainEventSchema`, `DOMAIN_EVENTS`, `codingSessionEnded`를 읽는 곳을 함께 지운다(2, 3, 4).
   - `bus.ts`: `busEventSchema`는 `agentEventSchema`와 `transientEventSchema`의 union이다. 4줄 import를 지우고, 8-9줄 주석("domain event(commit 뒤), agent event, 남지 않는 event 셋")과 21줄 주석("domain, 남지 않는 event")을 맞춘다.
   - `events.ts`: `advanceSubscriberCursor`와 그 input·compare schema, `reactionKeySchema`·`ReactionKey`를 지운다(78-112). `eventsList`(`events/list`)는 events 표 읽기라 남는다.
   - `packages/protocol/registry.ts`: `advanceSubscriberCursor`를 import(1)와 `ROUTES`(23)에서 뺀다.
   - `packages/protocol/server/registration.ts`: `Tx.advanceSubscriberCursor`와 그 주석(49-54)을 지운다.
2. core events
   - `packages/core/events/reactor/` 폴더와 `subscriber-registration.ts`를 지운다.
   - `ports.ts`: `ReactorContext`, `ReactorHandler`, `Reactor`와 domain event import를 지운다. `Bus` 위 쓰는 곳 주석(15-17, "approvals command 층(commit 뒤 domain event와 남지 않는 event)")을 지금 내는 쪽(apps·kinds wiring의 남지 않는 event, run-loop·harness의 agent event, Gateway 구독)으로 고친다.
   - `mod.ts`: 지운 것의 export를 뺀다. `bus.ts` 6줄 주석의 "domain, "을 뺀다.
3. storage/ledger
   - `commit-publisher.ts`, `reaction.ts`, `domain-event_test.ts`를 지운다. `mod.ts`의 그 export(51-52), `LedgerDeps.onCommit`(63-65), `ledger()`의 event 범위 계산과 `onCommit` 부르기(108-133)를 지우고 안 쓰게 된 import(`eventSpan`, `headSeq`, `formatSeq`, `CommandSuccess` 등)를 지운다. 70줄 주석의 "없으면 cursor를 올리지 못한다"와 104줄 오류 글 "subscriber 검사를 사용할 수 없다"를 지금 뜻으로 고친다(`request`는 대상 권한 port가 읽는다. `tx.ts` 332).
   - `commands.ts`: `advanceSubscriberCursorCommand`와 `LEDGER_COMMANDS`를 지운다(`turnDisposition`, `admitAgentTurn`은 남는다). `mod.ts` 17줄 export와 `writer-assembly.ts`(27 import, 75 `[...LEDGER_COMMANDS]`)를 맞춘다. `defineSyncCommand`(`handler.ts`, `mod.ts` 141 export)는 이것만 써서 안 쓰이게 된다. 지우지 말고 보고한다.
   - `tx.ts`: `advanceSubscriberCursor` 구현(288-320)과 `authorizeReactorCursor` import(32)를 지운다.
   - CAS: `command-outcome.ts`의 `casAgrees`는 compare가 객체인지만 본다. `processed_through_seq` 갈래와 `sql`·`input`·`checkCursor` 인자를 지운다. `executor.ts`(import 42, `Session.checkCursor` 111·126, `casAgrees` 부르기 156, `createCommandDispatch`에 넘기는 인자 273, `checkCursor` 292-293)와 `dispatch.ts`(`createCommandDispatch`의 `checkCursor` 37, 부르기 68-73)를 따라 고친다.
   - `schema.ts`: `common-tables` step에서 `subscriber_cursors` 표(55-58)를 지운다. step은 그 자리에서 고친다. migration을 만들지 않는다. step hash가 바뀌어 옛 개발 data root는 뜨지 않으니 지우고 새로 만든다(AGENTS.md "호환성").
   - `CommandSuccess.wake`(`writer-message.ts` 28-29)는 읽는 곳이 없다(commit 뒤 배포기 몫이었다). 칸과 채우는 곳을 지운다: `command-outcome.ts` 91·104, `executor.ts` 197, `mod.ts` 131, `packages/core/apps/control.ts` 949, `packages/core/lophn-agent/providers/login.ts` 193, `model-list.ts` 104, `login_test.ts` 117, `model-list_test.ts` 67.
   - `writer.ts` 25-26 주석("onCommit은 … Bus에 닿는다")을 지운다.
   - `packages/core/apps/write-link.ts` 86줄의 `advanceSubscriberCursor` 대역을 지운다.
   - `packages/core/lophn-agent/usage/commands.ts` 23줄 주석 "executor는 processed_through_seq만 검사하므로"를 "executor는 compare 칸을 검사하지 않으므로"로 고친다.
4. wiring
   - `events.ts`: Bus, Gateway frame, `eventNames`만 낸다. `DOMAIN_EVENTS` import와 `DOMAIN_TYPES`, main thread 연결, `reactorContext`와 `records`, Reactor 만들기와 `ctx.provide("reactor")`, `events` 점검(91-110), `build`의 publisher writer, `start`의 구독과 Reactor 시작, `closeIntake`, `closeWork`를 지운다. 머리 주석(36-38)을 맞춘다.
     - 정한 것: Diagnostics의 `events` 점검을 지우고 대신할 것을 두지 않는다. 이유: 그 점검이 보던 것은 이 wiring의 main thread 연결과 Reactor 시작 여부이고 둘 다 없어진다. events 표 읽기는 `ledger` 점검이 본다. Bus와 Gateway는 core 메모리라 따로 볼 상태가 없다.
   - `context.ts`: `reactor` 칸과 주석(222-223), slot 표의 `reactor: true`(282), `Reactor` import(52).
   - `router.ts`: `callsReact`의 쓰임을 지운다(import 47, `ROUTER_CONTEXT.scope.operations`는 `callsRecover.name`만(69), `createCallBodyPreparer`의 `name === callsReact.name` 갈래(145)).
5. router: `packages/core/router/commands.ts`의 `callsReact`와 `reactCommand`, `ROUTER_COMMANDS`의 그 줄, 안 쓰게 된 import(`seqSchema`, `callToSchema`, `callRefSchema` 등)를 지운다. `packages/core/router/mod.ts` 15줄 export를 맞춘다.
6. 아래 "남지 않음"을 돌려 주석과 오류 글에 남은 것을 고친다.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(새 data root라 바뀐 schema step이 처음부터 돈다).
- 위험 test: 없음. 지우기만 한다. `reactor_test.ts`(Reactor 재시작 이어 읽기, 자리표 event로 돈다)와 `domain-event_test.ts`(publisher가 commit 뒤에만 낸다)는 대상과 함께 지운다. coding session의 끝과 켤 때 call 닫기(Router `RecoverCalls`)는 이 계획이 바꾸지 않는다. coding 끝은 `packages/core/apps/coding/coding_test.ts`가 본다. 지우는 `authorizeReactorCursor`는 cursor와 함께 없어지는 경계라 대신할 test가 없다.
- 남지 않음
  - `git grep -n -i "reactor" -- packages tools tests/support`가 0줄이다.
  - `git grep -nwE "subscriber_cursors|AdvanceSubscriberCursor|advanceSubscriberCursor|processed_through_seq|reactionIdempotencyKey|reactionKeySchema|ReactionKey|createCommitPublisher|checkCursor|DOMAIN_EVENTS|domainEventSchema|DomainEvent|DomainEventType|codingSessionEnded|callsReact|SendReactionCall|createEventsReader|createSqlCursor|LEDGER_COMMANDS" -- packages tools`가 0줄이다.
  - `git grep -nw "onCommit" -- packages/core packages/protocol`가 0줄이다(`packages/shell/renderer/desktop/settings/appearance/appearance-panel.tsx`의 `onCommit`은 React prop이라 다른 것이다).
  - `git grep -n "events/advance-cursor\|calls/react\|wake:" -- packages/core/storage packages/core/apps/control.ts packages/core/lophn-agent/providers packages/protocol`가 0줄이다.
  - `git grep -nw "CodingSessionEnded" -- packages`가 `packages/core/apps/coding/close-call.ts`, `packages/core/apps/coding/coding_test.ts`, `packages/core/lophn-agent/run-loop/input-text_test.ts`뿐이다(reaction의 사실 이름).
  - `git grep -n -i "domain event" -- packages tools`가 `packages/core/apps/coding/close-call.ts` 2, `packages/core/router/model.ts` 37, `packages/core/router/ports.ts` 53, `packages/protocol/lophn-agent/calls.ts` 28뿐이다(rr-program-from이 고친다). 다른 곳에 남으면 file:줄을 보고한다.
  - `git ls-files packages/core/events`가 `bus.ts`, `gateway.ts`, `gateway_test.ts`, `mod.ts`, `ports.ts`뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task는 `packages/protocol/events/mod.ts`와 `packages/protocol/registry.ts`를 직접 고친다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: `defineSyncCommand`, `formatSeq`, `eventSpan`·`headSeq`가 executor 밖에서 안 쓰이게 됐는지
- check 밖에 남은 것: `tests/e2e`, `tests/eval`, check 밖 `tests/support`에서 지운 이름(`DOMAIN_EVENTS`, domain event type, `advanceSubscriberCursor`, `calls/react` 등)을 쓰는 file 목록
- 정한 것: 문서에 답이 없어 worker가 정한 것(할 일 4의 정한 것을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
