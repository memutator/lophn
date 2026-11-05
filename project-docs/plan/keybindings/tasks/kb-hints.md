# kb-hints

context menu와 빠른 실행·팔레트가 그 일의 단축키를 보인다. tab menu(tab 줄 오른쪽 클릭과 card 머리 ⋯), + menu, 왼쪽 sidebar 빠른 실행·New session 단추의 tooltip, 팔레트 행동 행이다.

- 단위: kb (wave 2)
- 선행: kb-table
- 소유(이 task만 고친다):
  - `packages/shell/renderer/shell/tab-menu.tsx`
  - `packages/shell/renderer/shell/content-card.tsx`
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`
  - `packages/shell/renderer/shell/left-sidebar.tsx`
  - `packages/shell/renderer/desktop/palette/workspace-scope.ts`
  - `packages/shell/renderer/desktop/palette/desktop-scope.ts`
  - `packages/shell/renderer/desktop/palette/labels.ts`
- 읽을 것:
  - plan: `project-docs/plan/keybindings/README.md` (표: binding id ↔ menu 항목)
  - architecture: `project-docs/architecture/keybindings.md`
  - 지금 코드: `tab-menu.tsx`(`TabAction`, `tabMenuItems`, `TabContextMenu`), `content-card.tsx`의 ⋯ Menu, `add-tab-menu.tsx`(`NewTabMenu`), `left-sidebar.tsx`의 빠른 실행 단추
- 계약:
  - 쓰는 것: design `MenuItem.shortcut`, `packages/shell/renderer/commands/react.tsx`의 `useKeyLabel`, `packages/shell/ipc/keybindings.ts`의 `appPanelBindingId`, `bindingLabel`
  - 내놓는 것: 없음

## 할 일

1. `tab-menu.tsx`: `TabAction` → binding id 표를 둔다(README 표의 "짝인 menu 항목": `close`→`tab.close`, `split-right`→`pane.split`, `split-remove`→`pane.remove`, `close-pane-others`→`pane.close-others`, `close-group`→`pane.close-group`, `float`→`tab.float` …). `tabMenuItems(state, extra, label?)`가 `label(id)`로 `shortcut`을 채운다. `TabContextMenu`는 `useKeyLabel`로 label을 넘긴다.
2. `content-card.tsx`: 머리 ⋯ menu가 같은 label을 넘긴다.
3. `add-tab-menu.tsx`: Document→`new.document`, Terminal→`new.terminal`, Browser→`new.browser`, Search→`search.open`의 `shortcut`. Agent ▸와 앱 항목은 없다.
4. `left-sidebar.tsx`: 빠른 실행 Terminal·Browser·Search 단추와 New session 단추의 tooltip에 키를 붙이고(`new.terminal`·`new.browser`·`search.open`·`new.agent`), 고정한 앱 단추는 `appPanelBindingId(app, surface)`의 키가 있으면 붙인다. tooltip 글 모양은 지금 tooltip이 키를 보이는 곳이 있으면 그것을 따르고, 없으면 이름 뒤에 `Kbd`나 흐린 글로 둔다(design 부품만 쓴다).
5. 팔레트 행동 행: `workspace-scope.ts`의 `terminal`→`new.terminal`, `settings`→`settings.open`, `float`→`tab.float`, `dock`→`float.dock`, `minimize`→`float.minimize`의 hint를 `commandLabel`(사람이 바꾼 키 반영)로. `desktop-scope.ts`·`labels.ts`도 같은 행이 있으면 맞춘다.
6. 키가 없는(사람이 안 단) 항목은 아무것도 보이지 않는다. gallery처럼 `WindowCommands`가 없으면 보이지 않는다.

## 끝남

- `npm run check`가 통과한다. renderer build(`node packages/shell/renderer/build.ts`)가 된다.
- 위험 test: 없음(화면).
- `npm run wireframes`가 되고 tab menu·+ menu page가 그대로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: tooltip에 키를 보이는 모양
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
