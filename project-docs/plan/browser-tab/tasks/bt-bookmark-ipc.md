# bt-bookmark-ipc

bookmark store를 main에서 IPC로 연다. renderer가 목록을 읽고 더하고 고치고 지우며, 바뀌면 열린 모든 shell 창에 알린다(창이 여럿이어도 저장하는 곳이 main 하나다).

- 단위: bt-bookmark (wave 2)
- 선행: bt-bookmark-store, bt-view
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/bookmark-ipc.ts`
  - `packages/shell/main/desktop/wiring/bookmarks.ts`
  - `packages/shell/main/desktop/main.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 5(저장: "main이 갖고, renderer는 IPC로 읽고 바꾼다")
  - 본보기: `packages/shell/main/app-frame/view-ipc.ts`(caller 검사와 channel 등록·제거), `packages/shell/main/desktop/wiring/layout.ts`(store를 wiring에서 만든다), `wiring/context.ts`(`ctx.windows`, `ctx.ipc`, `ctx.dataRoot`)
  - 이 task가 쓰는 것: bt-contract(`BOOKMARKS_*_CHANNEL`, schema, `BrowserReply`), bt-bookmark-store(`createBookmarkStore`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: `ipc/browser.ts`의 channel·schema, `createBookmarkStore`.
  - 내놓는 것: 네 요청 channel이 `BrowserReply`로 답한다. 성공한 쓰기 뒤에 `ctx.windows`의 살아 있는 창마다 `BOOKMARKS_CHANGED_CHANNEL`(payload 없음)을 보낸다. 실패의 `error.message`는 `BookmarkReason` 하나다.

## 할 일

1. `bookmark-ipc.ts`: `createBookmarkIpc({ registry, store, notify })`와 `register`/`remove` 함수. 요청마다 caller가 desktop 창 본문인지(`checkCaller`)와 입력 schema(`checkInput`)를 먼저 본다. `reason`을 error code로 바꾼다: `url`·`title`·`limit` → `invalid_input`, `duplicate` → `conflict`, `missing` → `not_found`, `corrupt`·`unreadable`·`unwritable` → `unavailable`. `list`는 `BookmarkList` 값을 그대로 낸다(`corrupt`도 성공 응답이다).
2. `wiring/bookmarks.ts`: `createBookmarkStore(ctx.dataRoot, { ids: { bookmark: () => `bkm-${randomUUID()}` }, clock: { nowIso: () => new Date().toISOString() } })`. `notify`는 `ctx.windows`에서 `isDestroyed()`가 아닌 창마다 `webContents.send`. 등록하고 `stop()`에서 제거한다.
3. `desktop/main.ts`: `wiring/bookmarks.ts`를 `add(...)`로 등록한다(`wiring/layout.ts` 옆).

## 정한 것

- 바뀌었다는 알림에 내용을 싣지 않는다. 받은 쪽이 `list`로 다시 읽는다. 내용이 드는 알림은 창마다 목록이 어긋날 길을 늘린다.
- 쓰기를 보낸 창에도 알린다(그 창도 같은 길로 다시 읽는다. 별 단추와 목록이 한 길로 갱신된다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 저장 규칙은 `bt-bookmark-store`가 본다. 이 task는 그 함수를 IPC에 잇는 일이다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `desktop/main.ts`(영역 하나 등록)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
