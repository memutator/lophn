# harness-spi-registry

registry가 조립 쪽(`core/main`)에서 넘긴 tool 목록을 받게 한다. `ToolDefinition`의 안 쓰는 옛 칸을 지우고 `defineBuiltin`을 harness의 `defineTool`로 바꾼다. 옛 `contract = tool 이름`을 "그 tool이 부르는 route 이름"(`operations`)으로 바꾼다. 아래 "확인한 것"이 이 task의 근거다.

- 단위: harness-spi (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/{registry.ts,registry_test.ts,mod.ts,builtin.ts,define.ts,app-tools.ts}`
  - `packages/core/lophn-agent/tools/bundles/`
  - `packages/core/lophn-agent/extensions/mcp-tools.ts`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,runtime.ts,runtime-access.ts,agent-credentials.ts,mod.ts,ports.ts,core-ports.ts,retry.ts}`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/agent-runtime/{main.ts,product-driver.ts}`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`("실행 때 import가 뜻하는 것", "harness와 lophn domain"), `project-docs/architecture/agent-definition.md`("지키는 것"의 tool 목록 항목)
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("지금 모양"의 tool 정의 길, "단계" 1번)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `run-loop`, `agent-tool-spi`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/tool-catalog.ts`의 `TOOL_INPUTS`, `builtinToolNames`(이 task는 protocol을 바꾸지 않는다)
  - 내놓는 것:
    - `packages/core/lophn-agent/tools/define.ts`의 `defineTool(spec)`. spec은 `{ name: string; description; effect; input: z.ZodType; routes: readonly { name: string }[]; handler; gate? }`. 반환은 `ToolDefinition`이고 `origin: "builtin"`, `operations: routes의 name`을 채운다.
    - `ToolDefinition`(`tools/registry.ts`)의 칸: `name, description, input, inputSchema?, effect, origin, handler?, gate?, operations`. `revision, contract, confirm, reversible, idempotent, scopeCheck, errors`는 없다.
    - `runOperations(listed)`는 `operations`의 합집합이다.
    - `selectTools(names, model, definitions)`(`tools/registry.ts`). `listRoleTools`를 대신한다. role을 모른다. 이름 목록에 든 정의를 `definitions` 순서대로 돌려주고, model이 image 입력이 없으면 `image.read`를 뺀다.
    - `packages/core/main/agent-tools.ts`의 `agentTools(): readonly ToolDefinition[]`. 17개 bundle을 정적 import해 모으는 유일한 곳(composition root)이다. 순서는 옛 `TOOL_INPUTS` 선언 순서다.
    - `roleOperations(role, tools)`, `agentRuntimePolicies(routes, tools)`는 tool 목록을 인자로 받는다.

## 확인한 것: agent credential operation 목록과 route 이름

lead가 코드에서 확인했다. 이 task가 `contract`를 없애는 근거다.

- `defineBuiltin`(`tools/bundles/common.ts`)이 `contract = spec.name`(예: `ticket.create`)으로 둔다. `runOperations(listed)`(`tools/registry.ts`)가 그 값의 집합을 낸다. `roleOperations(role)`(`run-loop/runtime-access.ts`)이 이것에 `PLACE_READS`, `HUMAN_WAIT_ROUTES`(둘은 `route.name`), `APP_TOOL_CONTRACT`(`app.call_api`), `external_mcp_call` 등을 더한다. 이 목록이 (a) core의 agent credential 발급 상한(`createAgentCredentialLink`, `createTurnCredentials`)이고 (b) `agentRuntimePolicies`가 만드는 `OperationPolicy` 이름이다.
- tool 이름을 route 이름으로 바꾸는 곳은 어디에도 없다. core는 `route.name`으로만 대조한다. command는 `storage/ledger/executor.ts`와 `storage/ledger/dispatch.ts`의 `authorizeConditions(ctx, definition.route.name, …)`, file·upload·worker route는 `server/dispatch.ts`의 `scopeAllowed(ctx, route.name)`, 읽기 route 일부는 handler 안(`problems/reporting/access.ts`의 `requireOperation(ctx, problemList.name)`)에서 본다. `server/identity/model.ts`의 `authorize`가 `ctx.scope.operations.includes(operation)`이다.
- 그래서 tool 이름이 route 이름과 우연히 같을 때만 맞는다: `problem.list|get|set_state`, `app.list|get|create`, `blueprint.check`, `package.publish`, `context.list|get|search|draft|violations`, `glossary.set`.
- 다르면 credential 상한에 route 이름이 없다. `roleOperations("app_engineer")`를 실제로 돌려 보니 `ticket.create`는 있고 `CreateTicket`은 없다. 다른 예(route 이름): `ticket.list`→`ListTickets`, `ticket.get`→`ShowTicket`, `ticket.update|verify|cancel`→`UpdateTicket|VerifyTicket|CancelTicket`, `app.link_source`→`app.connect_source`, `package.list`→`packages.list`, `release.list|get`→`releases.list_records`…, `context.submit`→`bundle.submit`, `operator.create|update`→`CreateOperator`…, `settings.get`→`SettingsList`, `instructions.read`→`GetInstructions`, `visual.show`→`RecordMessage`. 그 가운데 command route(`ticket.create|update|verify|cancel`, `app.link_source`, `context.submit`, `operator.create|update`, `visual.show` 등)는 지금 core가 `forbidden`으로 거절할 것이다. 정적으로 읽고 operation 집합을 돌려 본 결과이고 core를 띄워 호출해 본 것은 아니다.
- 결론: `contract`를 지우는 것은 "그냥 지우면" 안전하지 않다. 값을 "tool이 부르는 route 이름"으로 바꿔야 한다(`operations`). 이 task의 유일한 동작 변화이고 위 거절을 고친다.

## 할 일

1. 시작 전에 snapshot을 뜬다. `packages/core/.tmp-probe/dump.ts`를 만들어(끝낼 때 지운다. commit하지 않는다) role 4개 × model 입력 둘(`["text"]`, `["text","image"]`)마다 `listRoleTools`가 낸 정의를 순서대로 `{name, description, effect, JSON schema(inputJsonSchema), gate가 있는가}`로 JSON에 쓴다. 파일은 `.dev-data/harness-spi-registry/tools-before.json`. 끝에 같은 script를 새 API로 돌려 `tools-after.json`과 `diff`가 없어야 한다(순서 포함). 실행: `cd packages/core && deno run -A .tmp-probe/dump.ts`(`zod`가 workspace 밖에서 안 풀린다).
2. 각 bundle의 handler가 `readOf(ctx.core, X, …)`/`commandOf(ctx.core, X, …)`로 부르는 route X를 모두 센다(`grep -n "readOf(\|commandOf(" packages/core/lophn-agent/tools/bundles/*.ts packages/core/lophn-agent/tools/context/*.ts`). 한 tool이 route를 여럿 부르면(예: `package.get`은 packagesList·packagesVersions·packagesUsage·packagesGuideBody·appGet) 모두 `routes`에 적는다. 빠뜨리면 command일 때 `forbidden`이 난다. 각 route의 `actors`에 `"agent"`가 있는지도 본다(없으면 core가 어차피 거절한다). 없는 것은 고치지 말고 "알려진 미완 동작"에 적는다.
3. `tools/registry.ts`: `ToolDefinition`에서 `revision, contract, confirm, reversible, idempotent, scopeCheck, errors`를 지우고 `operations: readonly string[]`를 더한다. `revision`이 하던 일("정의가 바뀌었나")은 정의에서 계산한다: `tools/registry.ts`에 `definitionHash(tool)`(이름, description, 입력 JSON schema, effect를 canonicalize한 sha256 앞 16자) 하나를 두고, `run-loop/prepare.ts`의 `keyOf`와 `definitions_hash`, `core-ports.ts`의 `definition_revision` 기록이 그것을 쓴다. 지금 builtin은 모두 상수 `"1"`이라 builtin 정의가 바뀌어도 알림과 기록이 구별하지 못한다. 계산하면 이것도 고쳐진다. 앱 tool(`app-tools.ts`의 `view.release`)과 MCP tool(`extensions/mcp-tools.ts`의 hash)이 넣던 revision 값도 지운다. release가 바뀌어도 정의가 같으면 알림이 안 나가는 것이 맞다. `BUILTIN_TOOLS` 상수와 `builtinTools()` import를 지운다.
4. `tools/define.ts`에 `defineTool`을 만들고 `tools/bundles/common.ts`(`defineBuiltin`)를 지운다. 17개 bundle(`tools/bundles/*.ts`)을 `defineTool`로 바꾸고 tool마다 `routes: [...]`를 적는다. 입력 schema는 아직 `input: TOOL_INPUTS["<name>"]`로 넘긴다(해체는 `harness-spi-inputs`). `name` type은 `string`이다. handler 안의 `ToolInput<…>` cast는 그대로 둔다.
5. `app-tools.ts`와 `extensions/mcp-tools.ts`의 옛 칸(`confirm`, `contract`, `reversible`, `idempotent`, `errors`)을 지우고 `operations: [APP_TOOL_CONTRACT]`, `operations: [EXTERNAL_TOOL_CONTRACT]`를 넣는다.
6. 지운 칸의 읽는 곳을 고친다. 근거: `idempotent`는 모든 정의에서 `effect === "read"`와 같다(builtin·app·mcp 모두). `confirm`은 모든 정의에서 `false`다.
   - `run-loop/ports.ts`의 `ToolInfo.idempotent`, `run-loop/core-ports.ts`의 `info()`, `run-loop/retry.ts`의 `toolMayRetry`를 `effect === "read"`만 보게 줄인다.
   - `run-loop/core-ports.ts`의 `recordToolRequest` 입력은 `confirm: false`로 쓴다. protocol의 `confirm`·DB 칸은 이 task에서 지우지 않는다(알려진 미완 동작으로 보고).
7. `tools/builtin.ts`의 `builtinTools()`를 `packages/core/main/agent-tools.ts`의 `agentTools()`로 옮긴다(정적 import 17개). 순서는 옛 `listRoleTools`가 쓰던 `Object.keys(TOOL_INPUTS)` 순서로 정렬해 돌려준다(model에 보이는 tool 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 된다, `agent-definition.md`). `tools/builtin.ts`를 지운다. `listRoleTools`는 `selectTools`로 바꾼다.
8. 호출하는 곳을 고친다. 정의 목록은 `agentTools()`에서 와서 인자로 흐른다.
   - `run-loop/prepare.ts`: `deps.toolkit.definitions`를 필수로 하고 `BUILTIN_TOOLS` fallback을 지운다. `selectTools(builtinToolNames(role), …)`.
   - `run-loop/runtime-access.ts`: `roleOperations(role, tools)`. `run-loop/agent-credentials.ts`·`run-loop/mod.ts`의 export, `run-loop/runtime.ts`의 `agentRuntimePolicies(routes, tools)`.
   - `main/agent-runtime/main.ts`(`operations: roleOperations`), `main/agent-runtime/product-driver.ts`(`productToolkit`에 `definitions`), `main/daemon/wiring/lophn-agent-runtime.ts`(`agentRuntimePolicies(ctx.allRoutes, agentTools())`).
   - `tools/mod.ts` export: `BUILTIN_TOOLS`, `builtinTools`, `listRoleTools`, `defineBuiltin`을 `selectTools`, `defineTool`로 바꾼다.
9. `tools/registry_test.ts`를 `defineTool`, `selectTools`로 옮긴다(role 목록 밖 tool 거절, wire 이름 충돌, Gate 동작 세 개는 그대로 둔다).
10. 위험 test 하나를 `main/agent-tools_test.ts`에 쓴다(아래 "끝남").

## 끝남

- `deno task check`가 통과한다.
- 동작 비교: 1번의 `tools-before.json`과 `tools-after.json`이 같다(이름, 순서, 설명, 입력 schema, Gate 유무). `tools/registry_test.ts`가 통과한다. 다른 것은 `roleOperations(role)` 값뿐이다. 바뀐 operation(tool 이름이 빠지고 route 이름이 들어옴)을 role별로 보고에 적는다.
- 위험 test: "`roleOperations("app_engineer", agentTools())`에 `ticketCreate.name`(`CreateTicket`)이 들고 tool 이름 `ticket.create`는 없다. agent credential 상한이 tool 이름이 아니라 core가 대조하는 route 이름이다." (`main/agent-tools_test.ts`)
- 남지 않음:
  - `grep -rnE "defineBuiltin|BUILTIN_TOOLS|builtinTools\(|listRoleTools|\.contract\b|contract: " packages/core/lophn-agent packages/core/main --include=*.ts`가 0줄이다(`context.contract` 같은 계약 이야기는 제외하고 읽는다).
  - `grep -rnE "idempotent|reversible|scopeCheck" packages/core/lophn-agent --include=*.ts`가 0줄이다.
  - `packages/core/lophn-agent/tools/builtin.ts`와 `tools/bundles/common.ts`가 없다. `packages/core/.tmp-probe/`가 없다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (`main/agent-tools.ts`는 이 task가 만든다)
- 안 쓰게 된 export: 없음
- 정한 것: `definitionHash`에 넣은 칸, `operations`와 `routes`를 나눈 이유, 순서 유지 방법. 문서에 답이 없어 정한 것 모두
- 넘길 줄: 없음
- 계약 바꾸기 요청: protocol의 `confirm` 칸이 항상 `false`라 지울 수 있다. 요청으로만 적는다
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: 2번에서 찾은 `actors`에 `agent`가 없는 route, 바뀐 operation 목록, core를 띄워 각 tool을 호출해 본 것은 아니라는 점
