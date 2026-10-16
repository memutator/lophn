# screens-agents-editor

project의 Agents 탭과 agent 설정 화면(Definition·Grants)을 wireframe 코드 `agent-setup/`에서 renderer `workspace/agents/`로 옮긴다. Permissions 칸과 role별 model 줄을 지우고, agent grant 화면과 내장 skill 표시와 agent 층 MCP 폼을 새로 얹는다. gallery의 agent-setup page는 옮긴 component를 fake source로 그린다.

- 단위: screens-agents (wave 3)
- 선행: screens-conversation-composer (wireframe `model-picker.tsx`의 `ModelPicker`·`OptionAxes`·`ModelField`가 renderer `conversation/model-picker/`로 옮겨진 뒤 Model 칸이 그것을 쓴다. 이유: 같은 코드를 두 벌 두지 않는다. 그 task가 이 export들을 wireframe 이름 그대로 내놓는다고 적었다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/`
  - `tools/wireframes/frames/compositions/agent-setup/` (`settings-agents.tsx`와 `agent-setup-pages.tsx`는 다음 task `screens-agents-settings`도 고친다. 이 task가 먼저, 그쪽이 뒤다)
  - `tools/wireframes/frames/compositions/agents-tab.tsx`
  - `packages/design/wording/catalog/agents.ts` (wording-split이 만든 file. 소유 바꾸기 요청: `ownership.md`의 screens-agents에 더한다)
  - `packages/design/wording/catalog/agents.placeholders.ts` (`generate.ts`가 만드는 생성물)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `U2.3#28`, `U2.3#29`
  - spec: S4 2장(정의의 구성, 층), 5장(지침 층), 11장 13(role 이름) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S2 4장(agent grant, 효과별 기본값, app-api별 override) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S8 2장(place와 agent: Operator는 project나 앱에 놓인다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I3.4#27`, `U1.3#1`, `U1.3#2`, `U2.3#3`, `U2.3#23`, `U2.3#24`, `U2.3#25`, `U2.3#26`, `U2.3#27`, `U2.3#30`, `U3.3#1`, `U3.3#2`, `U3.3#3` (`../assignment.md`의 screens-agents 줄 가운데 이 task 몫. `U2.3#2`는 screens-app-space 줄이지만 이 폴더의 role 이름은 이 task가 바꾼다)
  - 결정: `../README.md` 3장 #18·#23·#57 (이름: Context Engineer → `project_manager`, `run` → turn, `correction` → steer, `command` → app-api)
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/agent-setup/agent-editor.tsx` (Definition·Grants 탭)
    - `tools/wireframes/frames/compositions/agent-setup/grants-panel.tsx` (`GrantsPanel`, `DefaultsTable`)
    - `tools/wireframes/frames/compositions/agent-setup/parts.tsx` (`SkillList`, `McpList`, `ProfileField`, `InstructionsBlock`, `DefaultModelField`, `ProtectedKeyNote`, `ServerForm`)
    - `tools/wireframes/frames/compositions/agent-setup/project-agents-tab.tsx` (project Agents 탭)
    - `tools/wireframes/frames/compositions/agent-setup/setup-data.ts` (가짜 data)
    - `tools/wireframes/frames/compositions/agent-setup/agent-setup.module.css`
    - `ui-inventory.md` 6.1 규칙(오른쪽 끝 고정 열의 토글·단추, 가운데 기둥 폭, 탭 안 알림은 toast, vendor 아이콘)
- 계약:
  - 쓰는 것:
    - `protocol/lophn-agent`의 agents 파일(정의 읽기, `operator.create`·`operator.update` 입력)과 role 이름 `project_manager`. contract-calls-places(wave 2)가 둔 이름을 쓴다.
    - `protocol/approvals`의 agent grant type(앱, 외부 MCP tool, 부를 수 있는 agent, 설정 고치기, 효과별 기본값). contract-approvals(wave 2)가 둔 이름을 쓴다. 모양은 S2 4장을 따른다.
    - `protocol/lophn-agent/agents.ts`의 기존 route `agent-profiles` upload·read (profile 이미지).
    - ui-chrome(wave 2)이 `packages/design`에 둔 `VendorIcon`·`vendorOf`와 우측 단추 `Toast`.
    - screens-conversation-composer가 옮긴 `conversation/model-picker/`의 `ModelField`·`OptionAxes`·`ModelPicker`(`scope: "definition"`).
  - 내놓는 것 (다른 task가 import한다. 이름과 props를 유지한다):
    - `workspace/agents/agents-page.tsx`의 `AgentsPage`, `workspace/agents/source.ts`의 `AgentsSource.list(project)`와 `AgentListRow` 모양. 소비자: sidebar(screens-project), `app-frame/agent-pane.tsx`·`app-agents.ts`·`agent-select.tsx`(screens-app-space-frame), `conversation/agent-core-source-model.ts`(screens-conversation). 모양을 바꾸면 소비자가 깨지므로 바꾸지 않는다. 필요하면 보고에 적는다.
    - `workspace/agents/fake-source.ts`의 `createFakeAgentsSource`. dev-mock이 쓴다.
    - settings task(`screens-agents-settings`)가 쓸 것: `workspace/agents/editor/`의 `AgentEditor`(lophn 전역 설정에도 쓴다), `GrantsPanel`, `DefaultsTable`, `SkillList`, `McpList`, `DefaultModelField`, `ProtectedKeyNote`, `ServerForm`.

## 할 일

1. **source 모양을 새 모델로 고친다** — `workspace/agents/source.ts`, `views.ts`. (S4 2장, S2 4장, `U2.3#27`, `U1.3#2`)
   - `AgentsOverview`에서 role별 `chosenModels`·`effectiveModels`와 `permissions: PermissionRow[]`를 지우고, project 층 model 하나(`projectModel`: 고른 값 또는 null과 실제로 쓰는 값·출처)를 둔다. 근거: wireframe `project-agents-tab.tsx`가 project 층 model 하나다.
   - `AgentsSource`에서 `changeRoleModel`, `setPermission`을 지우고 `setProjectModel(project, choice | null)`을 둔다. `PermissionRow`는 지운다.
   - `AgentsSource`에 agent grant 읽기·저장을 더한다(agent ID 기준. 앱, 외부 MCP tool, 부를 수 있는 agent, 설정 고치기, 앱 app-api별 override). 모양은 contract-approvals의 agent grant type을 따른다.
   - `AgentDetail`에 놓이는 곳(Operator의 project나 앱), 내장 skill 표시를 위한 skill의 `builtIn` flag, agent 층 MCP server 목록을 더한다.
   - `setSkill`이 project 층·agent 층에서 실제로 바뀌도록 한다(`U2.3#25`). 지금 core-source는 `unavailable`이다.
   - `core-source.ts`: wave 2 계약(`protocol/*`)에 route가 정의된 새 method는 그 route를 부른다(core의 handler가 아직 없어도 된다. 붙이는 것은 통합 단계다). 계약에 route가 없는 method만 `{ ok: false, code: "unavailable" }`로 답하게 둔다. 이 task가 route를 새로 만들지 않는다.
2. **profile 이미지를 잇는다** — `core-source.ts`의 `uploadImage`, `imageSrc`. 기존 route `agent-profiles` upload·read(`protocol/lophn-agent/agents.ts`)를 부른다(`I3.4#27`). 지금은 `unavailable`과 빈 글이다.
3. **agent editor를 옮긴다** — `editor/agent-editor.tsx`(658줄)를 wireframe `agent-setup/agent-editor.tsx`대로 다시 짠다. Definition 탭과 Grants 탭이다.
   - 지운다: "Built-in instructions (read only)" 접힌 줄(`builtInInstructions`, `builtInToggle`) — `U1.3#1`. Permissions 칸(`PermissionsField`, `onTogglePermission`) — `U1.3#2`. 데이터 칸 id(`data-field=permissions`).
   - Definition 탭의 칸 순서와 모양은 wireframe을 따른다: profile(icon 고르기 또는 이미지 올리기), 이름, 놓는 곳(새 Operator는 project나 앱 고르기 — `U2.3#30`), 지침 블록, model, skill, MCP.
   - 지침 블록은 project 지침(`LOPHN.md`)과 그 agent의 지침을 같이 보인다. lophn에는 project 지침이 없다. App Engineer는 앱 source가 속한 등록 project의 것이다 — `U2.3#24`, S4 5장. 지금 `ProjectInstructionsView`(첫 4줄)를 이 모양으로 바꾼다.
   - Model 칸은 wireframe의 `ModelField`: 상속 표시, Changed, Reset, picker 단추. picker는 `conversation/model-picker/`의 `ModelPicker`를 쓴다. 이 task는 `workspace/agents/editor/model-field.tsx`를 만들어 그것을 감싼다. `model-picker-data.ts`는 `ModelPicker` props를 만드는 연결이므로 남긴다.
   - Skills 칸: 층마다 켬·끔이 실제로 바뀐다(`U2.3#25`). 내장 skill(Project Manager의 `context-init`, `context-update`)은 스위치 대신 "Built-in" 표시이고 끌 수 없다 — `U3.3#2`.
   - MCP 칸: 서버 이름의 켬·끔과 agent 층에서 서버를 더하는 폼 — `U2.3#26`, `U3.3#3`. 폼은 wireframe `ServerForm`을 `editor/server-form.tsx`로 옮긴다. credential 값은 이 폼이 받지 않고 `ProtectedKeyNote`대로 보호 입력으로 받는다. 지금 `settings/extensions/server-form.tsx`의 폼은 다음 task가 이 폼을 쓰도록 바꾼다.
   - 저장 실패·충돌·삭제 실패 알림은 색 띠나 상자가 아니라 design `Toast`(ui-chrome)로 그 탭 위쪽에 띄운다(6.1).
4. **Grants 화면을 새로 만든다** — `editor/grants-panel.tsx`. `GrantsPanel`(앱, 외부 MCP tool, 부를 수 있는 agent, 설정 고치기를 붙이고 대상마다 묻는지를 정한다)과 `DefaultsTable`(효과별 기본값: read·write 묻지 않음, external·설정 고치기 물음)을 wireframe `grants-panel.tsx`대로 옮긴다. 앱을 펼치면 app-api마다 빼거나 묻는지를 바꾼다. 새 release가 더한 app-api는 "기본값으로 들어옴"으로 보인다 — `U3.3#1`, S2 4장.
5. **Agents 탭을 옮긴다** — `agents-tab.tsx`(403줄)와 `agents-page.tsx`(558줄)를 wireframe `project-agents-tab.tsx`대로 바꾼다.
   - lophn 카드를 지운다(전체에 하나라 전역 쪽 몫) — `U2.3#23`.
   - Project Manager 카드(project마다 하나), 이 project의 Operator 목록과 [New Operator], 같이 쓰는 `LOPHN.md` 블록, project 층 model 하나, skill, MCP server를 보인다.
   - "Models for this project"의 role별 줄과 Permissions 줄을 지운다 — `U2.3#27`, `U1.3#2`.
   - "정의는 lophn에 저장되고 project 폴더에는 없다" 안내 글은 남기되 lophn이 전역 한 곳이라는 뜻에 맞춘다.
6. **sidebar 쪽 목록 모델을 맞춘다** — `sidebar-agents.ts`: role 순서를 Project Manager, Operators로 하고 이름을 `project_manager`로 바꾼다(`U2.3#3`). sidebar 화면 코드(`workspace/sidebar/agents-section.tsx`)는 screens-project 몫이다. `export` 이름은 유지한다.
7. **role 이름을 바꾼다** — 이 폴더의 `context_engineer`, "Context Engineer" 글을 모두 `project_manager`, "Project Manager"로 바꾼다(`U2.3#2`의 이 폴더 몫). `agents-tab.tsx`, `agents-page.tsx`, `fake-source.ts`가 해당한다.
8. **fake source를 만든다** — `fake-source.ts`를 wireframe `setup-data.ts`의 data(PROJECT `phroner`, Project Manager, Operator `eval-analyst`, App Engineer `Budget tracker`, lophn, 층마다의 model·skill·MCP, agent grant 대상)로 채운다. 이 data는 `settings-agents.tsx`(다음 task가 지우기 전까지)도 쓰므로 필요한 상수를 `fake-source.ts`에서 export한다.
9. **글을 wording key로 바꾼다.** 박아 둔 영어 글(wireframe의 Grants, Definition, Built-in, "Use project default", "Add server" 등)은 wording key로 만든다. 글이 바뀌지 않은 곳은 기존 key를 그대로 쓴다. 새 key는 `catalog/agents.ts`에 `agents.<종류>.<뜻>` 꼴로 만든다(첫 구간은 wording-split 뒤 아무 kebab-case 이름이다). 안 쓰게 된 옛 key(`project-workspace.*agent-editor-permissions` 등)는 지우지 않는다. 4단계 cleanup이 지운다. 만든 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 이 영역의 `catalog/agents.placeholders.ts`를 다시 만든다.
10. **CSS를 합친다.** `agent-setup.module.css`(587줄)에서 쓰는 규칙을 `editor/agent-editor.module.css`, `agents-tab.module.css`, 새 `editor/grants-panel.module.css`로 옮긴다. 토글·행동 단추는 줄 오른쪽 끝 고정 열, 본문은 최대 폭 기둥을 가로 가운데에 둔다(6.1). 글 넣는 칸 focus 모양은 design `Input`·`Textarea`·`Select`가 정하므로(ui-chrome) 여기서 따로 덮지 않는다.
11. **gallery를 옮긴 component로 그린다.**
    - `agent-setup/agent-setup-pages.tsx`의 editor page들(`ProjectAgentsPage`, `OperatorEditorPage`, `OperatorCreatePage`, `AppEngineerEditorPage`, `AgentServerFormPage`, `AgentGrantsPage`, `AgentGrantsAppPage`)과 `agents-tab.tsx`의 `AgentsBody`·`OperatorEditor`가 renderer의 `AgentsPage`·`AgentEditor`를 `createFakeAgentsSource()`로 그리게 한다. 바깥 틀(`ProjectApp`의 탭 body)과 export 이름, props는 그대로 둔다.
    - 상태 고정(Grants 탭, 앱 펼침, server form 열림)은 fake source의 data와 mount 뒤 click으로 만든다. component에 gallery 전용 prop을 더하지 않는다. click helper가 필요하면 `agent-setup/drive.ts`에 작게 둔다.
    - 지운다: `agent-setup/agent-editor.tsx`, `grants-panel.tsx`, `parts.tsx`, `project-agents-tab.tsx`, `setup-data.ts`, `agent-setup.module.css`.
    - `agent-setup/settings-agents.tsx`는 지우지 않는다. import만 renderer 쪽(`workspace/agents/editor/`, `fake-source.ts`)으로 바꿔 계속 그려지게 한다. `screens-agents-settings`가 지운다.
12. **옛 화면 조각을 지운다.** `PermissionRow`·`views.ts`의 권한 줄 type, `agents-page.tsx`의 권한·role model 처리, 쓰는 곳이 없어진 export. 남이 쓰던 export는 지우지 않는다(보고에 적는다).
13. (lead가 맞추며 더함 (`U2.3#28`, `U2.3#29`)) 정의 저장 안내 문구 / profile 이미지

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 task. 데이터 손실·권한 경계 판정은 이 task에 없다. grant 판정은 B2 approval 몫)
- 남지 않음:
  - `grep -rn "context_engineer\|PermissionsField\|builtInInstructions\|changeRoleModel\|setPermission" packages/shell/renderer/workspace/agents`가 0줄이다.
  - `grep -rn "agent-setup/parts\|agent-setup/grants-panel\|agent-setup/setup-data\|agent-setup/agent-editor" tools packages`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-project-agents`, `new-operator-editor`, `new-operator-create`, `new-agent-editor-app-engineer`, `new-agent-mcp-server-form`, `new-agent-grants`, `new-agent-grants-app`이 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `agents`의 새 key와 지운 key(wording 생성은 이 task가 `generate.ts`로 영역 file만 만든다. `en.ts` 목록은 바뀌지 않는다), `desktop/dev-mock/mod.ts`가 만드는 `createFakeAgentsSource` 호출이 그대로인지(바뀐 export가 있으면 적는다)
- 안 쓰게 된 export (남이 쓰던 것은 지우지 않았다): `PermissionRow`, `changeRoleModel` 등 목록
- 남긴 prop: 소비자가 넘기는데 이 task가 안 쓰게 된 prop (`agents-page.tsx`의 `AgentsPageProps` 등). 소비자 task가 지운다.
- 정한 것: source method 이름, `model-field.tsx` 위치, fake data를 `fake-source.ts`로 옮긴 범위
- 계약 바꾸기 요청: agent grant type이나 profile route에 모자란 칸이 있으면 여기 적는다
