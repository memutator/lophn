# kit-sdk-move

sdk `ui-*`의 범용 자기 코드(AppShell·Grid·Sidebar, FilterBar 등, ReadState, ToastProvider)를 design 분류 폴더로 옮기고, 앱 bridge를 쓰는 부품(AppApiButton, useAppApi, AppErrorBoundary)만 새 sdk package `@lophn/app-ui` 하나에 남기고, 재export뿐인 `ui-*` 10개와 `@lophn/tokens`를 지운다. `guide.md`와 `examples/`는 이 task가 정리한다(예제는 gallery로).

- 단위: kit-sdk (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/sdk`
  - `packages/design/components`
  - `packages/shell/renderer/build.ts`
  - `packages/shell/renderer/workspace/workspace.module.css`
  - `packages/shell/renderer/workspace/panes/panes.module.css`
  - `packages/shell/renderer/workspace/top-path/breadcrumbs.module.css`
  - `packages/shell/renderer/conversation/message-list/message-body.module.css`
  - `tools/wireframes/build.ts`
  - `tools/wireframes/pages.ts`
  - `tools/wireframes/pages/kit`
  - `tools/wireframes/frames/design/sdk-pages.tsx`
  - `tools/wireframes/frames/compositions/project-files/pages.tsx`
  - 루트 `deno.lock`은 소유 표 밖이지만 이 task가 갱신한다(아래 8번)
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-sdk`, `classification.md` 3절 표 전부와 5절 6·8·9번
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 "지금에서 바꿀 것"
  - boundary: `project-docs/boundary-catalog.yaml`의 `sdk`, `sdk-api`, `design`
  - 이동 도구: `tools/move-files.ts` 머리 주석
- 계약:
  - 쓰는 것: `kit-layout`이 끝낸 `@lophn/ui` 분류 sub-path와 분류 `mod.ts`(한 줄 주석 형식 포함)
  - 내놓는 것:
    - design: `@lophn/ui/layout`에 AppShell, AppShellProps, Grid, GridProps, useContainerSpace, ContainerSpace, containerSpace. `@lophn/ui/navigation`에 Sidebar, SidebarItem, SidebarProps. `@lophn/ui/input`에 FilterBar, FilterBarProps, SearchFilter, SearchFilterProps, DateRangeFilter, DateRangeFilterProps, MultiSelectFilter, MultiSelectFilterProps, FilterOption, SEARCH_AFTER, rangeLabel, selectionLabel, RANGE_PRESETS, resolveRange, toDay, parseDay, DateRange, RangePreset. `@lophn/ui/feedback`에 ReadState, ReadStateProps, Freshness, isStale. `@lophn/ui/overlay`에 ToastProvider, ToastProviderProps, useToast, ToastQueue, ToastOptions.
    - sdk: package `@lophn/app-ui`(폴더 `packages/sdk/app-ui`)가 AppApiButton, AppApiButtonProps, AppApiInput, AppApiResult, AppApiSpec, AppApiState, AppBridge, appBridge, UseAppApi, useAppApi, AppErrorBoundary, AppErrorBoundaryProps, RENDER_ERROR_EVENT를 내보낸다.
    - 이름이 `@lophn/ui-*`, `@lophn/tokens`인 package는 repo에 없다.

## 할 일

근거: README `kit-sdk`, `classification.md` 3절·5절 6·8·9번. 정한 것: 남는 sdk package 이름은 `@lophn/app-ui`다(`@lophn/ui`는 design 배포 이름이고, 남는 둘은 "앱 bridge UI"라서 이름에 app을 넣었다). 옛 `ui-*`는 폴더마다 `guide.md`가 있었지만 `@lophn/ui`는 catalog package가 아니라 지원 소스라서(`packages/core/apps/packages/install.ts`의 주석) guide가 없다. `@lophn/app-ui`만 `guide.md` 하나를 둔다.

1. design으로 옮기는 코드(tool로 file을 옮기고, 한 파일에 섞인 것은 손으로 쪼갠다). mapping 파일은 worktree 밖 임시 경로에 쓰고 commit하지 않는다. 먼저 `--dry-run --report`.
   - `packages/sdk/ui-layout/app-shell.tsx`를 쪼갠다: `AppShell`, `useContainerSpace`, `SpaceContext`, `AppShellProps` → `packages/design/components/layout/app-shell/app-shell.tsx`, `Grid`, `GridProps` → `layout/grid/grid.tsx`, `Sidebar`, `SidebarItem`, `SidebarProps` → `navigation/sidebar/sidebar.tsx`. `space.ts` → `layout/app-shell/space.ts`. `layout.module.css`는 `.shell .bar .title .actions .body .nav .main`과 `.shell[data-space]` 규칙 → `app-shell.module.css`, `.sidebar .entry .item .label`과 좁을 때 한 줄이 되는 규칙 → `sidebar.module.css`, `.grid` → `grid.module.css`.
   - Sidebar가 좁을 때 한 줄이 되던 것은 AppShell의 `[data-space]`에 걸린 css였다. Sidebar가 `useContainerSpace()`를 읽어 자기 `<ul>`에 `data-space`를 달고 `sidebar.module.css`가 그것으로 규칙을 건다(`navigation/sidebar`가 `layout/app-shell/app-shell.tsx`의 `useContainerSpace`를 상대 경로로 import한다). 정한 것: 분류 사이 상대 import를 이 한 곳에서 허용한다.
   - `ui-filter/{filter-bar.tsx,date-range-filter.tsx,multi-select-filter.tsx,range.ts,filter.module.css}` → `components/input/filter/`
   - `ui-state/read-state.tsx` → `components/feedback/read-state/read-state.tsx`. 쓰는 css(`ReadState`가 쓰는 `.content` 등)만 `read-state.module.css`로 나눠 간다. `ui-state/state.module.css`의 `.failed .critical .message`는 AppErrorBoundary 몫이다(3번).
   - `ui-overlay/toast-queue.tsx` → `components/overlay/toast/toast-queue.tsx`
   - 옮긴 file이 `@lophn/ui/<분류>`로 import하던 것은 같은 package 안이 되니 파일을 직접 가리키는 상대 경로로 바꾼다(분류 `mod.ts`를 거치면 순환할 수 있다). `@lophn/wording`은 그대로다.
2. 분류 `mod.ts`에 위 "내놓는 것" export를 더한다. `kit-layout-guide`가 정한 형식대로 `export { ... } from` 문마다 바로 윗줄에 "언제 쓰나" 한 줄(`// ...`)을 단다. 옛 `ui-*/mod.ts` 머리 주석과 `guide.md`의 설명을 바탕으로 쓰되 코드와 맞는지 본다.
3. 새 package `packages/sdk/app-ui/`를 만든다.
   - `packages/sdk/ui-action/`를 폴더째 `packages/sdk/app-ui/`로 옮기고(`packages`에 `{"from":"@lophn/ui-action","to":"@lophn/app-ui"}`), `packages/sdk/ui-state/app-error-boundary.tsx`를 그 안으로 옮긴다. `deno.json`의 `version`은 `1.0.0` 그대로다.
   - `state.module.css`에서 `.failed .critical .message`만 `app-ui/state.module.css`로 가져온다(ReadState 쪽 규칙은 1번).
   - `mod.ts`는 AppApiButton·useAppApi·AppErrorBoundary export 문 세 묶음이다(머리 주석을 "앱 bridge를 쓰는 UI"로 고친다). design import는 `@lophn/ui/primitives`(Button, Icon, iconPixels), `@lophn/ui/feedback`, `@lophn/ui/shared`(componentMark, ControlSize)로 쓴다.
   - `guide.md` 하나: 옛 `ui-action/guide.md`와 `ui-state/guide.md`에서 AppApiButton·useAppApi·AppErrorBoundary 부분만 남겨 다시 쓴다. `@lophn/ui-*`·`@lophn/tokens` 이름을 쓰지 않는다.
4. 지운다: `packages/sdk/ui-control`, `ui-layout`, `ui-overlay`, `ui-reading`, `ui-table`, `ui-chart`, `ui-filter`, `ui-stat`, `ui-state`, `packages/sdk/tokens`(폴더째. `examples/`와 `guide.md`는 5번에서 옮긴 뒤). `@lophn/tokens`의 `tokenNames/tokens/vars`는 `@lophn/ui` root가 이미 같은 이름을 내보낸다. 정한 것: `@lophn/tokens`도 재export뿐이라(`classification.md` 1절) 같이 지운다.
5. 예제를 gallery로 옮긴다(5절 9번). tool로 옮기고, 예제 안의 `@lophn/ui-*`·`@lophn/tokens` import는 손으로 `@lophn/ui/<분류>`·`@lophn/app-ui`·`@lophn/ui`(token)로 고친다. `tools/wireframes/frames/design/sdk-pages.tsx`의 import 경로는 tool이 고친다.

   | from (`packages/sdk/...`) | to (`tools/wireframes/pages/kit/...`) |
   |---|---|
   | `ui-control/examples/control-sizes.{tsx,module.css}` | `input/` |
   | `ui-filter/examples/orders-filters.tsx` | `input/` |
   | `ui-layout/examples/orders-app.{tsx,module.css}` | `layout/` |
   | `ui-table/examples/orders-table.tsx`, `ui-stat/examples/orders-summary.tsx`, `ui-chart/examples/sales-dashboard.tsx` | `data/` |
   | `ui-state/examples/orders-status.tsx` | `feedback/` |
   | `ui-overlay/examples/overlays.{tsx,module.css}` | `overlay/` |
   | `ui-reading/examples/weekly-report.{tsx,module.css}` | `reading/` |
   | `ui-action/examples/order-actions.{tsx,module.css}` | `app-ui/` (design 분류가 아니다. AppApiButton은 sdk다) |
   | `tokens/examples/chart-colors.ts` | `tokens/` |

   예제의 `.module.css` 5개는 지금 그대로 옮긴다(check 1이 `kit-checks`에서 서기 전까지 gallery 정리 task들이 없앤다).
6. 남은 참조를 고친다.
   - `packages/shell/renderer/build.ts`: import map에 `../sdk/<name>/`을 올리는 반복(`tokens`, `ui-control` … `ui-chart`)을 지운다(renderer는 sdk를 import하지 않는다).
   - `tools/wireframes/build.ts`: sdk 폴더를 도는 반복과 머리 주석을 `@lophn/app-ui`가 들어가도록 맞춘다(단순화해도 된다).
   - `tools/wireframes/frames/compositions/project-files/pages.tsx`: `@lophn/ui-control`의 Button → `@lophn/ui/primitives`.
   - `tools/wireframes/pages.ts`: description에서 `@lophn/ui-*`·`@lophn/tokens`·"SDK 예제(ui-...)"를 새 이름(`@lophn/ui/<분류>` 예제, `@lophn/app-ui`)으로 고친다. 11개 page.
   - renderer css 주석 4개(`workspace.module.css`, `panes.module.css`, `breadcrumbs.module.css`, `message-body.module.css`)의 "legacy ui-layout …"·"legacy ui-reading …"에서 `ui-*` 이름을 뺀다("옛 AppShell"처럼 쓰거나 줄을 지운다).
7. `check-wording`·`style-check`가 새 자리(`packages/design/components`, `packages/sdk/app-ui`)를 훑는다. 위반이 나오면 고친다(색·간격 token, wording key).
8. `packages/sdk/*`는 workspace glob이라 폴더만 만들면 member가 된다. 지운 member와 새 member 때문에 `deno.lock`의 `workspace.members`가 바뀐다. `deno install --frozen=false`(또는 `deno cache --frozen=false`)로 한 번 갱신하고 diff가 member 항목 외에 의존 판을 바꾸지 않는지 확인한다.
9. 문서(architecture, ui-design skill)와 `lophn-build-app` skill은 이 task가 고치지 않는다(skill은 `kit-sdk-publish`, 나머지는 lead).

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음 (옮기기뿐이다. 코드가 바뀌는 곳은 Sidebar의 `data-space` 하나인데 화면 동작이라 test하지 않는다)
- 남지 않음:
  - `ls packages/sdk`에 `ui-*`, `tokens`가 없고 `app-ui`가 있다.
  - `grep -rnE --exclude-dir=node_modules --exclude-dir=dist "@lophn/(ui-[a-z]+|tokens)|\bui-(control|overlay|layout|reading|table|chart|filter|stat|state|action)\b" packages tools | grep -v "^packages/core/"`가 0줄이다(core는 `kit-sdk-publish`).
  - `grep -rn "packages/sdk/\(ui-\|tokens\)" packages tools`가 0줄이다.
- (화면) gallery의 SDK page 11개가 옮긴 예제로 그려진다. 예제 화면이 이전과 같다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (루트 `deno.lock` 갱신 여부)
- 안 쓰게 된 export: 없음 (옮긴 이름은 새 자리에 그대로 있다)
- 정한 것: `@lophn/app-ui` 이름, `@lophn/tokens` 삭제, 분류 사이 상대 import 한 곳, CSS 나눈 방법
- 넘길 줄: `tools/wireframes/pages.ts`·`sdk-pages.tsx`는 이름만 맞췄다(`kit-gallery-*`가 다시 짠다)
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 예제의 `.module.css` 5개가 `pages/kit/` 안에 있다(`kit-gallery-*`가 없앤다). 앱 template과 `FIXED_UI_DEPENDENCIES`는 아직 옛 이름이다(`kit-sdk-publish`)
