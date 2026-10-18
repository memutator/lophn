# bt-webview-main

보통 browser 탭을 shell renderer의 `<webview>`로 띄우는 main 쪽을 만든다. shell 창에서만 `<webview>`를 허락하고, `will-attach-webview`에서 설정을 강제하고, `did-attach-webview`로 받은 guest contents에 지금의 browser 규칙(navigation, activation, Ctrl/Cmd+D, state push, popup)을 그대로 건다. 크기 준 popup은 지금의 native `WebContentsView` 길(adopt)로 남기고, 크기 없는 popup은 거절하고 renderer에 새 탭을 열라고 알린다. 보통 탭을 native view로 여는 길(`open`)은 지운다.

- 단위: bt-webview-main (wave 3)
- 선행: bt-view-layers, bt-popup-float
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/security.ts`
  - `packages/shell/main/desktop/window.ts`
  - `packages/shell/main/browser/registry.ts`
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/browser/popup-host.ts`
  - `packages/shell/main/browser/browser-ipc.ts`
  - `packages/shell/main/browser/webview-guest.ts`(새로)
  - `packages/shell/main/desktop/wiring/browser.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`의 "정한 것" 끝 세 줄(2026-10-19)
  - architecture: `project-docs/architecture/browser-tab.md`(지금 모양. 이 task와 `bt-webview-ui`가 끝나면 lead가 고친다)
  - lead 실험 결과(Electron 44.5.1에서 잰 것):
    - `will-attach-webview`의 `(event, webPreferences, params)`에 renderer가 넣은 `preload`가 그대로 들어온다. `delete webPreferences.preload`, `delete params.preload`로 지운다. `params.partition`이 우리 것이 아니면 `preventDefault()`로 guest가 생기지 않는다. sandbox, contextIsolation, nodeIntegration false를 덮어쓸 수 있다.
    - `did-attach-webview(event, guest)`의 guest에 `will-navigate`, `will-redirect`, `will-frame-navigate`, `setWindowOpenHandler`, `before-input-event`, `input-event`가 다 온다.
    - guest의 크기 준 `window.open`은 `disposition: "new-window"`, `features: "width=…,height=…"`로 온다. `createWindow`의 `options.webContents`를 `new WebContentsView`로 감싸 같은 창에 붙이면 `window.opener`가 남는다(지금 popup-host가 하는 그대로).
    - `target=_blank`와 크기 없는 `window.open`은 `disposition: "foreground-tab"`, `features: ""`로 온다.
  - 지금 코드: `browser/registry.ts`(native 항목, `open`, `adopt`, `openPopup`, `navigate`, `command`, `state`), `electron-view.ts`(`hookBrowserContents`, `wrap`), `popup-host.ts`, `browser-ipc.ts`, `wiring/browser.ts`, `desktop/security.ts`(`webPreferences`, 모든 창·view가 같이 쓴다), `desktop/window.ts`(project 창 `windowConfig`), `wiring/app-views.ts`의 창 `setWindowOpenHandler`
  - 계약(lead가 고정): `packages/shell/ipc/browser.ts`(`BrowserEvent`에 `open-tab { opener, url }`가 더해졌다. `BROWSER_OPEN_CHANNEL`·`open`은 이 task와 `bt-webview-ui`가 쓰는 곳을 지운 뒤 lead가 계약에서 지운다)

## 할 일

1. `security.ts`·`window.ts`: project 창(shell renderer) 하나만 `webviewTag: true`다. 다른 창·view(overlay, 앱 view, secret input, browser view, popup)는 지금처럼 `false`다. `WebPreferences` type을 그에 맞게 고친다.
2. `webview-guest.ts`(새로): 창 contents에 거는 `will-attach-webview` 처리.
   - shell 창 본문(`lophn-shell:` desktop 문서)의 main frame에서 온 것만 받는다. 그 밖은 `preventDefault()`.
   - `params.partition`이 `BROWSER_PARTITION`이 아니면 `preventDefault()`.
   - `preload`를 `webPreferences`·`params` 둘 다에서 지우고, `webPreferences`를 `{ ...webPreferences(packaged), devTools: true }`로 덮는다(`webviewTag: false`, sandbox, contextIsolation, nodeIntegration false). `params.disablewebsecurity`·`params.webpreferences`(문자열로 몰래 넣는 설정)를 지운다. popup이 `setWindowOpenHandler`에 닿도록 `params.allowpopups`를 켠다.
   - `params.src`는 `normalizeAddress` → `decideNavigation({ isMainFrame: true })`을 지난 것만 두고, 아니면 `about:blank`로 바꾼다. 첫 load도 규칙을 지난다.
3. `did-attach-webview(event, guest)`: guest를 registry에 `view_session = "wv-" + guest.id`인 항목으로 둔다(창은 그 shell 창. placement 없음, native view 아님). renderer는 `<webview>.getWebContentsId()`로 같은 이름을 만든다. guest에 `hookBrowserContents`와 같은 hook(navigation, activation, Ctrl/Cmd+D, state push, health)을 건다. guest가 부서지면 항목을 지운다.
4. popup(`popup-host.ts`): guest와 native popup 모두 같은 규칙.
   - `decidePopup`이 거절이면 지금과 같다(`popup-blocked`, `external`).
   - 허용이고 `placement.kind === "floated"`(크기 준 popup)이면 지금처럼 `createWindow`로 native popup 항목을 만들고 `popup` event를 보낸다.
   - 허용이고 `docked`(크기 없음)이면 `{ action: "deny" }`를 돌려주고 소유 창에 `open-tab { opener, url }` event를 보낸다.
5. `browser-ipc.ts`·`registry.ts`: `navigate`, `command`, `adopt`, `clear-data`는 `view_session`으로 guest 항목과 native 항목을 모두 다룬다. guest의 `navigate`는 `normalizeAddress`·`decideNavigation`을 지난 뒤 `guest.loadURL`, `command`는 guest의 `navigationHistory`/`reload`/`openDevTools({ mode: "detach" })`다. caller 창이 그 항목의 창이어야 한다. 보통 탭을 native view로 여는 `open` handler와 `registry.open`은 지운다(renderer도 `bt-webview-ui`에서 그 호출을 지운다).
6. `reloadAll`(Clear browsing data 뒤)은 guest 항목도 다시 load한다. guest의 위치·숨김은 renderer CSS가 하므로 `frame-router`의 browser 쪽은 native popup 항목만 받는다.

## 정한 것

- guest의 `view_session`은 main이 따로 만들지 않고 guest contents id에서 정한다(`wv-<id>`). renderer와 main이 같은 이름을 IPC 없이 안다. caller 창 검사가 남의 창 guest를 막는다.
- 크기 없는 popup의 opener는 끊는다. Chrome도 `target=_blank`는 기본이 noopener다. 드물게 크기 없이 `window.open`을 쓰는 로그인은 깨질 수 있다(알려진 미완 동작으로 적는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: `webview-guest.ts`의 attach 결정(받을지, 지울 설정, 고칠 src)을 Electron 없는 순수 함수로 두고 표 test 하나: "shell 창 main frame이 아닌 곳, 다른 partition은 거절, preload·webpreferences·disablewebsecurity는 지워지고, `file:`·`lophn-app:`·`javascript:` src는 `about:blank`로 바뀐다". 인터넷 page의 경계다.
- 남지 않음: `grep -rn "BROWSER_OPEN_CHANNEL\|browserOpenSchema" packages/shell/main`가 0줄이다.
- 가능하면 화면 없는 Electron 실험(`.dev-data/bt-webview-main/`, commit하지 않음)으로 attach 거절과 guest hook을 확인한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `desktop/window.ts`, `desktop/security.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
