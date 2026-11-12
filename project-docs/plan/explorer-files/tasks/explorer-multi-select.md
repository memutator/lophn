# explorer-multi-select

Explorer에서 파일 여러 개를 고른다(Ctrl/Cmd·Shift 클릭, 키보드 확장). 고른 것 여러 개를 한 번에 지우기·경로 복사·끌어 옮기기 한다.

- 단위: explorer (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/explorer.tsx`
  - `packages/shell/renderer/workspace/sidebar/explorer-row.tsx`
  - `packages/shell/renderer/workspace/sidebar/explorer.module.css`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`(Files panel 부분), `project-docs/architecture/keybindings.md`(13·15번: modifier 있는 키와 context)
  - 기존 코드: `explorer.tsx`의 `selection`·`onKeyDown`·`onDragStart/onDrop`·`menuItems`·`askTrash`, `explorer-row.tsx`의 `Row`
  - 본보기(화면): `tools/wireframes/pages/screens/project-files/pages.tsx`, `tools/wireframes/pages/screens/project-window.tsx`의 `runExplorerAct`
- 계약:
  - `Explorer`의 props는 이 task에서 늘리지 않는다(다음 task가 `source.copy` 등을 쓴다). `TabAwareResult`도 그대로다.
  - 줄의 선택 표시는 지금 `data-selected`를 그대로 쓴다. 지금 연 파일 표시(`data-current`)와 구별한다.
- 할 일:
  1. 선택 상태를 `string | null`에서 `{ ids: ReadonlySet<string>; anchor: string | null }`로 바꾼다. `anchor`는 Shift 범위의 기준 줄이다.
     - 보통 클릭: 그 줄 하나만 고르고 `anchor`를 그 줄로 한다.
     - Ctrl/Cmd+클릭: 그 줄을 선택에 더하거나(없으면) 뺀다. `anchor`는 그 줄이 된다.
     - Shift+클릭: `anchor`부터 그 줄까지 화면에 보이는 `tree.rows` 순서로 선택을 만든다(앞의 선택은 버린다).
     - 빈 자리 클릭은 지금처럼 비운다. 오른쪽 클릭은 그 줄만 고른다(이미 그 줄이 선택돼 있으면 선택을 그대로 둔다).
  2. 클릭은 지금처럼 `activate`(탭 열기)를 부른다. Ctrl/Cmd·Shift 클릭은 열지 않고 선택만 바꾼다. 더블 클릭은 지금대로 고정 탭으로 연다.
  3. `Row`에 props를 더한다: `multiSelected: boolean`(선택에 들었는가), `onActivate(row, keep, modifiers: { toggle: boolean; range: boolean })`. `explorer.tsx`가 `event.metaKey || event.ctrlKey`와 `event.shiftKey`를 넘긴다. `Row`가 직접 클릭 판정을 하지 않게 한다.
  4. 키보드(`onKeyDown`):
     - `Ctrl/Cmd+A`: tree의 모든 줄을 고르고 `anchor`를 첫 줄로 한다.
     - `ArrowDown`/`ArrowUp`에 `Shift`가 붙으면 지금 focus 줄에서 한 줄 늘리거나 줄인다(선택은 유지).
     - `ArrowUp`/`ArrowDown`에 modifier가 없으면 지금처럼 한 줄로 바꾼다.
     - 기존 `ctrlKey` 조기 return을 없애되, 처리하지 않는 modifier 조합은 그대로 흘려보낸다(`return`만 하고 `preventDefault`를 부르지 않는다).
  5. Delete/Backspace는 선택에 든 것이 여럿이면 한 dialog로 묻고 하나씩 지운다. dialog text는 `project-workspace.notice.explorer-delete-file`/`-folder`에 이미 `{name}`이 있으니, 여럿일 때는 새 key를 쓰지 않고 **마지막 고른 줄의 이름**으로 지금 문구를 그대로 보인다. 제목도 기존 key를 쓴다. 확인 뒤에는 `onTrash`를 고른 것마다 순서대로 부르고, 실패한 것이 있으면 그 이름으로 기존 `explorer-trash-failed` 문구를 보인다. 성공한 것만 tree에서 사라진다.
  6. 경로 복사 menu 항목(Copy Path / Copy Relative Path)은 선택이 여럿이면 그 경로들을 줄바꿈으로 이어 `systemClipboard.writeText`에 한 번 쓴다.
  7. 끌어 옮기기: 고른 줄이 여럿이면 `dataTransfer`에 지금처럼 `text/plain`(줄바꿈으로 이은 경로)과 `application/x-lophn-path`(첫 경로)를 싣는다. 놓을 때는 고른 것마다 `onMove`를 부르고, 실패한 것이 있으면 기존 move dialog의 `exists`/`failed` 문구로 알린다. 드래그 미리보기에는 고른 것 수를 보이지 않는다(`dragImage`를 만들지 않는다).
  8. 레이어: `-` 행에서 선택된 모든 줄이 같은 배경을 쓴다(지금 `[data-selected]` 그대로). `anchor` 줄은 다른 테두리·점을 더하지 않는다(VS Code도 그리지 않는다).
- 끝남:
  - `npm run check:full`이 통과한다.
  - 위험 test: 없음(화면 동작이라 test를 만들지 않는다).
  - `npm run wireframes`가 되고 gallery의 `project-files` page들이 그대로 그려진다. 다중 선택 page는 lead가 만들므로 이 task는 만들지 않는다.
- 보고:
  - 바꾼 file
  - 통과한 check
  - 등록할 것
  - 안 쓰게 된 export
  - 정한 것: Shift 범위와 Ctrl 클릭의 세부, 여럿 지우기 문구
  - 넘길 줄
  - 계약 바꾸기 요청
  - **무겁게 짠 것**: 없으면 "없음"
  - **알려진 미완 동작**: 없으면 "없음"
