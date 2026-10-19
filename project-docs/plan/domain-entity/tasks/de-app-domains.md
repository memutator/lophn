# de-app-domains

앱 tool의 `domain`을 읽는 쪽을 마저 한다. (1) release 준비 검사가 없는 domain을 거절하게 앱의 domain 목록을 넘긴다(`activation/desired.ts`, `blueprint.check`). (2) `app.app_api` tool이 다른 domain의 비공개 tool을 결과에서 뺀다. (3) package 주인을 project에서 앱으로 바꾼다(처음 publish한 앱이 주인이고, 다른 앱의 새 version은 거절한다. package는 앱 코드에서 publish되고 코드의 주인은 App Engineer다).

- 단위: apps (wave 2)
- 선행: de-apps-storage
- 소유(이 task만 고친다):
  - `packages/core/apps/agent-tools/{app,package}.ts`
  - `packages/core/apps/packages/{commands,commands_test,publish,reads,rows,schema,store,install_test}.ts`
  - `packages/protocol/apps/{packages,package-routes}.ts`
  - `packages/core/apps/blueprint/{check,reads,reads_test}.ts`
  - `packages/core/apps/releases/activation/desired.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(tool 선언), `project-docs/architecture/agent-definition.md`("다른 project 앱의 비공개 tool은 … `app.app_api` 결과에도 없다", "내장 SDK는 package tool이 설치 사본에서 읽는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `package-registry`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 앱 tool의 domain, domain 사이 장치"
  - 본보기(코드): `packages/core/apps/agent-tools/app.ts`의 `app.app_api`(100~120째 줄), `packages/core/apps/packages/{commands,publish,rows,reads,schema}.ts`의 `owner_project`, `packages/core/apps/blueprint/check.ts`, `releases/activation/desired.ts`의 `validateBlueprint`(150째 줄), `b5d25b573`(package 주인을 project로 둔 diff)
- 계약:
  - 쓰는 것: `validateBlueprint(value, { app, domains })`(`de-tool-domain`), `domainLookupPort`(`ofOwner`)와 `domainList` read, `ToolContext.domains`, `AppTool.domain`, `appGet`(package tool이 앱 이름을 읽는다)
  - 내놓는 것
    - `Package.owner_project`가 `owner_app: app_… | null`이 된다(`protocol/apps/packages.ts`, `package-routes.ts`, 표 `packages.owner_app`). `package.publish`의 입력은 바뀌지 않는다(주인은 publish한 앱이다).
    - `package.list`·`package.get` agent tool의 결과에 `owner_app`(앱 이름과 id)이 든다.

## 할 일

1. 검사에 domain 목록을 넘긴다: `blueprint/check.ts`의 `checkBlueprint(deps)`가 `deps.domainNamesOf(app) → Promise<Result<string[]>>`를 받아 `validateBlueprint(value, { app, domains })`로 부른다. 조립 `wiring/apps.ts`가 `ledger` snapshot으로 `domainLookupPort.ofOwner({kind: "app", id: app}, "active")`의 이름을 낸다. `releases/activation/desired.ts`의 `validateBlueprint(raw, { app: owner.app })`도 같은 목록을 준다(activation 직전 재검사. 목록을 읽지 못하면 `unavailable`). 목록이 비면(앱의 domain이 모두 보관됨) 모든 tool이 거절된다.
2. `agent-tools/app.ts`의 `app.app_api`: 앱 하나마다 `domainList`(`{owner: {kind: "app", id}}`)를 읽어 domain 이름 → id를 만들고(읽지 못하면 그 앱은 public tool만), tool의 domain id가 `ctx.domains`에 있을 때만 비공개 tool을 둔다. `projects` 맵과 `home` 계산(`ctx.place?.id`)은 없앤다. 설명 글에 "tools of other domains show only when public"을 한 줄 더한다. 이 file의 `app.create`와 `app.list`·`app.get`은 건드리지 않는다(`de-apps-unbind`가 `app.create`를 고친다).
3. package 주인: `apps/packages/`의 위 file들에서 `owner_project`를 `owner_app`으로 바꾼다(`schema.ts` 열, `rows.ts`, `commands.ts`의 "주인이 없으면 다음 publish한 앱이 갖는다, 다른 앱이면 `forbidden`", `reads.ts`, `publish.ts`의 `projectOf`는 없애고 publish한 앱 id를 그대로 주인으로 쓴다). 개발 data는 새로 만든다. `agent-tools/package.ts`는 `ownerOf(projects, …)` 대신 주인 앱 이름을 낸다(`appGet`·`appList`로 이름을 읽고 못 읽으면 id). `wiring/apps.ts`의 `publishPackage({ projectOf })`를 없앤다(`appProjectOf` import 제거). 다른 그릇에서 난 package bug는 주인 앱의 App Engineer에게 call한다는 안내는 `de-roles-text`의 몫이다.
4. 시험을 새 모양으로 고친다: `packages/core/apps/blueprint/reads_test.ts`, `packages/core/apps/packages/install_test.ts`가 `owner_project`를 보면 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "release 준비와 `blueprint.check`는 그 앱의 domain 목록에 없는 `domain`을 가진 tool이 있는 blueprint를 거절한다" — `packages/core/apps/blueprint/check_test.ts`(새 file) 또는 `releases` 쪽 test
  - "package 주인이 앱 A이면 앱 B가 낸 새 version은 `forbidden`이다. 주인이 없으면 첫 publish한 앱이 주인이 된다" — `packages/core/apps/packages/commands_test.ts`(새 file)
  - "`app.app_api`는 `ctx.domains`에 없는 domain의 비공개 tool을 결과에 싣지 않고 public tool은 싣는다" — `packages/core/apps/agent-tools/app_test.ts`(새 file)
- 남지 않음: `grep -rn "owner_project\|appProjectOf" packages/core/apps/packages/*.ts packages/core/apps/agent-tools packages/core/apps/blueprint packages/protocol/apps packages/core/main/daemon/wiring/apps.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 주인이 없는 package의 처리
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
