# pr-reactions

program이 agent를 부르는 reaction 여섯 가운데 다섯(`ProblemOpened`, `ProblemReopened`, `AppRestartHalted`, `KindViolationFound`, `PublicToolsChanged`)을 지운다. toast만 쓰는 `AppRestartHalted`와 `KindViolationFound`는 남지 않는 event로 옮기고, `PublicToolsChanged`는 내지 않는다(막기 자체는 그대로). `ReleaseActivationFailed`와 reaction 설정 화면은 남는다.

- 단위: reactions (wave 2)
- 선행: pr-check-exclude.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/router.ts`
  - `packages/protocol/approvals/grants.ts`
  - `packages/protocol/events/domain.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/events/reactor/session-opening.ts`
  - `packages/core/events/reactor/reactor_test.ts`
  - `packages/core/approvals/grants/reaction-settings.ts`
  - `packages/core/approvals/grants/grants.ts`
  - `packages/core/approvals/approvals_test.ts`
  - `packages/core/approvals/gate/gate_test.ts`
  - `packages/core/storage/ledger/domain-event_test.ts`
  - `packages/core/lophn-agent/run-loop/input-text_test.ts`
  - `packages/core/apps/runtime/commands.ts`
  - `packages/core/apps/releases/commands.ts`
  - `packages/core/problems/domain/commands.ts`
  - `packages/core/problems/domain/commands_test.ts`
  - `packages/core/problems/reporting/commands.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/daemon/wiring/events.ts`
  - `packages/shell/renderer/desktop/connection/events/reactions.ts`
  - `packages/shell/renderer/desktop/connection/toasts`
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`
  - `packages/shell/renderer/desktop/connection/waiting/fake-source.ts`
  - `packages/shell/renderer/desktop/settings/reactions`
  - `packages/shell/renderer/workspace/reactions`
  - `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`
  - `packages/design/wording` (key만)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("지키는 것"의 domain event·Bus와 "domain event로 사람 화면을 갱신하지 않는다"), `project-docs/architecture/approval.md`(reaction grant와 Gate), `project-docs/architecture/agent-call.md`(reaction은 program이 보내는 call)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `approvals`, `app-runtime`, `app-releases`, `problems`, `shell`, `project-docs/module-catalog.yaml`의 `packages/core/events`, `packages/core/approvals`, `packages/core/apps`, `packages/core/main`, `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것 > agent"의 reaction 다섯 줄, `project-docs/products/roadmap/problem-ticket.md`의 "program이 agent를 부르지 않는다"
  - 본보기(코드): `packages/protocol/events/transient.ts`(`AppViewChanged` 정의), `packages/protocol/events/bus.ts`(type 이름은 domain·agent·남지 않는 event 사이에서 겹치지 않는다), `packages/core/storage/ledger/after-commit.ts`(`afterCommit`, `withAfterCommit`), `packages/core/apps/tickets/coding/events.ts`(command가 commit 뒤 할 일을 topic으로 모으는 본보기), `packages/core/main/daemon/wiring/apps.ts`의 `AppViewSignal`(남지 않는 event를 Bus로 내는 본보기)
  - 본보기(화면): `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`(toast 그림), `.claude/skills/wording/SKILL.md`("key를 지우기 전에")
- 계약:
  - 쓰는 것: Bus의 `publish`(`packages/core/main/daemon/wiring/context.ts`의 `bus`), `appRecordUnavailable`(`packages/protocol/apps/runtime.ts`)의 crash loop 사유 code
  - 내놓는 것:
    - `REACTION_EVENT_TYPES = ["ReleaseActivationFailed"]`, `reactionGrantSchema = { ReleaseActivationFailed }`(`packages/protocol/approvals/grants.ts`). 설정 key는 `reactions.release_activation_failed` 하나가 남는다.
    - domain event에서 지운다: `ProblemOpened`, `ProblemReopened`, `AppRestartHalted`, `KindViolationFound`, `PublicToolsChanged`(정의 `problemOpened`, `problemReopened`, `appRestartHalted`, `kindViolationFound`, `publicToolsChanged`와 `domainEventSchema`·`DOMAIN_EVENT_KINDS`의 줄)
    - 남지 않는 event(`packages/protocol/events/transient.ts`, envelope `{ type, subject, at, payload }`, seq 없음)
      - `AppRestartHalted`: subject `app` id, payload `{ release: rel id, crashes: int ≥ 1 }`. 사유 code가 crash loop인 `app.record_unavailable`이 commit된 뒤 core가 Bus로 낸다.
      - `KindViolationFound`: subject `dom` id, payload `{ domain: dom id, count: int ≥ 1 }`. `count`는 앞 sync 결과에 없던 위반 수다. 내는 쪽은 `pr-kinds-toast`다.
    - toast(`reactionsOf`)는 위 두 남지 않는 event를 듣는다. toast id는 seq 대신 subject와 `at`으로 만든다.
    - `<lophn-reaction>`과 Reactor, `ReleaseActivationFailed` reaction은 그대로다.

## 할 일

1. reaction 목록(`packages/protocol/approvals/grants.ts` 101-125): `REACTION_EVENT_TYPES`를 `["ReleaseActivationFailed"]`로, `reactionGrantSchema`를 `z.strictObject({ ReleaseActivationFailed: reactionModeSchema })`로 줄인다. `reactionSettingKey`는 그대로다.
2. domain event(`packages/protocol/events/domain.ts`): `problemOpened`(19-22), `problemReopened`(24-27), `appRestartHalted`(29-35), `kindViolationFound`(49-56), `publicToolsChanged`(58-68) 정의와 `DOMAIN_EVENTS`(117-130), `domainEventSchema`(150-163), `DOMAIN_EVENT_KINDS`(169-182)의 그 줄을 지운다. 끝의 `_newWorkMatchesReactions` type 검사가 `ReleaseActivationFailed` 하나로 맞는지 type check로 본다.
3. 남지 않는 event(`packages/protocol/events/transient.ts`): `defineTransientEvent`로 둘을 더하고 `transientEventSchema`에 넣는다. 정의 위에 누가 언제 내는지 주석 한 줄씩 둔다.
   - `AppRestartHalted`: subject `idSchema("app")`, payload `z.strictObject({ release: idSchema("rel"), crashes: z.number().int().min(1) })`. crash loop 기록이 commit된 뒤 core가 낸다.
   - `KindViolationFound`: subject `idSchema("dom")`, payload `z.strictObject({ domain: idSchema("dom"), count: z.number().int().min(1) })`. kinds dispatcher가 앞 sync에 없던 위반을 볼 때 낸다(`pr-kinds-toast`).
   - 2와 3은 같은 commit이어야 한다. `busEventSchema`(`packages/protocol/events/bus.ts`)는 domain event와 남지 않는 event의 type 이름이 겹치지 않는다는 규칙 위에 있다.
4. 재시작 멈춤을 남지 않는 event로 낸다.
   - `packages/core/apps/runtime/commands.ts`의 `recordUnavailable`(239-268): crash loop일 때의 `tx.emit(appRestartHalted, …)`(251-256)를 `tx.port(afterCommit).push(APP_RESTART_HALTED_TOPIC, event)`로 바꾼다. `event`는 남지 않는 event 봉투 `{ type: "AppRestartHalted", subject: input.app, at: tx.now(), payload: { release: input.release, crashes: CRASH_LIMIT + 1 } }`다. 내는 조건(`sameAsLast`가 아니고 reason code가 `CRASH_LOOP_CODE`)은 그대로다. `APP_RESTART_HALTED_TOPIC`(값 `"app_restart_halted"`)은 이 file이 export한다. `afterCommit`은 `packages/core/storage/ledger/after-commit.ts`에서 가져온다(`packages/core/apps/tickets/coding/events.ts`와 같은 길). `appRestartHalted` import(18)를 지운다. 250줄 주석("domain event로도 남긴다")을 고친다.
   - `packages/core/main/daemon/wiring/apps.ts` build의 `writer`(296-303): 가장 바깥을 `withAfterCommit(…, apply)`로 감싼다. apply는 topic이 `APP_RESTART_HALTED_TOPIC`인 action만 `AppViewSignal`처럼 `ctx.peek.bus?.publish(action.data as BusEvent)`로 내고 다른 topic은 건드리지 않는다(router·coding wiring의 applier가 같은 목록을 따로 본다).
   - `packages/core/main/daemon/wiring/events.ts`는 고칠 것이 없으면 두지 않는다.
5. 공개 tool 바뀜을 내지 않는다(`packages/core/apps/releases/commands.ts`). 막기는 그대로다.
   - `blockActivation`(268-298): emit loop(289-296)를 지우고 `return ok({ blocked: blocked.value.length > 0 })`로 줄인다. 268줄 주석의 "App Engineer를 부를 event를 낸다"를 지운다. `blockedToolsOf`로 막고 `BLOCKED_MESSAGE`로 거절하는 곳(248-250, 490-492)은 그대로다.
   - `completeActivation`: `changeNoticesOf` 호출(343-345)과 emit loop(381-388)를 지우고 302줄 주석의 "tool 선언이 바뀌었으면 PublicToolsChanged를 낸다"를 지운다. import에서 `publicToolsChanged`(27)와 `changeNoticesOf`(58)를 뺀다.
   - `changeNoticesOf`(`packages/core/apps/releases/public-tools.ts`, 소유 밖)는 쓰는 곳이 없어진다. 지우지 않고 보고한다.
6. problem 쪽에서 event 내기를 지운다. 표 쓰기는 그대로다(그 module은 `pr-problems-core`가 지운다).
   - `packages/core/problems/reporting/commands.ts`: import(14-17)와 `tx.emit(problemReopened, …)`(159-162), `tx.emit(problemOpened, …)`(183)을 지운다.
   - `packages/core/problems/domain/commands.ts`: `kindViolationFound` import(12)와 86-93줄(`found` 계산과 emit)을 지운다. `commands_test.ts`는 깨지지 않으면 그대로 둔다.
7. Reactor handler(`packages/core/events/reactor/session-opening.ts`): `agentOf`(46-61)와 `callOf`(64-128)에서 다섯 갈래를, `registerNewWorkHandlers`에서 다섯 `reactor.on`(212-214, 219-220)을 지운다. `agentOf`가 await 없는 async가 되면 lint(`require-await`)에 걸리니 동기 함수로 바꾸거나 `send`에서 바로 부른다. `NewWorkDeps.agentOfDomain`(36-38)은 쓰는 곳이 없어지므로 지운다.
   - 그것을 넘기는 `packages/core/main/daemon/wiring/router.ts`의 `agentOfDomain` 상수(241-244)와 넘기는 줄(413)은 이 task 소유 밖이다(뼈대 문제로 lead에게 올렸다). lead가 소유를 더하지 않았으면 그 두 곳만 빼는 넘길 줄로 하고 보고한다. `ownerOfDomain`·`agentOfOwner`는 343줄이 계속 쓰니 둔다.
8. test를 남는 event로 옮긴다. 보는 것(판정, 같은 tx, cursor)은 그대로다.
   - `packages/core/events/reactor/reactor_test.ts`(47-51, 101, 115): `problemOpened`을 남는 domain event로 바꾼다(payload가 작은 `ticketVerified`: subject `tx.newId("tkt")`, payload `{ app: tx.newId("app") }`). `tx.newId("prb")`(48)와 `tx.newId("rpt")`(50)를 없앤다. `pr-cleanup`이 id 접두사 `prb`를 지우면 `newId("prb")`가 type 오류가 된다.
   - `packages/core/storage/ledger/domain-event_test.ts`(9, 67-71, 89): 같은 식으로 바꾼다. states 행 id(67)와 event subject(68)의 `tx.newId("prb")`, payload의 `tx.newId("rpt")`(70)를 남는 접두사(`tkt`, `app`)로 바꾼다.
   - `packages/core/approvals/approvals_test.ts`(164-172), `packages/core/approvals/gate/gate_test.ts`(18-25): reaction grant 값을 `{ ReleaseActivationFailed: … }` 하나로 줄인다. gate_test의 reaction 세 줄(170-177)은 `ReleaseActivationFailed` 하나에 grant 값을 open·off·ask로 바꿔 가며 같은 판정(run, deny `reaction_off`, ask)을 본다. `grants()` helper가 reaction grant를 받게 하든 줄마다 덮어쓰든 가벼운 쪽으로 한다.
   - `packages/core/lophn-agent/run-loop/input-text_test.ts`(74, 83): `"ProblemOpened"`을 `"ReleaseActivationFailed"`로 바꾼다.
9. toast(`packages/shell/renderer/desktop/connection/events/reactions.ts`): `AppRestartHalted`·`KindViolationFound`는 이제 남지 않는 event라 `seq`가 없다. toast id를 `${event.subject}:${event.at}`로 만든다.
   - 재시작 멈춤 toast의 action은 그대로 `{ kind: "session", session: null, app }`(앱 공간을 연다). 74줄 주석의 "반응이 여는 App Engineer session"을 지금 동작으로 고친다.
   - kind 위반 toast는 action을 두지 않는다(아래 정한 것). 82줄 주석을 고친다. `packages/shell/renderer/desktop/connection/toasts/toast-text.ts`는 action이 없으면 단추 글을 싣지 않으니 kind 위반 갈래에서 단추 key를 쓰지 않게 한다.
   - `packages/shell/renderer/workspace/reactions/toast-handler.ts`(29줄)와 `project-manager.ts`(34-35줄)의 주석에서 reaction이 연 session·계약 위반 toast 이야기를 지금 동작대로 고친다. `openProjectManager`는 시작 route가 쓰니 그대로 둔다.
10. reaction 설정과 대기 목록을 `ReleaseActivationFailed` 하나로 줄인다.
    - `packages/shell/renderer/desktop/settings/reactions/source.ts`의 `REACTION_EVENTS`(8-15), `model.ts`의 `REACTION_ROWS`(17-54)·`DEFAULT_MODES`(78-85)와 71줄 주석의 예(`ProblemOpened`)를 고친다. `testdata/fake-source.ts`의 `SAMPLE_MODES`를 `{ ReleaseActivationFailed: "ask" }`로 바꾼다(`packages/shell/renderer/desktop/dev-mock/admin.ts`가 쓴다).
    - `packages/shell/renderer/desktop/connection/waiting/model.ts`의 `EVENT_LABELS`·`OPENS_LABELS`(103-119), `waiting/fake-source.ts`의 `REACTION`(249-253) target event를 `ReleaseActivationFailed`로 바꾼다.
11. wireframe(`tools/wireframes/pages/screens/waiting/waiting-pages.tsx` 66-81): 두 fake event에서 `seq`와 `actor`를 빼 남지 않는 event 모양으로 맞춘다.
12. wording(`packages/design/wording/catalog/data.ts`, `workspace-settings.ts`). 지우기 전에 앞부분(`waiting.toast-`, `waiting.label.event-`, `settings.reaction`)으로 template 호출을 grep한다(`reactions.ts`가 `` `waiting.toast-${kind}.title` ``을 만든다).
    - 지운다: `waiting.label.event-problem-opened`, `waiting.label.event-problem-reopened`, `waiting.label.event-app-restart-halted`, `waiting.label.event-kind-violation`, `waiting.label.event-public-tools-changed`, `waiting.label.agent-domain-owner`, `waiting.toast-kind-violation.button`, `settings.label.reaction-problem-opened`, `settings.label.reaction-problem-reopened`, `settings.label.reaction-restart-halted`, `settings.label.reaction-kind-violation`, `settings.label.reaction-public-tools-changed`, `settings.reaction.problem-opened-when`, `settings.reaction.problem-reopened-when`, `settings.reaction.restart-halted-when`, `settings.reaction.kind-violation-when`, `settings.reaction.public-tools-changed-when`, `settings.reaction.opens-domain-owner`
    - 값을 바꾼다: `waiting.toast-restart-halted.button` "Open session" → "Open app"
    - `deno task wording`, `deno run --allow-read tools/check-wording.ts`
13. 주석: `packages/core/approvals/grants/reaction-settings.ts` 13줄의 "선언 다섯"을 고친다. `grants.ts`는 목록에서 값을 만들어 고칠 것이 없으면 두지 않는다.

## 정한 것

- 재시작 멈춤은 command가 `afterCommit` topic으로 모으고 apps wiring이 commit 뒤 Bus로 낸다. 이유: Bus에 내는 것은 반드시 commit 뒤다(`event.md`). 이미 있는 commit 뒤 할 일 장치를 쓰고 새 길을 만들지 않는다.
- kind 위반 toast는 행동 단추가 없다. 이유: 단추가 열던 대기 목록에 그 일(reaction 물음)이 더는 없고, domain에서 그릇을 찾는 길이 renderer에 없다.
- 재시작 멈춤 toast의 단추 글을 "Open app"으로 바꾼다. 이유: 단추는 이미 앱 공간을 열고, 열 session이 없다.

## 끝남

- `deno task check`가 통과한다. 화면을 건드렸으니 `deno run -A packages/shell/renderer/build.ts`와 `deno task wireframes`도 된다.
- 위험 test: 없음. gate_test의 reaction 판정(open, off, ask)은 남는 `ReleaseActivationFailed` 하나로 옮겨 그대로 지킨다.
- 남지 않음:
  - `grep -rn -E "ProblemOpened|ProblemReopened|PublicToolsChanged|problemOpened|problemReopened|publicToolsChanged" packages tools --include=*.ts --include=*.tsx | grep -v packages/protocol/problems/`가 0줄이다(`packages/protocol/problems/problem-record.ts`의 주석은 `pr-cleanup`이 file째 지운다).
  - `grep -n -E "newId\(\"(prb|rpt)\"\)" packages/core/events/reactor/reactor_test.ts packages/core/storage/ledger/domain-event_test.ts`가 0줄이다.
  - `grep -rn -E "tx\.emit\((appRestartHalted|kindViolationFound)" packages`가 0줄이고, `grep -n -E "AppRestartHalted|KindViolationFound" packages/protocol/events/domain.ts packages/protocol/approvals/grants.ts`가 0줄이다.
  - `grep -rn -E "event-problem|event-app-restart-halted|event-kind-violation|event-public-tools|agent-domain-owner|reaction-problem|reaction-restart-halted|reaction-kind-violation|reaction-public-tools|opens-domain-owner|toast-kind-violation\.button|(problem-opened|problem-reopened|restart-halted|kind-violation|public-tools-changed)-when" packages tools --include=*.ts --include=*.tsx`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `changeNoticesOf`(`packages/core/apps/releases/public-tools.ts`)와 그것만 쓰던 함수
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(`packages/core/main/daemon/wiring/router.ts`의 `agentOfDomain`을 뺐으면 여기)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 둘을 확인해 적는다: 다른 domain이 쓰는 공개 tool을 지운 release는 막히지만 App Engineer가 알 길이 없다(`ae-builds`가 release 준비의 알림으로 바꾼다), kind 위반 toast는 `pr-kinds-toast`가 merge될 때까지 뜨지 않는다.
