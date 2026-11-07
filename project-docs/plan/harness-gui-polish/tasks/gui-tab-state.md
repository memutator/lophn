# gui-tab-state

Two terminal-tab GUI state bugs: a GUI tab seen from another workspace (left sidebar list) shows the shell's OSC path title instead of the session title, and the text typed in the GUI composer is lost after switching to another tab and back.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/terminal-gui.tsx`
  - `packages/shell/renderer/terminal/model.ts`
  - `packages/shell/renderer/terminal/model_test.ts`
  - `packages/shell/renderer/terminal/store.ts`
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/workspace/sidebar/workspace-left-sidebar.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/harness-gui.md` ("지키는 것": tab view is not saved, `harness-gui:tab-current`, GUI tab name via field `guiTitle`)
  - `packages/shell/renderer/conversation/drafts.ts` (`DraftStore`, keyed by session id), `packages/shell/renderer/conversation/agent-view.tsx` (uses `drafts.draft(session)`)
  - `packages/shell/ipc/harness-gui.ts` (`HarnessGuiTabCurrent`)
- 계약:
  - 쓰는 것: `HarnessGuiTabApi` as is. Do not change IPC; if you need main to report more, write a request.
  - 내놓는 것: 없음

## 할 일

1. Title seen from another workspace. Person's report: "project가 selected면 tab name대로 보이는데 그게 아니면 아까처럼 그 경로로 보임". Lead's reading: `otherWorkspaceTerminalTitle` (`workspace/kinds/terminal.tsx`, used by `workspace-left-sidebar.tsx`) works from the other workspace's saved layout. The tab view is not saved, so `guiTitleOf` returns null and `tabName` falls back to the store's last OSC title (the shell prompt's `user@host: path`). Confirm in code, then fix with the simplest approach (for example keep `guiTitle` in the saved fields and trust it for other-workspace rows while the terminal store says the terminal is alive and not running a TUI agent in the foreground, or prefer the saved `title` over the OSC title for those rows). A stale GUI title after the GUI closes must not stick: the view handler already clears it on close for mounted tabs; make sure the other-workspace path does not show a GUI title for a terminal that went back to the TUI.
2. Draft loss. `createGuiFeed` makes a new `ses_…` id on every mount (`newId("ses", now())`), and `AgentView` keys the draft by that session, so remounting (tab switch, workspace switch) loses the composer text, attachments and scroll. Make the session key stable for the life of the GUI handle (derive it from `gui.handle`, which is stable while the handle lives). Also check the `own` `DraftStore` fallback (`useMemo(() => new DraftStore(), [])` when `host.agentView` is null): if any real place mounts `TerminalGui` without `agentView`, the draft is lost there too; fix it or report where.
3. Check lophn agent tabs (`workspace/kinds/agent.tsx`, `workspace/use-tab-host-slices.ts` `localDrafts`) only to report whether they lose the draft the same way. Do not change them (not owned); report.

## 끝남

- `npm run check` passes.
- 위험 test: 없음 (update `model_test.ts` only if `tabName` inputs change).

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
