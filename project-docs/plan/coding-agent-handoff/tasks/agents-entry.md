# agents-entry

왼쪽 sidebar에 그 workspace의 Agents 탭을 여는 줄을 되살린다. commit a57712057이 옛 AgentSidebar의 Manage 단추를 지운 뒤 Agents 탭은 대화의 권한 popover "Edit in Agents"로만 열린다.

- 단위: shell-sidebar (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/shell/left-sidebar.tsx`
  - `packages/shell/renderer/shell/left-sidebar-model.ts`
  - `packages/shell/renderer/shell/left-sidebar.module.css`
  - `packages/shell/renderer/workspace/sidebar/workspace-left-sidebar.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `packages/shell/renderer/icons/sidebar.ts`
  - `packages/design/i18n/catalog/left-sidebar.ts`
  - `tools/wireframes/pages/screens/shell/`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/project-app.tsx`
  - `tools/wireframes/pages/screens/shell.tsx`
- 읽을 것:
  - `project-docs/plan/coding-agent-handoff/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/workspace-layout.md`(왼쪽 sidebar), `project-docs/architecture/agent-definition.md` 57번(Agents 탭은 Home, project, 앱 어디서나 열린다)
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `openAgents(host)`(`packages/shell/renderer/workspace/kinds/agents.tsx`)
  - 내놓는 것: 없음

## 할 일

1. `left-sidebar.tsx`의 Inbox·Jobs 줄과 같은 꼴로 Jobs 아래에 Agents 줄을 더한다(prop `onAgents`). 누르면 지금 workspace(Home, project, 앱)의 Agents 탭을 연다: `workspace-window.tsx`에서 `openAgents(host)`를 넘긴다. 다른 workspace 줄에서 여는 것은 만들지 않는다.
2. 아이콘은 `commonIcons.agents`(Agents 탭 kind와 같은 것)를 쓴다. 문구는 `left-sidebar.ts` catalog.
3. `kinds/agents.tsx`의 `openAgents` 주석 "Manage와 `+`가 같은 길이다"를 지금 부르는 곳(sidebar Agents 줄, 권한 popover)에 맞게 고친다.
4. wireframe의 왼쪽 sidebar 그림(위 소유의 gallery page들 가운데 sidebar를 그리는 곳)에 같은 줄이 보이게 한다. 실제 component를 쓰는 page면 prop만 넘긴다.

## 끝남

- `npm run check:full`이 통과하고 `node packages/shell/renderer/build.ts`가 된다.
- `npm run wireframes`가 되고 왼쪽 sidebar가 보이는 page에 Agents 줄이 있다.
- 위험 test: 없음(화면)

## 보고

[brief-template.md](../../../../.claude/skills/orchestrate/brief-template.md)의 "보고" 꼴.
