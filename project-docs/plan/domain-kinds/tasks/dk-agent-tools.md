# dk-agent-tools

agent가 쓰는 내장 tool 셋을 더한다: `kind.list`(조건·정렬·집계로 item 조회), `kind.check`(지금 형식 검사), 그리고 모든 role의 file tool `file.outline`(md 제목 tree와 절의 줄 범위). 지금 context tool(`context.*`)은 지우지 않는다(wave 3의 `dk-delete-context-tools`가 지운다).

roadmap은 내장 tool을 `list`·`check`라고 부른다. tool 이름은 이 저장소의 `<자원>.<동사>` 규칙을 따라 **`kind.list`·`kind.check`**로 정한다(`problem.list`·`file.glob`과 부딪히지 않는다. model에는 `kind_list`로 간다). 코드 이름은 아직 `project`다.

- 단위: agent-tools (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/tools/kind.ts`
  - `packages/core/agent-roles/tools/kind_test.ts`
  - `packages/core/agent-roles/tools/mod.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/lophn-agent/tools/file/outline.ts`
  - `packages/core/lophn-agent/tools/bundles/file.ts`
  - `tools/check-deps.ts`
  - `tests/eval/versions/files.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것", roadmap `project-docs/products/roadmap/domain.md`의 "내장 tool"(`list` 입출력 예시), "outline"
  - architecture: `project-docs/architecture/layers.md`와 `tools/check-deps.ts`(rule `tool-file`: `agent-roles/tools/**`는 store·ledger·register·`node:sqlite`를 import하지 않는다. rule `harness-domain`: `packages/core/lophn-agent/`는 `packages/protocol/projects/`를 import하지 못한다. 예외 목록 `HARNESS_LEFTOVERS`에 이유와 함께 올린다), `project-docs/architecture/agent-definition.md`(tool 목록, 작업 tool)
  - tool 정의 본보기: `packages/core/agent-roles/tools/context.ts`(`defineTool`, `readOf(ctx.core, route, input)`, `fitted`, `countSummary`, 읽기 범위 판정), `packages/core/apps/agent-tools/package.ts`(`packagesBuiltin` memory route를 tool이 부르는 꼴), `packages/core/lophn-agent/tools/spi.ts`(export 목록), `packages/core/lophn-agent/tools/fit-result.ts`(`invalid`·`notFound`·`unavailable`·`fitted`)
  - file tool 본보기: `packages/core/lophn-agent/tools/bundles/file.ts`(`createFileTools`), `packages/core/lophn-agent/tools/file/read.ts`(`readFile`: `resolveInPlace(ctx.scope, path, "read")`, 10 MiB 상한, UTF-8 검사, `ToolResult` 꼴), `packages/core/lophn-agent/tools/file/scope.ts`
  - outline parser: `packages/protocol/projects/outline-markdown.ts:286`(`parseOutline(mediaType, text)` → `{ status: "ready", title, line_count, characters, sections }`, section의 `level`·`title`·`subtree_range`·`own_range`·`characters`)
  - 계약: `packages/protocol/projects/kinds-api.ts`(`kindList`·`kindCheck`와 `kindListQuerySchema`·`kindCheckQuerySchema`)
  - eval 쪽 등록: `tests/eval/versions/files.ts`의 `TOOL_FILES`(주석: "코드에서 `defineTool({ name:`으로 tool을 정의하는 file 전부다"), `tests/eval/versions/components.ts:198`(TOOL_ORDER의 tool이 TOOL_FILES 어디에도 없으면 던진다)
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `kindGet`은 쓰지 않는다. `kindList`, `kindCheck`, `kindListQuerySchema`, `kindCheckQuerySchema`(handler는 `dk-kinds-host`가 core에 붙인다)
  - 내놓는 것: tool 이름 `kind.list`, `kind.check`, `file.outline`

## 할 일

1. `packages/core/agent-roles/tools/kind.ts`: `KIND_TOOLS`.
   - 공통: 읽는 project는 **입력으로 받지 않는다**. `ctx.place?.kind === "project"`이면 `ctx.place.id`, 아니면(lophn, app place) core를 부르지 않고 `invalid("kind tools work in a project place")`로 돌려준다. 그래서 PM·Operator는 자기 project만 읽는다(지금 `context.*`가 role과 place로 정하던 것과 같은 자리). 이름은 `notFound`가 아니라 `invalid`다(range 밖이 아니라 쓰는 곳이 아니다).
   - `kind.list`: input은 `kindListQuerySchema` 그대로. `routes: [kindList]`. 호출은 `readOf(ctx.core, kindList, { project, query: input })`. 결과는 읽기 공통 칸(`as_of_seq`)이 없는 output이므로 `readBody`를 쓰지 않고 output을 그대로 `fitted(summary, value, ["items"])`(집계면 `["groups"]`)로 돌려준다. **`next_cursor`와 `skipped`를 결과에 남긴다**(모델이 더 있는지, 빠진 문서가 있는지 알아야 한다). summary는 예 `` `23 receipt items (1 skipped)` `` 꼴의 한 줄. description은 영어로: 무엇을 하는지, `where`의 모양(연산자 목록과 `all`/`any`/`not`), `sort`·`fields`·`limit`·`cursor`, 집계(`count/sum/min/max`, `group_by` 하나), "documents with unreadable or mistyped values are left out and counted in `skipped`; read `kind.check` for why", relation은 두 번 부르라는 안내(roadmap "내장 tool"의 `list vendor` → `list receipt` 예). kind 이름과 칸은 prompt의 kind 글에 있다는 말도 넣는다.
   - `kind.check`: input은 `kindCheckQuerySchema`. `routes: [kindCheck]`. 결과 `{ status, violations, total, next_cursor }`를 `fitted(…, ["violations"])`로. description: "Run the format check of this project's kinds now: errors of kinds.yaml itself and the documents that break it".
2. `packages/core/agent-roles/tools/mod.ts`의 `ROLE_AGENT_TOOLS`에 `...KIND_TOOLS`를 더한다(`...CONTEXT_TOOLS`는 그대로).
3. `packages/core/lophn-agent/tools/file/outline.ts`: `outlineFile(input: { path }, ctx)`.
   - `resolveInPlace(ctx.scope, input.path, "read")` → 크기 10 MiB 상한과 UTF-8 검사는 `read.ts`와 같다(공용으로 뺄 만큼 크면 `read.ts`를 건드리지 말고 이 file에 같은 몇 줄을 쓴다. 소유 밖이다).
   - 확장자가 `.md`·`.markdown`이 아니면 `fail("invalid_input", "outline supports markdown files only")`.
   - `parseOutline("text/markdown", text)`의 `sections`를 `{ level, title, start_line, end_line }`(`subtree_range` 그대로. 1-based 포함 줄 번호이고 `file.read`의 `offset`·`limit`과 같은 줄 번호다)로 줄여 `{ title, line_count, sections }`을 `fitted(summary, value, ["sections"])`로 돌려준다. summary는 `` `outline of ${path}: ${n} sections, ${line_count} lines` `` 꼴.
4. `bundles/file.ts`의 `createFileTools`에 `file.outline`을 `file.grep` 뒤에 더한다: `input: z.strictObject({ path })`, `routes: []`, `effect: "read"`, description "Show the heading tree of a markdown file with the line range of each section. Read a section with file.read using offset and limit." 
5. `tool-lists.ts`: `COMMON_TOOLS`에 `"file.outline"`(`"file.grep"` 뒤), `READ_TOOLS`에 `"kind.list"`, `"kind.check"`(`"release.get"` 뒤), `TOOL_ORDER`에 `"file.outline"`(`"file.grep"` 뒤)과 `"kind.list"`, `"kind.check"`(`"release.get"` 뒤, `"context.list"` 앞). **이 file은 `domain-tools`·`domain-place`도 고친다. 이 줄들만 더하고 다른 줄은 건드리지 않는다.**
6. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`에 `packages/core/lophn-agent/tools/file/outline.ts`를 이유(`"못 옮김: file.outline이 projects protocol의 parseOutline으로 md 제목 tree를 만든다"`)와 함께 더한다.
7. `tests/eval/versions/files.ts`의 `TOOL_FILES`에 `packages/core/agent-roles/tools/kind.ts`를 더한다(`context.ts` 줄은 그대로).
8. `kind_test.ts`: 위험 test 하나(아래).

## 정한 것

- tool 이름은 `kind.list`·`kind.check`다(roadmap의 `list`·`check`에서). 이유는 위.
- 모든 role이 두 tool을 목록에 갖는다(`context.*`와 같다. 목록이 role마다 다르면 prompt prefix가 role마다 갈린다). project place가 아니면 쓸 수 없다고 답한다.
- `kind.list`의 relation(ref) 따라가기는 없다. 두 번 부른다.

## 끝남

- `deno task check`가 통과한다(`tool-lists_test.ts`의 wire 이름 충돌 검사 포함).
- 위험 test: "project place가 아닌 곳(lophn, App Engineer의 app place)에서 `kind.list`·`kind.check`가 core를 부르지 않고 `invalid_input`으로 거절한다" (`kind_test.ts`. `ToolContext`는 필요한 칸만 채운 값으로, `core`는 부르면 던지는 값으로 둔다).
- 남지 않음: 해당 없음(옛 tool을 아직 지우지 않는다).
- tool을 쓰는 길의 확인은 `dk-kinds-host`가 붙은 뒤 lead의 `boot.sh`와 (사람이 허락하면) 실제 대화로 본다. 이 task에서는 단위 test까지.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`tools/mod.ts`는 이 task 소유)
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: `tool-lists.ts` 줄 추가(다른 계획도 고친다), `tools/check-deps.ts`, `tests/eval/versions/files.ts` 한 줄씩
- 계약 바꾸기 요청: `kindListQuerySchema`가 tool input으로 쓰기 어렵게 생겼으면 여기 적는다
- **무겁게 짠 것**
- **알려진 미완 동작**
