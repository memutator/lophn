# contract-approvals

S2의 새 모양을 코드로 고정한다: grant 셋(앱, agent, reaction), 효과별 기본값, Gate 입력(intent)과 판정, turn 안 권한 request와 보류 request, 결정과 결과 상태, "이 session 동안" 허락, core approvals port. type, schema, 상수, route 정의, type-only port만 둔다. 구현은 넣지 않는다. 옛 계약(`approvals.ts`의 `ApprovalAction`·`ApprovalRequest`·옛 route, 옛 `Grant`, 확인 창 IPC)은 지우지 않고 새것을 옆에 더한다.

- 단위: contract-approvals (wave 2)
- 선행: contract-calls-places-calls (`AgentRef`·`Place`는 `protocol/lophn-agent/places.ts`, `callAgentSchema`는 `calls.ts`에서 import한다. 그 task가 places를 선행으로 둔다). lead가 `packages/protocol/base/ids.ts`에 접두사 `agt`(Agent), `trn`(Turn), `cal`(Call)을 먼저 더해 둔다(오케스트레이터가 띄우기 전에 확인한다). 이 task는 contract-events보다 먼저 merge된다. contract-events가 이 task의 type을 import한다.
- 소유(이 task만 고친다):
  - `packages/protocol/approvals/` (새 file `grants.ts`, `intent.ts`, `requests.ts`를 더하고 `mod.ts`에서 내보낸다. `approvals.ts`는 지우지 않는다)
  - `packages/protocol/apps/grants.ts` (새 `appGrantSchema`를 더한다. 옛 `grantSchema`·route는 그대로)
  - `packages/protocol/apps/permissions.ts` (앱 grant scope를 내보낸다. 옛 것은 그대로)
  - `packages/protocol/lophn-agent/decision-values.ts` (손대지 않는다. 아래 "할 일" 8)
  - `packages/protocol/shell/confirmation.ts` (손대지 않는다. 아래 "할 일" 7)
  - `packages/shell/ipc/confirmation.ts`, `packages/shell/ipc/confirmation-channels.ts`, `packages/shell/ipc/windowless-confirmation.ts` (손대지 않는다. 아래 "할 일" 7)
  - `packages/core/approvals/ports.ts` (새 file, type만)
- 읽을 것:
  - spec: S2 2~8장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`. 6장(request 두 길, 선택지, 결정 규칙)과 4장(grant, 기본값)이 중심이다. S1 7·9장(`ApprovalRequested`, 흐름 5·6) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.2#11`, `I1.3#3`, `I2.2#2`, `I2.2#4`, `I2.2#8`, `I2.2#13`, `I3.2#2` (`../assignment.md`의 contract-approvals 줄 전부)
  - 결정: `../README.md` 3장 #3(Gate 호출 한 곳, file·shell·web은 Gate 없음), #12(Gateway에 붙는 쪽은 사람 token의 shell main 하나)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`("package 사이 약속"), `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md`
  - 지금 코드(읽기만): `packages/protocol/approvals/approvals.ts`, `packages/protocol/apps/{grants,permissions}.ts`, `packages/protocol/base/route.ts`(`defineRead`·`defineCommand`·`defineMemory`), `packages/shell/ipc/confirmation.ts`, `packages/core/apps/tickets/ports.ts`(core port file 본보기)
- 계약:
  - 쓰는 것: `protocol/base`의 `idSchema`, `seqSchema`, `atSchema`, `sha256Schema`, `jsonObjectSchema`, `defineRead/defineCommand/defineMemory`, `withReadCommon`(`base/envelope.ts`). `protocol/lophn-agent/places.ts`의 `agentRefSchema`·`AgentRef`·`placeSchema`, `calls.ts`의 `callAgentSchema`·`CallAgent`(contract-calls-places). id 접두사는 `ses`, `apr`, `app`, `rel`, `grt`, `tcl`, `trn`(Turn)이다. `trn`은 lead가 `ids.ts`에 먼저 더한다. 이 task를 띄울 때 없으면 멈추고 보고한다.
  - 내놓는 것: 아래 "할 일"의 모양 전부. contract-events, contract-calls-places, contract-agent-tools, contract-app-calls, contract-releases-problems가 Gate type과 request type을 이 file들에서 import한다.

## 할 일

모든 이름은 최종 이름이다(`v2` 같은 이름 금지). 옛 export와 겹치는 이름은 쓰지 않는다. 옛 `ApprovalRequest`·`approvalStatusSchema`·`ApprovalReceipt`와 겹치므로 새 request type은 `PendingApproval`과 `TurnPermissionRequest`다.

1. `packages/protocol/approvals/grants.ts` — S2 3·4장 (`I2.2#2`)
   - `EFFECTS = ["read", "write", "external"]`, `effectSchema`, `Effect`
   - `ASK_SETTINGS = ["never", "ask"]` (묻지 않음, 물음), `askSettingSchema`
   - `DEFAULT_ASK: Record<Effect, AskSetting>`: read와 write는 `never`, external은 `ask`. `SETTINGS_EDIT_DEFAULT_ASK = "ask"`.
   - agent grant: key는 agent이고 `AgentRef`(`{role:"lophn"}`, `{role:"project_manager", project}`, `{role:"app_engineer", app}`, `{role:"operator", agent: agt}`)로 가리킨다. 고정 role agent는 role과 place가 곧 정체성이다(S2 4장의 "agent ID"를 contract-calls-places의 `AgentRef`로 읽는다). 같은 agent인지는 canonical JSON으로 비교한다.
     - `agentGrantEntrySchema`는 `kind`로 나눈 union이다.
       - `{ kind: "app", app, apis: [{ api: string, setting: "excluded" | "never" | "ask" }] }`. 앱 하나를 할당하면 app-api 전부가 대상이고, `apis`에는 사람이 바꾼 것만 든다. 빠진 app-api는 효과별 기본값이다.
       - `{ kind: "mcp_tool", server, tool, setting?: AskSetting }`
       - `{ kind: "agent", agent: CallAgent, setting?: AskSetting }` (다른 agent 부르기. coding agent 맡기기도 대상이다)
       - `{ kind: "settings", setting?: AskSetting }` (lophn 쪽 설정 고치기)
     - `agentGrantSchema = { agent: AgentRef, entries: AgentGrantEntry[] }`. entries 안에서 같은 대상은 하나다(refine).
   - reaction grant:
     - `REACTION_EVENT_TYPES = ["ProblemOpened", "ProblemReopened", "AppRestartHalted", "ReleaseActivationFailed", "ContextViolationFound"]` (S1 5장 "새 일" 다섯. 맡긴 call을 닫는 셋은 끌 수 없어서 여기 없다)
     - `REACTION_MODES = ["off", "open", "ask"]` (끔, 열고 묻지 않음, 물음), `DEFAULT_REACTION_MODE = "open"`
     - `reactionGrantSchema`: `REACTION_EVENT_TYPES`를 key로 하는 strict object, 값은 mode
     - `reactionSettingKey(type): string`. Settings key 이름 규칙은 `reactions.<snake_case 이벤트 이름>`이다(예: `reactions.problem_opened`). 선언 모델에 올리는 것은 wave 3 approvals-gate가 한다.
   - agent grant 읽기·쓰기 route (사람 자격):
     - `agentGrantsGet`: `defineRead`, resource `agent_grants`, method `get`, name `GetAgentGrant`, input `{ agent: AgentRef }`, output `withReadCommon({ grant: agentGrantSchema })`
     - `agentGrantsSet`: `defineCommand`, resource `agent_grants`, method `set`, name `SetAgentGrant`, input `{ agent: AgentRef, entries }`(통째로 바꾼다), output `{ grant }`, actors `["user"]`. agent·coding agent·앱은 자기 grant를 넓히지 못한다(S2 4장).
   - `AGENT_GRANT_ROUTES = [agentGrantsGet, agentGrantsSet]`

2. `packages/protocol/apps/permissions.ts`, `packages/protocol/apps/grants.ts` — 앱 grant (`I2.2#8`)
   - `permissions.ts`: 이미 있는 `fsScopeSchema`, `fetchScopeSchema`, `listenScopeSchema`, `secretScopeSchema`, `appCallScopeSchema`를 `export`한다. 이어서 `APP_GRANT_KINDS = ["fs.read", "fs.write", "net.fetch", "net.listen", "secret.use", "app.call"]`와 이 여섯 kind만 담은 `appGrantScopeSchema`(discriminated union)를 더한다. 옛 `PERMISSION_KINDS`, `permissionScopeSchema`는 그대로 둔다.
   - `grants.ts`: `appGrantSchema = { id: grt, app, scope: appGrantScopeSchema, status: "active" | "revoked", created_at, revoked_at: at | null }`. 옛 `grantSchema`의 `approval`·`created_by`·`revoked_by` 칸이 없다(activation 한 번에 만든다). `app.call`은 자기 앱을 가리키지 못한다는 refine을 옮긴다. 새 route는 만들지 않는다. 앱 grant를 거두는 route는 옛 `grantRevoke`를 wave 3 approvals-app-grants가 그대로 고쳐 쓴다.
   - 앱 grant 표시 자료(`I2.2#13`): 옛 `grantDisplaySchema`·`grantRequirementDisplaySchema`·`grantCombinationWarningSchema`는 그대로 둔다. activation 카드가 늘어난 선언을 보일 때 쓴다.

3. `packages/protocol/approvals/intent.ts` — Gate 입력 (`I3.2#2`, S2 5장)
   - `INTENT_KINDS = ["app_api", "mcp_tool", "agent_call", "settings_edit", "app_resource", "reaction", "activation"]`. S2 5장 `kind` 줄의 여섯(`app_api`, `mcp_tool`, `agent_call`, `settings_edit`, `reaction`, `activation`)에 `app_resource`를 더한다. `app_resource`는 앱의 바깥 자원(network host, secret, 파일) 사용이고 S2 5장 "Gate를 부르는 곳" 표의 둘째 줄을 위해 필요하다.
   - `intentActorSchema`: `{ kind: "agent", agent: AgentRef, session }` | `{ kind: "app", app }` | `{ kind: "program", seq }` (program은 근거 domain event seq)
   - `intentTargetSchema`: `kind`로 나눈 union
     - `app_api`: `{ app, api }`
     - `mcp_tool`: `{ server, tool }`
     - `agent_call`: `{ agent: CallAgent }` (받는 agent. 열린 session으로 보내도 그 session의 agent)
     - `settings_edit`: `{ what: "instructions" | "agent_definition" | "skill" | "setting" | "grant", id: string | null }`
     - `app_resource`: `{ scope: appGrantScopeSchema }` (net.fetch, secret.use, fs 등)
     - `reaction`: `{ event: ReactionEventType }`
     - `activation`: `{ app, release }`
   - `intentOriginSchema`: `{ kind: "turn", session, turn, tool_call }` | `{ kind: "event", seq }` | `{ kind: "activation", app, release }`
   - `intentSchema = { kind, actor, target, effect, input: jsonObject, origin }`. `kind`와 `target.kind`가 같아야 한다(refine). `effect`는 호출하는 쪽이 읽어 넣는다(app-api는 활성 release 선언, MCP tool은 `readOnlyHint`). `agent_call`은 `read`(S2 3장), `reaction`·`activation`은 `read`로 두고 Gate는 effect 대신 grant로 판정한다. `settings_edit`는 `write`로 둔다. `input`은 정규화한 입력이다. activation의 `input`은 선언 비교 값이고 모양은 contract-releases-problems가 정한다(주석에 적는다).
   - `GATE_DENY_REASONS = ["not_granted", "excluded", "reaction_off"]`: grant 밖(대상이 grant에 없음), agent grant에서 뺀 app-api, reaction grant가 꺼짐.
   - `gateVerdictSchema`: `{ verdict: "deny", reason }` | `{ verdict: "run" }` | `{ verdict: "ask" }`
   - `gateGrantsSchema = { app: AppGrant[], agent: AgentGrant | null, reaction: ReactionGrant }`. Gate는 이 값과 intent만 본다. IO가 없다.
   - 이유 글은 만들지 않는다. 글은 호출하는 쪽이 wording key로 만든다.

4. `packages/protocol/approvals/requests.ts` — request, 결정, 결과 상태 (`I2.2#2`, `I2.2#4`, S2 6장)
   - 선택지
     - `TURN_CHOICES = ["once", "session", "always", "reject"]` (app-api, MCP tool)
     - `ALLOW_REJECT_CHOICES = ["allow", "reject"]` (activation, 설정 고치기, reaction)
     - `choicesFor(kind: IntentKind)` 순수 함수: `app_api`·`mcp_tool`이면 turn 선택지, 그 밖이면 allow·reject. (`app_api` 호출 주체가 앱이거나 `app_resource`·`agent_call`은 물음이 나오지 않으므로 allow·reject로 둔다.)
     - 거절 이유: `rejectReasonSchema = z.string().trim().min(1).max(500)`, 줄바꿈 없음.
   - 상태: `REQUEST_STATUSES = ["pending", "granted", "rejected", "cancelled"]`. `granted`는 접수다. 만료는 없다(S2 10장).
   - 적용 결과(보류 request만): `applyResultSchema = { state: "applied" } | { state: "failed", code: 공통 오류 코드, message }`. 허락의 접수(`granted`)와 적용의 성공을 따로 보인다. 적용 전에는 `null`이다.
   - `turnPermissionRequestSchema`: turn 안 request(메모리, session snapshot에 든다). `{ id: apr, session, turn, tool_call, intent, choices: 선택지 목록, fingerprint: sha256, created_at }`. `fingerprint`는 intent의 canonical hash이고 허락이 쓰이기 전에 같은 intent인지 다시 볼 때 쓴다(S2 6장 "결정 규칙").
   - `pendingApprovalSchema`: 보류 request(`approval_requests` 표 한 행). `{ id: apr, intent, choices, status, reject_reason: string | null, applied: ApplyResult | null, created_seq: seq, decided_seq: seq | null, created_at, decided_at: at | null }`. 설명 글, blob, `expires_at`, `requester`, `decided_by`는 없다(S2 11장 1).
   - `turnDecisionSchema` (turn이 이어 가는 값): `{ outcome: "allow", scope: "once" | "session" | "always" }` | `{ outcome: "reject", reason: string | null }` | `{ outcome: "cancelled", cause: "turn_ended" | "session_closed" | "restart" }`. cancelled는 거절과 구별해 요청자에게 간다(S2 6장).
   - route 셋. 모두 사람 자격이다(actors `["user"]`). `confirmation`을 선언하지 않는다. 카드에서 바로 결정한다(S2 8장, 아래 7).
     - `approvalsPending`: `defineRead`, resource `approvals`, method `pending`, name `ListPendingApprovals`. input `{}`, output `withReadCommon({ requests: PendingApproval[] })` (status pending만). renderer가 처음과 다시 붙을 때 읽는 snapshot이다.
     - `approvalsDecide`: `defineCommand`, resource `approvals`, method `decide`, name `DecideApproval`. input `{ request: apr, choice: { kind: "allow" } | { kind: "reject", reason?: string } }`. output `{ request: PendingApproval }`(접수 시점의 모양). 이미 결정됐거나 cancelled면 `conflict`. 한 tx로 결정과 domain event `ApprovalDecided`를 쓴다(구현은 wave 3).
     - `approvalsDecideTurn`: `defineMemory`, resource `approvals`, method `decide_turn`, name `DecideTurnPermission`. input `{ session, request: apr, choice: turnChoiceSchema }`. `turnChoiceSchema`는 `{ kind: "once" | "session" | "always" | "allow" }` | `{ kind: "reject", reason?: string }`이다. `choice.kind`가 그 request의 `choices`에 없으면 handler가 `invalid_input`으로 거절한다. output `{ outcome: TurnDecision }`.
   - `APPROVAL_DECISION_ROUTES = [approvalsPending, approvalsDecide, approvalsDecideTurn]`. 옛 `APPROVAL_ROUTES`와 합치는 것은 lead 등록이다.

5. `packages/core/approvals/ports.ts` — core approvals port (type만, 구현 없음)
   - `Gate = (intent: Intent, grants: GateGrants) => GateVerdict`. 순수 함수 type이다.
   - `Grants`: `appGrants(app): Promise<Result<AppGrant[]>>`, `agentGrant(agent): Promise<Result<AgentGrant>>`, `reactionGrant(): Promise<Result<ReactionGrant>>`, `setAlways(agent, target): Promise<Result<void>>`("항상" 선택의 효과: 그 대상의 agent grant를 `never`로 바꾼다)
   - `SessionAllowances` (메모리): `allow(session, key)`, `has(session, key): boolean`, `clear(session)`. `key`는 intent에서 만든 대상 key 문자열이다. session이 닫히거나 archive되거나 지워질 때 `clear`를 부른다. 재시작하면 사라지고 fork가 가져가지 않는다(S2 6장·11장 3, S8 5·6장). 저장하지 않는다는 것을 주석으로 적는다.
   - `ApprovalApplier = (request: PendingApproval) => Promise<Result<ApplyResult>>`: 보류 request가 허락됐을 때 그 종류(`activation` 또는 `reaction`)를 다시 검사하고 실행한다. 소유 module(releases, events)이 등록한다.
   - `Approvals` (Gate를 부르는 쪽이 쓰는 한 입구):
     - `judge(intent): Promise<Result<GateVerdict>>` — grant를 읽어 Gate를 돌리고, intent 출처가 turn이면 `SessionAllowances`를 본다. 허락돼 있으면 `ask`를 `run`으로 바꾼다.
     - `openTurnRequest(intent): Result<TurnPermissionRequest>` — 메모리에 두고 Bus에 `PermissionRequested`를 낸다.
     - `waitTurnDecision(request: apr): Promise<TurnDecision>`
     - `consumeTurnAllow(request: apr, current: Intent): Promise<Result<void>>` — 허락은 그 intent에 한 번만 쓰인다. 실행 직전에 `fingerprint`를 다시 비교해 다르면 `conflict`.
     - `cancelTurnRequests(session, cause): void` — turn 끝, session 닫힘, 시작 때 정리. `PermissionResolved(cancelled)`를 낸다.
     - `turnRequests(session): TurnPermissionRequest[]` — session snapshot이 읽는다.
     - `createPending(intent): Promise<Result<PendingApproval>>` — `approval_requests`에 쓰고 commit 뒤 `ApprovalRequested`를 낸다.
     - `registerApplier(kind: "activation" | "reaction", applier: ApprovalApplier): void`
     - `cancelPendingFor(app, release?): Promise<Result<number>>` — 더 새 release의 activation이 시작되면 이전 보류 request를 cancelled로 만든다(S2 11장 4).
   - Bus 등 다른 port는 `core/events/ports.ts`에서 type으로 import한다. 이 task가 contract-events보다 먼저 merge되므로, 그 import 줄은 두지 말고 `Approvals`의 주석에 "Bus는 생성자에서 받는다"고만 적는다. 필요한 곳은 wave 3이 채운다.

6. `packages/protocol/approvals/mod.ts`에 새 세 file을 `export *`로 더한다(옛 `export * from "./approvals.ts"`는 그대로). 이름 충돌이 있으면 새 이름을 바꾼다. 옛 이름은 바꾸지 않는다.

7. 옛 확인 창 계약: 처리는 이렇다 (`I2.2#4`, S2 8장 "approval 밖의 사람 결정")
   - approval 카드(권한 request, 보류 request)의 결정은 확인 창도 확인 handle도 없이 위 route로 받는다. 사람 token을 가진 shell main이 부르는 것이 곧 사람의 결정이고, agent·coding agent·앱·MCP server token은 route의 `actors`로 거절된다(S2 6장 "결정 규칙", req-0303).
   - 이 task는 확인 창 계약을 지우지도 새 IPC를 더하지도 않는다. `protocol/shell/confirmation.ts`, `shell/ipc/confirmation*.ts`, `shell/ipc/windowless-confirmation.ts`는 그대로 둔다. 옛 kind `approval_request`와 `question_option_action`(고정 action 선택지는 S4에서 없어졌다)은 쓰는 곳이 없어지고, 창을 지우는 일은 screens-data-secret-input(wave 3)과 cleanup이 한다. `secret_input` kind는 contract-platform·contract-shell이 새 보호 입력 IPC로 뗀다.
   - 남는 일: approval 밖의 사람 결정(앱 grant 거두기 `grantRevoke`, 문제 결정, 앱 rewind, 파일 지움, provider 연결)의 route는 지금 `confirmation: "required"`와 `binding`을 선언한다. S2 8장은 handle을 "화면을 누를 때 shell main이 발급"한다고 적었는데, screens-data-secret-input은 shell main의 handle 발급(`handle.ts`, `canonical.ts`, `decide.ts`)을 지운다. 둘이 어긋난다. 추천안은 그 route들에서 `confirmation`·`binding`·`display_read` 선언을 걷는 것이다(사람 token을 가진 main이 부르는 것이 곧 사람의 결정이다). 이 task는 `grantRevoke`를 포함해 아무 route도 고치지 않고 보고의 "계약 바꾸기 요청"에 적는다. lead가 계약 고정 때 정한다.
   - `windowless-confirmation.ts`(질문의 고정 action 선택지)는 지우지 않는다. 쓰는 곳을 없앤 뒤 cleanup이 지운다.

8. 옛 것 가운데 이 task가 지우지 않는 것 (보고의 "안 쓰게 된 export"에 적는다)
   - `HANDOFF_DIRECTIONS`, `handoffAllowed` (`I1.3#3`, `protocol/lophn-agent/decision-values.ts`). 부를 수 있는지는 agent grant(`agentGrantEntry` `kind: "agent"`)가 정한다. 쓰는 곳은 `handoffs.ts`(contract-calls-places), `run-loop/commands.ts`(router), `roles/app-engineer/interview.ts`(agent-definition)다. 모두 call로 옮긴 뒤 cleanup이 지운다.
   - 옛 approval 생명주기 domain event 다섯(`ApprovalRequestCreated` 등, `I1.2#11`)과 `APPROVAL_EVENTS`. `ApprovalRequested`(남지 않는 event)와 `ApprovalDecided`(domain event)는 contract-events가 둔다. 옛 다섯을 emit하는 `core/approvals/commands.ts`는 wave 3 approvals-requests가 그만 쓴다.
   - `applyApprovedAction`, `approvalBinding*`, 옛 route 여덟, `ApprovalAction`·`ApprovalEffect`·`ApprovalRequest`.
9. (lead가 맞추며 더함) S2 8장: 확인 창 없이 사람 결정 handle을 발급하는 IPC를 고정한다. renderer가 기능 화면(문제 결정, 앱 rewind, 파일 지움, provider 연결, 질문 선택지 action)에서 누르면 shell main에 handle을 청한다. shell main이 core에 handle을 등록해 돌려주고, renderer는 그 handle로 `confirmation: required` route를 부른다. route의 `confirmation` 선언은 남긴다. 옛 확인 창 IPC는 옆에 두고 screens-data가 지운다.
10. (lead가 맞추며 더함) Gate intent의 origin에 앱이 부른 호출(`app`)을 더한다. 앱이 다른 앱의 app-api를 부를 때 쓴다(app-calls 보고). 도는 호출의 부모를 모르면 막는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (type과 schema만 있다. 판정 구현은 wave 3의 approvals-gate가 test한다)
- 남지 않음: 해당 없음. 옛 계약은 지우지 않는다. 새 file의 export 이름이 `packages/protocol/approvals/approvals.ts`, `packages/protocol/apps/grants.ts`의 옛 export와 겹치지 않는다(`deno check`가 잡는다).

## 보고

- 바꾼 file
- 등록할 것: `packages/protocol/registry.ts`의 `ROUTES`에 `AGENT_GRANT_ROUTES`와 `APPROVAL_DECISION_ROUTES`를 더한다(lead). 옛 `APPROVAL_ROUTES`는 wave 3이 끝난 뒤 cleanup이 뺀다. `protocol/apps/mod.ts` 목록에는 새 export가 있으면 더한다.
- 안 쓰게 된 export: 위 "할 일" 8
- 정한 것
  - agent grant와 intent는 agent를 `AgentRef`로 가리킨다. S2의 "agent ID"는 contract-calls-places가 정한 `AgentRef`(Operator만 `agt` id)로 읽었다. 지금 코드의 `asg`(Assignment)는 쓰지 않는다.
  - 새 `app_resource` intent kind(S2 5장 표에는 있으나 `kind` 줄에는 없다)
  - agent grant 저장 위치는 wave 3 approvals-gate가 `core/approvals`의 새 표로 정한다.
  - 새 결정 route 셋은 `confirmation`을 선언하지 않는다. 사람 token을 가진 shell main이 부르고, agent·coding agent·앱 token은 `actors`로 거절된다. 확인 handle IPC(`shell:decide`)는 더하지 않았다.
- 계약 바꾸기 요청: approval 밖의 사람 결정 route의 `confirmation`·`binding`·`display_read` 선언을 걷을지(위 7 "남는 일"). 추천은 걷는 것이다.
