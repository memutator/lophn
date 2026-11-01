# defer-remove

tool 정의를 늦게 싣는 장치를 지운다. 내장 tool은 place 종류마다 고정된 작은 집합이고, 외부 MCP tool은 처음부터 `tools[]`에 싣는다.

- 단위: cli (wave 1)
- 선행: cs-foundation. 명령 표와 `lophn` tool이 있어야 한다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/prompt-assembly/**`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,prepare_test.ts,history.ts,history_test.ts}`
  - `packages/core/lophn-agent/models/**`
  - `packages/core/lophn-agent/providers/**`
  - `packages/core/lophn-agent/session/history.ts`
  - `packages/core/lophn-agent/tools/{dispatch.ts,tool-context.ts}`
  - `packages/core/lophn-agent/tools/bundles/{tool.ts,tool_test.ts}`
  - `packages/core/agent-places/{tool-lists.ts,tool-lists_test.ts}`
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 4, 14와 "지금 코드 › lophn agent는 내장 tool 53개를"
  - architecture: `project-docs/architecture/agent-definition.md`(tool 정의는 늦게 싣는다, tool 목록은 session을 시작할 때 고정한다)
- 계약:
  - 쓰는 것: cs-foundation의 `lophn` tool과 dispatch

## 할 일

1. 지운다: `tool.load`·`tool.call`(`tools/bundles/tool.ts`와 test), `dispatchTarget`의 `tool_call` 풀기(`lophn` 풀기는 남긴다), `prompt-assembly/loading.ts`, `exposedToolNames`·`EXPOSED*`, `prepare.ts`의 `deferred`·`describeToolLoad`, `ToolContext.deferred`, 이력의 `tool_reference`·`tool_result_reference`와 turn 사이 `tool.load` 재생, Anthropic packer의 `defer_loading`·beta header `advanced-tool-use-2025-11-20`·`ModelBinding.deferrable`, `supportsDeferredTools`, Claude 구독 profile의 `tool_reference` 이름 바꾸기.
2. 외부 MCP tool은 처음부터 `tools[]`에 싣는다. session 시작 때 목록을 고정하고 바뀌면 `tools_changed` notice로 알리는 규칙은 MCP 때문에 남긴다.
3. `TOOL_ORDER`와 place 목록에서 `tool.load`, `tool.call`을 뺀다. 이 file은 wave 2 동안 lead도 고친다(다른 task가 명령으로 옮긴 tool을 뺀다). 충돌은 lead가 푼다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: 없음(장치를 지우는 일이다. 남는 MCP 판정 test는 그대로 통과한다)
- 남지 않음: `grep -rn "defer_loading\|tool_reference\|supportsDeferredTools\|exposedToolNames\|TOOL_LOAD_DESCRIPTION\|tool_call\b" packages`에 늦게 싣기의 것이 0줄이다(`tool_call` id 같은 다른 뜻은 남는다).

## 보고

- 바꾼 file, 통과한 check
- 등록할 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (cs-foundation merge 뒤)

- `lophn` tool: `packages/core/lophn-agent/tools/lophn/{tool,resolve,command-tool}.ts`. `dispatchTarget`(`packages/core/lophn-agent/tools/dispatch.ts`)이 `lophn {args}`를 명령의 wire 이름과 입력으로 푼다. `prepare.ts`가 `commandTools(kind)`를 `listed`에 더하고 `describeLophn`으로 설명에 명령 목록을 붙인다.
- 명령 표: `packages/cli/commands/mod.ts`의 `COMMANDS`, `commandsForPlace(kind)`. parser는 `packages/cli/parser.ts`의 `parseCommandLine`.
- core가 import할 수 있는 cli 쪽은 `packages/cli/{commands/,parser.ts,help.ts}`뿐이다(`tools/check-deps.ts`의 `cli-surface`).
