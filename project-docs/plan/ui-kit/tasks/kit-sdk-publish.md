# kit-sdk-publish

앱에 배포되는 UI 이름을 `@lophn/ui`(sub-path), `@lophn/app-ui`로 맞춘다. `FIXED_UI_DEPENDENCIES`, 앱 template, install.ts의 언급, `lophn-build-app` skill이 옛 이름(`@lophn/design`, `@lophn/ui-*`, `@lophn/tokens`, `@lophn/chart`)을 쓰던 자리를 고친다.

- 단위: kit-sdk (wave 2)
- 선행: kit-sdk-move
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/ui-build/build.ts`
  - `packages/core/apps/packages/template/app`
  - `packages/core/apps/packages/install.ts`
  - `packages/coding-agent/guides/skills/lophn-build-app`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-sdk`, `classification.md` 1절 `FIXED_UI_DEPENDENCIES` 행과 5절 9번
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 요구 3·6, "요구마다 무엇이 지키나" 3·6행
  - boundary: `project-docs/boundary-catalog.yaml`의 `app-releases`, `sdk`, `sdk-api`, `design-api`
  - 지금 코드: `packages/core/apps/releases/prepare/from-source.ts`(`FIXED_UI_DEPENDENCIES`로 `uiDependencies`를 거른다), `packages/core/apps/packages/template/import-map.ts`(`lophn-sdk:<name>@<version>/<경로>`를 푼다), `packages/core/apps/packages/template/app/tests/blueprint_test.ts.tmpl`("sdk_dependencies가 import map과 같다")
- 계약:
  - 쓰는 것: `kit-layout`·`kit-sdk-move`가 만든 `@lophn/ui`의 exports(`.`, `./primitives`, `./input`, `./layout`, `./navigation`, `./data`, `./feedback`, `./overlay`, `./reading`, `./shared`, `./base.css`, `./tokens.css`)와 `@lophn/app-ui`(`packages/sdk/app-ui/mod.ts`)
  - 내놓는 것: `FIXED_UI_DEPENDENCIES`가 정확히 `@lophn/blueprint`, `@lophn/ui`, `@lophn/app-ui`, `@lophn/wording`, `react`, `react-dom`이다. 앱 template의 `deno.json`이 `lophn-sdk:@lophn/ui@1.0.0/...`로 위 sub-path를 푼다.

## 할 일

근거: README `kit-sdk`("앱 배포 이름을 `@lophn/ui`로 바꾸고 `FIXED_UI_DEPENDENCIES`와 앱 template, `lophn-build-app` skill을 맞춘다"). 이 task가 바꾸는 이름은 protocol 성격이라 쓰는 곳을 모두 같은 task에서 고친다.

1. `build.ts`의 `FIXED_UI_DEPENDENCIES`를 위 목록으로 바꾼다. `@lophn/tokens`, `@lophn/ui-*` 10개, `@lophn/design`, `@lophn/chart`를 뺀다. 주석("공용 UI Package가 import하는 지원 소스…")을 새 구성에 맞게 고친다. esbuild의 `external`에 `@lophn/ui`를 주면 `@lophn/ui/overlay` 같은 sub-path도 external이다(esbuild 동작). 확인하려면 작은 입력으로 `buildScreens`를 한 번 돌려 본다(commit하지 않는다).
2. 앱 template(`packages/core/apps/packages/template/app/`)을 고친다. 지금 `@lophn/design`·`@lophn/ui-control`·`@lophn/ui-layout`·`@lophn/ui-state`·`@lophn/design/components`·`/reading`을 쓴다.
   - `deno.json.tmpl`: `@lophn/design*` 5줄과 `@lophn/ui-*` 3줄을 지우고 `@lophn/ui`(`.../mod.ts`), `@lophn/ui/base.css`, `@lophn/ui/tokens.css`(`.../generated/tokens.css`), 분류 8개(`@lophn/ui/primitives` → `lophn-sdk:@lophn/ui@1.0.0/components/primitives/mod.ts` …), `@lophn/ui/shared`, `@lophn/app-ui`(`lophn-sdk:@lophn/app-ui@1.0.0/mod.ts`)를 쓴다. `kit-layout-move`의 `packages/design/deno.json` exports와 같은 값이어야 한다. 앱 deno.json은 정렬 순서를 지킨다(지금 알파벳 순).
   - `blueprint.ts.tmpl`의 `sdk_dependencies`: `@lophn/design`·`@lophn/ui-control`·`@lophn/ui-layout`·`@lophn/ui-state` 넷을 `@lophn/ui`·`@lophn/app-ui` 둘로 바꾼다(`blueprint_test.ts.tmpl`이 deno.json의 고정 package 집합과 같은지 본다).
   - `src/screens/items/app.tsx.tmpl`: `Button`은 `@lophn/ui/primitives`, `Field`·`Input`은 `@lophn/ui/input`, `AppShell`은 `@lophn/ui/layout`, `ReadState`는 `@lophn/ui/feedback`에서 import한다. 주석의 "ui-state의 ReadState"를 고친다.
   - `src/screens/items/main.tsx.tmpl`: `@lophn/design/tokens.css`·`base.css` → `@lophn/ui/tokens.css`·`@lophn/ui/base.css`, `AppErrorBoundary`는 `@lophn/app-ui`.
   - `AGENTS.md.tmpl`·`CLAUDE.md.tmpl`·`scripts/*`·`tests/*`에 옛 이름이 있는지 `grep`으로 본다.
3. `packages/core/apps/packages/install.ts` 145줄 주석 "지원 소스(@lophn/design·@lophn/wording·@lophn/chart)"를 "지원 소스(@lophn/ui·@lophn/wording)"로 고친다. 이 tree의 `install.ts`에는 설치 목록을 만드는 코드가 없다(주석과 helper뿐). 어느 폴더가 `sdk/ui/<version>`이 되는지 정하는 코드가 있으면 보고한다.
4. `lophn-build-app` skill(`packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`)의 "순서" 4번 바로 뒤에 UI 이야기를 짧게 넣는다(이 skill은 지금 ui package·token을 언급하지 않는다). 내용만 정한다:
   - UI는 `@lophn/ui/<분류>`에서 import한다. 분류 이름 8개와 각각 무엇인지 한 줄씩: primitives(Button, Icon 등 기본 조작), input(form 칸과 filter), layout(AppShell·Grid·Card·페이지 틀), navigation(Tabs·Sidebar), data(Table·DataTable·Tree·List·StatTile·차트), feedback(Skeleton·EmptyState·ErrorState·ReadState), overlay(Dialog·Menu·Popover·Toast…), reading(Markdown·CodeBlock·Toc).
   - 어떤 component가 있는지는 분류의 `mod.ts`가 목록이다(export마다 "언제 쓰나" 한 줄). 위치는 앱 `.lophn/import-map.json`의 `@lophn/ui/<분류>` 값이 가리키는 설치 사본이다.
   - token과 기본 글꼴은 `@lophn/ui/tokens.css`, `@lophn/ui/base.css`, 앱 CSS는 token 변수만 쓴다.
   - 앱 bridge를 쓰는 AppApiButton·useAppApi·AppErrorBoundary는 `@lophn/app-ui`(`package show`로 guide를 읽는다).
   - 고치고 싶은 component는 그 파일을 앱 `src/`로 복사해 쓰면 그 파일은 앱 것이다. 복사한 뒤 lophn의 UI update는 그 파일에 닿지 않는다(한 줄).
   - 기존 skill 문장과 같은 말투(한국어, 개발자 영어 단어 그대로)로 쓴다.
5. 문서(architecture, ui-design skill, registry)는 이 task가 고치지 않는다. lead가 한다.

## 끝남

- `deno task check`가 통과한다. `packages/core`의 test(`scaffold_test.ts` 등)가 통과한다.
- 위험 test: 없음 (이름 바꿈이다. 앱 release 준비 경로는 다른 test가 이미 본다)
- 남지 않음:
  - `grep -rnE --exclude-dir=node_modules --exclude-dir=dist "@lophn/(design|ui-[a-z]+|tokens|chart)\b" packages tools`가 0줄이다(`.tmpl` 포함).
  - `grep -rn "FIXED_UI_DEPENDENCIES" packages`가 정의 하나, 쓰는 곳(`releases/mod.ts`, `prepare/from-source.ts`)만 남긴다.
- (화면) 해당 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: skill에 넣은 문장의 범위, template import map의 sub-path 목록
- 넘길 줄: 없음
- 계약 바꾸기 요청: `install.ts`가 `@lophn/ui` → 소스 폴더를 정하는 코드를 못 찾았으면 적는다
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 설치 사본에서 `@lophn/ui/<분류>`가 풀리는지(실제 앱을 만들어 release 준비까지)는 이 task에서 못 돌린다. lead가 core를 띄워 확인한다
