# dt-invocation-project

invocation 기록에서 `project` 칸을 지운다: protocol 스키마와 `app.invocations` 입력의 필터, ledger 표의 칸과 색인, 기록을 만드는 곳, 앱 상세 화면 Activity 탭의 project 열·필터·"project 단위" 표시. 어느 project가 불렀는지는 부른 session의 place로 안다.

- 단위: domain-tools (wave 2)
- 선행: dt-call-route
- 소유(이 task만 고친다):
  - `packages/protocol/apps/calls/invocation.ts`
  - `packages/core/apps/invocations/schema.ts`
  - `packages/core/apps/invocations/store.ts`
  - `packages/core/apps/invocations/rows.ts`
  - `packages/core/apps/invocations/ledger.ts`
  - `packages/core/apps/invocations/model.ts`
  - `packages/core/apps/invocations/ledger_test.ts`
  - `packages/core/apps/rewind/rewind_test.ts`
  - `packages/core/apps/calls/record.ts`
  - `packages/core/apps/calls/service.ts`
  - `packages/core/apps/routes.ts`
  - `packages/shell/renderer/app-frame/app-detail`
  - `packages/design/wording/catalog/app-space.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`("invocation 기록은 지우지 않는다" 절. 기록 불변 trigger를 건드리지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "project 범위 지우기"와 "같이 도는 계획" 표(`app-detail`은 `renderer/app-frame/*`라서 `domain-place`·`artifact`도 닿는다. 이 task는 project 열·필터만 지운다)
  - 지금 코드: `packages/core/apps/invocations/schema.ts`(표와 색인 `invocations_app_project_id`), `packages/shell/renderer/app-frame/app-detail/activity/activity-tab.tsx`
- 계약:
  - 쓰는 것: `dt-call-route`가 둔 `project: null` 자리(`calls/record.ts`, `calls/service.ts`, `routes.ts`의 `withStartInvocation`)
  - 내놓는 것: `AppInvocation`에 `project` 칸이 없다. `app.invocations` 입력 `{ app?, session?, turn?, effect?, status?, reverted?, mode?, release?, cursor?, limit? }`(`project` 필터 삭제)

## 할 일

1. `packages/protocol/apps/calls/invocation.ts`: `appInvocationSchema`의 `project`와 `appInvocationsInputSchema`의 `project` 필터를 지운다(`projectIdSchema` import도).
2. ledger(`packages/core/apps/invocations`): `schema.ts`의 열 목록과 `CREATE TABLE`의 `project TEXT`, 색인 `invocations_app_project_id`(`(app, id)` 색인이 필요하면 그 모양으로 바꾼다), `store.ts`의 필터 `equals("project", ...)`와 INSERT 열·값, `rows.ts`의 `project: row.project ?? null`을 지운다. 표를 고치는 것이므로 새 schema step을 더하지 말고 지금 `apps.invocations.tables` step을 고친다(AGENTS.md "호환성": migration을 만들지 않는다. 개발 data는 지우고 새로 만든다). `ledger.ts`가 `project`를 다루면 같이 지운다.
3. 기록을 만드는 곳: `calls/record.ts`, `calls/service.ts`, `routes.ts`의 `withStartInvocation`(`project: null`)에서 `project` 줄을 지운다.
4. 앱 상세 화면(`packages/shell/renderer/app-frame/app-detail`): `source.ts`의 행 type `project`와 `projects` 목록, `core-source.ts`의 `apps/projects` read와 `project: invocation.project`, `activity/activity-tab.tsx`의 `ALL_PROJECTS` 필터, 열, 세부의 project 사실 줄(`fact-project`), `testdata/fake-source.ts`의 `project` 인자와 `projects`를 지운다. 화면 문구를 새로 쓰지 않는다. 빠진 칸 때문에 배치가 어색하면 그 칸만 접는다.
5. wording: 위에서 안 쓰게 된 key를 `packages/design/wording/catalog/app-space.ts`에서 지우고 `deno task wording`으로 생성물을 다시 만든다(`app-detail.label.all-projects`, `col-call`의 "· project" 부분이 바뀌면 값만 고치고 key 이름은 둔다, `fact-project`, `filter-project`, `no-project`, `no-project-level`. 쓰이는지 `grep -rn "<key>" packages tools`로 확인하고 지운다). 다른 task도 같은 catalog에 key를 더하고 지운다. 충돌하면 두 쪽 key를 다 남기고 생성물을 다시 만든다.
6. `ledger_test.ts`, `packages/core/apps/rewind/rewind_test.ts`의 fixture에서 `project`를 지운다. `reverted_by`를 가진 다른 fixture(아래 grep)도 같다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — `ledger_test.ts`의 "끝난 invocation은 되돌림 표시와 changeset 지우기 말고는 바뀌지 않는다" test가 칸 삭제 뒤에도 통과하는 것이 기록 불변 규칙의 보호다. 새 test를 더하지 않는다.
- 남지 않음:
  - `grep -rnE "project" packages/core/apps/invocations packages/protocol/apps/calls/invocation.ts packages/core/apps/calls`가 0줄이다(주석 포함).
  - `grep -rnE "ALL_PROJECTS|fact-project|filter-project|no-project-level|all-projects" packages tools --include=*.ts --include=*.tsx`가 0줄이다.
- (화면) `deno task wireframes`가 되고(앱 상세 fixture를 쓰는 gallery page `app-space`가 그려진다), `deno run -A packages/shell/renderer/build.ts`가 된다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`packages/design/wording/`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
