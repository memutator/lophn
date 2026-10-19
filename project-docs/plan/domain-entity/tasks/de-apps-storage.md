# de-apps-storage

앱 저장 자리를 `<data>/projects/<prj>/app/`에서 예전 `<data>/apps/<app>/`로 되돌린다(`data/`, `bundles/<hash>/`, `staging/`, `preview/<nonce>/`, 기본 source `source/`). 저장 자리를 만드는 모든 곳이 project id 대신 앱 id를 받는다. `domain-tools`의 preview 고침(폴더 밖 쓰기 막기, `..` 거절)은 그대로 둔다. `App.project` 칸 자체를 없애는 일은 마지막 `de-apps-unbind`가 한다(이 task는 `appProjectOf`를 쓰지 않게만 한다).

- 단위: apps (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/app-storage.ts`
  - `packages/protocol/apps/activation/data-job.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/data/`
  - `packages/core/apps/preview/`
  - `packages/core/apps/permissions/sandbox-boundary_test.ts`
  - `packages/core/apps/runtime/{control-protocol,supervisor-link}.ts`
  - `packages/core/apps/releases/{commands,finalizer,preparation}.ts`
  - `packages/core/apps/releases/activation/{assembly,desired,handler}.ts`
  - `packages/core/apps/releases/bundle/{read,seal}.ts`
  - `packages/core/apps/releases/prepare/{flow,from-source}.ts`
  - `packages/core/apps/releases/worker/run.ts`
  - `packages/core/install-and-update/data-root.ts`
  - `packages/core/main/app-supervisor/{data-runner,preview-broker,release-runner}.ts`
  - `packages/core/main/worker/release-job.ts`
  - `packages/core/main/daemon/wiring/{apps,apps-tickets}.ts`
  - `packages/core/problems/grouping/commands.ts`
  - `packages/core/problems/repairs/more.ts`
  - `packages/core/problems/reporting/worker/collector.ts`
  - `packages/core/problems/snapshots/{source-map,work,work_test}.ts`
  - `packages/core/problems/tests/{commands,control,examples-request,runner}.ts`
  - `packages/core/problems/tests/work/runner-service.ts`
  - `tests/support/coding/prepare-deps.ts`
  - `tests/support/app/activate.ts`
  - `tests/eval/checks/app/observe.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`("preview는 따로 띄운 process와 일회용 DB로 돈다"), `project-docs/architecture/activation.md`, `project-docs/architecture/coding-agent.md`("source 폴더가 없는 앱은 맡길 때 core가 만든다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-runtime`, `app-data`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기 > 앱", `project-docs/products/change-log/0.5.0.md`의 "앱을 project 하나에 묶고…" 항목
  - 본보기(git): `9a18bd8af`(저장 자리를 옮긴 diff. 거꾸로 적용), `864bc084a`(problems가 읽는 자리), `c55d0f954`의 `tests/support/app/activate.ts`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것(다른 task가 쓰는 모양)
    - `packages/protocol/apps/app-storage.ts`의 함수들은 이름을 지키고 인자가 **앱 id**가 된다: `appFolder(dataRoot, app)` = `<data>/apps/<app>`, `appDataFolder`, `appBundleCopy(dataRoot, app, bundleHash)`, `appStagingFolder`, `appPreviewFolder(dataRoot, app, nonce)`, `appDefaultSource`. 인자가 `appIdSchema`에 맞지 않으면 던진다(project id를 넘기면 바로 드러난다).
    - 준비 job·activation data job·supervisor `releasePrepare`의 `project` 칸이 없어진다(`app`이 이미 있다).
    - 데이터 root는 다시 `apps` 폴더를 0700으로 만든다(`DataRoot.apps`).

## 할 일

1. `app-storage.ts`와 `data-job.ts`를 위 계약으로 되돌린다. `9a18bd8af`를 거꾸로 적용하되 `appFolder`류 helper는 지우지 않고 인자와 경로만 바꾼다(단일 helper를 유지하는 쪽이 옛 흩어진 `previewDirectory`·`bundleCopyPath` 규칙보다 낫다). `install-and-update/data-root.ts`의 `MANAGED`와 `DataRoot.apps`가 돌아온다.
2. 호출하는 쪽을 모두 앱 id로 옮긴다: `apps/control.ts`, `routes.ts`(project 읽기 대신 app), `preview/{area,flags,model,service,mod}.ts`와 `flags_test.ts`(영역이 `apps/<app>/preview/<nonce>`인지 보는 검사), `data/worker/run.ts`, `runtime/{control-protocol,supervisor-link}.ts`, `releases/**`의 위 file들, `main/app-supervisor/*`, `main/worker/release-job.ts`, `main/daemon/wiring/{apps,apps-tickets}.ts`의 `appProjectOf` 연결과 `testOf(project, …)` 인자.
3. `problems/` 쪽 읽기: bundle 사본은 `<data>/apps/<app>/bundles/<hash>`다. `collector.ts`(966째 줄 근처 `projects/*/app/bundles/<hash>` 탐색)는 `apps/*/bundles/<hash>` 탐색으로, `snapshots/source-map.ts`·`work.ts`, `packages/core/problems/tests/{commands,control,examples-request,runner}.ts`, `packages/core/problems/tests/work/runner-service.ts`, `grouping/commands.ts`, `repairs/more.ts`가 `864bc084a`의 역이다.
4. 앱 process의 sandbox 경계를 되돌린다: `apps/permissions/sandbox-boundary_test.ts`의 보호 root와 "자기 앱 밖은 못 연다" 사례가 `<data>/apps/<app>/…`(자기 앱의 data·bundle·source) 기준이다. 이 test는 위험 test다(아래).
5. `tests/support/app/activate.ts`·`tests/support/coding/prepare-deps.ts`·`tests/eval/checks/app/observe.ts`: 앱을 만들거나 저장 자리를 계산하는 줄을 앱 id 기준으로 맞춘다(앱 만들기의 `project` 인자는 이 task가 건드리지 않는다. `de-apps-unbind`가 푼다).
6. `appProjectOf`를 부르던 저장 자리 줄은 모두 없앤다(저장 자리는 앱 id만으로 정해진다). `appProjectOf` 정의(`apps/lookups.ts`)는 지우지 않는다. 단 `releases/commands.ts`의 `activationBlock`·`completeActivation`이 `PublicToolsChanged`를 낼 때 읽는 `appProjectOf`(289째·384째 줄 근처)와 `main/daemon/wiring/apps.ts`의 package 주인 `projectOf`(323째 줄)는 `de-public-tools`의 몫이라 건드리지 않는다.

## 정한 것

- 기본 source 자리는 `<data>/apps/<app>/source`다(`appDefaultSource`). 사람이 이은 source 폴더는 그대로다.
- 개발 data는 새로 만든다. 옛 `<data>/projects/<prj>/app/`을 옮기는 일은 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "앱 process의 sandbox가 자기 앱 폴더(`<data>/apps/<자기 app>/data`)만 열고 다른 앱의 data·source와 플랫폼 파일은 열지 못한다" — `packages/core/apps/permissions/sandbox-boundary_test.ts`
- 남지 않음:
  - `grep -rn "/app/data\|/app/bundles\|/app/staging\|/app/preview\|/app/source" packages tests tools`가 0줄이다.
  - `grep -rn "appProjectOf" packages/core/apps/control.ts packages/core/apps/routes.ts packages/core/apps/preview packages/core/apps/releases/finalizer.ts packages/core/apps/releases/activation packages/core/apps/releases/bundle packages/core/main/app-supervisor packages/core/main/worker packages/core/problems`가 0줄이다(`apps/lookups.ts` 정의, `releases/public-tools.ts`·`usage/`·`tickets/`·`wiring/apps.ts`의 package 주인 줄은 다른 task가 푼다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `appProjectOf`를 쓰던 import
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
