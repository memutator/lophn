# agent-tools-registry

`lophn-agent/tools`의 뼈대를 새 모양으로 바꾼다. role이 고정한 tool 목록을 만들고, model에 보내는 wire 이름과 역조회 표, "없는 tool" 오류, deferred 문턱, 실행기를 둔다. 다른 agent-tools task가 채울 묶음 file의 빈 껍데기도 이 task가 만든다.

- 단위: agent-tools (wave 3)
- 선행: 없음. 이 task가 agent-tools의 나머지 task(agent-tools-file, agent-tools-shell-web, agent-tools-work, agent-tools-context, agent-tools-call, agent-tools-app-api)의 선행이다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/registry.ts`
  - `packages/core/lophn-agent/tools/builtin.ts` (새로: 묶음을 role별 목록으로 모은다)
  - `packages/core/lophn-agent/tools/wire.ts` (새로)
  - `packages/core/lophn-agent/tools/deferred.ts` (새로)
  - `packages/core/lophn-agent/tools/tool-context.ts` (새로: 실행에 넘기는 `ToolContext`)
  - `packages/core/lophn-agent/tools/ports.ts` (새로: tool이 기대는 port type)
  - `packages/core/lophn-agent/tools/work.ts`, `mod.ts`, `toolkit.ts`, `result.ts`, `schema.ts`
  - `packages/core/lophn-agent/tools/bundles/common.ts`, `handlers.ts`, `paging.ts`, `read-log.ts`
  - 지울 것: `tools/bundles/{document,format,app-context,problem-interpretation,agent,question-actions,visual-view}.ts`, `tools/bundles/sdk.ts`, `tools/bundles/metadata.ts`(wave 1이 이미 지웠으면 건너뛴다. 지운 file의 정의는 agent-tools-work가 새로 짓는다)
  - 껍데기만 만든다(내용은 뒤 task가 채우고 그 뒤로 그 task의 소유다): 아래 "껍데기" 표
- 읽을 것:
  - spec: S4 3·4·6·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I1.4#1`, `I1.4#2`, `I2.1#13`, `I2.2#23`, `I2.4#14`, `I3.4#11`, `I3.4#9`(deferred 문턱 계산 부분)
  - 결정: `../README.md` 3장 #3, #5, #41
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/workflow.md` "lead와 worker"(남이 쓰는 export는 더하기만 한다)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/tool-catalog.ts`의 `builtinToolNames`, `toWireToolName`, `TOOL_INPUTS`, `WIRE_TOOL_NAME_PATTERN`(contract-agent-tools-catalog). Gate port는 `core/approvals/ports.ts`(contract-approvals), Router port는 `core/lophn-agent/ports.ts`(contract-calls-places). 이 port를 부르는 fake로 짓는다.
  - 내놓는 것: `ToolDefinition`, `listTools(role, session)`, `toolForWireName(name)`, `executeTool(...)`, `ToolContext`, `tools/ports.ts`의 port type, `splitDeferred(definitions, threshold)`. 다른 agent-tools task가 이것으로 묶음을 짓는다.

## 껍데기

이 task가 `export const <이름>: readonly ToolDefinition[] = [];`만 둔 file을 만든다. 이미 있는 file은 내용을 비워 껍데기로 바꾼다.

| file (`tools/bundles/`) | export | 채우는 task |
|---|---|---|
| `file.ts` | `FILE_TOOLS` | agent-tools-file |
| `shell.ts` | `SHELL_TOOLS` | agent-tools-shell-web |
| `web.ts` | `WEB_TOOLS` | agent-tools-shell-web |
| `ticket.ts`, `problem.ts`, `app.ts`, `package.ts`, `release.ts`, `guide.ts`, `operator.ts`, `visual.ts`, `instructions.ts` | `TICKET_TOOLS`, `PROBLEM_TOOLS`, `APP_TOOLS`, `PACKAGE_TOOLS`, `RELEASE_TOOLS`, `GUIDE_TOOLS`, `OPERATOR_TOOLS`, `VISUAL_TOOLS`, `INSTRUCTION_TOOLS` | agent-tools-work |
| `context.ts`, `outline.ts` | `CONTEXT_TOOLS`, `OUTLINE_TOOLS` | agent-tools-context |
| `call.ts`, `ask.ts`, `skill.ts` | `CALL_TOOLS`(call, reply, cancel, session.list), `ASK_TOOLS`, `SKILL_TOOLS`(skill.read, tool.search) | agent-tools-call |

`tools/app-tools.ts`와 `tools/app-toolkit.ts`는 agent-tools-app-api가 고친다. 이 task는 건드리지 않는다.

## 할 일

1. 밖에서 쓰는 export를 먼저 센다: `grep -rn "lophn-agent/tools\|from \"\./tools\|tools/mod.ts" packages/core --include=*.ts`. run-loop, tool-judgment, extensions, session, waiting-and-recovery, prompt-assembly, `core/apps/tickets/ports.ts`, `main/daemon/core.ts`, `main/agent-runtime/product-driver.ts`가 쓰는 이름은 지우지 않는다. 지울 수 없어 남긴 것은 보고의 "안 쓰게 된 export"에 적는다.
2. `registry.ts`를 고친다 (`I1.4#1`, `I1.4#2`).
   - `FORBIDDEN_TOOL_NAMES`, `FORBIDDEN`, `listTools`의 금지 이름 skip, `BUILTIN_TOOLS` 위의 "내장 tool은 문서·앱·context와 agent 일만 다룬다" 주석, `TOOL_BUNDLES`, `SUPPORTING_OPERATIONS`의 문서·질문·context 항목을 지운다. shell, file, web 이름은 이제 정의된 tool 이름이다.
   - `ToolDefinition`은 `name`(정본), `description`, `input`, `effect`, `origin`(`builtin`, `app`, `external`), 실행 handler를 가진다. `effect`(read, write, external)는 registry와 Gate만 읽고 model에 보이는 정의로 만들 때 뺀다(`I2.2#23`, S4 4장 "app-api tool"). `context` origin(선언 검색 tool)은 없앤다.
   - 옛 칸(`confirm`, `reversible`, `idempotent`, `scopeCheck`, `contract`, `revision`, `errors`)은 packages/core 안에서 tool-judgment나 run-loop가 읽으면 지우지 않고 `bundles/common.ts`의 `defineBuiltin`이 기본값을 채운다. 읽는 곳이 없으면 지운다.
3. `builtin.ts`: 껍데기 file의 export를 모아 `builtinTools(): readonly ToolDefinition[]`를 만든다. `listTools(role, model)`은 `builtinToolNames(role)`에 든 이름만, 순서는 `TOOL_INPUTS` 선언 순서로 돌려준다 (`I2.4#14`). model이 image 입력을 못 받으면(`models/snapshot.json`의 `input_media`) `image.read`를 뺀다. role이 고정한 목록 밖의 tool은 목록에도 실행에도 없다.
4. `wire.ts` (`I3.4#11`): 정의 목록에서 wire 이름 → 정의 표를 만들고 `toolForWireName(name)`으로 거꾸로 찾는다. 이름을 parse하지 않는다. 같은 wire 이름이 둘이면 목록을 만들 때 오류다. 없는 tool을 부르면 한 줄로 구별한다: 없음, grant에서 뺌, release에서 빠짐, 거절 (`unknown_tool`, `removed_from_grant`, `removed_from_release`, `denied` 네 코드와 영어 한 줄).
5. `deferred.ts` (`I3.4#9`): `splitDeferred(definitions, thresholdTokens)`가 정의 전체를 prompt에 둘 것과 이름만 둘 것으로 나눈다. token 수는 입력 schema JSON 길이를 4로 나눈 값으로 센다. 문턱 값은 인자다(session을 시작할 때 고정하는 일은 router의 run-loop가 한다).
6. `work.ts`의 `executeTool`: 정의의 handler를 부른다. Gate가 걸리는 tool(app-api, MCP, call, 설정 고치기 tool `operator.create`·`operator.update`)은 실행 전에 `ToolContext.gate`로 core에 묻고, 막으면 이유를 결과로 돌려준다. file, shell, web, pdf, image tool은 Gate를 거치지 않는다 (README 3장 #3). 결과 오류 문장은 지금처럼 공통 코드 문장으로 고정한다.
7. `tool-context.ts`: `ToolContext`는 `session`, `turn`, `tool_call`(id. dedup 기준), `role`, `place`, `listed`(그 session이 고정한 tool 목록. `tool.search`가 읽는다), core 호출(`core: CoreCall`, agent 자격), `gate`, `router`, `questions`, `scope`(`PlaceScope`), `rewind`, `skills`(`SkillReader`), `clock`, `ids`, `fetch`를 가진다. `ports.ts`에는 이 가운데 contract에 없는 port type만 둔다: `QuestionWait`(ask가 기다림을 맡기는 port: 질문 묶음을 올리고 답이나 사람 메시지가 올 때 풀린다. 구현은 router의 waiting-and-recovery가 한다), `PlaceScope`(role과 session의 place에서 읽기·쓰기 허용 폴더 목록), `SkillReader`(`read(session, name, path?)`로 그 turn이 시작할 때 읽은 판의 skill 본문이나 딸린 파일을 돌려준다. 꺼진 skill은 막는다. 구현은 agent-definition-extensions의 `extensions/skill-read.ts`가 이 모양에 맞춘다).
8. 옛 묶음 file 정리: 껍데기 표에 없는 옛 묶음 file을 지운다(위 "지울 것"). wave 1이 이미 지운 `document.ts`, `format.ts`, `series-next-tool.ts`, `tool-documents.ts`, `visuals/`는 남아 있으면 같이 지운다.
9. tool call 기록 장치(`tools/{model,commands,reads,erase}.ts`, `tool_calls` 표)는 run-loop가 아직 쓴다. 지우지 않는다. `tools/commands.ts`의 `tx.emit` 9곳(`I2.1#13`)도 그 장치와 함께 죽으므로 지우지 않고 보고한다. 이 task의 새 코드는 event를 쓰지 않는다.
10. `mod.ts`: 새 export를 더한다. 지운 이름은 빼되 1번에서 남기기로 한 것은 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "role의 고정 목록에 없는 tool은 목록에도 실행에도 나오지 않는다" — `registry_test.ts`에서 Operator에 `ticket.create`와 `file.read`를 요청해 앞은 `unknown_tool`, 뒤는 실행되는 것을 본다. 같은 wire 이름 충돌이 오류인 것도 한 줄 더 본다.
- 남지 않음: `grep -rn "FORBIDDEN_TOOL_NAMES\|TOOL_BUNDLES" packages` 가 0줄이다. `grep -rn "document\.\(list\|read_section\|save_version\)" packages/core/lophn-agent/tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음(`register.ts`의 tool 등록은 agent-definition-register가 본다)
- 안 쓰게 된 export: 1번에서 남긴 것(`tool_calls` 기록 장치, 옛 `ToolDefinition` 칸)
- 정한 것: deferred token 계산식, "없는 tool" 오류 네 코드, `ToolContext` 칸
- 계약 바꾸기 요청: `ToolContext`가 기대는 Gate·Router port에서 모자란 칸
