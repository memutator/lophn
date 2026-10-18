# bt-popup-host

browser 탭 안 page의 `window.open`·`target=_blank`를 main에서 받는다. 사용자 입력 5000ms 안의 것만 `createWindow`로 새 view를 만들어 돌려주어 `window.opener`가 남게 하고(OAuth popup 로그인이 동작한다), 입력 없는 것은 거절하며 renderer에 알린다. page가 `window.close()`를 부르면 그 탭을 닫으라고 알린다. renderer가 만든 탭이 그 view를 가져가는 IPC(`adopt`)도 연다.

- 단위: bt-popup (wave 2)
- 선행: bt-view
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/popup-host.ts`
  - `packages/shell/main/browser/registry.ts`
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/browser/browser-ipc.ts`
  - `packages/shell/main/desktop/wiring/browser.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(popup)과 "정한 것"의 popup 둘
  - 본보기(규칙): `/home/pyosechang/projects/rea/project/desktop-embeded-browser/src/main/tabs.js`(`setWindowOpenHandler`), `popups.js`. rea는 popup을 거절하고 새 tab을 따로 load해서 `window.opener`가 끊긴다. 여기서는 그렇게 하지 않는다.
  - Electron 44.5.1의 `setWindowOpenHandler`와 `createWindow`: `packages/shell/main/node_modules/electron/electron.d.ts`의 `WindowOpenHandlerResponse`(`createWindow`), `HandlerDetails`(`features`, `disposition`)
  - 이 task가 쓰는 것: bt-rules(`decidePopup`, `createActivation`), bt-view(`registry.ts`, `electron-view.ts`의 contents hook, `frame-router.ts`), bt-contract(`BrowserEvent`, `BROWSER_ADOPT_CHANNEL`, `browserAdoptSchema`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: `decidePopup`의 `PopupDecision`, `ipc/browser.ts`의 `BrowserEvent`(`popup`, `popup-blocked`, `close`)와 `BROWSER_ADOPT_CHANNEL`.
  - 내놓는 것: 열린 popup마다 소유 창 renderer에 `BrowserEvent { kind: "popup", opener, view_session, placement }`가 `BROWSER_EVENT_CHANNEL`로 간다. renderer가 탭을 만든 뒤 `BROWSER_ADOPT_CHANNEL`로 `{ view_session }`을 보내면 그 view의 `BrowserViewState`로 답하고, 그 뒤 bounds는 보통 view처럼 `shell:view-bounds`로 온다. `popup-blocked`와 `close`도 `BROWSER_EVENT_CHANNEL`로 간다.

## 할 일

1. `popup-host.ts`: 각 browser contents의 `setWindowOpenHandler`를 이 함수로 바꾼다. 입력은 `{ url, features, disposition }`와 열린 contents다.
   - `decidePopup({ url, features, activated: activation.fresh(opener contents id) })`.
   - 거절이면 `{ action: "deny" }`. `reason`이 `no-activation`이면 소유 창에 `popup-blocked` event를 보낸다. `external`이 붙은 거절(`mailto:`·`tel:`)은 `activation.fresh`일 때만 `openExternal`로 OS에 넘긴다.
   - 허용이면 `{ action: "allow", createWindow }`를 돌려준다. `createWindow(options)`는 새 `WebContentsView`를 만들어 그 `webContents`를 돌려준다. `webPreferences`는 bt-view와 같은 hardened 값(`webPreferences(packaged)`, 같은 partition, `devTools: true`, preload 없음)으로 덮어쓰고 Electron이 준 `options.webPreferences`를 그대로 믿지 않는다. 새 contents에도 bt-view의 contents hook을 같은 함수로 건다(popup 안에서 다시 popup, navigation 규칙, 입력 기록).
2. 새 항목을 registry에 `view_session`(`browser-<uuid>`)으로 등록한다. 소유 창은 opener와 같고 `shown`은 false, adopt 전 표시(`adopted: false`)가 붙는다. popup의 첫 load는 Electron이 `url`로 시작한다. 그 load가 끝나면(실패 포함) `placement.loaded`를 부른다(adopt보다 먼저 끝나도 되고, 붙는 것은 bounds가 온 뒤다). 등록한 뒤 소유 창에 `popup` event를 보낸다(`opener`는 연 view의 `view_session`).
3. `BROWSER_ADOPT_CHANNEL` handler(`browser-ipc.ts`): caller 검사, 입력 schema 검사, 그 `view_session`의 소유 창이 caller 창이고 아직 adopt되지 않았을 때만 `adopted`로 바꾸고 `BrowserViewState`로 답한다. 아니면 `forbidden` 또는 `not_found`.
4. page의 `window.close()`: 그 view에 `close` event를 소유 창에 보낸다. 어떤 Electron event로 오는지는 roadmap이 정하지 않았다. `electron.d.ts`(`WebContents`의 event들)와 손으로 확인해 알아내고 그 event에 단다(`webContents.close()`를 page가 부른 경우의 `close` 등). 찾지 못하면 `close` event를 만드는 길을 알려진 미완 동작에 적는다. 닫는 일 자체는 renderer가 탭을 닫아(`closeView`) 한다.
5. `wiring/browser.ts`: adopt handler 등록과 제거를 더한다.

## 정한 것

- 소유 창은 항상 opener의 창이다. renderer가 adopt하지 않은 view는 그 창이 닫힐 때까지 남는다(`closeWindow`가 폐기한다). adopt 시간 초과 정리는 두지 않는다(AGENTS.md "속도". renderer가 popup event에 탭을 만들지 못한 일은 거의 없다).
- wave 2에서는 `placement`가 floated여도 event에 그대로 싣기만 하고 main은 다르게 다루지 않는다. 어디에 어떻게 열지는 renderer가 정한다(`bt-popup-tab`은 docked, `bt-popup-float`가 floated).
- `background-tab` disposition도 선택하는 탭으로 연다(구분하지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 허용 판정은 bt-rules의 `decidePopup` test가 본다. `createWindow` 연결은 Electron이 있어야 해서 test하지 않는다(사람에게 묻기 전에는 Electron을 띄우는 test를 만들지 않는다).
- 가능하면 손으로 확인한다: 사용자 클릭으로 `window.open('https://example.com', '', 'width=500,height=600')`을 열면 `popup` event가 가고, 입력 없이 `setTimeout`으로 부르면 `popup-blocked`가 간다. 확인하지 못한 것은 알려진 미완 동작에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(`window.close()`가 오는 event 이름을 꼭 적는다)
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함

- OAuth popup은 자주 `window.open("", name, features)`로 빈 창을 먼저 연 뒤 주소를 바꾼다. 이때 `setWindowOpenHandler`의 `details.url`이 무엇으로 오는지(`about:blank`인지 빈 글인지) 손으로 확인한다. `decidePopup`은 main frame에서 정확히 `about:blank`만 받으므로, 빈 글로 오면 `about:blank`로 바꿔 넘긴다. 확인한 값을 "정한 것"에 적는다.
