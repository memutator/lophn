# deferred-tools: tool 정의를 늦게 싣는다

- **목표:** tool 정의를 처음 요청에 다 싣지 않고 이름만 알린다. model이 `tool.load`로 부르면 그 정의를 그 자리에서 펼친다. Claude Code의 ToolSearch와 같은 꼴이고, Anthropic API의 `defer_loading`과 `tool_reference`를 쓰므로 prompt cache를 깨지 않는다(사람, 2026-10-23: "tool이 너무 많고 평소에는 안 쓰일 툴들도 있다").
  - 숨김은 tool 정의를 늦게 싣는 장치다. role마다 tool을 가르는 일이 아니다. role 구분은 원래 있던 권한 목록(`builtinToolNames`)이 한다(사람, 2026-10-23).
- **재료:**
  - architecture `agent-definition.md`: 44줄 "tool 목록은 session을 시작할 때 고정한다", 99줄 "deferred tool은 두지 않는다. 막히면 그때 만든다"
  - architecture `app-call.md` 118줄(앱 tool 이름), `domain.md` 42·56줄
  - 옛 설계와 지운 이유: archived 이슈 `project-docs/issues/archived/agent-definition.md`의 "deferred tool을 아무 tool에도 켜지 않는다", commit `3777a51b6`
  - Anthropic 문서 [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)의 "Custom tool search implementation", "Deferred tool loading", "Continuing the conversation" 절
  - Claude Code 2.1.309 조사: `/home/pyosechang/projects/rea/project/claude-code/search-tool/README.md`(원시 요청 `evidence/wire.jsonl`, 숨김 판단 `source/deferral-policy.js`)
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - OpenAI responses의 `tool_search`(`execution: "client"`)와 chat-completions 계열 provider. built-in `anthropic`만 켠다. OpenAI는 `tool_search_call`/`tool_search_output`이라는 다른 wire 모양이라 adapter를 따로 짜야 한다. 다른 provider는 지금처럼 모든 정의를 싣는다(agent).
  - session 도중 생긴 tool(activation, 할당)을 deferred로 바로 쓰게 하는 것. "tool 목록은 session 시작 때 고정하고 notice로 알린다"는 그대로 둔다(agent).
  - keyword 검색. 묶음 이름으로 불러오기가 대신한다(agent).
  - MCP tool 이름(`mcp__<server>__<tool>`). Claude Code와 같은 꼴이라 그대로 둔다(agent).
  - `kind.list` 입력 schema 줄이기(7,926 chars). `$defs`/`$ref`를 chat-completions 계열이 받는지 확인되지 않았다(agent).
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다.

## 지금

wave 1(`deferred-tools`, plan branch `137e011a1`)이 들어왔다.

- 숨김은 role마다 손으로 적은 이름 배열 넷(`agent-roles/tool-lists.ts`의 `DEFERRED_TOOLS`, `deferredToolNames`)이 정한다. role prompt에 이름이 나오는지로 planner가 골랐다. 사람이 이 방향을 버렸다(아래 정한 것 1).
- `tool.load`는 wire 이름만 받는다. 불러온 tool은 그 turn 안에서만 남는다. turn을 넘는 이력(`run-loop/turn.ts`의 `historyOf`가 읽는 `sessionMaterial(...).history`)에는 글만 실려 앞 turn의 `tool_reference`가 빠진다.
- 앱 tool은 숨기지 않는다. 이름은 `domain__<domain>__<tool>`이고, `.`이 있으면(관례상 늘 있다) 뒤에 hash 8자가 붙는다(`tools/app-tool/name.ts`의 `appToolName`). 예: `domain__calendar__event_list_68ef9d50`.
- 실제 API 확인(eval 3개, `208fe9ec1`): `defer_loading`이 실린 요청은 모두 받았다. 어느 run도 `tool.load`를 부르지 않아 `tool_reference`는 실제 API에서 아직 오가지 않았다.

## 정한 것

사람(2026-10-23, lead session)
1. **숨김은 tool의 성질이다.** Claude Code의 `shouldDefer`처럼 tool 정의에 한 번 적고 모든 role에 같다. role별 숨김 목록은 지운다.
2. **앱 tool도 숨긴다.** MCP tool처럼 모두 숨기고 domain 단위로 불러온다.
3. **묶음으로 불러온다.** `tool.load`가 묶음 이름(내장 자원 `job`, 앱 domain `calendar`)을 받으면 그 묶음의 숨긴 tool을 한 번에 펼친다.
4. **앱 tool 이름은 `<domain>_<tool>`이다.** tool 이름의 `.`은 `_`로 바꾼다. `domain__` 접두사와 hash를 뺀다. 예: `calendar_event_list`.
5. **불러온 tool은 session 동안 남는다.** Claude Code처럼 다음 turn에도 다시 부르지 않는다.
6. 쓰레기 코드가 남지 않게 청소한다.

agent(lead)
- **숨기는 내장 tool은 15개다:** `pdf.read`, `session.list`, `workflow.list`, `release.list`, `release.get`, `domain.list`, `domain.get`, `visual.show`, `job.create`, `job.update`, `job.delete`, `job.list`, `operator.update`, `workflow.check`, `package.publish`. wave 1의 role 목록 넷이 모두 숨기던 것이다. 어느 role prompt가 기대던 9개(`image.read`, `app.list`, `app.get`, `package.list`, `package.get`, `declaration.check`, `kind.list`, `kind.check`, `settings.get`)는 싣는다. session마다 숨는 수는 lophn 12, PM 14, App Engineer 14, Operator 8개다.
- **한 session에서 숨는 것** = 그 session 고정 목록 가운데 `defer: true`인 내장 tool + 앱 tool 전부 + 외부 MCP tool 전부.
- **묶음 규칙은 wire 이름의 앞부분 하나다.** `tool.load`의 항목 `g`는 wire 이름이 `g`와 같거나 `g_`로 시작하는 숨긴 tool에 맞는다. 내장은 `job`, 앱은 `calendar`, MCP는 `mcp__github`(그 server 전부)나 `mcp`(MCP 전부)다. 이름을 따로 parse하지 않는다.
  - 이 규칙이 겹치지 않도록 domain 이름으로 내장 자원 이름(`file`, `app`, `release`, `job` … wire 이름 첫 `_` 앞의 것)과 `mcp`를 쓰지 못하게 한다. domain 이름 규칙(`[a-z][a-z0-9]*(-[a-z0-9]+)*`)에 `_`가 없어 첫 `_` 앞이 늘 domain이다.
  - 한 앱이 wire 이름이 같아지는 두 tool(`event.list`와 `event_list`)을 선언하면 선언 검사가 거절한다. hash는 64자를 넘을 때만 붙인다.
- **`tool.load`의 받기 규칙:** 항목마다 그 session의 숨긴 tool에 하나 이상 맞아야 한다. 숨기지 않은 tool의 wire 이름이면 `invalid_input`, 아무것에도 안 맞으면 `not_found`다. 하나라도 틀리면 전체가 실패한다. 이미 불러온 것을 다시 불러오는 것은 성공이다. 항목은 1~20개다.
- **남기는 방법:** 앞 turn의 `tool.load` 호출과 결과(`tool_reference`)를 다음 turn 이력에서 그 자리(그 turn의 사람 요청 뒤, 마지막 답 앞)에 그대로 싣는다. 이미 저장한 기록으로 되면 새 표를 만들지 않는다. compaction 뒤에는 남기지 않는다(다시 불러온다).
- **`tool.load` description:** 고정 문장, 묶음 규칙 한 줄, 그 session의 숨긴 wire 이름 정렬 목록. 앱이 쓴 설명은 넣지 않는다(이름만).

wave 1에서 그대로 두는 것(agent, planner)
- 켜는 조건: built-in `anthropic` 정의(key `anthropic`)의 Claude 4.5 이상·5 세대·Fable·Mythos(`providers/definitions.ts`의 `supportsDeferredTools`). 켤지는 session 첫 turn에 정하고 바꾸지 않는다. 켜진 session의 뒤 turn이 못 받는 provider·model로 가면 모든 정의를 보통으로 싣고 `tool.load` 결과를 `Loaded: a, b` 글로 그린다. 꺼진 session에는 `tool.load`가 없다.
- 숨긴 정의도 매 요청 `tools[]`에 `defer_loading: true`로 모두 싣는다. `tools[]`에 cache 표시를 달지 않는다. beta header `advanced-tool-use-2025-11-20`는 받는 model의 요청에 늘 붙인다.
- 실행 쪽(`tools/work.ts`의 `executeToolCall`, Gate)은 바꾸지 않는다. dispatch는 이번 요청의 `tools[]`가 아니라 session 고정 목록(`ctx.listed`)을 본다.
- input budget은 모든 정의를 센다.

## 순서

- wave 1: `deferred-tools`(merged).
- wave 2(같이 돈다):
  - `defer-by-tool`(`tasks/defer-by-tool.md`): 정한 것 1, 2, 3, 5와 wave 1 청소.
  - `app-tool-names`(`tasks/app-tool-names.md`): 정한 것 4와 domain 이름·선언 검사.
- merge 뒤 lead가 wire를 보고, 사람에게 물어 eval을 다시 돌린다. 앱 tool이 숨으므로 O4의 Operator가 `tool.load`를 불러야 해서 실제 API의 `tool_reference`가 처음으로 오간다.

## 위험 test

- "`tool.load`는 그 session의 숨긴 tool만 펼친다." 이름이든 묶음이든 session 목록 밖 tool을 펼치면 role 목록과 할당이라는 권한 경계를 넘는다.
- 내장 tool의 `defer: true`는 그 tool이 실제로 있는 role 목록과 상관없이 하나다. role별 목록 test는 지운다.

## lead가 할 일

- merge 뒤 fake server probe(`.dev-data/lead/wire-probe.ts`)를 고쳐 본다.
  - 첫 요청: 숨긴 15개 중 그 role 목록에 든 것, 앱 tool, MCP tool에 `defer_loading: true`. `tool.load` description에 이름 목록.
  - `tool.load`에 묶음 이름(`session`, 앱 domain)을 준 뒤: `tool_reference`가 그 묶음의 이름을 모두 싣는다.
  - 다음 turn: 앞 turn의 `tool.load` 호출과 결과가 이력에 그대로 있다.
  - 앱 tool 이름이 `<domain>_<tool>`이다.
- 사람에게 물어 eval을 돌린다(`calendar-dev`, `calendar-maintain`, `O4`, 1 trial). `tool.load`가 불리고 실제 API가 받는지, 지난 run(`208fe9ec1`)과 tool 호출 수, 입력 token을 본다.
- 다 끝나면:
  - architecture: `agent-definition.md`(99줄과 흐름 그림의 `tools[]` 줄, 숨김 규칙), `app-call.md` 118줄, `domain.md` 42·56줄(앱 tool 이름, 예약 domain 이름).
  - changelog 열린 판 `0.8.0`에 항목 하나.
  - 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부(eval은 실제 provider 호출이다), subprocess·Worker·서버·브라우저를 띄우는 새 test. 그 밖은 lead가 정하고 기록한다.
