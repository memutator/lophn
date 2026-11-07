# shell-run-wrap

The row for a shell command the person ran (`!` in the harness GUI) shows a long command on one line with a horizontal scrollbar. Make it read cleanly.

- 단위: chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/thread/shell-run.tsx`
  - `packages/shell/renderer/conversation/thread/thread.module.css` (only the rules `ShellRun` uses)
- 읽을 것:
  - `packages/shell/renderer/conversation/thread/shell-run.tsx`, `packages/shell/renderer/conversation/thread-layout.ts` (`kind: "shell"` entry)
  - architecture: `project-docs/architecture/agent-chat.md`
  - skill: `.claude/skills/harness-gui/SKILL.md` ("CSS: 한 줄이어야 하는 줄", gallery screenshot steps)
  - gallery: `tools/wireframes/pages/screens/harness-gui.tsx`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

1. The command text wraps instead of scrolling sideways: `white-space: pre-wrap` with `overflow-wrap: anywhere` so long paths break. Long commands (more than about 3 lines) are clamped with a fade and expand on click/toggle; keep the existing copy button. Follow how Claude/Codex desktop show a `!` command: a monospace block with the `!` prompt, wrapped.
2. Reuse existing i18n keys (`packages/design/i18n/catalog/conversation.ts`, e.g. a "show more" style key if one exists). Do not edit the catalog; if a new key is needed, use none and report it.
3. Take a gallery screenshot of the harness GUI page with a long `!` command (add a long command to the gallery fake data only if one is missing, and report that file under "넘길 줄").

## 끝남

- `npm run check` passes.
- 위험 test: 없음
- (화면) `npm run wireframes` builds and the screenshot shows the wrapped command with no horizontal scrollbar.

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
