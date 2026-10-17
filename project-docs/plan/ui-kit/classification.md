# UI kit 분류 표 (초안)

사람이 "5. 사람이 정할 것"만 고르면 된다. 나머지 행은 추천안이다. 근거는 `project-docs/products/roadmap/ui-kit-single-source.md`의 요구 4(범용성이 기준)와 코드를 grep으로 센 값이다. 코드는 건드리지 않았다.

세는 법: renderer = `packages/shell/renderer`(dist 제외)에서 그 이름을 `@lophn/design*`·`@lophn/chart`로 import하는 파일 수. sdk = `packages/sdk/ui-*/mod.ts`가 재export하는 곳. wf = `tools/wireframes`(gal = `frames/design/components-pages.tsx` gallery에 실제 component로 나옴, +n = 그 밖의 wireframe 파일 수). 앱 = 앱 template(`packages/core/apps/packages/template/app`)이나 `sdk/ui-*/guide.md`가 쓰는 곳.

## 1. 사실 확인

### 지금 모양

| roadmap 문장 | 판정 | 코드가 보여 주는 것 |
|---|---|---|
| design: token(`tokens.ts` → `generated/tokens.css`) | 맞음 | `packages/design/tokens.ts`, `generate.ts`, `generated/tokens.css`. |
| 평평한 `components/`에 약 40개 export | 맞음(수는 다름) | `components/` 하위 폴더 36개. `components/mod.ts`의 값 export는 86개: PascalCase component 57, hook 5(`useDelayedLoading`, `useObservedSize`, `useReadingWidth`, `useTocPlacement`, `useCopy`), 나머지 24는 helper·상수·`system*`. `reading/mod.ts` 값 export 6, `chart/mod.ts` 7, root `mod.ts` 3(`tokens`, `tokenNames`, `vars`). |
| `reading`, `wording` | 맞음 | `packages/design/reading/`, `packages/design/wording/`(`@lophn/wording`). design component 폴더 12개가 `t()`/`formatNumber`로 wording을 import한다. |
| CSS는 `style-check`가 token만 쓰게 막는다 | 맞음(범위 확인) | `packages/design/style-check/work.ts`가 보는 곳은 `packages/shell/renderer/`, `packages/design/`, `packages/sdk/*/`다. `tools/wireframes`의 CSS 9파일(1142줄)은 검사 밖이다. |
| chart는 `@lophn/chart`로 따로 있다 | 맞음(위치 보충) | 위치는 `packages/design/chart/`다(자체 `deno.json`, root `deno.json` workspace 멤버). 별도 최상위 package가 아니라 design 폴더 안이라 `check-deps`는 design으로 본다. chart 코드는 `@lophn/design`(tokens, components)과 `@lophn/wording`을 import한다. renderer는 `@lophn/chart`를 import하지 않는다(0). sdk `ui-chart`와 wireframe의 sdk 예제만 쓴다. |
| sdk `ui-*` 10개 | 맞음 | `ui-action, chart, control, filter, layout, overlay, reading, stat, state, table`. |
| 대부분 design 재export, 자기 코드는 `ui-layout`, `ui-filter`, `ui-state`, `ui-action`뿐 | 다름 | 자기 코드가 있는 것은 5개다. `ui-overlay/toast-queue.tsx`(79줄: `ToastProvider`, `useToast`, `ToastQueue`)가 빠졌다. 재export뿐인 것은 5개(`control, reading, stat, table, chart`). 또 모든 `ui-*`에 `guide.md`와 `examples/`가 있다(`tools/wireframes/frames/design/sdk-pages.tsx`가 예제 10개를 import). |
| `ui-control`에 "시각 값의 정본은 shell/design-system" 낡은 주석 | 맞음 | `packages/sdk/ui-control/mod.ts:2`. `packages/shell/design-system`은 없다. |
| renderer는 design을 import한다 | 맞음 | `@lophn/design/components` import 146, `/reading` 2, root 4. 같은 곳이 `@lophn/wording`을 182 import한다. |
| renderer는 sdk를 import하지 않는다(`tools/check-deps.ts`) | 맞음 | `PACKAGE_DEPENDENCIES`: `shell: [protocol, base, design]`, `sdk: [protocol, design]`, `design: []`. 목록에 없으면 위반이라 shell→sdk, sdk→shell, design→renderer(shell)가 모두 막힌다. renderer가 sdk를 import하는 줄은 0. `tools/`는 이 표 밖이라 wireframe은 renderer와 sdk를 둘 다 import한다. |
| 앱 UI build는 `FIXED_UI_DEPENDENCIES` 밖 package를 거절 | 맞음 | `packages/core/apps/releases/ui-build/build.ts:16`(roadmap은 `packages/` 접두를 뺐다). 19개: `@lophn/blueprint`, `@lophn/tokens`, `ui-control/overlay/layout/reading/table/chart/filter/stat/state/action` 10개, `@lophn/design`, `@lophn/chart`, `@lophn/wording`, `react`, `react-dom`. 이름이 박힌 다른 곳: 앱 template 4파일(`deno.json.tmpl`, `blueprint.ts.tmpl`, `src/screens/items/app.tsx.tmpl`, `main.tsx.tmpl`), `releases/prepare/from-source.ts`, `packages/install.ts`. |
| release 때 사본을 bundle에 굳힌다 | 맞음 | `from-source.ts`가 `sdkCopies`·`vendorCopies`·`uiDependencies`를 넘긴다. |
| sdk package는 `sdk/<part>/<version>`에 read-only로 설치 | 맞음 | `packages/core/apps/packages/install.ts:78,147`(디렉터리 0555, 파일 0444). |
| `tools/wireframes/frames/compositions/` 22파일(약 3.2k줄)이 renderer를 import | 맞음 | `compositions/`는 모두 58파일(6041줄). renderer를 import하는 tsx/ts는 정확히 22파일, 3169줄. 단 `agent-avatar.tsx`는 renderer icon만 import하고 Avatar를 따로 그린 복사본이다(아래 4절). |
| 14파일(약 1.2k줄)은 wireframe에만 있는 코드 | 맞음(범위 보충) | renderer를 import하지 않는 tsx가 정확히 14파일, 1217줄. 그런데 renderer를 import하지 않는 파일은 36개다. 나머지 22파일(1655줄: CSS 7파일 608줄, data 8파일 592줄, 가짜 통로 1파일 123줄, drive·helper 6파일 332줄)을 roadmap은 세지 않았다. 이 22파일에 복사본이 있다(`compose.module.css`, `files.module.css`의 palette*, `agents.module.css`, `app-space.module.css`). 4절에서 다룬다. |
| `lophn-build-app` skill은 ui package나 token을 언급하지 않는다 | 맞음 | `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`에 `ui`, `token`, `@lophn/` grep 결과가 없다. 반면 앱 template은 `@lophn/ui-control/layout/state`와 `@lophn/design/tokens.css`를 이미 쓴다. |

### 지금에서 바꿀 것

| roadmap 행 | 판정 | 코드가 보여 주는 것 |
|---|---|---|
| `ui-*` 10개를 지우고 `@lophn/ui`로 배포, `FIXED_UI_DEPENDENCIES`도 고침 | 맞음(범위 보충) | 고칠 곳은 `FIXED_UI_DEPENDENCIES`(10개 항목)뿐 아니라 앱 template 4파일, `sdk/ui-*/guide.md` 10개와 `examples/` 10개(wireframe `sdk-pages.tsx`가 import), `tools/wireframes/build.ts`(sdk 폴더를 돌며 import map 구성), `packages/sdk/tokens`(design token 재export). |
| `ui-layout`/`ui-filter`/`ui-state`의 범용 부품을 design으로 | 맞음(보충) | `ui-overlay`의 `ToastProvider`/`useToast`도 범용이라 같이 옮긴다. 3절. |
| 앱 bridge를 쓰는 부품(AppApiButton, AppErrorBoundary)은 sdk에 하나로 | 맞음(확인 필요) | `AppApiButton`·`useAppApi`는 `@lophn/blueprint`와 `globalThis.lophnApp`을 직접 쓴다. `AppErrorBoundary`는 bridge를 부르지 않고 `lophn:render-error` DOM event를 보낸다(`packages/shell/preload/app-api.ts:157`이 듣는다). 5절 8번. |
| design 안의 lophn 전용 부품은 renderer로 | 맞음 | 2절 `lophn 전용` 행: Avatar, VendorIcon, Chip, AuthorMark, (TabStrip). |
| `components/` 평평한 약 40개를 분류 폴더 8개로 | 맞음 | 2절 표의 분류 열. |
| wireframe 전용 코드 14파일을 renderer·design이나 `drafts/`로 | 맞음(보충) | 14파일 대부분은 코드가 아니라 page 정의다(4절). 옮길 코드는 거의 없다. |
| `@lophn/chart`를 design의 `data/`로 | 맞음 | 이미 `packages/design/chart/`다. 합치는 일은 `deno.json`·workspace 항목·`FIXED_UI_DEPENDENCIES`·`install.ts`에서 `@lophn/chart` 경계를 걷는 일이다. |

### 그 밖에 찾은 것

- check 2("design의 모든 export가 kit page에 한 번은 나온다")를 지금 gallery(`components-pages.tsx`)에 대면 실제 component로 나오지 않는 것이 있다: Avatar, VendorIcon, Menu, MenuIcon, Dialog, Sheet, Palette, DataTable, DataState, Loading, Markdown, CodeBlock, Toc, FileIcon, TabStrip. Menu·Dialog·Sheet·Palette는 gallery가 같은 CSS Module로 짠 look-alike를 그린다(파일 머리 주석). 차트 5종은 sdk 예제(`sales-dashboard.tsx`)로만 나온다.
- renderer에서 쓰는 곳이 0인 design export: Chip, AuthorMark, Table(DataTable 내부용), Tree, StatTile/StatRow, 페이지 틀 7종(Form, Launcher, Overview, Dashboard, ListDetail, Table; ReadingFrame만 1), CodeBlock, Toc, 차트 전부. 범용 kit인 동시에 renderer가 안 쓰는 부품이 많다.

## 2. design component 표

분류: primitives / layout / navigation / data / feedback / overlay / reading / input, 지원 export는 `_shared`. 기준으로 정하기 어려웠던 행은 5절이 근거를 적는다.

| 이름 | 지금 file (`packages/design/...`) | 쓰는 곳 | 제안 분류 | 범용/전용 | 근거 |
|---|---|---|---|---|---|
| Button | components/button/button.tsx | renderer 68, sdk control, wf gal+2, 앱 template·guide | primitives | 범용 | 가장 기본 조작. 앱 template이 이미 쓴다. |
| IconButton | components/icon-button/icon-button.tsx | renderer 41, sdk control, wf gal | primitives | 범용 | 이름 있는 icon 단추. |
| Icon, iconPixels, folderOpenIcon | components/icon.tsx, shared.ts | renderer 30, sdk control(+layout/action/filter/state 내부), wf gal+3 | primitives | 범용 | lucide를 token 크기로 감싼다. `folderOpenIcon`은 wireframe tokens-pages만 쓴다(지워도 된다). |
| Kbd | components/kbd/kbd.tsx | renderer 3, sdk control, wf gal | primitives | 범용 | 키 표시. |
| CopyButton, useCopy | components/copy-button/ | renderer 1, sdk control, wf gal | primitives | 범용 | clipboard를 인자로 받는 일반 단추. |
| Field, FieldContext | components/field/ | renderer 24, sdk control, wf gal, 앱 template | input | 범용 | label·오류를 묶는 form 칸. |
| Input | components/input/input.tsx | renderer 14, sdk control, wf gal, 앱 template | input | 범용 | |
| Textarea | components/textarea/textarea.tsx | renderer 6, sdk control, wf gal | input | 범용 | |
| Select | components/select/select.tsx | renderer 14, sdk control, wf gal | input | 범용 | |
| Checkbox | components/checkbox/checkbox.tsx | renderer 1, sdk control, wf gal | input | 범용 | |
| Switch | components/switch/switch.tsx | renderer 3, sdk control, wf gal | input | 범용 | |
| Card | components/card/card.tsx | renderer 7, sdk layout, wf gal | layout | 범용 | 내용 묶음 틀. |
| FormFrame | components/page-frames/frames.tsx | renderer 0, sdk layout, wf gal | layout | 범용 | 페이지 틀. sdk 예제가 쓴다. |
| DashboardFrame, DashboardCell | components/page-frames/frames.tsx | renderer 0, sdk layout, wf gal | layout | 범용 | 12 column 격자. |
| ListDetailFrame | components/page-frames/frames.tsx | renderer 0, sdk layout, wf gal | layout | 범용 | |
| TableFrame | components/page-frames/frames.tsx | renderer 0, sdk layout, wf gal | layout | 범용 | |
| ReadingFrame, READING_WIDTHS, useReadingWidth 등 | components/page-frames/reading-frame.tsx, reading-width.ts, toc-placement.ts, model.ts | renderer 1(폭 설정), sdk layout·reading, wf gal+1 | layout | 범용 | 읽기 폭·목차 위치 틀. `DEFAULT_READING_WIDTH`·`readingWidthOf`는 lophn 설정이 쓰지만 틀 자체는 범용. |
| LauncherFrame | components/page-frames/frames.tsx | renderer 0, sdk 없음, wf gal | — | 지움 | 폭 틀(1040px)일 뿐 lophn launcher 화면이 아니다. 쓰는 곳이 gallery뿐이고 sdk도 공개하지 않는다. 5절 4번. |
| OverviewFrame | components/page-frames/frames.tsx | renderer 0, sdk 없음, wf gal | — | 지움 | 폭 틀(800px). 같음. 5절 4번. |
| useObservedSize, ResizeSource 등 | components/resize.ts | renderer 4, sdk layout(AppShell 내부), wf 0 | layout | 범용(지원) | 폭 관측. `shared`와 함께 5절 7번. |
| Tabs, TabList, Tab, TabPanel | components/tabs/tabs.tsx | renderer 4, sdk layout, wf gal | navigation | 범용 | Radix tabs. |
| TabStrip, TabItem, TabDot | components/tab-strip/tab-strip.tsx | renderer 3, sdk 없음, wf +1(project-app) | — | lophn 전용 → renderer | 점이 session 상태(`waiting/working/ended`)다. 5절 1번. |
| Table(+cells) | components/table/ | renderer 0(DataTable 내부), sdk 없음, wf gal | data | 범용 | 표의 칸 모양. sdk는 `TableColumn` type만 노출. |
| DataTable, DataState, sortRows·pageSlice 등 | components/data-table/ | renderer 1, sdk table, wf 0 | data | 범용 | 정렬·페이지·열 선택·가상 scroll. |
| Tree, TreeNode | components/tree/ | renderer 0, sdk 없음, wf gal | data | 범용 | |
| List, ListItem | components/list/list.tsx | renderer 4, sdk layout, wf gal | data | 범용 | sdk는 ui-layout에 넣었지만 행 목록이라 data로 본다. |
| StatTile, StatRow | components/stat-tile/stat-tile.tsx | renderer 0, sdk stat, wf gal | data | 범용 | |
| LineChart | chart/line-chart.tsx | renderer 0, sdk chart, wf sdk 예제 | data | 범용 | `@lophn/chart` 합치기. |
| BarChart | chart/bar-chart.tsx | 같음 | data | 범용 | |
| DistributionChart | chart/distribution-chart.tsx | 같음 | data | 범용 | |
| ScatterChart | chart/scatter-chart.tsx | 같음 | data | 범용 | |
| GraphDiagram | chart/graph-diagram.tsx | 같음 | data | 범용 | |
| Loading, Skeleton, useDelayedLoading | components/skeleton/ | renderer 20/34, sdk state, wf gal(Skeleton) | feedback | 범용 | 300ms 지연 skeleton. |
| EmptyState | components/empty-state/empty-state.tsx | renderer 4, sdk state, wf gal | feedback | 범용 | |
| ErrorState | components/error-state/error-state.tsx | renderer 35, sdk state, wf gal | feedback | 범용 | |
| StaleNote | components/stale-note/stale-note.tsx | renderer 1, sdk state, wf gal | feedback | 범용 | |
| StatusMark, STATUS_ICONS | components/status-mark/status-mark.tsx | renderer 20, sdk 없음, wf gal+1 | feedback | 범용 | tone 5개 아이콘+글. sdk가 안 내보내던 범용 부품. |
| Toast, ToastStack | components/toast/toast.tsx | renderer 10/1, sdk overlay, wf gal+1 | overlay | 범용 | 화면 위에 뜬다. sdk도 overlay에 둔다. 5절 6번. |
| Tooltip | components/tooltip/tooltip.tsx | renderer 25, sdk overlay, wf gal | overlay | 범용 | |
| Popover, PopoverRow | components/popover/popover.tsx | renderer 5/1, sdk overlay(+filter), wf gal | overlay | 범용 | |
| Menu, MenuIcon | components/menu/menu.tsx | renderer 8/3, sdk overlay, wf look-alike | overlay | 범용 | `MenuItem.leading`은 호출자가 채운다. |
| Dialog | components/dialog/dialog.tsx | renderer 10, sdk overlay, wf look-alike+1 | overlay | 범용 | |
| Sheet | components/sheet/sheet.tsx | renderer 1, sdk 없음, wf look-alike | overlay | 범용 | non-modal Dialog. |
| Palette | components/palette/palette.tsx | renderer 1, sdk overlay, wf look-alike+1 | overlay | 범용 | items·onSelect를 받는 일반 command palette. |
| Markdown, parseMarkdown, safeUrl, 타입 | reading/markdown/ | renderer 1, sdk reading | reading | 범용 | raw HTML 안 실행. |
| CodeBlock | reading/code-block/code-block.tsx | renderer 0, sdk reading | reading | 범용 | |
| Toc | reading/toc/toc.tsx | renderer 0, sdk reading | reading | 범용 | |
| DiffMark, DiffLine(type) | components/status-mark/status-mark.tsx, reading/diff-view/diff-view.tsx | renderer 3/1, sdk 없음, wf gal | reading | 범용 | +/− 표식과 diff 줄 type. `diff-view.tsx`는 type 16줄뿐이고 DiffView component는 없다. |
| Avatar, AvatarProfile | components/avatar/ | renderer 12, sdk 없음, wf 0(wireframe은 복사본을 따로 둔다) | — | lophn 전용 → renderer | `AVATAR_ICONS`가 agent profile icon 집합의 정본. 5절 3번. |
| AuthorMark | components/author-mark/author-mark.tsx | renderer 0, sdk 없음, wf gal | — | 지움 | agent 작성 표식. 쓰는 곳이 gallery뿐. 5절 5번. |
| VendorIcon, vendorOf, Vendor | components/vendor-icon/ | renderer 8/8, sdk 없음, wf 0 | — | lophn 전용 → renderer | harness·provider 15개 로고(claude-code, codex, openrouter…). 앱이 쓸 이유가 없다. |
| Chip, ChipItem | components/chip/chip.tsx | renderer 0, sdk 없음, wf gal | — | 지움 | 이름은 chip이지만 lophn 대기 질문 안내다. 쓰는 곳이 gallery뿐. 5절 5번. |
| FileIcon, fileIconName | components/file-icon/file-icon.tsx | renderer 3, sdk 없음, wf +1 | primitives | 범용 | 앱도 파일 목록을 그린다. catppuccin json 의존이 앱 bundle에 들어간다. 5절 2번. |
| componentMark, ControlSize, Clock/Timer/Clipboard, systemClock/Timer/Clipboard, cx | components/shared.ts | renderer 2/1(system*), sdk 4개 package가 componentMark | `_shared` | 범용 | 5절 7번. |
| tokens, tokenNames, vars, 타입 | mod.ts, tokens.ts, generated/ | renderer 1(+타입 3), sdk tokens·layout, wf tokens-pages | 분류 밖(token) | 범용 | design root에 그대로 둔다. |

행 수와 분류별 개수는 맨 아래 "개수".

## 3. sdk `ui-*` 자기 코드 표

| 이름 | 지금 file (`packages/sdk/...`) | app bridge(cap-*, app-api)를 쓰나 | 제안 | 근거 |
|---|---|---|---|---|
| AppShell, useContainerSpace | ui-layout/app-shell.tsx, space.ts, layout.module.css | 안 씀. design(`useObservedSize`, `Icon`)과 `tokens`만 import | design layout | 앱 view의 화면 틀. bridge 없음. |
| Grid | ui-layout/app-shell.tsx | 안 씀 | design layout | |
| Sidebar, SidebarItem | ui-layout/app-shell.tsx | 안 씀 | design navigation | 앱 안 nav. |
| FilterBar, SearchFilter | ui-filter/filter-bar.tsx, filter.module.css | 안 씀. 고른 값은 props로만 나간다 | design input | |
| DateRangeFilter, rangeLabel | ui-filter/date-range-filter.tsx | 안 씀 | design input | |
| MultiSelectFilter, selectionLabel, SEARCH_AFTER | ui-filter/multi-select-filter.tsx | 안 씀 | design input | |
| RANGE_PRESETS, resolveRange, toDay, parseDay | ui-filter/range.ts | 안 씀(순수 함수) | design input | 날짜 범위 계산. |
| ReadState, Freshness, isStale | ui-state/read-state.tsx, state.module.css | 안 씀(Loading·ErrorState·EmptyState·StaleNote 조합) | design feedback | 앱 template이 쓴다. |
| AppErrorBoundary, RENDER_ERROR_EVENT | ui-state/app-error-boundary.tsx | 직접 호출은 안 함. `lophn:render-error` DOM event를 보내 preload bridge(`shell/preload/app-api.ts`)가 받는다 | sdk에 남김 | event 이름이 shell과의 계약. 5절 8번. |
| AppApiButton | ui-action/app-api-button.tsx, action.module.css | 씀: blueprint `AppApiDeclaration`, `lophnApp.call` | sdk에 남김 | roadmap과 같다. |
| useAppApi, appBridge, AppBridge 등 | ui-action/use-app-api.ts | 씀: `globalThis.lophnApp` | sdk에 남김 | |
| ToastProvider, useToast, ToastQueue | ui-overlay/toast-queue.tsx | 안 씀. design Toast·ToastStack과 timer·clock 인자만 쓴다 | design overlay | roadmap이 놓친 자기 코드. |

나머지 5개(`ui-control`, `ui-reading`, `ui-stat`, `ui-table`, `ui-chart`)는 재export뿐이고 `guide.md`·`examples/`만 남는다. 지운 뒤 이 문서·예제의 자리는 5절 9번.

## 4. wireframe 전용 코드 표

제안 열의 "screens"는 roadmap의 `pages/screens/`다. 이 14파일 대부분은 새로 정의한 component가 아니라 실제 renderer 화면을 고정 상태로 놓는 page 정의라서 renderer·design으로 옮길 코드가 거의 없다.

### 4A. renderer를 import하지 않는 tsx 14파일 (1217줄)

| file (`tools/wireframes/frames/compositions/...`) | 무엇 | 제안 | 근거 |
|---|---|---|---|
| agent-pages.tsx (95) | Agent 화면 page 이름 export 22개. `ProjectApp`을 상태별로 놓는다 | screens | 새 component 정의 없음. |
| agent-tab/scenes.tsx (66) | `ProjectApp` 위에 agent 장면 16개를 고정 | screens | 같음. |
| app-space/pages.tsx (148) | 앱 공간 page 23개(`AppSpace`의 prop을 고정) | screens | |
| contexts/context-pages.tsx (120) | Contexts 화면 page 정의 | screens | |
| project-pages.tsx (89) | project 화면 page 정의 | screens | |
| project-files/pages.tsx (249) | 파일 탭·검색·팔레트 page. `@lophn/ui-control` Button을 import(wireframe이 sdk를 씀) | screens | design의 `Button`으로 바꾼다. 팔레트 page는 look-alike CSS 대신 실제 `Palette`로(아래 CSS). |
| ways-page.tsx (52) | Context 탭을 여는 길을 상자·화살표로 그린 설명 page | drafts | 화면이 아니라 설명 그림. 자기 CSS(`compose.module.css`의 `.ways*`)가 있다. |
| contexts/glossary.tsx (11) | 용어집 시연 상태의 click selector 상수 | mock (harness) | 코드 11줄, 상수뿐. |
| contexts/host.tsx (55) | `ProjectApp`을 감싸 탭 열기를 주입 | mock (harness) | gallery 전용 wrapper. 실제 `ProjectApp`의 `open` 규칙을 복제(`openIn`). |
| contexts/pm-session.tsx (126) | Project Manager 대화 장면(`agent-chat`의 조각으로 조립) | screens | 새 component 아님. |
| driven.tsx (20) | 마운트 뒤 steps를 눌러 상태를 고정하는 wrapper | mock (harness) | |
| link.tsx (21) | 눌러서 탭을 여는 글 링크(`compose.module.css`) | drafts | CSS 때문에 check 1이 drafts를 요구한다. 쓸 곳은 ways·pm-session뿐. |
| workspace/register-panel.tsx (17) | 등록 dialog 채우는 동작 목록 | mock (harness) | |
| app-space/orders-view.tsx (148) | Orders 앱이 그린 view의 고정 그림 + annotate 표식(hover·picked·area·memo) | mock | 앱 view는 사용자 앱이라 lophn 화면이 아니다. annotate 표식은 `shell/preload/annotate`가 주입하는 UI의 look-alike라서 5절 10번. 표와 tile은 design `Table`·`StatTile`로 다시 짜면 CSS가 줄어든다. |

### 4B. 같은 폴더의 renderer 미import 비(非)tsx 22파일 (1655줄)

| file | 무엇 | 제안 | 근거 |
|---|---|---|---|
| compose.module.css (226) | 창·칸·topBar·본문 틀. renderer의 `workspace.module.css`·`panes.module.css` look-alike + `.ways*`, `.link` | 틀 부분은 지움(실제 renderer 틀 사용), `.ways*`·`.link`는 drafts | "복사본 금지"에 걸린다. |
| project-files/files.module.css (83) | `.compare`와 `.palette*`(design `Palette`의 look-alike) | `.palette*`는 지움(실제 `Palette`), `.compare`는 renderer의 conflict compare로 바꿀 수 있는지 확인 | `pages.tsx:119`가 쓴다. |
| agents.module.css (37) + agent-avatar.tsx (86, renderer icon import) | design `Avatar`의 복사본(sm/md/lg 크기, 둥근 바탕) | 지움: design(또는 renderer로 옮긴 뒤) `Avatar`를 import | 22파일 안에 숨은 복사본. `project-window.tsx`가 쓴다. |
| app-space/app-space.module.css (178) | 4A의 OrdersView 모양과 annotate 표식 | mock (`.orders`, `.tile`은 design으로 대체), 표식은 drafts | |
| contexts/contexts.module.css (19) | Contexts 목록·toast 위치 | drafts | 4줄짜리 규칙들. 지울 수 있는지 token으로 확인. |
| waiting/waiting.module.css (26) | secret 창을 가운데 놓는 stage | drafts | |
| workspace/workspace.module.css (39) | 시작 실패 page의 caption·frame | drafts | |
| agents-data.ts (280) | agent·session·`/` 명령 예시 data | mock | |
| project-files/file-data.ts (131) | 파일 탭 예시 data | mock | |
| phroner-data.ts (53) | phroner 예시 project data | mock | |
| contexts/contexts-data.ts (38), app-space/data.ts (25), ways.ts (55), model-options.ts (7), models-data.ts (3) | 예시 data, 길 목록, model catalog 예시 | mock | `model-picker.tsx`(10줄)는 renderer의 실제 picker를 re-export할 뿐. |
| app-space/coding-terminal.ts (123) | coding 터미널 가짜 통로(TUI 출력) | mock | |
| demo-steps.ts (97), agent-setup/drive.ts (58), app-space/drive.ts (58), workspace/drive.ts (74), contexts/clicks.ts (28), contexts/open-tab.ts (17) | mount 뒤 단추를 눌러 상태를 고정하는 helper 6개(비슷한 hook이 5개: `useDemo`, `useDrive` 둘, `useWorkspaceDrive`, `useClicks`) | mock (harness), 합치기 | 같은 일을 하는 hook이 파일마다 따로 있다. 합치는 건 이동 때 같이 할 일. |

### 4C. compositions 밖의 wireframe 코드 (참고)

| file (`tools/wireframes/...`) | 무엇 | 제안 | 근거 |
|---|---|---|---|
| frames/design/components-pages.tsx (861) | 실제 design component gallery. Menu·Dialog·Sheet·Palette는 CSS Module을 import해 look-alike 마크업을 그린다 | kit/ 페이지로 나누고 look-alike를 실제 component로 바꿈 | check 2가 이걸 잡는다. modal이 body를 inert로 만드는 문제가 이유. |
| frames/design/tokens-pages.tsx (571), sdk-pages.tsx (241), kit.tsx (63), kit.module.css (271) | token page, sdk 예제 page, gallery 공통 조각 | kit/ 페이지 | `sdk-pages.tsx`는 `ui-*` 예제를 import하므로 `ui-*`를 지울 때 같이 고친다. `kit.module.css`는 check 1에 걸려 drafts 또는 gallery 쪽으로. |
| gallery.tsx, gallery.module.css (263), main.tsx, pages.ts (1248), build.ts, frames/screens.tsx (416) | gallery 껍데기, page 등록, build | 유지(gallery 도구) | `gallery.module.css`는 check 1의 예외로 둘지 5절 10번에 같이 본다. |
| frames/mock-desktop.tsx (148), fake-terminal.ts (77), chrome/window-api.ts (19) | 진짜 Desktop을 mock으로 띄우는 조립, 가짜 터미널·창 통로 | mock | |

## 5. 정한 것

요구(`project-docs/products/roadmap/ui-kit-single-source.md`)의 기준으로 lead가 정했다. 사람은 요구 1대로 gallery의 `pages/kit`을 보고 승인하고, 다르게 보면 그 component만 옮긴다.

기준: 범용인지는 "사용자 앱도 그대로 쓸 만한가"(요구 4). lophn만의 뜻(session, agent, 대기 질문)이 이름이나 동작에 박혀 있으면 전용이다. kit에는 쓰는 곳이 있거나 앱에 공개된 것만 둔다(요구 1, AGENTS.md "미리 만들지 않는다"). lophn과의 약속(event 이름, app-api)을 아는 부품은 sdk다.

1. TabStrip(+TabItem, TabDot) → renderer. 점이 session 상태다.
2. FileIcon(+fileIconName) → design `primitives/`. 앱도 파일 목록을 그린다.
3. Avatar(+AvatarProfile, `AVATAR_ICONS`) → renderer. icon 집합이 agent profile의 정본이다. wireframe의 복사본(`agent-avatar.tsx`, `agents.module.css`)은 지우고 renderer의 Avatar를 import한다.
4. LauncherFrame, OverviewFrame → 지운다. 폭 틀일 뿐 lophn launcher 화면이 아니고, renderer도 sdk도 쓰지 않는다.
5. Chip, AuthorMark → 지운다. 쓰는 곳이 gallery뿐이다.
6. Toast, ToastStack(+ sdk `ToastProvider`, `useToast`) → design `overlay/`.
7. 지원 export(`shared.ts`, `resize.ts`, `icon.tsx`의 componentMark, Clock, Timer, Clipboard, ResizeSource …) → `components/_shared/`. check 3의 "분류 폴더"는 8개와 `_shared`다.
8. AppErrorBoundary → sdk에 남긴다. `lophn:render-error`가 shell preload와의 약속이다. AppApiButton, useAppApi와 같은 sdk package 하나에 둔다.
9. `ui-*`의 `guide.md`와 `examples/` → 글은 분류 `mod.ts`의 export마다 "언제 쓰나" 한 줄과 `lophn-build-app` skill로 줄이고, 예제는 gallery `pages/kit/<분류>/`로 옮긴다. gallery가 실제 component를 그리니 글처럼 어긋나지 않는다.
10. wireframe CSS: 실제 component의 사본(`compose.module.css`의 틀, `files.module.css`의 palette, `agents.module.css`)은 지우고 실제 component를 import한다. 실험·가짜 화면용은 4B 표대로 `drafts/`나 mock으로 옮긴다. gallery 자신의 틀인 `gallery.module.css`, `kit.module.css` 두 파일만 check 1의 예외로 이름을 박아 둔다.

## 개수

- 2절 표 55행. 분류별(제안): primitives 6(FileIcon 포함), input 6, layout 9, navigation 2, data 10, feedback 5, overlay 7, reading 4, lophn 전용 → renderer 4(Avatar, AuthorMark, VendorIcon, Chip), 분류 밖 2(지원 export, token). 범용 49, 전용 4(+ LauncherFrame·OverviewFrame가 전용 추천, TabStrip이 전용 추천이라 이 셋이 바뀌면 전용 7).
- 5절에서 정한 행: 2절 9행(TabStrip, FileIcon, LauncherFrame, OverviewFrame, Toast/ToastStack, Avatar, AuthorMark, Chip, 지원 export) + 3절 1행(AppErrorBoundary). 5절 9·10은 구조. 결과: renderer로 3(TabStrip, Avatar, VendorIcon), 지움 4(LauncherFrame, OverviewFrame, Chip, AuthorMark).
- 3절 표 12행: design으로 9, sdk에 남김 3(AppErrorBoundary, AppApiButton, useAppApi).
- 4절: 4A 14파일(1217줄), 4B 22파일(1655줄), 4C 참고 파일. 4A 제안: screens 6(agent-pages, scenes, app-space/pages, context-pages, project-pages, project-files/pages)+pm-session 1, mock 5(glossary, host, driven, register-panel, orders-view), drafts 2(ways-page, link). renderer·design으로 옮길 코드는 0.
