# dt-mcp-endpoint

core HTTP server에 MCP Streamable HTTP endpoint 하나(`POST /mcp`, protocol `2025-06-18`)를 연다. 자격은 lophn terminal의 coding agent token이다. `tools/list`는 그 token의 앱의 tool을 보이고, `tools/call`은 그 앱의 **지금 도는 preview**로만 간다(`dt-preview-call`의 기반). preview가 없으면 `unavailable`이고 live 앱은 부르지 않는다.

- 단위: domain-tools (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/mcp.ts`(새 file)
  - `packages/protocol/coding-agent/mod.ts`
  - `packages/core/server/mcp.ts`(새 file)
  - `packages/core/server/server.ts`
  - `packages/core/server/mod.ts`
  - `packages/core/server/identity/coding-token.ts`
  - `packages/core/apps/mcp`(새 폴더: `serve.ts`, `serve_test.ts`, `mod.ts`)
  - `packages/core/main/daemon/wiring/coding-mcp.ts`(새 file)
  - `packages/core/main/daemon/wiring/context.ts`
  - `packages/core/main/daemon/core.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("coding agent가 lophn에 닿는 길은 CLI 하나이고 인증은 앱 하나 범위의 token이다"가 이 task로 CLI + MCP가 된다), `project-docs/architecture/app-call.md`(preview 절)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `coding-agent-cli-interface`, `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/server`
  - 제품 결정: `project-docs/products/roadmap/domain.md`의 "MCP server와 경계, 여러 domain을 쓰는 agent", "정한 것 (agent, 초안)"("MCP는 core가 host한다", "바깥 MCP client는 처음에 lophn terminal의 coding agent만 붙인다")
  - 계획: `project-docs/plan/domain-tools/README.md`의 "coding agent MCP endpoint"와 "test"
  - 지금 코드: `packages/core/server/server.ts`의 `respond()`(Host·Origin·Bearer 검사 `gateRequest` 뒤 `registry.lookup`), `packages/core/server/request.ts`의 `readLimitedBody`, `packages/core/server/identity/coding-token.ts`(token 발급: `scope.targets.app`, `conditions.app`), `packages/core/lophn-agent/extensions/adapters/mcp-http.ts`(lophn이 MCP **client**일 때 쓰는 protocol 판 상수 `2025-06-18`)
- 계약:
  - 쓰는 것: `ToolDeclaration`, `toMcpTool`(`dt-decl`), `appCallTool` 입력과 `CallAuth.previewOnly`·`PreviewService.current`(`dt-preview-call`, `dt-call-route`)
  - 내놓는 것: 아래 "계약 모양". `dt-mcp-harness`가 `CODING_MCP_PATH`를 쓴다

## 계약 모양

`packages/protocol/coding-agent/mcp.ts`(의존성 없는 값): `CODING_MCP_PATH = "/mcp"`, `MCP_PROTOCOL_VERSION = "2025-06-18"`, `CODING_MCP_SERVER_NAME = "lophn"`, `CODING_MCP_OPERATION = "coding.mcp"`.

**전송**(MCP spec `2025-06-18` Streamable HTTP에서 이 endpoint가 지키는 것)
- 한 경로 `/mcp`. `POST`만 받는다. `GET`·`DELETE`는 `405`(`Allow: POST`)다. server가 먼저 보낼 것이 없으므로 SSE stream을 열지 않는다. `Mcp-Session-Id`를 발급하지 않는다(상태 없는 server).
- body는 JSON-RPC 2.0 메시지 하나다. 배열(batch)은 `2025-06-18`에서 빠졌으므로 `-32600`으로 거절한다. 요청이면 `Content-Type: application/json` 응답 하나(SSE 없음). client가 보낸 notification·response면 `202 Accepted`와 빈 body다. 파싱 불가는 `400`과 `-32700`.
- `MCP-Protocol-Version` header가 있고 `2025-06-18`이 아니면 `400`이다. 없으면 통과한다. `Origin` header가 있는 요청과 Host 밖 요청은 이미 `gateRequest`가 거절한다(DNS rebinding 방어). 이 endpoint는 그 검사를 우회하지 않는다.
- body 상한은 `readLimitedBody`와 `RPC_JSON_MAX_BYTES`를 쓴다.

**method**
- `initialize` → `{ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "lophn", version: <core 판> }, instructions }`. client가 다른 판을 요청해도 우리 판으로 답한다. `instructions`는 한두 문장이다("이 ticket의 앱 tool이다. tools/call은 지금 도는 preview로만 간다. `lophn app preview start`로 연다.").
- `notifications/initialized` → 202. `ping` → `{}`.
- `tools/list` → `{ tools: McpTool[] }`(`nextCursor` 없음, 쪽 나누기 없음). 항목은 `toMcpTool(선언)`이다.
- `tools/call` `{ name, arguments? }` → `{ content: [{ type: "text", text }], structuredContent?, isError? }`.
  - 모르는 `name`(그 앱의 tool 목록에 없음)은 JSON-RPC error `-32602`다. 호출 길은 부르지 않는다.
  - 결과 `succeeded`: `text`는 결과 JSON 문자열, 결과가 object이면 `structuredContent`에도 싣는다(`outputSchema`가 있는 선언은 object여야 하고 앱 runtime이 이미 검사한다).
  - `failed`는 `isError: true`와 `"<code>: <message>"`(입력이 선언 schema에 안 맞아 앱이 낸 `invalid_input`도 여기라 agent가 고쳐 다시 부른다), `denied`는 `isError: true`와 `"denied (<code>): <message>"`, `unknown`은 `isError: true`와 `"result unknown (<reason>)"`.
  - preview가 없거나 아직 ready가 아니면 `isError: true`와 `unavailable: no preview is running for this app. Start one with \`lophn app preview start\`.`다. live 앱은 어떤 경우에도 부르지 않는다.
- 그 밖 method는 `-32601`. `resources/*`, `prompts/*`는 내지 않는다(roadmap "하지 않는 것").

**권한**
- token의 앱(`ctx.conditions.app`)만 본다. 다른 앱의 tool은 `tools/list`에도 `tools/call`에도 없다.
- actor가 `coding_agent`가 아니거나 token이 이 앱·operation에 닿지 않으면 `registry.authorize(ctx, CODING_MCP_OPERATION, { app })`가 거절한다. 거절은 `failure(error)`로 돌려주고(HTTP status는 `ERROR_HTTP_STATUS`) 다른 앱은 있는지 새지 않게 registry가 주는 `not_found`를 그대로 쓴다.

## 정한 것

- **`tools/list`는 preview가 있으면 preview bundle의 선언, 없으면 활성 release의 선언이다.** 둘 다 없으면 빈 목록이다. 이유: coding agent는 지금 만드는 tool(활성 release에 아직 없다)을 확인하려고 부르고, MCP client는 시작 때 `tools/list`를 부르므로 preview 없이도 성공해야 한다. 알려진 한계: preview를 연 뒤에 생긴 tool은 client가 `tools/list`를 다시 부를 때(재연결) 보인다. `listChanged`는 SSE가 필요해 내지 않는다.
- **coding agent의 호출은 `person` caller로 호출 길에 들어간다.** `caller = { kind: "person", view_session: <ctx.principal> }`(`coding_agent:<session>`), auth는 `{ actor: "user", previewOnly: true }`다. 이유: 새 caller 종류를 만들면 ledger의 `caller_kind` check·caller 판정 switch·rewind가 따라 바뀐다. preview 호출은 ledger를 남기지 않고(`dt-preview-call`) Gate를 거치지 않는 사람 화면의 preview 호출과 같은 취급이다. 운영으로 새지 않는 것은 `previewOnly`가 호출 길에서 막는다.
- **MCP 논리는 `packages/core/apps/mcp`, JSON-RPC 전송은 `packages/core/server/mcp.ts`다.** core 층 규칙(`tools/check-deps.ts`): `server`(바닥)는 `apps`(domain)를 import하지 않는다. `server/mcp.ts`는 `McpTools` interface(`list(ctx)`, `call(ctx, name, args)`)만 알고, `apps/mcp/serve.ts`가 그 구현을 만든다. 조립은 `main/daemon/wiring/coding-mcp.ts`다.

## 할 일

1. `packages/protocol/coding-agent/mcp.ts`와 `mod.ts` export.
2. `packages/core/server/mcp.ts`: 위 전송 규칙을 가진 `createMcpEndpoint(tools: McpTools): McpEndpoint`(`handle(ctx: AuthenticatedContext, request: Request): Promise<Response>`). `packages/core/server/server.ts`의 `ApiServerOptions`에 `mcp?: McpEndpoint`를 더하고 `respond()`에서 인증과 입장(`admission.enterHttp`) 뒤 `registry.lookup` 앞에 `url.pathname === CODING_MCP_PATH`를 가른다(없으면 `unavailable`). `server/mod.ts`에서 내보낸다.
3. `packages/core/server/identity/coding-token.ts`: `CODING_TOKEN_OPERATIONS`에 `CODING_MCP_OPERATION`을 더한다. 이 operation의 정책 `{ name: "coding.mcp", actors: ["coding_agent"], kind: "command" }`는 새 wiring의 `operations(ctx)`가 낸다.
4. `packages/core/apps/mcp/serve.ts`: `createCodingMcpTools(deps)`. deps는 `{ authorize(ctx): Result<{app}>, previews: { current(app) }, activeTools(app): Result<readonly ToolDeclaration[]>, calls: AppApiCallPath }`다. 위 method 규칙을 구현한다. 활성 release 선언은 `loadActiveBlueprint(sql, app)`(`packages/core/apps/releases/store.ts`)로 읽는다.
5. 조립: `wiring/coding-mcp.ts`가 `Built.mcp`를 낸다. 호출 길(`path`)과 `PreviewService`를 apps wiring이 `ctx.provide`로 내놓게 하고(`wiring/apps.ts`, `wiring/context.ts`의 provide 칸), `core.ts`가 `startApiServer({ ..., mcp })`로 넘긴다. WIRINGS 목록(`packages/core/main/daemon/assembly.ts`)에 새 wiring을 등록하는 일은 lead가 한다. 보고의 "등록할 것"에 적는다.
6. 위험 test 둘을 `packages/core/apps/mcp/serve_test.ts`에 쓴다(아래). 가짜 deps만 쓰고 server·subprocess를 띄우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "coding agent MCP의 `tools/list`에는 그 token의 앱의 tool만 있고 다른 앱의 tool은 없다" — 앱 둘의 선언을 가진 가짜 deps로 token의 앱만 오고, 다른 앱 token은 그 앱의 것만 오는 것, actor가 `coding_agent`가 아니면 거절되는 것을 본다. `write-test`: 권한 경계.
  - "`tools/call`은 preview로만 가고 live 앱을 부르지 않는다" — preview가 없으면 `isError`와 `unavailable`이고 가짜 호출 길(`calls.call`)이 불리지 않는다. preview가 있으면 호출 길이 `target.mode === "preview"`, `auth.previewOnly === true`로 불리고, 목록에 없는 tool 이름은 `-32602`이며 호출 길이 불리지 않는다. `write-test`: 운영 data를 AI가 만든 코드와 agent의 실수로부터 지키는 경계.
  - HTTP 층(`gateRequest`, Origin 거부, 경로 가르기)을 실제 server로 보는 test는 만들지 않는다. 서버를 띄우는 test는 새로 만들기 전에 사람에게 묻는다(AGENTS.md). 필요하다고 판단하면 보고에 적고 lead가 사람에게 묻는다.
- 남지 않음: `grep -rn "/mcp\"" packages --include=*.ts`에서 경로 문자열은 `packages/protocol/coding-agent/mcp.ts` 한 곳(과 그 상수를 쓰는 곳)뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/core/main/daemon/assembly.ts`의 WIRINGS에 `coding-mcp` wiring, `wiring/context.ts`의 `Built` 칸 `mcp`, provide 칸
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: `listChanged`가 없어 preview를 연 뒤 생긴 tool은 재연결 뒤에 보인다. 활성 release와 preview 선언이 모두 없는 앱은 빈 목록이다

## lead가 더함

- `packages/core/main/daemon/wiring/apps.ts`는 소유에서 뺐다. 계획 `domain-place`의 `dp-storage-apps`가 그 file을 쥐고 돈다. 공용 조립 file이라 lead가 merge 뒤 줄을 더한다.
  - `PreviewService`는 이미 `ctx.appsControl.previews`로 닿는다(`dt-preview-call`이 `AppsControl.previews`를 더했다). 새 provide가 필요 없다.
  - 호출 길(`createAppCalls`의 `path`)은 아직 provide되지 않는다. `wiring/context.ts`의 `Late`에 칸(예: `appCallPath: AppApiCallPath`)을 더하고 `wiring/coding-mcp.ts`가 그것을 읽게 쓴다. `wiring/apps.ts`에 넣을 `ctx.provide(...)` 한 줄은 보고의 "등록할 것"에 적는다. `coding-mcp.ts`는 lead가 WIRINGS에 등록하기 전까지 돌지 않으므로 기동 check는 그 줄 없이 통과한다.
