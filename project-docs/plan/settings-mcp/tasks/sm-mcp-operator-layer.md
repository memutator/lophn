# sm-mcp-operator-layer

Operator 정의의 `mcp_servers` 층을 지운다: protocol 칸, 정의 file 키, `serversOf`의 agent 층, 편집 화면의 Add server와 renderer type. 지금 이 층은 정의 file에 저장되지만 runtime이 읽지 않아 넣어도 조용히 안 쓰인다. 잃는 것은 지금도 못 쓰는 Operator별 MCP다(사람이 정함: 추천대로 지운다).

- 단위: sm-mcp (wave 4)
- 선행: sm-envelope-sites, sm-mcp-settings-path
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/operators.ts`
  - `packages/protocol/lophn-agent/agent-definitions.ts`
  - `packages/core/lophn-agent/agents/definition-file.ts`
  - `packages/core/agent-roles/tools/operator.ts`
  - `packages/core/lophn-agent/extensions/mcp-toolkit.ts`
  - `packages/core/lophn-agent/extensions/mcp-server.ts`
  - `packages/core/lophn-agent/extensions/settings.ts`
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/views.ts`
  - `packages/shell/renderer/workspace/agents/fake-source.ts`
  - `packages/shell/renderer/workspace/agents/fake-data.ts`
  - `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`
  - `packages/shell/renderer/workspace/agents/editor/parts.tsx`
  - `packages/shell/renderer/workspace/agents/editor/server-form.tsx`
  - `packages/design/wording/catalog/agents.ts`
  - `packages/design/wording/catalog/agents.placeholders.ts`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`
  - `tools/wireframes/pages/screens/settings.tsx`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "agent 정의의 MCP server 층이 type과 정의 file에만 있다"(정한 것: 지운다)
  - architecture: `project-docs/architecture/agent-definition.md`(층 규칙. 문서 고침은 lead가 끝에 한다), `project-docs/architecture/approval.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`), `packages/core/agent-roles`(boundary `agent-roles`), `packages/shell/renderer`(boundary `shell`)
  - 규칙: `.claude/skills/wording/SKILL.md`(문구 둘을 고친다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `operatorDefinitionSchema`·`operatorDefinitionOutputSchema`에 `mcp_servers`가 없다. 전역·project 층 MCP server와 `mcp_off`(agent가 끄는 이름)는 그대로다.

## 할 일

지울 곳을 모두 적는다. 전역(`lophn-agent.extensions.mcp_servers` 설정)과 project 층(`project-extension-settings`, `project-settings.ts`, `project-servers.ts`, `registry.ts`, renderer `workspace/agents/core-extensions.ts`)의 `mcp_servers`는 Operator 층이 아니므로 건드리지 않는다.

1. protocol `operators.ts`: `mcpServersSchema`와 `mcpServerSchema` import를 지우고 `operatorDefinitionSchema`·`operatorDefinitionOutputSchema`의 `.extend`에서 `mcp_servers`를 뺀다. 머리 주석의 "agent 층 MCP 서버"를 지운다. `agent-definitions.ts`의 주석 예시 `mcp_servers.0.name`을 다른 칸(`contexts.1`만)으로 고친다.
2. core `agents/definition-file.ts`: `EMPTY_DEFAULT_LISTS`에서 `"mcp_servers"`를 뺀다. (정의 file에 `mcp_servers`가 있으면 이제 `unknown_field` 이유로 거절된다. 호환 장치를 만들지 않는다: AGENTS.md "호환성".)
3. core `agent-roles/tools/operator.ts`: `operatorDefinitionSchema.omit({ name: true, mcp_servers: true })`에서 `mcp_servers`를 빼고 주석의 "agent 층 MCP 서버(실행 파일을 정하는 것)는 입력에 없다"를 지운다. 승인 경계(`gateFor`)는 그대로다.
4. core `extensions/mcp-toolkit.ts`: `McpAgentLayer`, `McpSourceInput`을 지우고 `source(assignment, options?: McpSourceOptions)`로 둔다. `serversOf(place)`는 agent 인자와 agent 층 push를 지운다. `listTools`의 `serversOf(place, undefined)`는 `serversOf(place)`가 된다. 머리 주석과 `serversOf` 주석의 "agent 정의 층"을 지운다. (`prepare.ts`는 `agent`를 넘긴 적이 없다. `McpSourceOptions`·`skip`은 그대로다.)
5. core `extensions/mcp-server.ts`, `extensions/settings.ts`: 주석의 "전역, project, agent 층", "project·agent 층"에서 agent를 뺀다. `mergeMcpLayers`는 project 층의 `off`가 쓰이므로 둔다.
6. renderer `workspace/agents/source.ts`: `AgentDraft.mcp_servers`와 주석(`이 agent 층은 정의의 mcp_servers다`)을 지운다. `views.ts`: `McpLayer`에서 `"agent"`를 뺀다. `editor/parts.tsx`: `LAYER_LABEL`의 `agent` 항목을 뺀다.
7. renderer `editor/definition-form.tsx`: `FIELD_OF`의 `mcp_servers`, `ownServers()`, `addServer` state, `own`, `McpList`의 own 분기(`onToggle`에서 `own.some` 가지)와 `items`의 `...own`, `ServerForm`을 쓰는 블록과 Add server 단추, 쓰지 않게 된 import를 지운다. MCP 칸은 전역·project server 목록과 `mcp_off` 토글만 남는다. `editor/server-form.tsx`는 설정 화면의 전역 server 추가가 계속 쓰므로 둔다. 머리 주석의 "agent 층에서"를 "MCP server를"로 고친다.
8. renderer `fake-source.ts`의 `own` 개수 계산, `fake-data.ts`의 `notes-search` `mcp_servers` fixture를 지운다.
9. wireframe: gallery page `new-agent-mcp-server-form`(`agent-settings.tsx`)과 `AgentServerFormPage`(`agent-setup-pages.tsx`)를 지운다. 편집 화면에 Add server가 없으니 이 page가 그릴 상태가 없다. 새 화면을 만들지 않는다.
10. wording(`wording` skill): `agents.label.layer-agent`는 쓰는 곳이 없어지므로 `agents.ts`와 `agents.placeholders.ts`에서 지운다. 다음 두 문구는 이제 사실이 아니므로 고친다.
    - `agents.notice.settings-tools-servers`: "A server with the same name in a project or an agent replaces this one for that layer." → project만 말한다.
    - `agents.heading.server-form`: "Add a server for this agent only"는 전역 server를 더하는 form의 머리글로만 남았으므로 "Add a server"로 고친다.
    gallery 설명(`tools/wireframes/pages/screens/settings.tsx`의 "같은 이름은 project나 agent 층이 덮는다는 안내가 있다")도 project만 말하게 고친다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- `deno task wireframes`가 되고, gallery의 `Agent settings` page들이 그려진다.
- 위험 test: 없음(없는 기능을 지우는 일이다).
- 남지 않음(모두 0줄):
  - `grep -rn "mcp_servers" packages/protocol/lophn-agent/operators.ts packages/protocol/lophn-agent/agent-definitions.ts packages/core/lophn-agent/agents packages/core/agent-roles packages/shell/renderer/workspace/agents/source.ts packages/shell/renderer/workspace/agents/fake-source.ts packages/shell/renderer/workspace/agents/fake-data.ts packages/shell/renderer/workspace/agents/editor`
  - `grep -rnE "McpAgentLayer|McpSourceInput|ownServers|AgentServerFormPage|agent-mcp-server-form|layer-agent" packages tools --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`
- 손으로 확인: Operator 편집 화면의 MCP 칸에 Add server 단추가 없고, Settings › Tools and skills의 Add server는 그대로 된다.

## 보고

- 바꾼 file, 통과한 check
- 알려진 미완 동작: 정의 file에 `mcp_servers`가 들어 있는 Operator는 이제 정의 검사가 `unknown_field`로 거절하고 turn이 `agent_invalid`로 시작하지 않는다(`agents/layers.ts`). 개발 data는 지우고 새로 만든다.
- 정한 것: 문서에 답이 없어 정한 것
- 넘길 줄: 소유 밖 file을 맞춘 곳
- 무겁게 짠 것: 없으면 "없음"
