# wd-browser

browser 탭 kind가 창 사이 옮기기를 선언한다. 보통 탭(`<webview>`)은 저장된 값(url)만 가고 받는 창에서 page가 다시 load된다(cookie는 partition에 남고 page 상태는 잃는다. 사람의 설계 결과이고 `browser-tab.md`가 정한 것이다). 크기 준 popup의 native view는 `wd-native-move`의 항구로 닫지 않고 옮겨서 `window.opener`가 산다. DevTools는 그 popup 탭에 붙은 것이 같이 옮겨진다.

- 단위: wd-browser (wave 2)
- 선행: wd-native-move. `ViewKeeps.lookup`/`track`을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/workspace/kinds/browser-devtools.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workspace-float.md`의 "무엇을 만드나" 4(app_panel, browser; detached 창 안의 popup)
  - 계획: `project-docs/plan/workspace-detach/README.md`의 "정한 것"(browser)
  - architecture: `project-docs/architecture/browser-tab.md`("흐름", "지키는 것"의 `<webview>`는 다른 부모로 옮기지 않는다 / 크기 준 popup만 native view / popup view는 adopt하기 전까지 state를 밀지 않는다 / DevTools는 page마다 새 native view, "왜 이 모양인가"의 마지막 항목)
  - 지금 코드(main `5361104e8`을 열어 확인한 것이다):
    - `renderer/workspace/kinds/browser.tsx`: `browserKind`(`keep`이 `BrowserTab`을 그린다. `layer`는 `host.view.floats`의 index + 1이고 pane이면 0이다. `native`는 `tab.fields.native === true`, `adopt`는 `fields.adopt`. `onPopup`이 `host.openFloat({ … fields: { url: "", adopt, native: true }, transient: true }, size)`, `onDocked`가 native를 지운다), `toStored`는 `{kind, key, url}`뿐이다.
    - `renderer/browser/browser-tab.tsx`: `BrowserTab`(`native && layer === 0`이면 `DockNative`가 보관 view를 닫고 `onDocked`로 `<webview>` 탭으로 바꾼다), `OpenTab`(native 탭은 `keeps.take<BrowserViewState>(keepKey, KEEP_SIGNATURE)` 또는 `browser.adopt`로 view를 얻고 unmount 때 `keeps.put`한다. `lastNative` ref, `apply`), `KEEP_SIGNATURE = "browser"`(export하지 않는다), `useViewBounds`로 native view의 bounds를 보낸다.
    - `renderer/workspace/kinds/browser-devtools.tsx`: `DevtoolsState`(`session`, `place`: right·bottom·float·window, `size`), `readDevtools`, `setDevtools(host, target, next)`(place가 float이면 `browser_devtools` transient 탭을 `host.openFloat`로 열고 아니면 `host.removeTab(floatKey)`), `browserDevtoolsKind`.
    - `renderer/app-frame/view-keeps.ts`(`wd-native-move` 뒤: `lookup`, `track`), `kinds/host.ts`의 `TabHost.viewKeeps`.
  - module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `wd-contract`의 `TabKindDef.transfer`/`receive`/`noDetach`, `TabTransfer`, `slimDetachedTab`. `wd-native-move`의 `ViewKeeps.lookup`/`track`과 main의 `move` 항구(popup과 DevTools 항목 모두).
  - 내놓는 것: `browserKind.transfer`/`receive`, `browserDevtoolsKind.noDetach`. `wd-window-ui`가 detached 창의 `host`에서 `view.detached`와 `openFloat`로 이 kind를 그린다(`wd-window-ui` 계약 참조).

## 할 일

1. `browser-tab.tsx`: `KEEP_SIGNATURE`를 export한다. native 탭이 view를 얻을 때(`keeps.take` 또는 `adopt` 응답)와 `apply`로 state가 바뀔 때 `keeps.track(keepKey, { session, signature: KEEP_SIGNATURE, state })`를 부른다(`lookup`이 mount된 native view를 찾고 최신 state를 주게 한다). unmount 때 하던 `keeps.put`은 그대로다.
2. `browser.tsx`의 `keep`: `layer`를 `floats` index + 1, 아니면 `host.view.detached`에 이 탭이 있으면 1, 아니면 0으로 한다(detached 창의 native popup 탭이 pane 탭으로 오인돼 `DockNative`로 빠지지 않게 한다. 이 창에는 floats 층이 없어 `1`은 그 창 안의 유일한 view라는 뜻뿐이다).
3. `browser.tsx`에 `transfer`/`receive`를 더한다.
   - `transfer(tab, host)`:
     - 보통 탭(`fields.native !== true`): `readDevtools(tab.fields?.devtools)`가 있으면 `setDevtools(host, tab.key, null)`로 비운다(DevTools는 옛 `<webview>`와 같이 사라진다). `{ value: null, views: [] }`. url은 `tab.fields.url`이 이미 갖고 있고 `onState`가 계속 갱신한다.
     - native popup 탭: `host.viewKeeps.lookup<BrowserViewState>(tab.key)`가 없으면(adopt 중) null(옮기지 않는다). 있으면 `{ value: { state }, views: [session] }`. DevTools가 열려 있으면(`readDevtools`) 그 `session`도 `views`에 넣는다. `place`가 `float`이면 먼저 `setDevtools(host, tab.key, { …devtools, place: "right" })`로 탭 안으로 바꾼다(floated DevTools 패널은 대상 탭과 같은 창에 있어야 해서 같이 옮기지 않는다).
   - `receive(tab, transfer, host)`: native 탭만. `transfer.views[0]`과 `value.state`의 모양을 확인하고(맞지 않으면 아무것도 하지 않는다) `host.viewKeeps.put(tab.key, { session: transfer.views[0], signature: KEEP_SIGNATURE, state })`. 그러면 받는 창의 `BrowserTab`이 mount될 때 `take`가 같은 view를 이어 쓰고, 탭의 `fields.devtools`(session·place·size)는 탭 값에 실려 와 `DevtoolsPane`이 같은 DevTools view에 붙는다.
4. `browser-devtools.tsx`: `browserDevtoolsKind`에 `noDetach: true`.
5. 확인은 손으로 하지 않는다(Electron·`<webview>`를 띄우는 test는 만들지 않는다). 흐름은 type과 읽기로 검토한다.

## 정한 것

- 보통 browser 탭은 옮길 상태가 없다(사람, `browser-tab.md`). 받는 창에서 저장된 url을 새로 load한다. 로그인(cookie)은 partition 하나를 모든 창이 같이 써서 남고, 쓰던 form과 scroll, 같은 page가 연 popup의 `window.opener`는 잃는다. Detach 때 알림은 두지 않는다.
- DevTools는 보통 탭을 옮기면 닫힌다(agent). DevTools frontend는 `<webview>`에 붙지 않아 옛 page가 사라지면 연결이 끊긴다.
- 크기 준 popup 탭과 그 DevTools는 닫지 않고 옮긴다(사람의 요구). DevTools가 floated 패널이던 popup 탭은 탭 안(오른쪽)으로 바꿔 옮긴다(agent).
- `browser_devtools` 패널은 Detach하지 않는다(agent, `noDetach`). 그 패널은 대상 browser 탭의 `fields.devtools`에 묶여 따로 떼면 대상 탭을 바꿀 수 없다.
- detached 창에서 DevTools를 floated 패널로 두는 것은 되지 않는다(agent). 그 창에는 floats 층이 없고 `host.openFloat`는 popup만 받는다(`wd-window-ui`). 탭 안(오른쪽·아래)과 따로 뜬 OS 창은 된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 화면과 창 흐름은 test하지 않는다(write-test).
- 남지 않음: 없음(더하는 것뿐이다. `browser.tsx`의 `layer` 계산만 바뀐다).
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 손으로 확인하지 못한 것(popup을 Detach해도 opener가 사는지, DevTools가 따라가는지)을 적는다. lead가 손으로 본다.
