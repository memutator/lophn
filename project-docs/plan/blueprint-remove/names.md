# blueprint-remove task 공통

모든 brief가 읽는 file이다(`status.py`는 이 file을 brief로 세지 않는다). 계획의 "정한 것"(`project-docs/plan/blueprint-remove/README.md`)을 이름 표로 풀어 두었다. 표에 없는 이름은 아래 파생 규칙을 따른다.

## 이름 표

README가 정한 것(바꾸지 않는다)

| 옛 | 새 |
|---|---|
| 개념 "blueprint" | 선언(declaration) |
| 앱 source의 선언 file `blueprint.ts` | `lophn.ts` |
| SDK package `@lophn/blueprint` (폴더 `packages/sdk/blueprint/`) | `@lophn/declaration` (`packages/sdk/declaration/`). export `defineApp`, `validateDeclaration`, type `AppDeclaration` |
| type `Blueprint` | `AppDeclaration` |
| `validateBlueprint` | `validateDeclaration` |
| `defineBlueprint` | `defineApp` |
| agent tool `blueprint.check` | `declaration.check` |
| route `blueprints/check` (`blueprintCheck`) | `declarations/check` (`declarationCheck`) |
| CLI `lophn app blueprint` | `lophn app declaration` |
| `blueprint_hash` / `blueprintHash` | `declaration_hash` / `declarationHash` |
| release 표의 `blueprint` 열 | `declaration` |
| bundle의 `blueprint.json` | `declaration.json` |
| 파생 사실: release 표의 `declarations` 열, `AppDeclarations`, `declarationsOfBlueprint` | `facts`, `AppFacts`, `factsOfDeclaration` |
| 실패 code `blueprint_missing`, `blueprint_eval_failed`, `not_a_blueprint` | `declaration_missing`, `declaration_eval_failed`, `not_a_declaration` |
| eval check id `blueprint-kept` | `declaration-kept` |
| 선언의 부분 이름 `ToolDeclaration`, `ScreenDeclaration`, `AppToolUseDeclaration` | 그대로 |

파생 규칙(README의 "나머지 내부 이름도 같은 꼴"을 풀어 쓴 것이다. planner 확인 전 추천이다. 아래 "planner에게 묻는 것")
- 식별자 안의 `Blueprint`는 `Declaration`, `blueprint`는 `declaration`, `BLUEPRINT`는 `DECLARATION`이다. 예: `loadActiveBlueprint` → `loadActiveDeclaration`, `StoredBlueprint` → `StoredDeclaration`, `createBlueprintReads` → `createDeclarationReads`, `checkBlueprint` → `checkDeclaration`, `BlueprintOptions` → `DeclarationOptions`, `BLUEPRINT_COPY_NAME` → `DECLARATION_COPY_NAME`, `BLUEPRINT_EXTRACT_LIMIT_MS` → `DECLARATION_EXTRACT_LIMIT_MS`, `makeBlueprint` → `makeDeclaration`, `AppBlueprintView` → `AppDeclarationView`, `BlueprintSource` → `DeclarationSource`.
- "`declarations`라는 이름의 파생 사실" 가족은 모두 `facts`로 간다: `AppDeclarations` → `AppFacts`, `CurrentDeclarations` / `currentDeclarations` → `CurrentFacts` / `currentFacts` (port id 문자열 `apps.permissions.CurrentDeclarations` → `apps.permissions.CurrentFacts`), `declarationsOf` → `factsOf`, `compareDeclarations` → `compareFacts`, `releaseDeclarations` → `releaseFacts`, `appDeclarationsSchema` → `appFactsSchema`, `packages/core/apps/permissions/declarations.ts` → `facts.ts`, 읽기 output과 store type의 칸 `declarations` → `facts`. 사람 화면의 wording "declarations"(Access 탭 등)는 이미 "선언"을 뜻하니 건드리지 않는다.
- 변수 이름도 같다. `blueprint` 변수가 선언 전체면 `declaration`, 파생 사실이면 `facts`다.
- 파일 이름: `eval-blueprint.ts` → `eval-declaration.ts`, `deps-blueprint.ts` → `deps-declaration.ts`, `blueprint-source.ts` → `declaration-source.ts`, `tests/blueprint_test.ts(.tmpl)` → `tests/declaration_test.ts(.tmpl)`, `blueprint.ts.tmpl` → `lophn.ts.tmpl`.
- 글(주석, 문서, 지침): 한국어 문장의 "blueprint"는 "선언"으로, 영어 문장은 "declaration"으로 쓴다. 단순 치환으로 끝내지 말고 문장이 맞는지 읽는다("blueprint 선언"은 "선언"이다). 주석은 "왜"만 쓴다.
- 새로 만들 수 있는 이름은 위 규칙이 만든 것뿐이다. 규칙이 만든 이름이 같은 범위의 다른 이름과 부딪치면 그 자리를 바꾸지 말고 보고의 "겹침"에 `file:line`, 부딪친 이름을 적는다(이름을 새로 지어 넘어가지 않는다).

## 공통 절차

1. **시작: 인벤토리를 다시 잰다.** brief의 file 목록은 `app-oauth`가 land하기 전 조사(main `3fddc74b5`)라 달라졌을 수 있다. 맡은 lane 안에서 `git grep -il blueprint -- <lane path들>`(그리고 `git grep -nw declarations -- <lane path들>`)를 돌려 `.dev-data/<task id>/inventory.txt`에 둔다. 목록에 없는 file이 나오면 lane 폴더 안이면 맡은 것이다. 다른 lane의 file이나 폴더면 건드리지 말고 보고의 "넘길 줄"에 적는다.
2. **이름은 완전히 바꾼다.** 옛 이름을 읽는 호환 장치, alias import(`import { AppDeclaration as Blueprint }`), 옛 이름 re-export, `v2` 이름을 만들지 않는다(AGENTS.md "호환성"). 쓰는 곳 없는 옛 코드는 지운다. 바꾼 이름은 주석, 오류 message, 문자열로 쓴 route·method·tool 이름까지 grep한다(type check가 문자열을 못 본다).
3. **기록은 건드리지 않는다.** 아래 "남아도 되는 곳"만 남는다.
4. **끝: lane grep.** 맡은 lane 안의 `git grep -il blueprint`가 0줄이고, `git grep -nw -E "declarations|AppDeclarations"`에 남은 줄은 모두 선언의 부분을 뜻하는 영어 낱말(예: "tool declarations")인 것을 한 줄씩 확인한다. 남은 줄은 보고에 file:line과 이유로 적는다.
5. `deno task check`를 돌리고, 끝내기 전에 `deno task check:full`을 돈다(둘 다 brief의 "끝남"에 따른다). check가 `packages/shell/main/desktop/core/deno.lock`을 고쳐 두면 되돌린다(`git checkout -- packages/shell/main/desktop/core/deno.lock`). 이 file의 `@lophn/blueprint` 한 줄은 lead가 따로 고친다.
6. 새 위험 test는 없다. 있는 test가 이름만 바뀐 채 그대로 통과해야 한다. test를 약하게 고치거나 지우지 않는다.

## 남아도 되는 곳 (기록)

- `tests/eval/runs/**` (지난 run JSON)
- `tests/eval/materials/<이름>/<n>/`의 옛 판(`notify-app`, `calendar-app`, `calendar-app-bug`, `date-range`, `calendar-data`의 @1~@3, 이미 commit된 `calendar-app-dev@1`, `calendar-app-user@1`)
- `tests/eval/registry/**`의 옛 항목(registry는 n마다 append한다. 새 항목은 eval 쪽 task가 만든다)
- `tests/eval/scorecards/**`
- `project-docs/products/change-log/**`, `project-docs/issues/archived/**`
- `project-docs/plan/**`, root `ISSUE-*.md` (lead가 다룬다)
- `packages/shell/main/desktop/core/deno.lock`의 `@lophn/blueprint` 한 줄 (lead)

## 보고에 더할 것

brief의 "보고" 꼴에 더해 둘을 쓴다.
- **남은 blueprint 줄**: lane grep 결과와 남긴 이유(0줄이면 "없음").
- **겹침**: 위 규칙이 만든 이름이 부딪친 곳과 새 이름 겹침. 없으면 "없음".

## planner의 답 (2026-10-23)

brief를 쓸 때 찾은 질문 일곱에 모두 추천대로 답했다.
1. 코어 `checkBlueprint` → `checkDeclaration`. SDK `cap-*`의 같은 이름과 module이 달라 그대로 둔다.
2. `facts`의 기존 module 안 이름(`AppFacts` 등)은 그대로 둔다. 한 file이 둘 다 import해야 하면 안쪽 type 이름을 바꾸고 보고한다.
3. 파생 이름 `DeclarationOptions`, `makeDeclaration`, `DECLARATION_COPY_NAME`, `DECLARATION_EXTRACT_LIMIT_MS`는 규칙대로 간다.
4. SDK `@lophn/declaration`은 `1.0.0`이다.
5. `date-range`와 `calendar-data`도 @4를 만든다(내용은 그대로, needs만). `br-eval-materials`가 한다.
6. `br-docs`는 파생 사실을 말하는 곳만 "선언 사실(facts)"로 쓴다.
7. lead는 wave마다 land하지 않고 wave 3 뒤에 한 번 land한다.
