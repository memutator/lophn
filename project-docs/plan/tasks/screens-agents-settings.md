# screens-agents-settings

Lophn Workspace › Settings의 Agents, Providers, Tools and skills 세 panel을 wireframe 코드에서 renderer `settings/{agents,providers,extensions}/`로 옮긴다. role 네 줄 기본 model과 요약용 model 칸을 지우고, 전역 기본 model 하나와 lophn 카드와 grant 기본값 표를 둔다. 확인 창 대신 화면 안 Dialog로 연결을 끊는다.

- 단위: screens-agents (wave 3)
- 선행: screens-agents-editor (lophn 설정 화면이 같은 `AgentEditor`를 쓰고, `SkillList`·`McpList`·`DefaultModelField`·`DefaultsTable`·`ServerForm`을 `workspace/agents/editor/`에서 import한다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/lophn-space/settings/agents/`
  - `packages/shell/renderer/desktop/lophn-space/settings/providers/`
  - `packages/shell/renderer/desktop/lophn-space/settings/extensions/`
  - `tools/wireframes/frames/compositions/workspace-settings.tsx` (`ownership.md`는 screens-workspace에 주었으나 내용이 Providers·Agents panel뿐이다. 소유 바꾸기 요청을 보고한다)
  - `tools/wireframes/frames/compositions/agent-setup/settings-agents.tsx` (선행 task가 먼저 손댄다)
  - `tools/wireframes/frames/compositions/agent-setup/agent-setup-pages.tsx` (선행 task가 먼저 손댄다)
  - `packages/design/wording/catalog/agents.ts` (선행 task와 같은 file. 소유 바꾸기 요청: `ownership.md`의 screens-agents에 더한다)
  - `packages/design/wording/catalog/agents.placeholders.ts` (`generate.ts`가 만드는 생성물)
- 읽을 것:
  - spec: S4 2장(model은 전역 기본 하나, 층), 5장(전역 지침) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S2 4장(agent grant 기본값) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `U1.5#10`, `U2.5#6`, `U2.3#25`(Settings 전역 skill 몫. 나머지 몫은 screens-agents-editor)
  - inventory: `ui-inventory.md` 1.1 "옛 dock, Roles, provider 계정의 흔적" 줄(`settings.accounts.*`), 6.1(vendor 아이콘, 오른쪽 끝 열), 6.7(Settings 항목 묶음)
  - 결정: `../README.md` 3장 #18·#23·#57
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/workspace-settings.tsx` (`ProvidersPane`, `ConnectDialog`, `ConnectDialogsStatic`, `AgentsPane`)
    - `tools/wireframes/frames/compositions/agent-setup/settings-agents.tsx` (`SettingsAgents`, `SettingsLophn`, `SettingsTools`)
    - `tools/wireframes/frames/vendors/` (vendor 아이콘)
- 계약:
  - 쓰는 것:
    - `protocol/lophn-agent`의 provider·model 계열(`providers.ts`, `models.ts`, `model-picker.ts`, `provider-inputs.ts`): 이 panel들이 이미 쓰는 route를 그대로 쓴다.
    - secret 보호 입력: contract-platform(`protocol/secrets`)과 contract-shell이 둔 창 열기 통로. 값은 이 화면이 받지 않는다.
    - ui-chrome(wave 2)의 `VendorIcon`·`vendorOf`.
    - 선행 task가 내놓는 `AgentEditor`·`GrantsPanel`·`DefaultsTable` 등.
  - 내놓는 것 (`settings-screen.tsx`가 import한다. 이름과 props를 유지한다): `AgentsPanel`(`{ source }`), `ProviderList`(`{ source, ... }`), `ExtensionsPanel`, 타입 `AgentsSettingsSource`·`ProviderSettingsSource`. props를 바꿔야 하면 optional로 더하고, 지우는 것은 보고의 "남긴 prop"에 적는다. `settings-screen.tsx`는 screens-workspace-settings가 고친다.

## 할 일

1. **Settings › Agents** — `agents/agents-panel.tsx`(373줄)를 wireframe `settings-agents.tsx`의 `SettingsAgents`대로 바꾼다. (`U2.5#6`, `U1.5#10`)
   - 위에서 아래로: 전역 기본 model 하나(`DefaultModelField`), lophn 카드("One for all of lophn"와 [Open lophn settings]), "Instructions for all projects"(전역 `LOPHN.md` 미리보기와 [Edit]), grant 기본값 표(`DefaultsTable`).
   - 지운다: role 네 줄 Default models(`ROLE_SLOTS`, `DefaultSlot`의 `lophn`·`context_engineer`·`app_engineer`·`operator`), "Model for summaries"(`DefaultSlot`의 `summaries`, `settings.heading.agents-summaries`), 줄 아래 editor를 여는 `model-editor.tsx`의 role 전용 부분.
   - lophn 카드의 [Open]은 같은 panel 안 둘째 화면 `SettingsLophn`을 연다: `‹ Agents` 단추와 선행 task의 `AgentEditor`(project 없는 lophn 전체 설정). 둘째 화면의 data는 `AgentsSettingsSource`에 lophn 읽기·저장을 더해 받는다. editor가 project를 필수로 받으면 optional로 하고 보고에 적는다.
   - Skills·MCP는 이 panel에 없고 Tools and skills에 있다. 이 panel 끝의 "Skills and MCP servers for all projects are in Tools and skills." 안내만 둔다. `AgentsSettingsSource.addServer`·`openInstructions`(settings-screen이 감싸 주는 통로)는 남긴다.
   - `settings-source.ts`의 `AgentsSettingsView`에서 role별 기본 model과 summaries를 지우고 `defaultModel`(하나)과 lophn 요약을 둔다. `model.ts`의 계산은 새 모양에 맞게 줄인다.
2. **Settings › Providers** — `providers/provider-list.tsx`, `connect-dialog.tsx`를 wireframe `ProvidersPane`·`ConnectDialog`대로 바꾼다.
   - "Connected"(이름, vendor 아이콘, 로그인 방법 badge, [Disconnect])와 "Add a provider"(이름, hint, [Connect]) 두 묶음이다. 연결 창은 로그인 방법 고르기(Sign in with …, API key)와 Custom provider 폼(Provider ID, Display name, Base URL, API key는 보호 입력 안내 `ProtectedKeyNote`)이다.
   - provider 이름 옆에 `VendorIcon`을 붙인다(없는 이름은 이름만).
   - [Disconnect]는 확인 창 통로(`ProviderSettingsSource`의 "연결을 끊는 확인 창을 연다")를 쓰지 않는다. 확인 창은 screens-data가 지운다. 화면 안 design `Dialog` 한 번으로 묻고 source는 `disconnect(provider)`를 부른다.
   - 계정 흔적을 지운다: `settings.accounts.*` wording을 쓰던 곳, "계정" 말, 계정 순서·끄기 같은 옛 조각. provider 연결은 provider마다 하나다.
3. **Settings › Tools and skills** — `extensions/extensions-panel.tsx`를 wireframe `SettingsTools`대로 바꾼다. (`U2.3#25`의 Settings 전역 몫)
   - "Skills (all projects)"(켬·끔, [Add skill])와 "MCP servers (all projects)"(켬·끔·상태, [Add server]) 두 묶음. 층 표시는 없다.
   - 폼은 `extensions/server-form.tsx`를 지우고 선행 task의 `workspace/agents/editor/server-form.tsx`(`ServerForm`)를 쓴다. `agents/agents-panel.tsx`의 [Add server]가 이 panel로 옮기는 흐름(`addServer`)은 그대로 둔다.
4. **fake source** — `agents/testdata/fake-agents.ts`, `providers/testdata/fake-providers.ts`를 새 source 모양에 맞게 고친다. wireframe의 data(연결된 Anthropic·OpenAI·xAI, 추가 가능한 Google·OpenRouter·Custom provider, 전역 skill·MCP)로 채운다. 이름 `fakeAgents`, `fakeProviders`(지금 export)는 유지한다. dev-mock이 부른다.
5. **core-source** — `agents/core-source.ts`, `providers/core-source.ts`를 type check가 통과하도록 고친다. 지운 method는 지우고, 새 method(lophn 읽기·저장, `disconnect`)는 wave 2 계약이나 기존 `protocol/lophn-agent`에 route가 있으면 부르고(core의 handler가 아직 없어도 된다) 계약에 route가 없는 것만 `{ ok: false, code: "unavailable" }`로 둔다. 새 route를 만들지 않는다. core에 붙이는 것은 통합 단계다. `settings/extension-settings.ts`와 `settings/source.ts`의 `SettingsSource`는 screens-workspace-settings 소유라 건드리지 않는다. `settings/model.ts`에서 import하는 `wayLabel`, `waysOf`, `serverAuthLabel`, `folderName`은 그쪽이 유지한다.
6. **role 이름을 바꾼다** — 이 폴더의 `context_engineer`, "Context Engineer" 글을 `project_manager`, "Project Manager"로 바꾼다(`U2.3#2`의 이 폴더 몫).
7. **글을 wording key로 바꾼다.** 박아 둔 영어 글은 wording key로 만든다. 글이 바뀌지 않은 곳은 기존 `settings.*` key를 쓴다. 새 key는 `catalog/agents.ts`에 `agents.<종류>.settings-<뜻>`·`providers-<뜻>`·`tools-<뜻>` 꼴이다. 안 쓰게 된 옛 key는 지우지 않는다(4단계 cleanup). 만든 뒤 `generate.ts`로 `catalog/agents.placeholders.ts`를 다시 만든다.
8. **CSS** — `agents/agents.module.css`, `providers/*.module.css`, `settings/settings.module.css`의 이 task 몫을 wireframe `agent-setup.module.css`·`agents.module.css`(compositions)의 규칙으로 맞춘다. 행동 단추는 줄 오른쪽 끝 고정 열(6.1). `settings.module.css`는 screens-workspace-settings 소유이므로 이 task는 읽기만 하고 필요한 규칙은 panel 쪽 module.css에 둔다.
9. **gallery를 옮긴 component로 그린다.**
   - `workspace-settings.tsx`: 아래 export 이름과 props는 그대로 두고 본문을 renderer component + fake source로 바꾼다. `AgentsPane({ initialView })`는 `AgentsPanel`을, `ProvidersPane({ onConnect })`는 `ProviderList`를 `fakeAgents`·`fakeProviders`로 그린다. `ConnectDialog`는 renderer `connect-dialog.tsx`를 얇게 감싼다. `ConnectDialogsStatic`은 `workspace-page.tsx`(screens-workspace)가 import하므로 이름은 남기고, renderer가 export하는 연결 창 body component 둘을 `div[role=dialog]`로 감싸 나란히 놓게 한다(감싸개만 gallery 코드). 단 page는 더는 쓰지 않는다. screens-workspace-space가 helper를 바꿀 때 지운다.
   - `agent-setup/settings-agents.tsx`는 지운다. `agent-setup-pages.tsx`의 Settings page들(`SettingsAgentsPage`, `SettingsLophnPage`, `SettingsProvidersPage`, `SettingsConnectPage`, `SettingsToolsPage`)은 `WorkspaceWithoutProject`의 `screen`·`pane` prop만 쓰게 하고(`panes`·`connectStatic` prop은 쓰지 않는다. 다음에 screens-workspace-space가 그 helper를 바꾼다), `SettingsLophnPage`(lophn 둘째 화면)와 `SettingsConnectPage`(OpenAI [Connect]를 눌러 연 연결 창 하나) 같은 하위 상태는 fake source data와 mount 뒤 click으로 만든다. `agent-setup/drive.ts`(선행 task가 둔 click helper)를 쓴다.
   - `workspace/settings-shell.tsx`(screens-workspace)가 `AgentsPane`·`ProvidersPane`·`ConnectDialog`를 import하므로 위 이름은 지우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 task. 키 값은 보호 입력이 받고 이 화면에 없다는 경계는 contract-platform·B9 몫)
- 남지 않음:
  - `grep -rn "context_engineer\|summaries\|settings.accounts" packages/shell/renderer/desktop/lophn-space/settings/agents packages/shell/renderer/desktop/lophn-space/settings/providers packages/shell/renderer/desktop/lophn-space/settings/extensions`가 0줄이다.
  - `grep -rn "agent-setup/settings-agents" tools packages`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-settings-agents`, `new-settings-lophn`, `new-settings-providers`, `new-settings-connect`, `new-settings-tools`가 옮긴 component로 그려진다. `new-settings-connect`는 실제 Dialog 하나를 연 모양이다(설명 글 "provider 연결 창 둘"은 lead가 `pages.ts`에서 고친다).

## 보고

- 바꾼 file
- 등록할 것: 영역 `agents`의 새 key와 지운 key. `desktop/dev-mock/admin.ts`와 `desktop/entry.tsx`가 만드는 source의 이름이 바뀌었으면 적는다(둘 다 screens-workspace-space가 잇는다). gallery `pages.ts`의 `new-settings-connect` 설명("provider 연결 창 둘")을 "연결 창"으로 고칠 것.
- 안 쓰게 된 export: `DefaultSlot`의 값들, `ModelEditor`의 role 전용 props 등 (남이 쓰던 것은 지우지 않았다)
- 남긴 prop: `settings-screen.tsx`가 넘기는데 이 task가 안 쓰게 된 prop
- 정한 것: 연결 끊기를 화면 안 Dialog 한 번으로 받은 것, lophn 둘째 화면의 data 통로 모양
- 계약 바꾸기 요청(wave 3): 없음 | 있으면 적는다
