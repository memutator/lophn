# br-release

release 준비, 봉인, activation, DB의 `blueprint`를 걷어낸다. release 표의 열(`blueprint` → `declaration`, `blueprint_hash` → `declaration_hash`, `declarations` → `facts`)과 schema step을 새 이름으로 고치고, 준비·봉인·activation·worker 안의 지역 이름과 글을 정리한다.

- 단위: br-release (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/`
  - `packages/core/apps/packages/store.ts`
  - `packages/core/main/worker/release-job.ts`
  - `packages/core/main/app-supervisor/release-runner.ts`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md` ("정한 것"의 "저장과 기록")
  - architecture: `project-docs/architecture/activation.md`(선언 비교, 파생 사실), `project-docs/architecture/app-call.md`(release에 봉인되는 선언)
  - boundary·module: `project-docs/module-catalog.yaml`에서 `packages/core/apps/releases`를 가진 module
  - 코드: `packages/core/apps/releases/schema.ts`(`releasesSchemaSteps`, 열과 trigger), `store.ts`, `facts.ts`, `bundle/seal.ts`, `prepare/from-source.ts`, `packages/core/apps/packages/store.ts`(SDK 사용처를 찾는 SQL이 releases 표를 직접 읽는다)
- 계약:
  - 쓰는 것: `br-move`가 바꾼 이름. `AppFacts`/`factsOfDeclaration`, `StoredDeclaration`류의 export 이름과 칸(`stored.declaration`, `stored.facts`), `DECLARATION_COPY_NAME`(값 `declaration.json`), `declaration_hash` wire 이름, 실패 code, `@lophn/declaration`. 이미 바뀌어 있다.
  - 내놓는 것: release 표의 열 이름이 `declaration`, `declaration_hash`, `facts`다. 다른 task가 이 열을 읽지 않는다(읽는 곳은 이 task의 소유 file뿐: `releases/**`, `packages/store.ts`).

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). `br-move`의 보고 "넘길 줄"에서 이 lane 몫을 먼저 본다.
2. `releases/schema.ts`: 열 `blueprint_hash` → `declaration_hash`, `blueprint` → `declaration`, `declarations` → `facts`, CHECK·trigger(`NEW.blueprint_hash <> OLD.blueprint_hash`류) 이름을 모두 같이 고친다. schema step을 새로 더하지 않는다. 지금 step을 제자리에서 고친다(AGENTS.md "호환성": migration 없이 개발 data를 새로 만든다). 위 주석("정규 blueprint JSON ... ")도 고친다.
3. `releases/store.ts`, `reads.ts`, `commands.ts`, `compare.ts`(`compare_test.ts` 포함), `facts.ts`, `mod.ts`, `preparation.ts`, `prepare/{flow,from-source}.ts`, `worker/run.ts`, `public-tools.ts`(+ test), `sdk-permissions.ts`, `activation/{assembly,desired,consents}*.ts`, `bundle/{seal,vendor_test}.ts`, `ui-build/{build,eval-declaration}.ts`: 열을 읽고 쓰는 SQL(`row.blueprint`, `INSERT`, `SELECT declarations`), 지역 변수(`blueprint`, `blueprintText`, `blueprintBytes`, `blueprintJson`, `blueprintSource`, `blueprintPath`), 오류 message(`"blueprint declarations are not valid"` 등), 주석을 이름 표와 파생 규칙대로 고친다. 파생 사실 변수 `declarations`는 `facts`다. 선언 전체는 `declaration`이다.
   - `prepare/flow.ts`의 입력 칸 `blueprintSource`와 `worker/run.ts`의 `record.blueprintSource`는 같은 wire(worker로 보내는 기록)다. 둘을 같이 `declarationSource`로 바꾼다. 그 wire를 쓰는 `packages/core/main/worker/release-job.ts`와 `packages/core/main/app-supervisor/release-runner.ts`의 `blueprint_hash` 칸(`declaration_hash`)도 이 task가 맞춘다.
4. `packages/core/apps/packages/store.ts`의 SQL(`json_each(r.blueprint, '$.sdk_dependencies')`)을 새 열 이름 `r.declaration`으로 고친다. 이 file만 releases 표를 밖에서 읽는다(다른 곳은 `releases/store.ts`의 함수를 거친다).
5. 테스트 이름과 fixture(`*_test.ts`의 `Deno.test("... blueprint ...")`, fixture JSON의 `blueprint_hash`)를 새 이름으로 고친다. 기대값을 약하게 하지 않는다. `packages/core/apps/usage/users_test.ts`는 `br-runtime`의 소유다. releases schema를 쓰지만 바뀌는 열 이름을 SQL로 직접 쓰고 있으면 고치지 말고 "넘길 줄"에 적는다.
6. 문서에 답이 없는 이름이 나오면 정하지 않고 보고의 "겹침"에 적는다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다.
- 위험 test: 없음. 있는 test(release 봉인, activation 선언 비교 `compare_test.ts`, public tool 변경 막기 `public-tools_test.ts`, bundle `vendor_test.ts`)가 그대로 통과한다.
- 남지 않음:
  - `git grep -il blueprint -- packages/core/apps/releases packages/core/apps/packages/store.ts packages/core/main/worker/release-job.ts packages/core/main/app-supervisor/release-runner.ts`가 0줄이다.
  - `git grep -nwE "declarations|AppDeclarations|declarationsOf" -- <같은 path들>`에 남은 줄은 모두 영어 낱말로서의 "declarations"이고 보고에 이유가 적혀 있다.
  - 코어 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot 2 exit 0`을 찍는다(schema step이 바뀌었다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 개발 data(`.dev-data/`)는 schema가 바뀌어 지우고 새로 만들어야 한다는 것을 적는다. 그 밖에 없으면 "없음"
