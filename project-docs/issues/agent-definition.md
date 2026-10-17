# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## agent 정의의 MCP server 층이 type과 정의 file에만 있다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/protocol, packages/shell/renderer]
```

지금: Operator 정의의 `mcp_servers`가 protocol(`packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`), 정의 file 키, renderer type(`packages/shell/renderer/workspace/agents/source.ts`)에 있다. `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `serversOf(place, agent)`도 agent 층을 겹친다. 그러나 붙이는 길이 없다. 화면의 draft(`packages/shell/renderer/workspace/agents/core-source.ts`)는 `mcp_off`만 보내고, 화면 목록(같은 폴더 `core-extensions.ts`)은 전역과 project 층만 그리고, `packages/core/agent-roles/tools/operator.ts`는 실행 파일을 정하는 입력이라 `mcp_servers`를 일부러 받지 않는다. 쓰는 쪽도 없다. turn 준비(`run-loop/prepare.ts`의 `loadMcp`)는 `agent`를 넘기지 않고 runtime의 Deno 권한(`extensions/mcp-snapshot.ts`)과 Grants 목록(`agent-mcp-tools/list`)도 이 층을 모른다.

영향: 사람이 정의 file을 손으로 고쳐 서버를 넣으면 그 서버는 조용히 안 쓰인다. 화면과 tool로는 넣을 수 없다. Operator마다 MCP server를 다르게 주는 기능은 지금 없다.

고치려면:
- 살린다(중간): resolved agent에 `mcp_servers`를 싣고 `loadMcp`가 넘긴다. Deno `--allow-net`·`--allow-run`에 정의 층을 더하고 정의가 바뀌면 child를 다시 띄운다. 화면 입력을 열고, 실행 파일을 정하는 입력이라 승인 경계를 다시 정한다.
- 지운다(작음): protocol 칸, 정의 file 키, `serversOf`의 agent 층, renderer type을 지운다. 잃는 것은 지금도 못 쓰는 Operator별 MCP다.
- 추천: 지운다. 필요해지면 그때 화면·승인과 같이 짠다.

정할 것: Operator별 MCP server를 제품 기능으로 살릴지 지울지.

## 목록에서 빠진 tool의 이유 구별(grant·release·거절)이 run-loop에서 닿지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/run-loop/tool-batch.ts`의 `one`은 목록에 없는 tool(`control.tools.info`가 없음)을 `not_found` "tool is not available"로 먼저 닫는다. 그래서 `packages/core/lophn-agent/tools/work.ts`의 `executeToolCall`이 받는 `missingReason`(prepare.ts가 `appApiMissingReason`으로 채움)과 `packages/core/lophn-agent/tools/app-api/missing.ts`의 `removed_from_release`·`removed_from_grant`·`denied`·`unknown_tool`, `packages/core/lophn-agent/tools/wire.ts`의 `MISSING_TOOL_MESSAGES`는 부를 길이 없다. `tests/e2e/operator_test.ts`의 `excluded` 행이 model이 받는 tool_result가 `not_found`임을 보였다.

영향: session 도중 사람이 grant에서 앱 tool을 빼거나 release가 api를 없애도 agent는 "없는 tool"로만 듣고 이유를 모른다. 쓰이지 않는 이유 구별 코드와 문구가 남아 고칠 때 헷갈린다.

고치려면:
- (추천) 이유 구별을 지운다(`missing.ts`의 `appApiMissingReason`·`AppApiMissingState`, `missingReason` 인자, `MISSING_TOOL_MESSAGES`, `missingState`). 목록에 없는 tool은 `not_found` 하나다. `grantAllows`는 `app-tools.ts`가 쓰니 남긴다.
- 또는 `tool-batch.ts`가 `not_found` 대신 `control.tools`에 이유를 물어 그 code로 닫는다. agent가 이유를 들어야 할 근거가 문서에 생기면 이쪽이다.
