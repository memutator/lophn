# ab-release-activate

App Engineer가 prepared release를 `release.activate`로 올린다. activation의 계기를 `TicketVerified` Reactor handler에서 이 command로 옮기고(roadmap "activation 계기는 App Engineer의 `release.activate`다"), 다른 domain이 쓰는 공개 tool을 지우는 release를 activation에서 막던 것을 뺀다(알림은 ab-release-prepare가 준비 결과에 싣는다). 사람의 activation 동의(approval-simplify가 만든 `activation_consents`)가 필요하면 묻기만 하고 기다리지 않는다(README "`release.activate`의 결과"). activation은 끝날 때까지 기다리되 상한을 넘으면 `running`을 돌려준다(README "뼈대 검토에서 정한 것").

- 단위: release (wave 2)
- 선행: ab-reaction-core. 같은 wave에서 `packages/core/apps/releases/commands.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/releases.ts`
  - `packages/protocol/apps/activation/activation.ts`
  - `packages/core/apps/releases/{commands.ts,public-tools_test.ts}`
  - `packages/core/apps/releases/activation/{handler.ts,assembly.ts,queue.ts,consents_test.ts}`
  - `packages/core/apps/{control.ts,register.ts}`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/apps/agent-tools/release.ts`
  - `packages/core/agent-roles/tool-lists.ts`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것" 가운데 "`release.activate`의 결과", "뼈대 검토에서 정한 것"의 "`release.activate`는 core memory route이고 activation이 끝날 때까지 기다린다"와 "wave 2에서 공개 tool 막기를 지우고 wave 3에서 알림이 온다"
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "모양 › program이 agent를 부르지 않는다", "정한 것(agent)"의 "activation 계기는 App Engineer의 `release.activate`다", "공개 tool 막기를 알림으로 바꾼다"
  - 선행 task: `project-docs/plan/ae-builds/tasks/ab-reaction-core.md`의 "내놓는 것"(`activation.fail`은 event를 쓰지 않는다, `ReleaseActivationFailed`가 없다)
  - architecture: `project-docs/architecture/activation.md`의 "흐름", "지키는 것 › 계기와 묻는 조건"(동의 표, 앱마다 하나, `conflict`로 거절), `project-docs/architecture/domain.md` 48줄(공개 tool 막기). 둘 다 지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `agent-tool-spi`; `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드(줄은 main `dd956b49f`. 선행 task가 바꾼 file은 merge 뒤 줄을 다시 본다)
    - 판정: `packages/core/apps/releases/activation/handler.ts` 전체(`judge` 48-58, `ticketVerified` 62-73, `consented` 74-97). `asksFor`는 `packages/core/apps/releases/compare.ts` 48이다. 첫 activation(`first`)도 묻는다.
    - driver: `packages/core/apps/releases/activation/assembly.ts`의 머리 주석 1-12, import 21-41(`activationBlock` 23)과 62-67(`findReleaseForTicket` 63), `ActivationDriver` type 135-158(`handlers` 143-144), `runOne` 598-640, `enqueue` 642-654, `createActivationHandlers` 조립 656-685(`forTicket` 658, `blocked` 662-672), `sweep` 793-820
    - 줄: `packages/core/apps/releases/activation/queue.ts`(`enqueue` 123-150, `jobs` 119)
    - 시도의 결과: `runActivation`(`orchestrator.ts` 165-174)은 `ActivationOutcome`(`steps.ts` 137-146)을 내고 ledger의 release status가 `active`·`failed`이거나, 끝내지 못했으면(`unavailable`) `activating`으로 남는다. 실패 근거는 `ReleaseRecord.failure`(`packages/protocol/apps/activation/activation.ts` 43-48, 81)다.
    - command: `packages/core/apps/releases/commands.ts`의 import 13·57, `BLOCKED_MESSAGE` 192, type 206, `startActivation` 214-281(막기 249-252), `blockActivation` 282-305, `activatePrevious` 449-494(막기 483-486), `askConsent` 주석 495
    - control: `packages/core/apps/control.ts`의 import 15, `APPS_CONTROL_CONTEXT` 113-139(`activationBlock` 122-123), `appsOperationPolicies` 193-207(`activationBlock` 200), `AppsControl.commands` 288-290, 본보기 handler `releasePrepareBundleHandler` 512-548와 `releaseGate` 474-487, `ledgerPreviewReleases` 337-359(release 한 행 읽기), commands map 680-684, `withReleasePreparation` 861-888
    - 등록: `packages/core/apps/register.ts`의 commands 161-186(`blockActivation` 180), `memoryRoutes` 207-220
    - wiring: `packages/core/main/daemon/wiring/apps.ts` 275-299(`ctx.reactor.on("TicketVerified", …)` 298)
    - protocol: `packages/protocol/apps/releases.ts`의 `releaseSchemas`의 `failure` 칸(180줄, 본보기), `RELEASE_ROUTES` 326-331. `packages/protocol/apps/activation/activation.ts`의 주석 26-28·42, `activationBlock` 189-200, `ACTIVATION_ROUTES` 342-355. `activation.ts`가 `releases.ts`를 import하므로 `releases.ts`가 `activation.ts`를 import하면 순환이다(`packages/protocol/apps/registry.ts` 83줄 주석과 같은 이유).
    - 권한: `createTargetAuthorizer`(`packages/core/storage/ledger/target-authorization.ts` 21-31)와 `authorize`(`packages/core/server/identity/model.ts` 118-152). App Engineer 자격은 `conditions.app`이 담당 앱이고(`packages/core/agent-roles/credentials.ts` 84-113), 다른 앱 target은 `not_found`, operation이 없으면 `forbidden`이다. memory 처리기와 writer 앞 처리는 operation을 따로 보지 않으므로(`packages/core/server/dispatch.ts` 482-500, 406-440) handler가 직접 본다.
    - tool: `packages/core/apps/agent-tools/release.ts` 전체, 쓰기 tool 본보기 `packages/core/apps/agent-tools/app.ts` 112-138(`commandOf`), `packages/core/lophn-agent/tools/fit-result.ts`(`fitted`). model은 오류 code마다 고정 글만 받는다(`packages/core/lophn-agent/tools/work.ts` 34-42). 그래서 결과 넷은 오류가 아니라 출력이다.
    - 목록: `packages/core/agent-roles/tool-lists.ts` 57-69(`app_engineer`), 91-140(`TOOL_ORDER`). `packages/core/main/agent-tools_test.ts`가 목록과 정의가 맞는지 본다.
    - 기다림과 turn 한도(확인함): tool 결과가 오면 limiter가 stall을 0으로 되돌린다(`packages/core/lophn-agent/run-loop/turn.ts` 560, `limits.ts` 162-165). 시간 한도로 끊는 timer는 model call에만 건다(`turn.ts` 337). core의 응답에는 시간 상한이 없다(`packages/core/main/agent-runtime/core-http.ts`). 그래서 120초 기다림은 `stall_ms`(300초)에 걸리지 않고 `active_ms`(30분)만 쓴다.
    - 상한의 근거 값: `packages/core/lophn-agent/tools/shell/run.ts` 8(`DEFAULT_TIMEOUT_MS` 120초), `packages/core/apps/runtime/supervisor/relay.ts` 20(`CALL_TIMEOUT_MS` 120초), `orchestrator.ts` 23(`DRAIN_GRACE_MS` 30초), `packages/core/apps/runtime/supervisor-link.ts` 45(`ACTIVATION_TIMEOUT_MS` 90초)
- 계약:
  - 쓰는 것: `activation.ask_consent`와 동의 표(`packages/core/apps/releases/activation/consents.ts`), `asksFor`(`compare.ts`), activation driver의 줄과 `runOne`
  - 내놓는 것:
    - route `release.activate`(`releaseActivate`, `packages/protocol/apps/releases.ts`의 `RELEASE_ROUTES`): command, resource `releases`, method `activate`, actors `["agent"]`, 입력 `{ release: rel_… }`, 출력은 넷 가운데 하나다(`status`로 가르는 union, type `ReleaseActivateOutput`).
      - `{ status: "active", release, previous_release: rel_… | null }`
      - `{ status: "failed", release, failure: { code, summary, restored } }`(release의 `failure` 그대로)
      - `{ status: "waiting_consent", release }`
      - `{ status: "running", release }`: 상한(120초) 안에 끝나지 않았다. App Engineer는 `app.status`와 `release.get`으로 본다.
      - errors: `invalid_input`, `forbidden`, `not_found`, `conflict`(prepared가 아님, 그 앱에 activation이 돌고 있음, 시작하지 못함), `unavailable`
    - core memory route다(`register.ts`의 `memoryRoutes`). handler는 `control.ts`의 commands map에 있고 `withReleasePreparation`이 writer 앞에서 돌린다. 그 앱의 App Engineer만 부른다(agent 자격의 operation과 앱 조건. 범위 밖과 없는 release는 같은 `not_found`).
    - 판정은 지금 `judge`와 같다: 선언이 넓어지거나 data 손실 migration이거나 첫 activation이면(`asksFor`) 동의를 묻고 `waiting_consent`를 바로 돌려준다. 아니면 activation을 시작하고 끝날 때까지(상한 120초) 기다려 `active`나 `failed`, 넘으면 `running`을 돌려준다. 동의 뒤의 시작은 지금처럼 driver sweep이 하고 결과는 사람이 화면에서 본다. program이 App Engineer를 다시 부르지 않는다.
    - activation driver는 release 하나를 판정하고 그 시도의 끝을 기다리는 입구 `activate(release: string): Promise<Result<ReleaseActivateOutput>>`를 낸다(`ActivationDriver`). `ActivationDriver.handlers`는 없다. handler(`handler.ts`)에 `ticketVerified`와 deps `releases.forTicket`, `releases.blocked`가 없고 판정 입구 `activate(release: ReleaseRecord): Promise<Result<"started" | "waiting_consent">>`가 있다.
    - route `activation.block`(`activationBlock`, `ACTIVATION_ROUTES`), command `blockActivation`, `APPS_CONTROL_CONTEXT`와 `appsOperationPolicies`의 그 operation이 없다. `activation.start`와 `activation.activate_previous`는 공개 tool 사용을 보지 않는다. `public-tools.ts`는 그대로 남는다.
    - `wiring/apps.ts`에 `ctx.reactor.on("TicketVerified", …)`이 없다.
    - agent tool `release.activate`(App Engineer만, `tool-lists.ts`의 `app_engineer` 쓰기 목록과 `TOOL_ORDER`의 `release.get` 바로 뒤).

## 할 일

근거: README "`release.activate`의 결과". ticket이 없으면 activation을 여는 계기가 남지 않고, 앱의 주인은 App Engineer다(roadmap "정한 것(agent)").

1. 먼저 확인한다. 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - ab-reaction-core가 merge됐다: `git grep -n "ReleaseActivationFailed\|releaseActivationFailed" -- packages/core/apps packages/protocol/apps`가 `activation.ts`의 주석(26-28줄)밖에 없다.
2. protocol
   - `packages/protocol/apps/releases.ts`에 `releaseActivate`와 `ReleaseActivateOutput`을 둔다. 출력 schema는 `z.discriminatedUnion("status", …)`이고 `failure`는 `{ code: z.string().min(1), summary: z.string().min(1), restored: z.boolean().nullable() }`로 이 file 안에 적는다(`releaseSchemas`의 `failure` 칸과 같은 꼴). `activation.ts`의 `activationFailureSchema`를 import하지 않는다(순환). `RELEASE_ROUTES`에 더한다. 다른 등록은 필요 없다(`packages/protocol/apps/registry.ts`가 `RELEASE_ROUTES`를 펼치고 `packages/protocol/apps/mod.ts`가 `releases.ts`를 모두 내보낸다).
   - `packages/protocol/apps/activation/activation.ts`: `activationBlock`과 `ACTIVATION_ROUTES`의 그 줄을 지운다. 26-28줄과 42줄 주석에서 `ReleaseActivationFailed`와 "event payload"를 지운다.
3. 판정(`handler.ts`)
   - `ticketVerified`, `TICKET_VERIFIED_HANDLER`, `ReactorHandler` import, deps `releases.forTicket`·`releases.blocked`를 지운다. `judge`와 `consented`에서 `blocked` 검사를 지운다.
   - `judge`가 `"started" | "waiting_consent"`를 돌려주게 하고 그것을 `activate(release)`로 낸다. `reconsider`와 `consented`는 지금처럼 `Result<void>`다.
   - 머리 주석을 고친다: 계기는 App Engineer의 `release.activate`이고, 동의 뒤의 시작은 driver sweep이다. 공개 tool 막기 줄을 지운다.
4. driver(`assembly.ts`, `queue.ts`)
   - `queue.ts`에 그 앱의 도는 job(`jobs.get(app)`)을 주는 `running(app): Promise<void> | undefined`를 더한다.
   - `assembly.ts`에 `activate(release)`를 둔다. 순서:
     1. `late`가 없거나 `deps.bound()`가 false면 `unavailable`이다. supervisor 통로 없이 시작하면 종료를 확인하지 못해 시도가 `activating`으로 남는다(sweep이 bound를 보는 것과 같은 이유).
     2. `currentRelease`로 읽는다. 없으면 `not_found`, `prepared`가 아니면 `conflict`, `queue.running(app)`이 있으면 `conflict`다.
     3. `handlers.activate(release)`. `waiting_consent`면 `{ status: "waiting_consent", release }`를 바로 돌려준다.
     4. `started`면 `queue.running(app)`의 job과 상한 timer 가운데 먼저 끝나는 것을 기다린다. timer는 끝에 늘 `clearTimeout`한다(test의 자원 검사와 core 종료가 걸리지 않게). job이 이미 없으면 기다리지 않는다.
     5. ledger를 다시 읽어 답한다: `active`면 `previous_release`(= `release.activation.previous_release`), `failed`면 `failure`, `activating`이면 `running`, `prepared`이고 그 release의 동의 대기 줄(`waitingConsents`)이 있으면 `waiting_consent`(기다리는 사이 비교가 달라져 `reconsider`가 다시 물었다), 그 밖은 `conflict`("the activation did not start". 보관된 앱처럼 `activation.start`가 거절했다).
   - 상한은 module 상수 `ACTIVATE_WAIT_MS = 120_000`이고 주석에 이유를 쓴다: `shell.run`의 기본 timeout과 앱 tool 호출 상한(`CALL_TIMEOUT_MS`)과 같아 tool 하나가 turn을 이보다 오래 붙들지 않는다. drain 유예(30초)와 후보 준비(90초)가 드는 보통의 activation이 들어가고, 큰 migration(data job 상한 300초)은 넘을 수 있어 `running`이다. stall 한도와의 관계는 "읽을 것"에 확인한 대로다.
   - `ActivationDriver`에서 `handlers`를 지우고 `activate`를 더한다. `createActivationHandlers` 조립에서 `forTicket`과 `blocked`를 지우고 `activationBlock`, `findReleaseForTicket` import를 지운다(`findReleaseForTicket` 정의는 ab-release-prepare가 지운다). 머리 주석 2번 항목의 "`TicketVerified` Reactor handler"를 "App Engineer의 `release.activate`(판정은 handler.ts)"로 고친다.
5. command(`commands.ts`)
   - `blockActivation`(type 줄 포함), `BLOCKED_MESSAGE`, `blockedToolsOf` import, `activationBlock` import를 지운다.
   - `startActivation`과 `activatePrevious`의 `blockedToolsOf` 검사와 그 주석을 지운다.
   - 주석의 "Reactor handler"(214, 495)를 "`release.activate`나 동의 뒤 sweep"으로 고친다.
6. control과 등록
   - `control.ts`: `releaseActivate` handler를 commands map에 더한다. handler는 (a) driver가 없으면(`activation === null`) `unavailable`, (b) ledger에서 release 한 행을 읽어(본보기 `ledgerPreviewReleases`) 없으면 `not_found`, (c) `createTargetAuthorizer(ctx)(ctx, releaseActivate.name, { app })`가 `not_found`면 없는 release와 같은 `not_found`, `forbidden`이면 그대로, (d) `activation.activate(release)`를 돌려준다. `APPS_CONTROL_CONTEXT`와 `appsOperationPolicies`에서 `activationBlock`을 지운다. agent 발급 상한은 tool의 `routes`에서 저절로 오른다(`roleOperations`, `agentRuntimePolicies`). `appsOperationPolicies`에 `release.activate`를 더하지 않는다.
   - `register.ts`: `memoryRoutes`에 `releaseActivate`를 더하고(주석: writer 앞 `withReleasePreparation`이 처리한다) commands에서 `releaseCommands.blockActivation`을 지운다.
   - `wiring/apps.ts`: 298줄을 지우고 275줄 주석의 "Reactor에 등록한다"를 지운다.
7. agent tool
   - `agent-tools/release.ts`에 `release.activate`를 더한다. 입력 `z.strictObject({ release: idSchema("rel") })`, `routes: [releaseActivate]`, `effect: "write"`, `commandOf(ctx.core, releaseActivate, { release }, {}, ctx.tool_call)`. 결과 넷은 `fitted`(status `success`)로 돌려주고 summary에 status를 적는다(`failed`면 code와 summary까지).
   - 설명 글(영어) 예: "Activate a prepared release of your app and wait for the result: active, or failed with the reason. A first activation, new permissions or a data loss migration need the person's consent: then it returns waiting_consent at once and the person sees the result. If the activation takes longer than two minutes it returns running; check app.status."
   - `tool-lists.ts`: `app_engineer` 쓰기 목록과 `TOOL_ORDER`(`release.get` 뒤)에 더한다.
8. test
   - `consents_test.ts`의 위험 test를 새 입구로 다시 쓴다(아래 "끝남"). `handlers.ticketVerified.handle(...)` 대신 `handlers.activate(release)`를 두 번 부르고, 둘 다 `waiting_consent`이며 시작한 것이 없고 대기 줄이 하나인지 본다. deps에서 `forTicket`과 `blocked`를 지운다. 나머지(사람이 아니면 허락 못 함, 허락 뒤 비교가 바뀌면 다시 물음, 지금 비교를 허락하면 시작)는 그대로 둔다. release fixture의 `tests`·`ticket_source`는 그대로 둔다(표가 아직 요구한다. ab-release-prepare가 고친다).
   - `public-tools_test.ts`의 "다른 domain이 쓰는 공개 tool을 지운 release는 시작하지 않고 prepared로 남는다"는 설계와 맞지 않아 지우고, 그것만 쓰던 helper와 import도 지운다. "공개였다가 비공개가 된 tool도 지운 것이다"(`removedPublicOf`, 준비 알림이 쓴다)는 남긴다.
   - 정한 것: `release.activate`의 앱 경계(다른 앱의 App Engineer는 `not_found`)에는 새 test를 두지 않는다. 이유: 판정은 `createTargetAuthorizer`와 `authorize`를 그대로 부르는 세 줄이고, test하려면 core 조립(`createAppsControl`)이 필요하다. 같은 판정의 agent preview 경계는 ab-preview가 본다.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 route 중복 없이 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 바꾼 곳의 test: `deno test --no-check packages/core/apps/releases packages/core/main/agent-tools_test.ts`
- 위험 test: "사람이 동의하기 전에는 선언이 넓어진 release가 activate되지 않는다"(`consents_test.ts`, `release.activate`의 판정 입구로)
- 남지 않음
  - `git grep -n "activationBlock\|activation\.block\|blockActivation\|ticketVerified\|TicketVerified\|forTicket" -- packages/core/apps packages/protocol/apps packages/core/main/daemon/wiring/apps.ts ':!packages/core/apps/tickets'`가 `packages/core/apps/releases/schema.ts`의 SQL 주석 한 줄뿐이다(ab-release-prepare가 그 step을 고친다).
  - `git grep -n "blockedToolsOf" -- packages`가 `packages/core/apps/releases/public-tools.ts`의 정의뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`RELEASE_ROUTES`는 `packages/protocol/apps/registry.ts`가 펼친다). 다르면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 예상은 `public-tools.ts`의 `blockedToolsOf`·`DomainNotice`, `store.ts`의 `findReleaseForTicket`
- 정한 것: 문서에 답이 없어 worker가 정한 것(상한 값과 그 이유, 끝난 뒤 `prepared`인 경우의 답)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. `public-tools.ts` 머리 주석의 "activation 막기(start·block)가 쓴다"와 `schema.ts`의 SQL 주석은 고치지 않고 적는다(ab-release-prepare의 file이다).
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예상: 사람이 허락한 줄을 sweep이 시작하기 전(1초 안)에 다시 부르면 `waiting_consent`를 받는다.
