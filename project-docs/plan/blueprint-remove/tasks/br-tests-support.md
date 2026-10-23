# br-tests-support

e2e가 쓰는 앱 sample과 patch(`tests/support/app/`)와 e2e 본문의 `blueprint`를 걷어낸다. sample의 선언 file을 `lophn.ts`로 옮기고 SDK 이름과 patch가 고치는 file 이름을 새 이름으로 바꾼다. `br-move`가 plan branch의 e2e를 깨 둔 것을 이 task가 되살린다.

- 단위: br-tests-support (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/app/`
  - `tests/e2e/operator_test.ts`
  - `tests/e2e/app-release_test.ts`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md`
  - architecture: `project-docs/architecture/testing.md`("견본 업무", `createAppSource`, sample과 patch가 template 위에 얹히는 길)
  - 코드: `tests/support/app/source.ts`(`createAppSource`, domain을 읽는 `${dir}/blueprint.ts`), `tests/support/app/sample/`, `tests/support/app/patch-*.ts`, 새 template `packages/core/apps/packages/template/app/lophn.ts.tmpl`
- 계약:
  - 쓰는 것: `br-move`와 wave 2가 바꾼 이름. 앱 source의 선언 file `lophn.ts`, SDK `@lophn/declaration`(`defineApp`, `AppDeclaration`, `makeDeclaration`), release 준비의 실패 code(`declaration_missing` 등), tool `declaration.check`.
  - 내놓는 것: 없음.

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). 지금 목록: `tests/support/app/sample/{blueprint.ts.tmpl,src/screens/items/bridge.ts.tmpl,src/tools.ts.tmpl}`, `tests/support/app/source.ts`, `tests/support/app/patch-{call,crash,domain,migration,net,restart,rewind,sandbox}.ts`, `tests/e2e/{operator,app-release}_test.ts`.
2. `sample/blueprint.ts.tmpl` → `sample/lophn.ts.tmpl` (`git mv`). 안의 `@lophn/blueprint`, `defineBlueprint`, `makeBlueprint`, `Blueprint`, 주석("blueprint가 정본이다", "tests/blueprint_test.ts")을 이름 표대로 바꾼다. 새 template(`lophn.ts.tmpl`)과 같은 모양을 유지한다.
3. `source.ts`: `${dir}/blueprint.ts`를 읽어 domain을 찾는 두 줄과 오류 message를 `${dir}/lophn.ts`로 바꾼다. patch 8개: 고치는 file 이름(`${dir}/blueprint.ts`)과 변수 `blueprint`와 주석을 바꾼다. patch가 문자열로 찾는 자리 표시(slot)는 sample의 바뀐 내용과 맞아야 한다(`patch-sandbox.ts`의 `text.includes(slot)`).
4. e2e: `operator_test.ts`의 `blueprint` 변수와 주석, `app-release_test.ts`의 주석("blueprint는 add_item을 선언한 채라 ...")을 고친다. 의미가 맞게 읽고 고친다.
5. e2e를 돌려 본다. 새 e2e를 만들지 않는다. 다음 순서로 돌린다: `deno task e2e:deps`, 그 뒤 `deno task e2e` 중 바뀐 file이 있는 `tests/e2e/app-release_test.ts`와 `tests/e2e/operator_test.ts`, 그리고 sample을 쓰는 e2e를 돌릴 수 있으면 하나 더(`rg -l "createAppSource" tests/e2e`로 찾는다). 오래 걸리거나 기계가 버거우면 돌린 것과 못 돌린 것을 보고에 적는다. lead가 land에서 전체 e2e를 돌린다. 실패하면 이름 때문인지 먼저 본다(기다림이나 우회를 넣어 통과시키지 않는다).

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다.
- 위험 test: 없음. 있는 e2e(app-release, operator)가 그대로 통과한다.
- 남지 않음: `git grep -il blueprint -- tests/support tests/e2e`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check, 돌린 e2e와 못 돌린 e2e
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
