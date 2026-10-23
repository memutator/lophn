# deferred-tools

role의 드물게 쓰는 내장 tool과 외부 MCP tool을 Anthropic 요청에 `defer_loading: true`로 숨기고, `tool.load`가 `tool_reference`로 불러오게 한다.

- 단위: deferred-tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/lophn-agent/tools/bundles/` (새 file `tool.ts`)
  - `packages/core/lophn-agent/tools/{registry.ts,work.ts,tool-context.ts,spi.ts,wire.ts}`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,prepare_test.ts,history.ts,turn.ts}`
  - `packages/core/lophn-agent/prompt-assembly/{turn-prompt.ts,model.ts,budget.ts}`
  - `packages/core/lophn-agent/models/binding.ts`
  - `packages/core/lophn-agent/providers/adapters/{messages.ts,responses.ts,chat-completions.ts}`
  - `packages/core/lophn-agent/providers/{definitions.json,definitions.ts}`
- 읽을 것:
  - 계획: `project-docs/plan/deferred-tools/README.md`의 "정한 것" 전부. 이 brief보다 앞선다.
  - architecture: `project-docs/architecture/agent-definition.md`(흐름, cache 표시, 44·45·51·99줄)
  - 외부: Anthropic [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)의 "Deferred tool loading", "Custom tool search implementation", "Model compatibility"
  - 본보기: Claude Code가 실제로 보낸 요청 `../rea/project/claude-code/search-tool/evidence/wire.jsonl`(case `enabled`의 turn 1과 2. 처음엔 이름만 있고, `tool_reference` 뒤에는 정의가 `defer_loading: true`로 붙는다)
  - 옛 설계: `git show 3777a51b6`(지운 `tool.search`, `TurnTool.deferred`, `deferredBlock`). 그대로 되살리지 않는다. 옛것은 정의를 tool 결과 글로 돌려줘서 provider가 선언되지 않은 tool 호출을 받는지 보장이 없었다.
- 계약:
  - 쓰는 것: `ToolDefinition`과 `defineTool`(`tools/spi.ts`), dispatch `executeToolCall`(`tools/work.ts`), 결과 조각 `tool_result_image`(`prompt-assembly/model.ts`)
  - 내놓는 것: tool `tool.load`(입력 `{names: string[1..20]}`), role별 숨긴 목록(`tool-lists.ts`), 새 결과 조각(tool reference, 이름 목록), session 고정 목록의 "켜짐"과 숨긴 이름 집합

## 할 일

1. **`tool-lists.ts`:**
   - role별 숨긴 이름 목록을 README "정한 것"의 목록 그대로 둔다. 원칙은 주석으로 한 줄 적는다.
   - `tool.load`를 `COMMON_TOOLS`와 `TOOL_ORDER`에 넣는다.
2. **`tools/bundles/tool.ts`에 `tool.load`를 만든다.**
   - `effect: "read"`, `routes: []`.
   - 받는 이름은 이번 session의 숨긴 이름 집합에 있는 것뿐이다. 이미 실린 이름은 `invalid_input`, session 목록 밖 이름은 `not_found`이고, 하나라도 틀리면 전체가 실패한다.
   - 성공하면 tool reference 결과 조각에 이름만 싣는다.
   - description은 고정 문장 뒤에 그 session의 숨긴 wire 이름을 정렬해 붙인다. 이름 집합은 tool context(`tool-context.ts`) 등 session 고정 목록에서 받는다.
   - `main/agent-tools.ts`에 등록한다.
3. **켜는 조건과 고정(`run-loop/prepare.ts`):**
   - session 목록을 고정할 때(`fixedBySession`) 켤지를 같이 정해 저장한다. 조건은 built-in `anthropic` provider 정의이고, model이 문서 표에 있는 것이다. provider 정의에 칸 하나를 더하는 식으로 둔다.
   - 켜졌으면 숨긴 이름 = role 숨긴 목록 ∩ 이번 목록, 그리고 외부 MCP tool 전부다. 앱 tool은 숨기지 않는다.
   - 꺼졌으면 `selectTools`(`tools/registry.ts`)가 `tool.load`를 뺀다.
   - `keyOf`와 notice는 지금처럼 정의만 본다.
4. **prompt 조립(`prompt-assembly/turn-prompt.ts`, `model.ts`):**
   - `PromptTool`에 숨김 표시를 싣는다. 정렬과 hash는 지금 그대로다.
   - 요청이 켜진 session이고 이번 provider·model이 받을 수 있을 때만 숨김 표시를 wire로 넘긴다. 아니면 보통 정의로 싣는다.
5. **adapter(`models/binding.ts`, `providers/adapters/*.ts`):**
   - messages: 숨긴 정의에 `defer_loading: true`를 붙인다. tool reference 조각은 `tool_result` content의 `{type: "tool_reference", tool_name: <wire 이름>}`로 그린다. 켜진 요청에는 beta `advanced-tool-use-2025-11-20`를 붙인다.
   - responses, chat-completions: tool reference 조각을 `Loaded: a, b` 글로 그린다.
   - 이력 변환(`run-loop/history.ts`)이 결과를 조각으로 나누는 곳도 `tool_result_image`처럼 고친다.
6. **test:**
   - 위험 test 하나: "`tool.load`는 그 session의 숨긴 목록 밖 이름을 불러오지 못한다."
   - `agent-tools_test.ts`에 "숨긴 목록의 이름마다 그 role 목록에 든다"를 더한다.
   - adapter 모양 test는 새로 쓰지 않는다(화면·내부 구현 test 금지). wire는 lead가 fake server로 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`tool.load`는 그 session의 숨긴 목록 밖 이름(session 목록에 없는 tool, 이미 실린 tool)을 불러오지 못한다."
- 남지 않음: `git grep -n "tool\.search\|deferredBlock" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것. 특히 provider 정의에 더한 칸의 이름, 문서 표를 model 이름 규칙으로 옮긴 방식
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
