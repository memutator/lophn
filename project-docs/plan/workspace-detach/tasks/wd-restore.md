# wd-restore

lophn을 다시 띄우거나 project를 다시 열면 detached 창이 bounds와 함께 돌아온다. Workspace가 layout을 읽은 뒤 `detached` 항목마다 창을 연다. main은 저장할 때 살아 있는 detached 창의 bounds를 채우고, 창을 옮기거나 크기를 바꾸면 project 창에 알려 layout을 다시 저장하게 하며, 되살릴 때 bounds를 지금 화면 안으로 당긴다(모니터를 뺐을 때 창이 화면 밖에 남지 않게).

- 단위: wd-restore (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/main/desktop/detached/bounds.ts`
  - `packages/shell/main/desktop/wiring/detached.ts`
  - `packages/shell/main/desktop/wiring/layout.ts`
  - `packages/shell/main/desktop/core/layout-ipc.ts`
  - `packages/shell/main/desktop/main.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 1(되살릴 때 bounds를 화면 안으로 당긴다), 4(창 bounds는 main이 저장할 때 채운다), "끝남 기준"
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"
  - 지금 코드(이 brief는 아래를 열어 확인한 것이다):
    - `main/desktop/wiring/layout.ts`: `registerLayoutIpc(ipc, { registry, store, bounds })`. `bounds(event)`가 보낸 창(`BrowserWindow.fromWebContents`)의 bounds를 `window_bounds`로 채운다. 이 값을 되살리는 코드는 지금 없다(창은 늘 960×600으로 뜬다).
    - `main/desktop/core/layout-ipc.ts`: `LAYOUT_SAVE_CHANNEL` handler가 `validateLayout`에 `window_bounds: clampBounds(deps.bounds(event))`를 넣는다. `wd-layout`이 `saveInput.detached`(`{ tab, bounds }`)를 통과시킨다.
    - `main/desktop/wiring/detached.ts`(`wd-main`): 창 항목(`ref`, `parent`, `key`), `openWindow`, `moveViews`, `register`가 `Registered`를 돌려준다. `main/desktop/main.ts`의 등록 순서.
    - `renderer/workspace/workspace.tsx`: `load` effect(`source.readLayout` → `viewFromStored` → `setView`), `persistRef`, `latest`, `props.detached`, 구독 handler(`moved`는 무시하고 있다).
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wd-main`의 `register(ctx, views)`와 창 항목, `wd-layout`의 `view.detached`(`{ tab, bounds }`), `wd-contract`의 `DetachedEvent`(`moved`)와 `open` 입력의 `bounds`.
  - 내놓는 것: 다른 task가 기대는 것은 없다.

```ts
// main/desktop/detached/bounds.ts (순수)
/** workAreas는 각 모니터의 작업 영역(Electron의 screen.getAllDisplays().map(d => d.workArea)). 겹치는 면적이 가장 큰 영역 안으로, 없으면 첫 영역 안으로 당긴다. 크기는 minWidth·minHeight 이상이고 영역보다 크지 않다. */
export function clampToWorkAreas(bounds: WindowBounds, workAreas: readonly WindowBounds[], min: { width: number; height: number }): WindowBounds;
// main/desktop/wiring/detached.ts — register가 돌려주는 값에 더한다
boundsOf(parent: string): ReadonlyMap<string, WindowBounds>;   // project 창 ref의 살아 있는 detached 창 bounds(key별)
```

## 할 일

1. `bounds.ts`: `clampToWorkAreas`. 근거: roadmap "무엇을 만드나" 1. 작업 영역이 없으면(빈 목록) bounds 그대로.
2. `wiring/detached.ts`:
   - `open` 입력에 `bounds`가 있으면 창을 만들기 전에 `clampToWorkAreas(bounds, screen.getAllDisplays().map(d => d.workArea), { MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT })`로 당긴다(`electron`의 `screen`은 app이 ready된 뒤에만 쓴다. 창을 여는 시점은 항상 ready 뒤다).
   - `boundsOf(parent)`: 그 project 창의 항목마다 `window.getBounds()`를 key별로 낸다. 닫혔거나 파괴된 창은 뺀다.
   - 만든 창의 `move`와 `resize` event(Linux는 `moved`가 없다)를 500ms debounce로 모아 project 창 renderer에 `{ kind: "moved" }`를 보낸다(project 창이 파괴됐으면 보내지 않는다. 창이 닫히는 중이면 timer를 지운다).
3. `layout.ts`(wiring)·`layout-ipc.ts`·`main.ts`: `register(ctx)`가 `detached`가 낸 `boundsOf`를 받는다(`main.ts`에서 `detached.register`를 `layout.register` 앞으로 옮기고 값을 넘긴다. `editor.register`보다 앞이어도 상관없다: 닫기 listener는 창을 만든 뒤에 달린다). `LayoutIpcDeps`에 `detachedBounds(event): ReadonlyMap<string, WindowBounds>`를 더한다. save handler가 `detached` 항목의 `tab.key`가 이 map에 있으면 그 bounds로 덮어쓴 뒤 `validateLayout`에 넘긴다(없으면 renderer가 보낸 값을 쓴다).
4. `workspace.tsx`:
   - 되살리기: `load` effect에서 `setView(restored)` 뒤 `props.detached`가 있으면 `restored.detached`의 각 항목마다 `props.detached.open({ project: projectId, tab: item.tab, transfer: null, bounds: item.bounds })`를 부른다(거절은 무시한다: `conflict`는 이미 떠 있는 것이고 나머지는 탭이 `detached`로 layout에 남는다). `live` 가드 안에서 하고, 같은 효과가 다시 돌아도 main이 `conflict`로 막는다.
   - `moved` event: `persistRef.current(latest.current)`로 layout을 다시 저장한다(main이 저장할 때 bounds를 채운다).
5. 확인은 손으로 하지 않는다(창 여럿을 띄우는 Electron test는 만들지 않는다). 순서 논리는 `deno check`와 읽기로 한다.

## 정한 것

- 창 bounds를 되살리는 것은 detached 창뿐이다(agent). project 창은 `window_bounds`를 쓰고도 되살리지 않는 지금 그대로 둔다(roadmap 범위 밖).
- project를 떠났다 돌아오면 detached 창은 저장된 값(`toStored`)으로만 다시 뜬다(agent). 이때 transfer가 없으므로 terminal은 PTY에 다시 붙지 못하고 agent draft는 비어 있다: 재시작과 같다.
- bounds 당기기는 화면 구성이 바뀐 경우만 위치를 바꾼다(agent). 영역 안에 이미 들어 있는 bounds는 그대로 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. roadmap이 정한 test가 아니다(write-test: 화면 구성에 따른 위치 계산은 data를 잃지 않는다).
- 남지 않음: 없음(더하는 것뿐이다).
- `deno run -A packages/shell/renderer/build.ts`, `deno run -A packages/shell/main/build.ts`로 bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 손으로 확인하지 못한 것(재시작 뒤 bounds, 모니터를 뺀 경우)을 적는다. lead가 손으로 본다.
