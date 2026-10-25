# tool-title-core

tool call이 무엇을 했는지 core가 `{category, title}`로 만든다: tool 정의마다 `display(input)`을 두고(roadmap 7의 표), shell 명령은 read/list/search/command로 가르며, `shell.run`에 선택 칸 `description`(Claude Code 문구)을 더해 tool 줄 제목에 쓴다(승인 카드에는 싣지 않는다, `approval.md:51`). `ToolCallStarted`(`chat-protocol`이 둔 `tools/display.ts` 자리)와 `ListToolCalls`(저장된 입력과 지금의 redaction)가 저장하지 않는 제목을 낸다.

- 단위: tool-title (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/`
  - `packages/core/lophn-agent/run-loop/turn-body-reads.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/session/body-read.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/agent-chat.md` 7 "lophn에서"(제목 template 표, 명령 가르기, title은 core가 만든다), `project-docs/plan/agent-chat/README.md` "정한 것"의 tool 제목 줄과 "tool 제목은 한 줄, 120자에서 자른다", "위험 test"
  - 계약 모양: `project-docs/plan/agent-chat/tasks/chat-protocol.md` 할 일 1·2·10·11·12(`toolCallDisplaySchema`, `ListedToolCall`, `tools/display.ts`의 fallback, `core-ports.ts`가 부르는 자리, `tools/reads.ts`의 fallback)
  - architecture:
    - `project-docs/architecture/agent-definition.md` "tool 정의가 바뀌었나는 정의에서 계산한다"(display는 model에 보이지 않으니 `definitionHash`에 넣지 않는다), "tool 정의는 늦게 싣는다"
    - `project-docs/architecture/approval.md` "shell 규칙"(조각은 `&&`·`||`·`;`·`|`·줄바꿈으로 나눈다, 따옴표를 풀지 않는다)과 51줄 "카드 내용은 program이 GateCall에서 만든다. agent가 쓴 설명은 싣지 않는다"(`description`을 gate에 싣지 않는 근거)
    - `project-docs/architecture/app-call.md` 94줄 "줄마다 redaction을 하고 그 뒤에 300자로 자른다. 순서가 바뀌면 자른 줄에 secret 일부가 남는다"(제목도 같은 순서)
    - `project-docs/architecture/layers.md` "바닥은 위층을 import하지 않는다"(lophn-agent가 바닥인 `approvals`를 import하는 것은 된다)
    - `project-docs/architecture/event.md` "agent event와 화면"(agent event는 저장하지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `run-loop`, `approvals`, interface `agent-tool-spi`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/approvals`
  - skill: `.claude/skills/write-test/SKILL.md`
  - 코드:
    - tool 정의: `packages/core/lophn-agent/tools/{registry,define,spi}.ts`, `tools/bundles/{file,shell,web,skill,tool}.ts`, `tools/app-tools.ts`(앱 tool 정의, `defineTool`을 쓰지 않는다), `tools/schema.ts`(입력 검사), `tools/wire.ts`(`inputJsonSchema`가 `z.toJSONSchema`라 `.describe()` 글이 field `description`으로 나간다)
    - 제목 자리: `tools/display.ts`(`chat-protocol`이 만든 fallback), `run-loop/core-ports.ts`의 `attemptTool`(`ToolCallStarted`를 낼 때 `toolCallDisplay`를 부른다. 고치지 않는다), `run-loop/blobs.ts`의 `RedactText`
    - 목록 읽기: `tools/reads.ts`(`createToolReads`의 `list`, 동기 pool read), `tools/model.ts`(`callFromRow`, `callColumns`), `run-loop/turn-body-reads.ts`(`turnBodyViewRead`: 저장된 본문을 읽어 지금의 redaction을 거치는 본보기. `loadStored`의 `blob_refs` 판정, 64 KiB), `session/body-read.ts`(`MessageBodyEnvironment`, `readBodyBytes`), `register.ts`(`createLedgerRegistration`의 `apiReads`, `UNATTACHED_REDACT`, `createLophnAgent`의 `reads`와 `createReaderRegistration`의 `reads`)
    - 지금의 redaction: `packages/core/main/daemon/wiring/lophn-agent-session.ts`(`redactBody` = `createProductRedactor` + 알려진 secret), `packages/base/redaction/product-redactor.ts`와 `product-redactor_test.ts`(test 본보기)
    - shell 조각: `packages/core/approvals/gate/shell-match.ts`의 `shellPieces`, `normalize`
    - `ListToolCalls`를 부르는 곳: `session/history.ts`의 `readLoads`(turn마다 session 전체를 읽는다), `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`의 `readToolCalls`, `tests/e2e/*_test.ts`
- 계약:
  - 쓰는 것: `chat-protocol`의 `ToolCallDisplay`·`TOOL_CALL_CATEGORIES`·`ListedToolCall`, `ListToolCalls` 입력의 `tool` filter, `tools/display.ts`의 `toolCallDisplay(definition, name, input, redact)`(`run-loop/core-ports.ts`가 이미 `deps.redact`로 부른다); 사람 화면 body view의 redaction 규칙(`run-loop/turn-body-reads.ts`의 `turnBodyViewRead`); shell 규칙이 명령을 조각으로 나누는 `shellPieces`(`packages/core/approvals/gate/shell-match.ts`, import만. module 의존 규칙이 막으면 보고한다).
  - 내놓는 것: tool마다 실제 display(read·list·search·web·command·other와 제목), `shell.run` 입력 `{command, timeout_ms?, description?: string}`, `ListToolCalls` item의 display. `tool-title-shell`이 기댄다.

## 할 일

shell 승인은 바꾸지 않는다. `description`은 tool 줄 제목에만 쓰고 gate(`GateCall`)에는 싣지 않는다(README "정한 것", `chat-protocol` 계약 "shell 승인은 바꾸지 않는다", `approval.md` 51줄). 
정한 것(살 단계):
- 제목 글은 roadmap 표의 낱말 그대로이고 값에 따옴표나 backtick을 두르지 않는다: `Read src/app.ts (10-80)`, `Search TODO in src`, `List **/*.md`, `Outline docs/plan.md`, `Search the web for deno lint`, `Fetch https://example.com/a`. 이유: 제목은 한 줄 plain 글이고(`chat-protocol`), Claude Code·Cline도 "Read foo.ts"처럼 값을 그대로 쓴다. roadmap의 backtick은 값 자리 표시다.
- `file.read`의 범위: `offset`이나 `limit`이 있을 때만 ` (시작-끝)`을 붙인다. 시작은 `offset ?? 1`, 끝은 `limit`이 있으면 `시작 + limit − 1`, 없으면 비운다(`(10-)`). `pdf.read`는 ` (pages 1-5)`(입력 `pages` 그대로), `image.read`는 범위가 없다. `file.grep`은 `path`가 있을 때만 ` in <path>`, `file.glob`은 roadmap대로 `List <pattern>`만이다.
- `shell.run`의 제목은 `description`을 trim한 것이 비어 있지 않으면 그것, 아니면 명령의 비어 있지 않은 첫 줄(trim)이다. category는 아래 명령 가르기로 정하고, 제목 규칙은 category와 상관없이 같다(roadmap "나머지는 command, 제목은 description이고 없으면 명령이다").
- 명령 가르기는 `shellPieces`로 나눈 조각에서 앞쪽의 `cd …` 조각을 떼고, 남은 조각이 모두 read·list·search면 **첫 조각**의 category다. 하나라도 command이거나 남은 조각이 없으면 command다. 이유: `rg foo | head`처럼 뒤 조각은 출력을 줄이는 일이 많다. `shellPieces`는 `&&`·`||`·`;`·`|`·줄바꿈을 같이 나눈다. roadmap은 파이프와 `&&`만 말하지만 `approval.md`의 shell 규칙과 같은 조각을 쓰는 쪽이 단순하다.
- 조각 하나의 category는 낱말로 본다(`normalize`가 공백을 줄인 뒤 `" "`로 나눈다): 첫 낱말이 `cat`·`head`·`tail`·`nl`이거나 `sed`이고 둘째 낱말이 `-n`이면 read, `ls`·`tree`·`find`·`fd`면 list, `rg`·`grep`이거나 `git grep`이면 search, 나머지는 command다. 환경 변수 앞붙임(`FOO=1 rg …`)이나 경로가 붙은 명령(`/usr/bin/rg`)은 command다(roadmap "Codex `parse_command`의 작은 부분").
- `skill`, `tool.load`, MCP tool, `ask`, `call`, `file.write`, `file.edit`과 다른 module의 tool(앱 진단, domain, workflow, job, role tool)에는 `display`를 두지 않는다. `toolCallDisplay`의 fallback `{category: "other", title: <tool 이름>}`이 roadmap의 "other, tool 이름"과 같다. edit/write는 성공하면 edit card이고(roadmap), 실패한 것만 tool 줄이라 이름으로 둔다.
- **앱 tool도 `display`를 두지 않는다**(roadmap은 "앱 tool은 선언의 이름"). 이유: `ListToolCalls`는 core daemon에서 돌고 앱 tool 정의는 agent runtime child가 활성 release와 할당으로 만든다(`tools/app-tools.ts`의 `buildAppTools`). 저장된 `tool_calls.tool`은 wire 이름(`<domain>_<tool>`, 64자를 넘으면 hash가 붙는다, `tools/app-tool/name.ts`)이고 `app_tool` 열은 채우는 곳이 없어, core는 선언의 이름을 모른다. child에서만 선언의 이름을 쓰면 `ToolCallStarted`와 `ListToolCalls`의 제목이 달라 turn이 끝날 때 줄이 바뀐다(README "도는 중과 끝난 뒤가 같은 묶기 함수"). 그래서 두 길 모두 저장된 wire 이름(fallback, 예: `calendar_event_list`)이다. planner가 이대로 정했다(wire 이름도 읽히고, 선언의 이름을 남길 칸을 새로 둘 만큼 얻는 것이 없다). 계약 바꾸기 요청은 하지 않는다.
- `ListToolCalls`는 모든 자격(user, agent, machine)에 같은 display를 싣는다(`chat-protocol` 계약의 item 모양). 입력 본문은 `display`가 있는 정의의 call만 읽고, 64 KiB(`TURN_BODY_VIEW_MAX_BYTES`)를 넘는 입력은 읽지 않고 fallback이다. 이유: 큰 heredoc 명령(`cat > f <<EOF …`)은 body view의 64 KiB에서 잘려 JSON으로 읽히지 않는다. 새 API read는 `chat-protocol`이 더한 `tool` filter를 지킨다(`session/history.ts`의 `readLoads`는 `tool.load`만 읽어 입력 blob을 읽지 않는다). 그런 call은 도는 중에는 command와 첫 줄, snapshot에서는 `other`와 `shell.run`이 된다(드물다. 보고의 "알려진 미완 동작"에 적는다).

1. `packages/core/lophn-agent/tools/registry.ts` (근거: `agent-tool-spi`, `agent-definition.md` "tool 정의가 바뀌었나")
   - `ToolDefinition`(21줄)에 `display?: (input: unknown) => ToolCallDisplay`를 더한다. 주석: 사람 화면의 tool 줄 제목이다. 값은 실행기 검사(`input`)를 지난 입력만 받고 redaction 전 글이다. 저장하지 않고 model에 보이지 않는다.
   - `definitionHash`(55줄)는 고치지 않는다. display는 model에 보이는 칸이 아니다.
   - `ToolCallDisplay`는 `../../../protocol/lophn-agent/mod.ts`에서 type import한다.
2. `packages/core/lophn-agent/tools/define.ts` (근거: `agent-tool-spi`)
   - `ToolSpec`(7줄)에 `display?: (input: z.infer<I>) => ToolCallDisplay`를 더하고, `defineTool`이 `gate`와 같은 모양으로 넘긴다(`spec.display as ToolDefinition["display"]`, 없으면 칸을 두지 않는다). 주석은 handler와 같은 이유 한 줄("`toolCallDisplay`가 `spec.input`으로 검사한 뒤에만 부르므로 입력 type이 맞다").
3. `packages/core/lophn-agent/tools/shell/classify.ts` (새 file. 근거: roadmap 7 "shell 명령을 가른다", `approval.md` "shell 규칙")
   - `export function shellCategory(command: string): "read" | "list" | "search" | "command"`. 위 "정한 것"의 규칙이다. 조각은 `../../../approvals/gate/shell-match.ts`의 `shellPieces`로 나눈다(import만. `approvals`는 바닥이라 `tools/check-deps.ts`의 `coreLayerViolation`이 막지 않는다. `tool-judgment/tool-gate.ts`와 `tools/bundles/shell_test.ts`가 이미 `approvals`를 import한다). `approvals/mod.ts`가 아니라 `gate/shell-match.ts`를 바로 import한다(agent runtime child에 `registration.ts`를 끌어오지 않게).
   - 주석: 따옴표와 escape를 풀지 않는다. 화면의 묶기에만 쓰고 판정에는 쓰지 않는다.
4. `packages/core/lophn-agent/tools/bundles/shell.ts` (근거: roadmap 7 "`shell.run`에 선택 칸 `description`", README "정한 것")
   - 입력 `z.strictObject`(13줄)에 `description: z.string().optional().describe(SHELL_DESCRIPTION)`을 더한다. 빈 글도 받는다(빈 글로 call 전체가 `invalid_input`이 되지 않게). 제목에서 빈 글은 없는 것과 같다.
   - `SHELL_DESCRIPTION`(file 안 const)은 Claude Code Bash `description`의 설명을 줄여 옮긴 글이다. 이대로 쓴다:
     `What this command does, in active voice, shown to the person instead of the command. For simple commands use 5-10 words, e.g. ls → "List files in current directory", git status → "Show working tree status". For piped commands or obscure flags add enough context, e.g. curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements". Say what it does in plain words: do not repeat the command, its flags or file paths.`
   - `display: (input) => ({ category: shellCategory(input.command), title: <위 제목 규칙> })`를 더한다.
   - `gate`(23줄)는 그대로 `{ kind: "shell", command: input.command }`다. `description`을 싣지 않는다. `runShell`(`tools/shell/run.ts`)은 `{command, timeout_ms?}`만 쓰므로 고치지 않는다.
   - 입력 schema가 바뀌므로 `shell.run`의 `definitionHash`도 바뀐다. 정의가 바뀐 것이 맞다. 이 hash를 박아 둔 test가 있으면 고치지 말고 보고한다.
5. `packages/core/lophn-agent/tools/bundles/file.ts` (근거: roadmap 7 표)
   - `file.read`(22줄) → `{category: "read", title: "Read <path>" + 범위}`, `pdf.read`(89줄) → read, `Read <path> (pages <pages>)`, `image.read`(99줄) → read, `Read <path>`.
   - `file.grep`(67줄) → search, `Search <pattern>` + (`path`가 있으면 ` in <path>`).
   - `file.glob`(58줄) → list, `List <pattern>`. `file.outline`(80줄) → list, `Outline <path>`.
   - `file.write`, `file.edit`에는 두지 않는다(위 "정한 것").
6. `packages/core/lophn-agent/tools/bundles/web.ts` (근거: roadmap 7 표)
   - `web.search`(12줄) → web, `Search the web for <query>`. `web.fetch`(21줄) → web, `Fetch <url>`.
7. `packages/core/lophn-agent/tools/display.ts` (근거: `chat-protocol` 계약 "`tool-title-core`가 채울 자리", README "tool 제목은 한 줄, 120자에서 자른다", `app-call.md` 94줄)
   - `toolCallDisplay(definition, name, input, redact)`의 fallback 몸을 채운다. 차례:
     1. `definition?.display`가 없으면 fallback `{category: "other", title: name}`.
     2. `definition.input.safeParse(input)`이 실패하면 fallback(저장된 입력은 model이 틀리게 보낸 것일 수 있다).
     3. `definition.display(parsed.data)`를 부른다. 던지면 fallback.
     4. 나온 title 전체를 `await redact(title)`에 거친다. null(끝내지 못함)이면 fallback. **자르기 전에 redaction한다.** 자른 뒤에 하면 120자 경계에 걸친 secret의 앞부분이 남는다.
     5. 공백 덩어리(줄바꿈 포함)를 빈칸 하나로 바꾸고 trim한다. 비면 fallback.
     6. 글자(`Array.from`으로 센 code point) 120개를 넘으면 앞 119자에 `…`를 붙인다. surrogate 반쪽을 남기지 않는다.
   - 결과는 `{category: <display의 category>, title}`이다. fallback의 title은 tool 이름이라 redaction을 거치지 않는다.
   - `chat-protocol`이 정한 import와 인자 type은 그대로다(`RedactText`를 import하지 않는다). 여전히 `tools/mod.ts`에 export하지 않아도 된다.
8. `packages/core/lophn-agent/tools/reads.ts` (근거: roadmap 7 "저장하지 않고 읽을 때 만든다", README "core가 `ListToolCalls`를 낼 때 만들고 redaction을 거친다", 본보기 `run-loop/turn-body-reads.ts`의 `turnBodyViewRead`)
   - `ListToolCalls`를 동기 pool read에서 core가 바로 여는 API read로 옮긴다. pool read(reader Worker)는 blob 바이트를 기다리지 못하고 지금의 redaction(알려진 secret)도 core에만 있다.
   - `createToolReads()`는 `read`(`ReadToolCall`)만 돌려준다. `list`와 `chat-protocol`이 `toCalls`에 둔 fallback display를 지운다.
   - `export type ToolCallListEnvironment = MessageBodyEnvironment & { readonly redact: (text: string) => string | null; readonly definitionOf: (tool: string) => ToolDefinition | undefined }`와 `export function toolCallListRead(environment: ToolCallListEnvironment): ApiReadDefinition<typeof toolCallList>`를 더한다. `MessageBodyEnvironment`, `readBodyBytes`는 `../session/body-read.ts`에서 import한다.
   - handler:
     - 입력은 `turnBodyViewRead`처럼 route input schema(`toolCallList.input.safeParse`)로 다시 보고, 어긋나면 `invalid_input`이다. 자격 검사는 지금처럼 없다(route의 `actors`가 본다).
     - cursor 풀기(`cursorAfter`), where 절, `order by id limit ?`, `next_cursor`는 지금 list handler 그대로 옮긴다.
     - 행 읽기는 `environment.snapshot((sql, asOf) => …)` 한 번이다. select에 입력 blob 크기를 같이 읽는다: `(select size_bytes from blob_refs where owner_kind = 'tool_call' and owner_key = tool_calls.id and field = 'input' and hash = tool_calls.input) as input_size`(`turn-body-reads.ts`의 `tool_call_input` 판정과 같은 열). snapshot이 실패하면 그 오류다(`UNATTACHED_MESSAGE_BODY`면 `unavailable`).
     - 행마다 `callFromRow`로 `ToolCall`을 만들고 `definition = environment.definitionOf(call.tool)`이다. `definition?.display`가 있고 `input_size`가 1 이상 `TURN_BODY_VIEW_MAX_BYTES` 이하면 `readBodyBytes(environment, call.input, size)`로 읽어 UTF-8(fatal) → `JSON.parse`한다. 읽기나 해석이 실패하면 입력 없이(`undefined`) 넘긴다. 그다음 `display = await toolCallDisplay(definition, call.tool, input, environment.redact)`이다. fallback은 `toolCallDisplay` 한 곳에만 있다.
     - 한 page(최대 100)의 call은 `Promise.all`로 같이 만든다. 제목 하나를 못 만들어도 목록은 실패하지 않는다(그 call은 fallback).
     - 결과는 `{ tool_calls: ListedToolCall[], as_of_seq: asOf, next_cursor }`다.
   - `toolCallList` 대신 `ReadDefinition` import가 `read`에만 남는지 본다.
9. `packages/core/lophn-agent/tools/mod.ts`: `toolCallListRead`와 `type ToolCallListEnvironment`를 `createToolReads` 옆에서 export한다.
10. `packages/core/lophn-agent/register.ts` (근거: `register.ts`의 "사람이 turn 근거·tool 입력·tool 결과를 펼쳐 볼 때 지금의 redaction을 거치는 통로" 주석, `layers.md`)
    - `createLophnAgent`의 `reads`(830줄)와 `createReaderRegistration`의 `reads`(910줄)에서 `toolReads.list`를 지운다. 같은 route가 pool read와 API read 둘로 올라가면 core 조립(`main/daemon/registration.ts`의 `taken`)이 기동을 거절한다.
    - module 범위 const로 제목을 만들 내장 정의 표를 둔다: `createFileTools(…)`, `SHELL_TOOLS`, `WEB_TOOLS`(`./tools/bundles/{file,shell,web}.ts`)를 이름으로 찾는 `Map`. `createFileTools`의 hook은 부르지 않는 자리라 `{ aroundWrite: () => Promise.resolve(err({ code: "unavailable", message: "core does not run file tools" })) }`를 넘긴다. 주석: core는 tool을 실행하지 않고 제목(`display`)만 읽는다. 다른 module의 tool과 앱·MCP tool은 display가 없어 표에 없어도 같은 fallback이다.
    - `createLedgerRegistration`의 `apiReads`(597줄)에 `toolCallListRead({ ...(environment.messageBody ?? UNATTACHED_MESSAGE_BODY), redact: environment.redactBody ?? UNATTACHED_REDACT, definitionOf: (tool) => <표>.get(tool) })`를 `turnBodyViewRead` 옆에 더한다. 주석 한 줄: 사람 화면의 body view와 같은 지금의 redaction으로 제목을 만든다. `environment`의 모양과 wiring(`main/daemon/wiring/lophn-agent-session.ts`)은 고치지 않는다.
11. 넘길 줄: `packages/core/lophn-agent/session/body-read.ts`(소유 밖)의 `MessageBodyEnvironment.snapshot`(21~23줄) callback 인자 type을 `Pick<Sql, "get" | "all">`로 넓힌다. 목록 query가 `all`을 쓴다. 실제 연결(`session/message-body.ts`의 `messageBodyEnvironment`가 넘기는 `openConnection`의 sql)은 이미 `all`을 갖고 있어 그 file은 고치지 않는다. 한 줄이고 보고의 "넘길 줄"에 적는다.
12. `packages/core/lophn-agent/run-loop/turn-body-reads.ts`는 고치지 않는다(본보기). `core-ports.ts`도 고치지 않는다. `ToolCallStarted`는 `chat-protocol`이 이미 `toolCallDisplay`를 부르므로 이 task의 display가 그대로 실린다.
13. 위험 test `packages/core/lophn-agent/tools/display_test.ts` (새 file. 근거: README "위험 test" "reasoning 글과 tool 제목은 지금의 redaction을 거친다", `write-test` "권한, secret, sandbox 경계", "순수 함수", "여러 경우는 표로")
    - 이름: `"tool 제목에는 지금의 redaction이 가리는 secret이 나오지 않는다"`. test 하나에 경우를 표로 돈다.
    - 준비: `SHELL_TOOLS[0]`(실제 `shell.run` 정의)과 실제 제품 redactor. `createProductRedactor`(`packages/base/redaction/mod.ts`)에 알려진 secret 하나를 맞추는 matcher(`product-redactor_test.ts`의 `known`과 같은 모양)를 주고, `(text) => redactor(source, "text/plain", text)`를 `redact`로 넘긴다.
    - 경우(모두 `title`에 secret이 없다. 판정은 `title.includes(SECRET)`이 아니고, 경계 경우는 secret 앞 8자도 없는지 본다):
      - `description` 없이 명령에 알려진 secret(`curl -H "x-api-key: <SECRET>" https://…`)
      - `description`에 알려진 secret
      - 앞에 110자쯤의 글을 두어 secret이 120자 경계에 걸친 명령(자르기 전에 redaction하는지 본다)
      - 알려진 값이 아니라 pattern으로 잡히는 credential(`sk-ant-…`)이 든 명령
      - 알려진 secret을 아직 다 모르는 redactor(`ready: false`)면 display가 `{category: "other", title: "shell.run"}`이다(원문이 나가지 않는다)
    - 명령 가르기, 제목 글 모양, 120자 자르기 자체는 test하지 않는다(README "명령 가르기는 test하지 않는다", `write-test` "사소한 함수").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "tool 제목에는 지금의 redaction이 가리는 secret이 나오지 않는다"(`packages/core/lophn-agent/tools/display_test.ts`). 작업 중에는 `deno test --no-check packages/core/lophn-agent/tools/`만 돌린다.
- 남지 않음:
  - `grep -n "toolReads.list" packages/core/lophn-agent/register.ts`가 0줄이다.
  - `grep -n "category: \"other\"" packages/core/lophn-agent/tools/reads.ts`가 0줄이다(fallback은 `tools/display.ts` 한 곳).
  - `shell.run`의 `gate`는 `{ kind: "shell", command }` 그대로다(`packages/core/approvals`와 `packages/protocol/approvals`에 바뀐 줄이 없다).
- 확인(test 아님): `deno task dev`(fake provider)로 tool을 부르는 turn을 하나 돌려 Agent 탭이 그 전과 같이 열린다(`ListToolCalls`가 API read로 옮겨도 목록이 온다). 제목이 보이는 화면은 `tool-title-shell`이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 없을 것이다(`ListToolCalls`는 `register.ts` 안에서 pool read에서 API read로 옮긴다). 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"과 다르게 한 곳이 있으면 이유와 함께)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. `session/body-read.ts`의 `MessageBodyEnvironment.snapshot` type 한 줄을 적는다.
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적을 것: 64 KiB를 넘는 입력의 `shell.run`은 snapshot에서 `other`·`shell.run`이다.
