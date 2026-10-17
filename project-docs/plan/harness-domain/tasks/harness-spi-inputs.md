# harness-spi-inputs

중앙 `TOOL_INPUTS`·`BuiltinToolName` 표를 해체한다. tool마다 입력 schema를 자기 정의 옆에 두고 handler가 schema에서 입력 type을 얻게 한다. tool 정의를 쓰는 쪽이 harness에서 import하는 곳을 `tools/spi.ts` 하나로 모은다. 이 task 뒤 `tool-catalog.ts`에는 role 목록과 이름 규칙만 남고, 이후 domain·role 층이 bundle을 옮길 때 이 중앙 표를 고치지 않는다.

- 단위: harness-spi (wave 1)
- 선행: harness-spi-registry
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{tool-catalog.ts,tool-catalog_test.ts}`
  - `packages/core/lophn-agent/tools/{define.ts,spi.ts,fit-result.ts}`
  - `packages/core/lophn-agent/tools/domain/{input.ts,result.ts}`
  - `packages/core/lophn-agent/tools/bundles/`
  - `packages/core/lophn-agent/tools/context/{draft.ts,search.ts,visible.ts}`
  - `packages/core/lophn-agent/tools/call/sessions.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`("실행 때 import가 뜻하는 것"), `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정하고…")
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("role이 어떤 tool을 보는지 정하는 곳", 정할 것 1)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `agent-tool-spi`
- 계약:
  - 쓰는 것: `harness-spi-registry`가 낸 `defineTool`, `ToolDefinition`, `selectTools`, `agentTools()`
  - 내놓는 것:
    - `defineTool`이 입력 schema의 type을 handler에 준다: `defineTool<I extends z.ZodType>({ name: string; input: I; handler: (input: z.infer<I>, ctx: ToolContext) => Promise<Result<ToolResult>>; … })`. 실행기는 이미 `definition.input`으로 검사하고 handler를 부른다(`tools/work.ts`, `tools/schema.ts`의 `checkInput`).
    - `packages/core/lophn-agent/tools/spi.ts`: tool 정의를 쓰는 file이 harness에서 import하는 유일한 곳. `defineTool`, `ToolDefinition`, `GateRequest`, `ToolContext`, `CoreCall`, `readOf`, `commandOf`(`run-loop/core-call.ts`), `fitted`, `readBody`, `countSummary`, `forbidden`, `notFound`, `unavailable`, `invalid`(옛 `tools/domain/result.ts`)를 다시 내보낸다. 이 file은 store·DB를 import하지 않는다.
    - `packages/protocol/lophn-agent/tool-catalog.ts`: `TOOL_INPUTS`, `BuiltinToolName`이 없다. `TOOL_ORDER`(옛 `TOOL_INPUTS` 선언 순서의 이름 목록, `readonly string[]`), role 목록, `builtinToolNames(role): readonly string[]`, `toWireToolName`, 이름 규칙 상수는 남는다.

## 할 일

1. 시작 전에 snapshot을 뜬다(`harness-spi-registry`와 같은 script, 이름 `tools-before.json`). 끝에 같은 결과여야 한다(입력 JSON schema가 같다는 뜻이다).
2. `tools/define.ts`의 `defineTool`을 generic으로 바꾼다(위 계약). handler의 `input as ToolInput<…>`·`as Input<…>`·`as z.infer<(typeof TOOL_INPUTS)[…]>` cast를 모두 지운다.
3. `tool-catalog.ts`의 `TOOL_INPUTS` 항목을 tool의 bundle로 옮긴다. 근거: README 정한 것 1("입력 schema는 지금처럼 protocol의 route가 갖고, 중앙 표는 없앤다"). protocol route·schema에서 오는 것(`ticketCreateInputSchema`, `packagePublishInputSchema`, `callSendInputSchema` 등)은 bundle이 그 schema를 import해 `input:`에 쓴다. tool만의 모양(`file.read`의 `offset/limit`, `problem.list` 등)은 bundle에 inline으로 둔다. `nonblank`, `path`, `none`, `lineCount`, `operatorDefinition`, `callToolInput`은 쓰는 bundle로 가져간다. 두 bundle이 같이 쓰는 것은 더 작은 쪽에 두지 말고 각자 정의한다(공용 file을 새로 만들지 않는다).
4. `BuiltinToolName`·`RoleWriteTool` 등 이름 type을 지운다. 목록(`COMMON_TOOLS`, `WORK_TOOLS`, `READ_TOOLS`, `LOPHN_ONLY_READ_TOOLS`, `ROLE_WRITE_TOOLS`)은 `as const` 이름 배열 그대로 두고 `builtinToolNames`의 반환 type만 `readonly string[]`로 한다. 순서는 지금 그대로다.
5. `TOOL_ORDER`를 `tool-catalog.ts`에 적는다: 옛 `Object.keys(TOOL_INPUTS)`의 순서를 글자 그대로 옮긴 `as const` 배열이다(옮기기 전에 `deno eval`로 한 번 찍어 대조한다). `main/agent-tools.ts`의 정렬이 `Object.keys(TOOL_INPUTS)` 대신 `TOOL_ORDER`를 쓴다.
6. `tools/domain/result.ts`를 `tools/fit-result.ts`로, `tools/domain/input.ts`는 지운다(`ToolInput` type 없음). 쓰는 곳(`tools/bundles/*`, `tools/call/sessions.ts`, `tools/context/{draft,search,visible}.ts`)을 `tools/move-files.ts`로 고친다. `tools/domain/`에는 `app-card.ts`, `operator-place.ts`(+test)가 남는다. 이 둘은 다음 wave task가 옮긴다.
7. `tools/spi.ts`를 만들고 `tools/bundles/*.ts`가 harness에서 import하는 것을 `spi.ts`(와 `registry.ts`의 type)로 모은다. 이 task 뒤 `bundles/*.ts`가 import하는 harness file은 `../spi.ts`, `../registry.ts`(type만), 그리고 범용 tool 구현 file(`../file/*`, `../web/*`, `../shell/*`, `../call/*`, `../context/*`, `../app-api/*`)뿐이다. domain·role bundle(ticket, app, package, release, visual, problem, context, guide, operator, instructions)은 `spi.ts`와 protocol과 base만 import하는 상태가 되면 가장 좋다. 그렇게 못 하는 import는 보고의 "넘길 줄"에 file:line으로 적는다(다음 task가 푼다): 예 `bundles/context.ts`의 `run-loop/place-data.ts`·`prompt-assembly`·`tools/context/*`, `bundles/operator.ts`의 `tool-judgment/intents.ts`·`domain/operator-place.ts`, `bundles/guide.ts`의 `roles/guides.ts`, `bundles/instructions.ts`의 `instructions/read.ts`.
8. 이름 목록과 정의가 어긋나는 것을 컴파일이 더는 못 잡는다(옛 `satisfies Record<BuiltinToolName, …>`). 대신 `main/agent-tools_test.ts`에 test를 더한다: 모든 role의 `builtinToolNames(role)`에 든 이름마다 `agentTools()`에 정의가 있고, 정의마다 적어도 한 role 목록에 있다. `selectTools`가 정의 없는 이름을 조용히 건너뛰므로 목록이 말없이 줄 수 있어서다.
9. `tool-catalog_test.ts`에서 `name in TOOL_INPUTS` 줄을 지운다(wire 이름 규칙·충돌 검사는 그대로).

## 끝남

- `deno task check`가 통과한다.
- 동작 비교: `tools-before.json` == `tools-after.json`(순서, 설명, 입력 JSON schema, Gate 유무). `tools/registry_test.ts`와 `packages/protocol/lophn-agent/tool-catalog_test.ts`가 통과한다.
- 위험 test: "role 목록의 모든 이름에 정의가 있고 모든 정의가 어느 role 목록에 있다. 어긋나면 agent가 그 tool을 말없이 못 본다." (`main/agent-tools_test.ts`)
- 남지 않음:
  - `grep -rnE "TOOL_INPUTS|BuiltinToolName|ToolInput<" packages tools --include=*.ts --include=*.tsx`가 0줄이다.
  - `grep -rn "tools/domain/\(input\|result\)\|domain/result.ts\|domain/input.ts" packages --include=*.ts`가 0줄이다.
  - `packages/core/.tmp-probe/`가 없다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `tool-catalog.ts`에서 이 task가 지운 것 말고 쓰는 곳이 없어진 것
- 정한 것: `TOOL_ORDER`를 protocol에 둔 이유(model에 보이는 순서를 지키려고. role 층 task가 role 목록과 함께 core로 옮긴다), 공용 schema file을 만들지 않은 것
- 넘길 줄: 7번의 못 푼 import
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: 없음이 기본
