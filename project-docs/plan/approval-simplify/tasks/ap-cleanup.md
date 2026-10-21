# ap-cleanup

problem-remove(`project-docs/products/change-log/0.6.0.md` 마지막 항목) 뒤의 모양을 기준으로 한다(`tests/e2e`, `tests/eval`과 그 둘만 쓰는 `tests/support` 일부는 check 밖이다. `tools/check.ts`의 `NOT_CHECKED`). 계획이 끝났는지 코드로 확인하고 영역 task가 남긴 옛 모양과 이 계획이 죽게 한 것을 지운다: 옛 protocol(`requests.ts`, `intent.ts`, agent grant 몫), 옛 event(`PermissionRequested`, `PermissionResolved`, `ApprovalRequested`, `ApprovalDecided`)와 snapshot 칸 `permission_requests`, 옛 agent grant 표·route·port, tool 결정 기록의 `session_grant`·`approval`·옛 `effect` enum·`comparison_basis`·`contract_revision`, rewind 사실 `approval_decision`, call 실패 이유 `not_allowed`, 쓰이지 않는 wording key. 새 동작은 만들지 않는다.

- 단위: cleanup (wave 4)
- 선행: ap-waiting, ap-conversation, ap-assign-editor, ap-shell-settings, ap-skip-screens
- 소유(이 task만 고친다):
  - `packages/protocol`
  - `packages/core`
  - `packages/shell`
  - `packages/design/wording`
  - `tools/wireframes`
  - `tests/support/core/human.ts`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(새 할당 표·route·event 이름은 옛것 옆에 두고 cleanup이 옛것을 지운다, cleanup은 이 계획이 죽게 한 것을 지운다. agent 정의의 `safe_tools`·`permissions`는 `agent-definition` 계획의 일이다), "lead가 할 일"
  - roadmap: `project-docs/products/roadmap/approval.md`의 "지우는 것", "묻지 않는 것"(agent call은 묻지도 막지도 않는다), "정한 것(agent)"
  - architecture: `project-docs/architecture/approval.md`, `project-docs/architecture/event.md`, `project-docs/architecture/agent-call.md`(실패 이유), `project-docs/architecture/place-session.md`(rewind의 남는 사실)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `event-stream`, `run-loop`, `router`, `shell`, `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/approvals`, `packages/shell/renderer`, `packages/design`
  - 앞 task의 보고(lead가 받은 "안 쓰게 된 export"와 "넘길 줄")와 brief: `project-docs/plan/approval-simplify/tasks/`의 `ap-legacy.md`(소유 밖 문자열 흔적), `ap-ask-pending.md`, `ap-ask-turn.md`, `ap-call-judge.md`, `ap-settings-edit.md`, `ap-assign-tools.md`, `ap-waiting.md`, `ap-conversation.md`, `ap-assign-editor.md`
  - wording: `.claude/skills/wording/SKILL.md`(key를 지우고 생성물을 다시 만드는 법), `.claude/skills/orchestrate/SKILL.md`의 "worker가 자주 한 실수"(template literal key를 "쓰는 곳 없음"으로 지운 일)
  - 앞 계획 `problem-remove`가 바꾼 것: reaction은 `ReleaseActivationFailed` 하나다(`packages/protocol/approvals/grants.ts`의 `REACTION_EVENT_TYPES`). `AppRestartHalted`·`KindViolationFound`는 `packages/protocol/events/transient.ts`의 남지 않는 event다. lophn guide의 problem 줄은 지웠고 approval 줄은 그대로다(할 일 7). `tests/support/core/human.ts`는 check 안이다. 아래 줄 번호는 main `8c243da91` 기준이다.
- 계약:
  - 쓰는 것: 앞 task들이 낸 이름과 보고의 "안 쓰게 된 export"
  - 내놓는 것: approvals protocol은 `gate-call.ts`, `shell-rules.ts`, `assignment.ts`, `turn-request.ts`, `tool-gate.ts`와 남은 reaction 선언뿐이다(turn mode는 `packages/protocol/lophn-agent/turn-values.ts`에 있다). 표 `agent_grants`, route `agent_grants/get|set`, port `AgentOfSession`, `approvals/decide_turn`, `approvals/pending`, `approvals/decide`가 없다. `deno task check:full`이 통과한다.

## 할 일

새 동작을 만들지 않는다. agent 정의의 `safe_tools`와 `permissions`(예: `packages/core/lophn-agent/run-loop/prepare.ts`의 `safe_tools: []`)는 지우지 않는다(`agent-definition` 계획의 일, README "뼈대 검토에서 정한 것"). 지우는 이름마다 먼저 `git grep -nw`로 읽는 곳이 없음을 확인하고 지운다. 읽는 곳이 소유 밖(`tests/e2e`, `tests/eval`, `tests/support` 가운데 check 밖의 것)에만 남으면 그대로 지우고 보고에 적는다(check 밖이다). 옛 표, event, route는 migration 없이 지운다. 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").

1. 확인: 아래 "끝남"의 grep을 먼저 돌려 남은 것을 목록으로 만든다. 앞 task가 맡았는데 남은 것은 여기서 지우되 보고에 "앞 task의 빠짐"으로 적는다.
2. approvals protocol
   - `packages/protocol/approvals/requests.ts`, `intent.ts`를 지운다.
   - `packages/protocol/approvals/grants.ts`에서 agent grant 몫을 지운다: `EFFECTS`·`effectSchema`·`Effect`, `ASK_SETTINGS`·`AskSetting`, `DEFAULT_ASK`, `SETTINGS_EDIT_DEFAULT_ASK`, `agentGrantEntrySchema`·`AgentGrantEntry`, `agentKey`, `agentGrantEntryKey`, `entriesSchema`, `agentGrantSchema`·`AgentGrant`, `agentGrantsGet`, `agentGrantsSet`, `AGENT_GRANT_ROUTES`, `readErrors`. reaction 선언(`REACTION_EVENT_TYPES`, `reactionEventTypeSchema`, `ReactionEventType`, `REACTION_MODES`, `reactionModeSchema`, `DEFAULT_REACTION_MODE`, `reactionSettingKey`)은 남긴다. `reactionGrantSchema`·`ReactionGrant`는 읽는 곳이 없으면 지운다.
   - 정한 것: 남은 reaction 선언 file의 이름을 `packages/protocol/approvals/reactions.ts`로 바꾼다(`git mv`). 이유: agent grant가 빠지면 grant가 아닌 reaction 선언만 남는다. `ae-builds`가 reaction을 지울 때 file째 지운다. file 경로로 import하는 곳(`git grep -n "approvals/grants.ts" -- packages tools`)을 맞춘다. 대부분은 `packages/protocol/approvals/mod.ts`를 거쳐 바꿀 것이 없다.
   - `packages/protocol/approvals/mod.ts`: `gate-call.ts`, `shell-rules.ts`, `assignment.ts`, `turn-request.ts`, `tool-gate.ts`, `reactions.ts`만 export한다.
3. events protocol
   - `packages/protocol/events/agent.ts`: `permissionRequested`, `permissionResolved`와 `agentEventSchema`의 두 줄, `turnPermissionRequestSchema` import를 지운다. 머리 주석의 `PermissionRequested·PermissionResolved`를 `TurnRequestOpened·TurnRequestClosed`로 고친다.
   - `packages/protocol/events/snapshot.ts`: `permission_requests`와 그 import를 지운다. `sessionStateSchema` 위 주석의 "대기 권한 요청"을 turn 안 request로 고친다.
   - `packages/protocol/events/transient.ts`: `approvalRequested`와 `transientEventSchema`의 그 줄, `pendingApprovalSchema` import를 지운다.
   - `packages/protocol/events/domain.ts`: `approvalDecided`, `APPROVAL_DECIDED_KINDS`, `DOMAIN_EVENTS`·`domainEventSchema`·`DOMAIN_EVENT_KINDS`의 그 줄, `applyResultSchema`·`IntentKind` import를 지운다(`ReactionEventType`은 `mod.ts`를 거쳐 그대로 온다). `DOMAIN_EVENT_KINDS` 위 주석의 "reaction grant로 끌 수 있고"를 "reaction 설정으로 끌 수 있고"로 고친다.
4. lophn-agent protocol
   - `packages/protocol/lophn-agent/tool-values.ts`: `toolDecisionFields`에서 `effect`(`toolDecisionEffectSchema` `read | reversible_write | irreversible`), `contract_revision`, `comparison_basis`, `approval`, `session_grant`를 지운다. 남는 칸은 `decision`, `reason`, `assignment_revision`, `agent_hash`다. 그 칸만 보던 `decisionShape`·`decisionMessage`·refine을 지우고 `toolDecisionSchema = z.strictObject(fields)`, `toolDecisionOutputSchema = z.object(fields)`로 둔다. 지우기 전에 `git grep -nwE "session_grant|comparison_basis|contract_revision|reversible_write|irreversible" -- packages tools tests`와 `decision.approval`·`decision.effect`를 읽는 곳이 없는지 본다(main `8c243da91`에서는 `packages/core/lophn-agent/run-loop/core-ports.ts`의 쓰는 곳뿐이다).
   - `packages/protocol/lophn-agent/tool-calls.ts`: `startToolCallInputSchema`의 `approval`을 지운다(handler `packages/core/lophn-agent/tools/commands.ts`의 `start`가 읽지 않는다). 318줄 근처 주석의 "approval 한 번 사용"을 지운다.
   - `packages/core/lophn-agent/run-loop/core-ports.ts`의 `enter`: 결정과 시작에서 지운 칸을 보내지 않는다.
   - `packages/protocol/lophn-agent/calls.ts`: `CALL_FAIL_REASONS`에서 `not_allowed`를 지운다(ap-call-judge 뒤 Router가 막지 않아 내는 곳이 없다). 따라오는 곳: `packages/core/router/schema.ts`(목록에서 만드는 CHECK, 저절로 맞는다), `packages/core/lophn-agent/session/model.ts`의 `messages.fail_reason` CHECK 글, `packages/core/router/model.ts`·`router.ts`·`ports.ts`에 남은 `not_allowed` 분기와 주석, `packages/core/lophn-agent/tools/bundles/call.ts`의 tool 설명("not_found, not_allowed, closed"), `packages/shell/renderer/conversation/thread/call-block.tsx`의 `not_allowed` 줄, wording key `conversation.notice.call-fail-not-allowed`. `packages/protocol/lophn-agent/agent-definitions.ts`의 검증 code `not_allowed`와 `packages/core/lophn-agent/agents/resolve.ts`의 것은 다른 enum이라 그대로다.
   - 주석: `packages/protocol/lophn-agent/agent-definitions.ts` 40줄("grant는 approvals/grants의 `agentGrantsGet`·`agentGrantsSet`"), `packages/protocol/lophn-agent/operators.ts` 17줄("agent grant는 사람만 정하므로")을 할당(`agentAssignmentGet`·`agentAssignmentSet`)으로 고친다.
5. 그 밖의 protocol
   - `packages/protocol/apps/releases.ts`: `activationSchemas`의 `approval: approvalIdSchema`를 지운다(`outputRelease`가 `activation: null`만 낸다). 그 뒤 `approvalIdSchema`(`packages/protocol/apps/channel-values.ts`)를 읽는 곳이 없으면 지운다.
   - `packages/protocol/server/registration.ts` 65~68줄 주석의 `apply_approved_action` 예를 지운다(`dispatchable`·`dispatchOnly`의 뜻은 남긴다).
6. core approvals
   - agent grant를 지운다: `packages/core/approvals/grants/{commands.ts,reads.ts,reads_test.ts,registration.ts,schema.ts,store.ts,ports.ts}`. `packages/core/approvals/registration.ts`에서 `agentGrantRegistration`을 뺀다(schema step `agent_grants`가 빠진다).
   - 정한 것: `packages/core/approvals/grants/reaction-settings.ts`를 `packages/core/approvals/reaction-settings.ts`로 옮기고 `grants/` 폴더를 지운다. 이유: 폴더에 grant가 남지 않는다. `packages/core/approvals/mod.ts`의 `reactionSettings` export를 맞춘다.
   - `packages/core/approvals/mod.ts`에서 `agentGrantRegistration`, `loadAgentGrant` export를 지운다.
   - `packages/core/main/daemon/wiring/lophn-agent-registration.ts` 106줄 근처 `[AgentOfSession, …]` port 등록과 import를 지우고, 그것만 쓰던 `agentOfSession` helper가 있으면 지운다.
   - 남은 `agentKey` 사용(`packages/core/agent-roles/place/place-data.ts` 등)이 있으면 `canonicalize`(`packages/base/mod.ts`)로 바꾼다.
   - `packages/core/lophn-agent/tools/app-public_test.ts`: 가짜 `entries`를 할당 모양(`{app, removed_tools: []}`)으로 맞춘다(cast라 compile은 되지만 뜻이 틀렸다).
7. core의 남은 흔적
   - `packages/core/server/server.ts`의 `CONTROL_OPERATIONS`에서 없는 command 이름 셋(`cancel_approval_request`, `reject_approval_request`, `expire_approval_request`)을 지운다. 비면 control lane을 쓰는 command가 없다. lane 자체는 지우지 않고 보고에 적는다(회수·정지 제어의 자리다).
   - `packages/core/lophn-agent/commands/registry.ts` 82줄 `/permissions`의 `description`("Show agent grants and this session's session permissions")을 할당을 보이는 말("Show the apps and MCP servers this agent can use")로 고친다. ap-conversation의 `/permissions` 보기와 맞춘다.
   - 주석: `packages/core/lophn-agent/register.ts` 252줄("approval request"), `packages/core/lophn-agent/run-loop/runtime.ts` 77줄(`create_approval_request`), `packages/core/apps/control.ts` 156줄(`apply_approved_action`), `packages/core/storage/migration/restart.ts` 91줄("approval"), `packages/core/main/daemon/assembly.ts` 98줄("approval text"), `packages/core/main/daemon/wiring/lophn-agent-session.ts` 38줄("approval 설명 글").
   - lophn guide(사람에게 lophn을 설명하는 글. 영어다):
     - `packages/core/agent-roles/roles/lophn/guides/questions-and-decisions.md`의 "Permission requests": 지금 묻는 것은 shell 규칙의 `ask`에 걸린 명령뿐이고, 선택지는 once, always(card에 보인 allow 규칙을 더한다), reject with a reason이다. "allow for this session", 설정 고치기·activation·reaction 요청, "used once … checked again", "Accepted and applied"를 지운다. coding agent의 물음은 대기 목록에 보이고 답은 터미널에서 한다. 사람이 없는 실행(unattended)과 skip은 묻지 않지만 deny 규칙은 막는다. activation 동의는 대기 목록의 따로 된 항목이다.
     - `packages/core/agent-roles/roles/lophn/guides/roles-and-grants.md`의 "Agent definition and grants": 사람은 agent에게 앱을 할당하고 tool을 뺄 수 있다. 할당한 tool은 묻지 않는다. MCP server는 설정한 층(전역, project, Operator 정의)이 할당이고 `mcp_off`로 끈다. 다른 agent 부르기는 묻지도 막지도 않는다. lophn 설정 고치기의 묻기를 지운다. shell 명령은 Settings의 shell 규칙을 따른다. 맨 위 줄의 "grants"도 할당으로 맞춘다. file 이름은 그대로다.
     - `packages/core/agent-roles/roles/lophn/guides/instructions.md`: "an agent cannot create or save `LOPHN.md` … without your permission"을 고친다. `LOPHN.md` 쓰기는 묻지 않고 rewind가 되돌린다(roadmap "묻지 않는 것").
     - 같은 말이 다른 guide에 있는지 `git grep -n -iE "allow for this session|session permission|agent grant|grant says" -- packages/core/agent-roles`로 본다.
8. shell
   - `packages/shell/main/desktop/core/routes.ts`: `APPROVAL_DECISION_ROUTES`, `AGENT_GRANT_ROUTES` import와 줄을 지우고 위 주석을 맞춘다.
   - `packages/shell/renderer/conversation/session-rewind/text.ts`: `approval_decision` case를 지운다(core가 그 사실을 만들지 않는다. `packages/core/lophn-agent/session/rewind/preview.ts`는 `external_request`만 낸다). wording key `conversation.label.rewind-item-approval`도 지운다.
   - 지운 protocol을 import하는 renderer file이 남았으면(앞 task의 빠짐) 그 import를 새 이름으로 맞추거나 쓰지 않는 code를 지운다. 새 화면 동작을 만들지 않는다.
9. wording: 이 계획이 죽게 한 key를 지운다. 후보는 `packages/design/wording/catalog/`에서 `approv`, `permission`, `grant`, `allow-session`, `scope-session`, `settings-edit`, `pending`이 든 key다. key마다 `git grep -nF "<key>" -- packages/shell tools/wireframes`가 0줄일 때만 지운다. template literal로 만드는 key(`` `…-${x}` ``)는 앞부분으로 grep한다. 지운 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 생성물을 다시 만든다(placeholders file을 손으로 고치지 않는다).
10. `tools/wireframes`: 지운 protocol이나 event 이름(`ApprovalRequested`, `PermissionRequested`, `PendingApproval`, `AgentGrantEntry` 등)을 쓰는 가짜 data가 남았으면 새 모양으로 맞춘다. `deno task wireframes`가 된다.
11. `tests/support/core/human.ts`: `approvalsDecideTurn` import를 `turnRequestDecide`로, `waitPermission`이 읽는 `permission_requests[0]`을 `turn_requests[0]`으로, `decide`의 `choice`를 `"once" | "always" | "reject"`로 하고 `{kind: choice}`를 보낸다. `tests/e2e`의 부르는 곳(`"allow"`)은 고치지 않는다(check 밖. e2e는 사람이 다시 쓴다).
12. 끝으로 `deno task check:full`과 renderer build(`deno run -A packages/shell/renderer/build.ts`)를 돌린다.

## 끝남

- `deno task check:full`이 통과한다. renderer build가 된다. `deno task wireframes`가 된다.
- 위험 test: 없음. 지우기만 한다. 남는 권한 경계 test를 지우지 않는다: `packages/core/approvals/gate/judge_test.ts`, `packages/core/approvals/assignment/commands_test.ts`, `packages/core/approvals/approvals_test.ts`, `packages/core/main/daemon/wiring/approvals_test.ts`, `packages/core/lophn-agent/tools/registry_test.ts`, `packages/core/lophn-agent/tools/bundles/shell_test.ts`. 지우는 `packages/core/approvals/grants/reads_test.ts`의 경계(agent가 남의 grant를 읽음)는 할당 read가 agent 자격을 아예 받지 않아(route actors `user`·`machine`) 없어진다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다.
- 남지 않음(모두 0줄):
  - `git grep -nwE "approvalsPending|approvalsDecide|approvalsDecideTurn|APPROVAL_DECISION_ROUTES|pendingApprovalSchema|PendingApproval|turnPermissionRequestSchema|TurnPermissionRequest|TurnDecision|TurnChoice|RequestChoice|choicesFor|applyResultSchema|ApplyResult|intentSchema|IntentKind|IntentTarget|Intent|GateVerdict|GateGrants|gateDenyReasonSchema|GateDenyReason" -- packages tools tests/support/core/human.ts`
  - `git grep -nwE "agentGrantsGet|agentGrantsSet|AGENT_GRANT_ROUTES|AgentGrant|AgentGrantEntry|agentGrantEntryKey|agentKey|agentGrantSchema|loadAgentGrant|agentGrantRegistration|AgentOfSession|GetAgentGrant|SetAgentGrant|agent_grants|DEFAULT_ASK|SETTINGS_EDIT_DEFAULT_ASK|AskSetting" -- packages tools tests/support/core/human.ts`
  - `git grep -nwE "PermissionRequested|PermissionResolved|permission_requests|ApprovalRequested|ApprovalDecided|approvalDecided|approvalRequested" -- packages tools tests/support/core/human.ts`의 남은 줄이 `packages/core/apps/tickets/coding/hook.ts`·`packages/protocol/coding-agent/hook-signal.ts`의 harness 신호 이름뿐이다
  - `git grep -nwE "session_grant|comparison_basis|contract_revision|reversible_write|irreversible|approval_decision|rewind-item-approval|call-fail-not-allowed" -- packages tools`
  - `git grep -nE "cancel_approval_request|reject_approval_request|expire_approval_request|create_approval_request|apply_approved_action|approval_requests" -- packages tools`
  - `git grep -n "not_allowed" -- packages/protocol/lophn-agent/calls.ts packages/core/router packages/core/lophn-agent/session/model.ts packages/shell/renderer/conversation/thread`
  - `git grep -n -iE "allow for this session|session permissions" -- packages`
  - `git ls-files packages/protocol/approvals`가 `assignment.ts`, `gate-call.ts`, `mod.ts`, `reactions.ts`, `shell-rules.ts`, `tool-gate.ts`, `turn-request.ts`뿐이다. `git ls-files packages/core/approvals/grants`가 빈 출력이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task는 영역 전체를 소유하므로 직접 고치고 여기에 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 7의 control lane처럼 비게 된 장치
- 앞 task의 빠짐: 1에서 찾은 것을 어느 task의 몫이었는지와 함께
- check 밖에 남은 것: `tests/e2e`, `tests/eval`, check 밖 `tests/support`에서 지운 이름을 쓰는 file 목록
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## (lead가 더함)

- `packages/core/lophn-agent/session/rewind/effects.ts` 7~8줄 주석의 "보류 request는 session에 묶이지 않으므로…"를 지운다. 보류 request 길은 없다(ap-ask-pending).
