# toggle-queued

Switching a restart-handoff GUI (Claude, omp) to the TUI drops messages still waiting in the GUI queue, silently. Warn in the switch modal and keep their text so it is not lost.

- 단위: gui (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/terminal-gui.tsx`
  - `packages/shell/renderer/terminal/model.ts`
  - `packages/shell/renderer/terminal/model_test.ts`
  - `packages/design/i18n/catalog/terminal.ts` (or whichever catalog file holds `terminal.dialog.*`; add keys only)
- 읽을 것:
  - `terminal-gui.tsx`: `useGuiToggle` (modal with `stops`), `TerminalGui` (`confirm` reads `feed.state().turn` and `api.running`), `createGuiFeed` and `guiSessionId` (draft key `ses_<ULID of handle>`; a new handle is made on every switch back to the GUI, so today a draft does not survive a toggle)
  - ACP state `queued` (`packages/protocol/acp/state.ts`), `DraftStore` (`packages/shell/renderer/conversation/drafts.ts`)
  - architecture: `project-docs/architecture/harness-gui.md` (toggle, handle per tab, draft key)
- 계약:
  - 쓰는 것: `HarnessGuiTabApi` as is
  - 내놓는 것: 없음

## 할 일

1. In the restart modal, when `feed.state().queued` is not empty, add a line like "N queued messages will not be sent" (i18n key).
2. Keep their text: when the person confirms, join the queued messages' text (in order, blank line between) and put it into the composer draft so it is there when the person comes back to the GUI in this tab. Because a new handle is made on every switch, make the GUI draft key stable per terminal tab instead of per handle (derive the `ses_<ULID>` key from something stable for the tab, e.g. the terminal ref; it must still pass `idSchema("ses")`, which `model_test.ts` already checks). If the person's own unsent draft is not empty, put the queued text after it.
3. Update the `guiSessionId` test if its input changes.

## 끝남

- `npm run check` passes.
- 위험 test: the existing `guiSessionId` schema test still passes for the new key.

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
