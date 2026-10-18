# wf-native

native view(app panel, 뒤에 browser)가 세 층으로 쌓이게 한다: pane view < floated view(floats 순서) < overlay. renderer가 view마다 층 번호를 main에 보내고, main이 그 순서로 `WebContentsView`를 쌓는다. DOM 패널이 native view 위에 뜰 때 쓰는 cover도 층을 알게 한다(자기보다 위 층의 cover만 뺀다).

- 단위: wf-native (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/view-order.ts`
  - `packages/shell/main/app-frame/view-model.ts`
  - `packages/shell/main/app-frame/placement.ts`
  - `packages/shell/main/app-frame/registry.ts`
  - `packages/shell/main/app-frame/visibility.ts`
  - `packages/shell/main/app-frame/view-ipc.ts`
  - `packages/shell/main/app-frame/electron-app-frame.ts`
  - `packages/shell/renderer/app-frame/embedded-view.tsx`
  - `packages/shell/renderer/app-frame/bounds.ts`
  - `packages/shell/renderer/desktop/dev-mock/app-space.ts` (가짜 앱 view 상자의 `z-index`만)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "지금 코드"(native view), "무엇을 만드나" 2(native view 층), "정한 것"(cover)
  - architecture: `project-docs/architecture/annotation.md`(app view identity. 이 task는 view 신원을 바꾸지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`, `packages/shell/ipc`
  - 지금 코드: `main/app-frame/view-order.ts`(overlay 하나만 맨 위로 다시 붙인다. 지금은 `overlay.ts`가 `viewOrder`를 쓰고 앱 view는 쓰지 않는다), `electron-app-frame.ts`의 `attach`(`addChildView` 뒤 `input.raise(window)`), `placement.ts`의 `setBounds`/`place`, `visibility.ts`의 `Pending`·`apply`·`setBounds`, `view-ipc.ts`의 `setBounds`, `ipc/app-frame.ts`의 `viewBoundsRequestSchema`, `renderer/app-frame/embedded-view.tsx`(`useViewCover`, `startBoundsRelay` 호출), `bounds.ts`(`startBoundsRelay`, `ViewCovers`, `createViewCovers`, `subtractCover`)
  - 쓰는 곳(바꾸면 같이 맞춘다): `renderer/app-frame/side-panel.tsx`와 `project-picker.tsx`(`useViewCover(ref, covering)`), `app-frame/app-space.tsx`와 `workspace/workspace.tsx`(`createViewCovers`, `ViewCoversProvider`)
- 계약:
  - 쓰는 것: `packages/shell/ipc/app-frame.ts`의 `viewBoundsRequestSchema`에 lead가 wave 2 전에 commit해 둔 칸 하나. 이 task는 그 file을 고치지 않는다. lead가 아래 줄을 `bounds: viewBoundsSchema,` 바로 아래에 그대로 commit한다(`LophnShellViewsApi.setViewBounds`의 입력 type은 schema에서 나오므로 `layer?: number`가 따라온다. preload는 입력을 그대로 넘긴다).

```ts
  layer: z.number().int().min(0).max(32).optional(), // 없으면 0 = pane view. 1.. = floated view(floats 배열 index + 1). 클수록 위.
```

  - 내놓는 것: `wf-floated-layer`, `wf-view-keep`이 기댄다.

```ts
// renderer/app-frame/embedded-view.tsx
export const ViewLayerProvider: Provider<number>;    // EmbeddedView가 context에서 읽는다. 기본 0.
/** layer 기본 Infinity(side panel·picker 같은 overlay 성격은 늘 위). 돌려주는 함수는 cover 요소가 크기 변화 없이 옮겨졌을 때 부른다(`ViewCovers.changed()`). provider가 없으면 아무것도 하지 않는다. 안정된 함수다. */
export function useViewCover(ref, covering: boolean, layer?: number): () => void;

// renderer/app-frame/bounds.ts
export interface ViewCovers {
  add(element: Element, layer?: number): () => void;     // layer 기본 Infinity
  list(): readonly { readonly element: Element; readonly layer: number }[];
  subscribe(listener: () => void): () => void;
  changed(): void;     // 요소 크기는 그대로인데 위치만 바뀌었을 때 부른다(패널을 옮길 때). subscribe한 relay가 다시 잰다.
}
```

## 할 일

1. 층 번호를 main까지 보낸다. 근거: roadmap "무엇을 만드나" 2.
   - `ipc/app-frame.ts`와 preload(`preload/views-api.ts`)는 고치지 않는다(`layer` 칸은 lead가 이미 넣었다).
   - `view-ipc.ts`의 `setBounds`가 `checked.value.input.layer ?? 0`을 `visibility.setBounds`에 넘긴다. `visibility.ts`: `setBounds(window, view_session, bounds, layer)`, `Pending`에 `layer`를 담고, 한 frame에 묶을 때 마지막 값을 쓰고, `apply`가 `deps.frame.setBounds(view_session, intersect(dip, body), layer)`로 넘긴다.
   - `registry.ts`의 `setBounds(view_session, bounds, layer)`가 `entry.layer`를 정하고 `placement.setBounds`로 간다. `Entry`가 `Placed`를 상속하므로 `placement.ts`의 `Placed`에 `layer: number`를 더하고 `open`에서 `layer: 0`으로 시작한다. `view-model.ts`의 `AppViewHost.attach(window, view, bounds, layer)`에 인자를 더한다.
   - 층이 바뀌었는데 bounds는 같은 경우도 `placement.setBounds`가 `views.attach`를 다시 부른다(지금도 attached면 늘 부른다). `generation`은 오르지 않는다.
2. `view-order.ts`를 세 층으로 만든다. 지금 `viewOrder(host)`는 overlay 하나만 안다. 앱 view용으로 같은 파일에 `appViewOrder<T>(host: ViewHost<T>, raiseOverlay: () => void)`를 더한다(옛 `viewOrder`는 `overlay.ts`가 계속 쓴다).
   - `attach(view, layer)`: view와 layer를 기억하고, 불변 조건을 지키도록 `host.addChildView`를 다시 부른다. 불변: 같은 창에서 layer가 작은 view가 큰 view 아래다, 같은 layer에서는 나중에 붙은 것이 위다, overlay가 맨 위다. 구현은 가장 단순하게: 방금 붙인 view를 add하고, 그것보다 layer가 큰(혹은 같은) 기억된 view를 layer 순으로 다시 add한 뒤 `raiseOverlay()`를 부른다. Electron의 `addChildView`는 이미 child인 view를 다시 넣으면 맨 위로 옮긴다.
   - `remove(view)`: 기억에서 지우고 `host.removeChildView(view)`.
   - 창마다 하나다. `electron-app-frame.ts`가 `Map<BrowserWindow, ...>`로 갖고, `attach`가 기존 `addChildView` + `input.raise(window)` 대신 이것을 쓴다. `detach`는 `remove`를 쓴다. 창이 닫히면 `WeakMap`이 비는 것으로 충분하다.
3. cover가 층을 안다. 근거: roadmap "정한 것"의 cover.
   - `bounds.ts`: `ViewCovers`를 위 모양으로 바꾼다(`add`가 layer를 받고 `list`가 `{element, layer}`를 낸다. `changed()`는 구독자를 부른다). `startBoundsRelay`의 deps에 `layer(): number`를 더하고, 자기 `layer`보다 큰 cover만 `visibleRect`의 빼기에 쓴다(같거나 작은 cover는 무시. 그래서 floated native view가 자기 패널의 cover에 줄지 않는다). `send`에 층도 넘긴다: `send(rect, layer)`. 마지막에 보낸 `(rect, layer)`와 같으면 다시 보내지 않고, layer만 달라도 보낸다.
   - `embedded-view.tsx`: `ViewLayerProvider`(context, 기본 0)를 export하고 `EmbeddedView`가 읽어 `startBoundsRelay`에 `layer: () => layerRef.current`로 준다. 층이 바뀌면 view를 숨기지 않고 `relay.refresh()`로 다시 보낸다(effect의 deps에 layer를 넣으면 cleanup이 hide를 불러 깜빡인다. 그렇게 하지 않는다). `views.setViewBounds({ view_session, bounds, layer })`.
   - `useViewCover(ref, covering, layer?)`: `covers.add(element, layer)`를 하고 `() => covers?.changed()`를 `useCallback`으로 돌려준다. 기존 호출(`side-panel.tsx`, `project-picker.tsx`)은 layer를 안 주므로 늘 위다. 동작이 그대로다.
4. `dev-mock/app-space.ts`의 가짜 view 상자(`mockViews`)가 `setViewBounds`의 `layer`를 받아 `z-index`를 정한다: layer 0은 지금처럼 `1`, 1 이상은 floats 층(`--z-sticky` = 10, `wf-floated-layer`가 이 값을 쓴다)보다 위(`10 + layer`)다. 이유: gallery와 `dev:mock`에서 floated app panel의 가짜 상자가 자기 패널의 DOM 본문에 가려지지 않게 하려는 것이다. 진짜 native view는 DOM 위에 늘 그려진다.
5. 확인은 손으로 하지 않는다(Electron을 띄우는 test는 만들지 않는다). 순서 논리는 `appViewOrder`가 순수 함수 모양(fake host)이라 `deno check`로 충분하다.

## 정한 것

- 층 번호는 floats 배열 index + 1이다(agent). raise하면 번호가 바뀌고, 위 규칙대로 main이 다시 쌓는다. 접힌 항목의 번호는 쓰이지 않는다.
- 같은 층끼리는 cover를 서로 빼지 않는다(agent). 한 패널 안의 native view와 그 패널 cover가 같은 층이라 자기 패널에 줄지 않게 하려는 것이다.
- DOM 패널이 아래층이고 native floated view가 위층이면 cover가 적용되지 않는다(위 규칙의 결과). 맞는 동작이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. native view 순서는 Electron이 있어야 보이고, 이 계획은 Electron test를 새로 만들지 않는다.
- 남지 않음: `grep -rn "raise(window" packages/shell/main/app-frame/electron-app-frame.ts`가 `appViewOrder`가 부르는 한 곳만 남긴다.
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `side-panel.tsx`, `project-picker.tsx`, `app-space.tsx` 등 남의 file을 맞춘 곳
- 계약 바꾸기 요청: 위 모양을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 손으로 확인하지 못한 것(층 순서, 층 변경 때 깜빡임)을 적는다. lead가 손으로 본다.
