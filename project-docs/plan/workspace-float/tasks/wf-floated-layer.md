# wf-floated-layer

workspace `.content` 안, `Panes` 옆에 floats 층을 그린다. floated 탭마다 `FloatPanel` 하나가 뜨고, 위 bar를 끌면 옮겨지고 가장자리를 끌면 크기가 바뀌고, 누르면 맨 위로 온다. 패널의 [Minimize], [Dock], [Close]가 model 함수를 부른다. 본문은 kind의 `render`(app panel은 `keep`)를 그대로 부른다.

- 단위: wf-floated (wave 2)
- 선행: wf-panel, wf-native, wf-floated-wire, wf-view-keep
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/drag.ts`
  - `packages/shell/renderer/workspace/floats/floats.tsx` (새 file)
  - `packages/shell/renderer/workspace/floats/floats.module.css` (새 file)
  - `packages/shell/renderer/icons/workspace.ts`
  - `packages/design/wording/catalog/project.ts` (필요한 key만)
  - `packages/design/wording/catalog/project.placeholders.ts` (`deno task wording`이 만든다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 2(층, 패널, 본문, 새 패널의 첫 rect), 3의 마지막 둘(접힌 탭의 mount 규칙)
  - 규칙: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 앞 task: `wf-layout-model.md`(`FloatItem`, `raiseFloat`, `minimizeFloat`, `dockTab`, `setFloatRect`, `movedRect`, `resizedRect`, `clampFloatRect`), `wf-panel.md`(`FloatPanel` props), `wf-native.md`(`ViewLayerProvider`, `useViewCover(ref, covering, layer)`가 돌려주는 함수), `wf-view-keep.md`(app panel view가 Float·Dock·접기에서 살아남는다), `wf-floated-wire.md`(`close(null, key)`)
  - 지금 코드: `workspace.tsx`의 `renderTab`, `renderKept`, `stripTab`, `mainRef`/`mainSize`(`.content`), `styles.content`·`Panes` 부분(`Panes`의 `end`/새 탭 단추와 무관), `drag.ts`의 `startPointerDrag`, `panes/panes.tsx`의 `PaneView`(기본 본문 모양: 제목 한 줄), `kinds/app-panel.tsx`의 `keep`, `kinds/terminal.tsx`
  - 본보기(화면): 아직 gallery에 없다. 이 task는 `FloatPanel`을 쓰는 renderer 화면을 만들고 gallery는 `wf-gallery`가 한다.
- 계약:
  - 쓰는 것: 위 앞 task의 export들. `ViewCoversProvider`는 `workspace.tsx`가 이미 `.content`를 감싸고 있다.
  - 내놓는 것: `floats/floats.tsx`의 `Floats` component. `wf-minimized`·`wf-entry`가 `workspace.tsx`에서 만난다.

```ts
interface FloatsProps {
  floats: readonly FloatItem[];
  /** `.content`의 크기. 아직 못 쟀으면 undefined이고 아무것도 그리지 않는다. */
  area: FloatArea | undefined;
  /** 제목 앞 아이콘 등 탭 줄이 그리는 모양(workspace의 stripTab). */
  stripTab: (tab: TabItem) => StripTab;
  /** workspace의 renderTab / renderKept. */
  renderTab: (tab: TabItem, active: boolean) => ReactNode | null;
  renderKept: (tab: TabItem, shown: boolean) => ReactNode | null;
  onRaise(key: string): void;
  onRect(key: string, rect: FloatRect): void;
  onMinimize(key: string): void;
  onDock(key: string): void;
  onClose(key: string): void;
}
export function Floats(props: FloatsProps): ReactElement | null;
```

## 할 일

1. `drag.ts`: `startPointerDrag`의 `move`가 `(dx, dy)`를 받게 한다(`PointerDrag.move: (dx: number, dy: number) => void`). `drag.move(lastX - startX, lastY - startY)`. 기존 호출은 `dx`만 받으므로 고치지 않는다.
2. `floats/floats.tsx`, `floats.module.css`: 층 `div`(`.content` 안에서 `position: absolute; inset: 0; pointer-events: none`)와 패널 하나를 그리는 내부 component.
   - 패널마다 `FloatPanel`을 쓴다. `icon`은 `stripTab(tab).icon`, `title`은 `tab.title`, `actions`는 `IconButton` 셋([Minimize], [Dock], [Close])이고 Tooltip을 단다(`panes.tsx`의 split-pane 단추 모양). 이름은 `project-workspace.button.float-minimize`, `float-dock`, `float-close`(`wf-panel`이 더했다). 패널은 `pointer-events: auto`다.
   - 위치: `clampFloatRect(item.rect, area)`를 그린다(저장된 rect는 건드리지 않는다. 창이 줄었다 커지면 원래 자리로 돌아온다. 되살릴 때 화면 밖에 남지 않게 하는 길도 이것이다). 이동·resize 중 미리보기는 컴포넌트 state(`FloatRect | null`)로 두고, 놓을 때(`drag-end`)만 `onRect`로 올린다. `drag-cancel`은 버린다. 시작 rect는 clamp한 rect다. 이동은 `movedRect`, resize는 `resizedRect`.
   - 층 번호: 패널의 층은 `floats` 배열 index + 1이다. 패널 body를 `<ViewLayerProvider value={layer}>`로 감싸고 `useViewCover(ref, !item.minimized, layer)`로 cover를 등록한다(ref는 `FloatPanel`의 root). 돌려받은 함수를 그린 rect가 바뀔 때마다(미리보기 포함) `useLayoutEffect`에서 부른다. 그래야 옮기는 동안 native view가 비켜 간다.
   - DOM 순서는 바꾸지 않는다. 패널을 `tab.key` 순으로 고정해서 그리고 `z-index`를 층 번호로 준다. 이유: raise할 때 요소를 재배열하면 안에 있던 focus와 scroll(terminal, editor)이 날아간다. `onRaise`는 `FloatPanel`에서 오고, 이미 맨 위(`active`)면 부르지 않는다. `active`는 minimized가 아닌 것 중 가장 위 패널이다.
   - 본문: `renderKept(tab, !item.minimized)`가 null이 아니면 그것이다(app panel). 접히면 `FloatPanel hidden`으로 mount를 유지한다. null이면 `item.minimized`일 때 패널을 아예 그리지 않고(unmount), 아니면 `renderTab(tab, active)`를 그린다(`render`가 없는 kind는 `PaneView`의 기본 본문처럼 제목 한 줄). 이유: roadmap 3의 "keep kind는 mount한 채 숨기고 나머지는 unmount".
   - 층(`.floats`)의 `z-index`는 `var(--z-sticky)`다(`.notices`의 `--z-toast`보다 아래. `wf-native`의 가짜 view 상자가 이 값을 기준으로 층을 정한다).
3. `workspace.tsx`: `Panes` 옆(같은 `.content` 안)에 `<Floats .../>`를 둔다. `area`는 `mainSize`(`useObservedSize(mainRef)`)다. 콜백은 `update`로 model 함수를 부른다: `onRaise` → `raiseFloat`, `onRect` → `setFloatRect(view, key, rect, area)`, `onMinimize` → `minimizeFloat`, `onDock` → `dockTab`(그 뒤 `focusPaneBody(latest.current.focusedPane)`), `onClose` → `close(null, key)`.
4. `icons/workspace.ts`에 `minimize`, `dock` 아이콘을 더한다(lucide에서 고른다). 이름은 `workspaceIcons.minimize`, `workspaceIcons.dock`.
5. wording: 새 key가 필요하면 `project.ts`에 더하고 `deno task wording`. 패널 단추 셋은 이미 있으니 더 필요한 것이 없으면 건드리지 않는다. 층 자체에 aria label이 필요하면 `project-workspace.label.floats` 하나.
6. 손으로 확인한다: `deno task dev:mock`(`ui-design`)이나 `.dev-data/<id>/`의 dev 앱에서 `Workspace`에 floats를 넣은 layout을 읽혀 본다. 진입 menu는 `wf-entry`가 만드니, 확인용으로는 `layout`에 floats를 넣은 fake source를 임시로 쓰고 commit에 남기지 않는다.

## 정한 것

- 접힌 패널도 floats 배열에 남아 층 번호를 차지한다(agent). 펴면 `restoreFloat`가 맨 위로 올리므로 순서는 어긋나지 않는다.
- 화면 크기가 작아 clamp한 rect가 저장된 rect와 다르면 그린 것만 clamp하고 저장은 사람이 옮길 때 한다(agent).
- 패널의 본문 안에 있는 focus가 `FloatPanel`의 `onFocusCapture`로 raise를 부른다.
- app panel view는 Float·Dock·접기에서 다시 만들어지지 않는다(`wf-view-keep`이 보장한다). 이 task는 `Floats`의 본문 `keep`을 부르기만 한다(agent).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 순수 규칙은 `wf-layout-model`이 본다.
- 남지 않음: 없음(더하는 것뿐이다. `startPointerDrag`를 쓰는 기존 호출은 type check가 본다).
- (화면) `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성은 이 task가 돌렸으면 "돌림"
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 손으로 확인하지 못한 것
