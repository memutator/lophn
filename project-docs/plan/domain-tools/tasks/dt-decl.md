# dt-decl

blueprint의 `app_api[]`를 MCP tool 모양의 선언 목록 `tools[]`로 바꾼다(이름, 설명, input schema, 선택 output schema에 lophn 칸 `effect`와 `public`). 선언 검사, MCP annotation·tool 항목을 만드는 순수 함수, 선언을 읽는 read route의 모양을 정하고, 이 type을 쓰는 곳은 컴파일이 통과하도록 최소로 맞춘다. 이 task가 계획 전체의 선언 계약이다. `domain-place`가 `public` 칸을 기다리므로 wave 1이 land하면 planner에게 알린다.

- 단위: domain-tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/blueprint`
  - `packages/protocol/apps/channel-values.ts`
  - `packages/core/apps/blueprint/reads.ts`
  - `packages/core/apps/blueprint/reads_test.ts`
  - `packages/core/apps/blueprint/describe.ts`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/calls/service.ts`
  - `packages/core/apps/calls/calls_test.ts`
  - `packages/core/apps/runtime/entrypoint/invoke.ts`
  - `packages/core/apps/runtime/entrypoint/control.ts`
  - `packages/core/apps/releases/facts.ts`
  - `packages/core/apps/releases/activation/desired.ts`
  - `packages/core/problems/tests/work/app-driver.ts`
  - `packages/core/problems/tests/work/app-test-run.ts`
  - `packages/core/lophn-agent/tools/app-tools.ts`
  - `packages/core/lophn-agent/tools/app-toolkit.ts`
  - `packages/core/lophn-agent/tools/app-api/input.ts`
  - `packages/core/lophn-agent/tools/app-api/input_test.ts`
  - `packages/sdk/blueprint/mod.ts`
  - `packages/sdk/app-ui/use-app-api.ts`
  - `packages/shell/main/app-frame/blueprint-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
  - `tests/eval/checks/app/judge-input.ts`
  - `tests/eval/checks/app/diagnose.ts`
  - `tests/e2e/operator_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(선언, effect, 호출 길)
  - 제품 결정: `project-docs/products/roadmap/domain.md`의 "core가 아는 한 가지 모양", "MCP server와 경계, 여러 domain을 쓰는 agent", "정한 것 (agent, 초안)"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `app-spi`, `sdk-api`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 지금 코드: `packages/protocol/apps/blueprint/app-api.ts`(선언 검사), `types.ts:50`(`AppApiDeclaration`), `read.ts`(두 read route), `packages/core/apps/packages/vendor.ts`의 `BLUEPRINT`(이 폴더의 파일 이름 목록이 SDK 사본이 된다)
- 계약:
  - 쓰는 것: 없음(첫 task)
  - 내놓는 것: 아래 "계약 모양"

## 계약 모양

계획 전체가 따르는 모양이다. 다른 brief는 이 절을 가리킨다.

**선언** (`packages/protocol/apps/blueprint/types.ts`)

```ts
type ToolEffect = "read" | "write" | "external";        // 옛 AppApiEffect
type ToolDeclaration = {
  name: string;               // 옛 key
  title: string;              // 옛 label. 사람에게 보이는 이름(MCP title)
  description: string;
  inputSchema: InputSchema | null;   // null = 인자 없음. null이 아니면 root type이 "object"
  outputSchema?: InputSchema;        // 선택. 없으면 칸을 두지 않는다(null 아님). root type이 "object"
  effect: ToolEffect;         // program이 강제하는 값. Gate와 runtime 권한이 쓴다
  public: boolean;            // 다른 project에 보이는지. 이 계획은 칸만 둔다. 읽는 쪽은 domain-place
};
Blueprint = { name, description, screens, tools: ToolDeclaration[], permissions, app_connections, sdk_dependencies }
```

- `tools`가 `app_api`를 대신한다(blueprint의 알려진 칸 목록 `BLUEPRINT_KEYS`도 바꾼다). 선언은 `name`으로 정렬한다.
- `project_scope`는 지운다. 호출 길의 project 처리는 `dt-call-route`가 지운다. 그 전까지 이 task는 컴파일에 필요한 곳(`AppApiLookup`의 반환, `service.ts`)에서 `project_scope` 읽기를 `false`로 고정해 둘 뿐이다.
- `app_connections[].app_api`(다른 앱의 tool 이름 목록)와 그 type `AppApiUseDeclaration`은 이름을 바꾸지 않는다.

**이름 규칙(MCP 대응)** `name`은 1~64자, 문자는 `A-Z a-z 0-9 _ - .`만이다(`/^[A-Za-z0-9_.-]{1,64}$/`). 한 앱 안에서 유일하다.
- 근거: MCP `2025-06-18` spec은 tool 이름 문자를 정하지 않았고, 이후 spec(SEP-986)이 정한 집합 `A-Z a-z 0-9 _ - .`을 따른다. 공백, 쉼표, `*`, 제어문자는 client마다 깨진다. 길이는 agent tool 이름(`app__<app>__<tool>`, 상한 `TOOL_NAME_MAX` 64)에 들어가도록 64로 줄였다. 옛 규칙(공백만 아니면 된다)은 이 집합을 넘는 이름을 허락했다.
- `title`, `description`은 비어 있지 않다. input·output schema의 모든 `description`도 비어 있지 않다(지금 `blankDescription` 규칙 그대로).

**MCP 변환**(같은 폴더의 의존성 없는 파일. SDK 사본에도 들어간다)
- `toolAnnotations(tool)`: annotation은 힌트일 뿐이고 강제는 Gate와 runtime 권한이 한다.
  - `read` → `{ title, readOnlyHint: true, openWorldHint: false }`
  - `write` → `{ title, readOnlyHint: false, destructiveHint: true, openWorldHint: false }`
  - `external` → `{ title, readOnlyHint: false, destructiveHint: true, openWorldHint: true }`
  - `destructiveHint`를 write에 `true`로 두는 이유: tool이 지우는지 program이 알 수 없고 MCP 기본값도 `true`다. read에서는 의미가 없어 뺀다.
- `toMcpTool(tool)`: MCP `tools/list`의 항목 `{ name, title, description, inputSchema, outputSchema?, annotations }`. `inputSchema`가 `null`이면 `{ type: "object", properties: {}, additionalProperties: false }`로 낸다. `public`, `effect`는 항목에 싣지 않는다(annotation만).

**호출 이름 schema**: `packages/protocol/apps/channel-values.ts`에 `toolNameSchema`(zod, 위 규칙)를 더한다. 호출 route의 `tool` 칸과 ticket examples의 `tool` 칸이 쓴다. 기존 `appApiKeySchema`는 `request_key` 등 다른 곳이 쓰므로 그대로 둔다.

**read route**(route 이름 `app.app_api`, `app.app_api_index`와 `resource/method`는 그대로, 이름 바꾸기는 `domain-rename`이 한다)
- `app.app_api`의 output에서 `app_api`(선언 배열)가 `tools`가 된다. 항목은 위 `ToolDeclaration`(`inputSchema`는 `jsonValueSchema.nullable()`, `outputSchema`는 optional). 새 type 이름은 `AppTool`(옛 `AppAppApi`). `declarations.app_api`(이름 문자열 목록)는 그대로다.
- `app.app_api_index`의 앱 항목에서 `app_api`가 `tools`가 된다. 항목은 `{ name, title, description, effect, public }`이다. 호출 모양(`inputSchema`, `outputSchema`)은 앱 하나를 볼 때만 싣는다는 지금 원칙을 지킨다(앱 하나를 볼 때는 `app.app_api`).
- 두 route를 string으로 부르는 곳(타입 검사가 못 보는 곳)이 있다. 아래 "할 일" 7을 놓치지 않는다.

**이 계획이 이름을 바꾸지 않는 것**(`domain-rename`이 바꾼다): 승인 intent의 kind `app_api`와 grant 칸(`app_apis`, agent grant의 `apis`), `app.app_api`·`app.app_api_index` route 이름, 앱 process 사이 wire의 `api` 칸(`ProcessCallRequest.api`, broker 호출 본문), `RegisteredHandler.api`와 SDK port symbol, attestation·desired·probe의 `app_api: string[]`, `app_connections[].app_api`, release 비교의 `*_app_api` 칸, session `tool_calls.app_api`, SDK package 이름(`@lophn/cap-app-api`)과 폴더·파일 이름(`app-api.ts`, `tools/app-api/`). 이 이름들을 바꾸는 diff는 만들지 않는다.

## 할 일

1. `packages/protocol/apps/blueprint/types.ts`: 위 type으로 바꾼다(`AppApiDeclaration`→`ToolDeclaration`, `AppApiEffect`→`ToolEffect`, `Blueprint.app_api`→`tools`, `BLUEPRINT_KEYS`). `project_scope` 삭제.
2. `packages/protocol/apps/blueprint/app-api.ts`(파일 이름은 둔다. `vendor.ts`의 SDK 사본 목록이 이 이름을 쓴다): 선언 검사를 새 모양으로 바꾼다. 알려진 칸은 `name, title, description, inputSchema, outputSchema, effect, public`이고 `outputSchema`만 선택이다. `inputSchema`·`outputSchema`가 있으면 root type이 `object`가 아닐 때 `invalid_input`으로 거절한다. `public`은 boolean 필수다. 같은 파일에 `toolAnnotations`, `toMcpTool`, `ToolAnnotations`, `McpTool` type을 둔다. 의존성을 더하지 않는다(zod, node 금지).
3. `packages/protocol/apps/blueprint/json.ts`: `sortKeys`가 `key`를 고정으로 읽는다. 화면(`key`)과 선언(`name`)을 둘 다 정렬하도록 고른다.
4. `packages/protocol/apps/blueprint/value.ts`, `mod.ts`: `tools`를 쓰고 새 이름을 내보낸다(`ToolDeclaration`, `ToolEffect`, `toolAnnotations`, `toMcpTool`, `McpTool`, `ToolAnnotations`). `AppApiUseDeclaration`은 그대로 내보낸다.
5. `packages/protocol/apps/blueprint/read.ts`와 `packages/protocol/apps/channel-values.ts`: 위 "read route"와 `toolNameSchema`를 만든다.
6. `packages/core/apps/blueprint/reads.ts`, `describe.ts`: 새 모양으로 읽는다. `describe.ts`의 빈 설명 자리 문자열은 `tools.<name>.title`, `tools.<name>.description`, `tools.<name>.inputSchema.<필드>` 꼴로 바꾸고 `read.ts`의 주석 예시도 맞춘다.
7. 타입 검사가 못 보는 string 소비자를 고친다. 선언 배열을 `app_api` 키로 읽던 곳이 `tools`와 새 칸 이름(`name`, `title`, `inputSchema`)을 읽게 한다:
   - `packages/shell/main/app-frame/blueprint-source.ts`(`found.value.app_api`와 `key`, `label`, `input`)
   - `packages/shell/renderer/app-frame/app-detail/core-source.ts`(`read<{ app_api: ... }>` 한 곳, 472행 근처)
   - `packages/shell/renderer/workspace/agents/core-grants.ts`(`blueprint.value.app_api`, 58행 근처)
   - 그 밖에 `"app_api"`, `app.app_api`, `.app_api`를 문자열로 읽는 곳이 있는지 `grep -rn "app_api" packages tests/eval tests/e2e --include=*.ts --include=*.tsx`로 훑는다. 승인 intent·grant·attestation의 `app_api`는 위 "바꾸지 않는 것"이라 건드리지 않는다.
8. 컴파일 오류가 가리키는 소비자를 최소로 맞춘다. 알려진 곳은 소유 목록과 같다: `core/apps/routes.ts`의 `appApiLookupOf`, `core/apps/ports.ts`의 `AppApiLookup`(`project_scope` 반환 삭제), `core/apps/calls/service.ts`(`project_scope`를 읽던 줄은 `scoped=false`로 고정), `runtime/entrypoint/invoke.ts`·`control.ts`, `releases/facts.ts`, `releases/activation/desired.ts`, `core/problems/tests/work/app-driver.ts`·`app-test-run.ts`, `core/lophn-agent/tools/app-tools.ts`·`app-toolkit.ts`·`app-api/input.ts`(+`input_test.ts`의 fixture), `packages/sdk/blueprint/mod.ts`(type 재내보내기), `tests/eval/checks/app/judge-input.ts`·`diagnose.ts`, `tests/e2e/operator_test.ts`의 한 줄.
   - `packages/sdk/app-ui/use-app-api.ts`는 `AppApiSpec`이 `AppApiDeclaration`에서 `Pick`하던 것을 `@lophn/blueprint` import 없이 `{ key: string; label: string }`로 바꾸는 데까지만 한다. 이름 바꾸기는 `dt-sdk`가 한다.
   - `packages/core/agent-roles/place/place-data.ts`(170행 근처 `apis.value.app_api.map((api) => api.key)`)는 `domain-place`가 고치는 file이라 소유하지 않는다. 컴파일에 필요한 그 한 줄(`.tools.map((tool) => tool.name)`)만 고친다. `tests/eval/*`는 모든 계획이 닿는다. 타입이 요구하는 줄만 고친다.
   - 소유 밖 file을 고친 곳은 보고의 "넘길 줄"에 적는다. `app-tools.ts`·`input.ts`는 `dt-agent-tools`가 다시 쓰므로 선언 읽기만 새 이름으로 맞춘다.
9. 위험 test 하나를 `packages/protocol/apps/blueprint/validate_test.ts`(새 file)에 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "이름 규칙(문자, 길이, 중복), root type이 object가 아닌 input·output schema, `public` 누락, `project_scope` 같은 알 수 없는 칸이 있는 선언은 거절되고 `public`을 가진 올바른 선언은 `toMcpTool`로 annotation이 붙은 MCP 항목이 된다" — 표로 한 번에 돌린다. `write-test`: 선언 비교와 MCP 쪽 이름 노출을 정하는 결정적 판정이다. 다른 test를 더 만들지 않는다.
- 남지 않음:
  - `grep -rn "project_scope" packages tools tests/support --include=*.ts --include=*.tsx`에서 `tests/support/app/*`(e2e의 app source 문자열 patch. 이 계획이 고치지 않는다)만 남는다.
  - `grep -rnE "AppApiDeclaration|AppApiEffect|AppAppApi\b|\.app_api\.(map|find|filter)" packages tests/eval --include=*.ts --include=*.tsx`가 0줄이다(승인·grant·attestation의 `app_api` 칸을 쓰는 줄은 이 패턴에 걸리지 않는다. 걸리면 그 줄이 선언 배열인지 이름 목록인지 보고 판단한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상(`packages/protocol/apps/registry.ts`의 route 목록은 이름이 그대로라 변하지 않는다)
- 안 쓰게 된 export: `AppAppApi`(→`AppTool`), `AppApiDeclaration`, `AppApiEffect`, `appApiKey`(blueprint 안 사본)
- 정한 것: 문서에 없어 worker가 정한 것
- 넘길 줄: 소유 밖 file을 맞춘 곳(`dt-agent-tools`, `dt-sdk`가 다시 쓸 곳)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 예) e2e의 `tests/support/app/patch-*.ts`는 옛 `app_api`·`project_scope`를 문자열로 박아 이 계획 동안 맞지 않는다(e2e는 `domain-rename` 뒤 다시 쓴다)
