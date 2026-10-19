# dp-app-project

앱 record에 필수 `project` 칸을 더하고 project 하나에 앱 하나(1:1)로 묶는다. `app.create`가 project를 받고, 앱 저장 자리 규칙(`<data>/projects/<prj>/app/`)을 순수 함수 한 곳에 계약으로 둔다. wave 2의 place 합치기와 저장 자리 옮기기가 이 task의 `project` 칸과 조회에 기댄다.

- 단위: app-binding (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/apps.ts`
  - `packages/protocol/apps/app-storage.ts` (새 file)
  - `packages/core/apps/registration/`
  - `packages/core/apps/lookups.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/apps/blueprint/reads_test.ts`
  - `packages/core/problems/tests/request-ports_test.ts`
  - `tests/support/app/activate.ts`
  - `tests/eval/restore/apps.ts`
  - `tests/eval/restore/call.ts`
  - `tests/eval/restore/active-app.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/layers.md`(domain끼리 `apps → projects`는 안 된다. 그래서 project 확인은 port로 건네받는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `projects`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 앱과 project", `project-docs/products/roadmap/domain.md`의 "role"
- 계약:
  - 쓰는 것: `packages/protocol/projects/values.ts`의 `projectIdSchema`, `packages/protocol/projects/project-api.ts`의 `projectApi`(읽기 `projectList`)
  - 내놓는 것(다른 task가 기댄다):
    - `App.project: Id<"prj">`(필수). `appCreate` 입력의 `project`(필수), `AppCreated` event payload의 `project`, `AppRegistration`(`appRegistrationLookup`이 주는 값)의 `project`.
    - `packages/core/apps/lookups.ts`: `appProjectOf(sql, app): string | null`, `appOfProject(sql, project): string | null`(보관한 앱도 센다).
    - `packages/protocol/apps/app-storage.ts`의 순수 함수(모두 `(dataRoot, project, ...)`를 받고 project id 모양을 검사해 data root 밖으로 나가는 값을 거절한다):
      - `appFolder(dataRoot, project)` = `<dataRoot>/projects/<project>/app`
      - `appDataFolder`(`…/app/data`), `appBundleCopy(…, bundleHash)`(`…/app/bundles/<hash>`), `appStagingFolder`(`…/app/staging`), `appPreviewFolder(…, nonce)`(`…/app/preview/<nonce>`), `appDefaultSource`(`…/app/source`)
    - tx port `appProjectLookupPort`(새 file `packages/core/apps/registration/ports.ts`): `get(project): { status: "active" | "archived" } | null`. 구현은 lead가 `packages/core/main/daemon/wiring/apps.ts`에서 `packages/core/projects/registry/mod.ts`의 `projectInfoOf`(`archived` 칸이 있다. `core/main/daemon/wiring/lophn-agent-registration.ts`의 `projects.project`가 같은 식으로 쓴다)로 꽂는다(보고의 "등록할 것").

## 할 일

1. `packages/protocol/apps/apps.ts`: `appFields`에 `project: projectIdSchema`, `appCreateInputSchema`에 `project`, `appCreated` payload에 `project`, `appRegistrationSchema`에 `project`를 더한다.
2. `packages/protocol/apps/app-storage.ts`를 새로 만든다(위 "내놓는 것"). 옛 `apps/<app>/…` 규칙은 이 task가 지우지 않는다(쓰는 곳이 wave 2의 저장 자리 task에서 바뀐다).
3. `packages/core/apps/registration/schema.ts`: `apps`에 `project TEXT NOT NULL`을 더하고 `CREATE UNIQUE INDEX apps_project ON apps(project)`를 둔다. `apps_no_identity_change` trigger가 `project` 변경도 막게 한다(`BEFORE UPDATE OF id, slug, project`). 개발 data는 새로 만드는 것이 규칙이라 step을 고치고 migration을 만들지 않는다. 보관한 앱도 project를 계속 점유한다(unique에 status 조건을 두지 않는다).
4. `rows.ts`의 `appFromRow`, `store.ts`의 `insertApp`·`replaceApp`(project는 UPDATE에서 바꾸지 않는다), `lookup.ts`의 SELECT 칸 목록에 `project`를 맞춘다.
5. `commands.ts`의 `create`: candidate에 `project`를 담는다. 새 port로 project를 확인한다 — 없으면 `not_found`("project not found"), 보관됐으면 `conflict`, 그 project에 앱이 이미 있으면 `conflict`("project already has an app"). `appCreated` event에 `project`를 싣는다.
6. `packages/core/apps/lookups.ts`에 `appProjectOf`, `appOfProject`를 더한다.
7. `packages/core/apps/agent-tools/app.ts`의 `app.create` tool: 입력에 `project`(project 이름 또는 id, nonblank)를 더하고 `routes`에 `projectList`를 더한다. 이름이면 `projectList`를 읽어 id로 푼다(`packages/core/agent-roles/tools/operator.ts`의 `resolvePlace`가 같은 식). 못 찾으면 `not_found`로 돌려준다. 설명문은 "앱은 그 project에 묶이고 project마다 앱은 하나이며 그 project의 Project Manager가 맡는다"로 고친다("The app gets its own App Engineer"는 지운다). project 등록은 이 tool이 하지 않는다(사람만, `project.create`의 actor는 `user`).
8. 호출처를 고친다: `tests/support/app/activate.ts`, `tests/eval/restore/{apps,call,active-app}.ts`는 앱을 만들기 전에 project를 사람 자격으로 등록한다(`projectApi.register`, 지금 규칙대로 임시 폴더 하나). apps 표를 직접 만드는 `packages/core/apps/blueprint/reads_test.ts`(20째 줄)와 `packages/core/problems/tests/request-ports_test.ts`(33째 줄)의 INSERT에 `project`를 맞춘다.
9. 위험 test(아래)를 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "같은 project에 앱을 두 번 만들면 `conflict`이고, 없는 project나 보관한 project로는 앱을 못 만든다." 한 file(`packages/core/apps/registration/`)에 둘 이하로 쓴다. 다른 core/apps test의 방식(sqlite 메모리 + 가짜 port)을 따른다.
- 남지 않음: `grep -rn "The app gets its own App Engineer" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/apps/mod.ts`에 `app-storage.ts` export, `packages/core/main/daemon/wiring/apps.ts`에 `appProjectLookupPort` 구현
- 안 쓰게 된 export
- 정한 것: (예) 보관한 앱도 project를 점유한다 / 없는 project는 `not_found`
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
