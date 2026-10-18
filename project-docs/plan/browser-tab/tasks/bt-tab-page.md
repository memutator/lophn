# bt-tab-page

browser 탭 본문의 renderer 화면을 만든다: toolbar(뒤로, 앞으로, 새로 고침, 주소 칸, Open in browser, overflow menu의 Inspect), native view 자리(page region), popup 거절 안내, 깨진 page 안내. 탭 kind에 꽂는 일(registry, 새 탭 menu)은 `bt-tab-kind`가 한다. wording `browser` 영역과 icon 묶음도 이 task가 처음 연다.

- 단위: bt-tab (wave 2)
- 선행: bt-contract, bt-view
- 소유(이 task만 고친다):
  - `packages/shell/renderer/browser/browser-api.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/browser-toolbar.tsx`
  - `packages/shell/renderer/browser/browser-tab.module.css`
  - `packages/shell/renderer/browser/testdata/fake-browser-api.ts`
  - `packages/shell/renderer/app-frame/embedded-view.tsx`
  - `packages/shell/renderer/icons/browser.ts`
  - `packages/shell/renderer/icons/mod.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/mod.ts`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
  - `packages/design/wording/en.ts`
  - `packages/design/wording/placeholders.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(view, toolbar), 4(DevTools)와 "정한 것"
  - architecture: `project-docs/architecture/ui-kit.md`(범용 부품과 lophn 전용 부품)
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙"), `.claude/skills/wording/SKILL.md`
  - 본보기(화면): `packages/shell/renderer/app-frame/embedded-view.tsx`(자리 `<div>`, 안 보이면 cleanup에서 바로 숨기기, bounds 보내기), `packages/shell/renderer/app-frame/view-chrome.tsx`(깨진 view 안내), `packages/shell/renderer/workspace/app-panel-tab.tsx`, `packages/shell/renderer/workspace/contexts/context-frame.tsx`(탭 안 `Toast`는 `tabToast`로 둔다)
  - 이 task가 쓰는 것: bt-contract(`window.lophnBrowser`, `ipc/browser.ts`), 이미 있는 view 통로(`useAppViews().views`의 `setViewBounds`, `setViewsHidden`, `closeView`, `app-frame/app-views.tsx`), `window.lophnShell.openExternal`(`preload/shell.ts`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
- 계약:
  - 쓰는 것: `LophnBrowserApi`(`open`, `navigate`, `command`, `subscribeState`, `subscribeEvents`)와 `BrowserViewState`, `BrowserEvent`의 `popup-blocked`.
  - 내놓는 것(`bt-tab-kind`와 이후 task가 쓴다):
    - `browser-api.tsx`: `BrowserApiProvider`, `useBrowserApi(): LophnBrowserApi | null`.
    - `browser-tab.tsx`: `BrowserTab(props: { url: string; shown: boolean; onState(state: { url: string; title: string }): void })`. `url`은 view를 처음 열 때만 쓴다(바뀌어도 view를 다시 열지 않는다. 탭 kind가 `onState`로 받은 url을 저장하고 다시 prop으로 주기 때문이다).
    - `testdata/fake-browser-api.ts`: `fakeBrowserApi(): { api: LophnBrowserApi; push(event: BrowserEvent): void; set(patch: Partial<BrowserViewState>): void }`. 메모리로 도는 `LophnBrowserApi`(navigate하면 state의 url이 바뀐다). gallery와 `dev:mock`이 쓴다.
    - `dev-mock/mod.ts`의 `DevMock`에 `browser: LophnBrowserApi`.
    - `icons/browser.ts`의 `browserIcons`(globe, back, forward, reload, openExternal, more, star)와 `icons/mod.ts`의 export.
    - `app-frame/embedded-view.tsx`: `useViewBounds(input: { views; viewSession: string | null; shown: boolean; ref })`를 export한다(아래 1).

## 할 일

1. `embedded-view.tsx`: `EmbeddedView` 안의 "보이는 동안만 사각형을 보낸다" effect(`startBoundsRelay` 호출과 cleanup의 숨김)를 `useViewBounds` hook으로 옮기고 `EmbeddedView`가 그것을 부른다. 동작은 바꾸지 않는다(넘길 줄). `ViewCoversContext`를 hook 안에서 읽는다.
2. `browser-api.tsx`: context와 `useBrowserApi`. `entry.tsx`의 `mount(...)` 안, `AppViewsProvider` 바로 안에 `BrowserApiProvider`를 두고 값은 `mock?.browser ?? bridges.lophnBrowser ?? null`이다(`bridges`에 `lophnBrowser?: LophnBrowserApi` type을 더한다). `dev-mock/mod.ts`는 `fakeBrowserApi().api`를 `browser`로 둔다.
3. `browser-tab.tsx`: `BrowserTab`.
   - mount에서 `browser.open({ url })`, 돌려받은 `view_session`을 기억한다. 닫히거나 unmount되면 `views.closeView`(`EmbeddedView`와 같은 "여는 동안 사라진 자리" 처리)다.
   - `browser.subscribeState`로 그 `view_session`의 state를 받아 toolbar에 준다. url·title이 바뀌면 `onState({ url, title })`.
   - page region `<div ref>`를 하나 두고 `useViewBounds({ views, viewSession, shown: shown && state.url !== "", ref })`로 bounds를 보낸다. 주소가 비어 있으면 native view를 보이지 않는다(그 자리는 새 탭 화면 자리다. `bt-bookmark-ui`가 채운다).
   - `state.health === "crashed"`이면 region에 `ErrorState`와 다시 열기(`command: "reload"`)를 둔다.
   - 빈 주소 칸으로 열린 탭(`url === ""`)은 mount 때 주소 칸에 focus가 간다.
   - `popup-blocked` event는 toolbar 아래(page region 위)에 `Toast`(`@lophn/ui/overlay`)로 한 줄 알린다. native view는 DOM 위에 그려지므로 toast를 page region 안에 두지 않는다.
   - `useAppViews()?.views`나 `useBrowserApi()`가 없으면(preload 없는 창) `ErrorState`만 그린다.
4. `browser-toolbar.tsx`: 뒤로·앞으로(비활성은 `canGoBack`/`canGoForward`)·새로 고침 `IconButton`, 주소 칸(`Input`), [Open in browser] `IconButton`, overflow menu(`Menu`, trigger `IconButton`)의 항목 Inspect.
   - 주소 칸은 현재 url을 보인다. 사람이 고치는 동안(focus가 있고 글이 바뀜)에는 state가 바뀌어도 덮지 않는다. Enter는 `browser.navigate({ view_session, input })`. 거절(`invalid_input`)이면 현재 url로 되돌린다. Esc는 현재 url로 되돌린다.
   - [Open in browser]는 `window.lophnShell.openExternal(url)`이고 url이 비어 있으면 비활성이다.
   - Inspect는 `browser.command({ view_session, command: "inspect" })`.
   - 단추 오른쪽 끝 고정 열, 아이콘은 `icons/browser.ts`만 쓴다(lucide를 직접 import하지 않는다. `ui-design` skill).
5. `fake-browser-api.ts`와 `dev-mock`: 위 계약대로.
6. wording: 새 영역 file `catalog/browser.ts`를 만들고 `wording/en.ts`의 import·`AREAS`·`en` spread, `wording/placeholders.ts`의 import·`&` 한 칸을 더한 뒤 `deno task wording`을 돌린다. 이 task가 필요한 key(이름은 `wording` skill 규칙을 따른다): 탭 kind 이름 `browser.label.kind`("Browser"), 새 탭 menu 항목 `browser.label.menu-browser`("Browser"), toolbar 단추 이름(뒤로, 앞으로, 새로 고침, Open in browser, 더 보기, Inspect), 주소 칸 label과 placeholder(검색이 아니라 주소를 적는 칸이다), popup 거절 안내("A page tried to open a window without a click, so it was blocked."), 깨진 page 안내. 이후 task(bt-tab-kind, bt-bookmark-ui, bt-settings-*)는 같은 file에 자기 key를 더한다.
7. icon: `lucide-react`의 `Globe`, `ArrowLeft`, `ArrowRight`, `RotateCw`, `ExternalLink`, `EllipsisVertical`(없으면 `MoreHorizontal`), `Star`를 `icons/browser.ts`에 고른다.

## 정한 것

- popup 거절 안내는 roadmap이 "탭 toolbar에 한 줄"이라 했지만 `ui-design` skill의 사람 규칙("탭 안 알림은 그 탭 위쪽 toast로 띄운다. 색 다른 띠나 상자를 쓰지 않는다")이 앞서므로 design `Toast`로 한다. native view가 DOM 위에 그려지므로 toast는 toolbar와 page region 사이 줄에 둔다.
- 새로 고침 중 상태 표시(spinner), 중지 단추, 확대·축소 UI는 두지 않는다(roadmap "하지 않는 것").
- 주소 칸에는 favicon을 두지 않는다(roadmap).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn "from \"lucide-react\"" packages/shell/renderer/browser`가 0줄이다.
- `deno run -A packages/shell/renderer/build.ts`가 서고 `deno task dev:mock`에서 fake로 toolbar가 그려진다는 것을 손으로 본다(탭 kind 연결은 `bt-tab-kind`라서 이 task에서는 그릴 방법이 없으면 컴파일만 확인한다고 보고에 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`은 이 task가 이미 돌렸다. lead는 merge 때 `catalog/browser.ts`의 key 충돌만 본다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `renderer/app-frame/embedded-view.tsx`(hook 추출)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
