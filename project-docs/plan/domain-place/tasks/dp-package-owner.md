# dp-package-owner

package의 주인은 그것을 처음 publish한 앱의 project다. package 읽기(`packages.list`, `packages.versions`)와 agent tool(`package.list`, `package.get`)이 주인 project를 싣는다. 다른 project에서 난 bug를 주인 PM에게 넘기는 일은 지침이 하고(`dp-roles-public`) program은 하지 않는다. 주인이 아닌 project의 앱이 같은 package 이름에 새 version을 내는 것은 막는다.

- 단위: map (wave 3)
- 선행: 없음. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 알려 준 뒤 띄운다. 이 task는 `public` 칸을 쓰지 않으므로 그 사이 먼저 띄워도 되는지는 planner가 정한다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/packages.ts`
  - `packages/protocol/apps/package-routes.ts`
  - `packages/core/apps/packages/`
  - `packages/core/apps/agent-tools/package.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/layers.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `package-registry`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > package 주인", `project-docs/products/roadmap/domain.md`의 "정한 것 (agent, 초안)"(package의 주인)
- 계약:
  - 쓰는 것: `dp-app-project`의 `appProjectOf`(`packages/core/apps/lookups.ts`)
  - 내놓는 것: `Package.owner_project: Id<"prj"> | null`(`packages/protocol/apps/packages.ts`의 `packageSchema`. 옛 값·지금 catalog에 주인이 없는 package는 null). `packages.versions` 출력에도 `owner_project`. `package.publish`의 입력은 그대로이고 core가 앱의 project를 찾아 `package.register_version` 입력(`packageRegisterVersionInputSchema`)의 `owner_project`로 싣는다. agent tool 결과의 `owner_project`는 `{ id, name }`(project 이름은 `projectList`로 푼다).

## 할 일

1. `packages/protocol/apps/packages.ts`: `packageSchema`에 `owner_project`를 더한다. `package-routes.ts`: `packageRegisterVersionInputSchema`에 `owner_project`(필수), `packagesVersionsOutputSchema`에 `owner_project`를 더한다. 주석의 "App Engineer가 …"는 Project Manager로 고친다(65, 101째 줄. 앞 wave의 `dp-place-protocol`이 이미 했으면 그대로).
2. `packages/core/apps/packages/schema.ts`: `packages` 표에 `owner_project TEXT` 칸을 더한다(개발 data는 새로 만든다). `store.ts`·`rows.ts`·`reads.ts`가 칸을 읽고 `packageFromRow`가 `owner_project`를 싣는다. 내장 SDK(`@lophn/*`)는 catalog 밖이라 해당 없다.
3. `packages/core/apps/packages/commands.ts`의 `registerVersion`: 새 package면 `owner_project`를 넣어 만든다. 이미 있는 package에 새 version을 내는데 `owner_project`가 다르면 `forbidden`("a package is versioned by its owner project"). 주인이 null인 옛 package는 지금 publish하는 project가 주인이 된다.
4. `packages/core/apps/packages/publish.ts`: `PublishDeps`에 `projectOf(app)`를 더해 앱의 project를 `registerVersion` 입력에 싣는다. 만드는 곳(`wiring/apps.ts`의 `publishPackage` 호출)에서 꽂는 일은 lead가 한다(보고의 "등록할 것"). 앱 project를 못 찾으면 `internal`.
5. `packages/core/apps/agent-tools/package.ts`의 `package.list`·`package.get`: 결과에 `owner_project: { id, name }`을 싣는다(`routes`에 `projectList`를 더한다). 설명문에 "owner project: report problems of a package to its Project Manager"를 한 줄 더한다.
6. 위험 test는 두지 않는다. 주인이 아닌 project의 version 발행 거절은 `commands.ts`의 기존 test 방식(`install_test.ts` 근처 fixture)으로 한 사례만 더해도 된다(필수 아님).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/core/main/daemon/wiring/apps.ts`의 `publishPackage` deps에 `projectOf`
- 안 쓰게 된 export
- 정한 것: 주인이 아닌 project의 새 version은 막는다 / 주인 null은 다음 publish한 project가 주인이 된다 / 주인은 project 단위다(앱이 아니라)
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
