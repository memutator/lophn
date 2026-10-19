# dt-agent-tools

agent가 앱 tool을 받는 길을 새 선언 모양으로 다시 쓰고, agent tool 입력의 `project` 칸을 지운다. tool 이름은 지금처럼 `app__<app>__<tool>`이고 결과 mapping(`resultOf`)은 그대로다. 호출은 `app.call_tool`로 간다.

- 단위: domain-tools (wave 2)
- 선행: dt-call-route
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/app-tools.ts`
  - `packages/core/lophn-agent/tools/app-toolkit.ts`
  - `packages/core/lophn-agent/tools/mod.ts`
  - `packages/core/lophn-agent/tools/app-api/input.ts`
  - `packages/core/lophn-agent/tools/app-api/input_test.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`("agent에게는 app-api가 tool로 보인다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tool-spi`, `apps`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "agent tool", "project 범위 지우기"와 "같이 도는 계획" 표(이 file들은 `domain-place`도 닿는다. 그쪽은 다른 project의 공개 tool만 보이게 거르는 일을 grant·toolkit 입력에서 한다)
  - 지금 코드: `packages/core/lophn-agent/tools/app-tools.ts`(`buildAppApiTools`), `app-api/input.ts`(`appApiInput`)
- 계약:
  - 쓰는 것: `ToolDeclaration`(`dt-decl`), `appCallTool`·`ToolCallOutput`(`dt-call-route`)
  - 내놓는 것: agent tool 정의의 이름 `app__<app>__<tool>`(`APP_API_TOOL_PREFIX`·`appApiToolName` 그대로), 입력 JSON schema는 선언의 `inputSchema`(`null`이면 빈 object), 호출은 `app.call_tool`

## 할 일

1. `app-api/input.ts`: `project_scope`·`place`·`PROJECT`·`wrapped`(non-object 입력을 `{input}`으로 감싸는 갈래)를 지운다. 선언의 `inputSchema`는 `null`이거나 root type이 `object`다(`dt-decl` 계약). 함수는 `{ jsonSchema, validator }`만 낸다(`split`은 필요 없다. `null` 선언이면 앱에는 입력을 보내지 않는다). 함수 이름은 `toolInput`으로 바꾼다. 파일 이름은 둔다.
2. `app-tools.ts`: `AppApiView.app_api`→`tools: readonly AppTool[]`(`dt-decl`이 읽기만 맞춰 두었다), `name/title/description/inputSchema/effect`를 쓴다. 정의의 description은 `App <앱 이름> (<app id>), tool <name>: <title>. <description>`이다("app-api" 표현을 지운다). `readOf(ctx.core, appCallTool, { target: {mode: "live", app, release: null}, tool: name, input?, caller })`로 부른다. `AppApiSource.place`와 `project` 보내기를 지운다. `resultOf`의 라벨도 "tool <name> of <app>"으로 바꾼다. `grantAllows`와 정렬(앱, 이름 순)과 중복 이름 처리는 그대로.
   - outputSchema는 agent 정의에 싣지 않는다(`ToolDefinition`에 칸이 없고 결과 mapping은 그대로다). MCP annotation도 싣지 않는다(근거는 `app-call.md`: 조사한 harness 모두 정의에 효과를 싣지 않고 호출 때 판정한다).
3. `app-toolkit.ts`: `define(agent, place)`의 `place` 인자를 지운다. 읽은 선언은 `read.value.tools`를 쓴다. `mod.ts`의 export를 맞춘다.
4. `run-loop/prepare.ts`: `buildAppApiTools({ place: session.place, ...})`에서 `place` 줄 하나만 지운다(소유 밖 file의 최소 수정. 보고의 "넘길 줄"에 적는다).
5. `core/apps/agent-tools/app.ts`: agent tool `app.app_api`(이름 그대로)의 description을 새 칸(`name, title, description, effect, public`, 앱 하나를 볼 때 `inputSchema`)으로 고친다.
6. `app-api/input_test.ts`는 project 때문에 있던 test라 지운다(`write-test`: 설계와 안 맞는 test는 고치지 않고 지운다). 이 test가 지키던 권한 경계는 "agent가 다른 project를 지정하지 못한다"뿐이고 그 칸이 없어졌다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — project를 고르는 입력이 없어져 지킬 경계가 없고, 호출 길의 Gate·기록은 `dt-call-route`의 test가 본다. `name_test.ts`(이름 모양)는 그대로 통과해야 한다.
- 남지 않음:
  - `grep -rnE "project_scope|PROJECT_SCHEMA|appApiInput|\bplace\b" packages/core/lophn-agent/tools/app-tools.ts packages/core/lophn-agent/tools/app-toolkit.ts packages/core/lophn-agent/tools/app-api/input.ts`가 0줄이다.
  - `grep -rn "app-api" packages/core/lophn-agent/tools/app-tools.ts packages/core/lophn-agent/tools/app-toolkit.ts`가 주석과 이름 규칙 설명(`name.ts` 쪽)을 빼고 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `appApiInput`(→`toolInput`), `AppApiSource.place`
- 정한 것
- 넘길 줄: `run-loop/prepare.ts`의 한 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

## lead가 더함

- `dt-decl`이 `app-api/input.ts`의 project 처리를 이미 지웠다(`appApiInput(schema)`, `input_test.ts` 삭제). `AppApiSource.place`는 `prepare.ts`가 넘겨서 "안 쓴다" 주석과 함께 남아 있다. 할 일 1·3·4대로 지운다.
- `app.app_api_index`는 입력에 `app`이 있을 때만 tool 항목에 `inputSchema`(인자 없으면 `null`)와 `outputSchema`(선언했을 때만)를 싣는다. 전체 목록에서는 두 칸이 없다. agent tool `app.app_api`의 description(할 일 5)을 이 모양에 맞춘다.
