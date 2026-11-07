# tab-title

While a terminal tab shows the harness GUI, its name follows the ACP session title, not the last terminal OSC title (which is the shell prompt's `user@host: path`).

- 단위: gui (wave 1)
- 선행: gui-snapshot. It also edits `terminal-gui.tsx`.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/terminal-gui.tsx`
  - `packages/shell/renderer/terminal/model.ts`
  - `packages/shell/renderer/terminal/model_test.ts`
  - `packages/shell/renderer/terminal/terminal-tab.tsx`
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `packages/shell/renderer/workspace/sidebar/workspace-left-sidebar.tsx`
- 읽을 것:
  - issue: `project-docs/issues/harness-gui.md`, section "GUI 탭 이름이 shell 제목(`user@host: ~/폴더`)으로 덮인다"
  - architecture: `project-docs/architecture/harness-gui.md` ("GUI 동안 탭 이름은 ACP session 제목(없으면 harness 이름)이고 사람이 붙인 이름이 먼저다")
  - code: `GuiSwitch` `onTitle` in `terminal-gui.tsx`, `tabName` in `terminal/model.ts`, `terminalTabTitle`/`otherWorkspaceTerminalTitle`/`terminalNamed` in `workspace/kinds/terminal.tsx`, the terminal title effect in `workspace-window.tsx`
- 계약:
  - 쓰는 것: tab fields (`TabItem.fields`)
  - 내놓는 것: 없음

## 할 일

1. `GuiSwitch` writes the GUI session title into a tab field (e.g. `fields.guiTitle`) instead of patching `title` directly, and clears it when the tab goes back to the TUI view or the handle closes (the `view` handler in `GuiSwitch`).
2. `tabName` takes that GUI title: person name first, then the GUI title while it is set, then the existing order (hook session name, agent OSC title, auto). While the GUI title is set, the OSC title is not used.
3. Every caller of `tabName` passes it (`terminalTabTitle`, `terminalNamed`, `TerminalTab` naming, `otherWorkspaceTerminalTitle`), so the `workspace-window.tsx` effect no longer overwrites the GUI name.
4. Update `model_test.ts` if it covers `tabName` order (one case for the GUI title is enough).

## 끝남

- `npm run check` passes.
- 위험 test: 없음
- 남지 않음: no direct `{ title }` patch left in `GuiSwitch`'s `onTitle`.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`, or "없음"
- **알려진 미완 동작**: or "없음"
