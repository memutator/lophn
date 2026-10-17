# kit-layout-chart

`@lophn/chart`(`packages/design/chart/`)를 design 안으로 합친다. 파일은 `packages/design/components/data/chart/`로 가고, 독립 package(자기 `deno.json`, workspace 항목, 패키지 이름 `@lophn/chart`)는 없어진다.

- 단위: kit-layout (wave 1)
- 선행: kit-layout-move
- 소유(이 task만 고친다):
  - `packages/design`
  - `packages/sdk/ui-chart`
  - `packages/shell/renderer/build.ts`
  - `tools/wireframes/build.ts`
  - `tools/wireframes/pages.ts`
  - 루트 `deno.json`(workspace 줄 하나)·`deno.lock`은 소유 표 밖이지만 이 task가 고친다(아래 5번)
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-layout`, `classification.md` 1절 chart 행
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 "지금에서 바꿀 것" 마지막 줄
  - boundary: `project-docs/boundary-catalog.yaml`의 `design`
  - 이동 도구: `tools/move-files.ts` 머리 주석
- 계약:
  - 쓰는 것: `kit-layout-move`의 분류 barrel(`packages/design/components/data/mod.ts`)과 `@lophn/ui` 이름
  - 내놓는 것: `@lophn/ui/data`가 LineChart, BarChart, DistributionChart, ScatterChart, GraphDiagram(+ Props 타입, ChartLocaleProps, ChartStateProps, GraphEdge, GraphNode, ScatterGroup, ScatterPoint, Series, ALL_PAIRS_MAX, SLOT_COUNT)를 내보낸다. `@lophn/chart` 이름은 코드에 없다(앱 template과 `FIXED_UI_DEPENDENCIES`는 `kit-sdk-publish`가 지운다).

## 할 일

근거: README `kit-layout`("`@lophn/chart`를 `data/`로 합친다"), `classification.md` 1절(chart는 `check-deps`로는 이미 design이다. 합치는 일은 `deno.json`·workspace 항목·이름이다).

1. mapping 파일(worktree 밖 임시 경로, commit하지 않는다)으로 `packages/design/chart/`를 `packages/design/components/data/chart/`로 옮긴다. `mod.ts`는 `data/chart/mod.ts`로 두지 말고 export 문을 `components/data/mod.ts`로 합친 뒤 지운다. `packages/design/chart/deno.json`은 지운다(`remove`). 파일은 `bar-chart.tsx bar-layout.ts bar-plot.tsx bins.ts chart-frame.tsx chart.module.css distribution-chart.tsx format.ts geometry.ts graph-diagram.tsx graph-layout.ts line-chart.tsx marks.tsx palette.ts preflight.ts scatter-chart.tsx types.ts use-active.ts validate.ts`.
2. chart 코드가 `@lophn/ui`(token, components)를 package 이름으로 import하던 줄(`palette.ts`, `geometry.ts`, `graph-layout.ts`, `chart-frame.tsx`)은 같은 package 안이 되니 상대 경로로 바뀐다(tool이 한다). 다른 분류 `mod.ts`를 거치지 말고 파일을 직접 가리킨다(순환 방지). `@lophn/wording`은 그대로다.
3. `packages/design/deno.json`의 `imports`에 chart가 쓰던 `d3-scale`, `d3-shape`, `@types/d3-scale`, `@types/d3-shape`(판은 `chart/deno.json` 그대로)를 옮긴다. `chart/deno.json`의 `compilerOptions.types`는 `../components/css-modules.d.ts`였고 design `deno.json`이 이미 같은 파일을 가리킨다.
4. `@lophn/chart`를 쓰던 곳을 `@lophn/ui/data`로 고친다: `packages/sdk/ui-chart/mod.ts`(`kit-sdk-move`가 이 package를 지운다. 지금은 type check만 서게 한다), `packages/sdk/ui-chart/examples/sales-dashboard.tsx`, `packages/shell/renderer/build.ts`의 `addPackage(imports, new URL("chart/", design))` 줄, `tools/wireframes/build.ts`의 `addPackage(imports, join(root, "packages/design/chart"))` 줄과 머리 주석, `tools/wireframes/pages.ts` description의 `@lophn/chart` 언급.
5. 루트 `deno.json`의 `workspace`에서 `"./packages/design/chart"`를 뺀다. `lock`이 frozen이라 `deno.lock`의 `workspace.members`에 `packages/design/chart` 항목이 남으면 check가 실패한다. `deno install --frozen=false`(또는 `deno cache --frozen=false`)로 한 번 갱신하고, diff가 chart 항목 삭제와 design 항목에 d3 판 넷이 합쳐지는 것 외에 의존 판을 바꾸지 않는지 확인한다. 다르면 보고한다.
6. 문서는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음 (옮기기뿐이다)
- 남지 않음:
  - `ls packages/design`에 `chart`가 없다.
  - `grep -rn --exclude-dir=node_modules --exclude-dir=dist "@lophn/chart" packages tools`가 `packages/core/apps/releases/ui-build/build.ts`, `packages/core/apps/packages/install.ts`(주석) 두 곳만 남긴다(`kit-sdk-publish`가 지운다).
  - `grep -n "design/chart" deno.json`이 0줄이다.
- (화면) gallery의 SDK · charts page가 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (루트 `deno.json`·`deno.lock`을 이 task가 고쳤다고 적는다)
- 안 쓰게 된 export: 없음
- 정한 것: `data/chart/` 폴더 이름과 위치, 그 밖에 정한 것
- 넘길 줄: `packages/sdk/ui-chart`의 import만 맞춘 곳(`kit-sdk-move`가 지운다)
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 없음이 기본

## lead가 더함

- (lead가 더함) `kit-layout-move` 뒤 chart 파일의 package 이름 import는 `chart-frame.tsx`(`@lophn/ui/primitives`, `@lophn/ui/data`, `@lophn/ui/feedback`, `@lophn/ui/shared`)와 `geometry.ts`·`graph-layout.ts`·`palette.ts`(`@lophn/ui`의 `tokens`)다. `move-files.ts`가 package 이름 specifier를 상대 경로로 바꾸지 않으면 손으로 고친다. 같은 package 안의 file을 직접 가리킨다(예: `../../../tokens.ts`, `../../feedback/skeleton/skeleton.tsx`, `../table/...`). 특히 `@lophn/ui/data`를 그대로 두면 `data/mod.ts` → `chart-frame.tsx` → `data/mod.ts` 순환이다. 확인: `grep -rn "@lophn/ui" packages/design/components`가 0줄.
- (lead가 더함) `kit-layout-move`는 `deno.lock`을 갱신할 필요가 없었다(패키지 이름만 바뀌었다). 이 task는 workspace 항목을 빼니 lock이 바뀔 것이다. 실제로 된 명령(예: `deno install --frozen=false`가 되는지, 아니면 다른 명령인지)을 보고의 "정한 것"에 그대로 적는다. `packages/shell/main/desktop/core/deno.lock` 변경은 commit하지 않는다.
- (lead가 더함) `check:full`에서 `packages/core/apps/calls/calls_test.ts`의 "write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다"가 한 번 실패하면 다시 돌린다(이 task와 무관한 timing test다). 두 번 실패하면 보고한다.
