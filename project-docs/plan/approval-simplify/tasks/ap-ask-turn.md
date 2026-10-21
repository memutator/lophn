# ap-ask-turn

묻는 길을 turn 안 request 하나로 다시 짠다. tool gate는 새 `judge`와 할당을 쓰고, turn request는 선택지 `once | always | reject`만 받는다. "이 session 동안" 허락, fingerprint와 consume, `changed`, 옛 Gate와 intent 판정을 지우고, coding harness 물음 비추기도 새 모양으로 옮긴다.

- 단위: ask (wave 2)
- 선행: ap-ask-pending, ap-app-call
- 소유(이 task만 고친다):
  - `packages/core/approvals/registration.ts`
  - `packages/core/lophn-agent/tools/mod.ts`
  - `packages/core/lophn-agent/tools/spi.ts`
  - `packages/core/approvals/{approvals.ts,ports.ts,turn-requests.ts,model.ts,mod.ts,approvals_test.ts}`
  - `packages/core/approvals/gate/{gate.ts,gate_test.ts}`(지운다)
  - `packages/core/approvals/gate/mod.ts`
  - `packages/core/approvals/grants/{grants.ts,model.ts,session-allowances.ts,mod.ts}`
  - `packages/core/main/daemon/wiring/{approvals.ts,approvals_test.ts,session-snapshots.ts,context.ts}`
  - `packages/protocol/approvals/tool-gate.ts`
  - `packages/protocol/events/{agent.ts,snapshot.ts}`
  - `packages/core/lophn-agent/tool-judgment/`
  - `packages/core/lophn-agent/tools/{work.ts,registry.ts,registry_test.ts,ports.ts,app-tools.ts}`
  - `packages/core/lophn-agent/extensions/mcp-tools.ts`
  - `packages/core/apps/tickets/coding/hook.ts`
  - `packages/shell/main/desktop/core/{routes.ts,allowlist.ts}`
  - `packages/shell/renderer/desktop/connection/waiting/fake-source.ts`(새 snapshot 칸 한 줄만)
  - `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`(새 snapshot 칸 한 줄만)
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것", "뼈대 검토에서 정한 것"(`always`의 줄, MCP server는 설정한 층이 할당, 새 event 이름은 옛것 옆에 두고 cleanup이 옛것을 지운다), "사람이 정할 것" 1(추천: 할당한 tool의 바깥 효과를 묻지 않는다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "묻는 길은 하나다"(선택지 셋, "이 session 동안" 없음, 물은 입력을 그대로 실행, 재시작하면 cancelled), "정한 것(agent)"(fingerprint를 두지 않는다), "묻지 않는 것"의 coding agent 줄
  - architecture: `project-docs/architecture/approval.md`("request" 절: 침묵은 결정이 아니다, cancelled와 거절을 구별한다, 카드 내용은 program이 만든다, turn 안 request는 재시작 때 cancelled), `project-docs/architecture/event.md`(agent event, session snapshot), `project-docs/architecture/coding-agent.md`(harness의 권한 물음은 대기 목록에 보이기만 하고 답은 터미널에서 한다), `project-docs/architecture/agent-definition.md`(tool 목록은 session을 시작할 때 고정한다), `project-docs/architecture/place-session.md`(끝날 때 대기 request는 cancelled)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `run-loop`, `agent-tools`, `agent-tool-spi`, `event-stream`, `app-tickets`, `project-docs/module-catalog.yaml`의 `packages/core/approvals`, `packages/core/lophn-agent`, `packages/core/main`, `packages/protocol`, `packages/shell/main`
  - 계약: `project-docs/plan/approval-simplify/tasks/ap-contract.md`의 `gate-call.ts`, `turn-request.ts`(`always_patterns`), `assignment.ts`, `packages/protocol/lophn-agent/turn-values.ts`의 `TurnMode`. `ap-gate.md`(`judge`, `alwaysPatterns`), `ap-assign-store.md`(`loadAssignment`)
  - 코드
    - 지금의 묻는 길: `packages/core/approvals/{approvals.ts,ports.ts,turn-requests.ts,model.ts}`, `packages/core/approvals/grants/{grants.ts,model.ts,session-allowances.ts}`, `packages/core/lophn-agent/tool-judgment/tool-gate.ts`, `packages/core/main/daemon/wiring/approvals.ts`(`toolGateHandler`, `decideTurn`, `human` AsyncLocalStorage, TurnEnded·SessionEnded 구독, `gating`)
    - runtime 쪽 길: `packages/core/lophn-agent/tools/work.ts`(`executeToolCall`, `askGate`), `packages/core/lophn-agent/tools/registry.ts`(`GateRequest`, `ToolDefinition.gate`), `packages/core/lophn-agent/tools/define.ts`(`ToolDefinition["gate"]`를 따른다. 고치지 않는다), `packages/core/main/agent-runtime/product-driver.ts`(`gate.check`를 `toolGateCheck`로 넘긴다. 고치지 않는다), `packages/core/lophn-agent/run-loop/core-ports.ts`의 `paused`(`kind === "run"`만 본다. 고치지 않는다)
    - Gate를 다는 tool: `packages/core/lophn-agent/extensions/mcp-tools.ts`(`buildMcpTools`의 `gate`), `packages/core/lophn-agent/tools/app-tools.ts`(지금 gate가 없다)
    - coding 비추기: `packages/core/apps/tickets/coding/hook.ts`(`permissionRequest`, `PermissionRequested`·`PermissionResolved` 신호), `packages/protocol/coding-agent/hook-signal.ts`(`request` 모양)
    - 등록: `packages/core/approvals/registration.ts`의 `memoryRoutes`, `packages/core/main/daemon/core.ts`(memory route와 handler가 맞지 않으면 기동이 멈춘다)
- 계약:
  - 쓰는 것: `judge`, `alwaysPatterns`(ap-gate), `loadAssignment`(ap-assign-store), `GateCall`, `Judgment`, `TurnMode`, `TurnRequest`, `turnRequestChoiceSchema`, `TurnRequestOutcome`, `turnRequestDecide`, `PRODUCT_SHELL_RULES`(ap-contract)
  - 내놓는 것:
    - memory route `tool_gate/check`(`CheckToolGate`): 입력 `{session, turn, tool_call, tool, call: GateCall}`, 결과 `{kind: "run"}` | `{kind: "denied", reason: DenyReason}` | `{kind: "rejected", reason: string | null}` | `{kind: "cancelled", cause}`. `changed`가 없다.
    - `ToolDefinition.gate`는 `GateCall | null`을 돌려준다(`GateRequest`가 없다). 앱 tool과 MCP tool은 gate를 단다(바깥 효과 줄을 켤 자리).
    - `Approvals`: `judge(call: GateCall, who: {agent, session, place, mode}): Promise<Result<Judgment>>`, `openTurnRequest(origin: {session, turn, tool_call, place}, subject): Result<TurnRequest>`(shell subject면 `alwaysPatterns`로 `always_patterns`를 채우고 그 밖은 빈 배열), `waitTurnDecision`, `cancelTurnRequests`, `turnRequests(session)`, `remember(kind, effect: (request: TurnRequest, place) => Promise<Result<void>>)` 등록. `always`는 `always_patterns`가 비어 있지 않고 그 kind에 등록된 효과가 있을 때만 받고, 아니면 `invalid_input`이다(shell 줄 더하기는 ap-shell-gate가 등록한다). mode는 아직 늘 `attended`로 넘긴다(ap-mode-turn이 turn의 mode로 바꾼다).
    - memory route `turn_requests/decide`(`DecideTurnRequest`)의 handler와 shell `SHELL_ROUTES`·renderer allowlist의 그 route. 옛 `approvals/decide_turn` handler가 없다.
    - agent event `TurnRequestOpened`, `TurnRequestClosed`와 session snapshot `turn_requests`. coding harness 물음도 `subject.kind: "harness"`로 같은 event를 낸다. core는 `PermissionRequested`·`PermissionResolved`·`permission_requests`를 채우지 않는다(정의는 ap-cleanup이 지운다).

## 할 일

근거는 README "정한 것"과 roadmap "묻는 길은 하나다"다. 한 덩어리로 한다: protocol `tool-gate.ts`의 입력이 runtime(`work.ts`)과 core(`toolGateHandler`) 둘에서 쓰여, 나누면 한쪽이 compile되지 않는다. 옛 protocol(`intent.ts`, `requests.ts`, agent grant)은 지우지 않는다(shell이 아직 쓴다. ap-cleanup).

protocol

1. `packages/protocol/approvals/tool-gate.ts`를 다시 쓴다.
   - `toolGateInputSchema = z.strictObject({session: idSchema("ses"), turn: idSchema("trn"), tool_call: idSchema("tcl"), tool: z.string().min(1), call: gateCallSchema})`.
   - `toolGateResultSchema`: run, denied(`reason: denyReasonSchema`), rejected(`reason: z.string().nullable()`), cancelled(`cause: z.enum(["turn_ended", "session_closed", "restart"])`). `changed`는 없다.
   - `toolGateCheck` route는 이름·자격(`agent`)·errors 그대로다. import에서 `intent.ts`·`grants.ts`를 뺀다. 머리 주석의 "허락 소비"를 지운다.
2. `packages/protocol/events/agent.ts`
   - `TurnRequestOpened {request: turnRequestSchema}`, `TurnRequestClosed {request: idSchema("apr"), outcome: z.enum(["allow", "reject", "cancelled"])}`를 `defineAgentEvent`로 더하고 `agentEventSchema`에 넣는다. 옛 `PermissionRequested`·`PermissionResolved`는 그대로 둔다.
   - 머리 주석: coding agent는 harness가 물어 올 때 `TurnRequestOpened`·`TurnRequestClosed`를 낸다.
3. `packages/protocol/events/snapshot.ts`: `turn_requests: z.array(turnRequestSchema)`를 더한다. `permission_requests`는 그대로 둔다(core는 빈 배열을 채운다).

core approvals

4. `packages/core/approvals/ports.ts`를 다시 쓴다.
   - `Approvals`: `judge(call: GateCall, who: {agent: AgentRef; session: string; place: Place | null; mode: TurnMode}): Promise<Result<Judgment>>`, `openTurnRequest(origin: {session; turn; tool_call; place: Place | null}, subject: TurnRequest["subject"]): Result<TurnRequest>`, `waitTurnDecision(request: string): Promise<TurnRequestOutcome>`, `cancelTurnRequests(session, cause)`, `turnRequests(session): TurnRequest[]`, `remember(kind: GateCall["kind"], effect: AlwaysEffect): void`.
   - `type AlwaysEffect = (request: TurnRequest, place: Place | null) => Promise<Result<void>>`.
   - `Gate`, `Grants`, `SessionAllowances`, `consumeTurnAllow`를 지운다.
5. `packages/core/approvals/turn-requests.ts`를 다시 쓴다(메모리, 꺼지면 비어 있다는 머리 주석은 남긴다).
   - deps: `bus`, `clock`, `ids`, `shellRules(place): ShellRuleLayers`.
   - 항목: `{request, place, closed, outcome, waiters}`. `used`와 fingerprint는 없다.
   - `open(origin, subject)`: `always_patterns`는 subject가 shell이면 `alwaysPatterns(deps.shellRules(origin.place), subject.command)`, 아니면 `[]`. 저장하고 Bus에 `{session, type: "TurnRequestOpened", at, payload: {request}}`를 낸다.
   - `resolve`는 `TurnRequestClosed {request: id, outcome: outcome.outcome}`를 낸다.
   - `decide(session, id, choice, effects)`: 없거나 다른 session이면 `not_found`, 닫혔으면 `conflict`. `once` → `{outcome: "allow", scope: "once"}`. `reject` → `{outcome: "reject", reason: choice.reason ?? null}`. `always` → `always_patterns`가 비었거나 `effects.get(subject.kind)`가 없으면 `invalid_input`(항목은 열린 채). 있으면 먼저 닫고 효과를 부른다. 효과가 err이면 다시 열고 그 err를 돌려준다. 효과를 기다리는 사이 cancelled가 되었으면 `conflict`. 아니면 `{outcome: "allow", scope: "always"}`.
   - `wait`, `cancel(session, cause)`, `list(session)`은 지금과 같다(`cancel`의 `allowances.clear`는 지운다).
6. `packages/core/approvals/approvals.ts`를 다시 쓴다.
   - `createApprovals(deps: {assignmentOf(agent): Promise<Result<AgentAssignment>>, shellRules(place): ShellRuleLayers, bus, clock, ids})`.
   - `judge(call, who)`: 앱 tool이면 `assignmentOf(who.agent)`(err면 그 err), 아니면 할당 null. `ok(judge(call, assignment, deps.shellRules(who.place), who.mode))`(ap-gate).
   - `remember`는 kind → 효과 Map에 넣는다(같은 kind를 두 번 넣으면 뒤 것).
   - `ApprovalsService = Approvals & { decide(ctx: {actor: string}, body: unknown): Promise<Result<{outcome: TurnRequestOutcome}>> }`. `ctx.actor !== "user"`면 `forbidden`, `turnRequestDecide.input` parse 실패면 `invalid_input`, 그다음 `decide`. 옛 `decideTurn`은 없다.
7. 지운다: `packages/core/approvals/model.ts`(fingerprint, `choiceOffered`. 남는 것이 없다), `packages/core/approvals/gate/gate.ts`, `packages/core/approvals/gate/gate_test.ts`, `packages/core/approvals/grants/grants.ts`(`createGrants`), `packages/core/approvals/grants/model.ts`(`withNever`), `packages/core/approvals/grants/session-allowances.ts`.
   - 지우기 전에 `git grep -nwE "createGrants|withNever|createSessionAllowances|allowanceKey|intentFingerprint" -- packages`와 `git grep -nE "\{[^}]*\bgate\b[^}]*\} from|gate/gate\.ts" -- packages/core`로 소유 밖 importer를 본다. ap-call-judge(`router-registration.ts`), ap-app-call(`apps/calls/gate.ts`), ap-reaction, ap-activation이 끊었어야 한다. 남았으면 고치지 말고 file:줄을 보고한다.
8. `packages/core/approvals/gate/mod.ts`: `gate` export를 지운다(`judge`, `alwaysPatterns`만).
9. `packages/core/approvals/grants/mod.ts`: `createGrants`, `allowanceKey`, `createSessionAllowances` export를 지운다. `AgentOfSession`, `agentGrantRegistration`, `reactionSettings`, `loadAgentGrant`는 남는다(ap-cleanup).
10. `packages/core/approvals/mod.ts`: `gate`, `createGrants`, `createSessionAllowances`, `allowanceKey`, `intentFingerprint`, `Gate`·`Grants`·`SessionAllowances` type을 지우고 `judge`, `alwaysPatterns`(gate/mod.ts)와 `AlwaysEffect` type을 더한다.
11. `packages/core/approvals/registration.ts`: `memoryRoutes`의 `approvalsDecideTurn`을 `turnRequestDecide`로 바꾼다. 기동은 memory route와 handler가 짝이 맞아야 뜬다(`packages/core/main/daemon/core.ts`).

core tool path

12. `packages/core/lophn-agent/tool-judgment/tool-gate.ts`를 다시 쓴다.
    - `ToolGateCall = {session, turn, toolCall, agent: AgentRef, place: Place | null, mode: TurnMode, tool: string, call: GateCall}`.
    - `createToolGate({approvals: Pick<Approvals, "judge" | "openTurnRequest" | "waitTurnDecision">})`. `resolve`는 없다(호출이 이미 `GateCall`이다).
    - `check(call): Promise<Result<ToolGateResult>>`: `judge`가 err면 그 err. deny → `{kind: "denied", reason}`, run → run, ask → `openTurnRequest`(err면 그 err) → `waitTurnDecision` → allow는 run, reject는 rejected, cancelled는 cancelled. 허락 뒤 다시 판정하거나 비교하지 않는다(roadmap "물은 입력을 그대로 실행한다").
    - 정한 것: 판정이나 request 열기가 실패하면 route 오류로 돌려준다. 이유: 새 거절 이유를 만들지 않는다. runtime은 오류면 실행하지 않고 `unavailable`로 끝낸다(`work.ts`의 `askGate` 첫 분기).
    - `tool-gate_test.ts`(fingerprint test)를 지운다. `tool-judgment/mod.ts`는 `createToolGate`, `ToolGateCall`, `ToolGateDeps`를 낸다.
13. `packages/core/main/daemon/wiring/approvals.ts`
    - `createApprovals` 조립: `assignmentOf`는 ledger를 열어(`openConnection(ctx.ledgerPath)`) `loadAssignment`를 부르고 닫는다(옛 `read(path)` 꼴). `shellRules`는 `() => ({floor: PRODUCT_SHELL_RULES.floor, layers: [PRODUCT_SHELL_RULES.ask]})`(Settings 층은 ap-shell-gate가 더한다).
    - `toolGateHandler(deps: {approvals, sessionOf(session): Promise<Result<{agent: AgentRef, place: Place | null}>>})`: 입력 parse, `ownTurn`, `sessionOf`(`agentSessionRead`로 agent와 place. coding_agent session은 `forbidden`), `createToolGate(...).check({..., mode: "attended"})`. check가 err면 그 err를 돌려준다.
    - memory: `[key(turnRequestDecide), (who, body) => service.decide(who, body)]`. `approvalsDecideTurn` 줄을 지운다.
    - `gating` 감싸기는 `openTurnRequest(origin, subject)`의 `origin.session`을 담는다.
    - 지운다: `human` AsyncLocalStorage, `createGrants`·`appGrantsList`·`APPS_CONTROL_CONTEXT`·`agentGrantsSet`·`loadAgentGrant`·`createSessionAllowances`·`gate` import, `writeAgentGrant`. `send`, `DEFAULT_SETTINGS`, `settings`가 쓰는 곳이 없어지면 지운다.
14. `packages/core/main/daemon/wiring/approvals_test.ts`: 입력을 `call: {kind: "mcp_tool", server: "s", tool: "t", effect: "write"}`로, fake approvals를 `judge`·`openTurnRequest`·`waitTurnDecision`으로, `agentOf`를 `sessionOf`로 바꾼다. 이름을 "다른 session·turn의 자격으로는 Gate route를 부르지 못한다"로 바꾼다(소비가 없다). 판정(다른 자격은 `forbidden`이고 approvals에 닿지 않는다)은 그대로다.
15. `packages/core/main/daemon/wiring/session-snapshots.ts`: lophn과 coding 줄 모두 `turn_requests: requests(...)`, `permission_requests: []`. waiting 상태는 `turn_requests` 또는 질문이 있을 때다. 머리 주석의 "권한 요청"을 turn 안 request로 고친다.
16. `packages/core/main/daemon/wiring/context.ts`: `approvals` 칸의 type은 그대로, 주석만 맞으면 둔다.

runtime tool path

17. `packages/core/lophn-agent/tools/registry.ts`: `GateRequest`와 `Intent` import를 지우고 `gate?: (input, ctx) => GateCall | null | Promise<GateCall | null>`. 주석의 "intent"를 "Gate에 넘길 호출"로 고친다.
    - `packages/core/lophn-agent/tools/mod.ts`와 `spi.ts`가 `GateRequest`를 다시 export한다. 그 이름 하나만 export 목록에서 뺀다.
18. `packages/core/lophn-agent/tools/work.ts`: `askGate`는 `ctx.gate.check({session, turn, tool_call, tool, call: request})`. `changed` 분기를 지운다. `denied` 문구 `tool call was denied (${reason})`는 그대로다.
19. `packages/core/lophn-agent/tools/ports.ts`: `ToolGatePort`의 주석에서 "허락 소비"를 지운다(type은 protocol을 따른다). `GateRequest` import가 남아 있으면 지운다(ap-settings-edit가 `writeGate`를 지웠다).
20. `packages/core/lophn-agent/tools/app-tools.ts`: 정의에 `gate: () => ({kind: "app_tool", app: view.app, tool: tool.name, effect: tool.effect})`를 단다. 머리 주석과 `operations` 위 주석("Gate는 core의 호출 경로가 건다")을 "묻기는 run-loop tool gate, 막기는 core 호출 경로"로 고친다. `AgentGrantEntry`와 `grantAllows`는 그대로다(ap-assign-tools).
21. `packages/core/lophn-agent/extensions/mcp-tools.ts`: `gate: () => ({kind: "mcp_tool", server: entry.server, tool: entry.original, effect})`. 머리 주석의 "묻는지는 agent grant가 정하고"를 "MCP server는 설정한 층이 할당이고, 묻는지는 Gate가 정한다"로 고친다. tool 목록 만들기(`buildMcpTools`의 선택)는 고치지 않는다.
22. `packages/core/lophn-agent/tools/registry_test.ts`: 시험용 `operator.update`의 gate를 `{kind: "app_tool", app: "app_…", tool: "notes.add", effect: "write"}`로, fake `check`가 `call.call.kind`를 담게 바꾼다. "Gate가 막은 tool은 실행되지 않고 Gate 없는 tool은 Gate를 거치지 않는다"의 판정은 그대로다(`asked`가 `["app_tool"]`).

coding 비추기

23. `packages/core/apps/tickets/coding/hook.ts`: `permissionRequest`가 `TurnRequest`를 만든다: `{id: tx.newId("apr"), session, turn, tool_call: tx.newId("tcl"), subject: {kind: "harness", harness: row.harness, tool: request.tool, summary: request.summary}, always_patterns: [], created_at: tx.now()}`. 신호 `PermissionRequested`에서 agent event `TurnRequestOpened {request}`, 신호 `PermissionResolved`에서 `TurnRequestClosed {request: id, outcome: "allow"}`를 낸다. `choicesFor`·`Intent`·`intentFingerprint` import를 지운다. 신호 이름(`HookSignal`의 `PermissionRequested`·`PermissionResolved`)은 harness 쪽 이름이라 그대로다.

shell

24. `packages/shell/main/desktop/core/routes.ts`: `turnRequestDecide`를 `SHELL_ROUTES`에 더한다(`APPROVAL_DECISION_ROUTES` 줄은 ap-cleanup이 지운다).
25. `packages/shell/main/desktop/core/allowlist.ts`: `"memory:approvals/decide_turn"`을 `"memory:turn_requests/decide"`로 바꾸고 위 주석을 맞춘다. 화면이 새 route를 부르는 것은 ap-waiting·ap-conversation이다(그 사이 화면의 결정은 `not_found`다. wave 2는 같이 land한다).
26. `packages/shell/renderer/desktop/connection/waiting/fake-source.ts`의 `snapshotOf`, `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`의 snapshot 둘에 `turn_requests: []` 한 줄씩. 다른 곳은 고치지 않는다(ap-waiting).

test

27. `packages/core/approvals/approvals_test.ts`: 남은 두 test("이 session 동안 허락은…", "허락은 그 intent에 한 번만 쓰인다")를 지운다. 새 test 하나: `createApprovals`를 fake deps로 만들고 shell subject로 `openTurnRequest`를 연 뒤, `decide`를 `agent:ses_…`, `coding_agent:ses_…`, `machine` 자격으로 부르면 모두 `forbidden`이고 request가 `turnRequests`에 열린 채 남는다. 메모리뿐이다(`.claude/skills/write-test/SKILL.md` 층 1~2).

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "사람이 아닌 자격은 turn request를 결정하지 못한다"(`packages/core/approvals/approvals_test.ts`, 새로)
  - "다른 session·turn의 자격으로는 Gate route를 부르지 못한다"(`packages/core/main/daemon/wiring/approvals_test.ts`, 이름만 바꿈)
  - "Gate가 막은 tool은 실행되지 않고 Gate 없는 tool은 Gate를 거치지 않는다"(`packages/core/lophn-agent/tools/registry_test.ts`, 준비만 바꿈)
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(memory route `turn_requests/decide`와 handler가 짝이 맞는다).
- 남지 않음:
  - `git grep -nwE "consumeTurnAllow|intentFingerprint|SessionAllowances|createSessionAllowances|allowanceKey|setAlways|withNever|createGrants|GateRequest|GateVerdict|GateGrants|approvalsDecideTurn|DecideTurnPermission|decideTurn" -- packages/core packages/shell/main`가 0줄이다.
  - `git grep -n "\"changed\"" -- packages/protocol/approvals/tool-gate.ts packages/core/lophn-agent/tool-judgment packages/core/lophn-agent/tools/work.ts`가 0줄이다.
  - `git grep -nE "\"PermissionRequested\"|\"PermissionResolved\"" -- packages/core`의 남은 줄이 `packages/core/apps/tickets/coding/hook.ts`의 `case` 두 줄(harness 신호 이름)뿐이다.
  - `git ls-files packages/core/approvals | grep -E "gate/gate(_test)?\.ts|grants/(grants|model|session-allowances)\.ts|approvals/model\.ts"`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). protocol의 `turnPermissionRequestSchema`, `approvalsDecideTurn`, `TurnDecision`, `TurnChoice`, `choicesFor`, `intentSchema`, `GateVerdict`, `GateGrants`, `effectSchema`, `PermissionRequested`·`PermissionResolved` 정의는 shell이 끊은 뒤 ap-cleanup이 지운다고 적는다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 아래는 확인해 적는다
  - session 도중 MCP server를 끄거나(`mcp_off`) 지우면 고정한 tool 목록에는 남고 `judge`는 MCP tool에 `run`을 낸다. 그 호출을 연결 쪽(`packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `call`)이 막는지 본다
  - 화면의 결정은 ap-waiting·ap-conversation이 새 route로 옮길 때까지 `not_found`다
