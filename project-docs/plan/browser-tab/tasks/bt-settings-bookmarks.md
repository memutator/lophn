# bt-settings-bookmarks

Settings의 Browser pane에 bookmark 목록을 더한다. 줄마다 title, URL, [Edit], [Remove]가 있고, 파일이 깨져 있으면 목록 자리에 오류를 보인다.

- 단위: bt-settings (wave 2)
- 선행: bt-settings-clear, bt-bookmark-ipc
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/browser/source.ts`
  - `packages/shell/renderer/desktop/settings/browser/window-source.ts`
  - `packages/shell/renderer/desktop/settings/browser/browser-panel.tsx`
  - `packages/shell/renderer/desktop/settings/browser/bookmark-rows.tsx`
  - `packages/shell/renderer/desktop/settings/browser/testdata/fake-source.ts`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 5(고치기, 저장)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 본보기(목록과 줄 편집): `packages/shell/renderer/desktop/settings/agents/`의 목록 행, `packages/shell/renderer/workspace/sidebar/explorer-row.tsx`(제자리 이름 편집)
  - 이 task가 쓰는 것: bt-contract(`window.lophnBrowser.bookmarks`, `BookmarkList`, `BookmarkReason`), bt-settings-clear(pane과 source)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `LophnBrowserApi.bookmarks`의 `list`, `update`, `remove`, `subscribe`.
  - 내놓는 것: `BrowserSettingsSource`에 `bookmarks(): Promise<SourceResult<BookmarkList>>`, `updateBookmark(input): Promise<SourceResult<null>>`, `removeBookmark(id): Promise<SourceResult<null>>`, `watchBookmarks(listener): () => void`. 실패한 `SourceResult`의 `code`는 `BookmarkReason`이다.

## 할 일

1. `source.ts`, `window-source.ts`, `testdata/fake-source.ts`: 위 메서드를 더한다. fake는 메모리 목록, `corrupt` 상태, 쓰기 실패 reason을 고를 수 있다. 다른 창에서 바뀌면(`BOOKMARKS_CHANGED`) 다시 읽는다(`watchBookmarks`).
2. `bookmark-rows.tsx`와 `browser-panel.tsx`: "Bookmarks" 구역. 더한 순서대로 줄마다 title, URL, 오른쪽 끝 고정 열의 [Edit]과 [Remove]. [Edit]은 그 줄이 title·URL 입력으로 바뀌고 [Save]·[Cancel]이 오른쪽에 있다. 저장이 거절되면(`url`, `title`, `duplicate`) 그 줄 아래에 이유를 말하는 문장을 보인다. [Remove]는 확인 없이 지운다. 목록이 비면 빈 상태 글. `corrupt`이면 목록 대신 오류 문장("The bookmarks file is damaged, so bookmarks can't be changed until it is fixed.")만 보이고 [Edit]·[Remove]는 없다.
3. wording: `catalog/browser.ts`에 key를 더한다(구역 제목, 단추, 입력 label, 거절 이유 셋, 빈 상태, corrupt 오류). `deno task wording`.

## 정한 것

- Remove는 확인 dialog를 두지 않는다. 같은 pane의 목록은 한 줄 지우기이고 page에서 다시 별을 누르면 되돌릴 수 있다.
- 줄에서 favicon은 두지 않고 icon은 `Globe`다(roadmap).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면이다. 저장 규칙은 `bt-bookmark-store`의 test가 본다).
- 남지 않음: 없음.
- `deno task dev:mock`에서 Settings › Browser의 목록이 보이고 고치기·지우기가 동작한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`을 돌렸다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
