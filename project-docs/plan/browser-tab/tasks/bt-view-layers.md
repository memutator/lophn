# bt-view-layers

browser 탭의 native view를 창의 native view 층 순서(`appViewOrder`: pane view < floated view < overlay)에 앱 view와 함께 넣는다. 지금 browser view는 `electron-view.ts`의 `attach`가 `addChildView`와 overlay raise만 해서, floated browser 탭이 pane의 앱 view 밑에 깔리거나 floated 앱 view와 순서가 어긋날 수 있다. `layer`는 renderer(`useViewBounds`)가 이미 보내고 registry가 `placement`에 넘긴다(main merge 때 lead가 이었다).

- 단위: bt-view-layers (wave 3)
- 선행: bt-menu-overlay
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/view-order.ts`
  - `packages/shell/main/app-frame/electron-app-frame.ts`
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/desktop/wiring/browser.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`("native view는 세 층으로 쌓인다"), `project-docs/architecture/browser-tab.md`
  - 지금 코드: `app-frame/view-order.ts`의 `appViewOrder`, `electron-app-frame.ts`의 `orders`·`orderOf`(창마다 하나, WeakMap), `browser/electron-view.ts`의 `attach`·`detach`, `wiring/browser.ts`(`register`가 `{ views, frame }`를 돌려준다), `wiring/app-views.ts`(`register(ctx, browser)`), `desktop/main.ts`(browser를 appViews보다 먼저 등록)

## 할 일

1. 창마다 하나인 층 순서를 앱 view와 browser view가 같이 쓴다. `orderOf(window)`(WeakMap)를 `electron-app-frame.ts` 밖으로 꺼내(예: `view-order.ts`에 창별 순서 묶음을 만드는 함수) wiring에서 한 번 만들고, `electronAppViews`와 `electronBrowserViews` 둘 다 그것을 받게 한다. browser wiring이 먼저 등록되므로 거기서 만들어 `register`의 반환값으로 `app-views.ts`에 넘기면 된다.
2. `electron-view.ts`의 `attach(ref, adapter, bounds, layer)`는 `orderOf(window).attach(view, layer)` 뒤 `setBounds`, `detach`는 `orderOf(window).remove(view)`. 지금의 `children.includes` 검사와 직접 raise는 지운다(`appViewOrder`가 overlay를 올린다).
3. 동작은 앱 view 쪽이 바뀌지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(`appViewOrder`는 이미 test가 있다면 그대로 통과해야 한다).
- 남지 않음: `grep -n "children.includes" packages/shell/main/browser/electron-view.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `app-frame/electron-app-frame.ts`, `wiring/app-views.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
