# bt-bookmark-ui

browser 탭 안에서 bookmark를 더하고 연다: 주소 칸 끝의 별 단추(채움/빔)와 popover(title 고치기, [Remove]), 단축키 Ctrl/Cmd+D, toolbar의 bookmark menu, 빈 주소 칸으로 연 새 탭에 보이는 bookmark 목록, 명령 팔레트(Ctrl+K)의 bookmark 묶음(고르면 새 browser 탭에서 연다).

- 단위: bt-bookmark (wave 2)
- 선행: bt-popup-tab, bt-bookmark-ipc
- 소유(이 task만 고친다):
  - `packages/shell/renderer/browser/bookmarks.ts`
  - `packages/shell/renderer/browser/bookmark-star.tsx`
  - `packages/shell/renderer/browser/bookmark-menu.tsx`
  - `packages/shell/renderer/browser/new-tab-page.tsx`
  - `packages/shell/renderer/browser/bookmark.module.css`
  - `packages/shell/renderer/browser/browser-toolbar.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/testdata/fake-browser-api.ts`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/icons/browser.ts`
  - `packages/shell/renderer/desktop/palette/model.ts`
  - `packages/shell/renderer/desktop/palette/labels.ts`
  - `packages/shell/renderer/desktop/palette/workspace-scope.ts`
  - `packages/shell/ipc/overlay.ts`
  - `packages/shell/renderer/icons/palette.ts`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 5(더하기, 열기)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 본보기(overlay 부품): `packages/design/components/overlay/popover/popover.tsx`, `menu/menu.tsx`(`Menu`의 `onSelect(id)`는 id만 준다), `packages/shell/renderer/overlay/surfaces/surface.tsx`(overlay로 가는 popover·menu가 shell에 돌려주는 결과는 `choiceId`뿐이다)
  - 본보기(팔레트): `packages/shell/renderer/desktop/palette/workspace-scope.ts`(`workspaceScope`의 묶음과 `go`), `model.ts`(`PaletteGroup`, `WORKSPACE_GROUPS`, `arrange`), `labels.ts`(`groupLabel`), `workspace/contexts/context-palette-group.ts`, `ipc/overlay.ts`의 `PALETTE_ICONS`, `renderer/overlay/surfaces/surface.tsx`의 `PALETTE_ICONS: Record<PaletteIcon, …> = paletteIcons`
  - 본보기(탭 안 DOM): `packages/shell/renderer/workspace/app-panel-tab.tsx`의 `AppPanelPicker`(목록 화면)
  - 이 task가 쓰는 것: bt-contract(`LophnBrowserApi.bookmarks`, `BrowserEvent`의 `bookmark-key`), bt-tab-page(`BrowserTab`, `BrowserToolbar`), bt-tab-kind(`openBrowserTab`), bt-popup-tab(`BrowserTab`의 props)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `window.lophnBrowser.bookmarks`(`list`, `add`, `update`, `remove`, `subscribe`).
  - 내놓는 것(이후 task가 쓴다): `bookmarks.ts`의 `useBookmarks(): { state: "loading" | "ok" | "corrupt" | "unavailable"; bookmarks: readonly Bookmark[]; add(input): Promise<…>; update(input): Promise<…>; remove(id): Promise<…> }`(다른 창이 바꾸면 `subscribe`로 다시 읽는다), `BrowserTab`의 새 prop `onOpenInNewTab(url: string): void`.

## 할 일

1. `bookmarks.ts`: `useBookmarks()`. `useBrowserApi()`가 null이면 `state: "unavailable"`이다. 조회 중에는 `loading`. 읽기 실패(throw)는 `unavailable`, `{ state: "corrupt" }`는 `corrupt`.
2. `bookmark-star.tsx`: 주소 칸 끝의 별 `IconButton`. 지금 url(정규화한 `href`)이 목록에 있으면 채운 별, 없으면 빈 별이다. 빈 별을 누르면 지금 page의 title(없으면 url의 host)과 url로 `add`한다. 채운 별을 누르면 `Popover`가 열려 title을 고치고(Enter나 focus를 잃을 때 `update`) [Remove]를 누를 수 있다. url이 비었거나 `corrupt`/`unavailable`이면 비활성이다. 거절(`duplicate`, `limit`, `url`, `title`)은 별 근처 `Toast`나 popover 안 문장 중 `ui-design` 규칙에 맞는 쪽으로 알린다.
3. 단축키 Ctrl/Cmd+D: 별 단추를 누른 것과 같은 동작(없으면 더하고, 있으면 popover를 연다)이다. 두 길로 받는다. (a) page에 focus가 있으면 main이 보낸 `BrowserEvent { kind: "bookmark-key", view_session }`(`BrowserTab`이 자기 view_session의 것만 `BrowserToolbar`로 넘긴다). (b) 주소 칸 등 toolbar에 focus가 있으면 toolbar 안 `onKeyDown`(macOS는 `metaKey`, 그 밖은 `ctrlKey`, 글쇠 `d`, 다른 modifier 없음). 둘 다 `preventDefault()`한다. 작업대 단축키 표(`ipc/keybindings.ts`)에는 넣지 않는다(terminal의 Ctrl+D EOF와 부딪힌다).
4. `bookmark-menu.tsx`: toolbar의 bookmark 단추(`Menu`의 trigger `IconButton`). 항목은 목록 순서대로 title(`textValue` 포함)이고, 고르면 지금 탭에서 그 url로 `browser.navigate`한다. 비어 있으면 비활성 항목 하나("No bookmarks yet."), `corrupt`이면 오류 문장 하나.
5. `new-tab-page.tsx`: `BrowserTab`의 page region에서 `state.url === ""`일 때 native view 대신 그리는 DOM 목록. 줄마다 title과 host. 누르면 지금 탭에서 열고(`navigate`), Ctrl/Cmd-click이나 가운데 click은 `onOpenInNewTab(url)`이다. 비면 빈 상태 글, `corrupt`이면 오류 문장. 새 탭은 주소 칸에 focus가 있어서 사람이 바로 칠 수도 있다.
6. `browser-toolbar.tsx`, `browser-tab.tsx`에 위를 꽂는다. `kinds/browser.tsx`는 `onOpenInNewTab={(url) => openBrowserTab(host, url)}`를 `BrowserTab`에 준다.
7. `testdata/fake-browser-api.ts`: `bookmarks`를 메모리로 구현한다(`corrupt`를 고르는 옵션, `push`로 `bookmark-key` event를 보낼 수 있다).
8. 팔레트 묶음.
   - `palette/model.ts`: `PaletteGroup`에 `"bookmarks"`를 더하고 `WORKSPACE_GROUPS`의 `contexts` 다음, `actions` 앞에 둔다.
   - `ipc/overlay.ts`의 `PALETTE_ICONS`에 `"bookmark"`, `icons/palette.ts`의 `paletteIcons`에 `bookmark`(별 icon)를 더한다(`surface.tsx`의 `Record<PaletteIcon, …>`이 둘을 함께 요구한다).
   - `labels.ts`: `groupLabel("bookmarks")`는 `browser.heading.palette-bookmarks`("Bookmarks").
   - `workspace-scope.ts`: 입력에 `bookmarks: readonly { id; title; url }[]`를 더하고 항목마다 `{ group: "bookmarks", key: "bookmark:<id>", label: title, detail: url, icon: "bookmark", target: { kind: "bookmark", url } }`. `arrange`가 이름·보조 글(url)로 거른다.
   - `workspace.tsx`: `useBookmarks()`의 `state === "ok"`일 때만 목록을 넘기고, `go`의 `target.kind === "bookmark"`는 `openBrowserTab(host, target.url)`이다.
9. wording·icon: `catalog/browser.ts`에 key를 더한다(팔레트 묶음 이름, 별 단추의 이름 둘, popover의 title label과 [Remove]와 닫기, bookmark 단추 이름, 빈 상태, corrupt 오류, 거절 이유 문장 넷). `icons/browser.ts`에 필요한 icon을 더한다(채운 별은 `Star`의 fill 속성으로 그리거나 `StarOff` 같은 lucide 별을 쓴다). `deno task wording`.

## 정한 것

- toolbar bookmark menu의 Ctrl/Cmd-click은 두지 않는다. roadmap은 그렇게 말하지만 design `Menu`의 `onSelect(id)`는 id만 주고, overlay view가 shell로 돌려주는 결과도 `choiceId`뿐이어서 modifier가 닿지 않는다(위 `surface.tsx`와 `ipc/overlay.ts`의 `overlayResultSchema`). 새 탭에서 여는 길은 새 탭 화면 목록(DOM)의 Ctrl/Cmd-click과 팔레트 항목(아래 8)이 맡는다. overlay 프로토콜을 넓혀 modifier를 싣는 일은 이 계획에서 하지 않는다. 보고의 "계약 바꾸기 요청"에 필요하면 적는다.
- 단축키로 더한 뒤 popover는 자동으로 열지 않는다(별이 채워지는 것이 신호다).
- 팔레트의 bookmark가 한 묶음에 12개(`GROUP_LIMIT`)를 넘으면 검색어로 거른 앞의 12개만 보인다. 이름을 치면 찾아지므로 늘리지 않는다. `useBookmarks()`가 `corrupt`/`unavailable`이면 묶음 자체를 두지 않는다.
- 별은 `href` 완전 일치로 bookmark를 찾는다(`bt-bookmark-store`의 판정과 같다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면이다).
- 남지 않음: 없음.
- `deno task dev:mock`에서 별 단추, popover, menu, 새 탭 목록이 fake로 동작하고 Ctrl+K로 bookmark 이름을 쳐 고르면 새 browser 탭이 열린다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`을 돌렸다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(Menu modifier가 정말 필요한지)
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". toolbar menu의 Ctrl/Cmd-click이 없다는 것을 적는다.
