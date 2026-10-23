# br-eval-materials

eval 재료의 새 판 @4를 만들고(선언 file 이름이 바뀌어 옛 판은 release 준비를 지나지 못한다), registry와 시나리오 핀(world 재료 판, criterion 판, 시나리오 n)을 다시 고정하고, eval 문서 둘의 이름과 판을 맞춘다.

- 단위: br-eval-materials (wave 3)
- 선행: br-eval-checks. criterion `card-covered@5`와 check id `declaration-kept`가 먼저 있어야 시나리오 핀을 @5로 올릴 수 있다.
- 소유(이 task만 고친다):
  - `tests/eval/materials/`
  - `tests/eval/registry/`
  - `tests/eval/scenarios/`
  - `project-docs/architecture/eval.md`
  - `project-docs/products/roadmap/eval.md`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md`("정한 것"의 eval 항목, "lead가 할 일"의 재료 @4 확인)
  - architecture: `project-docs/architecture/eval.md`("버전은 hash로 고정한다", "산출물은 후보 재료다": 재료 판은 불변이고 선언이나 needs가 바뀌면 새 판을 만든다. 옛 판은 지우지 않는다, "제품 route로 되살린다")
  - 코드: `tests/eval/restore/manifest.ts`(`loadMaterial`, `writeMaterial`, `verifyMaterial`, `orderMaterials`), `tests/eval/restore/save.ts`(새 판을 쓰는 길), `tests/eval/runner/register.ts`(`registerAll`: 시나리오·재료·criterion을 registry에 올린다), `tests/eval/versions/{authored,registry}.ts`(`scenarioHash`는 시나리오 file과 같은 폴더의 helper file 전체의 hash다), `tests/eval/restore/materials_test.ts`
  - 새 template: `packages/core/apps/packages/template/app/`(`lophn.ts.tmpl`, `AGENTS.md.tmpl`, `deno.json.tmpl`, `tests/declaration_test.ts.tmpl`)
- 계약:
  - 쓰는 것: wave 1~3의 모든 새 이름, criterion `card-covered@5`(`br-eval-checks`).
  - 내놓는 것: 재료 @4가 시나리오 world의 새 판이다. 옛 판 @1~@3은 지우지 않고 바꾸지도 않는다(`materials_test.ts`가 hash로 지킨다).

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). 먼저 `git grep -il blueprint -- tests/eval/materials`을 재료 이름과 판으로 묶고, 각 재료의 가장 큰 판이 무엇인지 본다. 지금(main `3fddc74b5`) 목록: `notify-app`, `calendar-app`, `calendar-app-bug`(각 @1~@3). 그 재료의 needs·parent를 따라가는 재료도 새 판이 필요하다: `date-range`(package, needs `notify-app`), `calendar-data`(app_data, needs `calendar-app`). `app-oauth` 등 앞 계획이나 다른 계획이 더한 재료(예: 아직 untracked인 `calendar-app-dev@1`, `calendar-app-user@1`. parent `calendar-call@3`은 이 checkout에 없다)가 commit되어 있으면 똑같이 다룬다. 바뀌지 않는 재료(`apps-home`, `projects-home`, `calendar-blank`, `operators-home` 등)는 건드리지 않는다.
2. 새 판 @4를 만든다. 재료마다 가장 큰 판(@3)을 복사해 아래만 바꾼다. 앱 id, 고정 id, 날짜, 앱의 업무 코드는 그대로 둔다.
   - 선언 file `source/blueprint.ts.tmpl` → `source/lophn.ts.tmpl`, `source/tests/blueprint_test.ts.tmpl` → `source/tests/declaration_test.ts.tmpl`. 안의 `@lophn/blueprint` → `@lophn/declaration`, `defineBlueprint` → `defineApp`, `Blueprint` → `AppDeclaration`, `makeBlueprint` → `makeDeclaration`, `sdk_dependencies`의 `{ name: "@lophn/declaration", version: "1.0.0" }`, `tests/wording_test.ts.tmpl`·`src/*.ts.tmpl`·`deno.json.tmpl`의 import 줄과 주석.
   - `AGENTS.md.tmpl`: 재료의 AGENTS.md가 template의 문장을 그대로 담은 부분은 새 template의 `AGENTS.md.tmpl` 문장(`lophn.ts`, "선언")으로 바꾼다. 앱마다 다른 부분은 그대로 두고 개념어 "blueprint"만 "선언"으로 바꾼다.
   - `material.json`: `needs`와 `parent`를 @4로(`notify-app@4`, `date-range@4`, `calendar-app@4`), `content_hash`는 손으로 계산하지 않고 `writeMaterial`(또는 `save.ts`의 길)로 쓴다. `produced_by`는 복사한 판의 값을 그대로 둔다.
   - `date-range@4`, `calendar-data@4`는 file 내용이 그대로이고 needs만 바뀐 판이다.
   - 재료 file은 `fmt.exclude`에 있다. `JSON.stringify(v, null, 2) + "\n"`로 쓴다(`writeMaterial`이 한다).
   - 변환 script는 `.dev-data/br-eval-materials/`에 두고 commit하지 않는다.
3. 시나리오 핀을 올린다.
   - world: `calendar-dev`, `calendar-user`, `calendar-api`, `calendar-maintain`, `calendar-diagnose`, `L4-new`, `L7`, `O4`의 `@3`을 `@4`로(`notify-app`, `date-range`, `calendar-app`, `calendar-app-bug`, `calendar-data`. `calendar-blank@1`은 그대로). 파일 머리 주석의 "world는 calendar-app-bug@3"도 맞춘다.
   - criterion: `scenarios/calendar/common.ts`와 `scenarios/calendar/calendar-maintain.scenario.ts`의 `card-covered@4`를 `card-covered@5`로.
   - 시나리오 n: `scenarioHash`는 시나리오 file과 같은 폴더의 helper file(`common.ts`, `spec.ts`, `dates.ts` 등) 전체를 묶는다. `calendar/common.ts`를 고치면 `calendar/` 폴더의 모든 시나리오 hash가 바뀐다. 바뀐 hash마다 그 시나리오 file의 `n`을 registry의 가장 큰 n보다 크게 올린다. 올려야 하는 시나리오를 추측하지 말고 `registerAll`(또는 아래 5번 길)이 내는 "n을 올려라"로 찾는다.
4. registry: `tests/eval/registry/**`의 옛 항목은 고치지 않는다. 새 판의 항목(재료 @4, criterion `card-covered@5`, 바뀐 시나리오 n, 새로 측정되는 component·checks 판)은 손으로 쓰지 않고 `registerAll`/버전 측정 길로 append한다. 이 길은 `tests/eval/runner/register.ts`와 `tests/eval/versions/registry.ts`다. 진짜 model provider를 부르지 않는 길만 쓴다(5번). 만들어진 diff에서 새 줄만 늘었는지(append only) 확인한다.
5. 재료 @4가 이름이 바뀐 release 준비를 지나는지 본다: 시나리오마다 dry run(되살리기만 하고 진짜 model은 부르지 않는다. `tests/eval/runner/experiment.ts`와 `tests/eval/experiment/gate/`의 `dryRun`이 하는 길)으로 한 번씩 되살린다. 최소: `calendar-user`(notify-app@4, date-range@4, calendar-blank@1), `calendar-api`(calendar-app@4), `calendar-maintain`(calendar-app@4, calendar-data@4), `calendar-diagnose`(calendar-app-bug@4). dry run이 실제 provider를 부르거나 key·experiment spec이 필요해 보이면 멈추고 보고한다(AGENTS.md "사람에게 묻는 것": 실제 model provider 호출).
6. 문서: `project-docs/architecture/eval.md`의 재료 판 문장("지금 앱 재료는 `notify-app@3`, `date-range@3`, `calendar-blank@1`(앱 등록만), `calendar-app@3`, `calendar-app-bug@3`, `calendar-data@3` ...", 뒤 단위는 `calendar-app@3`에서 시작한다는 문장), check id와 judge 입력 이름표가 나오는 곳을 새 판과 이름으로 고친다. `project-docs/products/roadmap/eval.md`의 "blueprint"(card-covered 입력, `reuse-sdk-dependency`, `reuse-app-connection`, `blueprint-kept`, 재료 id 문장, `blueprint.check` 문장)를 선언 이름으로 고친다. 두 문서의 앞날 계획 내용은 바꾸지 않는다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다(`materials_test.ts`가 옛 판 hash와 새 판 hash, needs·parent가 가리키는 판이 있는지 지킨다).
- 위험 test: 없음. 있는 test(`materials_test.ts`, `manifest_test.ts`, `versions_test.ts`)가 그대로 통과한다.
- 남지 않음:
  - `git grep -il blueprint -- tests/eval ':!tests/eval/runs' ':!tests/eval/scorecards'`에 남는 곳이 `tests/eval/materials/<이름>/<옛 판>/`과 `tests/eval/registry/**`의 옛 항목뿐이다. 재료 이름별로 가장 큰 판(@4)과 새 registry 항목은 0줄이다.
  - `git grep -nE "(notify-app|date-range|calendar-app|calendar-app-bug|calendar-data)@[123]\b" -- tests/eval/scenarios tests/eval/materials project-docs/architecture/eval.md project-docs/products/roadmap/eval.md`에 남는 곳이 `tests/eval/materials/<옛 판>/material.json`의 needs·parent뿐이다(옛 판끼리 가리킨다).
  - `git grep -il blueprint -- project-docs/architecture/eval.md project-docs/products/roadmap/eval.md`가 0줄이다.
  - lead가 마지막에 `git grep -il blueprint -- ':!tests/eval/runs' ':!project-docs/products/change-log' ':!project-docs/issues/archived'`로 볼 때 옛 재료 판 @1~@3, registry 옛 항목, 닫힌 기록만 남는다.

## 보고

- 바꾼 file(새 재료 폴더, 바뀐 시나리오, 새 registry 항목 수)
- 통과한 check와 dry run한 시나리오
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 `date-range@4`, `calendar-data@4`를 만든 것과 untracked 재료를 어떻게 다뤘는지)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- 비교가 끊기는 것: 새 재료 판, criterion 판, check id (lead가 changelog에 쓴다)
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 진짜 model로 돌려 보지 않았다는 것 등. 없으면 "없음"
