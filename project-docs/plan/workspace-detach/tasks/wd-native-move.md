# wd-native-move

native view(app panel, 뒤에 browser)를 닫지 않고 다른 창으로 옮겨 붙인다. main은 view를 한 창에서 떼어 다른 창 소유로 바꾸는 `move`를 낸다. renderer는 `ViewKeeps`가 mount된 view도 key로 찾을 수 있게 하고(`lookup`), app panel kind의 `transfer`/`receive`가 그것을 쓴다. 이유: page를 다시 load하면 쓰던 form과 OAuth popup의 `window.opener`가 사라진다.

- 단위: wd-native-move (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/registry.ts`
  - `packages/shell/main/app-frame/visibility.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/shell/renderer/app-frame/view-keeps.ts`
  - `packages/shell/renderer/app-frame/embedded-view.tsx`
  - `packages/shell/renderer/workspace/kinds/app-panel.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 4(app_panel, browser: `removeChildView`/`addChildView`, `entry.window`와 `owner()`, `closeWindow`), "정한 것"(native view는 옮겨 붙인다)
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"(browser-tab과의 접점)
  - architecture: `project-docs/architecture/workspace-layout.md`("app panel의 native view는 탭이 사는 동안 산다"), `project-docs/architecture/annotation.md`(app view identity)
  - 지금 코드(이 brief는 아래를 열어 확인한 것이다):
    - `main/app-frame/registry.ts`: `Entry`가 `Placed.window`(창 ref 문자열)를 가진다. `owner(view_session)`, `hide`, `closeWindow(window)`, `pushState`(`deps.onState(entry.window, …)`로 그 창 renderer에 `shell:view-state`를 민다), `state(view_session)`.
    - `main/app-frame/placement.ts`: `detach(entry)`(떼고 `attached=false`, 키보드 focus를 가졌으면 `focusShell(entry.window)`), `hide`, `setBounds`, `place`(`entry.placed`가 이미 true면 붙일 때 `generation`을 올린다). 이 file은 고치지 않는다.
    - `main/app-frame/visibility.ts`: `owned(window, view_session)`로 view를 연 창만 다룬다. `pending`(16ms 묶음 bounds)이 `Pending.window`를 들고 있어, 옮긴 뒤 flush되면 옛 창 기준 bounds가 새 창에 적용된다. `cancel(view_session, result)`가 이것을 버린다.
    - `main/app-frame/electron-app-frame.ts`: `native`가 adapter → `WebContentsView`이고 창 기억은 `orders`(WeakMap, 창마다 `appViewOrder`)뿐이다. `detach(ref, adapter)`와 `attach(ref, adapter, bounds, layer)`를 차례로 부르면 한 창의 `removeChildView`와 다른 창의 `addChildView`가 되므로 이 file은 고치지 않는다.
    - `main/desktop/wiring/app-views.ts`: `AppViews`(뒤 영역이 쓰는 값)와 `viewVisibility`.
    - `renderer/app-frame/view-keeps.ts`(`take`·`put`·`release`·`keys`), `embedded-view.tsx`(`dispose`가 `keeps.put`, `show`, `lastState`, `subscribeViewState`), `renderer/workspace/kinds/app-panel.tsx`(`keep`이 `keepKey={tab.key}`를 준다), `renderer/workspace/app-panel-tab.tsx`
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wd-contract`의 `TabTransfer`(`ipc/detached.ts`), `TabKindDef.transfer`/`receive`(`kinds/kind.ts`), `TabHost.keeps`(`kinds/host.ts`).
  - 내놓는 것(`wd-main`이 기댄다. 이 모양을 바꿔야 하면 보고에 적는다):

```ts
// main/app-frame/registry.ts — createAppFrame()이 낸다
/**
 * view를 닫지 않고 from 창에서 to 창으로 옮긴다. view가 from 창의 것이 아니면 invalid_input("view is not open"),
 * to 창이 열려 있지 않으면 invalid_input("window is not open"). 옮기면 떼어 숨긴 상태가 되고
 * (page와 연결은 산다) 새 창 renderer가 bounds를 보내면 붙는다. 새 창에 state를 push한다.
 */
move(view_session: string, from: string, to: string): Outcome<AppFrameViewState>;

// main/app-frame/visibility.ts — createViewVisibility()가 낸다. frame은 `Pick<AppFrameService, …>`에 "owner"가 이미 있다
/** 모두 window의 view인가. */
owns(window: string, view_sessions: readonly string[]): boolean;
/** 모두 from 창의 view일 때만(아니면 아무것도 옮기지 않고 invalid_input) 기다리던 bounds를 버리고 옮긴다. 모두 성공하거나 아무것도 안 바뀐다. */
move(from: string, to: string, view_sessions: readonly string[]): Outcome<AppFrameViewState[]>;

// main/desktop/wiring/app-views.ts — AppViews에 더한다
owns(window: string, view_sessions: readonly string[]): boolean;
moveViews(from: string, to: string, view_sessions: readonly string[]): Outcome<AppFrameViewState[]>;

// renderer/app-frame/view-keeps.ts — ViewKeeps에 옆으로 더한다
/** mount돼 있든 보관 중이든 key의 view. 없으면 undefined. state는 EmbeddedView가 push를 받을 때마다 갱신한 최신 값이다. */
lookup(key: string): KeptView | undefined;
/** EmbeddedView가 view를 얻었을 때(열었거나 take했을 때) 알린다. mount된 동안 lookup이 찾게 한다. */
track(key: string, view: KeptView): void;
```

## 할 일

1. `registry.ts`: `move`. `entries.get(view_session)`가 없거나 `entry.window !== from`이면 `invalid_input`, `deps.views.hasWindow(to)`가 아니면 `invalid_input`. `placement.hide(entry)`로 떼어 숨긴 뒤 `entry.window = to`로 바꾸고 `pushState(entry)`를 부른 뒤 `state(entry)`로 답한다. `closeWindow`, `owner`, `views(window)`는 `entry.window`를 그대로 읽으므로 고치지 않는다. 근거: roadmap "무엇을 만드나" 4.
2. `visibility.ts`: `owns`, `move`. `frame` 의존에 `move`를 **선택 칸**으로 더한다(`Pick<AppFrameService, …> & Partial<Pick<AppFrameService, "move">>`). `frame.move`가 없으면 `move`는 `unavailable`을 돌려준다(다른 계획의 browser view registry가 아직 `move`를 안 낼 수 있다). 옮기기 전에 `owned(from, …)`를 모두 확인하고, 각 view의 기다리던 bounds를 `cancel(view_session, notOpen)`으로 버린다.
3. `wiring/app-views.ts`: `AppViews`에 `owns`, `moveViews`를 더해 `viewVisibility`에 잇는다.
4. `view-keeps.ts`: `lookup`, `track`. 한 Map에 `{ view, mounted }`로 두면 된다(`take`는 mounted로 바꾸고, `put`은 보관으로 바꾼다). `keys()`는 지금처럼 보관 중인 key만 낸다(Workspace의 "layout에서 사라진 탭의 view를 닫는다" effect가 그대로 동작해야 한다). `release`는 mount된 view는 닫지 않는다. 기존 `take`·`put`·`release`·`keys`의 동작은 바꾸지 않는다.
5. `embedded-view.tsx`: `keepKey`와 keeps가 있을 때 `show(state)`에서 `keeps.track(keepKey, { session, signature, state })`를 부른다(`dispose`가 이미 같은 모양으로 `put`한다). `subscribeViewState`로 state가 올 때마다 tracked `state`를 갱신해 `lookup`이 최신을 주게 한다. 보관소가 없을 때(keepKey 무시)의 동작은 그대로다.
6. `kinds/app-panel.tsx`에 `transfer`/`receive`를 더한다.
   - `transfer(tab, host)`: `host.keeps.lookup(tab.key)`가 없으면(앱을 아직 안 골랐거나 열리는 중) `{ value: null, views: [] }`. 있으면 `{ value: { signature, state }, views: [session] }`.
   - `receive(tab, transfer, host)`: `transfer.views[0]`과 `value`의 모양을 확인하고(맞지 않으면 아무것도 하지 않는다) `host.keeps.put(tab.key, { session, signature, state })`. 그러면 받는 창의 `EmbeddedView`가 mount될 때 `take`가 같은 view를 이어 쓴다(signature가 같아야 한다. 같은 project·app·screen이면 같다).
7. 확인은 손으로 하지 않는다(창 여럿을 띄우는 Electron test는 만들지 않는다). 순서 논리는 `deno check`와 읽기로 한다.

## 정한 것

- 옮기는 일은 main에서 `view_session`을 새 창 소유로 바꾸는 것뿐이다(agent). 옛 창 renderer가 늦게 보내는 `setViewBounds`·`setViewsHidden`·`closeView`는 `owned` 검사로 `invalid_input`이 되어 무해하다. 그래서 renderer는 옮긴 뒤 옛 창의 `EmbeddedView`를 먼저 치우지 않아도 된다.
- 옮긴 뒤 새 창에 push한 state는 새 창의 `EmbeddedView`가 subscribe하기 전에 도착해 잃을 수 있다(agent). 보낸 쪽이 `transfer`에 실은 `state`로 시작하고 그 뒤 push를 받는다. 보관 중 state가 낡는 문제(`project-docs/issues/workspace-layout.md`의 열린 bug)는 이 task가 고치지 않는다.
- `visibility.move`의 `frame.move`를 선택으로 둔다(agent). 계획 `browser-tab`의 `routeFrame`이 `move`를 낼 때까지 browser view는 옮겨지지 않고 `unavailable`이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 소유 검사는 기존 `owned`가 하고, 옮긴 뒤 옛 창의 요청이 거절되는 것은 같은 검사의 결과다. 이 계획은 Electron test를 새로 만들지 않는다.
- 남지 않음: 없음(더하는 것뿐이다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 서고 `deno run -A packages/shell/main/build.ts`로 main bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 위 모양을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 손으로 확인하지 못한 것(창 사이 이동 뒤 bounds, focus)을 적는다. lead가 손으로 본다.
