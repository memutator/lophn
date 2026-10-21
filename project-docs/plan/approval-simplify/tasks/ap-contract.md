# ap-contract

approval-simplify가 기대는 새 protocol 모양을 옛것 옆의 새 file로 고정한다. schema, type, 상수, route 정의만 만들고 등록하거나 쓰지 않는다. 쓰는 쪽을 바꾸고 옛것을 지우는 일은 뒤 task가 한다.

- 단위: contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/turn-values.ts`(turn mode 이름 셋만 더한다)
  - `packages/protocol/approvals/gate-call.ts`(새 file)
  - `packages/protocol/approvals/shell-rules.ts`(새 file)
  - `packages/protocol/approvals/assignment.ts`(새 file)
  - `packages/protocol/approvals/turn-request.ts`(새 file)
  - `packages/protocol/apps/activation/consent.ts`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것", "뼈대 검토에서 정한 것"(shell 규칙의 pattern, `always`의 줄, MCP server는 설정한 층이 할당, unattended는 답과 늦은 알림에도 실림, turn mode는 시작 때 정하고 안 바뀜, fork는 skip을 안 가져감, activation 동의 대기는 ledger 표, 새것은 옛것 옆), "사람이 정할 것" 1(추천: 할당한 tool의 바깥 효과를 묻지 않는다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "모양"(turn mode 표, 묻는 길, shell 규칙, 할당), "정한 것(사람)", "정한 것(agent)"
  - architecture: `project-docs/architecture/approval.md`(지금 Gate·request 모양. 이 계획이 바꾸는 대상), `project-docs/architecture/agent-call.md`(봉투 칸, 늦은 실패 알림), `project-docs/architecture/activation.md`(묻는 조건), `project-docs/architecture/event.md`(agent event, 남지 않는 event, session snapshot)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `core-api`, `event-stream`, `project-docs/module-catalog.yaml`의 `packages/protocol`
  - 코드(본보기. 이 task는 고치지 않는다)
    - 옛 모양: `packages/protocol/approvals/grants.ts`(agent grant, `agentGrantsGet`·`agentGrantsSet`의 꼴), `packages/protocol/approvals/requests.ts`(`rejectReasonSchema`의 한 줄 규칙, `approvalsDecideTurn`의 꼴), `packages/protocol/approvals/tool-gate.ts`
    - `packages/protocol/base/route.ts`(resource·method는 `^[a-z][a-z0-9_-]*$`, `errors`는 공통 일곱 가운데서 필수), `packages/protocol/base/envelope.ts`(`withReadCommon`은 `z.object`를 받는다), `packages/protocol/base/ids.ts`(`idSchema`, 접두사 `apr`·`prj`·`app`·`rel`·`ses`·`trn`·`tcl`), `packages/protocol/base/values.ts`(`atSchema`)
    - `packages/protocol/apps/activation/activation.ts`(`activationComparisonSchema`, activation route의 이름 꼴 `activation.<동사>`·`activations.<읽기>`), `packages/protocol/config/declaration.ts`(`SETTING_KEY`), `packages/protocol/coding-agent/harness-id.ts`(`harnessIdSchema`)
- 계약:
  - 쓰는 것: `defineCommand`·`defineRead`·`defineMemory`(`packages/protocol/base/route.ts`), `idSchema`, `atSchema`, `withReadCommon`, `toolEffectSchema`(`packages/protocol/lophn-agent/tool-values.ts`), `TurnMode`(이 task가 `packages/protocol/lophn-agent/turn-values.ts`에 더한다), `toolKeySchema`(`packages/protocol/apps/channel-values.ts`), `agentRefSchema`(`packages/protocol/lophn-agent/places.ts`), `activationComparisonSchema`(`packages/protocol/apps/activation/activation.ts`), `HarnessId`(`packages/protocol/coding-agent/harness-id.ts`)
  - 내놓는 것(뒤 task가 import한다. 이름과 모양을 바꾸지 않는다. 옛 이름과 겹치지 않아 `mod.ts`가 같이 export한다):
    - `packages/protocol/lophn-agent/turn-values.ts`: `TURN_MODES = ["attended", "unattended", "skip"]`, `turnModeSchema`, `TurnMode`. approvals protocol은 이것을 lophn-agent에서 import한다(approvals가 이미 lophn-agent를 import하므로 approvals에 두면 lophn-agent의 `turns.ts`가 approvals를 import해 `protocol-cycle`이 된다). mode가 사는 곳(여기에는 이름만 있고 칸은 뒤 task가 더한다):
      - turn: `turns.mode` 열, `StartTurn` 입력 `mode`, `turnRecordSchema.mode`. turn을 시작할 때 한 번 정하고 끝날 때까지 바꾸지 않는다. 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다(ap-mode-turn).
      - session: `sessions.skip`(boolean), session record `skip`, 사람만 부르는 command `ChangeSessionSkip`(resource `sessions`, method `change-skip`, 입력 `{session, skip}`, compare `{state_seq}`, actors `user`). 새 Operator session은 정의의 `skip: true`면 켜진 채 열린다. fork한 session은 skip을 가져가지 않고 정의의 기본값으로 시작한다(ap-skip-session).
      - 봉투: `unattended: boolean`이 `CallEnvelope`, `RoutedInput`(메모리), `agent_calls` 행에 있다. 받은 메시지 기록(`receivedEnvelopeSchema`, `messages`)에는 싣지 않는다. 받은 turn의 mode는 메모리의 `RoutedInput`에서 정하고 `turns.mode`에 남는다. `SendCall`·`ReplyCall` 입력에는 `unattended?: true`로 실린다. call·reply tool이 그 turn의 mode로 채우고 model 입력에는 없다. 그 call의 답과 늦게 오는 실패, 취소 알림도 call의 표시를 싣는다(ap-mode-envelope, ap-mode-turn).
      - 정하는 규칙(`turnModeOf`, ap-mode-turn): turn을 연 입력의 봉투가 unattended면 `unattended`, 아니면 session이 skip이면 `skip`, 그 밖(사람 메시지, reaction, attended turn이 보낸 call·reply와 그 알림)은 `attended`다. unattended call이 연 skip session도 unattended로 남아 사슬이 표시를 잇는다.
    - `gate-call.ts`:
      - `gateCallSchema`(`GateCall`), `kind`로 가른다: `{kind: "app_tool", app: Id<"app">, tool: ToolKey, effect: ToolEffect}` | `{kind: "mcp_tool", server: string, tool: string, effect: ToolEffect}` | `{kind: "shell", command: string}`
      - `DENY_REASONS = ["not_assigned", "removed", "shell_rule"]`, `denyReasonSchema`(`DenyReason`)
      - `judgmentSchema`(`Judgment`): `{kind: "run"}` | `{kind: "ask"}` | `{kind: "deny", reason: DenyReason, pattern: string | null}`. `pattern`은 `shell_rule`일 때 막은 규칙이고 나머지는 null이다.
      - Gate(core가 구현, ap-gate): `judge(call: GateCall, assignment: AgentAssignment | null, shell: ShellRuleLayers, mode: TurnMode): Judgment`. IO 없는 순수 함수다.
    - `shell-rules.ts`:
      - `SHELL_RULE_ACTIONS = ["allow", "ask", "deny"]`, `shellPatternSchema`, `shellRuleSchema`(`ShellRule`) `{pattern: string, action}`.
      - pattern: `*`는 아무 글자(없는 것 포함)에 맞는다. `*`가 없는 pattern은 그 명령과 똑같을 때만 맞는다. 끝이 ` *`인 pattern은 그 앞까지만 있어도 맞는다(`git push *`는 `git push`에도 맞는다). 맞추기 전에 앞뒤 공백을 자르고 이어진 공백을 하나로 본다.
      - `ShellRuleLayers = {floor: readonly ShellRule[], layers: readonly (readonly ShellRule[])[]}`. 명령 전체와, `&&`·`||`·`;`·`|`·줄바꿈으로 나눈 조각 각각에 규칙을 댄다. 하나에 대는 순서: floor에 맞으면 deny, 아니면 layers(제품 기본 ask, 전역, project 순)를 이어 본 가운데 마지막에 맞은 규칙, 맞는 것이 없으면 allow. 전체와 조각의 결과 가운데 가장 엄한 것(deny > ask > allow)이 명령의 결과다. floor deny는 어느 층도 덮지 못한다.
      - `PRODUCT_SHELL_RULES = {floor: ShellRule[], ask: ShellRule[]}`. 목록은 아래 "할 일" 3이 정한다.
      - Settings 값: `SHELL_RULES_SETTING_KEY = "approvals.shell_rules"`, `shellRulesSettingSchema` = `{global: ShellRule[], projects: Record<Id<"prj">, ShellRule[]>}`, 기본값 `{global: [], projects: {}}`. `declareSetting`은 core가 한다(ap-shell-gate).
    - `assignment.ts`(할당. 옛 agent grant를 대신한다):
      - `assignmentEntrySchema`(`AssignmentEntry`): `{app: Id<"app">, removed_tools: ToolKey[]}`. 줄은 앱뿐이다. MCP server는 설정한 층(전역, project, Operator 정의)이 곧 할당이고 끄기는 `mcp_off`라 줄이 없다. 같은 앱은 하나이고 `removed_tools` 안에 겹침이 없다. agent 줄과 settings 줄은 없다.
      - `no_ask_tools`는 두지 않는다(README "사람이 정할 것" 1의 추천). 사람이 "묻는다"로 정하면 앱 줄에 `no_ask_tools: ToolKey[]`를 더하고 `judge`의 바깥 효과 줄을 켠다.
      - `agentAssignmentSchema`(`AgentAssignment`) `{agent: AgentRef, entries: AssignmentEntry[]}`
      - route: `agentAssignmentGet`(read, resource `agent_assignments`, method `get`, name `GetAgentAssignment`, 입력 `{agent}`, 출력 `withReadCommon({assignment, revision})`, actors `user`·`machine`), `agentAssignmentSet`(command, resource `agent_assignments`, method `set`, name `SetAgentAssignment`, 입력 `{agent, entries}`, compare `{revision}`, 출력 `{assignment, revision}`, actors `user`), `AGENT_ASSIGNMENT_ROUTES`. agent 자격은 읽지도 쓰지도 못한다.
      - `revision`은 0 이상의 정수다. 줄이 없는 agent는 0이고, 쓸 때마다 1 오른다. compare의 `revision`이 지금 값과 다르면 `conflict`이고 아무것도 쓰지 않는다(두 창에서 같은 할당을 고칠 때 앞 저장을 덮지 않는다).
    - `turn-request.ts`(하나 남는 묻는 길):
      - `TURN_REQUEST_CHOICES = ["once", "always", "reject"]`, `turnRequestChoiceSchema`(`TurnRequestChoice`): `{kind: "once"}` | `{kind: "always"}` | `{kind: "reject", reason?: 한 줄}`
      - `turnRequestSchema`(`TurnRequest`): `{id: Id<"apr">, session, turn, tool_call, subject, always_patterns, created_at}`. `subject`는 `GateCall` | `{kind: "harness", harness: HarnessId, tool: string | null, summary: string | null}`(coding harness 물음을 비추기만 한다. 답은 터미널에서 한다). fingerprint, intent, choices 칸은 없다.
      - `always_patterns: string[]`: `always`를 고르면 더해질 allow 규칙의 pattern이다(ask였던 조각마다 `<앞 두 낱말> *`, 한 낱말이면 그 조각, 조각을 이어야 ask인 명령은 그 명령 전체. ap-gate의 `alwaysPatterns`). 카드는 이것을 그대로 보여 사람이 무엇을 허락하는지 안다. shell request만 차 있고, tool request와 harness 물음은 비어 있다. 비어 있으면 `always`를 내지 않는다(결정 handler가 `invalid_input`으로 거절한다).
      - `turnRequestOutcomeSchema`(`TurnRequestOutcome`): `{outcome: "allow", scope: "once" | "always"}` | `{outcome: "reject", reason: string | null}` | `{outcome: "cancelled", cause: "turn_ended" | "session_closed" | "restart"}`
      - memory route `turnRequestDecide`: resource `turn_requests`, method `decide`, name `DecideTurnRequest`, 입력 `{session, request, choice}`, 출력 `{outcome}`, actors `user`
      - agent event 이름(등록은 ap-ask-turn): `TurnRequestOpened {request: TurnRequest}`, `TurnRequestClosed {request: Id<"apr">, outcome: "allow" | "reject" | "cancelled"}`. session snapshot 칸 `turn_requests: TurnRequest[]`. 옛 `PermissionRequested`·`PermissionResolved`·`permission_requests`는 ap-cleanup이 지운다.
    - `packages/protocol/apps/activation/consent.ts`(activation 동의):
      - `activationConsentSchema`(`ActivationConsent`): `{app, release, comparison: ActivationComparison, requested_at}`
      - command `activationConsent`: resource `activations`, method `consent`, name `activation.consent`, 입력 `{release, choice: "allow" | "reject"}`, compare `{requested_at}`, 출력 `{release, outcome: "allow" | "reject"}`, actors `user`. 거절은 이유를 싣지 않는다(읽는 곳이 없다). compare의 `requested_at`은 사람이 본 동의 대기의 값이고, 지금 대기의 값과 다르거나 대기가 없으면 `conflict`다(그 사이 다시 물었거나 더 새 release가 이전 대기를 닫았다).
      - command `activationAskConsent`: resource `activations`, method `ask_consent`, name `activation.ask_consent`, 입력 `{release, comparison}`, 출력 `{created: boolean}`, actors `machine`. 같은 release는 한 줄이다.
      - read `activationConsents`: resource `activations`, method `consents`, name `activations.consents`, 입력 `{app?}`, 출력 `withReadCommon({consents: ActivationConsent[]})`, actors `user`·`machine`
      - 남지 않는 event 이름(등록은 ap-activation): `ActivationConsentRequested {app, release}`, `ActivationConsentClosed {app, release, outcome: "allow" | "reject" | "cancelled"}`
      - activation 줄의 phase `waiting_approval`은 `waiting_consent`가 되고 줄 항목의 `approval` 칸은 없어진다(ap-activation).

## 할 일

추가(planner, 살 단계 뒤): pattern에서 `\*`는 글자 그대로의 `*`다. 제품 floor deny에 `rm -rf /\*`와 `rm -rf ~/\*`를 더한다. `*`만으로는 이 둘을 floor에 둘 수 없어(모든 절대 경로와 home 지우기가 막힌다) 사람 없는 run에서 그대로 돌 수 있었다.

새 file을 만들고 `turn-values.ts`에 이름 셋을 더한다. 옛 `grants.ts`, `intent.ts`, `requests.ts`, `tool-gate.ts`, `activation.ts`는 고치지 않는다(쓰는 곳이 남아 있다. `.claude/skills/orchestrate/brief-template.md` "계약 task의 brief"). 새 이름은 지금 저장소의 어느 export와도 겹치지 않는다(`AssignmentEntry`는 `packages/core/storage/blobs/purposes.ts`의 file 안 type일 뿐이다). 주석은 "왜"만 쓰되, 뒤 task가 읽을 규칙(정하는 규칙, pattern 뜻)은 머리 주석에 글로 고정한다.

1. `packages/protocol/lophn-agent/turn-values.ts`
   - 끝에 `TURN_MODES`, `turnModeSchema = z.enum(TURN_MODES)`, `type TurnMode`를 더한다. 이 file의 다른 줄은 고치지 않는다(ap-mode-turn이 wave 3에 이 file을 고친다).
   - 위 주석에 계약의 "mode가 사는 곳"과 "정하는 규칙"을 그대로 적는다. 뒤 task(ap-mode-envelope, ap-mode-turn, ap-skip-session)가 이 주석을 본다.
   - `packages/protocol/lophn-agent/mod.ts`가 이미 `export * from "./turn-values.ts"`를 한다. 이름은 lophn-agent namespace에서 겹치지 않는다(`git grep -nw "TURN_MODES\|turnModeSchema\|TurnMode" -- packages tools`가 0줄이다).
   - approvals의 새 file은 `../lophn-agent/turn-values.ts`에서 import한다. lophn-agent protocol은 approvals protocol을 import하지 않는다(`tools/check-deps.ts`의 `protocol-cycle`).
2. `packages/protocol/approvals/gate-call.ts`
   - `gateCallSchema = z.discriminatedUnion("kind", [...])`. 칸: app_tool은 `app: idSchema("app")`, `tool: toolKeySchema`, `effect: toolEffectSchema`. mcp_tool은 `server`·`tool`이 `z.string().min(1)`, `effect: toolEffectSchema`. shell은 `command: z.string().min(1)`. 모두 `z.strictObject`.
   - `DENY_REASONS`, `denyReasonSchema`, `type DenyReason`.
   - `judgmentSchema`: run, ask, deny(`reason: denyReasonSchema`, `pattern: z.string().nullable()`). `type Judgment`.
   - `judge`는 여기 두지 않는다(core의 일, ap-gate). 시그니처만 주석에 적는다.
3. `packages/protocol/approvals/shell-rules.ts`
   - `SHELL_RULE_ACTIONS`, `shellPatternSchema`(공백만이 아니고 줄바꿈이 없는 1~500자. `requests.ts`의 `rejectReasonSchema`와 같은 꼴의 refine), `shellRuleSchema = z.strictObject({pattern: shellPatternSchema, action: z.enum(SHELL_RULE_ACTIONS)})`. `type ShellRule`.
   - `type ShellRuleLayers`(zod 없이 type만. 값은 core가 조립한다).
   - 계약의 pattern 뜻과 판정 순서를 머리 주석에 적는다. 구현은 ap-gate의 `packages/core/approvals/gate/shell-match.ts`다.
   - `PRODUCT_SHELL_RULES`(`as const` 아님. `ShellRule[]` 둘):
     - `floor`(모두 `deny`): `rm -rf /`, `rm -rf ~`, `rm -rf ~/`, `mkfs*`, `dd * of=/dev/*`, `:(){ :|:& };:`
     - `ask`(모두 `ask`): `rm -r*`, `rm -fr*`, `git push*--force*`, `git push* -f*`, `git reset --hard*`, `curl * | sh *`, `curl * | bash *`, `wget * | sh *`, `wget * | bash *`
     - 정한 것: floor에 `rm -rf /*`와 `rm -rf ~/*`를 넣지 않는다. 이유: `*`가 아무 글자에 맞아 `rm -rf /tmp/x`처럼 모든 절대 경로, home 아래 경로 지우기를 막는다. floor는 사람도 덮지 못하므로 넓게 막으면 일을 못 한다. 이 둘은 ask의 `rm -r*`가 attended에서 잡는다.
     - 정한 것: fork bomb은 조각으로 나누면 보이지 않아 명령 전체로만 맞는다(README "뼈대 검토에서 정한 것"의 이유).
     - 정한 것: `git push`의 force는 `--force`가 앞이든 뒤든 잡게 `*`를 가운데 둔다. `git push*-f*`로 쓰지 않는 것은 `git push origin feature-fix`가 맞지 않게 하려는 것이다.
   - `SHELL_RULES_SETTING_KEY`, `shellRulesSettingSchema = z.strictObject({global: z.array(shellRuleSchema), projects: z.record(idSchema("prj"), z.array(shellRuleSchema))})`, `type ShellRulesSetting`.
4. `packages/protocol/approvals/assignment.ts`
   - `assignmentEntrySchema = z.strictObject({app: idSchema("app"), removed_tools: z.array(toolKeySchema)})`. `type AssignmentEntry`.
   - entries 배열은 refine으로 같은 앱 둘과 한 줄 안의 같은 `removed_tools`를 거절한다(옛 `grants.ts`의 `entriesSchema` 꼴).
   - `agentAssignmentSchema = z.strictObject({agent: agentRefSchema, entries})`. `type AgentAssignment`. `revision`은 할당 값이 아니라 저장 판이라 이 schema에 넣지 않는다(`judge`가 받는 값에 섞지 않는다).
   - `assignmentRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)`.
   - `agentAssignmentGet`(output `withReadCommon(z.object({assignment: agentAssignmentSchema, revision: assignmentRevisionSchema}))`, errors `invalid_input`·`unauthorized`·`forbidden`·`not_found`·`unavailable`), `agentAssignmentSet`(`compare: z.strictObject({revision: assignmentRevisionSchema})`, output `z.object({assignment, revision})`, errors 위에 `conflict`를 더한 여섯), `AGENT_ASSIGNMENT_ROUTES = [agentAssignmentGet, agentAssignmentSet] as const`.
   - 정한 것: 줄에 `kind`를 두지 않고 `assignmentEntryKey`도 두지 않는다. 이유: README "뼈대 검토에서 정한 것"으로 줄이 앱 하나뿐이 되었다. 같은 줄인지는 `app`으로 본다. 종류가 다시 생기면 그때 더한다(AGENTS.md "속도").
5. `packages/protocol/approvals/turn-request.ts`
   - file 안의 `rejectReasonSchema`(trim 뒤 1~500자, 줄바꿈 없음. `requests.ts`의 것과 같은 규칙)를 둔다. export하지 않는다(activation 동의는 이유를 싣지 않는다).
   - `TURN_REQUEST_CHOICES`, `turnRequestChoiceSchema`(`discriminatedUnion("kind")`, reject의 `reason`은 `rejectReasonSchema.optional()`), `type TurnRequestChoice`.
   - `turnRequestSubjectSchema`: `gateCallSchema`의 셋에 harness(`{kind: "harness", harness: harnessIdSchema, tool: z.string().nullable(), summary: z.string().nullable()}`. 값은 `packages/protocol/coding-agent/hook-signal.ts`의 `request`를 그대로 옮긴다)를 더한 `kind` 갈래. `turnRequestSchema = z.strictObject({id: idSchema("apr"), session: idSchema("ses"), turn: idSchema("trn"), tool_call: idSchema("tcl"), subject, always_patterns: z.array(shellPatternSchema), created_at: atSchema})`. `type TurnRequest`. `always_patterns`의 뜻(shell만 차 있다, 비면 `always`가 없다)을 주석에 적는다.
   - `turnRequestOutcomeSchema`(`discriminatedUnion("outcome")`), `type TurnRequestOutcome`.
   - `turnRequestDecide = defineMemory({resource: "turn_requests", method: "decide", name: "DecideTurnRequest", input: z.strictObject({session: idSchema("ses"), request: idSchema("apr"), choice: turnRequestChoiceSchema}), output: z.object({outcome: turnRequestOutcomeSchema}), actors: ["user"], errors: ["invalid_input", "unauthorized", "forbidden", "not_found", "conflict", "unavailable"]})`.
   - event 이름과 snapshot 칸은 머리 주석에만 적는다(정의는 ap-ask-turn이 `packages/protocol/events/agent.ts`·`snapshot.ts`에 둔다).
6. `packages/protocol/apps/activation/consent.ts`
   - import는 `zod`, `../../base/values.ts`, `../../base/envelope.ts`, `../../base/route.ts`, `../channel-values.ts`(`appIdSchema`, `releaseIdSchema`), `./activation.ts`(`activationComparisonSchema`)뿐이다. approvals protocol은 import하지 않는다. approvals가 이미 apps(`channel-values.ts`, `activation.ts`)를 import하므로 거꾸로 import하면 `protocol-cycle`이고, activation 동의는 approvals의 일도 아니다(README "정한 것").
   - `activationConsentSchema = z.object({app, release, comparison: activationComparisonSchema, requested_at: atSchema})`, `type ActivationConsent`.
   - `activationConsent`(input `z.strictObject({release, choice: z.enum(["allow", "reject"])})`, `compare: z.strictObject({requested_at: atSchema})`, actors `user`, errors `invalid_input`·`forbidden`·`not_found`·`conflict`·`unavailable`), `activationAskConsent`(actors `machine`, 같은 errors, compare 없음), `activationConsents`(actors `user`·`machine`, errors `invalid_input`·`unauthorized`·`forbidden`·`not_found`·`unavailable`).
   - 정한 것: activation 동의의 compare는 `requested_at`이다. 이유: 동의 대기는 release마다 한 줄이라 줄의 판이 따로 없고, ap-activation이 비교가 달라져 다시 물으면 `requested_at`이 바뀐다. 사람이 본 카드와 지금 대기가 같은지를 이것 하나로 본다.
   - 머리 주석: 동의 대기는 ledger 표에 남아 재시작을 넘는다(README "뼈대 검토에서 정한 것"). 같은 release는 한 줄이고, 더 새 release의 activation이 시작되면 이전 대기는 cancelled로 닫힌다(ap-activation). 남지 않는 event 이름 둘과 phase `waiting_consent`.
   - `ACTIVATION_ROUTES`(`activation.ts`)에는 넣지 않는다. 넣는 것은 ap-activation이다(넣으면 `ALL_ROUTES`에 들어가 handler가 없는 route가 된다).
7. 끝나기 전에 `deno check packages/protocol/approvals/*.ts packages/protocol/apps/activation/consent.ts packages/protocol/lophn-agent/turn-values.ts`로 type을 보고 `deno run --allow-read tools/check-deps.ts`로 import 고리가 없는지 본다. approvals와 activation의 새 file은 아직 어느 `mod.ts`도 export하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 모양과 상수만 정한다. 판정은 ap-gate의 test가 본다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test": schema가 보장하는 것).
- 옛 file이 그대로다: `git diff --stat -- packages/protocol/approvals/grants.ts packages/protocol/approvals/intent.ts packages/protocol/approvals/requests.ts packages/protocol/approvals/tool-gate.ts packages/protocol/apps/activation/activation.ts`가 빈 출력이다.
- barrel을 거치지 않는다: `grep -n "approvals/mod.ts" packages/protocol/apps/activation/consent.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. `packages/protocol/approvals/mod.ts`에 `export * from "./gate-call.ts"`, `"./shell-rules.ts"`, `"./assignment.ts"`, `"./turn-request.ts"`. `packages/protocol/apps/activation/mod.ts`에 `export * from "./consent.ts"`. 그 밖에 찾은 것
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
