# kb-workspace

place 창이 README 표의 새 command를 모두 받아 한다. tab·group·stack·desk·float·새 탭·sidebar·이동 기록·Settings·Inbox·Jobs·앱 panel 열기다.

- 단위: kb (wave 2)
- 선행: kb-table
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/place-window.tsx`
  - `packages/shell/renderer/shell/desk-model.ts`
  - `packages/shell/renderer/shell/desk-model_test.ts`
  - `packages/shell/renderer/shell/desk-switcher.tsx`
  - `packages/shell/renderer/shell/desk-switcher.module.css`
  - `packages/shell/renderer/shell/float-layer.tsx`
- 읽을 것:
  - plan: `project-docs/plan/keybindings/README.md` (정한 것, 표)
  - architecture: `project-docs/architecture/keybindings.md`, `project-docs/architecture/workspace-layout.md`
  - 제품 결정: `project-docs/plan/ui-overhaul/README.md`의 "정한 것 (agent)"(desk 닫기는 일을 끝내기, group 2~4칸, 이동 기록)
  - 지금 코드: `place-window.tsx`의 `runCommand`(`WORKSPACE_COMMANDS`), `runTabAction`, `selectDesk`·`newDesk`, `floatByKey`, `splitNext`, `closeMany`, `walk(backAt)`, 앱 panel을 여는 함수(빠른 실행 pin이 부르는 것)
- 계약:
  - 쓰는 것: `packages/shell/ipc/keybindings.ts`의 `Command`, `APP_PANEL`, `parseBindingId`, `bindingLabel`. `packages/shell/renderer/commands/react.tsx`의 `useCommands`, `useKeyLabel`.
  - 내놓는 것: 없음

## 할 일

1. `runCommand`에 README 표의 새 command를 넣는다. 원칙: context menu와 같은 일은 `runTabAction(action, desk.selected)`을 부른다(새 길을 만들지 않는다).
   - `tab.rename`·`tab.close-others`·`tab.close-right`·`tab.close-saved`·`tab.close-all`·`tab.keep-open`·`tab.copy-path`·`tab.copy-relative-path`·`tab.reveal`·`tab.float`·`tab.detach` → 같은 이름의 `TabAction`.
   - `pane.split-down` → `splitNext(selected, "bottom")`. `pane.unstack`·`pane.remove`·`pane.unsplit`·`pane.close-others`(`close-pane-others`)·`pane.close-group`(`close-group`) → `TabAction`.
   - `pane.swap-*` → 고른 group에서 `neighborLeaf`로 그쪽 칸을 찾아 `swapTabs`. 고른 tab이 그 칸으로 가고 focus도 따라간다.
   - `pane.stack-next`·`pane.stack-prev` → `cyclePane(desk, selected, ±1)`.
   - `desk.new` → `newDesk`. `desk.next`·`desk.prev`·`desk.nth` → DeskSwitcher에 넘기는 목록 순서(사람이 만든 desk, 그다음 workflow desk)로 `selectDesk`. 끝에서 돈다. 없는 번호는 아무것도 안 한다.
   - `desk.rename` → DeskSwitcher를 열어 지금 desk를 이름 바꾸기 상태로(Main·workflow desk는 이름을 못 바꾸니 아무것도 안 한다). DeskSwitcher에 그 상태를 여는 prop을 더한다.
   - `desk.close` → desk 줄의 지우기와 같은 길(확인 dialog, 일을 끝내기). Main과 workflow desk는 아무것도 안 한다.
   - `float.dock` → 맨 위(고정한 것 우선, 접히지 않은 것) float을 `dockFloat`. `float.minimize` → `minimizeLooseFloats`.
   - `new.terminal`·`new.browser`·`new.document` → + menu의 같은 항목 handler. `new.agent` → 왼쪽 sidebar의 New session 기본 동작(기본 agent의 lophn session).
   - `sidebar.toggle-right` → 오른쪽 sidebar 접기. `nav.back`·`nav.forward` → card 머리 ← →와 같은 `walk`.
   - `settings.open` → `props.onSettings()`. `inbox.open`·`jobs.open` → 왼쪽 sidebar의 Inbox·Jobs overlay를 연다(그 통로가 place-window에 없으면 tab으로 여는 `openInbox`·`openJobs`를 쓰고 "정한 것"에 적는다).
   - `app.panel` (arg `"<app>:<surface>"`) → 빠른 실행 pin 단추가 부르는 앱 panel 열기와 같은 함수. 앱 통로(`host.appScreens`)가 없으면 아무것도 안 한다.
2. 그 place에 그 일이 없으면(Home의 터미널·Explorer, group이 아닐 때 `pane.*`, float이 없을 때 `float.*`) 키를 삼키지 않게 `useCommands`의 `when`으로 막는다. command 묶음마다 `useCommands`를 나눠 불러도 된다. 번호(arg)마다의 판정은 하지 않는다.
3. DeskSwitcher의 New desk 줄에 `desk.new` 키를 `useKeyLabel`로 보인다.
4. 새 pure 함수가 desk model에 필요하면 `desk-model.ts`에 두고, tab을 잃거나 둘로 만들 수 있는 것이면 `desk-model_test.ts`에 한 test를 더한다.

## 끝남

- `npm run check`가 통과한다. renderer build(`node packages/shell/renderer/build.ts`)가 된다.
- 위험 test: desk model에 새 함수를 더했으면 "새 함수가 tab을 잃거나 둘로 만들지 않는다". 아니면 없음.
- 남지 않음: README 표의 모든 command id가 `place-window.tsx`의 `runCommand`에 `case`로 있다(`grep -c "case \"" `로 대조해 보고에 적는다).
- `npm run wireframes`가 되고 gallery `shell-*` page가 그대로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: Inbox·Jobs 여는 길, desk 순서, float "맨 위"의 뜻
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (kb-table 뒤)

- `WORKSPACE_COMMANDS`는 표의 command를 모두 올리고 `runCommand`는 모르는 command를 그냥 넘긴다. 그래서 지금은 새 기본 키가 아무것도 안 하면서 키를 삼킨다. 모든 새 command에 `case`를 넣어 이것을 없앤다.
- `app.panel`은 표에 줄이 없어 `WORKSPACE_COMMANDS`에 들지 않는다. 따로 `useCommands({ [APP_PANEL]: ... })`로 올린다. arg는 `"<app>:<surface>"` 글자이고 첫 `:`에서 나눈다(app id에 `:`가 없다).
- `pane.focus-up/down`(Ctrl/Cmd+Alt+↑↓)이 편집기의 커서 더하기를 이미 가린다. 그대로 둔다.
