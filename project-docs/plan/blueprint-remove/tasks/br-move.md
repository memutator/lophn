# br-move

protocol, core, SDK의 `blueprint` 폴더와 file을 새 이름으로 옮기고, flat 옛 사본을 지우고, 여러 lane이 함께 기대는 이름(export 이름, protocol의 wire 이름, 앱 source와 bundle의 file 이름, 실패 code, tool·route·CLI 이름, SDK 이름)을 한 번에 바꾼다. 그 뒤 wave 2의 lane들이 서로 기다리지 않고 각자 남은 글과 지역 이름을 정리한다.

- 단위: br-move (wave 1)
- 선행: 없음
- 소유(이 task만 고친다). wave 1은 혼자 도는 task라 넓게 잡는다. 아래 "무엇을 바꾸나"에 적은 것만 바꾼다:
  - `packages/core`
  - `packages/protocol`
  - `packages/sdk`
  - `packages/shell`
  - `packages/coding-agent`
  - `tools/check-deps.ts`
  - `tools/deps-blueprint.ts`
  - `tools/deps-declaration.ts`
  - `tests/eval/checks/`
  - `tests/eval/types.ts`
  - `tests/e2e/`
  - `tests/support/`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md` (이름 표, 공통 절차, 남아도 되는 곳), `project-docs/plan/blueprint-remove/README.md` ("정한 것", "순서")
  - 배경: root `ISSUE-blueprint-domain.md` ("정한 것")
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md` (선언의 자리와 파생 사실)
  - boundary·module: `project-docs/module-catalog.yaml`에서 `packages/protocol/apps`, `packages/core/apps`, `packages/sdk`에 걸린 module (경로가 catalog와 어긋나면 `deno task check`의 `check-modules`가 알린다)
  - 코드: `tools/deps-blueprint.ts`와 `tools/check-deps.ts` (선언 정본이 의존성 없는 파일만 import하는 규칙), `packages/protocol/apps/blueprint/mod.ts`와 flat 사본 `packages/protocol/apps/blueprint{,-types,-json,-schema,-scope}.ts`
- 계약:
  - 쓰는 것: README "정한 것"의 이름 표 그대로.
  - 내놓는 것: wave 2의 모든 task가 기대는 새 이름 전부(아래 "무엇을 바꾸나"). 이 task가 끝나면 protocol과 SDK, core 폴더 이름과 export, 앱 source의 file 이름(`lophn.ts`), bundle의 `declaration.json`, 실패 code, tool·route·CLI 이름은 더 바뀌지 않는다.

## 무엇을 바꾸나

경계: 여러 lane이 함께 기대는 것은 이 task가 바꾼다. lane 안에서만 쓰는 것(지역 변수, 주석, 문서 문장, SQL 열 이름, 테스트 이름)은 wave 2가 바꾼다. 옮긴 폴더와 지울 file 안은 이 task가 끝까지 정리한다.

1. 폴더와 file (git mv, 지금 목록은 아래. `app-oauth`가 더한 file도 같은 규칙으로 옮긴다)
   - `packages/protocol/apps/blueprint/` → `packages/protocol/apps/declaration/`
   - flat 옛 사본 `packages/protocol/apps/blueprint.ts`, `blueprint-types.ts`, `blueprint-json.ts`, `blueprint-schema.ts`, `blueprint-scope.ts`는 지운다. 폴더판이 살아 있는 것(superset)이다. 먼저 `diff`로 flat에만 있는 export가 없는지 본다(있어도 폴더에 같은 것이 있는지 확인한다). flat을 읽던 곳은 폴더로 옮긴다: `protocol/apps/mod.ts`(지금 `export * from "./blueprint.ts"`가 `InputSchema`, `InputType`, `JsonObject`, `JsonValue`, `ValidationResult`, `validateInput`을 다시 내보낸다. 같은 것을 `./declaration/mod.ts`에서 type과 `validateInput`만 골라 내보낸다. zod를 쓰는 `read.ts`는 `mod.ts`에서 내보내지 않는 규칙을 지킨다), `protocol/apps/packages.ts`(`semver`), `core/apps/permissions/model.ts`와 `core/apps/permissions/broker/access.ts`(`hostOf`), `tools/deps-blueprint.ts`.
   - `packages/core/apps/blueprint/` → `packages/core/apps/declaration/` (`reads_test.ts` 포함)
   - `packages/core/apps/releases/ui-build/eval-blueprint.ts` → `eval-declaration.ts` (폴더 밖에서 `check.ts`와 `prepare/from-source.ts`가 가리킨다)
   - `packages/core/apps/permissions/declarations.ts` → `facts.ts`
   - `packages/sdk/blueprint/` → `packages/sdk/declaration/` (`deno.json`의 `name`은 `@lophn/declaration`, `define.ts`의 함수는 `defineApp`)
   - `tools/deps-blueprint.ts` → `tools/deps-declaration.ts` (`checkBlueprintGraph` → `checkDeclarationGraph`). flat 사본이 없어지니 "옛 평면 정본과 새 폴더 정본 둘" 분기(`BLUEPRINT_ENTRY`, `NEW_BLUEPRINT_ENTRY`, `CONTRACT_FILES`의 flat 줄, wrapper 분기)를 하나로 줄인다. `tools/check-deps.ts`도 맞춘다.
   - 앱 template: `packages/core/apps/packages/template/app/blueprint.ts.tmpl` → `lophn.ts.tmpl`, `tests/blueprint_test.ts.tmpl` → `tests/declaration_test.ts.tmpl`, `packages/core/apps/packages/template/files.ts`의 `REQUIRED_TEMPLATE_FILES`, 그 안의 import와 `@lophn/blueprint`·`defineBlueprint`·`makeBlueprint` 이름. template의 prose와 AGENTS.md.tmpl 문장은 `br-agent-text`가 고친다.

2. export 이름과 export type의 칸 (모든 쓰는 곳을 같이 고친다. type check가 안내한다)
   - 이름 표와 파생 규칙대로 `Blueprint`, `BlueprintOptions`, `validateBlueprint`, `defineBlueprint`, `blueprintCheck`, `BlueprintCheckOutput`, `checkBlueprint`, `loadActiveBlueprint`, `loadStoredBlueprint`, `StoredBlueprint`, `ActiveBlueprint`, `ActiveBlueprintLoader`, `createBlueprintReads`, `readBlueprint`, `extractBlueprint`, `ExtractedBlueprint`, `canonicalBlueprint`, `BlueprintValue`, `BlueprintValidator`, `BlueprintRead`, `BlueprintSource`, `AppBlueprintView`, `appBlueprint*Schema`, `BLUEPRINT_*`.
   - 파생 사실 가족 전부: `AppDeclarations` → `AppFacts`, `CurrentDeclarations`/`currentDeclarations` → `CurrentFacts`/`currentFacts` (port id 문자열도), `declarationsOf` → `factsOf`, `compareDeclarations` → `compareFacts`, `releaseDeclarations` → `releaseFacts`, `declarationsOfBlueprint` → `factsOfDeclaration`, `appDeclarationsSchema` → `appFactsSchema`. export type의 `blueprint` 칸은 `declaration`, `declarations` 칸은 `facts`다(`StoredRelease`류, `SecretAllowanceSource`, `appTools.output` 등).
   - SQL 열 이름은 이 task가 바꾸지 않는다. 열(`blueprint`, `blueprint_hash`, `declarations`)을 type 칸에 옮기는 줄만 `declaration: row.blueprint`처럼 맞추고, 열 이름과 schema step은 `br-release`가 바꾼다. 다만 이 task가 끝날 때 plan branch의 core가 뜨고 test가 통과해야 한다.

3. protocol의 wire 이름 (protocol은 `packages/protocol/` 전체를 이 task가 끝까지 정리한다. 단 `packages/protocol/coding-agent/launch-plan.ts`의 prompt 글은 `br-agent-text`의 몫이라 import 줄이 필요하면 그 줄만 고친다)
   - `blueprint_hash` → `declaration_hash` (`activation/activation.ts`, `lophn-agent/tool-values.ts`, `apps/declaration/read.ts`와 그 쓰는 곳 전부), activation 기록의 `blueprint` 칸 → `declaration`, `appTools.output`의 `declarations` 칸 → `facts`.
   - route `blueprintCheck` → `declarationCheck`, `resource: "blueprints"` → `"declarations"`, `name: "blueprint.check"` → `"declaration.check"`. 이 이름을 문자열로 쓰는 곳은 grep한다: `packages/core/agent-roles/tool-lists.ts`의 `READ_TOOLS`·`TOOL_ORDER`, `packages/core/apps/agent-tools/app.ts`, `packages/core/main/daemon/wiring/apps.ts`, 설명 글에 적힌 tool 이름.
   - CLI `app blueprint` → `app declaration` (`protocol/coding-agent/cli-commands.ts`의 `token(...)`, `packages/coding-agent/cli/commands/app.ts`의 `entryOf("app declaration", ...)`와 `types.ts`의 `READ_WORDS` 안의 `"blueprint"` → `"declaration"`. 설명 글 문장은 `br-agent-text`가 고친다).
   - `BLUEPRINT_EXTRACT_LIMIT_MS` → `DECLARATION_EXTRACT_LIMIT_MS`.

4. 앱 source, bundle, SDK의 file·package 이름 (읽는 쪽과 쓰는 쪽이 다른 lane이라 한 번에 바꾼다)
   - 앱 source의 선언 file `blueprint.ts` → `lophn.ts`: `core/apps/releases/prepare/from-source.ts`(`find("blueprint.ts")`), `core/apps/declaration/`(추출 자식이 읽는 path), `packages/core/agent-roles/place/place-data.ts`가 보여 주는 file 이름, template과 `files.ts`. 실패 code는 `declaration_missing`, `declaration_eval_failed`, `not_a_declaration`.
   - bundle의 `blueprint.json` → `declaration.json`: `core/apps/releases/bundle/seal.ts`(`BLUEPRINT_COPY_NAME` → `DECLARATION_COPY_NAME`)와 읽는 곳 `core/apps/runtime/entrypoint/main.ts`(`readBlueprint`), `core/apps/control.ts`, `core/main/app-supervisor/{assembly,preview-broker}.ts`.
   - SDK package 이름 `@lophn/blueprint` → `@lophn/declaration`: `core/apps/packages/vendor.ts`의 map과 `protocol/apps/declaration/${file}` vendor path, `core/apps/releases/ui-build/build.ts`의 이름 목록, template `deno.json.tmpl`과 import map, template `lophn.ts.tmpl`의 `sdk_dependencies`, `core/apps/packages/install_test.ts`가 도는 이름 목록, `tests/eval/checks/app/reuse.ts`의 SDK 이름 목록(reuse_test.ts와 같이. 이 file의 나머지는 `br-eval-checks`가 고친다).
   - `@lophn/declaration`의 version은 `1.0.0`이다.

5. 하지 않는 것
   - 주석과 문서 문장은 옮긴 폴더·지운 file 안에서만 끝까지 고친다. 다른 lane의 주석은 두어도 된다(wave 2가 고친다). 이름만 바꾸다 문장이 틀려지면(예: "blueprint 선언"이 "declaration 선언"이 되는 것) 그 줄은 읽고 바로 고친다.
   - `packages/sdk/declaration/guide.md`의 문장은 `br-agent-text`가 쓴다. 이 task는 그 file의 이름·코드 예시만 맞춘다.
   - `tests/support/app/**`(sample, patch)와 `tests/e2e/`의 e2e 본문은 wave 3이 고친다. 이 task는 컴파일이 깨지는 import 줄만 맞춘다(`tests/e2e/operator_test.ts`의 `appTools` import). 그래서 이 task가 끝난 plan branch는 e2e가 돌지 않는다. 알려진 상태다.
   - eval 재료(`tests/eval/materials/**`)와 `tests/eval/registry/**`, 시나리오는 건드리지 않는다.
   - SQL 열 이름과 schema step.

## 할 일

1. 인벤토리: `git grep -il blueprint -- ':!tests/eval/runs' ':!project-docs' ':!tests/eval/materials' ':!tests/eval/registry' ':!tests/eval/scorecards' ':!ISSUE-*.md'`를 `.dev-data/br-move/inventory.txt`에 둔다. 위 목록과 대어 본다. 같은 식으로 `git grep -nwE "declarations|AppDeclarations|declarationsOf|currentDeclarations|CurrentDeclarations|compareDeclarations|releaseDeclarations"`를 인벤토리에 더한다.
2. 위 1번의 이동과 삭제. `git mv`로 옮겨 history를 살린다.
3. 이름 바꾸기는 손으로 하나씩 하지 않는다. `.dev-data/br-move/rename.ts`에 단어 경계 정규식 치환 script를 짜서 코드 file(`*.ts`, `*.tsx`, `*.tmpl`, `*.json`의 코드 쪽만)에 돌린다. 건드리지 않을 곳(위 "남아도 되는 곳", 기록 폴더, `project-docs/`)을 script가 거른다. 치환 목록은 이름 표와 파생 규칙에서 낸 export 이름이다. 지역 변수와 주석은 script가 건드리지 않게 하고(또는 건드린 뒤 되돌린다), type check가 알려 주는 곳만 손으로 고친다.
4. 문자열로 쓰인 이름을 grep한다: `"blueprint.check"`, `blueprints`, `blueprints/check`, `blueprint.json`, `blueprint.ts`, `blueprint_hash`, `@lophn/blueprint`, `app blueprint`, `blueprint_missing`, `blueprint_eval_failed`, `not_a_blueprint`, `CurrentDeclarations`. type check가 못 보는 곳(tool 목록 test, 문서가 아닌 설명 글 안의 이름, `tests/eval/checks` 안의 문자열)을 고친다.
5. `deno task check`를 반복해 통과시킨다. check가 `packages/shell/main/desktop/core/deno.lock`을 고쳐 두면(`jsr:@lophn/blueprint@1.0.0` 줄이 새 이름으로) 그 변경은 commit하지 않고 되돌린다. check가 이 lock 때문에 떨어지면 고치지 말고 보고한다(lead가 따로 고친다). 그 뒤 `deno task check:full`을 통과시킨다. `deno task check`가 `check-deps`, `check-modules`, `check-docs`를 돌리므로 새 폴더 이름이 catalog와 문서 안 path와 어긋나면 그 줄도 고친다(문서의 이름 문장은 `br-docs`가 고치되, `check-docs`가 "없는 path"로 막는 path는 이 task가 최소로 맞춘다. 맞춘 문서와 줄을 "넘길 줄"에 적는다).
6. 넘길 목록: 끝에 `git grep -n -i blueprint -- packages tools tests/support tests/e2e tests/eval/checks tests/eval/types.ts`를 lane별로 모아 보고에 붙인다. wave 2 task는 이 목록으로 시작한다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다.
- 위험 test: 없음. 있는 test(선언 검사 `validate_test.ts`, 호출 parity, release 봉인)가 이름만 바뀐 채 통과한다.
- 남지 않음:
  - `git ls-files packages/protocol/apps | grep -i blueprint`가 0줄이다(flat 사본과 옛 폴더 없음).
  - `git ls-files packages tools | grep -i blueprint`가 `packages/shell/main/app-frame/blueprint-source.ts`(shell 안에서만 쓰는 이름이라 `br-shell`이 옮긴다) 한 줄만 남는다. template의 `lophn.ts.tmpl`·`declaration_test.ts.tmpl`을 포함해 나머지 file 이름은 모두 새 이름이다.
  - `git grep -il blueprint -- packages/protocol tools/deps-declaration.ts tools/check-deps.ts packages/core/apps/declaration packages/sdk/declaration/mod.ts packages/sdk/declaration/define.ts packages/sdk/declaration/deno.json`이 0줄이다.
  - `git grep -nE "blueprint_hash|@lophn/blueprint|blueprint\.json|\"blueprint\.check\"|blueprint_missing|blueprint_eval_failed|not_a_blueprint" -- packages tools tests/support tests/e2e tests/eval/checks`가 0줄이다(주석과 문장은 남아도 되지만 값으로 쓴 이름은 남지 않는다).
  - 코어를 `project-docs/plan/tools/lead/boot.sh`로 두 번 띄워 `boot N exit 0`을 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`protocol/apps/mod.ts`는 이 task가 고쳤다. 그 밖의 등록 줄을 고쳤으면 적는다)
- 안 쓰게 된 export: 없음이어야 한다. 있으면 적는다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 lane에 남긴 `blueprint`·`declarations` 줄을 lane별로 모은 목록(위 6번). 맞춘 문서 줄
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: e2e가 wave 3까지 깨져 있다는 것 등. 없으면 "없음"
