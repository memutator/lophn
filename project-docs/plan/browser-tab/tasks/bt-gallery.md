# bt-gallery

wireframes gallery에 browser 화면을 더한다. gallery는 따로 그리지 않고 renderer의 실제 component를 fake source로 그린다. 세 묶음이다: (1) browser 탭(toolbar와 page 자리, 빈 주소 칸, popup 거절 안내, OAuth popup으로 뜬 floated 탭, overflow menu의 Inspect, 새 탭 menu의 Browser), (2) bookmark(별 단추와 popover, toolbar bookmark menu, bookmark 목록이 있는 새 탭, 팔레트의 bookmark 항목), (3) Settings의 Browser pane(본문, Clear browsing data 확인 dialog, bookmark 목록, 파일이 깨졌을 때의 오류).

- 단위: bt-gallery (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/mock/mock-desktop.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/browser/pages.tsx`
  - `tools/wireframes/pages/screens/settings.tsx`
  - `tools/wireframes/pages/screens/settings-pages.tsx`
  - `tools/wireframes/pages/screens/settings-frame.tsx`
  - `packages/shell/renderer/desktop/dev-mock/app-space.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 4(Settings에 Browser pane), 5, 6(gallery 목록. 단 terminal 옆 pane에 bridge로 열린 탭은 계획 `browser-bridge`의 몫이다)
  - skill: `.claude/skills/ui-design/SKILL.md`("새 화면(page) 만들기", "함정": 앱 view는 gallery에 없어 고정 그림을 넣는다, `deno task wireframes`와 `dev:mock`)
  - 본보기(화면): `tools/wireframes/pages/screens/project-workspace.tsx`(`MockDesktop`을 쓰는 page와 `pages` 항목의 모양), `tools/wireframes/mock/mock-desktop.tsx`(`TabSpec`, `layoutOf`, `AppViewsProvider`, `SETTINGS_PANE`), `project-window.tsx`의 `PageNewTabMenu`, `mock/drive.ts`(`click`, `press`, `find`), `mock/app-space/orders-view.tsx`(앱 view 자리의 고정 그림), `packages/shell/renderer/desktop/dev-mock/app-space.ts`의 `mockViews`, `pages/screens/settings.tsx`의 `settings(tab)`와 `settingsArea.pages`, `settings-pages.tsx`, `settings-frame.tsx`의 `SettingsFrame`, `project-files/pages.tsx`의 `OpenPathPalette`(Ctrl+K로 팔레트를 연 상태를 만드는 방법)
  - 이 task가 그리는 component: `packages/shell/renderer/browser/`의 `browser-tab.tsx`, `bookmark-star.tsx`, `bookmark-menu.tsx`, `new-tab-page.tsx`, `testdata/fake-browser-api.ts`(`push`, `set`, bookmarks), `workspace/add-tab-menu.tsx`, `desktop/palette/workspace-scope.ts`, `desktop/settings/browser/browser-panel.tsx`, `bookmark-rows.tsx`, `testdata/fake-source.ts`(`fakeBrowserSettings`)
  - 계획 `workspace-float`의 gallery 상태(floated 패널): land된 `project-workspace.tsx`에서 floated 패널을 만든 방법을 따른다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`
- 계약:
  - 쓰는 것: `fakeBrowserApi()`, `BrowserApiProvider`, `fakeBrowserSettings()`, `browserKind`가 읽는 layout(`{ kind: "browser", key, url }`).
  - 내놓는 것: gallery page id(한 번 정하면 바꾸지 않는다). 탭: `browser-tab`, `browser-blank`, `browser-popup-blocked`, `browser-oauth-popup`, `browser-overflow-menu`, `new-tab-menu-browser`. bookmark: `browser-star-empty`, `browser-star-filled`(popover를 연 상태), `browser-bookmark-menu`, `browser-new-tab-bookmarks`, `browser-palette-bookmark`. Settings: `settings-browser`, `settings-browser-clear-data`, `settings-browser-bookmarks`, `settings-browser-bookmarks-corrupt`.

## 할 일

1. `mock-desktop.tsx`: `TabSpec`의 `kind`에 `"browser"`를 더하고(`url` 칸) `storedTab`이 `{ kind: "browser", key, url }`을 낸다. `MockDesktop`이 `BrowserApiProvider`로 감싸고 page마다 `fakeBrowserApi()`의 상태(현재 url, title, `canGoBack`, 초기 bookmark 목록)를 고를 수 있게 한다. `SETTINGS_PANE`에 `browser: "browser"`. 화면에 gallery 전용 prop을 만들지 않는다. fake source의 설정과 mount 뒤 `drive`로 상태를 만든다.
2. page 자리의 고정 그림: browser의 native view는 gallery에 없다. `dev-mock/app-space.ts`의 `mockViews`가 놓는 안내 상자(`App view … is not drawn in mock mode`) 대신 browser 탭에서는 `ui-design` skill대로 고정 그림(`orders-view.tsx` 꼴)이 놓이게 한다. 넘길 줄이 필요하면 `mockViews`의 상자 내용을 바꿀 수 있게 최소로 고친다.
3. 탭 page를 `project-workspace.tsx`의 `pages`에 더한다(title 영어, description 한국어 한두 문장). 새 화면 component는 `pages/screens/browser/pages.tsx`에 둔다.
   - `browser-tab`: https page를 연 탭. toolbar(뒤로·앞으로·새로 고침·주소 칸·Open in browser·더 보기)와 page 자리의 고정 그림.
   - `browser-blank`: 빈 주소 칸으로 연 새 탭. 주소 칸에 focus. bookmark가 없는 모양이다.
   - `browser-popup-blocked`: `push({ kind: "popup-blocked", … })`로 거절 안내 toast를 띄운 상태.
   - `browser-oauth-popup`: 연 탭 위에 floated로 뜬 작은 browser 탭(예: 주소 `accounts.google.com`).
   - `browser-overflow-menu`: 더 보기 menu를 연 상태(Inspect).
   - `new-tab-menu-browser`: `project-window.tsx`의 `PageNewTabMenu`가 `onBrowser`를 넘기게 고치고(`NewTabPick`에 `"browser"` 추가) 열린 새 탭 menu에 Browser 항목이 보인다. 기존 `new-project-tab-menu` page의 description에 Browser가 없으면 고친다.
4. bookmark page를 `project-workspace.tsx`에 더한다. fake source의 bookmark 목록과 현재 url로 바탕을 정하고 `drive`로 상태를 만든다.
   - `browser-star-empty`: 아직 bookmark가 아닌 https page. 빈 별.
   - `browser-star-filled`: 채운 별을 눌러 popover가 열린 상태(title 입력과 [Remove]).
   - `browser-bookmark-menu`: toolbar의 bookmark 단추를 눌러 menu가 열린 상태.
   - `browser-new-tab-bookmarks`: 빈 주소 칸으로 연 새 탭에 bookmark 목록이 보인다.
   - `browser-palette-bookmark`: Ctrl+K로 팔레트를 열고 bookmark 이름을 친 상태(Bookmarks 묶음).
5. Settings page를 `settings-pages.tsx`와 `settings.tsx`의 `pages`에 더한다. `settings-frame.tsx`의 `SettingsFrame`이 `browser` panel의 fake(초기 bookmark, `corrupt`)를 받게 한다(fake source의 설정이다. 화면에 gallery 전용 prop을 두지 않는다). `settingsArea`의 `summary`에 Browser를 더한다.
   - `settings-browser`: Browser pane. Browsing data 구역과 [Clear browsing data].
   - `settings-browser-clear-data`: 단추를 눌러 확인 dialog가 열린 상태.
   - `settings-browser-bookmarks`: bookmark 목록(줄마다 title, URL, [Edit], [Remove]). 한 줄은 [Edit]을 눌러 입력으로 바뀐 상태여도 된다.
   - `settings-browser-bookmarks-corrupt`: 파일이 깨졌을 때 목록 자리의 오류 문장.
6. `deno task wireframes`로 bundle을 만들고 `index.html?frame=<page id>&theme=dark`로도 light·dark를 본다.

## 정한 것

- 새 gallery 영역 file은 만들지 않는다. roadmap이 `project-workspace.tsx`에 더하라 했고 `GROUPS` 등록(`pages/index.ts`)이 필요 없다.
- terminal 옆 pane에 bridge로 열린 탭은 계획 `browser-bridge`의 몫이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- `deno task wireframes`가 되고 위 page 열다섯 개가 renderer의 실제 component로 그려진다. gallery 쪽에 모양을 덮어쓰는 CSS를 두지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(page는 `project-workspace.tsx`와 `settings.tsx`가 자기 영역에 낸다. `pages/index.ts`는 안 바뀐다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `dev-mock/app-space.ts`(필요했다면)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
