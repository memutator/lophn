# rd-app-api-tool

lophn과 App Engineer가 모든 앱의 이름·설명과 각 앱의 app-api 목록(key, label, description, effect)을 읽는 tool `app.app_api`를 둔다. 둘에게만 준다. App Engineer의 자격은 자기 앱 하나에 묶여 있어 지금 다른 앱을 `not_found`로 답하므로, 기존 `app.list`·`app.get`·`app.app_api`의 판정은 건드리지 않고 목록 전용 read route를 새로 둔다.

- 단위: rd-app-api (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/blueprint/read.ts`
  - `packages/protocol/apps/registry.ts`
  - `packages/core/apps/blueprint/reads.ts`
  - `packages/core/apps/blueprint/reads_test.ts`
  - `packages/core/apps/register.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/agent-roles/roles/lophn/prompt.md`
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "다른 앱의 app-api를 agent가 볼 tool이 없다"(정한 것: lophn과 App Engineer만 본다; App Engineer는 모든 앱의 목록과 각 앱의 app-api 목록만 읽는다. 다른 앱의 source, problem, ticket은 아니다)
  - architecture: `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정하고…", "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다"), `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `app-releases`
  - `conditions.app` 판정이 걸리는 곳(읽고 시작한다, 고치지 않는다):
    - `packages/core/server/identity/model.ts`의 `authorize`: 자격의 `conditions.app`과 `target.app`이 다르면 `not_found`.
    - `packages/core/storage/ledger/target-authorization.ts`의 `createTargetAuthorizer`·`outsideBoundApp`: 위를 reader·writer 입구에서 부른다.
    - `packages/core/apps/registration/reads.ts`(`app.list`는 앱마다 `authorizeApp`을 불러 범위 밖을 건너뛰고, `app.get`은 `not_found`)와 `packages/core/apps/blueprint/reads.ts`(`app.app_api`)가 `authorizeApp`을 부른다.
    - `packages/core/problems/reporting/access.ts`의 `targetVisible`(problem), `packages/core/apps/tickets/model.ts`의 `checkApp`(ticket)은 같은 판정을 쓴다. 이 둘은 넓히지 않는다.
- 계약:
  - 쓰는 것: `loadApps`(`packages/core/apps/registration/store.ts`), 활성 blueprint loader(`register.ts`가 `createBlueprintReads`에 넘기는 `loadActiveBlueprint`)
  - 내놓는 것:
    - route `app.app_api_index`(`defineRead`, resource `apps`, method `app_api_index`, actors `["agent"]`, errors `invalid_input` `unauthorized` `forbidden` `not_found` `unavailable`). input `{ app?: appIdSchema }`. output `withReadCommon({ apps: [{ app, name, description, app_api: [{ key, label, description, effect, input }] }] })`. active release가 있는 보관되지 않은 앱만 나온다. `app`을 주면 그 앱 하나(없거나 active release가 없으면 `not_found`). `input`(정규 InputSchema 또는 null)은 `app`을 주었을 때만 싣고 목록에서는 null이다. 이유: 목록이 앱 수에 비례해 커지는 것을 줄이고, 호출 모양은 한 앱을 볼 때만 필요하다.
    - 이 route는 앱 범위 판정(`authorizeApp`)을 하지 않는다. 사람의 결정(모든 앱의 목록과 app-api 목록을 App Engineer도 읽는다)을 route의 모양으로 가둔다: 돌려주는 칸이 위뿐이라 source 경로, problem, ticket은 새지 않는다.
    - tool `app.app_api`: input `{ app?: idSchema("app") }`, effect `read`, `routes: [appAppApiIndex]`. role 목록은 `lophn`과 `app_engineer`에만 있다.

## 할 일

1. `blueprint/read.ts`에 `appAppApiIndex`를 더하고(기존 `appAppApi`는 그대로) `registry.ts`의 route 목록에 넣는다.
2. `blueprint/reads.ts`의 `createBlueprintReads`에 `appApiIndex` read를 더한다: `loadApps(sql, "active")`로 앱을 모으고 앱마다 `load(sql, app.id)`로 active release의 blueprint를 읽어 위 모양으로 만든다. active release가 없는 앱은 건너뛴다. `register.ts`의 두 곳(`blueprintReads.appApi`가 들어가는 reads 목록)에 `blueprintReads.appApiIndex`를 같이 더한다.
3. `agent-tools/app.ts`의 `APP_TOOLS`에 `app.app_api`를 더한다. 설명: "List the apps with their app-api, or read one app: key, label, description and effect of the active release's app-api (and input when you give an app). Use it to see what apps already do and to get exact keys for blueprint app_connections." 출력은 route 그대로(`fitted`로 `apps`를 줄인다).
4. `tool-lists.ts`: `APP_API_TOOLS = ["app.app_api"]`를 만들고 `builtinToolNames`가 `lophn`과 `app_engineer`일 때만 넣는다. `TOOL_ORDER`에 `"app.get"` 바로 뒤. 이유: 읽기 tool은 모든 role이 갖지만 이것만 사람이 두 role로 좁혔다.
5. 지침(영어, 줄 하나씩. 계획 `prompt-text`가 이 두 file을 먼저 고쳤다. 지금 file을 읽고 맞는 문장 옆에 넣는다):
   - `roles/lophn/prompt.md`의 "Read `app.list`, `app.get` and `package.list` before you conclude that nothing fits." 뒤: "Read `app.app_api` to see what the existing apps already do."
   - `roles/app-engineer/prompt.md`의 blueprint 항목(`package.list`/`package.get` 문장 뒤): "To use another app's app-api, read its keys with `app.app_api` and declare them in the blueprint's `app_connections`."
6. agent credential 길(확인됨): tool `routes: [appAppApiIndex]` → `defineTool`의 `operations` → `roleOperations`가 `lophn`과 `app_engineer`의 상한에만 `app.app_api_index`를 넣고(`PLACE_READS`는 이 route를 모른다), 상한은 `agentRuntimePolicies`가 actor `agent` policy로 올린다. 그래서 `project_manager`·`operator` 자격에는 이 operation이 없다. App Engineer의 `conditions.app`은 그대로이고, 다른 앱의 problem·ticket·source·`app.get`은 지금처럼 `not_found`다.

## 끝남

- `deno task check`가 통과한다. `packages/core/main/agent-tools_test.ts`가 통과한다.
- 위험 test(둘):
  - `tool-lists_test.ts`: "app.app_api는 lophn과 App Engineer 목록에만 있다"
  - `blueprint/reads_test.ts`(새로 만든다): "App Engineer 자격은 다른 앱의 app-api 목록을 읽지만 다른 앱의 problem·ticket은 여전히 not_found다". 가짜 sql(앱 둘, 활성 blueprint loader는 가짜), `conditions.app` = 앱 A인 `agent:` 자격으로 `appApiIndex.handle`이 앱 B를 돌려주고, 같은 자격으로 진짜 `createTargetAuthorizer(ctx)`에 `problem.get`·`ListTickets` operation과 target `{ app: B }`를 주면 `not_found`임을 본다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`APP_TOOLS`·`TOOL_ORDER`가 조립한다). `registry.ts`와 `register.ts`는 이 task가 직접 고친다(한 줄씩).
- 안 쓰게 된 export
- 정한 것: 새 route를 둔 이유(기존 판정을 건드리지 않는 것이 가장 좁은 변경), `input`을 목록에서 뺀 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
