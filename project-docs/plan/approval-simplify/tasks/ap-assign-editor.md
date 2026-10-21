# ap-assign-editor

agent 편집의 Grants 탭을 새 할당으로 바꾼다: 앱 줄을 붙이고 떼고, 줄마다 뺀 tool을 고른다. MCP server는 설정한 층이 곧 할당이라 이 탭에 줄이 없다. agent 줄, 설정 고치기 줄, MCP tool 줄, tool별 묻기 설정을 지운다. `ui-design` skill로 wireframe부터 고친다.

- 단위: assign (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/agents/agents-panel.tsx`
  - `packages/shell/renderer/desktop/settings/agents/core-source.ts`
  - `packages/shell/renderer/desktop/settings/agents/settings-source.ts`
  - `packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts`
  - `packages/shell/renderer/workspace/agents/editor/{grants-model.ts,grants-model_test.ts,grants-panel.tsx,grants-panel.module.css,agent-editor.tsx}`
  - `packages/shell/renderer/workspace/agents/{core-grants.ts,source.ts,fake-source.ts,fake-data.ts,views.ts}`
  - `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "뼈대 검토에서 정한 것"(MCP server는 설정한 층이 곧 할당이다, 끄기는 지금의 `mcp_off`다, agent 할당 줄은 앱만 둔다), "사람이 정할 것" 1(바깥 효과 tool은 묻지 않는 추천. 그래서 줄에 묻기 칸이 없다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "할당 (agent grant)"(agent 줄과 settings 줄은 없다, 다른 domain의 비공개 tool은 할당해도 열리지 않는다), "세 가지만 정한다" 1(할당이 허락이다, 할당은 사람만 한다)
  - architecture: `project-docs/architecture/agent-definition.md`("다른 domain의 비공개 tool은 …", "Operator 정의 층의 MCP server는 …"), `project-docs/architecture/domain.md`(비공개 tool 규칙), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design-api`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`("key를 지우기 전에"), `.claude/skills/write-test/SKILL.md`
  - 계약: `packages/protocol/approvals/assignment.ts`(ap-contract)의 `AssignmentEntry`, `assignmentEntryKey`, `AgentAssignment`, `agentAssignmentGet`, `agentAssignmentSet`(compare 모양은 그 정의에서 확인한다), `packages/protocol/lophn-agent/tool-values.ts`의 `ToolEffect`
  - 본보기(화면): `tools/wireframes/pages/screens/agent-settings.tsx`(영역 file), `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`(`AgentGrantsPage`, `AgentGrantsAppPage`. drive가 `[data-grant-card="Budget tracker"] button[aria-expanded]`를 누른다), `tools/wireframes/pages/screens/agents-tab.tsx`(`OperatorEditor`. 소유 밖)
  - renderer: `packages/shell/renderer/workspace/agents/editor/{grants-panel.tsx,grants-model.ts,agent-editor.tsx}`, `packages/shell/renderer/workspace/agents/{source.ts,views.ts}`
  - source: core `packages/shell/renderer/workspace/agents/core-grants.ts`(`readGrants`, `saveGrants`), 그것을 묶는 `packages/shell/renderer/workspace/agents/core-source.ts`의 `grants`·`setGrants`(소유 밖. 이름과 인자를 그대로 두면 고칠 것이 없다); fake `packages/shell/renderer/workspace/agents/{fake-source.ts,fake-data.ts}`(`FAKE_GRANTS`, `GRANT_CATALOG`)
  - 같이 깨지는 소유 밖 file: `packages/shell/renderer/desktop/settings/agents/{agents-panel.tsx,core-source.ts,settings-source.ts,testdata/fake-agents.ts}`(Settings › Agents의 `DefaultsTable` 절과 lophn 카드의 grant 요약)
- 계약:
  - 쓰는 것: `AgentAssignment`, `AssignmentEntry`, `assignmentEntryKey`, `agentAssignmentGet`, `agentAssignmentSet`(ap-contract, ap-assign-store)
  - 내놓는 것: 없음(화면). 다른 domain의 비공개 tool을 붙일 목록에서 거르는 규칙(`appsFor`)은 그대로다.

## 할 일

추가(planner, 살 단계 뒤, `ap-contract`의 최종 계약): 할당 줄은 `{app, removed_tools}`뿐이고 `kind`와 `assignmentEntryKey`가 없다. MCP server 줄은 없다. `GetAgentAssignment`는 `{assignment, revision}`을 돌려주고, `SetAgentAssignment`는 compare `{revision}`을 받아 어긋나면 `conflict`다(화면은 다시 읽는다). 아래에 `kind`, `mcp_server`, `assignmentEntryKey`가 남아 있으면 이 모양으로 읽는다.

근거: roadmap "할당 (agent grant)"(앱 단위 할당과 뺀 tool, agent 줄과 settings 줄 없음), README "뼈대 검토에서 정한 것"(MCP server는 설정한 층이 할당, 할당 줄은 앱만, MCP 끄기는 `mcp_off`), README "사람이 정할 것" 1의 추천(바깥 효과 tool을 묻지 않아 묻기 칸이 없다). gallery는 renderer component를 그대로 그리므로(`ui-kit.md` "gallery가 정본이다") 1~2와 3~7을 같이 바꿔야 type check가 선다.

1. gallery부터 고친다(ui-design skill "새 화면 만들기" 4~7).
   - `tools/wireframes/pages/screens/agent-settings.tsx`: page id는 그대로 두고 설명을 고친다.
     - `new-agent-grants`: 맡길 것은 앱 하나다. 앱 tool은 이 agent가 일하는 domain의 것이면 모두, 다른 domain의 것이면 public만 보인다. MCP server는 설정한 곳(Workspace, project, 이 Operator의 Definition)이 할당이라는 한 줄이 있다. 효과별 기본값 표가 없다.
     - `new-agent-grants-app`: 앱 하나를 펼쳐 tool마다 넣음과 뺌만 고른다.
     - `new-operator-create`: "Grants 탭은 만든 뒤에 열린다"는 그대로다.
   - `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`: `AgentGrantsPage`의 주석("앱, MCP tool, 부를 수 있는 agent, 설정 고치기")을 고친다. drive가 누르는 `data-grant-card`와 펼침 단추는 지킨다.
2. fake를 새 모양으로(`fake-data.ts`, `fake-source.ts`).
   - `FAKE_GRANTS`는 `Record<string, readonly AssignmentEntry[]>`이고 앱 줄뿐이다(`{ kind: "app", app, removed_tools }`). Eval analyst는 `APP_ID`에서 `delete_expense`를 뺀 줄과 `EVAL_BOARD_ID` 줄이다. 나머지 agent도 앱 줄만 남긴다.
   - `MCP_TOOLS`, `allTools`, `PM_REF`, `ENGINEER_REF`, `PLANNER_REF`, `GRANT_CATALOG.mcpServers`, `GRANT_CATALOG.agents`를 지운다. `GRANT_CATALOG`는 `{ apps }`다.
   - 앱 fixture의 `release`와 tool의 `addedIn` 값을 지운다(정한 것 2).
   - `fake-source.ts`의 `grants()`는 `{ entries, catalog: { apps: appsFor(…) } }`이고, `FakeCall`의 `setGrants.entries` type은 `AssignmentEntry[]`다. 자기 자신을 부를 대상에서 빼던 거르기를 지운다.
3. 화면 값(`source.ts`, `views.ts`).
   - `GrantCatalog = { apps }`, `GrantsView = { entries: readonly AssignmentEntry[]; catalog }`, `setGrants`의 entries type은 `AssignmentEntry[]`다. `grants`·`setGrants`의 이름과 인자는 그대로 둔다(`core-source.ts`는 소유 밖이다).
   - `GrantMcpTool`, `GrantMcpServer`, `GrantAgent`, `GrantApp.release`, `GrantTool.addedIn`을 지운다. 효과 type은 `ToolEffect`(`packages/protocol/lophn-agent/tool-values.ts`)다. `AgentGrantEntry`, `Effect` import를 지운다.
   - 머리 주석의 "agent grant는 approvals/grants를 그대로 따르고"를 할당으로 고친다(`views.ts`도).
4. 순수 계산(`editor/grants-model.ts`).
   - 남긴다: `domainNamesOf`, `appsFor`.
   - 새로 둔다: `appEntryOf(entries, app)`, `isRemoved(entry, tool)`, `withToolRemoved(entry, tool, removed)`(겹치지 않게 `removed_tools`를 고친다), `setEntry`(같은 대상 판단은 `assignmentEntryKey`), `dropEntries`.
   - 지운다: `Pick`, `KEPT`, `CALL_DEFAULT_ASK`, `SETTINGS_EDIT_DEFAULT_ASK` 재export, `defaultAskOf`, `appToolPick`, `withAppToolPick`, `toolEntryOf`, `toolPick`, `withToolPick`, `agentEntryOf`, `settingsEntryOf`, `withSettingsPick`, `callPick`, `withCallPick`.
5. 화면(`editor/grants-panel.tsx`, `editor/grants-panel.module.css`, `editor/agent-editor.tsx`).
   - 남는 절은 Apps 하나다: 머리 줄(제목과 [Assign app] menu), 앱마다 `TargetCard`(이름, "{used} of {total} tools" 요약, [Remove app]), 펼치면 tool 줄(이름, 설명, 효과 chip, 오른쪽 끝 Allowed `Switch`). 바꾼 것은 지금처럼 바로 entries로 나간다.
   - 절 아래 한 줄: MCP server는 설정한 곳에서 정한다(Settings › Tools and skills, project, 이 Operator의 Definition).
   - 지운다: `DefaultsTable`, 묻기 `Select`(`ASK_LABEL`, `ASK_OPTIONS`), 상태 열(Changed by you, Reset, Default, New in, Came in with the default), Tools from MCP servers 절, Agents it can call 절, Change settings 절, `Target.defaultAsk`·`addedIn`, `asking` 셈. `RowHead`는 Name, Effect, Allowed 셋이다.
   - `grants-panel.module.css`: 열 셋에 맞춰 grid를 고치고 `.defaults*`, `.status`, `.chipNew`, `.rowCall`, `.standalone`처럼 안 쓰게 된 class를 지운다.
   - `agent-editor.tsx`: `AgentGrantEntry` import를 `AssignmentEntry`로 바꾼다. 그 밖은 그대로다.
6. core 통로(`core-grants.ts`).
   - `readGrants`: `agent_assignments`의 `get`(`{ agent: ref }` → `{ assignment }`)을 읽고 `{ entries: assignment.entries, catalog: { apps: appsFor(appCatalog, agentDomains) } }`를 돌려준다. `mcpCatalog`, `agentCatalog`, `projectNames`(agent 목록만 썼다)를 지운다. `appCatalog`의 `release: null`·`addedIn: null`을 지운다.
   - `saveGrants`: `link.command(agentAssignmentSet, { input: { agent: ref, entries }, compare })`. compare는 그 route 정의를 따른다.
   - 머리 주석의 "agent grant", "부를 수 있는 agent", "MCP tool" 줄을 고친다. `agentKey`, `agentGrantsSet`, `AgentGrantEntry`, `McpToolServer`, `CallAgent`, `AgentDefinitionRow` import를 지운다.
7. 소유 줄에 없는 file. lead가 소유에 더하지 않았으면 최소로 고치고 보고의 "넘길 줄"에 적는다. 이 task의 entries type 변경으로 type check가 깨지는 곳이다(`entry.kind === "agent"`, `"settings"` 비교와 지운 `DefaultsTable` import).
   - `packages/shell/renderer/desktop/settings/agents/agents-panel.tsx`: "Grant defaults" 절(`agents.heading.settings-grant-defaults`, `agents.notice.settings-grant-defaults-help`, `<DefaultsTable />`)과 그 import를 지운다. lophn 카드의 grant 줄은 앱 수만 보인다.
   - `packages/shell/renderer/desktop/settings/agents/settings-source.ts`: `LophnSummary`의 `agents`, `mayChangeSettings`를 지운다.
   - `packages/shell/renderer/desktop/settings/agents/core-source.ts`의 `lophnSummary`, `packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts`의 `VIEW.lophn`: 앱 수만 센다.
8. test(`editor/grants-model_test.ts`, write-test skill). "agent 부르기를 끄면 줄이 excluded로 남고 …" test를 지운다(agent 줄이 없다). 비공개 tool 거르기 test 둘(`appsFor`, `domainNamesOf`)은 다른 domain의 비공개 tool이 열리지 않는 경계라 남긴다. `AgentGrantEntry` import를 지운다.
9. wording(`packages/design/wording/catalog/agents.ts`). wording skill "key를 지우기 전에"대로 앞부분(`agents.label.grant`, `agents.label.grants-`, `agents.label.defaults-`, `agents.label.ask-`, `agents.heading.grants-`, `agents.empty.grants-`, `agents.button.`, `agents.notice.grants-`, `agents.heading.settings-grant`, `agents.notice.settings-grant`)으로 grep한 뒤 지운다.
   - 지울 후보: `agents.button.assign-tools`, `agents.button.grant-reset`, `agents.button.remove-server`, `agents.empty.grants-agents`, `agents.empty.grants-tools`, `agents.heading.grants-agents`, `agents.heading.grants-settings`, `agents.heading.grants-tools`, `agents.label.ask-ask`, `agents.label.ask-never`, `agents.label.defaults-*`, `agents.label.effect-settings`, `agents.label.grant-came-default`, `agents.label.grant-changed`, `agents.label.grant-col-status`, `agents.label.grant-col-when`, `agents.label.grant-default`, `agents.label.grant-new-in`, `agents.label.grant-when-runs`, `agents.label.grants-apps-summary`, `agents.label.grants-settings-*`, `agents.label.grants-tools-summary`, `agents.notice.grants-defaults-help`, `agents.notice.grants-settings-help`, `agents.notice.grants-tool-effect`, `agents.heading.settings-grant-defaults`, `agents.notice.settings-grant-defaults-help`
   - 값을 바꿀 것: `agents.label.grants-app-tools-summary`("{used} of {total} tools". `asking`을 뺀다), `agents.notice.grants-lead`("묻는지" 문장을 뺀다), `agents.notice.grants-after-create`("apps and tools"를 앱으로), `agents.label.settings-lophn-grants`(앱 수만)
   - 더할 것: MCP server 안내 한 줄(`agents.notice.grants-mcp-layers`)
   - `deno task wording`, `deno run --allow-read tools/check-wording.ts`
10. 지운 이름(`DefaultsTable`, `withCallPick`, `GrantMcpServer`, `mcpServers`(Grants 몫), `mayChangeSettings`, "ask first")을 주석과 문구에서도 grep해 맞춘다. 정의 칸의 `mcpServers`(`AgentDetail.mcpServers`, `McpRow`)는 다른 뜻이라 건드리지 않는다.

정한 것:
1. Grants 탭에 MCP server를 가리키는 한 줄을 둔다. 이유: 탭에서 MCP 절이 사라지면 사람이 어디서 정하는지 잃는다. 끄기는 Definition 탭의 MCP 칸(`mcp_off`)이 이미 한다.
2. 앱 fixture의 `release`와 tool의 `addedIn`(New in 표시)을 지운다. 이유: core 통로는 늘 null을 넣어 fake에서만 보이던 칸이고, 그 표시는 "기본값으로 들어왔다"는 묻기 기본값의 설명이었다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고 gallery에서 다음이 그려진다.
  - `new-agent-grants`: Apps 절 하나와 MCP 안내 한 줄이다. 효과별 기본값 표, MCP tool 절, Agents it can call 절, Change settings 절이 없다.
  - `new-agent-grants-app`: Budget tracker를 펼쳐 tool마다 Name, Effect, Allowed 열이고 `delete_expense`가 꺼져 있다.
  - `new-settings-agents`, `new-settings-lophn`(`tools/wireframes/pages/screens/settings.tsx`)이 그대로 그려지고 Grant defaults 절이 없다.
- 위험 test: 없음. 새로 만들지 않는다. `editor/grants-model_test.ts`의 비공개 tool 거르기 test 둘이 그대로 통과한다.
- 남지 않음:
  - `grep -rn --exclude-dir=dist -E "AgentGrantEntry|agentGrantEntryKey|agentGrantsSet|agentGrantsGet|agent_grants|DEFAULT_ASK|SETTINGS_EDIT_DEFAULT_ASK|AskSetting|DefaultsTable|withCallPick|withSettingsPick|withToolPick|mcpCatalog|agentCatalog|GrantMcpServer|mayChangeSettings" packages/shell/renderer/workspace/agents packages/shell/renderer/desktop/settings/agents tools/wireframes/pages/screens`가 0줄이다.
  - `grep -rn --exclude-dir=dist -E "grant-reset|ask-never|ask-ask|grants-settings|grants-agents|grants-tools|assign-tools|remove-server|settings-grant-defaults|defaults-by-effect|grant-new-in" packages/shell/renderer tools/wireframes packages/design/wording`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 적어도 `tools/wireframes/pages/screens/settings.tsx`의 `new-settings-agents` 설명("grant 기본값 설명")이 낡았다는 것(그 file은 ap-shell-settings가 고친다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(할 일 7)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다. `AssignmentEntry`에 `mcp_server` 줄이 남아 있으면 이 화면은 그 줄을 그리지도 지우지도 않고 저장 때 그대로 돌려보낸다. 그렇게 했으면 적는다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 확인해 적는다: MCP tool 하나만 빼는 화면이 없다(`mcp_off`의 `original_tool`은 정의 file에만 있고 Definition 탭은 server 단위로만 끈다).
