# bt-favicon-ui

browser 탭과 bookmark 목록에 page favicon을 그린다. 사람이 Chrome처럼 보고 싶다고 했다(2026-10-18). main이 `BrowserViewState.favicon`과 `Bookmark.favicon`에 data URL을 싣는다(`bt-favicon-main`). favicon이 없으면 지금처럼 `Globe`다.

- 단위: bt-favicon (wave 3)
- 선행: bt-popup-float, bt-favicon-main, bt-webview-ui
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/bookmark-star.tsx`
  - `packages/shell/renderer/browser/bookmark-menu.tsx`
  - `packages/shell/renderer/browser/blank-tab-page.tsx`
  - `packages/shell/renderer/browser/bookmark.module.css`
  - `packages/shell/renderer/browser/testdata/fake-browser-api.ts`
  - `packages/shell/renderer/browser/favicon.tsx`(새로)
  - `packages/shell/renderer/desktop/settings/browser/bookmark-rows.tsx`
  - `packages/shell/renderer/desktop/palette/workspace-scope.ts`
  - `packages/shell/renderer/overlay/surfaces/surface.tsx`
  - `packages/shell/renderer/overlay/surfaces/surface.module.css`
- 읽을 것:
  - architecture: `project-docs/architecture/browser-tab.md`, `project-docs/architecture/ui-kit.md`
  - skill: `.claude/skills/ui-design/SKILL.md`
  - 계약(lead가 고정했다): `packages/shell/ipc/browser.ts`의 `favicon`, `packages/shell/ipc/overlay.ts`의 choice `image`(data URL. icon 대신 그린다)
  - 지금 코드: `kinds/browser.tsx`(탭 kind. `TabKindDef.iconOf`가 탭마다 아이콘을 준다. 본보기 `kinds/document-editor.tsx`의 `iconOf`), `browser-tab.tsx`의 `onState`, `bookmark-star.tsx`의 `add`, `bookmark-menu.tsx`(overlay `choices`와 DOM `Menu`), `blank-tab-page.tsx`, Settings `bookmark-rows.tsx`, `palette/workspace-scope.ts`의 bookmark 항목, `overlay/surfaces/surface.tsx`의 menu·palette choice 그리기(`icon`)

## 할 일

1. `favicon.tsx`: data URL이 있으면 작은 `<img>`(탭 아이콘과 같은 크기, `alt=""`), 없으면 `browserIcons.globe`를 그리는 작은 부품 하나.
2. 탭: `browser-tab.tsx`의 `onState`가 favicon도 넘기고, `kinds/browser.tsx`가 그것을 탭 `fields.favicon`에 두어 `iconOf`로 그린다. `toStored`는 지금처럼 url만 저장한다(favicon은 저장하지 않는다. 다시 열면 page가 다시 알린다).
3. bookmark: 별로 더할 때 지금 page의 favicon을 `add`에 싣는다. bookmark menu(overlay는 choice `image`, DOM은 같은 부품), 새 탭 목록, Settings 목록, palette 항목에 bookmark favicon을 그린다.
4. `surface.tsx`: menu와 palette의 choice에 `image`가 있으면 `icon` 자리에 그 이미지를 그린다(같은 크기). 다른 표면은 그대로다.
5. `fake-browser-api.ts`: state와 bookmark에 favicon을 하나쯤 넣어 dev mock과 gallery에서 보이게 한다.

## 정한 것

- favicon이 없거나 아직 안 왔으면 `Globe`다. 자리 크기가 같아 탭 이름이 흔들리지 않는다.
- 탭 favicon은 저장하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn "from \"lucide-react\"" packages/shell/renderer/browser`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `overlay/surfaces/surface.tsx`, `palette/workspace-scope.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함

- 보통 탭은 이제 `<webview>`다(`bt-webview-ui`). renderer는 `<webview>`의 `page-favicon-updated` DOM event를 직접 쓰지 않는다(그 주소는 shell CSP에 막힌다). main이 미는 `BrowserViewState.favicon`(data URL)만 쓴다.
