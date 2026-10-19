# dp-public-filter

다른 project 앱의 비공개 tool이 agent의 tool 목록과 `app.app_api` 읽기 tool에 나오지 않게 한다. 같은 project의 agent는 그 앱의 tool을 다 보고, 다른 project의 agent(lophn 포함)는 `public` tool만 본다. 걸러내는 곳은 `domain-tools`가 소유한 `app-tools.ts`·`app-toolkit.ts` 밖이다: toolkit을 감싸는 새 file과 그것을 꽂는 `product-driver.ts`다.

- 단위: public-tools (wave 3)
- 선행: 없음. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 알려 준 뒤 띄운다. `domain-tools`가 toolkit의 모양(`createAppApiToolkit`, `AppApiTool`)을 바꿨으면 이 task가 그 모양을 따른다. `app-tools.ts`·`app-toolkit.ts`·`app-api/`는 읽기만 한다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/app-public.ts` (새 file)
  - `packages/core/lophn-agent/tools/app-public_test.ts` (새 file)
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/protocol/apps/apps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/agent-definition.md`(tool 목록은 session을 시작할 때 고정, role 고정 목록과 grant)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 다른 project의 tool", `project-docs/products/roadmap/domain.md`의 "MCP server와 경계, 여러 domain을 쓰는 agent"
  - 쓰기 전: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `AppApiToolkit`·`AppApiTool`(`packages/core/lophn-agent/tools/app-toolkit.ts`, `app-tools.ts`. 읽기만), `appAppApi`의 tool 선언과 `public` 칸(`domain-tools` 계약), 앱 record의 `project`(`dp-app-project`)
  - 내놓는 것: `withPublicOnly(toolkit, deps)`(`app-public.ts`): `AppApiToolkit`를 감싸 `define(agent, place)`가 돌려주는 목록에서 "앱의 project가 agent의 place project와 다르고 그 tool이 `public`이 아닌 것"을 뺀다. place가 없는 agent(lophn)는 모든 앱을 다른 project로 본다.

## 할 일

1. `packages/protocol/apps/apps.ts`: `appGet`·`appList`의 `readActors`에 `machine`을 더한다(`product-driver`가 machine 자격으로 앱의 project를 읽는다). `packages/core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`(68째 줄)에 `app.get`을 더한다(`app.app_api`는 toolkit이 이미 쓰니 목록에 있는지 본다. 빠지면 unit과 core 기동은 통과하고 turn이 `configuration_unavailable`로 끝난다).
2. `app-public.ts`: `withPublicOnly`를 쓴다. 감싸는 쪽은 toolkit이 돌려준 `AppApiTool[]`마다 `app`의 project(machine `appGet`)와 그 tool의 `public`(machine `appAppApi`)을 읽어 거른다. 앱 하나는 turn당 한 번만 읽는다(같은 `define` 호출 안 캐시). 앱 project를 읽지 못하면 그 앱의 tool은 뺀다(막는 쪽으로 실패한다).
3. `product-driver.ts`의 `productToolkit`(65~83째 줄): `appApi: createAppApiToolkit({…})`를 `appApi: withPublicOnly(createAppApiToolkit({…}), { machine })`로 감싼다.
4. `packages/core/apps/agent-tools/app.ts`의 `app.app_api` tool: 결과의 앱마다 그 앱의 project가 호출 agent의 place project와 다르면 `public`이 아닌 tool을 뺀다(입력에 앱을 지정한 경우도 같다). 호출 agent의 place는 `ctx.place`다. 앱의 project는 `appList` 읽기로 얻는다(`routes`에 `appList`를 더한다). `app.get`·`app.list`는 이 task가 바꾸지 않는다(앱 이름과 목적은 지도에도 있다).
5. 위험 test를 쓴다(아래). `app-public_test.ts` 한 file.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "다른 project 앱의 비공개 tool은 agent의 app-api tool 목록에 없고, 같은 project 앱의 tool은 비공개여도 있다. place가 없는 agent(lophn)는 공개 tool만 본다." fake machine(앱 두 개, 한 project씩)으로 `define`을 부른다.
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 앱 project를 못 읽으면 tool을 뺀다 / `app.get`·`app.list`는 거르지 않는다(이름·목적은 공개 지도의 재료다)
- 넘길 줄: 거르기를 `app-toolkit.ts` 밖(`product-driver`의 감싸기)에서 했다. `domain-tools`가 toolkit을 바꿨으면 합칠 때 감싸기만 맞추면 된다
- 계약 바꾸기 요청
- **무겁게 짠 것**: turn마다 앱당 읽기가 두 번 늘어난다. 줄인다면 `domain-tools`가 `AppApiView`에 project를 싣게 한다
- **알려진 미완 동작**: 이미 session에 고정된 tool 목록은 session 도중 grant가 바뀌어도 그대로다(지금 규칙)

## lead가 더함

- `domain-tools`의 `dt-agent-tools`(main `b729bc5d5`)가 toolkit에서 place를 지웠다. `define(agent: AgentRef)`이고 `AppApiSource.place`는 없다. agent tool 입력은 `toolInput`이다. 위 "계약"과 할 일 2의 `define(agent, place)`는 이 모양으로 읽는다.
- 그래서 호출 agent의 project는 toolkit에서 받지 못한다. turn의 agent와 place에서 얻는다. PM은 `AgentRef.project`, Operator는 정의의 place(resolved agent나 `ctx.place`), lophn은 없음(모든 앱을 다른 project로 본다). `define`을 부르는 자리에서 place를 얻을 수 있으면 `withPublicOnly`가 그것을 받는다. 길을 고른 이유를 보고의 "정한 것"에 적는다.
