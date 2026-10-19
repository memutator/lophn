# de-tool-filter

agent의 tool 목록에 앱 tool을 싣는 규칙을 "project 사이"에서 "domain 사이"로 바꾼다. agent는 자기가 맡은 domain의 앱 tool을 모두 보고, 다른 domain의 tool은 `public`인 것만 본다(grant로 붙인 것에 한해). 그리고 agent tool 이름 접두를 `app__<app>__<tool>`에서 domain이 보이는 `domain__<domain>__<tool>`로 바꾼다.

- 단위: harness (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/{app-public,app-public_test,app-tools,app-toolkit}.ts`
  - `packages/core/lophn-agent/tools/app-api/`
  - `packages/core/lophn-agent/tool-judgment/tool-gate_test.ts`
  - `packages/protocol/lophn-agent/tool-catalog.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `tests/eval/versions/components.ts`
  - `tests/eval/checks/app/{calls,fixtures}.ts`
  - `tests/eval/scenarios/calendar/calendar-api.scenario.ts`
  - `tests/e2e/{operator,app-call}_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("다른 project 앱의 비공개 tool은 agent의 tool 목록에도 … 없다", "tool 목록은 session을 시작할 때 고정한다"), `project-docs/architecture/app-call.md`("agent에게는 앱 tool이 그대로 tool로 보인다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > domain 사이 장치", "agent tool 접두"
  - 본보기(코드): `packages/core/lophn-agent/tools/app-public.ts`(`withPublicOnly`), `app-public_test.ts`, `app-tools.ts`(`buildAppApiTools`), `app-api/name.ts`(`appApiToolName`), `main/agent-runtime/product-driver.ts`(79~105째 줄 근처 `withPublicOnly` 연결)
- 계약:
  - 쓰는 것: `AppTool.domain`(`de-tool-domain`이 더한 tool의 domain 이름), `domainList` read(machine 자격으로 `{owner: {kind: "app", id}}`를 주면 그 앱의 domain 이름과 id를 준다), `agentDefinitionRead`의 `place`와 `definition.domains`, `ResolvedAgent.domains`와 같은 규칙: 고른 domain이 없으면 그릇의 active domain 전부
  - 내놓는 것
    - `withPublicOnly(toolkit, deps)`의 `deps`가 `{machine, callerDomains(agent) → Promise<readonly string[] | null>, toolDomain(app, name) → Promise<string | null>}`가 된다. `appProject`는 없어진다. 읽지 못하면 null이고 null이면 그 tool은 비공개로 본다(막는 쪽으로 실패한다).
    - agent tool 이름: `domain__<domain 이름>__<tool 이름>`(`DOMAIN_TOOL_PREFIX = "domain__"`). 문자 규칙과 64자·hash 규칙은 지금과 같다(`appApiToolName`을 이 접두로 바꾼다). domain 이름은 전 domain에서 하나(`de-domain-core`)라 앱 id 없이 겹치지 않는다. 이름 → (앱, tool)은 계속 정의 목록이 안다(이름을 parse하지 않는다).

## 할 일

1. `protocol/lophn-agent/tool-catalog.ts`: `APP_API_TOOL_PREFIX = "app__"`를 `DOMAIN_TOOL_PREFIX = "domain__"`로 바꾸고 쓰는 곳(`app-api/name.ts`)을 따라 고친다. `protocol/apps/channel-values.ts`의 64자 주석(48째 줄)은 `de-names-tool`이 고친다(이 task가 건드리지 않는다).
2. `packages/core/lophn-agent/tools/app-api/name.ts`의 `appApiToolName(app, api)`를 `(domain, tool)` 인자로 바꾸고 `name_test.ts`를 맞춘다. `app-tools.ts`의 `buildAppApiTools`는 `view.app`이 아니라 `api.domain`으로 이름을 짓는다. tool 설명 머리는 `Domain <domain> of app <name> (<app id>), tool <tool>: <title>. <description>`이다.
3. `packages/core/lophn-agent/tools/app-public.ts`의 `withPublicOnly`: 호출한 agent의 domain 집합(`callerDomains`)과 tool의 domain id(`toolDomain`)를 대조한다. tool의 domain이 집합 안이면 그대로, 아니면 `public` tool만 남긴다. `callerDomains(agent)`는 `product-driver.ts`가 만든다: `placeOfAgentRef`가 place를 주면(PM·App Engineer) 그 place 그릇의 active domain id 전부, Operator는 `agentDefinitionRead`의 `place`와 `definition.domains`(고른 것 ∩ 그릇의 active domain, 비면 전부), lophn은 `[]`. `toolDomain(app, name)`은 `domainList`를 앱마다 한 번 읽어(`load` 안에서 캐시) 이름 → id로 바꾼다. 읽기가 실패한 앱·domain은 비공개로 둔다.
4. `main/agent-runtime/product-driver.ts`의 `withPublicOnly` 연결(`appGet`으로 앱의 project를 읽던 줄)을 위 두 함수로 바꾼다. `appGet` import와 `read.value.app.project` 읽기는 이 파일에서 없앤다.
5. 이름 문자열이 박힌 곳을 같이 고친다: `tool-judgment/tool-gate_test.ts`(16째 줄 `app__${APP}__notes.add`), `tests/eval/versions/components.ts`(41째 줄 `WORLD_TOOL` 정규식), `tests/eval/checks/app/{calls,fixtures}.ts`, `tests/eval/scenarios/calendar/calendar-api.scenario.ts`, `tests/e2e/{operator,app-call}_test.ts`. 문자열 접두와 비교 로직만 바꾼다(e2e는 돌리지 않고 새로 쓰지 않는다).
6. `app-public_test.ts`를 새 규칙으로 다시 쓴다. 옛 "project" 사례는 지운다.

## 알아 둘 것

- machine 자격으로 `domainList`를 읽는 길은 `de-turn-domains`가 `RUNTIME_MACHINE_ROUTES`에 연다. 이 task의 단위 test는 fake machine으로 돈다.

## 정한 것

- 같은 앱의 다른 domain tool도 그 agent의 domain 집합 밖이면 `public`만 본다. 앱이 같은 것은 보는 범위를 넓히지 않는다(경계는 domain이다).
- 접두를 `app__` 그대로 두고 domain을 그 뒤에 넣는 안(`app__<domain>__<tool>`)은 "앱이 보이는 이름"으로 읽혀 버리므로 쓰지 않았다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "domain D1만 고른 Operator의 tool 목록에는 D1의 비공개 tool이 있고, 같은 앱의 D2 비공개 tool과 다른 앱의 비공개 tool은 없다. public tool은 어느 domain 것이든 있다. place가 없는 lophn은 public만 본다. domain 이름을 읽지 못한 앱의 비공개 tool은 없다" — `packages/core/lophn-agent/tools/app-public_test.ts`
- 남지 않음: `grep -rn "appProject\|app__" packages/core/lophn-agent packages/core/main/agent-runtime packages/protocol/lophn-agent tests/eval/versions tests/eval/checks tests/eval/scenarios/calendar tests/e2e`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `APP_API_TOOL_PREFIX`
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
