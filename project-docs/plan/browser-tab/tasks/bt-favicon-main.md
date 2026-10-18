# bt-favicon-main

browser page의 favicon을 main이 받아 data URL로 바꿔 `BrowserViewState.favicon`에 싣고, bookmark에 favicon을 저장한다. 사람이 Chrome처럼 탭과 bookmark에 favicon을 보고 싶다고 했다(2026-10-18, roadmap의 "favicon 하지 않는다"를 뒤집음). shell 화면의 CSP는 `img-src 'self' data: blob:`이라 page의 favicon 주소를 화면에 그대로 줄 수 없고, shell 화면이 인터넷에 직접 요청하게 하지도 않는다.

- 단위: bt-favicon (wave 3)
- 선행: bt-view-layers, bt-webview-main
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/browser/registry.ts`
  - `packages/shell/main/browser/favicon.ts`(새로)
  - `packages/shell/main/browser/bookmarks.ts`
  - `packages/shell/main/browser/bookmark-ipc.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/browser-tab.md`
  - 계약(lead가 고정했다): `packages/shell/ipc/browser.ts`의 `favicon`(`data:image/`로 시작, 65536자까지), `BrowserViewState.favicon?`, `Bookmark.favicon?`, `bookmarkAddSchema.favicon?`
  - 지금 코드: `electron-view.ts`의 `hookBrowserContents`·`wrap`(page 상태와 hook), `registry.ts`의 `state()`·`BrowserPage`, `bookmarks.ts`(`fileSchema`, `add`), `bookmark-ipc.ts`
  - Electron 44.5.1: `WebContents`의 `page-favicon-updated`(`favicons: string[]`), `Session.fetch`(`packages/shell/main/node_modules/electron/electron.d.ts`)

## 할 일

1. `favicon.ts`: favicon 주소 하나를 data URL로 바꾸는 함수. 입력은 주소와 `fetch`(browser session의 `session.fetch`, test 없이 인자로 받는다). `data:image/…`면 길이만 보고 그대로, http/https면 받아서 `content-type`이 `image/`로 시작하고 body가 48KB 이하일 때만 `data:<type>;base64,…`. 그 밖(다른 scheme, 실패, 너무 큼, image 아님)은 null. 결과가 65536자를 넘으면 null.
2. `electron-view.ts`/`registry.ts`: `page-favicon-updated`의 첫 주소를 위 함수로 바꿔 그 view의 favicon으로 두고 state를 민다. main frame이 다른 origin으로 navigate하면(`did-navigate`) favicon을 비운다(새 page가 다시 알린다). 늦게 끝난 fetch가 그 사이 바뀐 page의 것이면 버린다. popup으로 생긴 contents도 같은 hook을 지난다.
3. `bookmarks.ts`: 파일 schema에 `favicon`(선택, 같은 규칙)을 더하고 `add`가 받은 favicon을 저장한다. `favicon` 칸이 없는 지금 파일도 그대로 읽힌다(선택 칸이라 version을 바꾸지 않는다). 규칙에 맞지 않는 favicon은 저장하지 않고 bookmark만 더한다. `bookmark-ipc.ts`는 schema를 지난 입력을 그대로 store에 넘긴다.
4. `bookmarks_test.ts`의 위험 test(깨진 파일을 덮어쓰지 않는다)가 그대로 통과한다.

## 정한 것

- favicon은 그 page를 연 browser session으로 받는다(같은 cookie). 별도 session이나 shell 화면에서 받지 않는다.
- 크기 상한은 받은 byte 48KB, data URL 65536자다. favicon은 보통 수 KB다.
- bookmark favicon은 더할 때 한 번 저장하고 갱신하지 않는다(사람이 별을 다시 누르면 지우고 더한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 기존 `bookmarks_test.ts`가 통과한다. favicon 변환은 화면 경계가 아니라 크기와 type만 거르는 일이라 test하지 않는다.
- 남지 않음: 없음.

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

## lead가 더함

- 보통 탭은 이제 `<webview>` guest다(`bt-webview-main`). guest contents에도 native popup과 같은 hook이 걸리므로 favicon hook도 그 한 곳에 둔다. favicon 받기는 `guest.session.fetch`(같은 `persist:lophn-browser`)다.
