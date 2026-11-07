# code-block-shell

Chat code blocks overflow sideways with a scrollbar; wrap them instead. Add a bash button, left of the copy button, on code blocks whose text starts with `!`: pressing it puts that command into the composer in shell mode. Remove the composer shell toggle button added earlier (the person did not want it).

- 단위: chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/message-list/chat-markdown.tsx`
  - `packages/shell/renderer/conversation/message-list/run-code.ts`
  - `packages/shell/renderer/conversation/message-list/*.module.css` (code block rules only)
  - `packages/shell/renderer/conversation/agent-view.tsx` (only providing the new "fill shell" callback)
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`
  - `packages/design/i18n/catalog/conversation.ts`
  - `tools/wireframes/pages/screens/harness-gui.tsx` (a gallery example only)
- 읽을 것:
  - `chat-markdown.tsx` (existing actions slot: "Run in terminal" for bash/sh/zsh blocks via `run-code.ts` `RunCodeProvider`)
  - `agent-composer.tsx` (shell mode: `capabilities.shell && draft.text.startsWith("!")`; the toggle button and its keys `conversation.button.shell-on`/`shell-off`)
  - `agent-view.tsx` (drafts: `drafts.save(session, { text, selection })`)
  - architecture: `project-docs/architecture/agent-chat.md`
  - skill: `.claude/skills/harness-gui/SKILL.md` (gallery screenshot: serve `tools/wireframes/dist`, use `#/<page-id>`)
- 계약:
  - 쓰는 것: none new; do not edit `packages/design` components (if the CodeBlock has no way to wrap, wrap from the chat markdown CSS; report if impossible)
  - 내놓는 것: 없음

## 할 일

1. Wrap: code blocks in chat messages wrap long lines (`white-space: pre-wrap; overflow-wrap: anywhere`) with no horizontal scrollbar. Keep the copy button at the top right.
2. Bash button: on a code block whose first non-space character is `!` (any fence language), show an icon button (terminal icon, tooltip such as "Run in shell mode") left of the copy button, only when the session has `capabilities.shell`. Pressing it sets the composer draft to the block text (multi-line kept, leading `!` kept) with the cursor at the end and focuses the composer, so the composer is in shell mode; it does not send. Provide the callback from `AgentView` through a context like `RunCodeProvider`.
3. Remove the composer shell toggle button and its now-unused i18n keys (`conversation.button.shell-on`, `conversation.button.shell-off`). Keep the Shell chip tooltip.
4. Gallery: a message with a long `!` code block; screenshot showing wrapping and the bash button.

## 끝남

- `npm run check` passes; `grep -rn "shell-on\|shell-off" packages tools` is 0 lines.
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
