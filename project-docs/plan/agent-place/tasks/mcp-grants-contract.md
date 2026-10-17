# mcp-grants-contract

Grants 화면이 서버별 MCP tool 목록(이름, effect, 설명)을 읽는 route 셋의 모양을 `protocol/lophn-agent`에 정한다. 구현(core, runtime, 화면)은 이 task가 하지 않는다.

- 단위: mcp-grants (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/mcp-settings.ts`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "외부 MCP tool 이름을 읽는 route가 없어 Grants의 MCP 목록이 빈다"
  - architecture: `project-docs/architecture/approval.md`(grant, 효과 read·write·external, 선언을 믿는다), `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `project-docs/module-catalog.yaml`의 `packages/protocol`
  - 본보기: 같은 file의 `mcpAuthState`(사람이 읽는 memory route), `mcpAuthRequestTake`·`mcpAuthRequestDone`(runtime이 core 대신 일하는 machine 입구)
- 계약:
  - 쓰는 것: `packages/protocol/base/route.ts`의 `defineMemory`, 같은 file의 `agentPlaceSchema`(`./agent-values.ts`), `effectSchema`, `nameSchema`.
  - 내놓는 것(다른 task가 기대는 모양. 이름과 칸은 이대로):
    - `mcpToolsList` = `defineMemory`: resource `agent-mcp-tools`, method `list`, name `ListMcpTools`, actors `["user"]`, errors `["unauthorized","forbidden","invalid_input","unavailable"]`.
      - input: `{ place: AgentPlace | null }`(strict). Grants를 여는 agent의 자리다. project면 전역 서버에 그 project 층을 더한 목록이고, app이거나 null이면 전역 서버만이다.
      - output: `{ servers: McpToolServer[] }`
    - `McpToolServer` = `{ name, tools, reason }`(strict)
      - `name`: `nameSchema`(서버 이름).
      - `tools`: `{ tool: string(min 1), description: string(max 500), effect }[]`(max 2048). `tool`은 서버가 알린 원래 이름이고 grant의 `mcp_tool` entry의 `tool`과 같은 값이다. `effect`는 `read`|`write`|`external`이다(MCP는 `readOnlyHint`가 참이면 read, 아니면 external이라 write는 안 나온다).
      - `reason`: `null | "disabled" | "sign_in" | "unreachable"`. `null`이면 목록을 읽은 것이다. 아니면 `tools`는 빈 배열이다. `disabled`는 설정에서 꺼진 서버, `sign_in`은 OAuth 로그인이 필요한 서버, `unreachable`은 그 밖에 연결이나 목록 읽기가 실패한 서버다.
    - `mcpToolsRequestTake` = `defineMemory`: resource `agent-mcp-tools`, method `request-take`, name `TakeMcpToolsRequest`, actors `["machine"]`, input `{}`, output `{ request: { id: string(1..64), place: AgentPlace | null } | null }`. runtime이 가져간다.
    - `mcpToolsRequestDone` = `defineMemory`: resource `agent-mcp-tools`, method `request-done`, name `FinishMcpToolsRequest`, actors `["machine"]`, input `{ id: string(1..64), servers: McpToolServer[](max 64) }`, output `{ accepted: boolean }`.
    - export: 위 세 route와 `McpToolServer` type. `protocol/lophn-agent/mod.ts`가 `export *`로 이미 이 file을 내보낸다.

## 지켜야 할 것(계획 README 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.
- 새 E2E·subprocess·서버 test는 쓰지 않는다. 새로 만들기 전에 사람에게 묻는다(AGENTS.md).

## 할 일

1. `mcp-settings.ts`의 `mcpAuthRequestDone` 아래에 위 세 route를 더한다. 근거: 이슈의 "고치려면"(route 하나 + 못 읽은 서버는 빈 목록과 이유). MCP 연결은 agent runtime child가 쥐고 core module graph에는 외부 연결이 없어(`mcp-auth-requests.ts` 머리 주석) core가 요청을 놓고 runtime이 가져가 답하는 기존 `mcpAuthRequestTake`·`Done` 길을 그대로 따른다. 그래서 `list`는 대기열 상태를 쥔 memory route다(reader Worker의 read로는 못 한다).
2. 각 route 위에 "왜" 주석을 쓴다: 누가 부르는가(사람, runtime), 왜 memory인가, `reason`의 뜻, 응답에 서버 설정·credential이 없다는 것(이름, 설명, effect만).
3. 새 route는 옛 계약을 대신하는 것이 아니다. 지울 옛 route는 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 판단: schema 모양만 정하는 일이고 사용자 data, 권한, secret 경계를 건드리는 규칙이 아니다.
- 남지 않음: 없음(새 route만 더한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고친다. `protocol/lophn-agent/registry.ts`의 route 목록(`mcpToolsList`, `mcpToolsRequestTake`, `mcpToolsRequestDone`), `core/lophn-agent/register.ts`의 `memoryRoutes`(같은 셋), `core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`(`take`·`done` 둘)
- 안 쓰게 된 export
- 정한 것: `reason` 세 값과 description 상한 500은 문서에 없어 이 brief가 추천으로 정했다. 바꿨다면 이유
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음"
