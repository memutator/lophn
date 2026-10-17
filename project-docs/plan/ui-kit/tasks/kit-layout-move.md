# kit-layout-move

`packages/design`의 평평한 `components/`를 분류 폴더 8개(primitives, input, layout, navigation, data, feedback, overlay, reading)와 `_shared`로 옮기고, design 패키지 이름을 `@lophn/design`에서 `@lophn/ui`로 바꾸고, 쓰는 곳의 import를 새 sub-path로 고친다. 분류마다 `mod.ts`를 만든다(한 줄 문서는 `kit-layout-guide`).

- 단위: kit-layout (wave 1)
- 선행: kit-renderer
- 소유(이 task만 고친다):
  - `packages/design`
  - `packages/sdk`
  - `packages/shell/renderer`
  - `tools/wireframes`
  - 루트 `deno.json`·`deno.lock`은 소유 표 밖이지만 이름 바꿈 때문에 `deno.lock`을 갱신한다(아래 12번)
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-layout`, `classification.md` 2절 표(분류 열)와 5절 2·6·7번
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 "바꿀 모양"
  - boundary: `project-docs/boundary-catalog.yaml`의 `design`, `design-api`
  - 이동 도구: `tools/move-files.ts` 머리 주석(`moves`, `packages`, `remove`, `--dry-run`, `--report`)
- 계약:
  - 쓰는 것: `kit-renderer`가 끝낸 뒤의 `packages/design/components/mod.ts`(barrel)
  - 내놓는 것: 패키지 이름 `@lophn/ui`. `packages/design/deno.json`의 exports는 `.`(token), `./primitives`, `./input`, `./layout`, `./navigation`, `./data`, `./feedback`, `./overlay`, `./reading`, `./shared`, `./base.css`, `./tokens.css`. `./components`는 없다. 분류마다 `packages/design/components/<분류>/mod.ts`가 그 분류의 export를 모은다. wording은 `@lophn/wording` 그대로다.

## 할 일

근거: README `kit-layout`, `classification.md` 2절. 정한 것 둘.
- 이름 바꿈(`@lophn/design` → `@lophn/ui`)을 README의 `kit-sdk`가 아니라 여기서 한다. barrel import를 분류 sub-path로 다시 쓰는 일을 두 번 하지 않으려는 것이다(150개 가까운 파일을 한 번만 건드린다).
- 분류 폴더 안에도 component 폴더를 그대로 둔다(`components/overlay/dialog/dialog.tsx`). css module과 보조 파일이 같이 움직이고 mapping 한 줄이 폴더 하나다.

1. 옛 모양을 확인한다: `components/` 폴더 36개, `components/mod.ts`(barrel), `reading/`(top-level, 자기 `mod.ts`), `shared.ts`, `resize.ts`, `icon.tsx`, `return-focus.ts`, `state.module.css`, `css-modules.d.ts`.
2. mapping 파일을 worktree 밖 임시 경로에 쓴다(commit하지 않는다). `tools/move-files.ts`의 `packages`에 `{"from":"@lophn/design","to":"@lophn/ui"}`, `moves`에 아래를 넣는다. 먼저 `--dry-run --report`로 "손으로 고칠 목록"을 본다.

   | from (`packages/design/...`) | to (`packages/design/components/...`) |
   |---|---|
   | `components/button/`, `icon-button/`, `kbd/`, `copy-button/`, `file-icon/` | `primitives/<같은 이름>/` |
   | `components/icon.tsx` | `primitives/icon/icon.tsx` |
   | `components/field/`, `input/`, `textarea/`, `select/`, `checkbox/`, `switch/` | `input/<같은 이름>/` |
   | `components/card/`, `page-frames/` | `layout/<같은 이름>/` |
   | `components/tabs/` | `navigation/tabs/` |
   | `components/table/`, `data-table/`, `tree/`, `list/`, `stat-tile/` | `data/<같은 이름>/` |
   | `components/skeleton/`, `empty-state/`, `error-state/`, `stale-note/`, `status-mark/` | `feedback/<같은 이름>/` |
   | `components/state.module.css` | `feedback/state.module.css` (`empty-state`, `error-state`가 `../state.module.css`로 쓴다) |
   | `components/toast/`, `tooltip/`, `popover/`, `menu/`, `dialog/`, `sheet/`, `palette/` | `overlay/<같은 이름>/` |
   | `components/return-focus.ts` | `overlay/return-focus.ts` (쓰는 곳이 dialog, menu, palette, popover, sheet뿐이다) |
   | `reading/` (폴더째: `mod.ts`, `reading.module.css`, `markdown/`, `code-block/`, `diff-view/`, `toc/`) | `reading/` |
   | `components/shared.ts`, `components/resize.ts` | `_shared/shared.ts`, `_shared/resize.ts` |

   `components/css-modules.d.ts`는 그 자리에 둔다(`deno.json`의 `compilerOptions.types`가 가리킨다). `components/mod.ts`는 5번에서 쪼갠 뒤 지운다.
3. `DiffMark`(`DiffKind`, `DIFF_SIGNS`)를 `feedback/status-mark/status-mark.tsx`에서 떼어 `reading/diff-view/diff-mark.tsx`로 옮기고 css(`status-mark.module.css`의 `.sign`과 `data-diff` 규칙)도 `reading/diff-view/diff-mark.module.css`로 나눈다(`classification.md` 2절 DiffMark 행: reading). `STATUS_ICONS`와 `StatusMark`는 feedback에 남는다.
4. `packages/design/deno.json`: `name`을 `@lophn/ui`로(tool이 한다), exports를 위 "내놓는 것"대로 쓴다. 옛 `./components`, 옛 `./reading` 값은 없앤다.
5. 분류 barrel을 만든다. `components/<분류>/mod.ts` 8개와 `components/_shared/mod.ts`. 옛 `components/mod.ts`(tool이 export 경로를 이미 새 자리로 고쳐 놓는다)와 `reading/mod.ts`의 export 문을 그 분류의 것만 골라 옮기고 경로의 분류 접두를 뗀다(`./overlay/dialog/dialog.tsx` → `./dialog/dialog.tsx`). 분류별 내용은 아래 표(`mod.ts`가 정본이고 표는 참고)다. 값 export를 하나도 빠뜨리지 않는다.

   | 분류 | export |
   |---|---|
   | primitives | Button, IconButton, Icon(+IconProps), Kbd, CopyButton(+useCopy, CopyState), FileIcon, fileIconName |
   | input | Field, FieldContext, Input, Textarea, Select, Checkbox, Switch (+ 각 Props 타입) |
   | layout | Card, FormFrame, DashboardFrame, DashboardCell, ListDetailFrame, TableFrame, ReadingFrame, READING_WIDTHS, readingBox, columnBox, tocSideMinimum, DEFAULT_READING_WIDTH, readingWidthOf, useReadingWidth, useTocPlacement (+ 타입) |
   | navigation | Tabs, TabList, Tab, TabPanel (+ 타입) |
   | data | Table, Density, VIRTUALIZE_AFTER, domTableViewport, Tree, List, ListItem, StatTile, StatRow, DataTable, DataState, clampPage, pageCount, pageSlice, sortRows, toggleColumn, visibleColumns (+ 타입) |
   | feedback | Skeleton, Loading, useDelayedLoading, EmptyState, ErrorState, StaleNote, StatusMark, STATUS_ICONS |
   | overlay | Toast, ToastStack, Tooltip, Popover, PopoverRow, Menu, MenuIcon, Dialog, Sheet, Palette (+ 타입) |
   | reading | Markdown, parseMarkdown, safeUrl, CodeBlock, Toc, TOC_MAX_LEVEL, DiffLine(type), DiffMark, DiffKind(type) |
   | _shared | componentMark, iconPixels, ControlSize, Clock/Timer/Clipboard 타입과 systemClock·systemTimer·systemClipboard, ResizeSource, ResizeSourceProvider, domResizeSource, Size, useObservedSize |

   분류 `mod.ts` 안의 import는 같은 package의 다른 분류 file을 직접(상대 경로로) 가리킨다. 다른 분류의 `mod.ts`를 거치지 않는다(순환 방지).
6. 쓰는 곳을 고친다. barrel 하나(`@lophn/ui/components`)를 쓰던 import를 분류 sub-path로 쪼갠다. tool이 못 하는 일이라 한 번 쓰고 버리는 script를 쓴다(commit하지 않는다): 5번의 새 barrel을 읽어 이름 → 분류 표를 만들고, `import { A, type B } from "@lophn/ui/components"`를 분류마다 한 줄 import로 나누되 `type` 표시를 지키고, 표에 없는 이름이 나오면 멈춘다. 끝나면 `deno fmt`.
   - `packages/shell/renderer` 전체(148개 가까운 파일)
   - `packages/sdk/ui-*/**.ts(x)`와 `packages/sdk/tokens`(이 task는 sdk의 `ui-*`를 지우지 않는다. 지우는 건 `kit-sdk-move`다. type check가 서도록 import만 맞춘다. `ui-chart`는 `kit-layout-chart`가 `@lophn/chart` 때문에 따로 건드린다)
   - `tools/wireframes`(`build.ts`, `gallery.tsx`, `main.tsx`, `frames/**`). `frames/design/components-pages.tsx`가 dialog·sheet·palette·menu css module을 상대 경로로 import하는 줄은 tool이 새 자리로 고친다.
   - 이 단계에서 `@lophn/ui/reading` import(2곳)는 그대로 유효하다. `@lophn/design`(root: token) → `@lophn/ui`는 tool이 고친다.
7. `packages/design/wording/check.ts`의 검사 범위(`packages/design/components`, `packages/design/reading` 두 줄)에서 옮겨 간 `packages/design/reading` 줄을 뺀다(이제 `components/reading`이 `components` 밑이다).
8. 이름 바꿈이 tool로 안 고치는 곳을 보고서(`mention`, `path`)에서 찾아 손으로 고친다: `tools/wireframes/pages.ts` 등 문자열 안의 `@lophn/design`, 주석. 문서·skill·`.tmpl`은 고치지 않는다(앞 둘은 lead, `.tmpl`은 `kit-sdk-publish`).
9. 옛 `components/mod.ts`와 `./components` export를 지운다. `packages/design/reading/`가 비어 사라졌는지 본다.
10. `style-check`가 `packages/design/`을 통째로 훑는지 확인한다(폴더 이름에 기대는 규칙이 있으면 고친다. 지금은 `packages/design/generated/tokens.css`·`base.css`만 이름으로 본다).
11. 문서(architecture, ui-design skill, registry, changelog)는 lead가 고친다.
12. 루트 `deno.lock`: 패키지 이름이 바뀌어도 lock의 `workspace.members`는 폴더 경로가 key다. `deno task check`가 lock 때문에 실패하면 `deno install --frozen=false`(또는 `deno cache --frozen=false`)로 한 번 갱신하고 diff가 이름·경로 외에 의존 판을 바꾸지 않는지 확인한다. 바뀌면 보고한다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음 (옮기기뿐이다)
- 남지 않음:
  - `ls packages/design/components`가 `_shared css-modules.d.ts data feedback input layout navigation overlay primitives reading`뿐이다. `packages/design/reading`, `packages/design/components/mod.ts`가 없다.
  - `grep -rnE --exclude-dir=node_modules --exclude-dir=dist "@lophn/design|@lophn/ui/components" packages tools --include=*.ts --include=*.tsx --include=*.css --include=*.json`이 0줄이다(`.tmpl`은 `kit-sdk-publish`가 고쳐서 제외, `node_modules`·`dist`·`deno.lock` 제외).
  - `grep -rnE --exclude-dir=node_modules --exclude-dir=dist "design/components/[a-z_-]+/" packages tools --include=*.ts --include=*.tsx --include=*.css | grep -vE "components/(primitives|input|layout|navigation|data|feedback|overlay|reading|_shared)/"`가 0줄이다(옛 폴더 이름을 가리키는 상대 경로가 없다).
- (화면) gallery의 모든 Components·SDK·Tokens page가 예전처럼 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (루트 `deno.json`은 안 고친다. `deno.lock`만 갱신했으면 적는다)
- 안 쓰게 된 export: 없음
- 정한 것: 이름 바꿈을 이 task에서 한 것, component 폴더를 분류 안에 그대로 둔 것, 그 밖에 정한 것
- 넘길 줄: `packages/sdk/ui-*`의 import만 맞춘 곳(`kit-sdk-move`가 지운다)
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- 알려진 미완 동작: 앱 template의 `@lophn/design*` 이름은 `kit-sdk-publish`가 고치기 전까지 옛 이름이다(template은 type check 밖이다)

## lead가 더함

- (lead가 더함) "남지 않음"의 `@lophn/design` grep에서 `packages/core/apps`는 뺀다. `releases/ui-build/build.ts`의 `FIXED_UI_DEPENDENCIES`, `packages/install.ts` 주석, 앱 template은 `kit-sdk-publish`가 고친다. 이 task는 그 file을 고치지 않는다. 확인: `grep -rnE --exclude-dir=node_modules --exclude-dir=dist "@lophn/design|@lophn/ui/components" packages tools --include=*.ts --include=*.tsx --include=*.css --include=*.json | grep -v "^packages/core/apps/"`가 0줄.
- (lead가 더함) `kit-renderer`가 옮긴 `packages/shell/renderer/parts/{avatar,vendor-icon,tab-strip}/`도 `@lophn/design`·`@lophn/design/components`를 import한다. renderer 전체를 고칠 때 같이 고친다.
- (lead가 더함) `deno.lock` 갱신이 필요하면 실제로 된 명령을 보고의 "정한 것"에 그대로 적는다(lead가 남은 brief에 옮긴다). `packages/shell/main/desktop/core/deno.lock` 변경은 commit하지 않는다.
- (lead가 더함) `check:full`에서 `packages/core/apps/calls/calls_test.ts`의 "write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다"가 한 번 실패하면 다시 돌린다(이 task와 무관한 timing test다). 두 번 실패하면 보고한다.
