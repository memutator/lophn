# de-apps-unbind

앱과 project의 1:1을 푼다. `App.project` 칸, `app.create`의 `project` 입력, project unique 규칙, `appProjectOf`·`appOfProject`를 지운다. 앱을 만들면 그 앱 이름의 domain이 같은 tx에서 하나 같이 만들어진다(domain이 0개인 앱은 없다). 앞 wave의 task들이 이미 `appProjectOf`를 쓰지 않게 했으므로 이 task는 정의를 지우고 남은 fixture를 고친다.

- 단위: apps (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/apps.ts`
  - `packages/core/apps/registration/`
  - `packages/core/apps/lookups.ts`
  - `packages/core/apps/register.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/apps/permissions/app-grants_test.ts`
  - `packages/core/problems/tests/request-ports_test.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
  - `tests/e2e/`
  - `tests/eval/restore/{active-app,apps,call}.ts`
  - `tests/support/app/activate.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(domain module은 서로 import하지 않는다. tx port로 잇는다), `project-docs/architecture/kinds.md`("앱 domain은 대개 kind 없이 tool로 다룬다"), `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 앱의 domain, 되돌리기 > 앱", `project-docs/products/change-log/0.5.0.md`의 "앱을 project 하나에 묶고…"
  - 본보기(코드): `packages/core/apps/registration/{commands,schema,store,rows,lookup,ports}.ts`, `apps/agent-tools/app.ts`의 `app.create`, `main/daemon/wiring/lophn-agent-registration.ts`(`appProjectLookupPort`을 꽂은 곳), `a226d53be`(앱을 project에 묶은 diff를 거꾸로 읽는다)
- 계약:
  - 쓰는 것: `domainProvisioningPort`(`packages/protocol/domains/ports.ts`, `create({name, title, purpose, owner}) → Result<{id}>`. 같은 tx 안에서 부른다), `ownerLookupPort`는 domain 쪽 것이다
  - 내놓는 것
    - `App`(`packages/protocol/apps/apps.ts`)에 `project`가 없다. `AppRegistration`·`appCreateInputSchema`·`appFields`·`AppCreated` payload도 그렇다.
    - `app.create` command: 입력 `{id?, slug, name, description, planning_version?}`. 성공하면 같은 tx에서 domain `{name: slug, title: name, purpose: description, owner: {kind: "app", id}}`가 생긴다. 그 이름의 domain이 이미 있으면 `conflict`이고 앱도 만들어지지 않는다.
    - agent tool `app.create`: 입력 `{name, purpose}`(project 없음).

## 할 일

1. `apps/registration/schema.ts`: `project` 열, `apps_project` unique index, trigger의 `project`를 지운다(`schema step`을 고친다. migration을 만들지 않고 개발 data는 새로 만든다). `rows.ts`·`store.ts`·`lookup.ts`·`commands.ts`·`mod.ts`에서 `project`를 지우고 `appProjectLookupPort`(`ports.ts`)와 그 export를 없앤다. `commands.ts`의 `create`는 `authorizeApp` 뒤에 `tx.port(domainProvisioningPort).create(...)`로 domain을 만들고 실패하면 그 오류를 돌려준다. `requireWriter`의 주석("그 앱 project의 …")을 App Engineer로 맞춘다. `register.ts`의 `appRegistrationLookup` 구현이 `project`를 싣지 않는다.
2. `apps/lookups.ts`의 `appProjectOf`·`appOfProject`를 지운다. 지우고 나서 `grep -rn "appProjectOf\|appOfProject" packages tests tools`가 0줄이어야 한다. 남은 쓰는 곳이 있으면(다른 task가 놓친 줄) 이 task가 고친다(주로 `packages/core/main/daemon/place-folders-glue.ts`, `wiring/lophn-agent-runtime.ts`가 `de-place-info`에서 이미 정리됐다). 고친 줄은 "넘길 줄"에 적는다.
3. `wiring/lophn-agent-registration.ts`에서 `appProjectLookupPort` 구현(`defineTxPort`)과 import를 지운다. (`apps` place 조회 `appOf`는 App Engineer place를 위해 남는다.)
4. `apps/agent-tools/app.ts`의 `app.create`: 입력에서 `project`와 `projectList` 읽기를 없앤다. 설명 글은 "Register a new app with a name and a one line purpose. An app of that name gets its first domain, and its App Engineer looks after it." 꼴로 쓴다. `commandOf(appCreate, {slug, name, description})`.
5. fixture: `app-grants_test.ts`, `problems/tests/request-ports_test.ts`, 다른 task의 test가 `apps` 표에 `project`를 직접 INSERT하거나 `appCreate`를 `project`와 함께 부르면 그 줄에서 `project`를 뺀다(`grep -rn "insert into apps\|INSERT INTO apps\|appCreate" packages tests`로 찾는다). `tests/e2e/`는 type만 맞춘다(`project` 입력을 뺀다. 앱을 만든 뒤 domain이 하나 생긴다고 가정한 줄은 없다). `tests/eval/restore/{active-app,apps,call}.ts`와 `tests/support/app/activate.ts`는 앱 만들기 인자에서 `project`를 빼고, 앱의 domain 이름은 앱 slug라는 것을 쓰는 곳이 있으면 맞춘다.
6. 시험: `registration/commands_test.ts`를 새로 쓴다. 옛 "같은 project에 앱을 두 번 만들면 conflict"와 "없는 project…" 사례는 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`app.create`는 앱 이름의 domain을 같은 tx에 만들고, 그 이름의 domain이 이미 있으면 앱도 domain도 남지 않는다(`conflict`)" — `packages/core/apps/registration/commands_test.ts`(fake `domainProvisioningPort`로 본다)
- 남지 않음:
  - `grep -rn "appProjectOf\|appOfProject\|appProjectLookup" packages tests tools`가 0줄이다.
  - `grep -rn "app\.project\|a\.project" packages tests`가 0줄이다.
  - `grep -rn "project already has an app\|each project has one app" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `appProjectOf`, `appOfProject`, `appProjectLookupPort`
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
