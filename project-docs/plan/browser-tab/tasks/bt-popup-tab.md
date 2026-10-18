# bt-popup-tab

main이 알린 popup(`popup` event)을 renderer에서 열린 탭 바로 뒤의 docked browser 탭으로 만들고 그 view를 가져온다(`adopt`). page가 `window.close()`를 부르면(`close` event) 그 탭을 닫는다. 크기를 준 popup(floated)도 이 task에서는 docked로 연다. floated는 `bt-popup-float`가 연다.

- 단위: bt-popup (wave 2)
- 선행: bt-popup-host, bt-tab-kind
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(popup)
  - 본보기(탭 열기): `packages/shell/renderer/workspace/model.ts`의 `openTabIn`, `workspace.tsx`의 `openTab`(`TabHost["openTab"]`), `kinds/host.ts`의 `TabHost.openTab`
  - 이 task가 쓰는 것: bt-contract(`BrowserEvent`의 `popup`·`close`, `LophnBrowserApi.adopt`), bt-popup-host(main이 보내는 event와 adopt 규칙), bt-tab-kind(`browserKind`, `openBrowserTab`)와 bt-tab-page(`BrowserTab`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `ipc/browser.ts`의 `BrowserEvent`, `browser.adopt`.
  - 내놓는 것: `TabHost.openTab(tab, options)`의 `options.after?: string`(그 key의 탭이 있는 칸에서 그 탭 바로 뒤에 넣고 선택한다. 그 탭이 없으면 `after` 없이 연 것과 같다). `BrowserTab`의 새 props: `adopt?: string`(처음 열 때 `open` 대신 `adopt`), `onAdopted(): void`, `onPopup(event): void`, `onCloseRequested(): void`.

## 할 일

1. `model.ts`: `openTabIn`에 선택 인자 `after?: string`을 더한다. 새 탭을 붙일 때 `after` 탭이 있는 칸이면 그 탭 바로 뒤에 넣고 그 칸을 focus 칸으로 삼는다. 다른 경우의 동작(preview 바꿔 쓰기, 이미 열린 key)은 그대로 둔다.
2. `kinds/host.ts`: `openTab`의 `options` 타입에 `after?: string`. `workspace.tsx`의 `openTab`이 `options.after`를 `openTabIn`에 넘긴다(`select: false` 갈래에서는 쓰지 않는다).
3. `browser-tab.tsx`: `adopt` prop이 있으면 mount 때 `browser.adopt({ view_session: adopt })`로 view를 얻고(`open`은 부르지 않는다), 얻은 뒤 `onAdopted()`를 부른다. 같은 BrowserTab의 `browser.subscribeEvents`에서 이 탭의 `view_session`이 `opener`인 `popup` event를 `onPopup(event)`으로, 이 탭의 `view_session`인 `close` event를 `onCloseRequested()`로 넘긴다.
4. `kinds/browser.tsx`
   - `onPopup(event)`: placement와 상관없이(floated도) `host.openTab({ key: 새 key, kind: "browser", title: browser 탭 이름 규칙, fields: { url: "", adopt: event.view_session } }, { after: 연 탭의 key })`.
   - `onAdopted`: `host.patchTab(tab.key, (current) => ({ fields: { ...current.fields, adopt: undefined } }))`처럼 `adopt`를 지운다(다시 mount돼도 `adopt`를 두 번 부르지 않게).
   - `onCloseRequested`: `host.removeTab(tab.key)`.
   - `toStored`는 `url`만 저장하므로 popup으로 생긴 탭도 다시 열면 보통 URL 탭이 된다(wave 2의 임시 상태. `bt-popup-float`가 floated 탭에는 저장하지 않는 규칙을 더한다).

## 정한 것

- 이 task는 model.ts의 `openTabIn` 하나만 고친다. 위험한 규칙(데이터 손실, 권한)이 아니라서 test를 더하지 않는다.
- popup 탭의 제목은 처음엔 browser 탭 이름 규칙(빈 주소면 종류 이름)이고, adopt 뒤 state로 page title이 들어온다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 손으로 본다(가능하면): 클릭으로 `target=_blank` link를 누르면 연 탭 바로 뒤에 새 탭이 열리고 선택된다. `window.close()`를 부르면 그 탭이 닫힌다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `renderer/workspace/model.ts`, `kinds/host.ts`, `workspace.tsx`(`after` 옵션)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". `window.close()` event가 main에서 오지 않는다고 `bt-popup-host`가 보고했으면 그 사실을 적는다.

## lead가 더함

bt-popup-host가 merge되며 정해진 것(`packages/shell/main/browser/registry.ts`, `popup-host.ts`):
- page의 `window.close()`는 `webContents`의 `close` event로 오고 main이 `close` BrowserEvent를 보낸다. 그 직후 contents가 부서진다. 닫는 일은 renderer가 탭을 지워(`closeView`) 한다.
- adopt 전에도 `close` event가 올 수 있다(popup이 바로 닫힘). `adopt` prop의 `view_session`으로 온 `close`도 adopt 응답 전부터 `onCloseRequested`로 넘긴다.
- adopt되지 않은 view에는 state push가 없다. state는 adopt 응답에 실려 온다.
- 없는 view나 다른 창의 view를 adopt하면 `invalid_input`, 이미 adopt된 view는 `forbidden`으로 거절된다(`not_found`는 오지 않는다). 거절되면 그 탭은 `ErrorState`를 보이고 다시 adopt하지 않는다.
- popup은 opener 탭을 닫아도 남는다(`outlivesOpener: true`). `onPopup`의 `after` 탭이 그새 닫혔으면 `after` 없이 연 것과 같다.
