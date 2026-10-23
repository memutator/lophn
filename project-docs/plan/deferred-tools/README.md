# deferred-tools: 드물게 쓰는 tool은 이름만 싣고 `tool.load`로 불러온다

- **목표:** role의 내장 tool 가운데 드물게 쓰는 것과 외부 MCP tool은 처음 요청에 이름만 알린다. model이 `tool.load`로 부르면 그 정의를 그 자리에서 펼친다. Claude Code의 ToolSearch와 같은 꼴이고, Anthropic API의 `defer_loading`과 `tool_reference`를 쓰므로 prompt cache를 깨지 않는다(사람, 2026-10-23: "tool이 너무 많고 평소에는 안 쓰일 툴들도 있다". 숨길 것은 planner가 골랐다).
- **재료:**
  - architecture `agent-definition.md`: 44줄 "tool 목록은 session을 시작할 때 고정한다", 99줄 "deferred tool은 두지 않는다. 막히면 그때 만든다"
  - 옛 설계와 지운 이유: archived 이슈 `project-docs/issues/archived/agent-definition.md`의 "deferred tool을 아무 tool에도 켜지 않는다", commit `3777a51b6`
  - Anthropic 문서 [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)의 "Custom tool search implementation"과 "Deferred tool loading" 절
  - Claude Code 2.1.309의 wire 조사: `../rea/project/claude-code/search-tool/README.md`(원시 요청 `evidence/wire.jsonl`)
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - OpenAI responses의 `tool_search`(`execution: "client"`)와 chat-completions 계열 provider. 이번에는 built-in `anthropic`만 켠다. eval trial 115개 가운데 113개가 Claude였고, OpenAI는 `tool_search_call`/`tool_search_output`이라는 다른 wire 모양이라 adapter를 따로 짜야 한다. 다른 provider는 지금처럼 모든 정의를 싣는다(agent).
  - session 도중 생긴 tool(activation, 할당)을 deferred로 바로 쓰게 하는 것. "tool 목록은 session 시작 때 고정하고 notice로 알린다"는 그대로 둔다(agent. 사람이 따로 정하지 않았다).
  - 앱 tool 숨기기와 keyword 검색. 앱 tool은 Operator 일의 본체이고 할당이 곧 고르기다. 검색은 이름 목록으로 대신한다.
  - `kind.list` 입력 schema 줄이기(7,926 chars, 내장 tool 전체의 16%). `conditionSchema`(`packages/protocol/projects/kinds-api.ts`)의 leaf가 JSON schema에서 층마다 다시 펼쳐져 커진다. `$defs`/`$ref`로 묶으면 줄지만 chat-completions 계열(gemini 등)이 `$ref`를 받는지 확인되지 않았다. 이 계획 뒤 그것을 싣는 role은 Operator 하나이고 cache로 읽히므로 하지 않는다(agent).
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task는 `deferred-tools` 하나다.

## 지금

2026-10-23 main `51ae1183a`에서 실제 정의를 import해 쟀다. 크기는 `JSON.stringify({name, description, input_schema})`의 길이다.

| role | 내장 tool | chars | 숨길 tool | 숨길 chars |
|---|---|---|---|---|
| lophn | 41 | 38,658 | 17 | 20,567 (53%) |
| project_manager | 42 | 40,268 | 23 | 23,545 (58%) |
| app_engineer | 52 | 47,069 | 19 | 22,608 (48%) |
| operator | 34 | 28,064 | 15 | 5,100 (18%) |

- tool 정의는 role prompt, skill 목록, tool을 합친 고정 부분의 약 80%다.
- 외부 MCP tool은 server마다 2048개까지 받고(`extensions/mcp-connections.ts`의 `LIST_TOOLS_MAX`) session 전체의 상한은 없다.
- `tools[]`는 이미 cache되므로 돈은 크게 줄지 않는다. 얻는 것은 model이 보는 tool 수(Anthropic 문서는 30~50개를 넘으면 고르는 정확도가 떨어진다고 한다), context 자리, MCP가 늘어날 때의 상한이다.

## 정한 것

agent(planner)가 정했다.

켜는 조건
- **built-in `anthropic` provider 정의에서만 켠다.** model은 Anthropic 문서 "Model compatibility" 표에 있는 것(Haiku·Sonnet·Opus 4.5 이상, 5 세대, Fable, Mythos)이다. custom provider는 `anthropic-messages` protocol이어도 끈다. proxy나 호환 API는 `defer_loading`과 `tool_reference`를 모를 수 있다.
- **켤지는 session의 tool 목록을 고정할 때(`run-loop/prepare.ts`의 `fixedBySession`) 같이 정하고, 그 session 동안 바꾸지 않는다.**
  - 켜진 session의 뒤 turn이 끄는 provider·model로 가면 모든 정의를 보통으로 싣고, 이력의 `tool.load` 결과는 글로 그린다.
  - 꺼진 채 시작한 session은 끝까지 끈다. 숨겨 둔 적 없는 tool을 이력이 이미 불렀을 수 있기 때문이다.
- 켤 때는 Claude Code와 같은 beta header `advanced-tool-use-2025-11-20`를 붙인다. 2.1.309가 이 header로 실제 API를 부른다(`evidence/wire.jsonl`).

숨기는 것
- **원칙: 아래 둘은 싣고, 나머지 내장 tool은 숨긴다.**
  - role prompt(제품 고정 규칙 `PRODUCT_INSTRUCTIONS`와 role의 `prompt.md`)에 이름이 나오는 tool
  - 기본 작업 tool: `file.*`, `shell.run`, `web.*`, `call`, `reply`, `cancel`, `ask`, `skill.read`
- skill에만 이름이 나오는 tool은 그 skill을 읽은 뒤 불러온다. skill 읽기가 이미 round trip 한 번이라, load 한 번이 더해져도 늘 도는 길에 비용이 붙지 않는다.
- 이 원칙으로 2026-10-23에 고른 목록:
  - **lophn(17):** `pdf.read image.read session.list workflow.list declaration.check package.get release.list release.get kind.list kind.check domain.list domain.get visual.show job.create job.update job.delete job.list`
  - **project_manager(23):** `pdf.read image.read session.list workflow.list app.list app.get declaration.check package.list package.get release.list release.get kind.list kind.check domain.list domain.get settings.get visual.show job.create job.update job.delete job.list operator.update workflow.check`
  - **app_engineer(19):** `pdf.read session.list workflow.list app.list app.get release.list release.get kind.list kind.check domain.list domain.get settings.get visual.show job.create job.update job.delete job.list package.publish operator.update`
  - **operator(15):** `pdf.read image.read session.list workflow.list app.list app.get declaration.check package.list package.get release.list release.get domain.list domain.get settings.get visual.show`
- **외부 MCP tool은 모두 숨긴다. 앱 tool은 싣는다.**
- 목록은 `agent-roles/tool-lists.ts`에 role마다 코드로 고정한다. role prompt에 tool 이름을 더하거나 빼면 그 목록도 같은 변경에서 고친다.

`tool.load`
- **입력은 `{names: string[]}`(wire 이름, 1~20개)다.** 이름은 `<자원>.<동사>` 규칙을 따른다. 옛 `tool.search`는 이름을 받으면서 search라 불러 헷갈렸다.
- **description 끝에 그 session의 숨긴 tool wire 이름을 정렬해 싣는다.** system에 새 층을 두지 않는다. `tools[]`는 session 동안 고정이라 같은 bytes가 유지된다.
  - 안내는 고정 문장이다: 이 tool들은 이름만 알려져 있으니 부르기 전에 `tool.load`로 불러오고, 지침이나 skill이 이 목록의 tool을 말하면 먼저 불러온다.
  - 앱이 쓴 글은 넣지 않는다.
- **받는 이름은 그 session의 숨긴 목록에 있는 것뿐이다.**
  - 이미 실린 이름은 `invalid_input`("already loaded; call it directly")이다.
  - session 목록 밖 이름은 `not_found`다.
  - 하나라도 틀리면 전체가 실패한다. 부분 성공 길을 두지 않는다.
  - 같은 이름을 다시 불러오는 것은 성공이다.
- **결과는 새 결과 조각에 이름만 싣는다.** 본보기는 `tool_result_image`다(`prompt-assembly/model.ts`, `models/binding.ts`의 protocol 셋).
  - messages adapter는 `{type: "tool_reference", tool_name}`으로 그린다.
  - 다른 adapter는 `Loaded: a, b` 글로 그린다.
- **`tool.load`는 모든 role의 목록(`COMMON_TOOLS`)에 넣는다.** 꺼진 session에서는 `selectTools`(`tools/registry.ts`)가 vision 없는 model의 `image.read`처럼 뺀다.

wire와 실행
- **숨긴 정의도 매 요청 `tools[]`에 `defer_loading: true`로 모두 싣는다.** Anthropic 문서가 정한 꼴이다. Claude Code는 불러온 것만 싣지만, 그러려면 불러온 이름을 따로 추적해야 한다.
- **`tools[]`에는 지금처럼 cache 표시를 달지 않는다.** API는 `defer_loading`과 `cache_control`을 한 정의에 같이 받지 않는다. role 층 표시가 `tools`를 덮는 지금 꼴은 그대로다.
- **불러온 tool의 호출은 지금 dispatch를 그대로 지난다.** dispatch(`tools/work.ts`의 `executeToolCall`)는 이번 요청의 `tools[]`가 아니라 session 고정 목록(`ctx.listed`)을 본다. 입력 검사와 Gate도 같다. 실행 쪽 권한 판단을 바꾸지 않는다.
- **input budget은 지금처럼 모든 정의를 센다.** 넉넉하게 세는 쪽이고 지금보다 나빠지지 않는다.

## 순서

- wave 1: `deferred-tools` 하나(`tasks/deferred-tools.md`).
- merge 뒤 lead가 wire를 보고, 사람에게 물어 eval을 돌린다(아래).

## 위험 test

- "`tool.load`는 그 session의 숨긴 목록 밖 이름(session 목록에 없는 tool, 이미 실린 tool)을 불러오지 못한다." session 목록 밖 tool을 펼치게 되면 role 목록과 할당이라는 권한 경계를 넘는다.
- 있는 `main/agent-tools_test.ts`가 role 목록과 정의가 맞는지 보듯, 숨긴 목록의 이름마다 그 role 목록에 들었는지도 본다.

## lead가 할 일

- merge 뒤 fake server(`deno task dev`)에서 Anthropic session 하나의 요청 body를 떠서 본다.
  - 첫 요청: 숨긴 정의에 `defer_loading: true`가 있고, `tool.load` description에 이름 목록이 있다.
  - `tool.load` 뒤 요청: 결과에 `tool_reference`가 있다.
  - 끄는 provider로 바꾼 뒤: 모든 정의가 보통으로 실린다.
- 실제 API가 받는지는 eval로만 볼 수 있다. 사람에게 묻고 Claude 시나리오 몇 개(예: `calendar-dev`, `calendar-maintain`, `O4`)를 돌린다. 지난 run과 성공, tool 호출 수, 입력 token을 비교한다. 숨긴 tool을 불러오지 못해 떨어진 run이 있으면 그 tool을 싣는 쪽으로 목록을 고친다.
- 다 끝나면:
  - `architecture/agent-definition.md`를 고친다. 99줄을 새 규칙(켜는 조건, 숨기는 원칙, `tool.load`)으로 바꾸고, 흐름 그림의 `tools[]` 줄에 deferred를 적는다.
  - changelog 열린 판(`0.8.0`)에 항목을 쓴다.
  - 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부(eval은 실제 provider 호출이다), subprocess·Worker·서버·브라우저를 띄우는 새 test. 그 밖은 planner에게 묻는다.
