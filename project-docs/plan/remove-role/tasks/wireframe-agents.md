# wireframe-agents

Agents 탭을 전역 목록 하나와 편집 화면 하나로 바꾼다. lophn과 사람이 만든 agent가 한 목록에 있고, lophn은 이름·profile 칸이 잠기고 지우기가 없다. role label을 지우고 "Operator"를 "Agent"로 바꾼다. wireframe을 고친다는 것은 gallery가 그리는 renderer component와 fake data를 고치는 것이다(`ui-design`). source 꼴이 바뀌므로 그 core source를 `agents/*`·할당 route로 옮긴다. wording catalog는 이 계획에서 wave 2에 이 task만 고친다.

- 단위: wireframe (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `packages/design/wording/catalog`
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/pages/screens/{agents-tab,agent-settings}.tsx`
  - `tools/wireframes/pages/screens/agent-setup`
  - `tools/wireframes/pages/screens/project-files/pages.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/plan/remove-role/README.md`
    - "화면": Agents 탭은 전역 목록이고 편집 화면은 하나다. lophn은 이름·profile 칸이 잠기고 지우기가 없다. "Operator"는 "Agent"가 되고 role label은 지운다.
    - "agent와 정의": 정의 꼴은 하나다. lophn은 고정 id의 내장 정의다. 할당, 정의 층 MCP server, `skip`은 사람만 정한다.
    - "session과 place 종류"의 "받는 domain"과 "내장 skill은 place 종류로 준다".
    - "뼈대 검토"의 "wording catalog": wave 2는 이 task만 catalog를 고친다. wave 3 화면 task는 key를 더하기만 한다.
  - 계약 모양: `project-docs/plan/remove-role/tasks/contract-agent.md`의 할 일 2(`LOPHN_AGENT_ID`, `AgentId`는 `string`으로 infer된다, `placeKindOf`), 3(`AgentDefinition`, `name` 필수, `LOPHN_AGENT_NAME`), 5(`agents/*` route 표: `agentRead`의 `effective`는 옛 것과 같은 `name`·`profile`·`model`과 `domains`), 6(`assignmentGet`·`assignmentSet`), 7(`BUILTIN_SKILLS`의 `places`)
  - architecture:
    - `project-docs/architecture/ui-kit.md` "gallery가 정본이다"
    - `project-docs/architecture/agent-definition.md` "Profile"(올린 이미지, 기본 character)과 "지키는 것"의 정의 층 MCP server 줄(credential 이름 `mcp.<agent id>.<서버>`는 편집 화면이 만든다)과 `skip` 줄
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`, `tools`
  - 본보기(화면)와 renderer 짝:

    | gallery file | 그리는 renderer | page id |
    |---|---|---|
    | `tools/wireframes/pages/screens/agents-tab.tsx`(`AgentsBody`, `OperatorEditor`) | `workspace/agents/agents-page.tsx`, `agents-tab.tsx`, `editor/agent-editor.tsx` | `agent-settings` 영역 전부 |
    | `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx` | 위 둘을 `ProjectApp`·`SettingsFrame` 위에 고정한 상태 | `new-project-agents`, `new-operator-editor`, `new-operator-model-picker`, `new-operator-create`, `new-agent-editor-app-engineer`, `new-agent-editor-app-operator`, `new-agent-mcp-server-form`, `new-agent-grants`, `new-agent-grants-app`, `new-settings-agents`, `new-settings-lophn` |
    | `tools/wireframes/pages/screens/agent-settings.tsx` | 영역 file(page 목록) | 위와 같다 |
    | `tools/wireframes/pages/screens/project-files/pages.tsx`(`AgentsGroup`, `AgentsRuns`) | `workspace/sidebar/project-sidebar.tsx`(소유 밖, `wireframe-sidebar`가 고친다) | `new-agent-sidebar`, `new-agent-sidebar-runs` |
    | `tools/wireframes/mock/agents-data.ts` | sidebar·대화 gallery의 고정 data | 여러 page |

    가짜 data를 대신하는 것: core 쪽은 `core-source.ts`가 `agents/*`·`agent_assignments/*` route로 읽는다. gallery와 `dev:mock`은 `fake-source.ts`(`fake-data.ts`의 `FAKE_AGENTS`)다.
  - 코드(지금 모양):
    - `packages/shell/renderer/workspace/agents/source.ts`: `AgentListRow`(`assignment`, `role`, `kind`), `AgentDetail`(`kind`, `place`, `places`), `PlaceChoice`, `SaveInput.place`, `AgentsSource.newOperator`
    - `core-source.ts`: `toRow`, `detailOf`, `list`, `overview`(lophn을 뺀다), `newOperator`, `saveAgent`(`operatorCreate`·`operatorChange`·`builtinAgentChange`), `deleteAgent`, `loadImage`·`uploadImage`(`refOf`로 `AgentRef`를 만든다)
    - `core-grants.ts`(`agentAssignmentSet`, `agent-definitions/read`), `core-extensions.ts`의 `readSkills(link, place, role)`, `agent-key.ts`(`BUILT_IN`, `OPERATOR_ID`, `keyOf`, `refOf`)
    - `agents-tab.tsx`(built-in Section과 Operators Section, `ROLE_LABEL` chip), `agents-page.tsx`(`onNewOperator`)
    - `editor/agent-editor.tsx`(`AgentEditorSource`, `DeleteOperator`, `changePlace`, `withoutPlaceFields`, save의 domain 거르기), `editor/definition-form.tsx`(`builtIn`, Place 칸, `fixedName`, Domains 칸), `editor/parts.tsx`의 `ROLE_LABEL`
    - `sidebar-agents.ts`(`ORDER`, App Engineer 거르기, `../sidebar/agents-section.tsx` import), `kinds/agents.tsx`(`BUILT_IN_KEYS`)
    - `fake-data.ts`(`FAKE_AGENTS`의 `role`·`place`, `FAKE_GRANTS`), `fake-source.ts`(`skillsFor`, `here`, `BUILT_IN_PROFILE`, `newOperator`)
    - `core-source_test.ts`(위험 test, 아래 "끝남")
    - wording: `packages/design/wording/catalog/{agents,app-space,artifact,conversation,data,domain,workflow,workspace,workspace-settings}.ts`
- 계약:
  - 쓰는 것: `contract-agent`의 `AGENT_ROUTES`(`agentList`, `agentRead`, `agentCreate`, `agentChange`, `agentDelete`, `agentProfileImageUpload`, `agentProfileImageRead`), `ASSIGNMENT_ROUTES`, `AgentId`, `LOPHN_AGENT_ID`, `AgentDefinition`, `BUILTIN_SKILLS.places`.
  - 내놓는 것:
    - Agents 탭 source(`packages/shell/renderer/workspace/agents/source.ts`)는 `AgentId`로 agent를 가리키고 place를 받지 않는다. 편집 화면은 하나이고 lophn이면 이름·profile이 잠기고 지우기가 없다.
    - wording: "Operator"가 "Agent"인 새 key와 바뀐 글, role label key를 대신할 key(agent 이름만 보이는 sender, 대기 카드, job, workflow, app detail 줄 — wave 3 화면이 쓴다)를 이 task가 더한다. wave 3 task는 catalog를 고치지 않고 이 key를 쓴다. 안 쓰게 된 옛 key는 wave 4 `cleanup-shell`이 지운다.
    - 등록할 것(lead): wording 생성물, gallery `pages/index.ts`(page를 더하거나 뺐으면).

## 할 일

화면 code는 renderer에서 고치고 gallery는 그 component를 그대로 그린다(`ui-design`: 화면 모양을 고친다 = renderer를 고친다). 이 task가 바꾸는 route는 `agents-core`가 합쳐지고 lead가 registry를 바꾼 뒤에 core에서 돈다. 그 전에는 type check와 gallery만 맞으면 된다(README "뼈대 검토": wave 2와 3을 함께 올린다).

1. **소유 밖이 쓰는 이름은 남긴다**(orchestrate 병렬 규칙 2: 남이 쓰는 export는 더하기만 한다). 아래 이름은 이 task 뒤에도 소유 밖 file이 그대로 type check를 지나야 한다. 칸 이름과 인자 자리는 두고 값의 뜻만 바꾼다. 지우는 일은 쓰는 쪽을 옮기는 task와 `cleanup-shell`(wave 4)이 한다.

   | 이름 | 소유 밖에서 쓰는 곳 | 남기는 모양 |
   |---|---|---|
   | `AgentsSource` 메서드의 첫 인자(자리 id 또는 null) | `desktop/settings/agents/core-source.ts`의 `editor.readAgent(null, "lophn")`·`editor.grants(null, "lophn")`, `desktop/dev-mock/agent.ts`의 `readAgent`·`grants`·`imageSrc`, `app-frame/app-agents.ts`의 `list(app)`·`imageSrc(app, …)` | 인자를 둔다. 뜻은 "화면을 연 자리"이고 agent를 가리키는 데 쓰지 않는다(정한 것). `list`는 이 인자를 쓰지 않는다 |
   | `AgentListRow`의 `assignment`·`role`·`name`·`profile` | `app-frame/app-agents.ts` | `assignment`의 값은 `AgentId`다. `role`은 type `Role`을 그대로 두고 값은 lophn이면 `"lophn"`, 나머지는 `"operator"`만 낸다 |
   | `AgentDetail`의 `role`·`place`·`effective`·`definition` | `desktop/dev-mock/agent.ts`, `desktop/settings/agents/core-source.ts` | `role`은 위와 같다. `place`는 화면을 연 자리의 `PlaceView`이고 Settings(null)는 `none`이다 |
   | `AgentEditor` props(`source`, `project`, `projectName`, `agent`, `onDone`, `onChanged`, `onEditProjectInstructions`) | `desktop/settings/agents/agents-panel.tsx`(`project={null}`, `agent="lophn"`) | 그대로 |
   | `AgentsPage` props | `app-frame/side-panel.tsx`의 `ManageBody` | 그대로 |
   | `useSidebarAgents(source, project)`가 돌려주는 `{ agents: SidebarAgent[], reload }` | `workspace/use-tab-host-slices.ts` | 그대로. `SidebarAgent` 꼴(`sidebar/sidebar-agent.ts`)은 `wireframe-sidebar` 것이라 바꾸지 않는다 |
   | `agent-key.ts`의 `keyOf` | `app-frame/app-space.tsx` | 그대로(`wireframe-sidebar`가 쓰는 곳을 지운다) |
   | `fake-source.ts`의 export(`createFakeAgentsSource`, `FakeAgentsSource`, `FakeAgentsOptions`, `FAKE_AGENTS`, `FAKE_GRANTS`의 `lophn`, `GLOBAL_LOPHN_MD`, `GLOBAL_MCP`, `GLOBAL_MODEL`, `GLOBAL_SKILLS`, `ANTHROPIC`, `OPENAI`, `CUSTOM_PROVIDER`, `CUSTOM_INFO_MODEL`, `APP_ID`, `APP_NAME`, `PROJECT_ID`, `PROJECT_NAME`, `EVAL_ANALYST_ID`, `BUDGET_REVIEWER_ID`) | `desktop/settings/agents/testdata/fake-agents.ts`, `desktop/dev-mock/*`, `tools/wireframes`의 `settings-frame.tsx`·`mock/connect-host.tsx`·`agent-pages.tsx`·`launcher/launcher-pages.tsx`·`app-space/space.tsx`·`mock/app-space/data.ts`·`project-app.tsx` | 그대로 |
   | `views.ts`·`model-picker-data.ts`·`editor/{model-field,parts,server-form}.tsx`의 export(`ModelsView`, `McpRow`, `SkillRow`, `modelLabelOf`, `manageProviders`, `DefaultModelField`, `McpList`, `SkillList`, `ProtectedKeyNote`, `ServerForm`)와 type 이름 `AgentEditorSource` | `desktop/settings/*`, `conversation/agent-tab-core-source-model.ts` | 그대로 |
   | gallery `agents-tab.tsx`의 `AgentsBody`, `OperatorEditor`, `AGENTS_TAB_SPEC`, `agentTab`(돌려주는 `kind: "operator"`) | `tools/wireframes/pages/screens/project-app.tsx` | `OperatorEditor`는 새 이름의 별칭으로 둔다. `kind: "operator"`는 `project-window.tsx`의 `TabKind` 값이라 그대로다 |
   | `mock/agents-data.ts`의 type과 export(`AgentRow`의 `operator?`, `AGENT_ROWS`, `SESSIONS`, `RUN_SESSIONS`, `RUNS`, `profileOf`, `newConversationTab`, `sessionTab`, `weeklyTab`, `workingTab`, `AGENTS_TAB`, `ChatInit`, `AgentProfile`, `SessionRow`) | `project-window.tsx`, `project-app.tsx`, `conversation.tsx`, `agent-pages.tsx`, `agent-tab/scenes.tsx` | 꼴은 두고 값만 바꾼다 |
   | `agent-setup-pages.tsx`의 `Settings*Page` | `tools/wireframes/pages/screens/settings.tsx` | 이름 그대로 |

2. **agent 가리키기**(`agent-key.ts`). 근거: contract-agent 할 일 2(`AgentId`는 `"lophn"` 또는 `agt_…`).
   - `OPERATOR_ID`를 `AGENT_ID`로 이름을 바꾸고 `isAgentId(value: unknown): value is string`(lophn이거나 `AGENT_ID`에 맞음)을 더한다.
   - `roleOf(agent: string): Role`(lophn이면 `"lophn"`, 아니면 `"operator"`)을 더한다. 1번 표의 호환 `role` 값을 만드는 곳은 이 함수 하나다.
   - `refOf`와 `BUILT_IN`을 지운다. `keyOf`는 남긴다(1번 표). `isAppPlace`는 자리 id를 가르는 데만 남긴다.
3. **source 꼴**(`source.ts`, `views.ts`). 근거: README "정의 꼴은 하나다", contract-agent 할 일 5.
   - `AgentListRow`: `kind`를 지운다. 주석: `assignment`는 `AgentId`, 목록은 전역이고 lophn이 첫 줄이다.
   - `AgentsOverview.agents`: 전역 목록 전부(lophn 포함)다. 주석을 고친다.
   - `AgentDraft`: 모든 agent가 같은 칸을 갖는다. 주석에 lophn의 `name`·`profile`은 바꾸지 못하고 `mcp_servers`·`skip`은 사람만 쓴다고 적는다.
   - `PlaceView`: 뜻이 "화면을 연 자리"다(`kind: "none"`은 Settings).
   - `AgentDetail`: `kind`, `places`를 지운다. `assignment`(저장된 agent의 `AgentId`, 새 agent는 null), `draftId`, `role`(1번 표), `place`(연 자리)는 남긴다.
   - `PlaceChoice`와 `SaveInput.place`를 지운다.
   - `AgentsSource`: `newOperator`를 `newAgent(place)`로 바꾼다. 메서드 주석에 첫 인자는 화면을 연 자리라고 적는다. `editor/agent-editor.tsx`의 `AgentEditorSource` Pick 목록도 `newAgent`로 바꾼다.
   - `views.ts`의 `SkillLayer` 주석("내장은 role이 가진 것")을 place 종류로 고친다.
4. **core source를 새 route로**(`core-source.ts`, `core-grants.ts`, `core-extensions.ts`). 근거: contract-agent 할 일 5·6·7, `core-api`.
   - 읽기는 지금처럼 `Link.read(resource, method, body)`로 부른다. `agent`는 언제나 `AgentId` 글 그대로다.
     - 목록: `("agents", "list", {})`.
     - 한 agent: `("agents", "read", { agent, place? })`. 첫 인자가 있으면 `place: { kind, id }`(`placeOf`)를 싣는다. 이 자리가 `effective.model`의 층과 `effective.domains`(그 자리에서 받는 domain id)를 정한다.
     - 할당: `("agent_assignments", "get", { agent })`.
     - profile 이미지: `core.call`의 file `profile-images/read` body `{ agent }`, upload `profile-images/upload` body `{ agent, content_type, bytes }`.
   - 쓰기는 route 상수로 부른다: `agentCreate`(input `{ id: draftId, definition }`, compare `{}`), `agentChange`(`{ agent, definition }`, compare `{ hash }`), `agentDelete`(`{ agent }`, compare `{ hash }`), `assignmentSet`(`{ agent, entries }`, compare `{ revision }`).
   - 지운다: `refOf`·`OPERATOR_ID` 쓰기, `builtInDefinition`, `operatorCreate`·`operatorChange`·`operatorDelete`·`builtinAgentChange`·`agentAssignmentSet`·`AgentDefinitionRow` import, `"agent-definitions"` 읽기 전부.
   - `toRow`: contract `AgentRow`에서 `{ assignment: row.agent, role: roleOf(row.agent), name, profile, model, issues, counts }`를 만든다.
   - `list(_place)`: 전역 목록이다. 첫 인자는 쓰지 않는다(1번 표). 이미지는 지금처럼 미리 받는다.
   - `overview(place)`: `agents`는 목록 전부다. `role !== "lophn"` 거르기를 지운다. 나머지(지침, project 층 model, skill, MCP)는 지금처럼 그 자리 것이다.
   - `detailOf(place, agent)`: `agents/read` 하나로 정의·hash·`effective.name`·`effective.profile`·`effective.model`·issues를 읽는다.
     - `place` 칸은 연 자리다: null이면 `{ kind: "none", id: null, name: "" }`, 아니면 `{ kind, id, name: await nameOf(id) }`.
     - skill은 `readSkills(link, place)`, server는 `readServers(link, place)`, 지침은 `instructionsOf(place)`(project 자리만 있다)다.
   - `core-extensions.ts`의 `readSkills(link, place)`: `role` 인자와 `Role` import를 지운다. 내장 skill은 `BUILTIN_SKILLS`에서 그 이름의 `places`가 `placeKindOf(자리)`를 가진 것만 남긴다(README "내장 skill은 place 종류로 준다"). 자리 문자열에서 `Place | null`을 만드는 것은 `placeOf`와 같은 규칙이다.
   - `newAgent(place)`(옛 `newOperator`): `draftId`를 만들고(`newOperatorId`를 `newAgentId`로), `places` 목록과 `projects/list`·`apps/list` 읽기를 지운다. skill·server·지침은 그 자리 것이다.
   - `saveAgent(place, input)`:
     - `input.assignment === null`이면 `agentCreate`, 아니면 `agentChange`다. 정의 하나를 그대로 보낸다.
     - lophn이면 `name`·`profile`은 읽은 값 그대로다(편집 화면이 잠근다. 바꾸면 core가 `forbidden`). 읽은 정의에 `name`이 없으면 `effective.name.value`를 넣는다(정의 꼴은 `name`이 필수다).
     - 새 server의 credential 받기(`enterNewCredentials`)는 그대로다. 저장 전 정의는 `agents/read`로 읽는다.
   - `deleteAgent(place, agent, hash)`: `agentDelete`.
   - `core-grants.ts`:
     - `readGrants(link, place, agent, domains)`: `agent_assignments/get` `{ agent }`. 일하는 domain 이름은 `agents/read`(`{ agent, place }`)의 `effective.domains`를 그 자리 domain 목록(`domains(place)`)으로 이름으로 바꾼 것이다. place가 null이면 빈 목록이다. `appsFor`는 그대로 쓴다.
     - `saveGrants`: `assignmentSet`.
5. **Agents 탭**(`agents-tab.tsx`, `agents-page.tsx`, `agents-tab.module.css`). 근거: README "Agents 탭은 전역 목록이다".
   - 제목은 `project-workspace.heading.agents`("Agents")다. 그 아래 `agents.notice.tab-lead`(10번에서 글을 고친다).
   - Section 하나(`data-section="agents"`, 머리 `agents.heading.all-agents`, 오른쪽 끝 [New agent] `project-workspace.button.new-agent`)에 `overview.agents`를 받은 순서대로 카드로 둔다. built-in Section과 Operators Section을 지운다.
   - 카드 chip은 lophn에만 `agents.label.built-in`이다. 다른 agent는 chip이 없다. `data-role`·`data-kind` 속성과 `ROLE_LABEL` import를 지운다. `data-agent-card`·`data-assignment`는 남긴다.
   - Instructions·Model·Skills·MCP servers Section과 맨 아래 저장 자리 한 줄은 그대로다.
   - `agents-page.tsx`: `onNewOperator`를 `onNewAgent`로 바꾸고 주석의 "새 Operator"를 고친다.
6. **편집 화면**(`editor/agent-editor.tsx`, `editor/definition-form.tsx`, `editor/parts.tsx`). 근거: README "lophn은 이름과 profile 칸이 잠기고 지우기가 없다", "나머지 칸은 다른 agent와 같다".
   - lophn인지는 `detail.assignment === LOPHN_AGENT_ID` 하나로 가른다. `detail.kind`·`detail.role`·`builtIn`으로 가르던 곳을 모두 이것으로 바꾼다.
   - `agent-editor.tsx`:
     - `newOperator` → `newAgent`. `place` state, `changePlace`, `withoutPlaceFields`를 지운다.
     - Domains 목록은 `project`(연 자리)로 읽는다. null(Settings)이면 읽지 않는다.
     - 제목: 새 agent는 `project-workspace.heading.agents-new-agent`, 저장된 agent는 이름이다. chip은 lophn에만 `agents.label.built-in`이다.
     - 저장 단추: 새 agent는 `agents.button.create-agent`, 아니면 지금 key(`project-workspace.button.agent-editor-save`)다.
     - 저장: 정의의 `domains`에서 이 자리 그릇에 없는 id를 빼지 않는다(정한 것). 지금의 `stay` 거르기를 지운다.
     - `DeleteOperator`를 `DeleteAgent`로 이름을 바꾼다. lophn과 새 agent에는 없다.
   - `definition-form.tsx`:
     - Profile: lophn이면 고르기·올리기 없이 avatar만 보인다(`Group name="profile"` 안 `Avatar`). 다른 agent는 지금 `ProfileField`다.
     - Name: lophn이면 고정 글과 `agents.notice.name-fixed-lophn`이다. 다른 agent는 입력칸이다. `fixedName`의 role 갈래와 `agents.notice.name-fixed-role`을 지운다.
     - Place 칸을 지운다(`place`·`onPlace` prop, `placeValue`, `placeText`, `PlaceChoice` import).
     - 지침 블록의 note: 앱 자리면 `agents.notice.app-no-project`, 그 밖에는 없다(`agents.notice.lophn-no-project`를 쓰지 않는다. lophn도 project 자리에서는 그 project 지침을 받는다).
     - Domains: 연 자리 그릇에 domain이 있으면 모든 agent에게 보인다. 체크는 이 자리 domain만 켜고 끈다. 정의의 다른 자리 id는 그대로 남긴다.
       - 안내는 셋이다. 정의의 `domains`가 비면 `domain.notice.all-of-project`·`domain.notice.all-of-app`. 이 자리 domain을 골랐으면 `domain.notice.only-chosen`. 골랐는데 이 자리 것이 없으면 `domain.notice.none-here`(새 key).
       - `agents.notice.domains-gone`을 쓰지 않는다.
     - Skills: 지금 규칙 그대로다. 묶음(`grouped`) 조건에서 `!builtIn`을 뺀다.
     - MCP servers: [Add server]는 저장된 agent와 `draftId`가 있는 새 agent 모두에 있다. `ServerForm`의 `scope`는 `detail.assignment ?? detail.draftId`다(lophn이면 `"lophn"`, credential 이름 `mcp.lophn.<서버>`).
     - Skip permissions: 모든 agent에 있다.
   - `parts.tsx`: `ROLE_LABEL`과 `Role` import를 지운다. `ProfileField`의 "새 Operator" 주석을 고친다.
7. **sidebar 목록과 탭 kind**(`sidebar-agents.ts`, `kinds/agents.tsx`).
   - `sidebar-agents.ts`: `source.list(project)` 결과를 받은 순서 그대로 옮긴다(lophn이 첫 줄). `ORDER`와 App Engineer 거르기를 지운다. `role`은 `row.role`이다. `SidebarAgent` import를 `../sidebar/sidebar-agent.ts`로 바꾼다(`agents-section.tsx`를 지울 수 있게).
   - `kinds/agents.tsx`: `BUILT_IN_KEYS`·`OPERATOR_ID` 대신 `isAgentId`로 탭 필드를 본다. 머리 주석의 [+ New Operator]를 [New agent]로 고친다.
8. **fake**(`fake-data.ts`, `fake-source.ts`). gallery와 `dev:mock`이 쓴다.
   - `FAKE_AGENTS`: lophn, Eval analyst, Experiment planner, Budget reviewer 넷이다. Project Manager와 App Engineer를 지운다. `FakeAgent`에서 `role`·`place`를 지운다. lophn의 정의에 `name: "lophn"`을 둔다(정의 꼴은 `name`이 필수다).
   - `FAKE_GRANTS`: `project_manager`·`app_engineer` key를 지운다(`lophn`은 남긴다).
   - `fake-source.ts`는 agent마다 놓인 곳을 두지 않고 부를 때 받은 자리로 정한다.
     - project 자리: `PROJECT_SKILLS`·`PROJECT_MCP`·`PROJECT_DOMAINS`·`LOPHN_MD`, project 층 model.
     - 앱 자리: `APP_SKILLS`·`APP_DOMAINS`, 지침 없음.
     - null(Settings): 전역만, 지침 없음.
     - 내장 skill(`BUILT_IN_SKILLS`)은 project 자리에서 보인다(project 종류의 내장 skill).
   - `list`·`overview`는 넷 전부(lophn 첫 줄)다. `BUILT_IN_PROFILE`은 lophn 하나다. `newOperator` → `newAgent`. `grants`의 일하는 domain은 정의의 `domains`와 그 자리 domain이 겹치는 것이다.
   - 머리 주석을 고친다.
9. **gallery**(`pages/screens/agents-tab.tsx`, `agent-setup/agent-setup-pages.tsx`, `agent-settings.tsx`, `project-files/pages.tsx`, `mock/agents-data.ts`).
   - `agents-tab.tsx`:
     - `OperatorEditor`를 `AgentSettingsEditor({ id, place = "project", onDone, steps, source })`로 바꾼다. 연 자리는 `FAKE_AGENTS`의 place 대신 이 prop이다(`"app"`이면 `APP_ID`·`APP_NAME`).
     - `export const OperatorEditor = AgentSettingsEditor`를 두고 윗줄 주석에 "project-app.tsx가 옮기면 지운다"를 적는다(1번 표).
     - `agentTab`의 이름 없는 탭 제목 "New Operator"를 "New agent"로 바꾼다. `kind: "operator"`는 그대로다.
   - `agent-setup-pages.tsx`: `editor()`는 `AgentSettingsEditor`를 import해 쓰고 `place`를 넘긴다. page component 이름을 바꾼다.
     - `OperatorEditorPage` → `AgentEditorPage`, `OperatorModelPickerPage` → `AgentModelPickerPage`, `OperatorCreatePage` → `AgentCreatePage`.
     - `AppEngineerEditorPage`를 지우고 `LophnEditorPage`(`editor("lophn")`)를 더한다.
     - `AppOperatorEditorPage` → `AppPlaceEditorPage`(Budget reviewer를 `place: "app"`으로 연다).
     - `Settings*Page`는 이름 그대로다.
   - `agent-settings.tsx`: page id는 바꾸지 않는다(`ui-design` 5).
     - `new-agent-editor-app-engineer`는 버린다(목록에서 뺀다).
     - `new-agent-editor-lophn`("Agent settings · lophn": 이름·profile이 잠기고 지우기가 없다)을 더한다.
     - 나머지 page의 title·description에서 Project Manager, App Engineer, Operator, "놓인 곳", "놓을 곳"을 지운다. 영역 `summary`도 고친다.
     - 같은 영역 file 안의 변경이라 `pages/index.ts`는 고칠 것이 없다.
   - `project-files/pages.tsx`: `AgentsGroup`의 hover 줄을 Project Manager 대신 Eval analyst(`eval-analyst`)로 바꾼다. 주석의 "Agents 묶음" 설명을 고친다.
   - `mock/agents-data.ts`:
     - `AGENT_ROWS`: lophn, Eval analyst, Experiment planner, Budget reviewer다. lophn 밖은 `operator: true`다(1번 표의 꼴). `engineer` 줄과 `operators` 머리 줄을 지운다.
     - `SESSIONS`·`RUN_SESSIONS`·`RUNS`의 `agent: "Project Manager"`, `agent: "App Engineer"`를 `"lophn"`으로 바꾼다(그 자리의 일은 그 자리 lophn session이 한다. README "domain 일을 받는 쪽"). `sub: "engineer"`를 지운다.
     - 머리 주석을 고친다.
10. **wording**(`packages/design/wording/catalog/*.ts`). 근거: README "문구", `wording` skill. key 이름은 `<screen>.<part>.<name>`이고 `label`은 마침표가 없고 `notice`는 있다. 영역 file의 정렬을 따른다.
    - 새 key:

      | key(영역 file) | 글 | 쓰는 쪽 |
      |---|---|---|
      | `agents.button.create-agent`(agents) | Create agent | 이 task: 새 agent 저장 단추 |
      | `project-workspace.button.new-agent`(agents) | New agent | 이 task: Agents 탭 목록 머리 |
      | `project-workspace.heading.agents-new-agent`(agents) | New agent | 이 task: 새 agent 편집 화면 제목 |
      | `agents.heading.all-agents`(agents) | All agents | 이 task: Agents 탭 목록 머리 |
      | `domain.notice.none-here`(domain) | None of the chosen domains are here, so this agent works without a domain here. | 이 task: Domains 칸 |
      | `waiting.label.agent-unnamed`(data) | Agent | `shell-events`: 대기 카드의 요청한 쪽·meta, main 알림 제목의 이름 fallback, 대화 session 줄 |
      | `jobs.label.agent-unnamed`(workspace-settings) | an agent | `shell-desktop`: job 줄 "Asks {agent}"·"Created by {agent}"에서 이름을 모를 때 |
      | `app-detail.label.caller-agent-unnamed`(app-space) | An agent | `shell-workspace`: 앱 상세 Activity의 부른 쪽 이름을 모를 때 |
      | `workflow.label.participant-human`(workflow) | You | `shell-desktop`: workflow 참가자·줄 쓴 쪽 |
      | `workflow.label.participant-harness` | Coding agent | 〃 |
      | `workflow.label.participant-lophn` | lophn | 〃 |
      | `workflow.label.participant-program` | Program | 〃 |
      | `workflow.label.participant-job` | Scheduled job {title} | 〃 |
      | `workflow.label.participant-job-untitled` | Scheduled job | 〃 |
      | `workflow.label.participant-unknown` | An agent | 〃 |
      | `workflow.label.participant-placed` | {agent} · {place} | 〃: 참가자에 place가 있을 때. 없으면 agent 이름만이다 |

      sender chip(`shell-conversation`)은 새 key가 없다. agent 이름을 그대로 보이고 이름을 모르면 있는 `conversation.label.sender-agent-other`다. job의 만든 쪽 place 줄은 있는 `jobs.label.created-by-place`다.
    - 글만 고치는 key(key 이름에 role 낱말이 없다. placeholder는 그대로라 쓰는 쪽을 고치지 않아도 된다):

      | key | 새 글 |
      |---|---|
      | `agents.notice.tab-lead` | These agents work in every project and app. A session works in the place where you open it. |
      | `agents.notice.grants-after-create` | You can assign apps in the Grants tab once the agent exists. |
      | `agents.notice.grants-mcp-layers` | MCP servers are set where you add them: Settings › Tools and skills, the project, or this agent's Definition. |
      | `agents.notice.name-fixed-lophn` | lophn's name and profile can't be changed. |
      | `agents.label.instructions-head-placed` | Project instructions · LOPHN.md in {project} — read by every agent working there |
      | `agents.notice.domains-gone` | A domain this agent had chosen is gone from here. It is dropped when you save. |
      | `agents.notice.place-help` | Where this agent works. Its sessions open in that place. |
      | `project-workspace.button.agent-editor-delete` | Delete agent |
      | `domain.notice.only-chosen` | Only the chosen domains' DOMAIN.md, kinds and skills reach this agent here. |
      | `conversation.notice.permissions-mcp` | MCP servers are set in Workspace, in the project, or on this agent. |
      | `app-detail.note.failed-called` | The agent that applied this version sees why it failed. |
      | `app-detail.note.failed-unchanged` | Nothing you use has changed. The agent that applied this version sees why it failed. |
      | `app-space.button.send-annotations` | Send to agent |
      | `app-space.text.annotations-note` | They go to the agent as one message. They don't become problems. |
      | `app-space.title.annotations-sent` | {count, plural, one {# annotation} other {# annotations}} sent to the agent |
      | `app-space.error.annotations-archived` | This app is archived, so it can't take new messages. Restore it in Apps first. |
      | `app-space.title.coding-opened` | lophn opened {product} |
      | `artifact.text.annotations-note` | They go as one message to the agent that last wrote this artifact, or to lophn where it lives, and aren't reported as problems. |
      | `workflow.empty.sidebar` | No workflows yet. Ask an agent in this project to write one. |
      | `launcher.dialog.new-app-note` | An app starts with a name and a one-line purpose. lophn builds it from there. |
      | `launcher.field.app-purpose-help` | One line about what the app is for. Agents working on it read this. |
      | `settings.intro.coding` | Coding agents on this computer that lophn can set up. |
      | `settings.note.coding-default-used` | Used when none is picked. |

    - 그대로 두는 key: key 이름에 role 낱말이 있는 key는 wave 3까지 쓰는 곳이 있어 지우지도 글을 바꾸지도 않는다. `agents.button.create-operator`, `agents.label.role-project-manager`, `agents.notice.name-fixed-role`, `project-workspace.button.new-operator`, `project-workspace.heading.agents-new-operator`, `project-workspace.label.agent-kind-operator`, `project-workspace.label.role-*`, `settings.label.role-lophn`, `app-detail.label.role-*`, `conversation.label.sender-role-*`, `waiting.label.agent-{operator,project-manager,app-engineer}`, `jobs.label.agent-{operator,project-manager,app-engineer}`, `workflow.label.role-*`가 그렇다. 이 task 뒤에 쓰는 곳이 없어지는 `agents.label.place*`, `agents.notice.lophn-no-project`, `conversation.label.sender-agent-named`도 그대로 둔다. 모두 `cleanup-shell`이 지운다.
    - `npm run wording`으로 `*.placeholders.ts`를 다시 만든다(손으로 고치지 않는다). `node tools/check-wording.ts`를 돌린다.
11. 지우거나 이름을 바꾼 것(`ROLE_LABEL`, `newOperator`, `OPERATOR_ID`, `refOf`, `PlaceChoice`, `kind`, `places`, `onNewOperator`, `DeleteOperator`)을 `grep -rn`해 소유 file의 주석과 오류 글에 남은 것을 고친다. route를 글로 부르는 곳(`"agent-definitions"`)도 grep한다. 소유 밖 file이 type check에서 깨지면 고치지 말고 보고한다. 1번 표를 지키면 깨지는 곳이 없다.
12. 보고에 적을 것:
    - 등록할 것: `packages/shell/main/desktop/core/routes.ts`의 `AGENT_ASSIGNMENT_ROUTES`를 `ASSIGNMENT_ROUTES`로 바꾼다. 소유한 task가 없다. main의 contract client는 이 목록의 schema로 renderer 호출을 검사하므로, 바꾸지 않으면 `agent_assignments/get`·`set`의 `{ agent: AgentId }` 입력이 옛 `AgentRef` schema에 걸려 `invalid_input`이다. `agents-core`의 registry 교체와 같이 한다.
    - 알려진 미완 동작: 정의가 전역인데 `skills`는 받을 이름 목록이다. 비어 있을 때(전부 받음) 한 자리에서 skill 하나를 끄면 그 자리에서 보이는 이름만 목록이 되어, 다른 자리의 domain skill을 받지 않게 된다. 고치려면 끄는 목록(`skills_off`)으로 바꾸거나 모든 자리의 skill을 읽어 목록을 만들어야 한다. 이 task는 지금 규칙을 그대로 둔다.

## 정한 것

- `AgentsSource` 메서드의 첫 인자(자리)를 남긴다. 계약 줄 "place를 받지 않는다"는 "agent를 가리키는 값에 place가 끼지 않는다"로 읽는다. 이유: 소유 밖 셋(`desktop/settings/agents/core-source.ts`, `desktop/dev-mock/agent.ts`, `app-frame/app-agents.ts`)이 그 인자로 부른다. 그리고 `agentRead`의 `place`(effective model 층과 받는 domain), 자리마다 다른 skill·MCP·지침에 그 자리가 필요하다.
- Domains 칸은 연 자리 그릇의 domain만 보이고, 정의에 있는 다른 자리 domain id는 그대로 둔다. 저장에서도 빼지 않는다. 이유: 정의가 전역이고 README "받는 domain"이 "있으면 그 가운데 place 그릇에 있는 것만 받는다"다. 다른 자리 id를 빼면 그 자리에서 받던 domain을 잃는다. 없어진 domain id를 core가 거절하면 그 칸 안에 issue로 보인다.
- Agents 탭 제목은 있는 key `project-workspace.heading.agents`("Agents")이고 목록 머리는 `agents.heading.all-agents`다. 이유: 목록이 전역이라 "Agents in {project}"가 틀린다. 아래 지침·model·skill·MCP 칸은 지금처럼 그 자리 것이다.
- lophn 표시는 카드와 편집 제목의 chip `agents.label.built-in` 하나다. 이유: role label은 지우지만 이름·profile 칸이 왜 잠겼는지 보여야 한다. 있는 key를 쓴다.
- key 이름에 role 낱말이 없고 글에만 있는 key는 글을 고친다(쓰이지 않게 된 key도). placeholder가 바뀌어야 하는 문구는 새 key로 더한다. 이유: 글만 고치면 쓰는 쪽(wave 3 file)을 건드리지 않고 끝난다. placeholder가 바뀌면 소유 밖 `t()` 호출이 type check에서 깨진다. 앱 annotation 단추는 그래서 "Send to {agent}"가 아니라 "Send to agent"다(artifact 쪽 `artifact.button.send-annotations`와 같다).
- 이름을 모를 때의 글은 화면마다 `-unnamed` key 하나다(waiting, jobs, app-detail). workflow는 `workflow.label.role-*`를 `participant-*`로 옮긴다. 이유: 끝남 기준이 `role` 낱말을 다른 뜻으로만 남기고, wave 3 화면이 role label key를 쓰지 않아야 한다(`shell-desktop` 내놓는 것).
- `OperatorEditor`는 새 이름의 별칭으로 남긴다. 이유: 소유 밖 `project-app.tsx`가 import한다(orchestrate 병렬 규칙 2).
- Skills 칸의 켬·끔 규칙(정의 `skills`는 받을 이름, 비면 전부)은 그대로 둔다. 전역 정의에서 생기는 문제는 보고의 "알려진 미완 동작"으로 넘긴다(12번). 이유: README에 답이 없고, 끄는 목록으로 바꾸면 고정된 정의 꼴(`contract-agent`)이 바뀐다.
- 위험 test는 있는 `core-source_test.ts` 하나를 새 route로 옮긴다. 이유: credential 이름의 주인(secret 경계)을 본다. 화면과 문구는 test하지 않는다(AGENTS.md "속도").

## 끝남

- `npm run check`가 통과한다. 작업 중에는 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/shell/renderer/workspace/agents/core-source_test.ts packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`만 돌린다.
- `npm run wording -- --check`와 `node tools/check-wording.ts`가 통과한다.
- `node packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- `npm run wireframes`가 되고, 아래 page가 고친 component로 그려진다. `ui-design` "확인"대로 띄워 본다.
  - `new-project-agents`: lophn 카드(chip Built-in)가 첫 줄이고 Eval analyst, Experiment planner, Budget reviewer가 같은 목록에 있다. [New agent]가 목록 머리 오른쪽 끝에 있다.
  - `new-operator-editor`: Place 칸이 없다.
  - `new-operator-create`: 놓을 곳 고르기가 없다.
  - `new-agent-editor-lophn`: 이름·profile이 잠기고 Delete가 없다.
  - `new-agent-editor-app-operator`: 앱 domain이 보이고 project 지침이 없다.
  - `new-agent-mcp-server-form`, `new-agent-grants`, `new-agent-grants-app`, `new-settings-lophn`: 지금처럼 그려진다.
- 위험 test: `packages/shell/renderer/workspace/agents/core-source_test.ts`를 "새 agent는 미리 받은 id로 만들어지고 새 server의 값은 그 id의 이름으로 받는다"로 고친다. 보내는 command가 `agents/create`이고 input의 `id`가 `draftId`이며, 보호 입력이 받은 이름이 `mcp.<draftId>.docs`다. `saveAgent`의 입력에서 `place`를 뺀다.
- 남지 않음:
  - `grep -rn "project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|ROLE_LABEL\|newOperator\|refOf\|PlaceChoice\|builtinAgentChange\|agentAssignmentSet\|agent-definitions\"" packages/shell/renderer/workspace/agents packages/shell/renderer/workspace/kinds/agents.tsx tools/wireframes/mock/agents-data.ts tools/wireframes/pages/screens/agents-tab.tsx tools/wireframes/pages/screens/agent-settings.tsx tools/wireframes/pages/screens/agent-setup tools/wireframes/pages/screens/project-files/pages.tsx | grep -v OperatorEditor`가 0줄이다.
  - `grep -rn '"operator"' packages/shell/renderer/workspace/agents`가 `agent-key.ts`의 두 줄(남기는 `keyOf`, 새 `roleOf`)뿐이다.
  - `grep -rn "agents-section" packages/shell/renderer/workspace/agents`가 0줄이다.
  - 아래 명령이 아무것도 찍지 않는다(key 이름에 role 낱말이 없는데 글에 role 이름이 남은 key):

    ```sh
    node --input-type=module -e 'const {AREAS}=await import("./packages/design/wording/en.ts");for(const c of Object.values(AREAS))for(const[k,v]of Object.entries(c))if(/Operator|Project Manager|App Engineer/.test(v)&&!/operator|project-manager|app-engineer|\.role-/.test(k))console.log(k)'
    ```

- 새 key가 있다: `grep -rhoE '"(agents\.button\.create-agent|project-workspace\.button\.new-agent|project-workspace\.heading\.agents-new-agent|agents\.heading\.all-agents|domain\.notice\.none-here|waiting\.label\.agent-unnamed|jobs\.label\.agent-unnamed|app-detail\.label\.caller-agent-unnamed|workflow\.label\.participant-[a-z-]+)"' packages/design/wording/catalog --include=*.ts --exclude=*.placeholders.ts | sort -u | wc -l`이 16이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
