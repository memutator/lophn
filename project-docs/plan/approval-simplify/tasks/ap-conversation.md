# ap-conversation

대화 화면의 허락 카드, 결정 뒤 남는 줄, `/permissions` 보기를 새 모양으로 바꾼다. 카드는 `TurnRequest`의 subject(shell 명령, 앱 tool, MCP tool)를 program 문구로 보이고 선택지는 `once | always | reject`다. "이 session 동안"과 설정 고치기 카드, 허락 접수와 적용을 나눈 줄을 지우고, `/permissions`는 할당한 앱과 그 앱에서 뺀 tool을 보인다(MCP server는 설정한 층이 할당이다). `ui-design` skill로 wireframe부터 고친다.

- 단위: conversation (wave 2)
- 선행: ap-waiting
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/approval-card/`
  - `packages/shell/renderer/conversation/permissions-view/`
  - `packages/shell/renderer/conversation/composer/`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-data.ts,agent-tab-core-source-sessions.ts,agent-tab-core-source-commands.ts,agent-tab-core-source-thread.ts,agent-tab-fake-source.ts,agent-tab-fake-commands.ts,agent-view.tsx,agent-thread.tsx}`
  - `tools/wireframes/pages/screens/agent-tab/scenes.tsx`
  - `tools/wireframes/pages/screens/{agent-pages.tsx,agent.tsx}`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(MCP server는 설정한 층이 곧 할당이다, agent 할당 줄은 앱만 둔다)과 "사람이 정할 것" 1(바깥 효과 tool은 묻지 않는 추천)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "묻는 길은 하나다"(선택지 셋, 물은 입력을 그대로 실행, "이 session 동안" 없음), "묻지 않는 것"(`LOPHN.md` 쓰기, agent call)
  - architecture: `project-docs/architecture/approval.md`(지금 코드. 카드 내용은 program이 만든다, 거절 이유는 agent에게 그대로 간다, cancelled는 거절과 다르다는 규칙은 남는다), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `event-stream`, `design-api`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`("key를 지우기 전에"), `.claude/skills/write-test/SKILL.md`
  - 계약(앞 task가 만든 것. 이름과 모양은 그 file에서 확인한다):
    - `packages/protocol/approvals/turn-request.ts`(ap-contract): `TurnRequest`, `TurnRequestChoice`, `turnRequestDecide`
    - `packages/protocol/approvals/gate-call.ts`(ap-contract): `GateCall`
    - `packages/protocol/approvals/assignment.ts`(ap-contract): `agentAssignmentGet`, `AgentAssignment`
    - `packages/protocol/events/agent.ts`, `packages/protocol/events/snapshot.ts`(ap-ask-turn): `TurnRequestOpened`, `TurnRequestClosed`, snapshot `turn_requests`
    - `packages/shell/renderer/desktop/connection/waiting/decide.ts`(ap-waiting): `turnChoiceOf`, `turnChoicesOf`
  - 본보기(화면): `tools/wireframes/pages/screens/agent.tsx`(영역 file), `tools/wireframes/pages/screens/agent-pages.tsx`, `tools/wireframes/pages/screens/agent-tab/scenes.tsx`, `tools/wireframes/pages/screens/conversation.tsx`(장면을 고르는 adapter. 소유 밖. `approval-deny` drive가 `[data-approval-id] button`의 `Deny`와 `[data-approval-id] input`을 누른다), `tools/wireframes/pages/screens/agent-chat.tsx`(소유 밖. `PermissionsView`와 `AgentComposer`를 직접 그린다)
  - renderer(모두 `packages/shell/renderer/conversation/` 아래): `approval-card/{approval-card.tsx,intent-text.ts,approval-card.module.css}`, `permissions-view/{permissions-view.tsx,permissions-view.module.css}`, `composer/agent-composer.tsx`(권한 요약 popover), `agent-view.tsx`(카드와 `/permissions` 층), `agent-thread.tsx`(`ApprovalResult` 줄), `agent-tab-source.ts`(화면 값과 `AgentTabSource`), `agent-tab-data.ts`(event를 줄로 접는 `foldEvent`), `agent-tab-core-source.ts`(source 조립. 소유 밖이고 고칠 것이 없어야 한다)
  - source: core `agent-tab-core-source-thread.ts`(`readThread`의 pending), `agent-tab-core-source-commands.ts`(`decidePermission`), `agent-tab-core-source-sessions.ts`(`readPermissions`, `readFace`의 권한 요약); fake `agent-tab-fake-source.ts`(장면 `approval`, `approval-settings`, `approval-states`, `PERMISSIONS_VIEW`, `decidePermission`), `agent-tab-fake-commands.ts`(`PERMISSIONS`)
- 계약:
  - 쓰는 것: `TurnRequest`, `turnRequestDecide`, `TurnRequestOpened`·`TurnRequestClosed`, snapshot `turn_requests`, `agentAssignmentGet`, `AgentAssignment`(ap-contract, ap-ask-turn), 결정 helper(ap-waiting)
  - 내놓는 것: 없음(화면)

## 할 일

추가(planner, 살 단계 뒤, `ap-contract`의 최종 계약): 할당 줄은 `{app, removed_tools}`뿐이고 `kind`와 `assignmentEntryKey`가 없다. MCP server 줄은 없다. `GetAgentAssignment`는 `{assignment, revision}`을 돌려주고, `SetAgentAssignment`는 compare `{revision}`을 받아 어긋나면 `conflict`다(화면은 다시 읽는다). 아래에 `kind`, `mcp_server`, `assignmentEntryKey`가 남아 있으면 이 모양으로 읽는다. shell turn request에는 `always_patterns`가 있다. `/permissions`와 card는 `always`가 더할 줄을 그대로 보인다.

근거: roadmap "묻는 길은 하나다"(선택지 `once | always | reject`, "이 session 동안" 없음, 물은 입력을 그대로 실행), "묻지 않는 것"(`LOPHN.md` 쓰기는 묻지 않는다), README "뼈대 검토에서 정한 것"(MCP server는 설정한 층이 할당, 할당 줄은 앱만). gallery는 renderer component를 그대로 그리므로(`ui-kit.md` "gallery가 정본이다") 1~2와 3~9를 같이 바꿔야 type check가 선다.

1. gallery 영역 file부터 고친다: `tools/wireframes/pages/screens/agent.tsx`(ui-design skill "새 화면 만들기" 4~7).
   - `new-agent-approval-settings` page와 `AgentApprovalSettings` import를 지운다. 다른 page id는 바꾸지 않는다.
   - 설명을 고친다(한국어 한두 문장).
     - `new-agent-approval`: shell 명령의 허락 카드다. 명령이 그대로 보이고 Allow once, Always allow, Deny로 바로 결정한다. Always allow는 그 명령 앞부분의 allow 규칙을 더한다.
     - `new-agent-approval-deny`: 그대로 둔다(문장이 맞으면).
     - `new-agent-approval-states`: 결정 뒤 줄 넷(한 번 허락, 항상 허락, 이유가 있는 거절, cancelled)이다.
     - `new-agent-commands`: "Permissions는 grant와 이 session의 허락을 보인다"를 "Permissions는 할당한 앱을 보인다"로 고친다.
     - `new-agent-permissions`: 할당한 앱마다 뺀 tool이 보이고, MCP server는 설정한 곳(Workspace, project, 이 Operator)에서 정한다는 한 줄이 있다.
   - `tools/wireframes/pages/screens/agent-pages.tsx`: `AgentApprovalSettings`와 `ApprovalSettingsScene` import를 지우고 남은 export의 주석(승인 카드(MCP tool) 등)을 고친다.
   - `tools/wireframes/pages/screens/agent-tab/scenes.tsx`: `ApprovalSettingsScene`을 지우고 `ApprovalScene`, `ApprovalStatesScene`, `PermissionsScene`, 머리 주석을 새 모양으로 고친다.
2. 장면 fake를 고친다(`agent-tab-fake-source.ts`, `agent-tab-fake-commands.ts`).
   - `AGENT_TAB_SCENES`에서 `approval-settings`와 그 갈래, `settingsIntent`를 지운다. `mcpIntent`도 지운다.
   - `approval`: pending은 `{ id, subject: { kind: "shell", command: "rm -r docs/reports/2026-w40" } }`이다(제품 기본 ask 후보 `rm -r*`에 맞는 명령). 같은 장면의 agent 글(`ISSUE_LEAD`)을 그 명령에 맞춘다.
   - `approval-states`: 줄 넷은 `allowed`(once, shell), `allowed`(always, shell), `denied`(이유 있음), `cancelled`다.
   - `decidePermission`: 결과 줄의 outcome은 거절이면 `denied`, 아니면 `allowed`이고 choice를 싣는다.
   - `PERMISSIONS_VIEW`: 새 모양(3)으로 앱 둘(뺀 tool 없음 하나, `delete_expense`를 뺀 것 하나).
   - `agent-tab-fake-commands.ts`의 `PERMISSIONS` 설명 "Change what this agent may do"를 보기만 한다는 뜻으로 고친다.
3. 화면 값(`agent-tab-source.ts`).
   - `Intent`, `RequestChoice` import를 지우고 `TurnRequest`를 쓴다.
   - `ApprovalCardRequest = { id; subject }`이고 subject는 `TurnRequest["subject"]`에서 `harness`를 뺀 것이다(정한 것 3). `choices` 칸이 없다(카드가 `turnChoicesOf`로 고른다).
   - `ApprovalOutcome = "allowed" | "denied" | "cancelled"`. `ApprovalResultView = { request, subject, outcome, choice: "once" | "always" | null, reason }`.
   - `GrantSetting`, `GrantRow`를 지우고 `PermissionsView = { apps: readonly { name: string; removed: readonly string[] }[] }`이다.
   - `decidePermission`의 choice type은 `"once" | "always" | "reject"`다. 메서드 이름과 인자 순서는 그대로 둔다(`agent-tab-core-source.ts`는 소유 밖이다).
   - `AgentFace.permissionSummary`의 주석을 "할당 요약"으로 고친다.
4. 카드(`approval-card/`).
   - `intent-text.ts`를 `subject-text.ts`로 바꾼다. subject에서 제목, 결정 뒤 줄의 대상 글, 세부를 program이 만든다.
     - `shell`: 제목 "{agent} wants to run a command", 세부는 명령 하나(`<pre>`), 대상 글은 명령이다.
     - `app_tool`·`mcp_tool`: 제목 "{agent} wants to run {tool}", 세부는 대상과 효과다. 입력 칸이 없다(정한 것 2).
     - `SETTINGS`, `settings_edit` 갈래, `approval-target-other` 갈래를 지운다.
   - `approval-card.tsx`: 단추는 `turnChoicesOf(request.subject)`(ap-waiting)에서 고른다. 순서는 Allow once(주 행동), Always allow, Deny다. `session`·`allow` 갈래를 지운다. Deny가 이유 칸을 여는 흐름, `data-approval-id`, 단추 글 "Deny", 이유 칸이 `input`인 것은 지킨다(`conversation.tsx`의 drive가 쓴다).
   - `ApprovalResult`: 상태 셋(`allowed`, `denied`, `cancelled`)과 범위 둘(once, always)이다. `received`·`applied`·`session`을 지운다.
   - `approval-card.module.css`: 쓰지 않게 된 class를 지운다.
5. 줄 접기와 snapshot.
   - `agent-tab-data.ts`의 `foldEvent`: `PermissionRequested`·`PermissionResolved`를 `TurnRequestOpened`·`TurnRequestClosed`로 바꾼다. `harness` subject는 접지 않는다. 결과 줄 outcome은 `allow`면 `allowed`이고 choice는 null이다(event에 범위가 없다). 머리 주석의 "Permission*"를 고친다.
   - `agent-tab-core-source-thread.ts`의 `readThread`: `live?.turn_requests`에서 harness가 아닌 첫 request를 pending으로 둔다.
6. 결정(`agent-tab-core-source-commands.ts`): `decidePermission`은 memory `turnRequestDecide`에 `{ session, request, choice: turnChoiceOf(choice, reason) }`를 보낸다. `approvalsDecideTurn`, `RequestChoice` import를 지운다.
7. `/permissions`와 권한 요약(`agent-tab-core-source-sessions.ts`).
   - `readGrantRows`, `grantRowsOf`, `settingOf`를 지우고 `agentAssignmentGet({ agent: env.agent })`를 읽는다. `kind`가 `app`인 줄마다 `{ name: appNameOf(app), removed: removed_tools }`다.
   - `readPermissions`는 `{ apps }`를 돌려준다. `readFace`의 `permissionSummary`는 할당한 앱 수다.
   - `agentGrantsGet`, `DEFAULT_ASK`, `SETTINGS_EDIT_DEFAULT_ASK`, `AgentGrant`, `GrantRow`, `GrantSetting` import를 지운다.
8. 보기(`permissions-view/`).
   - 묶음 하나: "What {agent} may use"에 앱 줄마다 이름과 "All tools" 또는 "All tools except {tools}"다. 앱이 없으면 빈 안내 한 줄이다.
   - 그 아래 한 줄: MCP server는 설정한 곳(Workspace, project, 이 Operator)에서 정한다(정한 것 1).
   - "Allowed for this session" 묶음, `SETTINGS`(allow·ask·deny 표시)를 지운다. 머리 주석을 고친다. [Edit in Agents]는 그대로다.
   - `permissions-view.module.css`: `.setting`과 그 data 속성 규칙처럼 안 쓰게 된 class를 지운다.
9. 화면 조립.
   - `agent-view.tsx`: `ApprovalCard`에 새 request와 `decidePermission`을 넘긴다. 그 밖은 type이 맞는지 본다.
   - `agent-thread.tsx`: `ApprovalResult`의 props가 같으면 고칠 것이 없다.
   - `composer/agent-composer.tsx`: `permissionSummary`의 주석("agent grant 요약")을 고친다. 그 밖은 그대로다.
10. wording(`packages/design/wording/catalog/conversation.ts`). wording skill "key를 지우기 전에"대로 앞부분(`conversation.label.approval-`, `conversation.button.approval-`, `conversation.label.grant-`, `conversation.label.permissions-`, `conversation.notice.permissions-`, `conversation.title.approval-`)으로 grep한 뒤 지운다.
    - 지울 후보: `conversation.button.approval-allow`, `conversation.button.approval-allow-session`, `conversation.label.approval-applied`, `conversation.label.approval-received`, `conversation.label.approval-input`, `conversation.label.approval-scope-session`, `conversation.label.approval-settings-*`, `conversation.label.approval-target-other`, `conversation.title.approval-change`, `conversation.label.grant-allow`, `conversation.label.grant-ask`, `conversation.label.grant-deny`, `conversation.label.permissions-session`, `conversation.notice.permissions-session-empty`, `conversation.notice.permissions-session-ends`
    - 더하거나 값을 바꿀 것: `conversation.title.approval-command`, `conversation.label.approval-command`, `conversation.label.approval-allowed`, `conversation.label.permissions-may`("What {agent} may use"), 앱 줄의 두 글(뺀 tool 없음, 뺀 tool 목록), 앱이 없을 때의 글, MCP server 안내 한 줄, `conversation.label.permission-summary`(앱 수의 plural), `conversation.notice.permissions-edited-in-agents`(안쪽 말 "Grants"를 쓰지 않는다)
    - `deno task wording`, `deno run --allow-read tools/check-wording.ts`
11. 지운 이름(`Intent`, `RequestChoice`, `approvalsDecideTurn`, `permission_requests`, `grantRowsOf`, `GrantRow`, `"session"` 선택지, `approval-settings`)을 주석과 문구에서도 grep해 맞춘다. `approval-card.tsx` 머리 주석("tool·MCP tool은 넷, 나머지는 허락과 거절")을 고친다.

정한 것:
1. `/permissions`는 MCP server 줄을 싣지 않고 설정한 곳을 가리키는 한 줄만 둔다. 이유: 할당 줄에 MCP server가 없고(README 뼈대 검토), agent마다 쓰는 server를 싸게 읽는 route가 없다(`agent-mcp-tools/list`는 server에 연결한다). Definition 탭의 MCP 칸이 그 목록이다.
2. tool 카드에 입력 칸이 없다. 이유: `TurnRequest`에 입력이 없다(ap-contract). 지금은 바깥 효과 tool을 묻지 않아(README "사람이 정할 것" 1) 대화 화면에 오는 것은 shell 명령뿐이다.
3. harness subject는 대화 화면에 오지 않는다. 이유: coding session은 Agent 탭이 아니고, 그 물음은 대기 목록의 coding 카드가 터미널로 보낸다.

## 끝남

- `deno task check`가 통과한다. 소유 밖의 `agent-tab-core-source.ts`와 `tools/wireframes/pages/screens/{conversation.tsx,agent-chat.tsx}`를 고치지 않고 type이 선다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고 gallery에서 다음이 그려진다.
  - `new-agent-approval`: shell 명령 카드에 명령, Allow once·Always allow·Deny가 있다.
  - `new-agent-approval-deny`: [Deny]를 눌러 이유 칸이 열려 있다.
  - `new-agent-approval-states`: 줄 넷(허락 once, 허락 always, 이유 있는 거절, cancelled)이다.
  - `new-agent-permissions`, `new-agent-commands`: 할당한 앱과 뺀 tool, MCP 안내 한 줄이다. "Allowed for this session"이 없다.
  - `new-agent-approval-settings`는 목록에 없다.
- 위험 test: 없음. 화면과 문구다(write-test skill).
- 남지 않음:
  - `grep -rn --exclude-dir=dist -E "approvalsDecideTurn|RequestChoice|protocol/approvals/intent|\bIntent\b|permission_requests|PermissionRequested|PermissionResolved|agentGrantsGet|DEFAULT_ASK|GrantRow|GrantSetting|approval-settings|ApprovalSettings" packages/shell/renderer/conversation tools/wireframes/pages/screens/agent-tab tools/wireframes/pages/screens/agent-pages.tsx tools/wireframes/pages/screens/agent.tsx`가 0줄이다.
  - `grep -rn --exclude-dir=dist -E "approval-allow-session|scope-session|permissions-session|approval-received|approval-applied|grant-allow|grant-ask|grant-deny|approval-change" packages/shell/renderer tools/wireframes packages/design/wording`가 0줄이다.
  - `ls packages/shell/renderer/conversation/approval-card/intent-text.ts`가 없다고 답한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 적어도 `tools/wireframes/pages/index.ts` 머리 주석의 버린 화면("Agent · approval for settings")과 `tools/wireframes/pages/screens/agent-chat.tsx`(소유 밖)의 옛 권한 요약 고정 글 `permissionSummary="Permissions: 4 run freely · 3 ask first"`
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없어야 한다
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 확인해 적는다: event로 받은 결정 뒤 줄은 허락 범위(once·always)를 모른다, `/permissions`에 MCP server 목록이 없다(정한 것 1), core의 `/permissions` 명령 설명(`packages/core/lophn-agent/commands/registry.ts`의 "this session's session permissions")이 옛 동작을 말한다.
