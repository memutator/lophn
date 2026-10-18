# bt-popup-float

크기를 준 popup(`window.open`의 `features`에 `width`와 `height`)을 floated browser 탭으로 연다. OAuth popup이 작은 로그인 창처럼 보이고, 사용자가 접거나(minimized) dock할 수 있다. popup으로 생긴 floated 탭은 `layout.json`에 저장하지 않고, 사용자가 dock하면 그때부터 보통 탭이다.

**lead 주의: 이 task는 계획 `workspace-float`이 main에 land한 뒤에만 연다.** 아래 "소유"와 "계약"은 `workspace-float`이 만들 것을 roadmap(`project-docs/products/roadmap/workspace-float.md`)으로만 알고 쓴 것이다. 열기 전에 lead가 main을 `plan/browser-tab`에 merge하고, 실제 코드와 `project-docs/plan/workspace-float/`(README, tasks)를 읽어 이 brief의 이름과 path를 고친다. 특히 floated 탭을 여는 함수 이름, `TabItem`의 `transient` 표시, floated 층의 native view 순서(`view-order.ts`), cover 길을 확인한다.

- 단위: bt-popup (wave 3)
- 선행: bt-popup-tab, bt-bookmark-ui
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/workspace/kinds/host.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`("정한 것": wave 3은 `workspace-float`이 land한 뒤)
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(popup: 크기를 준 popup은 floated), `project-docs/products/roadmap/workspace-float.md`(floated, `transient`, native view 세 층, cover)
  - workspace-float 계획: `project-docs/plan/workspace-float/README.md`와 `tasks/*.md`(land된 뒤 실제 이름을 확인한다)
  - 본보기: `packages/shell/renderer/workspace/kinds/browser.tsx`의 `onPopup`(bt-popup-tab. 지금은 placement와 상관없이 docked), `bt-popup-host`가 보내는 `BrowserEvent { kind: "popup", placement }`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것(`workspace-float`이 내놓는다. 이름은 land된 코드를 따른다): floated 탭을 여는 host 함수(rect를 줄 수 있는 것), `TabItem`의 `transient` 표시와 "transient 탭은 저장하지 않는다" 규칙, floated 탭의 `render`/`keep` 호출.
  - 내놓는 것: 없음.

## 할 일

1. `kinds/browser.tsx`의 `onPopup(event)`: `event.placement.kind === "floated"`이면 `workspace-float`의 floated 열기 함수로 browser 탭(`fields: { url: "", adopt: event.view_session }`)을 `transient`로 연다. 패널의 처음 크기는 `placement`의 `width`×`height`를 기준으로 하되 `workspace-float`의 규칙(가장 작은 크기 320×200, workspace 안으로 당기기)에 맡긴다. `docked`이면 지금처럼 `{ after: 연 탭의 key }`다.
2. page의 `window.close()`(`close` event)는 지금 코드(`onCloseRequested` → `host.removeTab`)가 floated 탭도 닫는지 확인하고, 안 닫히면 floated 탭을 닫는 길을 쓴다.
3. 사용자가 dock하면 `transient` 표시가 풀려 보통 탭으로 저장되는지 확인한다(그 규칙은 `workspace-float`의 몫이다. 이 task는 browser 쪽 `toStored`/`fields.adopt`가 그와 부딪치지 않는지만 본다).
4. 손으로 확인한다(가능하면): 입력 있는 `window.open(url, "", "width=500,height=600")`이 floated 탭으로 뜬다. 입력 없는 `window.open`은 거절 알림이 뜬다. 가능한 곳이면 실제 Google 로그인 popup(lead가 손으로 확인하는 항목이므로 못 하면 보고에 적는다).

## 정한 것

- 이 brief의 내용 중 `workspace-float`이 정한 이름은 land 뒤 lead가 고친다. worker는 land된 코드와 이 brief가 어긋나면 코드를 따르고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. "popup으로 생긴 floated 탭을 저장하지 않는다"는 규칙의 test는 `workspace-float`이 둔다(`TabItem.transient`).
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `renderer/workspace/kinds/host.ts`(필요하면)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
