# gui-title-flash

After switching to another workspace and back, a GUI terminal tab briefly shows the terminal's OSC path title (`user@host: ~/…`) before its session name comes back. Remove the flash.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/model.ts`
  - `packages/shell/renderer/terminal/model_test.ts`
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/harness-gui.md` (tab view is not saved; `harness-gui:tab-current` restores it; GUI title in field `guiTitle`; other-workspace rows use saved `agentTitle` when the agent TUI is not in the foreground)
  - `terminalTabTitle`, `otherWorkspaceTerminalTitle` in `workspace/kinds/terminal.tsx`; the title effect in `workspace-window.tsx`; `GuiSwitch` in `terminal/terminal-gui.tsx` (read only)
- 계약:
  - 쓰는 것: tab fields as is
  - 내놓는 것: 없음

## 할 일

1. Lead's reading: a tab rebuilt from the saved layout has no `gui`/`view`/`guiTitle` until `tab-current` answers, so `terminalTabTitle` falls back to the OSC title (the shell prompt's path) and the workspace-window effect writes it, then the GUI title comes back. Confirm.
2. Fix with the simplest rule: the OSC title is only used while the agent's TUI is in the foreground (`store.agentOf(key)?.foreground === true`). When the agent is hooked but not in the foreground and there is no GUI title yet, keep the saved name (the tab's current `title` / saved `agentTitle`) instead of switching to the OSC path. Make `otherWorkspaceTerminalTitle` use the same rule so the two paths do not drift.
3. One small `model_test.ts` case if `tabName` inputs change.

## 끝남

- `npm run check` passes.
- 위험 test: 없음

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
