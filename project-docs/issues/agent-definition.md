# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `tools/file/pdf.ts`(`unpdf`), 이미지는 `tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## agent 정의의 MCP server가 turn에 연결되지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: Operator 정의는 자기 MCP server(`mcp_servers`)를 가질 수 있다(`packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`, 정의 file에 저장, renderer `packages/shell/renderer/workspace/agents/source.ts`가 "agent 층"으로 보인다). `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `serversOf(place, agent)`는 전역 → project → agent 층을 겹치지만 turn 준비(`packages/core/lophn-agent/run-loop/prepare.ts`의 `loadMcp`)는 `{ place, skip }`만 넘기고 `agent`를 넘기지 않는다. resolved agent(`packages/core/lophn-agent/agents/resolve.ts`)에도 정의의 `mcp_servers`가 없다. agent runtime의 Deno 권한 snapshot(`packages/core/lophn-agent/extensions/mcp-snapshot.ts`)도 이 층을 모른다. 그래서 정의에 넣은 서버는 연결되지 않고 tool도 안 생긴다. Grants의 MCP 목록(`agent-mcp-tools/list`)에도 없다.

영향: 사람이 Operator에 MCP server를 붙여도 그 agent가 그 tool을 쓰지 못한다. 화면에는 붙은 것처럼 보인다.

고치려면: resolved agent에 정의의 `mcp_servers`를 싣고 `loadMcp`가 `agent: { servers, off }`로 넘긴다. runtime의 Deno 권한(`--allow-net`·`--allow-run`)에 정의 층 서버를 더하고, 정의가 바뀌면 hosts·MCP처럼 child를 다시 띄운다(중간). Grants 목록은 같은 층을 받으면 따라온다. 추천: 이 안.
