# bt-session

browser 탭이 같이 쓰는 persistent session(`persist:lophn-browser`) 설정을 만든다: permission은 기본 거절이고 clipboard write만 허락, UA와 client hints에서 `Electron/x.y.z`와 `lophn/x.y.z`를 빼기, download는 Electron 기본 저장 dialog로 받되 사용자 입력 5000ms 밖에 시작한 것은 거절, Clear browsing data용 지우기 함수.

- 단위: bt-session (wave 1)
- 선행: bt-rules
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/session.ts`
  - `packages/shell/main/browser/electron-session.ts`
  - `packages/shell/main/browser/user-agent.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(session, permission, UA, download)과 4(지우기), "정한 것"
  - 본보기(규칙): `/home/pyosechang/projects/rea/project/desktop-embeded-browser/src/main/session.js`(`configureBrowserSession`, `rewriteClientHints`, `clearBrowsingData`), `session-prefs.js`(`sanitizeUserAgent`)
  - 같은 꼴의 앱 쪽: `packages/shell/main/app-frame/session-policy.ts`(`AppSessionHandle`)와 `electron-app-frame.ts`의 `sessionHandle`. Electron을 가린 interface를 두고 adapter를 따로 둔다.
  - 이 task가 쓰는 규칙: `packages/shell/main/browser/permission.ts`(`decidePermission`), `activation.ts`(`createActivation`)(bt-rules)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: `decidePermission`, `createActivation`의 `fresh`(bt-rules). `packages/shell/main/desktop/paths.ts`의 `browserDataPath`와 `desktop/wiring/desktop.ts`의 `app.setPath("userData", …)`가 persistent partition을 `<dataRoot>/shell/browser` 아래에 둔다(이 task는 고치지 않는다).
  - 내놓는 것(bt-view가 부른다):
    - `session.ts`
      - `BROWSER_PARTITION = "persist:lophn-browser"`
      - `interface BrowserSessionHandle`: Electron session에서 이 모듈이 쓰는 것만 가린 interface(permission 요청·확인 handler, device handler, `will-download` listener, UA 읽기·쓰기, `onBeforeSendHeaders`, 지우기).
      - `installBrowserSession(handle: BrowserSessionHandle, deps: { activation: { fresh(contentsId: number): boolean }; product: string; platform: string }): { clearData(): Promise<void> }`: 같은 handle에 두 번 설치하지 않는다.
    - `electron-session.ts`: `electronBrowserSession(): BrowserSessionHandle`(`session.fromPartition(BROWSER_PARTITION)`).
    - `user-agent.ts`: `sanitizeUserAgent(userAgent: string, product: string): string`, `clientHintHeaders(userAgent: string, platform: string): Record<string, string>`(순수).

## 할 일

1. `user-agent.ts`: rea `sanitizeUserAgent`처럼 UA에서 `Electron/x.y.z`와 `<product>/x.y.z` token을 빼고 공백을 정리한다. `clientHintHeaders`는 UA의 Chromium major를 읽어 `sec-ch-ua`(`"Chromium";v="<major>", "Google Chrome";v="<major>", "Not=A?Brand";v="24"`), `sec-ch-ua-mobile`(`?0`), `sec-ch-ua-platform`(`"macOS"` | `"Windows"` | `"Linux"`)를 낸다. major를 못 읽으면 빈 객체다.
2. `session.ts`의 `installBrowserSession`.
   - permission: 요청 handler와 확인 handler가 모두 `decidePermission`을 부른다(`details.requestingUrl`, `details.isMainFrame`). device permission은 모두 거절한다.
   - download: `will-download`에서 `activation.fresh(그 download를 시작한 webContents id)`가 false이면 `preventDefault()`로 거절한다. true이면 아무것도 하지 않는다. 저장 경로를 정하지 않으면 Electron이 기본 저장 dialog를 띄운다(사용자가 고르기 전에는 아무것도 저장되지 않는다).
   - UA: session UA를 `sanitizeUserAgent(원래 UA, product)`로 바꾸고, `onBeforeSendHeaders`에서 모든 요청의 `User-Agent`를 같은 규칙으로 바꾸며 `clientHintHeaders`로 client hints header를 맞춘다. 헤더 이름 대소문자가 달라도 하나만 남긴다. 이 session은 browser 탭만 쓰므로 `onBeforeSendHeaders`는 여기서 한 번만 단다.
   - `clearData()`: `clearStorageData()`를 인자 없이 부르고(모든 storage 종류를 지운다) `clearCache()`를 부른다.
3. `electron-session.ts`: `BrowserSessionHandle`을 Electron `session.fromPartition(BROWSER_PARTITION)`에 잇는다. `product`는 호출하는 쪽(bt-view의 wiring)이 `app.getName()`으로 넣는다.

## 정한 것

- 지우기는 `clearStorageData()`를 인자 없이 부른다. roadmap과 rea가 적은 storage 이름(`fileSystems`, `indexedDB`, `localStorage`, `webSQL`, `serviceWorkers`)은 Electron 44.5.1의 `ClearStorageDataOptions.storages`(`cookies`, `filesystem`, `indexdb`, `localstorage`, `shadercache`, `serviceworkers`, `cachestorage`)와 이름이 달라서 그대로 쓰면 지워지지 않을 수 있다(`packages/shell/main/node_modules/electron/electron.d.ts`의 `ClearStorageDataOptions`). 인자 없는 호출은 모든 종류를 지운다.
- `webRequest.onBeforeRequest`로 scheme을 막는 guard는 두지 않는다. rea `requests.js`에 있지만, 이 partition에는 `lophn-shell`·`lophn-app` protocol handler가 없어(`protocol.handle`은 앱 partition과 default session에만 걸려 있다) 그 scheme의 요청이 어차피 실패하고, navigation은 `decideNavigation`이 막는다.
- UA header 안의 `Google Chrome` brand를 client hints에 넣는 것은 rea를 따랐다. Google 로그인이 막히는 것을 피하려는 것이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. permission·activation 규칙은 bt-rules의 순수 test가 보고, 이 task는 그 함수를 Electron session에 잇는 일뿐이다(Electron을 띄우는 test는 사람에게 묻기 전에는 만들지 않는다).
- 남지 않음: `grep -rn "fileSystems\|indexedDB\|webSQL" packages/shell/main/browser`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(bt-view의 wiring이 `electronBrowserSession()`을 `installBrowserSession`에 넘긴다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". JS의 `navigator.userAgentData.brands`는 header만 맞춘 이 방식으로 고쳐지지 않는다는 것을 적는다(Electron 이름이 남는지는 확인하지 못했으면 그렇게 적는다).
