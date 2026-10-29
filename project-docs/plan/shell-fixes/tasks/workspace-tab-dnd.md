# workspace-tab-dnd

Radix menu가 열릴 때 바탕 화면이 접히는 문제를 고치고, minimized 바의 닫기(×) 단추를 hover/focus-within에서만 노출하며, 탭을 끌어 pane 본문(왼쪽·오른쪽·가운데)에 놓아 화면을 분할하거나 옮기고 titlebar에 놓아 최소화하는 동작을 구현한다.

- 단위: workspace (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/chrome.css`
  - `packages/shell/renderer/parts/tab-strip/tab-strip.tsx`
  - `packages/shell/renderer/workspace/minimized/minimized-bar.tsx`
  - `packages/shell/renderer/workspace/minimized/minimized-bar.module.css`
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/model_test.ts`
  - `packages/shell/renderer/workspace/panes/panes.tsx`
  - `packages/shell/renderer/workspace/panes/panes.module.css`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/workspace.module.css`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `packages/shell/renderer/parts/tab-strip/tab-strip.tsx`의 `TAB_MIME` (`"application/x-lophn-tab"`), `packages/shell/renderer/workspace/model.ts`의 `moveTab`, `moveTabBy`, `minimizeTab`, `minimizeFloat`, `dockTab`
  - 내놓는 것: `TAB_MIME` export, `PaneDropZone` (`"center" | "left" | "right"`), `dropTabOnPane(view, key, pane, zone)`

## 할 일

1. **Radix scroll-lock 화면 접힘 수정 및 탭 drag 중 창 끌기 해제 (`packages/shell/renderer/chrome.css`)**
   - `Launcher`, `Workspace`, `SettingsSpace`, `AppSpace` 등 최상위 공간의 `.window`는 `position: absolute; inset: var(--space-0)`이다. Radix `DropdownMenu`(`CardMenu` 등)·`Select`·`Dialog`가 열릴 때 `react-remove-scroll`이 `body`에 `position: relative !important`를 걸면 기준이 `body`로 바뀌는데, `html, body` 높이가 지정되어 있지 않아 높이가 0이 되고 밑 화면이 사라진다(`tools/wireframes/main.tsx` 주석 참고).
   - `packages/shell/renderer/chrome.css`에 `html, body { height: 100%; }`를 더한다.
   - 탭을 끌어 titlebar(`TopBar`, `-webkit-app-region: drag`)에 놓을 때 Electron이 drag/drop 이벤트를 삼키지 않도록 `:root:is([data-overlay-modal], [data-page-modal], [data-tab-dragging]) *`에 `-webkit-app-region: no-drag; app-region: no-drag;`이 걸리게 한다.

2. **minimized 바 hover 시 닫기(×) 단추 노출 및 chip 끌기 지원 (`packages/shell/renderer/workspace/minimized/minimized-bar.tsx`, `minimized-bar.module.css`)**
   - `minimized-bar.tsx`에서 각 `.chip` 안의 닫기 `IconButton`을 `<span className={styles.close}>`로 감싼다(또는 className으로 제어).
   - `minimized-bar.module.css`에서 `.close`는 기본 `opacity: 0; pointer-events: none;`이고 `.chip:hover .close, .chip:focus-within .close`에서 `opacity: 1; pointer-events: auto;`가 되게 한다(탭 줄의 닫기 단추와 같은 동작).
   - `.chip`에 `draggable`을 두고 `onDragStart`에서 `event.dataTransfer.setData(TAB_MIME, tab.key)`, `event.dataTransfer.effectAllowed = "move"`, `document.documentElement.dataset.tabDragging = ""`를 걸고 `onDragEnd`에서 `delete document.documentElement.dataset.tabDragging`을 해 minimized 탭도 다시 탭 줄이나 pane 본문으로 끌어 놓을 수 있게 한다.

3. **`TabStrip`에서 `TAB_MIME` export 및 `data-tab-dragging` 표시 (`packages/shell/renderer/parts/tab-strip/tab-strip.tsx`)**
   - `export const TAB_MIME = "application/x-lophn-tab";`으로 export한다.
   - 탭의 `onDragStart`에서 `document.documentElement.dataset.tabDragging = ""`를 세우고, `onDragEnd`와 `dropped`에서 `delete document.documentElement.dataset.tabDragging`을 지운다.

4. **탭 drag & drop으로 화면 분할·이동하는 순수 함수 (`packages/shell/renderer/workspace/model.ts`, `model_test.ts`)**
   - `moveTab(view, key, toPane, before)`에서 `isFloated(view, key)`인 탭이 들어오면 먼저 `dockTab(view, key)`로 pane에 넣은 뒤 `toPane`의 `before` 위치로 옮기고 고른다(단, 한 칸에서 탭이 그 하나뿐일 때 `toPane === 1`이면 pane 0에 고정).
   - `export type PaneDropZone = "center" | "left" | "right";`와 `export function dropTabOnPane(view: WorkspaceView, key: string, pane: number, zone: PaneDropZone): WorkspaceView`를 더한다:
     - `isFloated(view, key)`이면 먼저 `dockTab(view, key)`로 풀고 이어서 처리한다.
     - 한 칸(`view.panes.length === 1`)일 때:
       - `zone === "right"`: `moveTab(view, key, 1)` (탭이 2개 이상이면 오른쪽에 새 칸을 열어 그 탭을 옮긴다).
       - `zone === "left"`: `moveTabBy(view, key, -1)` (탭이 2개 이상이면 왼쪽에 새 칸을 열어 그 탭이 pane 0이 되고 나머지 탭이 pane 1이 된다).
       - `zone === "center"`: 그 탭을 고정(`preview: false`)하고 pane 0에서 고른다.
     - 두 칸(`view.panes.length === 2`)일 때:
       - `pane === 0`: `zone === "right"`이면 `moveTab(view, key, 1)`, `zone === "left"` 또는 `"center"`이면 `moveTab(view, key, 0)`.
       - `pane === 1`: `zone === "left"`이면 `moveTab(view, key, 0)`, `zone === "right"` 또는 `"center"`이면 `moveTab(view, key, 1)`.
   - `model_test.ts`에 `dropTabOnPane`(한 칸에서 left/right 분할, 두 칸 사이 이동, minimized 탭을 끌어 놓기)도 탭 유일성("탭 하나는 한 곳에만 있다")을 지키는지 검증을 더한다.

5. **pane 본문의 VS Code 방식 분할 drop 영역과 titlebar 드롭 최소화 (`packages/shell/renderer/workspace/panes/panes.tsx`, `panes.module.css`, `workspace.tsx`, `workspace.module.css`)**
   - `PanesProps`와 `PaneViewProps`에 `onDropTab?: (pane: number, key: string, zone: PaneDropZone) => void`를 더한다.
   - `PaneView`의 `.body`에서 `TAB_MIME`이 든 drag가 올라오면(`onDragOver`):
     - `.body`의 가로 위치 비율 `(event.clientX - box.left) / box.width`가 `< 0.25`이면 `"left"`, `> 0.75`이면 `"right"`, 그 사이면 `"center"`로 `tabDrop` 상태를 잡는다.
     - `.body`에 `data-tab-drop={tabDrop}`을 달고, `panes.module.css`에서 `.body[data-tab-drop]::after`로 미리보기 overlay(테두리 `--color-focus`, 바탕 `--color-selection`, `pointer-events: none`, `z-index: var(--z-sticky)`)를 그린다: `"left"`는 왼쪽 절반(`inset: var(--space-0) 50% var(--space-0) var(--space-0)`), `"right"`는 오른쪽 절반(`inset: var(--space-0) var(--space-0) var(--space-0) 50%`), `"center"`는 전체(`inset: var(--space-0)`).
     - `.body`에 놓으면(`onDrop`) `TAB_MIME` 값을 읽어 `onDropTab(index, key, zone)`을 부르고 `tabDrop`과 `document.documentElement.dataset.tabDragging`을 지운다.
   - `workspace.tsx`의 `.topBar`에서 `TAB_MIME`이 든 drag를 받아(`onDragOver`, `onDragLeave`, `onDrop`):
     - 끌고 있는 동안 `.topBar`에 `data-drop=""`을 달고 `workspace.module.css`에서 `.topBar[data-drop]`에 안쪽 강조선(`box-shadow: inset 0 0 0 var(--border-focus-width) var(--color-focus)`)을 보인다.
     - 놓으면(`onDrop`) `delete document.documentElement.dataset.tabDragging`을 하고, `isFloated(latest.current, key)`이면 `leaveTopFloat(key); update(minimizeFloat(latest.current, key));`, 아니면 `mainSize !== undefined`일 때 `update(minimizeTab(latest.current, key, mainSize));`를 불러 titlebar의 `MinimizedBar`로 최소화한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "`packages/shell/renderer/workspace/model_test.ts`에서 `dropTabOnPane`(한 칸 좌·우 분할, 두 칸 이동, minimized에서 놓기)을 포함한 상태 전이 뒤에도 모든 탭이 정확히 한 자리에만 있다"
- 남지 않음: TODO·FIXME가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
