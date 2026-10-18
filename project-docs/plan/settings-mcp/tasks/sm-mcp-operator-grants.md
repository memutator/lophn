# sm-mcp-operator-grants

Operator의 Grants 탭이 그 Operator 정의 층 server의 tool도 보여 사람이 assign할 수 있게 한다. project 층 server와 같은 길(`agent-mcp-tools/list` → runtime이 서버에 연결해 목록을 읽음)을 쓰고, 목록을 요청하는 쪽이 Operator id를 함께 보내 runtime이 그 Operator의 정의 층을 더한다.

- 단위: sm-mcp (wave 6)
- 선행: sm-mcp-operator-secret-name, sm-mcp-operator-runtime, sm-envelope-sites
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/mcp-settings.ts`
  - `packages/core/lophn-agent/extensions/mcp-tool-requests.ts`
  - `packages/core/lophn-agent/extensions/mcp-toolkit.ts`
  - `packages/core/main/agent-runtime/mcp-tools-pump.ts`
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "agent 정의의 MCP server 층이 type과 정의 file에만 있다"(정한 것: Grants 목록도 그 층을 안다)
  - 현재 길: 화면 `core-grants.ts` `readGrants` → `mcpCatalog(link, place)` → memory `agent-mcp-tools/list`(`mcpToolsList`, 입력은 `{ place }`) → core `extensions/mcp-tool-requests.ts`가 요청을 대기열에 놓음 → runtime의 `main/agent-runtime/mcp-tools-pump.ts`가 `request-take`로 가져가 `listMcpTools(place)`(= `McpKit.listTools`) → `request-done`으로 답.
  - 전 task: `sm-mcp-operator-runtime`(`serversOf(place, agent)`의 agent 층이 살아 있다)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/agent-definitions.ts`의 `agentDefinitionRead`(machine 자격으로 읽힌다: `readActors`에 `machine`이 있다. `agents/layers.ts`가 같은 read를 쓴다), `places.ts`의 `AgentRef`
  - 내놓는 것: protocol 변경(옛 모양을 남기지 않는다. 쓰는 쪽 셋을 이 task가 모두 고친다).
    - `mcpToolsList.input`: `{ place, agent }`. `agent`는 `idSchema("agt").nullable()`(Operator id. Operator가 아니거나 Grants를 열지 않은 호출은 null).
    - `mcpToolsRequestTake.output.request`: `{ id, place, agent }`.
    - `McpKit.listTools(place, agent)`: `agent`가 Operator id면 machine 자격으로 `agentDefinitionRead`를 읽어 그 정의의 `mcp_servers`를 agent 층(`off: []`)으로 `serversOf`에 넘긴다. 읽지 못하거나 정의가 틀렸으면 그 층이 없는 것과 같다(fails closed, 기존 하위 층 규칙).

## 할 일

1. `mcp-settings.ts`: 위 두 schema에 `agent`를 더하고 머리 주석(`place는 Grants를 여는 agent의 자리다…`)에 agent 층 설명을 더한다. `mcpToolsRequestDone`은 그대로다.
2. `extensions/mcp-tool-requests.ts`: `Entry.request`와 list handler가 `agent`를 담아 take가 돌려주게 한다.
3. `extensions/mcp-toolkit.ts`: `listTools(place, agent)`를 위 계약대로 한다. `McpKit` type의 주석을 맞춘다. Operator의 `mcp_off`는 Grants 목록에 적용하지 않는다(정한 것: 지금 동작을 지킨다). 그 Operator가 끈 server도 목록에 보이므로 사람이 tool을 assign해 둘 수 있고, 끄기는 turn 준비(`skip`·`off`)가 맡는다.
4. `main/agent-runtime/mcp-tools-pump.ts`: `options.list(request.place, request.agent)`로 부른다(`main.ts`의 `listMcpTools` 연결은 type이 따라온다. 안 따라오면 그 줄만 맞추고 보고에 적는다).
5. `workspace/agents/core-grants.ts`: `mcpCatalog(link, place, ref)`가 `agent: ref.role === "operator" ? ref.agent : null`을 body에 싣는다(`readGrants`가 이미 `ref`를 만든다).

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: 없음. "그 Operator에게만 정의 층 server가 닿는다"는 `sm-mcp-operator-runtime`의 test가 같은 `serversOf` 겹치기로 이미 본다. 한 동작은 한 층에서만 본다.
- 남지 않음: `grep -rn "mcpToolsList\|mcpToolsRequestTake\|listTools(" packages --include=*.ts --exclude-dir=node_modules --exclude-dir=dist`의 호출처가 모두 `agent` 인자를 넘긴다(눈으로 확인한다).
- 손으로 확인: `sm-mcp-operator-runtime`의 손 확인에서 만든 Operator의 Grants 탭에 그 server의 tool이 뜨고 같은 project의 다른 Operator의 Grants 탭에는 뜨지 않는다. 진짜 MCP 서비스는 쓰지 않는다(가짜 stdio MCP 실행 파일 또는 fake).

## 보고

- 바꾼 file, 통과한 check
- 알려진 미완 동작: 정의 층 server가 `sign_in`이 필요한(OAuth, 손으로 고친 정의 file뿐) 경우 Grants가 `reason: "sign_in"`을 보여도 풀 로그인 길이 없다(`sm-mcp-operator-runtime`에 적었다).
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
