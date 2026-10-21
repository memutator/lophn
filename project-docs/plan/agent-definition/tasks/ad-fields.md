# ad-fields

agent 정의 기본 schema에서 쓰이지 않는 칸 `safe_tools`와 `permissions`를 지우고 읽는 곳을 함께 지운다. 내장 role 정의(`builtinDefinitionSchema`)와 Operator 정의(`operatorDefinitionSchema`)는 기본 schema에서 `.pick`한 칸만 받아서 두 칸은 어느 정의 file에도 들어가지 못하고, turn 준비는 `safe_tools: []`를 넘기지만 MCP 선택이 읽지 않는다.

- 단위: fields (wave 2)
- 선행: ad-discovery. `prepare.ts`를 나눠 쓴다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/agent-values.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
- 읽을 것:
  - 계획: `project-docs/plan/agent-definition/README.md`의 "정한 것"("지우는 칸과 갈래": 기본 schema의 `safe_tools`와 `permissions`, 읽는 곳을 함께 지운다). roadmap `project-docs/products/roadmap/agent-definition.md`의 "정의 칸"(지금 칸은 그대로 둔다: `name`, `profile`, `model`, `skills`, `domains`, `mcp_off`, `mcp_servers`, 본문. 쓰이지 않는 것만 지운다)과 "하지 않는 것"(정의 칸이나 끄기 층을 줄이지 않는다)
  - architecture: `project-docs/architecture/agent-definition.md` 42줄(MCP server는 설정한 층이 곧 할당이고 끄기는 `mcp_off`다), `project-docs/architecture/approval.md` 26줄(같은 규칙. 그래서 정의에 MCP tool을 고르거나 safe로 표시하는 칸이 없다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `lophn-agent`·`agents`·`run-loop`; `project-docs/module-catalog.yaml`의 `packages/protocol`(구현을 두지 않는다), `packages/core/lophn-agent`
  - 코드(줄은 main `15f282fcd`. ae-builds는 아래 file을 고치지 않았다. `prepare.ts`는 ad-discovery가 먼저 고친다)
    - `packages/protocol/lophn-agent/agent-values.ts`: MCP tool 한 쌍 104-111(104줄 주석 "안전 표시와"), 권한 113-122, 정의 칸 list schema 134-156, `frontmatterFields`·`frontmatterOutputFields` 158-179, `agentDefinitionSchema`·`agentDefinitionOutputSchema` 181-189
    - `packages/protocol/lophn-agent/operators.ts` 16-60: Operator 정의는 `definitionKeys`(21-28), 내장 정의는 `builtinKeys`(48-53)만 `.pick`한다. 두 칸이 어디에도 없다.
    - `packages/core/agent-roles/tools/operator.ts` 25-36(`operator.create`·`operator.update` 입력이 `operatorDefinitionSchema`에서 온다)
    - `packages/core/lophn-agent/run-loop/prepare.ts`: `McpToolkit` 99-108(105줄 주석 "safe 표시"), `material`의 MCP 선택 345-362(355줄 `safe_tools: []`)
    - `packages/core/lophn-agent/extensions/mcp-toolkit.ts` 309-325(`selection`은 `mcp`만 읽는다), `extensions/mcp-tools.ts` 61-65(`McpSelection`)
    - 그대로 통과해야 하는 test: `packages/core/lophn-agent/agents/resolve_test.ts` 31-42(`permissions:`를 적은 정의 file은 거절된다), `packages/core/agent-roles/tools/operator_test.ts` 5-19(README의 위험 test 둘째)
    - test: `.claude/skills/write-test/SKILL.md`("쓰지 않는 test"의 schema(zod)가 이미 보장하는 것)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `agentDefinitionSchema`·`agentDefinitionOutputSchema`의 칸은 `name`, `profile`, `model`, `skills`, `domains`, `mcp_off`, `body`다. `McpToolkit.selection`에 넘기는 값에 `safe_tools`가 없다. `McpTool` type(resolved agent의 `mcp`)은 그대로다.

## 할 일

줄 번호는 main `15f282fcd` 기준이다. `prepare.ts`는 ad-discovery가 먼저 고치므로(168-169, 531, 670) 줄을 다시 본다. 다른 계획 `reactor-remove`의 rr-program-from도 `prepare.ts`(`noticeText` 근처)를 고치므로 그 task가 먼저 main에 land했으면 줄이 더 밀린다. 줄 대신 아래 이름으로 찾는다.

근거는 README "지우는 칸과 갈래"와 roadmap "정의 칸"이다. 두 칸은 `operators.ts`의 `definitionKeys`·`builtinKeys`가 뽑지 않아 어느 정의 file에도 들어가지 못하고, `selection`(`mcp-toolkit.ts` 311-325)은 `mcp`만 읽는다. 작업 중에는 `deno test --no-check packages/core/lophn-agent/agents packages/core/agent-roles/tools/operator_test.ts packages/core/lophn-agent/run-loop`만 돌린다.

1. `agent-values.ts`의 `frontmatterFields`(160-169)에서 `safe_tools`(167)와 `permissions`(168)를, `frontmatterOutputFields`(170-179)에서 `safe_tools`(177)와 `permissions`(178)를 지운다.
2. 그 둘만 쓰던 schema와 주석을 지운다.
   - `mcpToolOutputSchema`(110)
   - 권한 주석과 `agentToolNameSchema`(113-116), `toolListSchema`(118-120), `agentPermissionsSchema`(121), `agentPermissionsOutputSchema`(122)
   - `mcpToolListSchema`(149-152), `mcpToolListOutputSchema`(153-156)
   - 남기는 것: `mcpToolFields`(105-108), `mcpToolSchema`(109), `McpTool`(111. resolved agent의 `mcp`와 `AgentLookups.mcp`가 쓴다), `mcpKey`(`mcp_off` 목록이 쓴다), `unique`
   - 104줄 주석에서 "안전 표시와"를 지운다. 예: "외부 MCP tool 하나다. resolved agent의 켜진 MCP가 이 모양을 쓴다."
3. `prepare.ts`
   - `material`의 `mcpKit.selection({ … })`(349-356)에서 `safe_tools: []`(355)를 지운다. 넘기는 값은 `{ mcp: { servers, tools } }`다.
   - `McpToolkit.selection` 주석(105)에서 "와 safe 표시"를 지운다: "고른 MCP(서버+현재 tool 정확한 쌍)를 골라낸다."
4. 고치지 않는 것
   - `packages/core/lophn-agent/agents/resolve_test.ts` 39줄의 `permissions:` 정의 file은 모르는 칸이라 여전히 거절된다(내장·Operator 정의 schema는 strict한 `.pick`이다). 고치지 않는다.
   - `operators.ts`, `mcp-toolkit.ts`는 두 칸을 부르지 않는다. 고칠 것이 없다(소유도 아니다).
5. 남은 이름을 grep하고(아래 "끝남") `deno task check`를 돌린다. protocol을 고쳤으므로 check가 그것을 쓰는 package의 test를 모두 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 쓰이지 않는 칸을 지우는 일이고 칸의 모양은 zod가 본다(`write-test` "쓰지 않는 test"). README의 위험 test 둘째 "Operator 정의의 skip 기본값 칸은 PM과 App Engineer의 tool로 쓸 수 없다"는 `packages/core/agent-roles/tools/operator_test.ts`에 이미 있고(`approval-simplify`가 만들었다) 이 task가 바꾸는 기본 schema에서 나온 tool 입력을 보므로 그대로 통과해야 한다. `packages/core/lophn-agent/agents/resolve_test.ts`의 "정의 파일에 tool을 적어도 role이 고정한 tool 목록은 바뀌지 않는다"도 그대로 통과한다.
- 남지 않음: `git grep -nwE "safe_tools|agentPermissionsSchema|agentPermissionsOutputSchema|agentToolNameSchema|toolListSchema|mcpToolListSchema|mcpToolListOutputSchema|mcpToolOutputSchema" -- packages tools`가 0줄이다.
- 남지 않음: `git grep -nE "safe 표시|안전 표시" -- packages`가 0줄이다.
- 남는 칸: `agent-values.ts`의 `frontmatterFields`와 `frontmatterOutputFields`가 `name`, `profile`, `model`, `skills`, `domains`, `mcp_off` 여섯 칸이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음이면 "없음"(지운 이름은 `protocol/lophn-agent/mod.ts`가 `export *`로 내보내던 것이 아니다. 모두 file 안 const다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
