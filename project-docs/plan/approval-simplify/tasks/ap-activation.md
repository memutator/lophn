# ap-activation

problem-remove 뒤의 모양을 기준으로 한다. activation 동의를 approvals의 보류 request에서 activation module의 상태("동의 대기")와 사람의 동의 command로 옮기고, activation이 approvals를 부르지 않게 한다. 앱 상세의 activation 줄 표시도 새 phase로 맞춘다.

- 단위: activation (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/register.ts`
  - `packages/core/apps/releases/activation/`
  - `packages/core/apps/releases/{schema.ts,commands.ts,reads.ts}`
  - `packages/core/apps/control.ts`
  - `packages/protocol/apps/activation/activation.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/shell/renderer/app-frame/app-detail/source.ts`
  - `packages/shell/renderer/app-frame/app-detail/versions/versions-tab.tsx`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 제품 결정: `project-docs/plan/approval-simplify/README.md` "정한 것"의 "activation 동의는 activation module의 상태와 사람의 동의 command로 옮긴다"와 "뼈대 검토에서 정한 것"의 "activation 동의 대기는 ledger 표에 둔다"(메모리면 재시작 때 사라지고 Reactor cursor는 `TicketVerified`를 지나 다시 묻지 않는다). roadmap `project-docs/products/roadmap/approval.md`의 "앱 쪽"(동의는 generic approval이 아니다, 대기 목록에 같이 보인다, unattended에서도 사람이 한다)
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `packages/protocol/apps/activation/consent.ts` 몫(`activationConsentSchema`, `activationConsent`, `activationAskConsent`, `activationConsents`, event 이름 둘, phase 이름)
  - architecture: `project-docs/architecture/activation.md`의 "흐름"과 "지키는 것"의 "계기와 묻는 조건"(묻는 조건, 다시 판정해 다시 묻기, 보류 request는 `Approvals` port로만 읽는다)과 "실패와 복구" 끝 줄(더 새 release가 시작되면 이전 release를 기다리던 것을 취소한다). `project-docs/architecture/event.md`의 "Bus와 Reactor"(Bus에는 commit 뒤에만 낸다)와 남지 않는 event 줄. 둘 다 지금 동작이고 동의 부분은 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `approvals`, `events`, `core-api`, `event-stream`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/protocol`
  - 앞 계획: `project-docs/plan/problem-remove/tasks/pr-reactions.md`(이 brief의 `packages/core/apps/releases/commands.ts`, `packages/core/main/daemon/wiring/apps.ts`, `packages/protocol/events/transient.ts`를 고친다), `pr-problems-core.md`·`pr-log-read.md`·`pr-log-writer.md`(`packages/core/apps/control.ts`), `pr-log-view-error.md`(`packages/core/main/daemon/wiring/apps.ts`). 아래 줄과 이름은 앞 계획 land 뒤 path 확인.
  - 코드
    - `packages/core/apps/releases/activation/handler.ts`(`createActivationHandlers`, `judge`, `ticketVerified`, `approvalDecided`, `applier`, `reconsider`), `queue.ts`(`waitApproval`, `dropWaiting`, `list`), `assembly.ts`(`ActivationLate`, `runOne`, `enqueue`, `createActivationHandlers` 조립, `queueEntries`, `sweep`, `requestedRows`, `sendValue`, `ledgerRead`)
    - `packages/core/apps/releases/schema.ts`(`apps.releases.tables`, `activation_requests` 표), `packages/core/apps/releases/commands.ts`(`createReleaseCommands`, `startActivation`, `activatePrevious`가 사람만 받는 본보기, `requireMachine`, `releaseAndApp`), `packages/core/apps/releases/reads.ts`(`createReleaseReads`, `visible`, `createActivationQueueRead`)
    - `packages/core/apps/releases/compare.ts`(`asksFor`), `packages/base`의 `canonicalize`
    - `packages/core/apps/control.ts`(`APPS_CONTROL_CONTEXT`, `SUPERVISOR_OPERATIONS`, `appsOperationPolicies`의 machine activation 목록)
    - `packages/core/main/daemon/wiring/apps.ts`(`activation.attach`, `ctx.reactor.on`, `ctx.approvals.registerApplier`, `writer`)
    - commit 뒤 할 일 본보기: `packages/core/storage/ledger/after-commit.ts`(`afterCommit`, `withAfterCommit`), `packages/core/apps/tickets/coding/events.ts`(`tx.port(afterCommit).push`), `packages/core/main/daemon/wiring/coding-sessions.ts`(`withAfterCommit(inner, relay.apply)`)
    - `packages/protocol/apps/activation/activation.ts`(`ACTIVATION_PHASES`, `activationQueueEntrySchema`, `ACTIVATION_ROUTES`), `packages/protocol/apps/registry.ts`(`ROUTES`), `packages/protocol/events/transient.ts`, `packages/protocol/events/bus.ts`
    - `packages/core/apps/register.ts`(command·read 등록 목록. 소유 밖이라 "등록할 것"으로 보고한다)
    - 화면: `packages/shell/renderer/app-frame/app-detail/source.ts`(`Applying.phase`), `versions/versions-tab.tsx`(`waiting_approval` 문단), `core-source.ts`(protocol의 `ActivationQueueEntry`를 그대로 넘긴다. 고치지 않는다)
    - test 본보기: `packages/core/apps/releases/public-tools_test.ts`(in-memory SQLite와 tx shim으로 release command를 부른다)
- 계약:
  - 쓰는 것: `activationConsent`, `activationAskConsent`, `activationConsents`, `ActivationConsent`, 동의 event 이름(ap-contract의 `packages/protocol/apps/activation/consent.ts`)
  - 내놓는 것: 동의 route 셋이 `packages/protocol/apps/registry.ts`의 `ROUTES`에 들고(lead 등록. `ACTIVATION_ROUTES`에 넣으면 순환 import다) handler가 있다. 동의 대기는 ledger 표에 남아 재시작을 넘는다. 남지 않는 event `ActivationConsentRequested`, `ActivationConsentClosed`가 `busEventSchema`에 있다. 줄 phase는 `waiting_consent | running`이고 항목에 `approval`이 없다. 더 새 release의 activation이 시작되면 이전 release의 동의 대기는 `cancelled`로 닫힌다. activation 조립(`attach`)에 `approvals`가 없고, `ApprovalDecided` handler와 activation applier 등록이 없다.

## 할 일

추가(planner, 살 단계 뒤, `ap-contract`의 최종 계약): 동의는 `choice: "allow" | "reject"`이고 이유가 없다. compare는 `{requested_at}`이다.

근거: README "정한 것"의 activation 동의 두 줄, roadmap "앱 쪽", `project-docs/architecture/activation.md`의 묻는 조건(이 판정 규칙 `asksFor`는 그대로다).

정한 것: 동의 표는 허락도 남긴다(`allowed_at`). 이유: 허락만 메모리에서 시작으로 넘기면 허락이 commit된 뒤 시작하기 전에 core가 꺼질 때 허락을 잃는다. README가 대기를 표에 둔 이유와 같다. 허락한 줄은 이전 release로 돌아가기 요청(`activation_requests`)처럼 driver의 sweep(1초마다)이 시작하고, 앱이 바쁘면 다음 sweep이 다시 본다.

1. 동의 표. `packages/core/apps/releases/schema.ts`의 `apps.releases.tables` step SQL에 더한다.
   ```sql
   CREATE TABLE activation_consents (
     release TEXT PRIMARY KEY NOT NULL REFERENCES releases(id),
     app TEXT NOT NULL,
     comparison TEXT NOT NULL CHECK (json_valid(comparison)),
     requested_at TEXT NOT NULL CHECK (length(requested_at) > 0),
     allowed_at TEXT
   ) STRICT;
   CREATE INDEX activation_consents_app ON activation_consents(app);
   ```
   - `allowed_at`이 NULL이면 사람을 기다리고, 값이 있으면 사람이 허락했고 아직 시작하지 않은 것이다. `comparison`은 `canonicalize`한 선언 비교다.
   - 정한 것: 새 step을 두지 않고 같은 step의 SQL을 고친다. 옛 ledger는 step hash가 달라 기동이 거절하니 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").
   - 머리 주석의 "app·approval·backup 참조"에서 approval을 지운다.
2. `packages/core/apps/releases/activation/consents.ts`(새 file): 동의 표를 읽고 쓰는 helper를 command, read, driver가 같이 쓴다.
   - commit 뒤 할 일 topic 상수(예: `ACTIVATION_CONSENT_TOPIC`)와 남지 않는 event를 쌓는 helper(`tx.port(afterCommit).push(topic, event)`). event는 `{type, subject, at: tx.now(), payload}` 꼴 그대로 싣는다.
   - `waitingConsents(sql, app?)`: `allowed_at IS NULL`인 줄을 `requested_at, release` 순서로 `ActivationConsent` 모양으로 준다.
   - `allowedConsents(sql)`: `allowed_at`이 있고 release가 아직 `prepared`인 줄의 `{release, comparison}`.
3. `packages/protocol/events/transient.ts`: `ActivationConsentRequested`(payload `{app, release}`)와 `ActivationConsentClosed`(payload `{app, release, outcome: "allow" | "reject" | "cancelled"}`)를 `defineTransientEvent`로 만들고 `transientEventSchema`에 더한다(`busEventSchema`가 이것을 묶는다).
   - 정한 것: subject는 release id(`idSchema("rel")`)다. 이유: 같은 release는 동의 줄 하나라 대기 목록이 release로 줄을 찾는다.
4. `packages/protocol/apps/activation/activation.ts`
   - `ACTIVATION_PHASES`를 `["waiting_consent", "running"]`으로, `activationQueueEntrySchema`에서 `approval` 칸을 지운다. 안 쓰이게 된 `approvalIdSchema` import를 지운다. 줄 주석("줄은 메모리다")을 맞춘다: `running`은 메모리, `waiting_consent`는 동의 표다.
   - 동의 route 셋은 `ACTIVATION_ROUTES`에 넣지 않는다. `consent.ts`가 이 file의 `activationComparisonSchema`를 import하므로 이 file이 `consent.ts`를 import하면 순환 import가 되어 module을 읽을 때 TDZ `ReferenceError`로 core가 뜨지 않는다. 보고의 "계약 바꾸기 요청"에 적고, "등록할 것"에 `packages/protocol/apps/registry.ts`의 `ROUTES`에 셋을 더하는 줄을 적는다(shell의 `SHELL_ROUTES`와 renderer allowlist가 이 목록을 따라간다).
5. `packages/core/apps/releases/commands.ts`: `createReleaseCommands`에 둘을 더하고 하나를 고친다.
   - `askConsent`(`activationAskConsent`): machine만 받는다(`requireMachine`). `releaseAndApp`으로 release와 앱을 확인하고, release가 `prepared`가 아니면 `conflict`다. 같은 release 줄이 있고 `canonicalize(comparison)`이 같으면 아무것도 바꾸지 않고 `{created: false}`다(Reactor가 같은 `TicketVerified`를 다시 처리해도 줄과 카드가 늘지 않는다. 허락한 줄도 그대로다). 줄이 없거나 비교가 다르면 줄을 쓰거나 덮고(`allowed_at` NULL, `requested_at` = `tx.now()`) `{created: true}`이고 commit 뒤 `ActivationConsentRequested`를 낸다.
   - `consent`(`activationConsent`): 사람만 받는다(`activatePrevious`처럼 `parseActor(ctx.actor)?.kind !== "user"`면 `forbidden`). `releaseAndApp`으로 확인한다. 그 release의 기다리는 줄(`allowed_at IS NULL`)이 없으면 이미 정했거나 닫힌 것이라 `conflict`다(route의 errors 안에서 고른다).
     - allow: `allowed_at` = `tx.now()`, 출력 `{release, outcome: "allow"}`.
     - reject: 줄을 지운다. release는 `prepared`로 남는다. 출력 `{release, outcome: "reject"}`.
     - 둘 다 commit 뒤 `ActivationConsentClosed`를 낸다.
     - 정한 것: 거절 사유는 남기지 않는다. 이유: 읽는 곳이 없다. 옛 길도 activation 거절을 App Engineer에게 알리지 않았다(`handler.ts`의 "거절이면 release는 prepared로 남고 App Engineer가 사람에게 올린다").
   - `startActivation`: `activation_requests`를 지우는 자리에서, 그 앱의 기다리는 동의 줄마다 commit 뒤 `ActivationConsentClosed`(`outcome: "cancelled"`)를 쌓고 그 앱의 동의 줄을 모두 지운다(허락한 줄 포함). 그래서 더 새 release가 시작되면 이전 release는 허락할 수도 시작될 수도 없다(계약). 지금 driver가 `cancelPendingFor`로 하던 일이 시작과 같은 tx로 온다.
6. `packages/core/apps/releases/reads.ts`: `createReleaseReads`에 `activationConsents`를 더한다. `waitingConsents(snapshot.sql, input.app)`에서 `visible`이 false인 앱의 줄을 빼고 `{consents, as_of_seq, next_cursor: null}`을 준다.
7. `packages/core/apps/releases/activation/handler.ts`
   - deps에서 `approvals`와 `waitApproval`을 지우고 `consents: { ask(release: ReleaseRecord, comparison: ActivationComparison): Promise<Result<void>> }`를 더한다.
   - `judge(release)`: 막힘(`blocked`)이면 끝, 비교가 `asksFor`가 아니면 `enqueue(app, id, null)`, 맞으면 `deps.consents.ask(release, comparison)`이다. seq 인자는 intent에만 쓰였으니 지운다(`reconsider`도 같다).
   - `approvalDecided`와 `applier`를 지우고 `consented(row: {release: string; comparison: string})`를 둔다. 지금 `approvalDecided`의 몸통을 옮긴 것이다: release를 다시 읽어 `prepared`가 아니면 끝, 비교를 다시 해 `asksFor`인데 정규 값이 `row.comparison`과 다르면 `judge`(다시 묻는다), 막힘이면 끝, 아니면 `enqueue(app, id, asksFor ? canonicalize(지금 비교) : null)`.
   - 머리 주석(보류 request, applier, `ApprovalDecided`)을 맞춘다. 안 쓰이게 된 `ApplyResult`, `Intent`, `PendingApproval` import를 지운다.
8. `packages/core/apps/releases/activation/queue.ts`: 메모리 줄은 `running`만 둔다. `waiting_approval` 갈래, `QueueEntry.approval`, `waitApproval`, `dropWaiting`, 쓰는 곳 없는 `has`·`running`을 지운다. `list`는 running 항목만 준다.
9. `packages/core/apps/releases/activation/assembly.ts`
   - `ActivationLate`에서 `approvals`를 지운다. `Intent`, `PendingApproval` import를 지운다.
   - handler 조립: `consents.ask`는 `sendValue(activationAskConsent.name, { release: release.id, comparison }, "activation-ask-consent")`다. `waitApproval`을 지운다.
   - `runOne`: `late.approvals.cancelPendingFor(...)`와 `queue.dropWaiting(...)`을 지운다(5의 `startActivation`이 한다). `handlers.reconsider(release)`로 부른다.
   - `queueEntries`: 메모리 running 항목에 `ledgerRead`로 읽은 `waitingConsents(sql, app)` 가운데 running이 아닌 release를 `{phase: "waiting_consent", step: null, held_calls: 0, migration_steps: 0}`로 더한다.
   - `sweep`: `late !== undefined` 안에서 이전 release 요청 다음에 `allowedConsents`의 줄마다 `await handlers.consented(row)`를 부른다.
   - 머리 주석의 `ApprovalDecided`·Approvals 줄과 `ActivationDriver`의 `attach`·`handlers` 주석을 맞춘다.
10. `packages/core/apps/control.ts`: `APPS_CONTROL_CONTEXT`의 operations와 `appsOperationPolicies`의 machine activation 목록에 `activationAskConsent`를 더한다(driver가 이 자격으로 부른다). `SUPERVISOR_OPERATIONS`의 "시작은 사람 approval의 적용(`apply_approved_action`)이다" 주석을 지운다.
11. `packages/core/main/daemon/wiring/apps.ts`
    - `activation.attach({...})`에서 `approvals`를 뺀다. `ctx.reactor.on("ApprovalDecided", ...)`와 `ctx.approvals.registerApplier("activation", ...)`를 지운다. `ctx.reactor.on("TicketVerified", ...)`는 남는다.
    - `writer`를 `withAfterCommit(<지금 writer>, apply)`로 감싸 2의 topic action을 `ctx.bus.publish`로 낸다.
      - 정한 것: 동의 event는 command가 `afterCommit` port에 쌓고 apps wiring이 commit 뒤 Bus로 낸다. 이유: 사람의 `activation.consent`는 writer Worker에서 돌아 driver를 지나지 않고, Bus에는 commit 뒤에만 낸다(`project-docs/architecture/event.md` "Bus와 Reactor"). driver가 부르는 `activation.ask_consent`와 `activation.start`도 접은 writer(`ctx.writer`)를 지나 같은 길로 나간다.
    - 주석 "Reactor·Approvals에 등록한다"를 맞춘다. `createAppCalls`의 `approvals: ctx.approvals`는 ap-app-call의 몫이라 그대로 둔다.
12. 앱 상세 화면(`ui-design` skill. 모양은 바뀌지 않고 phase 이름과 문구 key만 바뀐다. gallery page `new-app-version-applying`은 `running`만 그려 wireframe은 고치지 않는다)
    - `packages/shell/renderer/app-frame/app-detail/source.ts`: `Applying.phase`를 `"waiting_consent" | "running"`으로.
    - `versions/versions-tab.tsx`: `waiting_approval` 비교와 문구 key를 바꾼다.
    - wording(`wording` skill), `packages/design/wording/catalog/app-space.ts`: `app-detail.note.applying-waiting-approval`을 `app-detail.note.applying-waiting-consent`로 바꾼다(글은 그대로). `deno task wording`으로 placeholders를 다시 만든다.
13. 지우거나 바꾼 이름을 grep해 주석과 오류 메시지에 남은 것도 고친다: `waiting_approval`, `waitApproval`, `dropWaiting`, `approvalDecided`, `ApprovalDecided`, `cancelPendingFor`, `createPending`, `apply_approved_action`, `applying-waiting-approval`, "보류 request". 이제 틀린 approval 낱말 주석도 고친다: `packages/core/apps/releases/commands.ts`의 `activatePrevious` 위("approval은 없다"), `packages/protocol/apps/activation/activation.ts`의 `activationAttemptSchema` 위("approval과 expected_*는 없다").

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- core 확인: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다. lead가 register.ts·registry.ts 등록을 더한 뒤에 다시 돈다.
- 위험 test: "사람이 동의하기 전에는 선언이 넓어진 release가 activate되지 않는다"(`packages/core/apps/releases/activation/consents_test.ts`, 새 file. 대상 `consents.ts` 옆)
  - 준비(file에 한 번): in-memory SQLite에 `appsSchemaSteps`와 `releasesSchemaSteps`를 깔고 앱 하나와 `prepared` release 하나를 넣는다(본보기 `public-tools_test.ts`의 tx shim. `afterCommit` port는 아무것도 안 하는 push다). `createActivationHandlers`의 `releases`는 그 DB의 `loadRelease`와 바꿀 수 있는 가짜 비교(첫 activation이거나 `added_resources`가 있다), `blocked`는 늘 false, `consents.ask`는 그 DB 위의 `askConsent` command, `enqueue`는 시작한 release를 모으는 가짜다.
  - 표로 본다(판정은 "시작한 release"와 동의 줄로 한다)
    - `TicketVerified`를 받으면 시작하지 않고 기다리는 줄이 하나 생긴다. 다시 받아도 줄은 하나다.
    - machine·agent 자격의 `activation.consent`는 `forbidden`이고, 허락한 줄(`allowedConsents`)이 없으니 시작하지 않는다.
    - 사람이 허락한 뒤 비교가 바뀌었으면(grant가 바뀜) `consented`가 시작하지 않고 새 비교로 다시 묻는다(줄이 다시 기다림이 된다).
    - 사람이 지금 비교를 허락하면 `allowedConsents`의 줄로 `consented`가 그 release를 시작한다.
- 남지 않음
  - `grep -rn "waiting_approval\|waitApproval\|dropWaiting\|applying-waiting-approval" packages tools`가 0줄이다.
  - `grep -rn "pprov" packages/core/apps/releases packages/core/apps/control.ts packages/protocol/apps/activation/activation.ts packages/shell/renderer/app-frame/app-detail`가 0줄이다(주석 포함).
  - `grep -n "ctx\.approvals\.\|ApprovalDecided" packages/core/main/daemon/wiring/apps.ts`가 0줄이다. approvals module 안의 `createPending`·`cancelPendingFor`와 `ApprovalDecided` 정의는 ap-ask-pending이 지운다.

## 보고

- 바꾼 file과 새 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 적어도 `packages/core/apps/register.ts`(commands에 `askConsent`·`consent`, reads에 `activationConsents`), `packages/protocol/apps/registry.ts`(동의 route 셋), ap-contract 때 하지 않았으면 `packages/protocol/apps/activation/mod.ts`의 `consent.ts` export
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: `Approvals`의 `createPending`·`cancelPendingFor`·`request`·`pending`과 `"activation"` applier 종류는 이제 부르는 곳이 없다(ap-ask-pending이 지운다). 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 적어도: 대기 목록의 동의 카드는 ap-waiting이 붙이기 전까지 없다. `tests/support/app/activate.ts`(e2e·eval 몫, check 밖)는 아직 approvals 보류 request로 동의를 찾는다. 없음이면 "없음"
