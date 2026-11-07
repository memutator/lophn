# composer-shell-button

Add an icon button to the chat composer that switches into shell (`!`) mode, with a tooltip, where the session can run shell commands.

- 단위: chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`
  - `packages/shell/renderer/conversation/composer/agent-composer.module.css`
  - `packages/design/i18n/catalog/conversation.ts`
  - `packages/shell/renderer/icons/mod.ts` (add only)
- 읽을 것:
  - `agent-composer.tsx`: shell mode already exists (`shellMode = capabilities.shell && draft.text.startsWith("!")`, `props.onShell`)
  - architecture: `project-docs/architecture/agent-chat.md` (capability hides controls), `project-docs/architecture/harness-gui.md`
  - skill: `.claude/skills/harness-gui/SKILL.md` (use existing parts; gallery screenshot steps)
  - `packages/design/components/overlay/tooltip/` (`Tooltip`)
- 계약:
  - 쓰는 것: `capabilities.shell`
  - 내놓는 것: 없음

## 할 일

1. In the composer's control row, add an icon button (terminal-style icon from `icons/mod.ts`; add an export there only if none fits) shown only when `capabilities.shell` is true. Pressing it toggles shell mode: if the text does not start with `!`, prefix `!` (keep the rest of the text, put the cursor after it) and focus the input; if it already does, remove the leading `!`. The button shows the pressed state while in shell mode (`aria-pressed`).
2. Tooltip on the button, e.g. "Run a shell command (!)" and, when on, "Back to chat". Add the i18n keys in `conversation.ts`. Also give the existing shell-mode chip a tooltip if it has none.
3. Gallery screenshot of the harness GUI page composer with the button off and on.

## 끝남

- `npm run check` passes.
- 위험 test: 없음
- (화면) `npm run wireframes` builds and the screenshots show the button and tooltip.

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
