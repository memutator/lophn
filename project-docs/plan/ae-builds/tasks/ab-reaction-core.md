# ab-reaction-core

남은 reaction `ReleaseActivationFailed`와 reaction 설정을 지운다. activation 실패는 `release.activate`를 부른 App Engineer에게 결과로 돌아간다(ab-release-activate). program이 agent를 부르지 않는다(README "`release.activate`의 결과", roadmap "program이 agent를 부르지 않는다"). Reactor 자체와 `callsReact`는 남긴다(`reactor-remove`의 rr-reactor가 지운다).

정한 것(flesh): `DomainEventKind`와 그 표 `DOMAIN_EVENT_KINDS`를 통째로 지운다. 이유: 표를 읽는 곳은 `new_work` type 대조(`NewWorkTypes`, `_newWorkMatchesReactions`)뿐이다. 그것을 지우면 표는 아무도 읽지 않는 죽은 코드이고 `deno lint`의 `no-unused-vars`가 떨어진다(확인함). 남는 갈래(`call_closing`, `program`)를 읽는 코드는 없다.

- 단위: reaction (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/events/reactor/session-opening.ts`(지운다)
  - `packages/core/events/reactor/mod.ts`, `packages/core/events/mod.ts`
  - `packages/core/main/daemon/wiring/{router.ts,setting-declarations.ts}`
  - `packages/protocol/approvals/reactions.ts`(지운다), `packages/protocol/approvals/mod.ts`
  - `packages/core/approvals/reaction-settings.ts`(지운다), `packages/core/approvals/mod.ts`
  - `packages/protocol/events/domain.ts`
  - `packages/core/apps/releases/commands.ts`(`failActivation`의 event 쓰기만)
  - `packages/core/lophn-agent/run-loop/input-text_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것" 가운데 "`release.activate`의 결과"(`ReleaseActivationFailed` reaction과 reaction 설정을 지운다)와 "범위 밖"(Reactor 자체는 `reactor-remove`)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "program이 agent를 부르지 않는다"와 "지우는 것" 표의 첫 줄
  - architecture: `project-docs/architecture/event.md` 21줄(domain event 세 갈래), 34-35줄(새 일 event와 reaction 설정), 70줄. 지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `approvals`, `app-releases`; `project-docs/module-catalog.yaml`의 `packages/core/events`, `packages/core/approvals`, `packages/core/main`
  - 앞 task: `project-docs/plan/ae-builds/tasks/ab-reaction-screen.md`(wave 1. Settings › Reactions 화면과 그 문구를 지웠다)
  - 같은 wave 뒤 task: `ab-release-activate`(`releases/commands.ts`, `packages/protocol/apps/activation/activation.ts` 27줄의 `ReleaseActivationFailed` 주석)가 이 task 뒤에 같은 file을 고친다. 그 몫은 건드리지 않는다. `ab-coding-detach`는 domain event를 두지 않고 `domain.ts`를 고치지 않는다(맡긴 coding session 끝 알림의 `<lophn-reaction event>` 글은 `"CodingSessionEnded"`다).
  - 코드(줄은 main `dd956b49f`)
    - `packages/core/events/reactor/session-opening.ts` 전체(95줄. `registerNewWorkHandlers`, `ReactionRouter`, reaction 설정 읽기)
    - `packages/core/events/reactor/mod.ts` 4-7, `packages/core/events/mod.ts` 20, 24
    - `packages/core/main/daemon/wiring/router.ts`: import 52-55, 200줄 주석, 379-407(381-383의 `openConnection`은 남긴다. `start`의 받은 사람 메시지 되돌리기 450-501이 쓴다), `agentOfApp` 211-220(annotation 배달 326이 쓰므로 남는다), `callsReact` 47·73·149(남는다)
    - `packages/core/main/daemon/wiring/setting-declarations.ts` 5, 16
    - `packages/protocol/approvals/reactions.ts` 전체, `packages/protocol/approvals/mod.ts` 6
    - `packages/core/approvals/reaction-settings.ts` 전체, `packages/core/approvals/mod.ts` 4
    - `packages/protocol/events/domain.ts`: import 5-6, `releaseActivationFailed` 15-25, `DOMAIN_EVENTS` 59, `domainEventSchema` 86, `DomainEventKind`·`DOMAIN_EVENT_KINDS`·`NewWorkTypes`·`Same`·`_newWorkMatchesReactions` 95-117
    - `packages/core/apps/releases/commands.ts`: import 28, `failActivation` 주석 397-398, `tx.emit(releaseActivationFailed, …)` 438-445
    - `packages/core/lophn-agent/run-loop/input-text_test.ts` 75, 84
    - 설정 읽기: `packages/core/config/store.ts` 87-97. settings.json에 선언 없는 key가 하나라도 있으면 file 전체가 `unknown_key`로 거절된다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: domain event `ReleaseActivationFailed`(`releaseActivationFailed`)가 없다. `DomainEventKind`와 `DOMAIN_EVENT_KINDS` 표, reaction 선언과 맞추던 type 대조(`NewWorkTypes`, `_newWorkMatchesReactions`)가 없다. `REACTION_EVENT_TYPES`, `reactionEventTypeSchema`, `ReactionEventType`, `REACTION_MODES`, `reactionModeSchema`, `DEFAULT_REACTION_MODE`, `reactionSettingKey`, `reactionSettings`, Settings 값 `reactions.release_activation_failed`의 선언이 없다. `registerNewWorkHandlers`, `ReactionRouter`와 router wiring의 새 일 등록이 없다. `activation.fail`은 event를 쓰지 않는다(실패 기록과 상태는 그대로). `callsReact` route와 command, `agentOfApp`(annotation 배달도 쓴다)은 남는다.

## 할 일

근거: README "`release.activate`의 결과"의 셋째 줄. 지우는 이름마다 먼저 `git grep -nw <이름> -- packages tools`로 읽는 곳을 본다.

1. 먼저 확인한다. 아래와 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - ab-reaction-screen이 merge됐다: `git ls-files packages/shell/renderer/desktop/settings/reactions`가 0줄이고 `git grep -n "ReleaseActivationFailed\|release_activation_failed" -- packages/shell tools/wireframes`가 0줄이다.
   - `git grep -n "registerNewWorkHandlers\|ReactionRouter\|reactionSettings\|approvals/reactions" -- packages tools`가 위 "코드"의 file 말고 없다.
2. events: `git rm packages/core/events/reactor/session-opening.ts`. `reactor/mod.ts`의 4-7줄과 `events/mod.ts`의 `type ReactionRouter,`·`registerNewWorkHandlers,`를 뺀다.
3. router wiring(`wiring/router.ts`)
   - 52-55의 `ReactionRouter`, `registerNewWorkHandlers` import를 지운다.
   - 384-407(`reaction`과 `registerNewWorkHandlers(...)` 부르기)을 지운다. 381-383의 `openConnection`은 남긴다.
   - 주석을 지금 쓰임으로 고친다: 200줄은 "켤 때 접수만 된 사람 메시지를 다시 읽는 main thread 연결이다.", 379-380줄은 그 연결을 여는 이유 한 줄.
   - `callsReact`는 `ROUTER_CONTEXT`(73)와 본문 준비(149)에 그대로 둔다. 보내는 곳이 없어지므로 보고의 "안 쓰게 된 export"에 적는다(rr-reactor가 지운다).
4. approvals
   - `git rm packages/protocol/approvals/reactions.ts packages/core/approvals/reaction-settings.ts`
   - `packages/protocol/approvals/mod.ts` 6줄, `packages/core/approvals/mod.ts` 4줄을 뺀다.
   - `wiring/setting-declarations.ts`의 `reactionSettings` import(5)와 `...Object.values(reactionSettings),`(16)를 뺀다.
5. `packages/protocol/events/domain.ts`
   - `releaseActivationFailed`(15-25)와 `DOMAIN_EVENTS`(59)·`domainEventSchema`(86)의 그 줄을 지운다.
   - 95-117(`DomainEventKind`, `DOMAIN_EVENT_KINDS`, `NewWorkTypes`, `Same`, `_newWorkMatchesReactions`와 그 주석)을 지운다. 위 "정한 것".
   - import `ACTIVATION_FAILURE_CODES`(5)와 `ReactionEventType`(6)을 지운다. 다른 이름이 안 쓰이게 되면(`EventDefinition` 등) lint가 알려 준다.
6. `packages/core/apps/releases/commands.ts`: import(28), `failActivation`의 `tx.emit(releaseActivationFailed, …)`(438-445)를 지운다. 397-398 주석에서 "그 앱의 App Engineer를 부를 domain event를 같은 transaction에 쓴다"를 뺀다(실패 근거와 이전 활성 참조를 남기는 것, 복원 확인 규칙은 남긴다). 그 밖의 줄은 ab-release-activate의 몫이다.
7. `input-text_test.ts` 75·84줄의 `"ReleaseActivationFailed"`를 `"CodingSessionEnded"`로 바꾼다. 이 칸은 `<lophn-reaction event="…">`의 글(`z.string()`)이고 test는 두 길이 같은 글을 만드는지만 본다. 남는 reaction 입력은 맡긴 coding session의 끝 알림 하나다.
8. 옛 개발 data: worktree의 `.dev-data/`에 `reactions.release_activation_failed`가 든 settings.json이 있으면 `.dev-data/`를 지운다(AGENTS.md "호환성"). 옛 key를 읽는 호환 장치를 만들지 않는다.
9. 아래 "남지 않음"을 돌려 소유 file의 주석과 오류 글에 남은 것을 고친다. 소유 밖에 남은 것은 고치지 않고 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 바꾼 곳의 test: `deno test --no-check -A packages/core/lophn-agent/run-loop/input-text_test.ts packages/core/events packages/core/apps/releases`
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(setting 선언과 router wiring이 바뀐다).
- 위험 test: 없음. 지우기만 한다. activation 실패의 기록과 상태 판정(복원이 있어야 실패로 닫는다)은 바꾸지 않는다.
- 남지 않음
  - `git grep -nwE "ReleaseActivationFailed|releaseActivationFailed|reactionSettings|reactionSettingKey|REACTION_MODES|reactionModeSchema|DEFAULT_REACTION_MODE|reactionEventTypeSchema|ReactionEventType|registerNewWorkHandlers|ReactionRouter|NewWorkTypes|_newWorkMatchesReactions|DOMAIN_EVENT_KINDS|DomainEventKind|new_work" -- packages tools ':!packages/protocol/apps/activation/activation.ts'`가 0줄이다. `activation.ts` 27줄의 주석은 ab-release-activate가 지운다.
  - `git grep -n "REACTION_EVENT_TYPES" -- packages tools ':!packages/shell'`가 0줄이다. renderer toast의 `REACTION_EVENT_TYPES`(`packages/shell/renderer/desktop/connection/events/reactions.ts`)는 이름만 같고 toast가 듣는 event 목록이다. 건드리지 않는다.
  - `git grep -n "reactions\.release_activation_failed\|session-opening\|reaction-settings\|approvals/reactions" -- packages tools`가 0줄이다.
  - `git ls-files packages/core/events/reactor`가 `mod.ts`, `reactor.ts`, `reactor_test.ts`, `store.ts`뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task는 `packages/protocol/approvals/mod.ts`를 직접 고친다. 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 적어도 `callsReact`(`packages/core/router/commands.ts`. 보내는 곳이 없어진다. rr-reactor가 지운다)
- 소유 밖에 남은 것: 적어도 `packages/shell/renderer/desktop/settings/general/model.ts` 66줄의 `"reactions."` 접두사(General에서 감추던 key가 없어진다. 해는 없다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도: 사람의 settings.json에 `reactions.release_activation_failed`가 남아 있으면(Settings › Reactions에서 바꾼 적이 있으면) settings file 전체가 `unknown_key`로 거절되어 다른 설정도 기본값으로 돈다(`packages/core/config/store.ts` 87-97). 호환 장치를 두지 않으므로 lead가 사람에게 그 줄을 지우라고 알린다.
