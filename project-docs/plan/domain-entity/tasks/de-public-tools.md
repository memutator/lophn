# de-public-tools

앱의 공개 tool을 둘러싼 장치의 단위를 "project 사이"에서 "domain 사이"로 맞춘다: 사용 관계(`app.usage`), 다른 domain이 쓰는 공개 tool을 지우는 release 막기(`activation.block`), `PublicToolsChanged` 알림이 대상이다. 쓰는 쪽은 부른 agent가 고른 domain(안 고르면 그릇의 domain 전부)이고, 쓰이는 쪽은 tool의 `domain`이다. 같은 domain 안의 사용은 사용 관계로 세지 않는다.

- 단위: apps (wave 2)
- 선행: de-apps-storage, de-routing-events
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/{public-tools,public-tools_test,commands}.ts`
  - `packages/core/apps/usage/`
  - `packages/protocol/apps/usage.ts`
  - `packages/core/main/daemon/wiring/apps-usage.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/activation.md`("새 release가 다른 project가 쓰는 공개 tool을 지우면 …", "`PublicToolsChanged`"), `project-docs/architecture/app-call.md`, `project-docs/architecture/agent-definition.md`("lophn의 place 정보에는 project 지도가 실린다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > domain 사이 장치", `project-docs/products/roadmap/domain.md`의 "program이 맡는 것 > domain 사이"
  - 본보기(코드): `packages/core/apps/releases/public-tools.ts`(`diffTools`, `removedPublicOf`, `blockedToolsOf`, `changeNoticesOf`), `apps/usage/users.ts`(`appToolUsers`), `main/daemon/wiring/apps-usage.ts`(`portsOf`), `apps/releases/commands.ts`의 `activationBlock`(275~300째 줄)·`completeActivation`(375~395째 줄)
- 계약:
  - 쓰는 것: `domainLookupPort`(`packages/protocol/domains/ports.ts`, tx·snapshot 둘 다), `AppTool.domain`(tool의 domain 이름, `ToolDeclaration.domain`), reader Worker가 읽는 Operator 정의 file의 `domains`, `NewWorkDeps.agentOfDomain`(`de-routing-events`)
  - 내놓는 것
    - `app.usage`(`packages/protocol/apps/usage.ts`): `appToolUseSchema = {app, tool, domain, source}`. `domain`은 **쓰는 쪽** domain id다. tool 자신의 domain과 같은 사용은 싣지 않는다.
    - `UsagePorts`(`apps/usage/ports.ts`): `sessionDomains(session) → {role, domains: string[]} | null`(session의 agent가 맡은 domain id. lophn은 `[]`), `agentDomains(agent) → string[]`(PM·App Engineer는 그 그릇의 active domain 전부, Operator는 정의의 `domains`와 그릇의 교집합이고 비면 전부, lophn은 `[]`), `domainOf(app, name) → string | null`(그 앱의 domain 이름 → id). 이전의 `sessionPlace`·`agentProject`는 없어진다.
    - `protocol/events/domain.ts`의 `publicToolsChanged` payload: `{release, domain, change: "changed" | "blocked", tools}`. subject는 그대로 앱이다. domain은 **깨울 domain**(그 owner의 PM 또는 App Engineer가 받는다)이다.

## 할 일

1. 사용 관계: `usage/users.ts`의 `appToolUsers`는 `ToolUser = {tool, domain, source}`를 낸다. grant 쪽: 앱을 할당받은 agent(`appGrantees`)마다 `agentDomains(agent)`의 각 domain이, 그 앱의 `public` tool(빼지 않은 것) 가운데 tool 자신의 domain이 아닌 것을 쓰는 것으로 센다. invocation 쪽: tool을 부른 agent session마다 `sessionDomains(session)`의 각 domain이 같은 규칙으로 센다. `usage/reads.ts`는 lophn session만 읽게 하는 검사와 정렬을 `domain`으로 맞춘다.
2. `wiring/apps-usage.ts`의 `portsOf`: `sessionDomains`·`agentDomains`·`domainOf`를 꽂는다. session의 agent가 Operator면 정의 file의 `domains`를 읽는다(reader Worker 안이라 동기 file 읽기가 된다. `lophn-agent/agents/mod.ts`의 `openAgentContext`·`loadAgent`를 쓰고 `lophn-agent-registration.ts`가 file adapter를 URL로 여는 방식을 따른다). 그릇의 domain 목록은 `packages/core/domains/lookups.ts`의 `domainsOfOwner`다.
3. 막기와 알림: `releases/public-tools.ts`의 `blockedToolsOf`·`changeNoticesOf`가 위 사용 관계를 쓴다. 막을 때(지운 공개 tool 가운데 다른 domain이 쓰는 것) 알림은 **그 tool들의 domain마다 하나**(`change: "blocked"`)다. 바뀐 뒤 알림(`changeNoticesOf`)은 (a) 바뀐 tool 전부를 그 tool의 domain별로 묶어 그 domain에, (b) 다른 domain이 쓰는 바뀌거나 지워진 공개 tool을 쓰는 domain마다 그 tool들만 보낸다. `diffTools`의 비교 재료는 입력·출력 schema, effect, public, **domain**이다. tool의 domain 이름은 `domainOf(app, name)`으로 id가 된다(`tx.port(domainLookupPort).ofOwner({kind: "app", id})`). 읽기에 실패하면 막는 쪽(fail closed)이다. `commands.ts`의 `activationBlock`·`completeActivation`은 payload `{release, domain, change, tools}`로 `tx.emit(publicToolsChanged, …)`한다. `appProjectOf`는 이 file에서 더 쓰지 않는다.
4. `commands.ts`의 release 준비(`validateBlueprint(input.blueprint, { app })`, 562째 줄 근처)가 `domains` option에 그 앱의 active domain 이름 목록을 준다(`ofOwner`로 읽는다. 앱의 domain 읽기에 실패하면 `unavailable`). 목록에 없는 domain의 tool이 있으면 `invalid_input`이다. (다른 두 호출 `activation/desired.ts`·`blueprint/check.ts`는 `de-app-domains`가 한다.)
5. `protocol/events/domain.ts`의 `publicToolsChanged`만 위 payload로 고친다. `events/reactor/session-opening.ts`의 `PublicToolsChanged` case를 고친다: 받는 쪽은 `await deps.agentOfDomain(event.payload.domain)`이고 body 글의 "other projects use"를 "other domains use"로 바꾼다. 두 file은 `de-kinds-domain`과 `de-routing-events`도 만지므로 소유로 선언하지 않았다. `PublicToolsChanged` 줄만 고치고 충돌은 lead가 푼다(둘 다 한 event의 정의·case만 다르다).
6. `public-tools_test.ts`를 새 규칙으로 다시 쓴다(옛 project 사례는 지운다). `usage` test가 있으면 같이.

## 정한 것

- 한 agent가 여러 domain을 맡으면 그 domain마다 사용으로 센다(알림도 domain마다 간다). 같은 owner에게 알림이 여러 번 갈 수 있지만 reactor의 idempotency가 event 단위라 겹치지 않는다.
- 첫 activation(이전 active release가 없음)은 막지도 알리지도 않는다(그대로).

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "다른 domain이 쓰는 공개 tool을 지우는 release는 막힌다. 같은 domain만 쓰는 공개 tool이나 쓰는 쪽이 없는 tool을 지우는 release는 막히지 않는다" — `packages/core/apps/releases/public-tools_test.ts`
  - "사용 관계는 자기 domain의 사용을 세지 않고, 고른 domain이 하나인 Operator는 그 domain만 쓰는 쪽으로 센다" — `packages/core/apps/usage/users_test.ts`(새 file)
- 남지 않음: `grep -rn "appProjectOf\|\.project\b" packages/core/apps/usage packages/core/apps/releases/public-tools.ts packages/core/main/daemon/wiring/apps-usage.ts`가 0줄이다. `grep -n "appProjectOf" packages/core/apps/releases/commands.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `UsagePorts.sessionPlace`·`agentProject`
- 정한 것
- 넘길 줄: `UsagePorts`·`app.usage` shape 때문에 최소로 고친 file:줄(`agent-roles/place/place-data.ts`의 lophn 지도 읽기를 포함한다. 이 줄은 `de-place-info`가 다시 쓴다)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
