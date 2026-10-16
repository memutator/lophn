# ui-chrome-component-mark

SDK component(design의 공용 component와 `packages/sdk/ui-*`가 직접 그리는 component)가 자기가 그린 DOM 요소에 component 이름을 표시한다. 앱 화면 annotation이 사람이 고른 요소에서 "어느 SDK component인가"를 읽으려는 것이다.

- 단위: ui-chrome (wave 2)
- 선행: ui-chrome-components (`toast`, `input`, `select`, `menu`와 새 `tab-strip`, `file-icon`, `vendor-icon`을 고치므로, 같은 file을 겹쳐 고치지 않으려는 순서다)
- 소유(이 task만 고친다):
  - `packages/design/components/shared.ts`와 `mod.ts`(export 한 줄)
  - `packages/design/components/` 아래 각 component의 `.tsx`(root 요소에 표시 한 줄씩)
  - `packages/sdk/ui-action/command-button.tsx`
  - `packages/sdk/ui-filter/{date-range-filter,filter-bar,multi-select-filter}.tsx`
  - `packages/sdk/ui-layout/app-shell.tsx`
  - `packages/sdk/ui-overlay/toast-queue.tsx`
  - `packages/sdk/ui-state/{app-error-boundary,read-state}.tsx`
- 읽을 것:
  - spec: S9 4~5장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md` (SDK component 표시, `data-lophn-component="DataTable"`; 고르는 대상은 가리킨 요소에서 위로 올라가 처음 만나는 SDK component 요소)
  - inventory: `I3.12#1` (`../assignment.md`의 ui-chrome 줄)
  - 결정: `../../tmp/inventory/00-decisions.md`의 112(source 위치는 release의 source map. 이 task는 component 이름만 한다)
  - 지금 코드: `packages/design/components/shared.ts`(`cx` 등 공용 함수), `packages/sdk/ui-*/mod.ts`(design을 다시 내보내는 열은 design 한 곳에서 한다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `componentMark(name: string): { "data-lophn-component": string }`를 `@lophn/design/components`에서 export. annotation 쪽(B10 annotation, 앱 view preload의 고르기 script)은 `[data-lophn-component]` 속성만 읽는다.

## 할 일

1. `shared.ts`에 `componentMark(name)`를 더하고 `components/mod.ts`에서 export한다. 속성 이름은 `data-lophn-component` 하나다.
2. 아래 규칙으로 각 component가 그린 가장 바깥 DOM 요소에 `{...componentMark("<export 이름>")}`을 단다.
   - 이름은 그 component의 export 이름이다(`Button`, `DataTable`, `Card`).
   - DOM을 그리지 않는 것(Provider, hook, 순수 함수)은 표시하지 않는다.
   - 다른 SDK component 하나를 그대로 돌려주기만 하는 component는 표시하지 않는다(안쪽이 표시한다).
   - 여러 요소를 그리는 component(Table의 `cells.tsx`, `Tabs`의 `Tab`·`TabList`·`TabPanel` 같은 부분 component)는 사용자가 쓰는 export마다 그 요소에 단다.
   - Radix가 portal로 그리는 content(Dialog, Popover, Menu, Tooltip, Select, Sheet)는 content 요소에 단다. 화면에서 가리킬 수 있는 요소가 그것이다.
   - 호출자가 같은 속성을 `...rest`로 덮을 수 없게 `componentMark`를 `{...rest}` 뒤에 둔다.
3. 대상 file(`find packages/design/components -name "*.tsx"`로 examples를 뺀 것)과 SDK file을 하나씩 확인한다. 지금 design 쪽은 `author-mark`, `avatar`, `button`, `card`, `checkbox`, `chip`, `copy-button`, `data-table`(`data-table`, `data-state`, `toolbar`), `dialog`, `empty-state`, `error-state`, `field`, `icon-button`, `icon`, `input`, `kbd`, `list`, `menu`, `page-frames`(`frames`, `reading-frame`), `palette`, `popover`, `select`, `sheet`, `skeleton`, `stale-note`, `stat-tile`, `status-mark`, `switch`, `table`(`cells`, `table`), `tabs`, `textarea`, `toast`, `tooltip`, `tree`와 ui-chrome-components가 더한 `tab-strip`, `file-icon`, `vendor-icon`, `menu`의 `MenuIcon`이다. `Icon`은 장식이므로 표시하지 않는다(이유를 보고에 적는다).
4. SDK 쪽(`ui-action/command-button.tsx`, `ui-filter/*`, `ui-layout/app-shell.tsx`, `ui-overlay/toast-queue.tsx`, `ui-state/*`)도 같은 규칙으로 단다. 이름은 export 이름이다(`CommandButton`, `FilterBar`, `AppShell`, `ToastQueue`, `ReadState`, `AppErrorBoundary`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(속성 표시다)
- 남지 않음: 해당 없음
- `deno task wireframes`가 되고 gallery가 그대로 그려진다(속성은 모양을 바꾸지 않는다).

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 표시하지 않기로 한 component와 이유, 부분 component 처리
- 넘기는 일: annotation 값의 모양(`I3.12#3`)은 contract-app-calls. 속성을 읽는 쪽은 annotation 단위
