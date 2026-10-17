# mcp-grants-core

`agent-mcp-tools/list`를 실제로 동작하게 한다. core가 요청을 대기열에 놓고, agent runtime이 가져가 서버에 연결해 tool 목록을 읽어 돌려준다.

- 단위: mcp-grants (wave 1)
- 선행: mcp-grants-contract. route 셋이 있어야 handler와 pump를 붙인다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/mcp-toolkit.ts`
  - `packages/core/main/agent-runtime/main.ts`(pump 시작 몇 줄만. 계획 `agent-io`의 `model-catalog`도 이 file을 고쳐 `status.py`가 동시에 띄우지 않는다)
  - `packages/core/lophn-agent/extensions/mcp-tools.ts`
  - `packages/core/lophn-agent/extensions/mcp-tool-requests.ts`(새 file)
  - `packages/core/main/agent-runtime/mcp-tools-pump.ts`(새 file)
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "외부 MCP tool 이름을 읽는 route가 없어 Grants의 MCP 목록이 빈다"
  - architecture: `project-docs/architecture/approval.md`(효과: 선언을 믿는다, MCP는 `readOnlyHint`), `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`
  - 본보기: `extensions/mcp-auth-requests.ts`(대기열: 놓기, take, done, 기한)와 `main/agent-runtime/mcp-auth-pump.ts`(runtime의 pump), `main/daemon/wiring/lophn-agent-extensions.ts`(handler를 `memory`로 끼운다)
- 계약:
  - 쓰는 것: `mcp-grants-contract`가 정한 `mcpToolsList`, `mcpToolsRequestTake`, `mcpToolsRequestDone`, `McpToolServer`(`protocol/lophn-agent/mcp-settings.ts`).
  - 내놓는 것: `mcp-tool-requests.ts`의 `createMcpToolRequests({ newId, waitMs?, deadline? })` → `{ handlers: ReadonlyMap<"agent-mcp-tools/list" | "agent-mcp-tools/request-take" | "agent-mcp-tools/request-done", handler> }`(`createMcpAuthRequests`의 `handlers`와 같은 꼴). `mcp-toolkit.ts`의 `McpKit.listTools(place)`. `mcp-tools-pump.ts`의 `startMcpToolsPump({ call, list, signal })`. `productDriver`의 반환에 `listMcpTools`. lead가 이것을 wiring과 `main.ts`에 끼운다.

## 지켜야 할 것(계획 README 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.
- 새 E2E·subprocess·서버 test는 쓰지 않는다. 새로 만들기 전에 사람에게 묻는다(AGENTS.md).

## 할 일

1. `mcp-tools.ts`: 효과를 정하는 한 줄(`entry.read_only ? "read" : "external"`, 지금 tool 정의를 만드는 곳에 있다)을 작은 함수로 빼 export하고 정의 만들기와 목록 읽기가 같은 것을 쓴다. 근거: approval.md "선언은 믿는다". 목록에 보이는 effect가 실행 때의 effect와 어긋나지 않게 규칙을 하나로 둔다.
2. `mcp-toolkit.ts`: `McpKit`에 `listTools(place: AgentPlace | null)`을 더한다. 서버 선택은 `serversOf(place, undefined)`(전역에 project 층, 같은 이름은 마지막 층)를 그대로 쓰고, 서버마다 `{ name, tools, reason }`을 돌려준다.
   - `enabled=false`는 연결하지 않고 `reason: "disabled"`. `checkMcpConfig`가 거른 문제 서버는 목록에서 뺀다.
   - 연결은 `connections.acquire` → `connections.toolList`를 이 호출 전용 assignment id로 한다(예: 요청마다 새 id). 끝나면 `connections.endAssignment`로 닫는다. 못 읽으면 `reason`: 로그인이 필요해 실패한 것(`ConnectionView.state === "failed_auth"`)이면 `sign_in`, 그 밖에는 `unreachable`, `tools: []`.
   - `description`은 500자로 자른다(없으면 빈 글). 응답에 서버 설정, header, secret, schema를 싣지 않는다. 이름, 설명, effect만.
   - turn 쪽 `source()`와 `refresh`/`known` 상태는 건드리지 않는다. 이 호출은 turn의 tool 등록과 상태를 공유하지 않는다.
   - 근거: 이슈 "연결이 필요하므로 못 읽은 서버는 빈 목록과 이유로 돌려준다". 서버 연결과 재조회는 이 module이 소유한다(mcp-toolkit.ts 머리 주석).
3. `mcp-tool-requests.ts`(새): `mcp-auth-requests.ts`와 같은 꼴의 대기열이다.
   - `list` handler: 입력을 `mcpToolsList.input`으로 검사하고(틀리면 `invalid_input`) 요청을 놓은 뒤 runtime의 답을 기다려 `{ servers }`로 돌려준다. 기한(추천 15초, 주입 가능)이 지나거나 runtime이 없으면 `unavailable`이고 요청은 대기열에서 빠진다. 늦은 답은 받지 않는다.
   - `request-take` handler: 가장 오래된 안 가져간 요청을 준다. 없으면 `{ request: null }`.
   - `request-done` handler: 기다리는 요청이면 `accepted: true`로 `list`를 깨운다. 모르거나 지난 요청이면 `false`. `servers`는 output schema(`mcpToolsList.output`)로 다시 검사하고 틀리면 `invalid_input`.
   - 대기열은 작업 메모리다. ledger, event, log에 쓰지 않는다. 근거: `mcp-auth-requests.ts`와 같은 이유(MCP 연결은 runtime의 몫이고 core에는 외부 연결이 없다).
4. `main/agent-runtime/mcp-tools-pump.ts`(새): `startMcpAuthPump`와 같은 꼴의 loop. machine 자격의 `call`로 `mcpToolsRequestTake`를 읽고, 있으면 `list(request.place)`를 하고 `mcpToolsRequestDone`으로 `{ id, servers }`를 돌려준다. 읽는 중 던지면 그 요청은 `servers: []`로 닫지 말고 답하지 않는다(core 기한이 처리한다). 쉬는 시간과 오류 삼키기는 `mcp-auth-pump.ts`를 따른다.
5. `product-driver.ts`: `productDriver`가 이미 만든 `mcpKit`의 `listTools`를 `listMcpTools`로 반환 object에 더한다(반환 type도 맞춘다).
6. `main/agent-runtime/main.ts`에서 `listMcpTools`가 있으면 `startMcpToolsPump`를 `startMcpAuthPump` 옆에서 시작하고 `pumpStop.signal`로 멈추게 하는 코드를 **최소로**(여섯 줄 안쪽) 더한다. 이 file은 계획 `agent-io`의 몫이므로 이 task는 소유하지 않는다. 더한 줄은 보고의 "넘길 줄"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 판단: 사용자 data를 잃거나 망가뜨리지 않고, 효과는 표시용이며 실행 판정은 기존 Gate가 한다. 응답에는 이름, 설명, effect뿐이라 secret 경계를 넘지 않는다. 서버 연결 권한은 기존 runtime의 `--allow-run`·`--allow-net` 목록이 그대로 정한다. (연결·pump는 subprocess·서버 test라 새로 만들지 않는다. process를 건너는 확인은 이 계획이 하지 않는다.)
- 남지 않음: 새 효과 규칙 함수 말고 `read_only ? "read" : "external"` 줄이 `extensions/`에 둘 이상 남지 않는다. `grep -rn 'read_only ? "read"' packages` 가 1줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고친다. `main/daemon/wiring/lophn-agent-extensions.ts`의 `build()`에서 `createMcpToolRequests({ newId: () => crypto.randomUUID() }).handlers`를 `memory: [...]`에 더한다. `protocol/lophn-agent/registry.ts`, `register.ts`의 `memoryRoutes`, `runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`는 `mcp-grants-contract`의 등록 목록과 같다(이미 되어 있으면 확인만)
- 안 쓰게 된 export
- 정한 것: 기한 값, 요청마다 assignment id, `reason` 매핑
- 넘길 줄: `main/agent-runtime/main.ts`에 더한 줄
- 계약 바꾸기 요청: route 모양이 구현과 안 맞으면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 있으면 적는다. 알려진 것: agent 정의 층의 MCP 서버는 runtime의 Deno 권한 snapshot(`extensions/mcp-snapshot.ts`)에 없고 turn의 `loadMcp`도 이 층을 안 넘기므로 이 목록에도 없다. 서버 연결이 느리면 Grants 읽기가 기한까지 기다린다.
