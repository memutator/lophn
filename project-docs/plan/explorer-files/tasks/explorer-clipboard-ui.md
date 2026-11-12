# explorer-clipboard-ui

Explorer의 붙여넣기 알림과 menu·키를 실제 화면에서 확인할 수 있게 gallery 견본을 더한다. 화면을 새로 그리지 않고 실제 component의 상태를 조작해 만든다.

- 단위: explorer (wave 2)
- 선행: `explorer-clipboard`
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-files/pages.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
- 읽을 것:
  - 지금 코드: `projects-window.tsx`의 `SidebarSpec`·`ExplorerAct`·`runExplorerAct`·`useSidebarScript`, `project-files/pages.tsx`의 `explorer()`·`FileActionsMenu`, `project-workspace.tsx`의 `new-organize` page
  - 앞 task 결과: `explorer.tsx`의 다중 선택(`data-selected`)·`data-cut`·menu 항목·paste 알림 문단
- 계약: 새 page id만 더한다. 지금 page의 id와 description은 건드리지 않는다.
- 할 일:
  1. `ExplorerAct`에 셋을 더한다: `"multi-select"`(첫 파일을 누르고 Ctrl+클릭으로 둘을 더 고른다), `"cut"`(한 줄을 골라 Ctrl+X), `"paste"`(폴더를 골라 Ctrl+V — gallery에는 진짜 clipboard가 없으므로 `document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer() }))`를 쓰지 않고, 대신 menu의 Paste를 눌러 상태 문단만 보인다. 빈 clipboard라 `error.explorer-paste-unsupported`가 보이는 것이 정상이다).
  2. `project-workspace.tsx`에 page 셋을 더한다:
     - `new-explorer-multi-select`: "Files · 여러 줄 고르기" — Ctrl/Cmd+클릭으로 셋이 같이 선택되고, 마지막 줄이 Trash·Copy 대상임을 설명.
     - `new-explorer-actions-menu`: "Project · file actions with clipboard" — menu 순서(Cut/Copy/Paste/Duplicate)를 보이는 page. 지금 `new-organize`를 대체하지 않고 옆에 둔다.
     - `new-explorer-paste-empty`: "Files · paste with nothing to paste" — 붙일 것이 없을 때의 안내.
  3. 각 page가 실제 component를 쓴다(가짜 화면을 새로 그리지 않는다).
- 끝남:
  - `npm run check:full`이 통과한다.
  - `npm run wireframes`가 되고 세 page를 headless Chrome으로 찍어 눈으로 본다(찍은 png 경로를 보고에 적는다).
- 보고: brief 꼴 그대로. "무겁게 짠 것"과 "알려진 미완 동작"을 빼지 않는다.
