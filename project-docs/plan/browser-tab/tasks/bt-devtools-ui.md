# bt-devtools-ui

browser 탭의 DevTools를 탭 안 page 옆(오른쪽 또는 아래, 경계를 끌어 크기 조절)에 띄우고, 거기서 floated 패널이나 따로 뜬 OS 창으로 옮기고 다시 탭 안으로 붙이는 화면을 만든다. 사람이 Chrome처럼 DevTools가 page 옆에 붙어 뜨기를 바랐다(2026-10-19). main 쪽은 `bt-devtools-main`이다.

- 단위: bt-devtools (wave 3)
- 선행: bt-favicon-ui, bt-devtools-main
- 소유(이 task만 고친다):
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/browser-tab.module.css`
  - `packages/shell/renderer/browser/browser-toolbar.tsx`
  - `packages/shell/renderer/browser/devtools-pane.tsx`(새로)
  - `packages/shell/renderer/browser/testdata/fake-browser-api.ts`
  - `packages/shell/renderer/workspace/kinds/browser-devtools.tsx`(새로)
  - `packages/shell/renderer/workspace/kinds/registry.ts`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/icons/browser.ts`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/browser-tab.md`, `project-docs/architecture/workspace-layout.md`(floats, `openFloat`, `transient`, native view 층과 cover)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 계약(lead가 고정): `packages/shell/ipc/browser.ts`의 `LophnBrowserApi.devtools`(`open` → `{ devtools_session }`, `close`, `window`), `BrowserEvent`의 `devtools-closed`
  - 지금 코드: `browser-tab.tsx`(page는 `useWebviewSlot`, native popup은 `useViewBounds`), `browser-toolbar.tsx`(overflow menu의 Inspect가 `command: "inspect"`), `app-frame/embedded-view.tsx`의 `useViewBounds`(native view의 사각형과 층을 보낸다), `kinds/browser.tsx`, `kinds/registry.ts`, `workspace/model.ts`의 `openFloat`

## 할 일

1. `devtools-pane.tsx`: DevTools view 자리. `useViewBounds({ viewSession: devtools_session, shown, ref })`로 사각형을 보낸다(native view다).
2. `browser-tab.tsx`: 상태 `devtools: null | { session, place: "right" | "bottom" | "float" | "window", size }`.
   - `right`/`bottom`이면 page 자리를 둘로 나눠 page 옆에 DevTools 자리를 둔다. 경계는 DOM 막대이고 끌어 크기를 바꾼다(최소 크기와 page 최소 크기를 둔다). 크기는 저장하지 않는다.
   - `float`이면 DevTools만 floated 패널로 띄운다(아래 3). `window`면 `devtools.window({ window: true })`다. 탭 안 자리는 page가 다 쓴다.
   - `devtools-closed` event(그 page의 것)를 받으면 상태를 지운다. 탭이 닫히면 `devtools.close`.
3. `kinds/browser-devtools.tsx`: DevTools만 띄우는 transient 탭 kind(`fields: { devtools_session, target: 탭 key }`, 저장하지 않음). floated 패널 안에 `devtools-pane`을 그린다. 그 패널을 닫으면 DevTools를 닫는다. 패널 bar나 toolbar에서 "탭 안으로 붙이기"를 누르면 그 transient 탭을 지우고 원래 browser 탭의 상태를 `right`로 바꾼다. renderer `kinds/registry.ts`에 한 줄(main kind registry에는 넣지 않는다. transient 탭은 저장되지 않는다).
4. `browser-toolbar.tsx`: overflow menu(overlay)의 Inspect를 DevTools 열기/닫기로 바꾸고, 열려 있으면 자리 고르기 항목(오른쪽, 아래, 띄우기, 따로 창)을 둔다. `command: "inspect"`는 더 쓰지 않는다.
5. wording·icon: 위 항목 이름과 막대·패널 label key를 `catalog/browser.ts`에 더하고 generator로 만든다. icon은 `icons/browser.ts`에만 고른다.
6. `fake-browser-api.ts`: dev mock·gallery에서 DevTools 자리가 회색 자리로라도 그려지게 한다.

## 정한 것

- 기본 자리는 오른쪽이다(Chrome 기본).
- 자리를 바꿔도 DevTools를 다시 열지 않는다(main이 view를 옮긴다). 닫았다 다시 열면 새로 연다.
- DevTools 자리는 native view라 그 위에 겹치는 DOM은 밑에 깔린다. toolbar menu는 overlay라 괜찮다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn "\"inspect\"" packages/shell/renderer`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `kinds/registry.ts`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
