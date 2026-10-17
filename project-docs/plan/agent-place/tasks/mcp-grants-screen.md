# mcp-grants-screen

Grants 화면의 `readGrants`가 `agent-mcp-tools/list`를 읽어 `catalog.mcpServers`를 채운다. 사람이 MCP tool별로 권한(ask/allow)을 보고 정하게 한다.

- 단위: mcp-grants (wave 1)
- 선행: mcp-grants-contract. route 모양이 있어야 읽는 쪽을 쓴다. core 구현(`mcp-grants-core`)과는 서로 기대지 않는다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "외부 MCP tool 이름을 읽는 route가 없어 Grants의 MCP 목록이 빈다"
  - architecture: `project-docs/architecture/approval.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/shell/main`
  - 본보기(화면): 새로 그리지 않는다. `packages/shell/renderer/workspace/agents/editor/grants-panel.tsx`가 `catalog.mcpServers`를 이미 그린다(카드, tool 줄, `AssignMenu`). `fake-data.ts`의 `MCP_TOOLS`가 같은 모양의 예다.
- 계약:
  - 쓰는 것: `mcp-grants-contract`의 `agent-mcp-tools/list`(memory)와 `McpToolServer`. 화면 쪽 `GrantMcpServer`(`workspace/agents/source.ts`)는 바꾸지 않는다.
  - 내놓는 것: `readGrants`가 돌려주는 `catalog.mcpServers`가 읽은 서버별 `{ server, tools: { tool, detail, effect }[] }`다.

## 지켜야 할 것(계획 README 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.
- 새 E2E·subprocess·서버 test는 쓰지 않는다. 새로 만들기 전에 사람에게 묻는다(AGENTS.md).

## 할 일

1. `core-grants.ts`: `mcpCatalog(link, place)`를 더한다. `link.memory("agent-mcp-tools", "list", { place })`를 부르고 `reason === null`인 서버만 `GrantMcpServer`로 옮긴다(`tool`, `detail` = `description`, `effect`). 호출이 실패하면 빈 목록이다(`appCatalog`가 실패를 빈 목록으로 두는 것과 같다).
   - `place`는 `readGrants`가 받는 자리 문자열에서 만든다: `null`이면 `null`, `isAppPlace(place)`(`./agent-key.ts`)이면 `{ kind: "app", id }`, 아니면 `{ kind: "project", id }`.
   - `reason`이 있는 서버(`disabled`, `sign_in`, `unreachable`)는 목록에서 뺀다. tool이 없는 서버는 `AssignMenu`에 떠도 붙일 것이 없고, 이유를 보이려면 새 문구가 필요한데 문서에 없는 요구다(아래 "정한 것").
   - `appCatalog`·`agentCatalog`와 `Promise.all`로 함께 읽는다. MCP 연결이 느린 서버가 있어도 다른 목록이 그만큼 더 늦지 않게 한다.
   - `readGrants`의 `mcpServers: []` 하드코딩을 이 결과로 바꾸고, 파일 머리 주석의 "MCP tool 대상은 비어 있다"를 지금 사실에 맞게 고친다. 근거: 이슈 "readGrants가 채운다".
2. `allowlist.ts`: `RENDERER_MEMORY_ROUTES`에 `"memory:agent-mcp-tools/list"`를 더하고 위 주석의 renderer 호출 목록에 한 줄을 더한다(Grants의 MCP tool 목록 읽기). `take`·`done`은 runtime만 부르므로 더하지 않는다. 근거: memory route는 이 목록에 있어야 renderer가 부를 수 있다(파일 머리 주석). `read`·`command`는 자동 허락이라 이 목록과 무관하다.
3. 화면 모양, 문구, `grants-panel.tsx`, wording catalog는 건드리지 않는다. 기존 `agents.empty.grants-tools`("No MCP tools.")와 카드가 그대로 쓰인다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 판단: route 응답을 화면 모양으로 옮기는 일이고 사용자 data, 권한, secret 경계를 건드리지 않는다. `allowlist.ts`는 memory route 하나를 열 뿐이고 `take`·`done`(machine 입구)은 renderer에 열리지 않는다.
- 남지 않음: `grep -n "mcpServers: \[\]" packages/shell/renderer/workspace/agents/core-grants.ts`가 0줄이다.
- (화면) 문구·그림이 바뀌지 않아 `deno task wireframes`는 해당 없다. 가짜 source(`fake-source.ts`, `fake-data.ts`)는 이미 MCP 예를 가졌으므로 고치지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`registry.ts`, `register.ts`, `runtime-access.ts`, wiring은 `mcp-grants-contract`·`mcp-grants-core`의 등록 목록을 lead가 고친다)
- 안 쓰게 된 export
- 정한 것: 읽지 못한 서버(`reason`이 있는 서버)를 목록에서 뺐다. 사람에게 이유를 보이려면 `GrantMcpServer`에 칸과 wording key가 필요하다
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 알려진 것: 로그인이 필요한 서버나 연결 실패 서버는 Grants에 나오지 않는다(이유 안내 없음). 연결이 느리면 Grants 읽기가 core 기한까지 기다린다.
