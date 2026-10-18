# bt-view

browser 탭의 native view를 main에 세운다. `WebContentsView` 하나를 persistent partition으로 만들고(preload 없음), navigation 규칙을 걸고, 위치·숨김은 `main/app-frame/`의 placement와 visibility로 하고, 뒤로·앞으로·새로 고침·Inspect·주소 이동과 state push, Clear browsing data의 main 쪽을 IPC로 연다. popup(`window.open`)은 이 task에서 모두 거절하고 `bt-popup-host`가 연다.

- 단위: bt-view (wave 2)
- 선행: bt-rules, bt-session, bt-contract
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/registry.ts`
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/browser/frame-router.ts`
  - `packages/shell/main/browser/browser-ipc.ts`
  - `packages/shell/main/desktop/wiring/browser.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/shell/main/desktop/main.ts`
  - `packages/shell/main/app-frame/placement.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(view, navigation, session)과 4(DevTools), "정한 것"
  - architecture: `project-docs/architecture/annotation.md`(app view identity. browser view는 app registry에 넣지 않는다)
  - 본보기(view 길): `packages/shell/main/app-frame/electron-app-frame.ts`(`WebContentsView` 만들기, `attach`·`detach`, navigation guard, crash 신호), `placement.ts`(`createPlacement`, `Placed`), `visibility.ts`(`createViewVisibility`가 받는 `frame`), `crash.ts`(`nextHealth`, `reopenable`), `view-ipc.ts`(caller 검사와 channel 등록 꼴), `view-order.ts`
  - 본보기(wiring): `packages/shell/main/desktop/wiring/app-views.ts`(`electronAppViews`, `createViewVisibility`, `windowOfRef`), `wiring/appearance.ts`(renderer → main IPC), `desktop/security.ts`의 `webPreferences`, `desktop/headless.ts`의 `surfaceOptions`
  - 본보기(규칙): `/home/pyosechang/projects/rea/project/desktop-embeded-browser/src/main/tabs.js`(`wireTab`)
  - 이 task가 쓰는 것: bt-rules(`decideNavigation`, `createActivation`, `normalizeAddress`), bt-session(`installBrowserSession`, `electronBrowserSession`, `BROWSER_PARTITION`), bt-contract(`ipc/browser.ts`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: `ipc/browser.ts`의 channel·schema·`BrowserViewState`·`BrowserReply`, 이미 있는 `shell:view-bounds`·`shell:views-hidden`·`shell:view-close`(`ipc/app-frame.ts`, `view-ipc.ts`가 처리한다. bounds·숨기기·폐기는 이 길을 그대로 쓴다).
  - 내놓는 것:
    - `registry.ts`의 `createBrowserViews(deps)`가 돌려주는 값(bt-popup-host와 wiring이 쓴다):
      - `open(window, url): Promise<Outcome<BrowserViewState>>`, `navigate(window, view_session, input)`, `command(window, view_session, command)`
      - visibility 길: `has(view_session)`, `owner(view_session)`, `setBounds(view_session, bounds)`, `hide(view_session)`, `close(view_session)`
      - `reloadAll()`(Clear browsing data 뒤 열린 page를 다시 load한다), `closeWindow(window)`, `dispose()`
      - `Outcome`·`ViewBounds`는 `main/app-frame/app-connection.ts`·`view-model.ts`의 것을 쓴다.
    - `frame-router.ts`의 `routeFrame(appFrame, browser)`: `createViewVisibility({ frame })`가 받는 `frame`을 돌려준다. `setBounds`·`hide`·`close`·`owner`는 browser view의 `view_session`이면 browser로, 아니면 앱 registry로 보낸다.
    - `electron-view.ts`: contents에 navigation·activation·키 hook을 거는 함수를 따로 낸다(`bt-popup-host`가 popup으로 생긴 contents에도 같은 hook을 건다).
    - `wiring/browser.ts`의 `register(ctx)`: `Registered`와 `{ views, frame }`을 돌려준다.

## 할 일

1. `main/app-frame/placement.ts`: `createPlacement`의 `deps.views` 타입을 `AppViewHost` 전체에서 쓰는 다섯 개(`hasWindow`, `attach`, `detach`, `focused`, `focusShell`)만 고른 `Pick`으로 좁힌다. 동작은 바꾸지 않는다(넘길 줄).
2. `electron-view.ts`: `WebContentsView`를 만든다. `webPreferences`는 `{ ...webPreferences(packaged), partition: BROWSER_PARTITION, devTools: true }`이고 preload는 없다(browser view만 packaged에서도 `devTools: true`다). `surfaceOptions`로 headless를 거른다. `attach`·`detach`·`focused`·`focusShell`은 `electron-app-frame.ts`와 같은 규칙으로 쓰되 app view의 `native` map과 따로 가진다. 붙인 뒤 `raise(window)`로 overlay를 다시 위로 올린다.
3. contents에 거는 hook(popup 때 다시 쓰도록 함수 하나로 묶는다).
   - `will-navigate`, `will-redirect`, `will-frame-navigate`: `decideNavigation`이 거절하면 `preventDefault()`. main frame의 거절이 `external`이고 그 contents의 `activation.fresh`이면 `openExternal(url)`로 OS에 넘긴다(입력 없이 `mailto:`로 OS 앱을 열지 못하게 한다). 그 밖의 거절은 조용히 둔다.
   - `will-attach-webview`는 `preventDefault()`. `setWindowOpenHandler(() => ({ action: "deny" }))`가 기본이다(popup은 `bt-popup-host`가 바꾼다).
   - 입력 활동: `input-event`의 `mouseDown`과 키 입력(`keyDown`/`rawKeyDown`, 자동 반복 제외)에서 `activation.mark(contents.id)`. Electron 44.5.1의 `before-input-event`는 keyboard 입력만 주므로(`electron.d.ts`의 `Input.type`) rea처럼 `before-input-event`로 mouseDown을 듣지 않는다. 실제로 어떤 type이 오는지 한 번 확인한다.
   - `before-input-event`: Ctrl(macOS는 Cmd)+D만 눌렸고 다른 modifier가 없으면 `preventDefault()`하고 소유 창에 `BrowserEvent { kind: "bookmark-key" }`를 `BROWSER_EVENT_CHANNEL`로 보낸다. 쓰는 곳은 `bt-bookmark-ui`다.
   - 상태 push: `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `did-start-loading`, `did-stop-loading`, `did-fail-load`(취소 `-3`은 무시)에서 `BrowserViewState`를 `BROWSER_STATE_CHANNEL`로 그 창의 `webContents.send`로 보낸다. `render-process-gone`은 `nextHealth`로 `health`를 `crashed`로 바꿔 보낸다. `unresponsive`·`responsive`도 같다.
4. `registry.ts`: `createBrowserViews`. 항목 하나는 `view_session`(`browser-<uuid>`), 창, contents, `Placed` 필드(`createPlacement`가 요구하는 `window`, `bounds`, `contents`, `generation`, `shown`, `ready`, `placed`, `attached`)를 가진다.
   - `open(window, url)`: 창이 없으면 `invalid_input`. 항목을 만들고 `placement.mounted`를 부른다. `url`이 비어 있지 않으면 `normalizeAddress` → `decideNavigation`이 허용할 때만 `loadURL`하고, 첫 load가 끝나면(실패 포함) `placement.loaded`를 부른다. 거절되거나 비어 있으면 load하지 않고 빈 상태로 둔다. 이때 첫 `navigate`가 첫 load이므로 그 load가 끝난 뒤 `placement.loaded`를 부른다. bounds는 renderer가 `shell:view-bounds`로 보낸다(주소가 있을 때만 보낸다).
   - `navigate`: `normalizeAddress`(null이면 `invalid_input`) → `decideNavigation`(거절이면 `invalid_input`, `external`이면 `activation.fresh`일 때 OS로 넘기고 현재 page는 그대로) → `loadURL`.
   - `command`: `back`·`forward`·`reload`는 `contents.navigationHistory`/`reload`. `crashed`인 항목의 `reload`는 contents를 부수고 같은 `view_session`으로 새 contents를 만들어 마지막 주소를 다시 연다(`reopenable`). `inspect`는 `openDevTools({ mode: "detach" })`.
   - `setBounds`/`hide`/`close`: `placement.setBounds`/`placement.hide`와 contents 폐기. `close`는 `has`가 아니면 아무것도 하지 않는다.
   - `closeWindow(window)`는 그 창의 항목을 모두 폐기한다.
5. `frame-router.ts`: `routeFrame`.
6. `browser-ipc.ts`: `BROWSER_OPEN_CHANNEL`, `BROWSER_NAVIGATE_CHANNEL`, `BROWSER_COMMAND_CHANNEL`, `BROWSER_CLEAR_DATA_CHANNEL`의 handler. `view-ipc.ts`의 `guard`처럼 caller가 desktop 창 본문인지, 입력이 schema에 맞는지 먼저 본다(`checkCaller`, `checkInput`). 응답은 `BrowserReply`다. `BROWSER_CLEAR_DATA_CHANNEL`은 `installBrowserSession`이 돌려준 `clearData()`를 부른 뒤 `reloadAll()`을 부른다. `BROWSER_ADOPT_CHANNEL`은 `bt-popup-host`가 더한다.
7. `wiring/browser.ts`: `installBrowserSession(electronBrowserSession(), { activation, product: app.getName(), platform: process.platform })`를 한 번 부르고, `createActivation({ nowMs: () => Date.now() })`, `createBrowserViews`, IPC 등록, `ctx.windowHooks.closed`에 `closeWindow`를 단다. id는 `browser-${randomUUID()}`로 이 wiring에서 만든다. OS로 넘기기는 `shell.openExternal`이고 headless면 아무것도 하지 않는다(`wiring/app-views.ts`의 `externalLinks`와 같다).
8. `wiring/app-views.ts`: `register(ctx, browser)`로 `browser.frame`을 받아 `createViewVisibility({ frame: routeFrame(appFrame, browser.frame), … })`로 바꾼다. `desktop/main.ts`: `wiring/browser.ts`를 `appViews`보다 먼저 `add(...)`하고 그 값을 `appViews.register`에 넘긴다(넘길 줄).

## 정한 것

- browser view는 앱 view registry(`registry.ts`의 `createAppFrame`)에 넣지 않는다. 그 registry는 앱 연결(`connector`·binding·release)에 묶여 있다. 위치·숨김만 `createPlacement`와 `createViewVisibility`를 불러 쓰고, 그래서 `frame-router`가 둘을 `view_session`으로 가른다. `app-frame/`에서 고치는 것은 `placement.ts`의 타입 한 줄뿐이다.
- 빈 주소 칸으로 연 탭은 native view를 보이지 않는다(bounds를 받지 않는다). 그 자리에는 renderer가 DOM으로 새 탭 화면을 그린다(`bt-bookmark-ui`).
- 새 URL이 `normalizeAddress`에서 null이거나 `decideNavigation`에서 거절되면 오류 화면 없이 `invalid_input`으로 답한다. 주소 칸이 현재 주소로 돌아간다(renderer 몫).
- Clear browsing data 뒤 `reloadAll()`은 빈 주소 칸과 crash한 항목은 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 규칙은 bt-rules가 보고 이 task는 규칙을 Electron에 잇는 일이다. 새 test는 만들지 않는다(Electron을 띄우는 test는 사람에게 묻기 전에는 만들지 않는다).
- 남지 않음: `grep -n "AppViewHost" packages/shell/main/app-frame/placement.ts`에서 `deps.views`가 `Pick`으로 좁혀져 있다. 그 밖의 `app-frame/` file은 안 바뀌었다(`git diff --stat`).
- 가능하면 `deno task dev`(fake model server)나 headless로 손으로 확인한다: `https://example.com`을 열 수 있고, `file:///etc/passwd`와 `lophn-app://…`로 가는 navigation이 막히고, 뒤로·앞으로·새로 고침·Inspect가 동작한다. 확인하지 못한 것은 알려진 미완 동작에 적는다. 실제 model provider는 부르지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `main/app-frame/placement.ts`, `wiring/app-views.ts`, `desktop/main.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 아래는 이 task에서 고치지 않는다(이 계획은 `listenShortcuts`를 넓히지 않는다). 확인했으면 한 항목으로 적는다: "`main/desktop/shortcuts.ts`의 `listenShortcuts`는 native view(앱 view, browser view)에 focus가 있을 때 palette·launcher·macOS Cmd+W만 shell renderer로 보낸다. 그래서 page에 focus가 있으면 작업대 단축키(`tab.close`의 Linux·Windows Ctrl+W, `tab.next`의 Ctrl+Tab 등 `ipc/keybindings.ts`의 renderer 몫)가 renderer에 가지 않는다. app panel과 browser 탭이 같다." lead가 이 한 건을 app panel과 browser view를 함께 다루는 issue 하나로 올린다.
