# dk-event

project의 kind 위반이 새로 생기면 그 project의 Project Manager(PM) session을 여는 domain event `KindViolationFound`를 더한다. 옛 `ContextViolationFound`는 지우지 않고 옆에 둔다(wave 3의 `dk-delete-protocol`이 지운다. 이 event를 내는 옛 context 코드가 아직 있다).

코드 이름은 아직 `project`·`project_manager`다.

- 단위: event (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/events/domain.ts`
  - `packages/protocol/approvals/grants.ts`
  - `packages/core/events/reactor/session-opening.ts`
  - `packages/core/approvals/approvals_test.ts`
  - `packages/core/approvals/gate/gate_test.ts`
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`
- 추가 소유(wording catalog는 key를 더하기만 한다. 다른 task도 같은 file에 key를 더한다):
  - `packages/design/wording/catalog/data.ts`
  - `packages/design/wording/catalog/data.placeholders.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것"(위반), AGENT-ROLE E5(`project-docs/products/AGENT-ROLE.md` 6절)
  - architecture: `project-docs/architecture/event.md`(domain event, Reactor, 새 일을 여는 event)
  - 본보기: 지금 `contextViolationFound`(`packages/protocol/events/domain.ts:49`), 그 반응 `callOf`의 `case "ContextViolationFound"`(`packages/core/events/reactor/session-opening.ts:84`)
- 계약:
  - 쓰는 것: `defineEvent`(`packages/protocol/base/event.ts:29`)
  - 내놓는 것: `kindViolationFound` event, 타입 `"KindViolationFound"`. subject는 `idSchema("prj")`, payload는 `z.strictObject({ project: idSchema("prj"), count: z.number().int().min(1) })`(`count`는 이번 호출에서 새로 열렸거나 다시 열린 위반 수). 새 일을 여는 event이고(reaction grant로 끌 수 있다) 기본은 `open`이다.

## 할 일

1. `packages/protocol/events/domain.ts`: `kindViolationFound`를 더하고 `DOMAIN_EVENTS`, `domainEventSchema` union, `DOMAIN_EVENT_KINDS`(`"new_work"`)에 넣는다. 파일 끝의 `NewWorkTypes`·`ReactionEventType` 대조(`_newWorkMatchesReactions`)가 맞아야 한다.
2. `packages/protocol/approvals/grants.ts`: `REACTION_EVENT_TYPES`에 `"KindViolationFound"`, `reactionGrantSchema`에 같은 key를 더한다. `reactionSettingKey`가 `reactions.kind_violation_found`를 만든다(고치지 않는다).
3. `packages/core/events/reactor/session-opening.ts`: `callOf`에 `case "KindViolationFound"`를 더한다. 받는 쪽은 `{ kind: "new_session", agent: { role: "project_manager", project: event.payload.project } }`, 본문은 program이 쓴 고정 영어 한 문장(`"New kind violations were found in this project. Read them with kind.check."`), `refs: []`. `registerNewWorkHandlers`에 `reactor.on("KindViolationFound", handlerFor("KindViolationFound", deps))`를 더한다. 옛 `ContextViolationFound` 줄은 그대로 둔다. 같은 file을 `domain-place`(App Engineer reaction을 PM으로)도 고친다. 이 줄만 더하고 다른 줄은 건드리지 않는다.
4. 반응 설정이 key 목록을 정확히 요구하는 test(`packages/core/approvals/approvals_test.ts:169` 근처, `packages/core/approvals/gate/gate_test.ts:22` 근처의 `ReleaseActivationFailed: "open"` 줄이 있는 reaction grant 객체)에 `KindViolationFound: "open"`을 더한다. `ContextViolationFound` 줄은 그대로 둔다.
5. shell이 `ReactionEventType`으로 색인하는 곳이 있어 type이 깨진다: `packages/shell/renderer/desktop/connection/waiting/model.ts`의 `EVENT_LABELS`(≈:102)에 `KindViolationFound: "waiting.label.event-kind-violation"`을 더하고, 같은 file의 reaction 카드(≈:334)가 PM으로 보는 조건(`event === "ContextViolationFound"`)에 새 event도 넣는다. wording `packages/design/wording/catalog/data.ts`에 `"waiting.label.event-kind-violation": "A kind rule was broken"`을 더하고 `deno task wording`으로 `data.placeholders.ts`를 다시 만든다(손으로 고치지 않는다). 설정 화면 줄과 toast는 이 task가 만들지 않는다(wave 3의 `dk-chips-reactions`가 옛 줄을 새 줄로 바꾼다).
6. 이 event를 내는 쪽은 만들지 않는다(`dk-problem-core`가 `tx.emit(kindViolationFound, …)`을 쓴다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(event 정의와 반응 한 줄. 반응이 PM에게 가는 길은 기존 handler가 이미 검증한다).
- 남지 않음: 해당 없음(옛 event를 아직 지우지 않는다). `rg -n "KindViolationFound" packages`에 domain.ts, grants.ts, session-opening.ts, 두 test, waiting/model.ts, wording data만 나온다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`packages/protocol/events/mod.ts`가 `domain.ts`를 이미 `export *`하는지 확인하고 아니면 적는다)
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: shell 쪽 최소 수정(waiting/model.ts), wording key 하나
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 설정 화면에 새 event 줄과 toast가 아직 없다(wave 3에서 만든다).
