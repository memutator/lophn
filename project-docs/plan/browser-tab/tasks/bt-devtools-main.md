# bt-devtools-main

browser 탭의 DevTools를 page 옆(탭 안), floated 패널, 따로 뜬 OS 창 중 한 곳에 띄우는 main 쪽을 만든다. 사람이 Chrome처럼 DevTools가 page 옆에 붙어 뜨고 거기서 floating·분리를 고르기를 바랐다(2026-10-19). 지금은 `openDevTools({ mode: "detach" })`라 늘 따로 뜬다.

- 단위: bt-devtools (wave 3)
- 선행: bt-favicon-main
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/devtools.ts`(새로)
  - `packages/shell/main/browser/registry.ts`
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/browser/browser-ipc.ts`
  - `packages/shell/main/browser/frame-router.ts`
  - `packages/shell/main/desktop/wiring/browser.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/browser-tab.md`, `project-docs/architecture/workspace-layout.md`(native view 층)
  - 계약(lead가 고정): `packages/shell/ipc/browser.ts`의 `BROWSER_DEVTOOLS_OPEN_CHANNEL`·`CLOSE`·`WINDOW`, `browserDevtools*Schema`, `BrowserEvent`의 `devtools-closed`, `LophnBrowserApi.devtools`. 위치·숨김은 지금처럼 `shell:view-bounds`(`frame-router`)다.
  - lead 실험 결과(Electron 44.5.1, `.dev-data/probe-devtools/` in the lead worktree):
    - `<webview>`는 DevTools를 담지 못한다(frontend가 load되지만 page에 붙지 않는다).
    - 한 번도 load하지 않은 새 `WebContentsView`에 `target.setDevToolsWebContents(view.webContents)` 뒤 `target.openDevTools()`하면 붙는다.
    - 붙은 view는 `setBounds`, 다른 `BrowserWindow`로 `removeChildView`/`addChildView`해도 끊기지 않는다(다시 load 없음).
    - `closeDevTools()` 뒤 같은 view나 새 view로 다시 열면 붙지 않는다. 옛 view를 `webContents.close()`로 부순 뒤에야 새 view로 다시 열 수 있다.
    - 이 방식에서는 `isDevToolsOpened()`가 늘 false이고 `devToolsWebContents`가 null이다. 열린 상태는 main이 직접 든다.
    - `devtools://` load에는 `will-navigate`류가 오지 않는다. `persist:lophn-browser` partition의 view여도 된다.
  - 지금 코드: `registry.ts`(guest 항목 `wv-<id>`, native 항목, `command`의 `inspect`), `electron-view.ts`(native view 만들기), `frame-router.ts`, `wiring/browser.ts`

## 할 일

1. `devtools.ts`·`registry.ts`: `devtools.open(window, view_session)`. 그 page(guest 또는 native popup)에 이미 DevTools가 있으면 `conflict`. 새 `WebContentsView`를 만들어 `setDevToolsWebContents` 뒤 `openDevTools()`, native 항목(`devtools-<page contents id>`)으로 등록하고 `{ devtools_session }`을 답한다. bounds는 renderer가 `shell:view-bounds`로 보내고 층 순서는 `appViewOrder`다. preload 없음, hardened `webPreferences`.
2. `close(devtools_session)`: view의 `webContents.close()`로 부수고 항목을 지운다(다음 열기가 새 view로 되게). page가 부서지거나 view가 죽으면 같이 정리하고 소유 창에 `devtools-closed { view_session, devtools_session }`를 보낸다.
3. `window(devtools_session, true)`: 그 view를 project 창에서 떼어 새 `BrowserWindow`(제목 "DevTools – <page title>", 보통 frame, hardened)에 `addChildView`하고 창 크기에 맞춘다. `false`면 그 창에서 떼어 project 창으로 되돌린다(bounds는 renderer가 다시 보낸다). 사람이 그 창을 닫으면 DevTools를 닫고 `devtools-closed`를 보낸다.
4. `browser-ipc.ts`: 세 channel handler(caller 창 검사, schema 검사). `frame-router`의 browser 쪽이 DevTools 항목도 받게 한다(`has`, `owner`, `setBounds`, `hide`, `close`).
5. `command`의 `inspect`는 지금처럼 detach 창으로 두지 않고 지운다(renderer가 `devtools.open`을 쓴다. 계약의 enum은 `bt-devtools-ui`가 쓰는 곳을 지운 뒤 lead가 지운다).

## 정한 것

- DevTools 자리는 native view다. 실험에서 `<webview>`가 DevTools를 담지 못했다. 그 위에 겹치는 DOM은 밑에 깔리지만 toolbar menu는 overlay라 위에 뜬다.
- 자리를 바꿀 때 DevTools를 다시 열지 않고 view를 옮긴다(실험 4e). DevTools 안에서 고른 panel이 남는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(Electron 연결이다). 
- 남지 않음: `grep -rn "\"inspect\"" packages/shell/main/browser`가 0줄이다.
- 가능하면 화면 없는 Electron 실험(`.dev-data/bt-devtools-main/`, commit하지 않음)으로 열기·창 옮기기·닫고 다시 열기를 확인한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
