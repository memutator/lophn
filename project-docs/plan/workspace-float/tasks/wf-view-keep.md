# wf-view-keep

app panel(뒤에 browser)의 native view 수명을 `EmbeddedView`의 mount 수명이 아니라 탭의 수명으로 바꾼다. Float, Dock, 접기 때 `EmbeddedView`가 unmount되어도 view는 닫히지 않고 숨기만 하고, 같은 탭 key로 다시 mount하면 같은 view session을 다시 쓰고 bounds만 새로 보낸다. view는 탭이 layout에서 사라지거나(close/`removeTab`) 창이 닫힐 때 닫힌다. 이유: page 상태와 OAuth popup의 `window.opener`가 float/dock에서 사라지면 안 된다.

- 단위: wf-view-keep (wave 2)
- 선행: wf-native, wf-floated-wire
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/view-keeps.ts` (새 file)
  - `packages/shell/renderer/app-frame/embedded-view.tsx`
  - `packages/shell/renderer/workspace/app-panel-tab.tsx`
  - `packages/shell/renderer/workspace/kinds/app-panel.tsx`
  - `packages/shell/renderer/workspace/workspace.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "정한 것"(native view는 창을 옮길 때 다시 만들지 않는다. 이 task는 같은 창 안의 float/dock/접기 몫이다), `browser-tab` 계획의 popup `window.opener`
  - 앞 task: `wf-native.md`(`embedded-view.tsx`를 먼저 고친다. `ViewLayerProvider`, cover), `wf-floated-wire.md`
  - 지금 코드(이 brief는 아래를 열어 확인한 것이다):
    - `renderer/app-frame/embedded-view.tsx`: 열기 effect가 `views.openApp(input)`으로 `view_session`을 얻고, cleanup이 `alive = false`, `setViewSession(null)`, `views.closeView({view_session})`을 한다(여는 중에 unmount되면 늦게 온 view를 바로 닫는다). 보이는 동안만 도는 두 번째 effect가 bounds를 보내고 cleanup에서 `setViewsHidden`으로 숨긴다. 그러므로 지금은 `EmbeddedView`가 unmount될 때마다 view가 폐기된다.
    - `main/app-frame/registry.ts`: `hide`는 "떼어 숨긴다. view와 연결은 남는다", `setBounds`는 숨은 view를 다시 붙인다, `close`는 폐기, `closeWindow(window)`는 창의 view를 모두 폐기한다. 그래서 main은 고칠 것이 없다.
    - `workspace/kinds/app-panel.tsx`의 `keep`이 `AppPanelTab`을 그리고, `app-panel-tab.tsx`의 `AppPanelTab`이 `EmbeddedView`를 그린다. `app-frame/app-space.tsx`와 `workspace/visuals/app-card-block.tsx`도 `EmbeddedView`를 쓰지만 이 task의 대상이 아니다(`keepKey`를 주지 않으면 지금 동작 그대로다).
    - `workspace.tsx`: `appViews = useAppViews()`(`.views`가 `closeView`를 가진다), `createViewCovers`/`ViewCoversProvider` 쓰는 모양, `allTabs`(model).
- 계약:
  - 쓰는 것: `wf-native`가 만든 `EmbeddedView`/`ViewLayerProvider`. `wf-layout-model`의 `allTabs`.
  - 내놓는 것: `app-frame/view-keeps.ts`의 `createViewKeeps`, `embedded-view.tsx`의 `ViewKeepsProvider`와 `EmbeddedView`의 새 prop `keepKey?: string`. `wf-floated-layer`는 이것을 직접 쓰지 않는다. 단, 이 task가 끝나야 Float·Dock·접기에서 app panel이 reload되지 않는다.

```ts
// view-keeps.ts
interface KeptView { readonly session: string; readonly signature: string; state: AppFrameViewState }
export interface ViewKeeps {
  /** signature가 같은 보관 view를 꺼낸다(꺼내면 보관에서 빠진다). signature가 다르면 그 view를 닫고 undefined. */
  take(key: string, signature: string): KeptView | undefined;
  put(key: string, view: KeptView): void;       // 같은 key에 이미 있으면 먼저 것을 닫는다
  /** key의 view를 닫는다(보관 중이면). */
  release(key: string): void;
  /** 보관 중인 key 모두. */
  keys(): readonly string[];
}
export function createViewKeeps(close: (session: string) => void): ViewKeeps;
// embedded-view.tsx
export const ViewKeepsProvider: Provider<ViewKeeps | null>;   // 창(Workspace)마다 하나. 없으면 keepKey는 무시된다.
```

## 할 일

1. `view-keeps.ts`: 위 store(Map 하나). `signature`는 열기 입력(`app`, `mode`, `release`, `project`, `screen`, `size`)을 이은 글이다.
2. `embedded-view.tsx`: `keepKey`가 있고 provider가 있을 때만 다르게 동작한다. 없으면 지금 코드 그대로다.
   - 열기 effect: 먼저 `keeps.take(keepKey, signature)`. 있으면 `openApp`을 부르지 않고 그 `session`을 쓰고(`setViewSession`, `setPhase("ready")`, `onState`에 보관한 `state`) 끝낸다. 없으면 지금처럼 `openApp`.
   - 열기 effect cleanup: 지금은 `closeView`. `keepKey`가 있으면 `closeView` 대신 `keeps.put(keepKey, { session, signature, state: 마지막으로 안 state })`만 한다(숨기기는 bounds effect의 cleanup이 이미 한다). 여는 중에 unmount되어 늦게 온 view도 닫지 않고 `put`한다. 마지막 state는 `onState`/`subscribeViewState`로 ref에 갱신한다.
   - 다시 열기 버튼(`attempt`)이나 열기 입력이 바뀌면(signature 변경) 옛 view를 닫고 새로 연다: `take`가 signature가 다르면 닫아 준다. `attempt` 재시도는 실패한 열기라 보관된 것이 없다.
3. `kinds/app-panel.tsx`와 `app-panel-tab.tsx`: `AppPanelTab`에 `keepKey?: string` prop을 더하고 `EmbeddedView`에 넘긴다. `keep`이 `keepKey={tab.key}`를 준다. picker 단계(앱을 아직 안 고름)는 view가 없으므로 해당 없음.
4. `workspace.tsx`: `createViewKeeps((session) => void appViews?.views.closeView({ view_session: session }).catch(() => {}))`을 `useMemo`로 하나 만들어 `ViewKeepsProvider`로 `ViewCoversProvider` 근처에서 감싼다. 탭이 layout에서 사라지면 닫는다: `view`가 바뀔 때마다 도는 effect에서 `keeps.keys()` 중 `allTabs(view)`의 key에 없는 것을 `keeps.release`한다. `Workspace`가 unmount되면(프로젝트를 떠남) 남은 것을 모두 `release`한다. 창이 닫히면 main의 `closeWindow`가 폐기한다(추가 일 없음).
5. 보관 중인 view는 숨겨 있다(`setViewsHidden`). 다시 mount하면 bounds effect가 새 bounds(와 `wf-native`의 layer)를 보내 붙인다.

## 정한 것

- 보관 store는 renderer에 둔다(agent). main registry는 이미 hide/close를 구분하므로 새 IPC가 필요 없다.
- 탭이 닫혔는지는 `view` 변화를 보는 effect 하나로 판단한다(agent). `removeTab`, `closeTab`, Close All, 파일 이름 바꾸기 등 닫는 길이 여럿이라 길마다 닫는 호출을 넣지 않고 layout에 없으면 닫는다. 판단은 `keys()`와 `allTabs`의 차이 한 줄이라 test하지 않는다.
- 같은 `keepKey`로 두 `EmbeddedView`가 동시에 mount되지 않는다(탭 하나는 한 곳에만). 이 가정이 깨지면 `put`이 먼저 것을 닫는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. close-or-keep 판단은 한 줄 비교다.
- 남지 않음: 없음(더하는 것뿐이다. `app-space.tsx`, `app-card-block.tsx`는 `keepKey`를 주지 않으므로 동작이 같다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 보관 중에 바뀐 연결 state는 다시 mount할 때 마지막으로 안 state로 보인다(main이 다음에 push하기 전까지). 손으로 확인하지 못한 것
