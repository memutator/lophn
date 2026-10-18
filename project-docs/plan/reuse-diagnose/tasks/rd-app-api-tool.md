# rd-app-api-tool

다른 앱의 app-api 목록(key, label, description, effect, input)을 읽는 tool `app.app_api`를 lophn과 App Engineer에게만 준다. App Engineer 자격은 자기 앱 하나에 묶여 있어 지금 `app.app_api` route가 다른 앱을 not_found로 답하므로, route handler도 agent 자격에 한해 연다.

- 단위: rd-app-api (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/apps/blueprint/reads.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/agent-roles/roles/lophn/prompt.md`
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "다른 앱의 app-api를 agent가 볼 tool이 없다"(정한 것: lophn과 App Engineer만 본다, 사람)
  - architecture: `project-docs/architecture/agent-definition.md`의 "role의 tool 목록은 코드가 고정하고…"(목록과 정의가 짝이어야 한다), "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다"; `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `app-releases`
  - 코드에서 확인된 사실(읽고 시작한다): `packages/core/storage/ledger/target-authorization.ts`와 `packages/core/server/identity/model.ts`의 `authorize` — App Engineer 자격(`conditions.app` = 자기 앱)은 `target.app`이 다른 앱이면 `not_found`다. `app.get`도 같은 이유로 다른 앱을 못 본다. 그러니 `app.app_api` handler(`blueprint/reads.ts`)의 `authorizeApp`이 App Engineer에게는 다른 앱을 막는다.
- 계약:
  - 쓰는 것: route `app.app_api`(`packages/protocol/apps/blueprint/read.ts`의 `appAppApi`). 모양은 바꾸지 않는다.
  - 내놓는 것:
    - tool `app.app_api`: input `{ app: idSchema("app") }`, effect `read`, `routes: [appAppApi]`. 출력 `{ app, name, release, app_api: [{ key, label, description, effect, input }] }`(`project_scope`·screens·declarations·evidence는 싣지 않는다). active release가 없으면 route의 `not_found`를 그대로 낸다.
    - role 목록: `app.app_api`는 `lophn`과 `app_engineer`의 `builtinToolNames`에만 있다. `project_manager`·`operator`에는 없다.
    - route 규칙: `app.app_api`는 agent 자격이면 앱 범위 판정(`authorizeApp`)을 건너뛴다. `coding_agent`(자기 앱에 묶인 token)와 그 밖의 자격은 지금 판정 그대로다.

## 할 일

1. `agent-tools/app.ts`의 `APP_TOOLS`에 `app.app_api`를 더한다. 설명: "Read the app-api of one app's active release: key, label, description, effect and input. Use it to see what an app already does and to get the exact keys for blueprint app_connections." (`visual.show`가 이미 같은 route를 읽는다.)
2. `blueprint/reads.ts`의 `appApi.handle`에서 `parseActor(ctx.actor)?.kind === "agent"`이면 `authorizeApp`을 부르지 않는다. 주석에 이유를 쓴다: 다른 앱의 app-api 목록은 lophn과 App Engineer만 본다고 사람이 정했고, 모델이 route를 직접 고르지 못하며 tool 목록이 그 둘에만 이 tool을 주기 때문이다. 이 handler 밖의 읽기(`app.get`, `app.list`)는 건드리지 않는다.
3. `tool-lists.ts`: `APP_API_TOOLS = ["app.app_api"]`를 만들고 `builtinToolNames`가 `role === "lophn" || role === "app_engineer"`일 때만 넣는다. `TOOL_ORDER`에 `"app.get"` 바로 뒤에 `"app.app_api"`를 넣는다. 이유: 읽기 tool은 모든 role이 갖지만 이것만 사람이 두 role로 좁혔다.
4. 지침(영어, 줄 하나씩만):
   - `roles/lophn/prompt.md`의 "Read `app.list`, `app.get` and `package.list` before you conclude that nothing fits." 문장 뒤에 이어서: "For an app that may already do the work, read its app-api with `app.app_api`."
   - `roles/app-engineer/prompt.md`의 blueprint 항목(`package.list`/`package.get` 문장 뒤)에: "To use another app's app-api, read its keys with `app.app_api` (lophn gives you the app ID) and declare them in the blueprint's `app_connections`."
   - 계획 `prompt-text`가 이 두 file을 먼저 고쳤다. 지금 file을 읽고 그 문장 옆에 맞춰 넣는다.
5. 위험 test 둘(아래).
6. agent credential 길(확인됨): tool `routes: [appAppApi]` → `defineTool`의 `operations` → `roleOperations`가 role 상한에 `app.app_api`를 넣는다. 이미 `PLACE_READS`(`credentials.ts`)가 모든 role에 `appAppApi.name`을 주고 있어 상한은 더 넓어지지 않는다. role마다 다른 것은 tool 목록뿐이고, 목록 밖 tool은 정의에도 실행에도 없다.

## 끝남

- `deno task check`가 통과한다. `packages/core/main/agent-tools_test.ts`(목록의 이름마다 정의가 있고 정의마다 목록이 있다)가 통과한다.
- 위험 test(둘, 이름은 결과 한 문장):
  - `tool-lists_test.ts`: "app.app_api는 lophn과 App Engineer 목록에만 있다"
  - `blueprint/reads_test.ts`(새로 만든다): "agent 자격은 다른 앱의 app-api를 읽고, 자기 앱에 묶인 coding agent 자격은 읽지 못한다". 가짜 sql(apps 행 하나)과 가짜 `load`, 진짜 `createTargetAuthorizer`(snapshot의 TargetAuthorization port)를 쓴다. 자격 둘: `agent:<session>` + `conditions.app` = 다른 앱(App Engineer), `coding_agent:<session>` + `conditions.app` = 다른 앱.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`APP_TOOLS`와 `TOOL_ORDER`가 조립한다)
- 안 쓰게 된 export
- 정한 것: 출력에서 `project_scope`를 뺀 것, 목록이 role 둘로 좁혀진 이유
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: App Engineer는 `app.list`가 자기 앱만 돌려주므로 다른 앱의 ID를 스스로 찾지 못한다(lophn이 `call`로 ID를 준다). 이것을 보고에 그대로 적는다.
