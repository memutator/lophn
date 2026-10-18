# bt-popup-float

크기를 준 popup(`window.open`의 `features`에 `width`와 `height`)을 floated browser 탭으로 연다. OAuth popup이 작은 로그인 창처럼 보이고, 사람이 접거나(minimized) dock할 수 있다. popup으로 생긴 floated 탭은 `transient`라 `layout.json`에 저장하지 않고, dock하면 보통 탭이 된다. 그리고 browser 탭도 Float·Dock·접기로 다시 mount될 때 page를 다시 열지 않고 같은 view를 쓰게 한다(app panel의 `ViewKeeps`처럼). 안 그러면 floated popup을 dock하는 순간 page가 다시 load되어 로그인 중인 화면과 `window.opener`가 끊긴다.

- 단위: bt-popup (wave 3)
- 선행: bt-popup-tab, bt-bookmark-ui, bt-menu-overlay
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/app-frame/view-keeps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`(floats, `openFloat`, `TabItem.transient`, `storableView`, `dockTab`이 transient를 지운다, native view 층과 `ViewLayerProvider`, cover, `ViewKeeps`), `project-docs/architecture/browser-tab.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(popup: 크기를 준 popup은 floated)
  - 지금 코드
    - `renderer/workspace/model.ts`: `openFloat(view, tab, area)`(크기를 받지 않고 `newFloat`가 `.content`의 60% 가운데로 연다), `newFloat`, `clampFloatRect`(가장 작은 320×200, `.content` 안으로 당기기), `dockTab`, `storableView`
    - `renderer/workspace/kinds/host.ts`의 `TabHost`(`openTab`, `patchTab`, `removeTab`. float 열기는 아직 없다), `workspace.tsx`에서 host를 만드는 곳과 floats 층, `floatFocused`
    - `renderer/workspace/kinds/browser.tsx`의 `onPopup`(지금은 placement와 상관없이 docked, `{ after }`), `onCloseRequested`(`host.removeTab`)
    - `renderer/browser/browser-tab.tsx`(mount 때 `open`/`adopt`, unmount 때 `closeView`), `renderer/app-frame/embedded-view.tsx`가 `ViewKeeps`(`take`/`put`, `keepKey`)를 쓰는 방식, `renderer/app-frame/view-keeps.ts`(`KeptView.state`가 지금 `AppFrameViewState`다)
    - main 쪽 popup 규칙: `packages/shell/main/browser/registry.ts`(`adopt`는 한 번만)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`

## 할 일

1. `model.ts`: `openFloat`에 선택 인자로 처음 크기(`{ width, height }`)를 받는다. 주면 그 크기로 `.content` 가운데에 열고 `clampFloatRect` 규칙(최소 320×200, 안으로 당기기)을 거친다. 안 주면 지금처럼 60%다. `model_test.ts`의 위험 test가 그대로 통과한다.
2. `kinds/host.ts`·`workspace.tsx`: `TabHost`에 floated 탭을 여는 함수(예: `openFloat(tab, size?)`)를 더한다. workspace가 지금 `.content` 크기(area)로 `openFloat`을 부르고 floats 층에 focus를 준다(`floatFocused`). `.content`를 아직 못 쟀으면 docked로 연다.
3. `kinds/browser.tsx`의 `onPopup(event)`: `placement.kind === "floated"`이면 `host.openFloat({ key, kind: "browser", title, fields: { url: "", adopt: event.view_session }, transient: true }, { width, height })`. `docked`이면 지금처럼 `openTab(..., { after })`다. floated 탭에서 연 popup도 같다.
4. browser view 보관: `BrowserTab`이 Float·Dock·접기로 unmount되어도 탭이 layout에 남아 있으면 view를 닫지 않고 `ViewKeeps`에 숨겨 두었다가, 같은 탭 key로 다시 mount되면 `open`/`adopt`를 다시 부르지 않고 그 view를 쓴다. `view-keeps.ts`의 `KeptView.state`가 앱 전용 type이면 kind와 상관없게 넓힌다(앱 쪽 동작은 그대로). 탭이 layout에서 사라지면 닫는 것은 지금 Workspace의 규칙이 그대로 한다.
5. page의 `window.close()`(`close` event → `onCloseRequested` → `host.removeTab`)가 floated 탭도 닫는지 확인한다. `removeTab`은 floats도 본다(`workspace-layout.md`).
6. dock하면 `dockTab`이 `transient`를 지운다. browser 쪽 `toStored`(url만 저장)와 `fields.adopt`(adopt 뒤 지운다)가 그와 부딪치지 않는지 본다.

## 정한 것

- 크기를 준 popup이 연 탭과 같은 pane에 들어가지 않고 floats로 뜨는 것은 roadmap(사람)이다.
- 열린 popup의 처음 rect는 `.content` 가운데다. opener 탭 근처에 두기는 하지 않는다(`workspace-layout.md`: 새 패널은 가운데).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: `model_test.ts`의 기존 위험 test가 통과한다. 새 test는 `openFloat`에 크기를 준 경우가 기존 위험 test("탭 하나는 한 곳에만")에 이미 덮이지 않으면 그 test의 표에 한 줄을 더하는 정도로만 둔다.
- 남지 않음: 없음.
- 손으로 보는 것은 lead가 한다(실제 Google 로그인 popup).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `renderer/workspace/model.ts`, `kinds/host.ts`, `workspace.tsx`, `app-frame/view-keeps.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
