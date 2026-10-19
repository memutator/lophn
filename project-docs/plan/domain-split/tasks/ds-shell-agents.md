# ds-shell-agents

project 창 안의 agent와 artifact 화면이 "이 project에 속한 domain 여럿"의 것을 보이게 한다. 지금 이 화면들은 창을 연 id 하나를 place로 쓴다(`ds-rename` 뒤에는 domain id 하나). 이 task는 domain 목록을 인자로 받게 바꾼다: sidebar Agent 탭, Agents 탭(본문), Artifacts 탭, agent 탭을 여는 key, conversation의 place 표시. 창이 domain 목록을 어디서 얻는지(`project.get`의 `domains`: 그 project에 속한 domain)는 `ds-shell-window`가 잇는다. 이 task는 목록을 인자로 받는 화면과 source까지 만든다.

**화면 모양은 사람이 Drafts에서 고른다(`ds-wireframe-drafts`).** lead가 띄우기 전에 아래 "고른 안"을 채운다. 비어 있으면 시작하지 말고 lead에게 알린다.

- 단위: shell (wave 3)
- 선행: ds-project-registry
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agent`
  - `packages/shell/renderer/workspace/agents`
  - `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `packages/shell/renderer/workspace/sidebar/agent-panel.tsx`
  - `packages/shell/renderer/workspace/sidebar/agents-section.tsx`
  - `packages/shell/renderer/workspace/sidebar/use-agent-panel.ts`
  - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`
  - `packages/shell/renderer/workspace/sidebar/sidebar-agent.ts`
  - `packages/shell/renderer/workspace/sidebar/artifact-panel.tsx`
  - `packages/shell/renderer/workspace/sidebar/artifact-panel.module.css`
  - `packages/shell/renderer/workspace/use-tab-host-slices.ts`
  - `packages/shell/renderer/workspace/reactions`
  - `packages/shell/renderer/artifact`
  - `packages/shell/renderer/conversation`
  - `packages/shell/main/artifact`
  - `packages/shell/main/workspace/kinds/agent.ts`
  - `packages/shell/main/workspace/kinds/agents.ts`
  - `packages/shell/main/workspace/kinds/artifact.ts`
  - `packages/shell/ipc/artifact.ts`
  - `tools/wireframes/pages/screens/agent.tsx`
  - `tools/wireframes/pages/screens/agent-pages.tsx`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `tools/wireframes/pages/screens/agent-chat.tsx`
  - `tools/wireframes/pages/screens/agents-tab.tsx`
  - `tools/wireframes/pages/screens/agent-setup`
  - `tools/wireframes/pages/screens/agent-tab`
  - `tools/wireframes/pages/screens/artifact.tsx`
  - `tools/wireframes/pages/screens/artifact`
  - `tools/wireframes/pages/screens/conversation.tsx`
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/mock/artifact`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 place, role, 화면 말, 화면 모양), `tasks/ds-rename.md`("shell: 어디가 project로 남고 어디가 domain이 되나"), `tasks/ds-project-registry.md`(`project.get`의 `domains`, `domain.get`의 `project`), `tasks/ds-shell-launcher.md`(domain 만들기 dialog)
  - architecture: `project-docs/architecture/agent-definition.md`(agent 정의, Operator, place), `artifact.md`(sidebar Artifacts 탭, `openArtifact`), `place-session.md`
  - 본보기(화면): Drafts의 `dp-sidebar-agents-*`, `dp-sidebar-artifacts-*`, `dp-agents-tab-*`, `dp-empty-states`, `dp-create-*`(`tools/wireframes/drafts/domain-project/`). 지금 화면은 `tools/wireframes/pages/screens/agents-tab.tsx`, `artifact/sidebar.tsx`
  - 코드: `workspace/agents/{source,core-source,fake-source,fake-data,sidebar-agents,agent-key,agents-tab,agents-page,views}.ts(x)`, `workspace/sidebar/{agent-panel,agents-section,use-agent-panel,sidebar-agent,artifact-panel}.ts(x)`, `workspace/use-tab-host-slices.ts`, `packages/shell/main/artifact/{list,source,registry,artifact-ipc}.ts`, `packages/shell/ipc/artifact.ts`, `packages/shell/main/workspace/kinds/{agent,agents,artifact}.ts`
- 계약:
  - 쓰는 것: `domainApi`(`domain.get/list`), `agentDefinitionList` 등 R 이름 그대로의 agent route, `AgentRef`의 `{role:"domain_engineer", domain}`(`packages/protocol/lophn-agent/places.ts`).
  - 내놓는 것(`ds-shell-window`가 쓴다): `useSidebarAgents(source, domains)`와 `ArtifactPanel`·`AgentsTab`이 받는 `domains: readonly { id: string; name: string; title: string }[]`, 줄(`SidebarAgent`)의 `domain` 칸, `AgentsSource`의 모든 읽기·쓰기가 받는 `domain` 인자.

## 고른 안

(lead가 띄우기 전에 채운다: sidebar Agent 탭 `dp-sidebar-agents-…`, Agents 탭 `dp-agents-tab-…`, Artifacts 탭 `dp-sidebar-artifacts-…`, 빈 상태 `dp-empty-states`, domain 만들기 위치 `dp-create-…`)

## 할 일

1. **source.** `workspace/agents/source.ts`의 `AgentsSource`가 place로 받던 id(R에서 이름이 `domain`으로 바뀐 인자)를 "domain id"로 분명히 하고, 여러 domain을 한 번에 읽는 호출은 두지 않는다(화면이 domain마다 부른다). `workspace/agents/agent-key.ts`: 내장 role의 key는 role 이름이라 domain 둘 이상에서 겹친다. 화면이 agent를 가리키는 값을 `(domain, key)` 쌍으로 만든다(`SidebarAgent.domain`, 탭 값, `refOf(domain, key)`). `core-source.ts`·`core-grants.ts`·`core-extensions.ts`·`core-link.ts`·`fake-source.ts`·`fake-data.ts`를 맞춘다. 근거: `agent-definition.md`("place에 놓인 agent는 domain마다 하나").
2. **hook.** `useSidebarAgents(source, project)`를 `useSidebarAgents(source, domains)`로 바꾼다: domain마다 `source.list(domain.id)`를 읽어 합치고 `SidebarAgent`에 `domain`(id, 이름)을 단다. 정렬은 domain 이름, 그 안에서 Domain Engineer → Operator. `workspace/use-tab-host-slices.ts`가 부르는 곳은 이 task가 맞춘다. 이 상태에서 창은 아직 domain 목록을 모르므로 `ds-shell-window`가 오기 전까지는 `[{id: 창 id, …}]` 하나를 임시로 넘긴다(R에서는 창 id가 domain id다). `workspace/workspace.tsx`의 호출 줄이 컴파일되도록 필요한 최소만 고친다(소유가 아니므로 보고의 "넘길 줄"에 적는다).
3. **화면.** 고른 안대로 `sidebar/agent-panel.tsx`·`agents-section.tsx`(Agent 탭), `agents/agents-tab.tsx`·`agents-page.tsx`(Agents 탭 본문), `sidebar/artifact-panel.tsx`(Artifacts 탭)를 다시 그린다. domain이 없는 project 창의 빈 상태(안내와 [Add domain] 자리. 단추는 `onAddDomain?` callback만 받는다. 만들기 dialog는 `ds-shell-launcher`가 만든 `desktop/launcher/domains/create-dialog.tsx`이고 `ds-shell-window`가 잇는다. 고른 안이 sidebar 머리의 [+ Domain]이면 그 단추도 같은 callback을 쓴다)를 둔다. 새 부품이 필요하면 renderer 그 화면 폴더에 둔다(design 공용 부품은 lead가 정한다).
4. **artifact.** `packages/shell/main/artifact/{list,source,registry,artifact-ipc}.ts`와 `packages/shell/ipc/artifact.ts`의 목록 읽기·열기 인자가 domain id를 받는다(R 이름 그대로). `renderer/artifact/use-artifact-list.ts`와 `artifact-panel.tsx`가 domain 목록의 artifact를 각각 읽어 고른 안대로 묶거나 한 목록에 domain badge를 단다. artifact 탭 값 `{domain, name}`(`main/workspace/kinds/artifact.ts`)은 R에서 이미 바뀌었다. 대화 글의 artifact link(`conversation/message-list/artifact-text.tsx`)는 현재 session의 domain 기준이다.
5. **conversation.** agent 탭 머리와 session 목록에서 place 표시를 "Domain {이름}"으로 하고(`conversation/`), agent 탭 값 `{place: domain id, agent key}`가 맞게 열리게 한다(`main/workspace/kinds/agent.ts`·`agents.ts`). 한 창 안에서 서로 다른 domain의 Domain Engineer 탭을 따로 열 수 있어야 한다.
6. **wireframes.** gallery의 agent·artifact·conversation 페이지와 fake data(`mock/agents-data.ts`, `mock/artifact/`)를 Drafts mock과 같은 모양(한 project에 domain 여럿)으로 고친다. 옛 모양(창 하나에 PM 하나)의 페이지는 지운다.
7. **wording.** 새 문구는 wording key로 쓴다(Agent·Agents·Artifact 영역 catalog에 key를 더한다. 남의 key는 고치지 않는다). 생성물은 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 만든다.

## 끝남

- `deno task check`가 통과한다. `deno run -A packages/shell/renderer/build.ts`로 bundle이 서고 `deno task wireframes`가 된다.
- 위험 test: 없음(화면이다). 이미 있는 `workspace/agents/core-source_test.ts`는 새 인자에 맞춰 옮긴다.
- 남지 않음:
  - `grep -rn "project_manager" packages/shell`이 0줄이다.
  - `grep -rnE "useSidebarAgents\(.*project" packages/shell/renderer`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `agent-*`·`artifact-*` page가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(wording 생성 결과는 lead가 병합 때 다시 만든다)
- 안 쓰게 된 export
- 정한 것: 고른 안에 답이 없던 세부, `(domain, key)` 값의 꼴
- 넘길 줄: `workspace/workspace.tsx`에서 컴파일을 맞춘 줄
- 계약 바꾸기 요청: `domain.get`/`project.get` 모양 변경이 필요하면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 창이 project의 domain 목록을 core에서 읽어 넘기는 것(`ds-shell-window`). 그 밖에 안 되는 동작.
