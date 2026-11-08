# wlayer

Home과 앱에 project와 같은 사람 설정 층(지시, MCP와 끄기, skill 끄기, model)을 둔다. Home의 그릇 자리 `<data>/home/`를 만들고, 앱 지시 층은 앱 source의 `AGENTS.md`다. project만 받던 route를 workspace를 받게 넓힌다.

- 단위: wlayer (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{instructions,mcp-settings,models}.ts`
  - `packages/core/lophn-agent/instructions/`
  - `packages/core/lophn-agent/prompt-assembly/{basis,turn-prompt}.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/extensions/{project-settings,mcp-toolkit,project-servers,mcp-snapshot,mcp-oauth-vault,mcp-auth-control,mcp-server,skill-folders,skills-handler,skill-read,registry}.ts`
  - `packages/core/lophn-agent/secret-destinations.ts`, `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/models/{store,reads,commands}.ts`, `packages/core/lophn-agent/agents/{layers,resolve,inspect}.ts`
  - `packages/core/agent-workspaces/workspace/{data-folder,project-layer,workspace-data,workspace-folders}.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`, `packages/core/main/daemon/workspace-folders-glue.ts`, `packages/core/main/daemon/wiring/instructions-registration.ts`
  - `packages/core/apps/lookups.ts`
  - `packages/core/agent-workspaces/prompts/app.md`
  - `packages/shell/{ipc/instructions.ts,main/editor/instructions.ts,preload/instructions-api.ts}`
  - `packages/shell/renderer/workspace/agents/{core-source,core-extensions}.ts`
  - 위 file 옆의 `*_test.ts`
  - `project-docs/architecture/{agent-definition,workspace-session}.md`
- 읽을 것:
  - 계획: `project-docs/plan/workspace-layers/README.md`의 정한 것
  - architecture: `project-docs/architecture/agent-definition.md`(:21-27 흐름, :49-51 지시 층과 `AGENTS.md` 결정, :115 model 층, :119 skill 층), `project-docs/architecture/workspace-session.md`(:57, :72 그릇 자리)
  - skill: `.claude/skills/sdk-note/SKILL.md`
- 계약:
  - 쓰는 것: `Workspace | null`(null이 Home), `appSourcePath`(`core/apps/lookups.ts:23`)
  - 내놓는 것: `homeDataFolder(root)`, `workspaceDataFolder(root, workspace | null)`이 Home을 받는다. 지시 층 이름 `global | home | project | app | agent`. route `workspaceExtensionSettingsRead|Change`와 `workspaceModelRead|Change`의 입력 `{workspace: "home" | prj id | app id}`(옛 `project*` route는 지운다). `wmem`과 `wui`가 이것을 쓴다.

## 할 일

1. 그릇 자리: `data-folder.ts`가 Home(`<data>/home/`)을 받게 하고, `workspace-data.ts`가 Home에서도 `skills/`를 만든다. `workspaceScope`(`workspace-folders.ts`)는 Home의 `skills/`를 쓰기로 연다(project·앱과 같다). `<data>/home`이 다른 최상위 이름과 겹치지 않는지 확인한다.
2. 지시 층: 세 군데의 층 목록(`protocol/lophn-agent/instructions.ts:28`, `prompt-assembly/basis.ts:8`, `turn-prompt.ts`의 `INSTRUCTION_TITLE`·`NO_INSTRUCTIONS`, `prepare.ts:405`의 `instructionTexts`)을 하나로 모으고 `home`, `app` 층을 더한다. 순서는 global → home | project | app → agent다. Home은 `<data>/home/LOPHN.md`(없으면 CLAUDE.md), 앱은 `appSourcePath`의 `AGENTS.md`(source가 없으면 그 층 없음)다. `turn.ts:126`의 Home 분기를 지운다. 32 KiB를 넘거나 못 읽으면 지금처럼 turn을 막는다.
3. shell 편집 길(`ipc/instructions.ts`, `main/editor/instructions.ts` `pathOf`): `layer: home`과 `layer: app`을 더한다. 앱은 source의 `AGENTS.md`를 연다.
4. MCP·skill 끄기: `project-settings.ts`의 `extensions.json`을 workspace 층 파일로 일반화한다(Home `<data>/home/extensions.json`, 앱 `<data>/apps/<app>/extensions.json`). `mcp-toolkit.ts` `serversOf`, `registry.ts`, `skill-folders.ts` `productSkillStores`·`projectOff`·`productFiles.projectPath`, `skills-handler.ts`, `project-servers.ts` `collectProjectMcpEntries`(Home과 apps도 훑는다)가 Home과 앱을 받는다.
5. OAuth owner: `mcp-oauth-vault.ts` `scopeOf`와 `mcp-server.ts` fingerprint에서 Home 층 owner 열쇠를 `home`으로 둬 전역(`global`)과 겹치지 않게 한다. `mcp-auth-control.ts`의 owner 입력이 Home 층을 가리킬 수 있게 한다.
6. model 층: ledger `model_choices`의 scope가 `home`과 앱 id를 받는다(새 schema step이 필요하면 새 id로). `agents/layers.ts`의 `projectModelRead`, `resolve.ts`의 순서(session > agent > workspace > global), `inspect.ts` `effectiveModel`, `register.ts:528`.
7. route를 바꿨으니 renderer의 부르는 곳(`workspace/agents/core-source.ts`, `core-extensions.ts`)을 같은 변경에서 고친다. 화면을 Home과 앱에 여는 것은 `wui`다. 여기서는 project 화면이 그대로 돌게만 한다.
8. `prompts/app.md:52`의 "`AGENTS.md`를 file tool로 읽어라"를 지운다(이제 지시 층으로 온다). 이 file은 앱 agent가 읽는 지침이므로 `sdk-note` skill대로 판단해 필요하면 메모를 쓴다.
9. `extensions.json`의 data step 주인을 정해 보고한다(옮길 옛 data는 없다. 새 자리만 생긴다).
10. `agent-definition.md`의 층 절(:21-27, :49-51, :115, :119)과 `workspace-session.md`(:57, :72)를 고친 동작에 맞춘다. `:50`의 `AGENTS.md` 결정은 "앱 층에 한해 읽는다"로 바꾸고 이유(template에서 오고 이미 그 역할을 한다)를 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "calendar 앱 `extensions.json`의 MCP server가 그 앱 session에만 실리고 다른 workspace와 Home에는 실리지 않는다"
  - "Home 층 server의 OAuth token 이름이 전역 층 같은 이름 server의 token과 겹치지 않는다"
- 남지 않음: `grep -rn "projectExtensionSettings\|projectModelRead\|projectModelChange" packages`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.
