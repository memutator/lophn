# wlophn-ui

화면이 workspace마다의 lophn을 다루게 한다. 지금 화면은 lophn을 id `lophn` 하나로 안다. Settings의 전역 lophn 편집은 없앤다.

- 단위: wlophn (wave 1)
- 선행: wlophn-core. `isLophn`, `lophnIdOf`와 명함·목록의 workspace 입력을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/`
  - `packages/shell/renderer/desktop/settings/agents/`
  - `packages/shell/renderer/workspace/{reactions/project-lophn.ts,sidebar/workspace-left-sidebar.tsx,workspace-window.tsx,app-screen-tab.tsx}`
  - `packages/shell/renderer/conversation/{agent-tab-gui-source,agent-tab-core-source-sessions}.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/desktop/connection/waiting/`, `packages/shell/renderer/desktop/jobs/`
  - `packages/shell/main/desktop/wiring/notice.ts`
  - `packages/design/i18n/catalog/{agents,settings}.ts`
  - `project-docs/architecture/agent-definition.md`의 "Agents 화면의 범위" 절
- 읽을 것:
  - 계획: `project-docs/plan/workspace-layers/README.md`의 정한 것
  - architecture: `project-docs/architecture/agent-definition.md`(명함, Agents 화면의 범위)
  - skill: `.claude/skills/ui-design/SKILL.md`(화면을 바꿀 때)
- 계약:
  - 쓰는 것: `isLophn`, `lophnIdOf`(`protocol/lophn-agent/workspaces.ts`), `agents/list|read|card`와 `agentChange`의 workspace 입력(`wlophn-core`)
  - 내놓는 것: 없음

## 할 일

1. `assignment === LOPHN_AGENT_ID`, `agent="lophn"`처럼 lophn을 id 하나로 아는 곳을 `isLophn`으로 바꾼다. `wlophn-core`가 남긴 "넘길 줄"을 받아 제대로 고친다.
2. Agents 탭 목록과 편집기: 그 workspace의 lophn 하나를 보인다. 편집기는 lophn이면 handle·profile을 잠근 채 name을 바꾸게 한다. 저장 길(`core-source.ts:633-648`)이 lophn id로 읽고 쓴다. `agent-key.ts`의 "workspace는 key가 아니다" 주석을 lophn에 맞게 고친다.
3. 할당 panel(`core-grants.ts`, `editor/grants-panel.tsx`)과 MCP server form(`editor/server-form.tsx`의 `mcp.<scope>` 이름)이 그 workspace의 lophn id를 쓴다.
4. Settings › Agents(`desktop/settings/agents/agents-panel.tsx:98-119`, `settings-source.ts`)의 lophn card와 편집을 지운다. 전역 `LOPHN.md` 편집은 남긴다.
5. session·job·대기 목록·notice가 agent 이름을 보일 때 그 session의 lophn id로 name을 읽는다.
6. `dev:mock`의 fake source(`workspace/agents/fake-source.ts` 등)를 workspace마다 lophn이 있게 맞춘다.
7. `agent-definition.md`의 "Agents 화면의 범위" 절을 고친 화면에 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면).
- 남지 않음: `grep -rn "LOPHN_AGENT_ID\|\"lophn\"" packages/shell`에 agent id로 쓰는 줄이 없다(handle 표시는 남아도 된다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

## 추가 소유와 넘길 줄 (lead가 더함)

추가 소유:
- `packages/shell/ipc/annotation.ts`
- `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`
- `packages/shell/renderer/shell/{agent-sections.tsx,left-sidebar-workspaces.ts}`

`wlophn-core`가 type check만 맞춘 곳이다. 제대로 고친다.
- `workspace-window.tsx` `openNew`: `start.agent`가 없으면 목록에서 처음 `isLophn`인 row를 고른다. 그 workspace의 lophn(`lophnIdOf(workspace)`)을 고른다.
- `app-screen-tab.tsx` `sendAnnotations`: `agent`를 뺐다(core가 앱의 lophn으로 채운다). 그대로 두어도 되는지 확인한다.
- `conversation/agent-tab-gui-source.ts` face, `desktop/connection/waiting/notice-action.ts` 할당: `lophnIdOf(null)` 자리표시다. 그 session·대기의 workspace의 lophn id를 쓴다.
- `desktop/connection/waiting/{model.ts,cards/head.tsx}`, `desktop/jobs/model.ts`, `workspace/agents/{core-source.ts,agent-key.ts,editor/agent-editor.tsx,editor/definition-form.tsx}`, `reactions/project-lophn.ts`, `sidebar/workspace-left-sidebar.tsx`, `app-frame/app-detail/core-source.ts`, `conversation/agent-tab-core-source-sessions.ts`, `shell/main/desktop/wiring/notice.ts`: `=== LOPHN_AGENT_ID`를 `isLophn`으로만 바꿨다. name을 보이는 곳은 그 lophn id의 name을 읽는다.
- grep이 못 잡는 옛 문자열:
  - `packages/shell/ipc/annotation.ts:29`: `agentId`가 `"lophn"` 또는 `agt_`만 받아 lophn id를 거절한다. `agentIdSchema`를 쓴다.
  - `workspace/sidebar/panel-sessions.ts:32` `sessionAgentKey(entry) === "lophn"`, `shell/agent-sections.tsx:87` `items("lophn")`, `workspace/agents/agents-tab.tsx:86` `row.assignment === "lophn"`.
  - `app-screen-tab.tsx:135`, `workspace-window.tsx:987`, `shell/left-sidebar-workspaces.ts`의 `kind: "lophn"`·표시 문자열은 handle 표시면 둔다.
- core는 사람이 workspace 없이 `agents/list`를 부르면 모든 workspace의 lophn을 낸다. 화면은 workspace를 넘겨 그 workspace의 lophn만 받는다.
