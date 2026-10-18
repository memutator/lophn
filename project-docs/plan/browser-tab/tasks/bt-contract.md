# bt-contract

browser 탭의 shell renderer ↔ main 경계를 고정한다: IPC channel과 입력·응답·push의 모양(`ipc/browser.ts`), preload 통로(`preload/browser-api.ts`)와 `window.lophnBrowser` 노출. 구현(main handler, renderer 화면)은 다른 task가 한다. view의 bounds·숨기기·폐기는 이미 있는 `shell:view-bounds`, `shell:views-hidden`, `shell:view-close`(`ipc/app-frame.ts`)를 그대로 쓰므로 여기에 두지 않는다.

- 단위: bt-contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/browser.ts`
  - `packages/shell/preload/browser-api.ts`
  - `packages/shell/preload/shell.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1, 4(지우기, DevTools), 5
  - 본보기(꼴): `packages/shell/ipc/app-frame.ts`(channel 상수, strict zod schema, `ViewReply`)와 `packages/shell/preload/views-api.ts`(`call`, push 구독을 schema로 거르기), `packages/shell/preload/appearance-api.ts`
  - 노출 자리: `packages/shell/preload/shell.ts`의 `role === "shell"` 갈래(`lophnLayout`, `lophnFolders`가 놓인 곳)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/ipc`, `packages/shell/preload`
- 계약:
  - 쓰는 것: `packages/shell/ipc/app-frame.ts`의 `ViewReply`는 쓰지 않는다(`not_found`가 없다). 아래 `BrowserReply`를 새로 둔다.
  - 내놓는 것(다른 task가 이 모양에 기댄다. 이 모양은 이 task만 바꾼다):
    - channel 상수
      - 요청: `BROWSER_OPEN_CHANNEL = "shell:browser-open"`, `BROWSER_ADOPT_CHANNEL = "shell:browser-adopt"`, `BROWSER_NAVIGATE_CHANNEL = "shell:browser-navigate"`, `BROWSER_COMMAND_CHANNEL = "shell:browser-command"`, `BROWSER_CLEAR_DATA_CHANNEL = "shell:browser-clear-data"`, `BOOKMARKS_LIST_CHANNEL = "shell:bookmarks-list"`, `BOOKMARKS_ADD_CHANNEL = "shell:bookmarks-add"`, `BOOKMARKS_UPDATE_CHANNEL = "shell:bookmarks-update"`, `BOOKMARKS_REMOVE_CHANNEL = "shell:bookmarks-remove"`
      - main → renderer push: `BROWSER_STATE_CHANNEL = "shell:browser-state"`, `BROWSER_EVENT_CHANNEL = "shell:browser-event"`, `BOOKMARKS_CHANGED_CHANNEL = "shell:bookmarks-changed"`(payload 없음. 받은 쪽이 다시 읽는다)
    - 입력 schema(모두 strict, 글 길이는 아래)
      - `browserOpenSchema = { url: string(≤8192) }`: 빈 글은 빈 주소 칸으로 연다.
      - `browserAdoptSchema = { view_session }`: popup으로 생긴 view를 이 탭이 가져온다.
      - `browserNavigateSchema = { view_session, input: string(≤8192) }`: 주소 칸에 적은 글 그대로. 정리(`https://` 붙이기)와 거절은 main이 한다.
      - `browserCommandSchema = { view_session, command: "back" | "forward" | "reload" | "inspect" }`
      - `bookmarkAddSchema = { title: string, url: string }`, `bookmarkUpdateSchema = { id: string, title?: string, url?: string }`(둘 중 하나는 있다), `bookmarkRemoveSchema = { id: string }`
      - `view_session`은 `ipc/app-frame.ts`의 `viewSession`과 같은 규칙(1자 이상, 제어 문자 없음)이다.
    - 값
      - `BrowserViewState = { view_session, url: string, title: string, loading: boolean, canGoBack: boolean, canGoForward: boolean, health: "ok" | "unresponsive" | "crashed" }`
      - `BrowserEvent` = `{ kind: "popup"; opener: view_session; view_session; placement: PopupPlacement }` | `{ kind: "popup-blocked"; view_session }` | `{ kind: "close"; view_session }` | `{ kind: "bookmark-key"; view_session }`
        - `PopupPlacement = { kind: "docked" } | { kind: "floated"; width: number; height: number }`(`main/browser/popup.ts`의 type과 같은 모양이다. main이 import하지 않고 이 파일의 type을 쓴다).
        - `popup-blocked`는 사용자 입력 없이 열려던 popup을 거절했다는 알림이다. `close`는 page가 `window.close()`를 불렀다. `bookmark-key`는 page에 focus가 있을 때 Ctrl/Cmd+D가 눌렸다.
      - `Bookmark = { id: string, title: string, url: string, created_at: string }`, `BookmarkList = { state: "ok"; bookmarks: Bookmark[] } | { state: "corrupt" }`
      - `BookmarkReason = "url" | "title" | "duplicate" | "limit" | "corrupt" | "missing" | "unreadable" | "unwritable"`
    - 응답: `BrowserReply<T> = { ok: true; value: T } | { ok: false; error: { code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "unavailable"; message: string } }`. bookmark 요청의 실패는 `message`가 `BookmarkReason` 하나다.
    - `LophnBrowserApi`(preload가 `window.lophnBrowser`로 연다. 거절은 code만 실은 `Error`다)
      - `open(input): Promise<BrowserViewState>`, `adopt(input): Promise<BrowserViewState>`, `navigate(input): Promise<BrowserViewState>`, `command(input): Promise<void>`, `clearData(): Promise<void>`
      - `subscribeState(listener: (state: BrowserViewState) => void): () => void`, `subscribeEvents(listener: (event: BrowserEvent) => void): () => void`
      - `bookmarks: { list(): Promise<BookmarkList>; add(input): Promise<Bookmark>; update(input): Promise<Bookmark>; remove(input): Promise<void>; subscribe(listener: () => void): () => void }`. bookmark 쪽 거절의 `Error.message`는 `BookmarkReason`이고, 나머지 거절은 code다.

## 할 일

1. `ipc/browser.ts`: 위 channel 상수, strict schema(`zod`), type, `BrowserReply`, `LophnBrowserApi`를 쓴다. 이 file은 main·preload·renderer가 함께 부르므로 import는 `zod`와 type뿐이다. 글 길이: `url`·`input` 8192자, `title` 200자(`BrowserViewState.title`은 1024자까지 받아 자른다), `Bookmark.id` 128자.
2. `preload/browser-api.ts`: `createBrowserApi(transport)`. `views-api.ts`의 `call`과 같은 규칙으로 invoke 실패를 `unavailable`로 바꾸고, 응답 `ok: false`는 위 규칙대로 거절한다. push(`BROWSER_STATE_CHANNEL`, `BROWSER_EVENT_CHANNEL`, `BOOKMARKS_CHANGED_CHANNEL`)는 schema로 거른 것만 listener에 넘긴다. transport는 closure 안에 둔다.
3. `preload/shell.ts`: `role === "shell"` 갈래에 `contextBridge.exposeInMainWorld("lophnBrowser", createBrowserApi(ipcRenderer))`를 더한다. overlay에는 열지 않는다.
4. 구현 task가 없는 channel은 handler가 없어 `unavailable`로 거절된다. 그 사이 renderer가 망가지지 않게 `createBrowserApi`는 어떤 invoke 실패에도 던지지 않고 거절만 한다.

## 정한 것

- popup 알림(`popup-blocked`)과 `close`, `bookmark-key`를 state와 따로 `BrowserEvent` 하나로 묶었다. 사건이라 "지금 값"인 state와 섞지 않으려는 것이다.
- `placement`를 wave 2부터 event에 싣는다. wave 2의 renderer는 floated도 docked로 열고, wave 3(`bt-popup-float`)이 floated로 연다. 그때 이 contract를 바꾸지 않으려는 것이다.
- bookmark 목록이 깨졌다는 것은 오류가 아니라 `BookmarkList`의 `corrupt` 상태다. 화면이 목록 자리에 오류를 보여야 하기 때문이다. 쓰기만 `corrupt`로 거절된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 입력 검사는 zod schema가 한다(write-test: schema가 보장하는 것은 test하지 않는다).
- 남지 않음: 없음(새 file만 더하고 `preload/shell.ts`에 한 갈래만 더한다).

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
