# ap-reaction

남은 reaction은 `ReleaseActivationFailed` 하나다(problem-remove). reaction 설정을 `off | on`으로 바꾸고, 새 일 handler가 approvals(Gate, 보류 request, applier)를 거치지 않고 설정만 보게 한다. 설정 화면은 `ui-design` skill로 gallery부터 맞춘다.

- 단위: reaction (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/approvals/approvals_test.ts`
  - `tools/wireframes/pages/screens/settings.tsx`
  - `packages/protocol/approvals/grants.ts`(reaction 몫만)
  - `packages/core/approvals/gate/gate.ts`(reaction 줄만)
  - `packages/core/approvals/gate/gate_test.ts`(reaction 줄만)
  - `packages/core/events/reactor/session-opening.ts`
  - `packages/core/main/daemon/wiring/router.ts`
  - `packages/shell/renderer/desktop/settings/reactions/`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 제품 결정: `project-docs/plan/approval-simplify/README.md` "정한 것"의 "reaction 설정은 `off | on`이다"(`ask`가 없어 보류 request 길이 필요 없다). roadmap `project-docs/products/roadmap/approval.md`의 "reaction" 절과 "정한 것(agent)"의 "reaction은 `off | on`이다"
  - 앞 계획: `project-docs/products/change-log/0.6.0.md`의 "problem 모델과 reaction 다섯을 지우고, 앱 log를 앱마다 file로 남긴다". `REACTION_EVENT_TYPES`는 `["ReleaseActivationFailed"]`이고 설정 key는 `reactions.release_activation_failed` 하나다. `AppRestartHalted`와 `KindViolationFound`는 남지 않는 event가 되어 reaction 설정이 없다. 아래 file과 줄은 main `8c243da91` 기준이다.
  - architecture: `project-docs/architecture/event.md`의 "domain event"(새 일 event만 reaction grant로 끌 수 있다)와 "왜 이 모양인가" 끝 줄(새 일 handler가 approvals를 거친다), `project-docs/architecture/approval.md`의 흐름 그림(Reactor 새 일 handler → judge → 보류 request). 둘 다 지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `approvals`, `config`, `router`; `project-docs/module-catalog.yaml`의 `packages/core/events`, `packages/core/approvals`, `packages/core/main`
  - 화면: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙"의 토글 자리), `.claude/skills/wording/SKILL.md`("key를 지우기 전에"). gallery page `new-settings-reactions`(`tools/wireframes/pages/screens/settings.tsx`, `tools/wireframes/pages/screens/settings-pages.tsx`의 `SettingsReactions`)는 `packages/shell/renderer/desktop/dev-mock/admin.ts`의 `mockSettingsPanels`가 주는 `fakeReactions`로 renderer의 `ReactionsPanel`을 그린다.
  - 코드
    - `packages/core/events/reactor/session-opening.ts`(`NewWorkDeps`, `handlerFor`, `intentOf`, `sendKey`, `applier`, `registerNewWorkHandlers`)
    - `packages/core/main/daemon/wiring/router.ts`(`registerNewWorkHandlers`를 부르는 곳, `eventsConnection`과 `start`의 사람 메시지 되돌리기)
    - `packages/core/main/daemon/wiring/context.ts`(`settings` slot은 config wiring이 build에서 낸다. `packages/core/main/daemon/assembly.ts`의 목록에서 `configWiring`이 `routerWiring`보다 앞이다)
    - `packages/protocol/approvals/grants.ts`(`REACTION_MODES`, `reactionModeSchema`, `DEFAULT_REACTION_MODE`, `reactionGrantSchema`, `reactionSettingKey`)
    - `packages/core/approvals/grants/reaction-settings.ts`(`reactionSettings`), `packages/core/approvals/grants/grants.ts`의 `reactionGrant`(설정을 읽는 본보기)
    - `packages/core/approvals/gate/gate.ts`의 `case "reaction"`, `packages/core/approvals/gate/gate_test.ts`의 reaction 줄
    - `packages/shell/renderer/desktop/settings/reactions/`(`source.ts`, `model.ts`, `core-source.ts`, `reactions-panel.tsx`, `testdata/fake-source.ts`)
    - 본보기: `packages/shell/renderer/desktop/settings/general/general-panel.tsx`의 boolean 줄(`Switch`), `packages/design/components/input/mod.ts`의 `Switch` 설명 줄
    - `packages/core/config/store.ts`의 `parse`(모양이 틀린 값이 하나라도 있으면 `settings.json`을 통째로 거절한다)
- 계약:
  - 쓰는 것: `reactionSettings`(`packages/core/approvals/grants/reaction-settings.ts`. key는 그대로 `reactions.<snake_case event>`), `SettingsReader`(`packages/protocol/config/mod.ts`)
  - 내놓는 것: `REACTION_MODES = ["off", "on"]`, `DEFAULT_REACTION_MODE = "on"`. `registerNewWorkHandlers` deps에 `approvals`가 없고 `settings: SettingsReader`가 있다. Approvals에 `"reaction"` applier를 등록하는 곳이 없다. reaction intent와 reaction grant 판정은 남지만 부르는 곳이 없다(ap-ask-turn과 ap-cleanup이 지운다). reaction 선언과 type은 approvals에 남긴다(`ae-builds`가 reaction을 지운다).

## 할 일

근거: README "정한 것"의 reaction 줄, roadmap "reaction" 절(event 종류마다 `off | on`, `ask`를 지운다). reaction 목록과 화면 줄은 이미 `ReleaseActivationFailed` 하나다.

1. `packages/protocol/approvals/grants.ts`
   - `REACTION_MODES`를 `["off", "on"] as const`로 바꾸고 export한다. `DEFAULT_REACTION_MODE`는 `"on"`이다. 위 주석("끔, 열고 묻지 않음, 물음")을 맞춘다.
   - `REACTION_EVENT_TYPES`, `reactionGrantSchema`, `reactionSettingKey`는 그대로 둔다.
2. `packages/core/events/reactor/session-opening.ts`
   - `NewWorkDeps`에서 `approvals`와 `events`를 지우고 `settings: SettingsReader`를 더한다.
   - `handlerFor`의 `handle`: `deps.settings.get(reactionSettings[type]) ?? DEFAULT_REACTION_MODE`가 `"off"`면 `ok(undefined)`, 아니면 `send(deps, event)`다. `reactionSettings`는 `packages/core/approvals/mod.ts`가 export한다(`packages/core/main/daemon/wiring/setting-declarations.ts`가 같은 길로 가져온다).
   - `intentOf`, `applier`, `registerNewWorkHandlers` 끝의 `deps.approvals.registerApplier("reaction", ...)`를 지운다. 안 쓰이게 된 import(`ApplyResult`, `Intent`, `PendingApproval`, `domainEventSchema`, `Approvals`, `err`)를 지운다.
   - 머리 주석(off·open·ask, 보류 request)과 `sendKey` 주석("허락 뒤 applier 경로가 같은 key를 쓴다")을 지금 동작에 맞춘다.
3. `packages/core/main/daemon/wiring/router.ts`
   - `registerNewWorkHandlers(ctx.reactor, { router: reaction, settings: ctx.settings, agentOfApp })`로 부른다(404-409). `approvals: ctx.approvals`, `events: createEventsReader(...)`와 `createEventsReader` import(53)를 뺀다. `eventsConnection`은 `start`가 쓰므로 남긴다.
   - 주석 "Reactor가 시작하기 전에 등록해야 해서 events가 아니라 approvals 뒤인 여기서 한다"를 맞춘다(설정은 앞선 config wiring이 낸다).
4. 옛 Gate의 reaction 줄(`packages/core/approvals/gate/gate.ts`의 `case "reaction"`): `off`면 지금처럼 `deny reaction_off`, 아니면 `RUN`이다. `ASK` 갈래를 지운다. 이 줄을 부르는 곳은 없어지지만 남긴다(계약).
   - `packages/core/approvals/gate/gate_test.ts`의 reaction 줄: grant 값 `open`을 `on`으로 바꾸고 `ask` 경우를 지운다. `off`와 `on` 두 경우가 남는다.
5. `packages/core/approvals/approvals_test.ts`의 가짜 `reactionGrant`가 `"open"`을 써서(166) type 오류가 난다. 그 값만 `"on"`으로 바꾼다.
6. Settings › Reactions 화면(`ui-design` skill). gallery는 renderer component를 fake source로 그리므로 아래 renderer와 testdata를 고치면 gallery page `new-settings-reactions`가 따라온다.
   - `reactions/source.ts`: `REACTION_MODES`를 `["off", "on"]`으로, 주석("끔, 열고 묻지 않음, 물음")을 맞춘다.
   - `reactions/model.ts`: `DEFAULT_MODE`는 `"on"`이다. `MODE_OPTIONS`를 지운다. `modeOf`는 저장값이 `"off"`면 `"off"`, 그 밖은 `"on"`이다. 머리 주석을 맞춘다.
   - `reactions/reactions-panel.tsx`: 줄의 `Select`를 design `Switch`(`@lophn/ui/input`)로 바꾼다. 본보기는 `general-panel.tsx`의 boolean 줄이다(`label`은 `settings.label.value-on`·`settings.label.value-off`, `checked`, `onCheckedChange`). 자리는 지금 `lineControl`(줄 오른쪽 고정 열)이다.
     - 정한 것: `Switch`를 쓴다. 이유: 두 값이고 고르면 바로 저장된다. `packages/design/components/input/mod.ts`는 "누르는 즉시 켜고 끄는 설정"에 `Switch`를 쓰게 한다.
     - `Skeleton`의 `lines`를 남는 줄 수에 맞추고, 머리 주석("다섯마다 Off, Open without asking, Ask")을 맞춘다.
     - 아래 문단(`settings.note.reactions-ask`): Ask 설명 문장을 지운다. 둘째 문장(App Engineer에게 맡긴 일을 닫는 event는 목록에 없고 늘 그 App Engineer에게 간다)은 남길 안내라 새 key(예: `settings.note.reactions-unlisted`)로 옮긴다.
   - `reactions/testdata/fake-source.ts`의 `SAMPLE_MODES`는 `off`·`on`만 쓴다. 정한 것: `{ ReleaseActivationFailed: "off" }`로 두어 gallery에서 기본과 다른 줄을 보인다(지금 주석 "화면 확인용 대표 값"의 뜻).
   - `packages/shell/renderer/desktop/dev-mock/admin.ts`: `SAMPLE_MODES` 이름이 그대로면 고칠 것이 없다.
   - gallery page 설명(`tools/wireframes/pages/screens/settings.tsx`의 `new-settings-reactions` description, "다섯마다 Off, Open without asking, Ask")을 남은 event 하나의 켬·끔으로 고친다.
7. wording(`wording` skill), `packages/design/wording/catalog/workspace-settings.ts`
   - 지운다: `settings.label.reaction-off`, `settings.label.reaction-open`, `settings.label.reaction-ask`, `settings.note.reactions-ask`. 지우기 전에 앞부분(`settings.label.reaction-`, `settings.note.reactions`)으로 `packages`와 `tools`를 grep해 template 호출이 없는지 본다.
   - 더한다: 6의 새 note key.
   - `settings.intro.reactions`: 끝 문장("By default lophn opens the session without asking.")을 "기본은 켬"이라는 뜻으로 고친다. 묻기 말을 남기지 않는다.
   - `deno task wording`으로 placeholders를 다시 만들고 `deno run --allow-read tools/check-wording.ts`를 돈다.
8. 지우거나 바꾼 이름과 값을 grep해 주석과 오류 메시지에 남은 것을 고친다: reaction 몫의 `"open"`·`"ask"`, `Open without asking`, `reactions-ask`, `registerApplier("reaction"`, `createPending`(session-opening), "보류 request"(session-opening과 router wiring의 reaction 주석).

정한 것: 옛 값(`open`, `ask`)을 읽는 장치를 두지 않는다. 옛 값이 든 `settings.json`은 config store의 load가 통째로 거절한다(`packages/core/config/store.ts`의 `parse`). 개발 data는 지우고 새로 만든다(AGENTS.md "호환성"). problem-remove가 지운 reaction 다섯의 key도 같은 길이다.

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- `deno task wireframes`가 되고, gallery `new-settings-reactions`가 `Switch` 줄로 그려진다.
- core 확인: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(router wiring이 `ctx.settings` slot을 읽는다).
- 위험 test: 없음. reaction은 사용자 data, 권한, secret, sandbox 경계에 닿지 않고(`.claude/skills/write-test/SKILL.md` "쓸지 정하기"), 남은 하나도 `ae-builds`가 지운다. 옛 Gate의 reaction 줄은 `gate_test.ts`가 계속 본다.
- 남지 않음
  - `grep -n "Approvals\|createPending\|registerApplier\|applier" packages/core/events/reactor/session-opening.ts`가 0줄이다.
  - `grep -rn "\"open\"\|\"ask\"\|reaction-open\|reaction-ask\|reactions-ask" packages/shell/renderer/desktop/settings/reactions`가 0줄이다.
  - `grep -rn "Open without asking\|settings.label.reaction-ask\|settings.note.reactions-ask" packages`가 0줄이다.
  - `grep -n "\"open\"" packages/protocol/approvals/grants.ts`가 0줄이다(`"ask"`는 agent grant 몫에 남는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없음이면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: `packages/core/events/reactor/store.ts`의 `EventsReader.at`(applier만 썼다). 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
