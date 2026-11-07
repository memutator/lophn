# shell-stop

A `!` shell command the person ran outside a turn cannot be stopped from the GUI (the composer stop button only shows while a turn runs). Add a stop button on the running "You ran" row that stops just that command, in all four harness adapters.

- 단위: adapter (wave 2)
- 선행: chat-render-perf, claude-meta. They edit `agent-thread.tsx` and `claude.ts`.
- 소유(이 task만 고친다):
  - `packages/protocol/acp/input.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/renderer/conversation/thread/shell-run.tsx`
  - `packages/shell/renderer/conversation/thread/thread.module.css` (shell rules only)
  - `packages/shell/renderer/conversation/agent-thread.tsx` (passing the stop callback only)
  - `packages/shell/renderer/conversation/agent-tab-source.ts`, `agent-tab-gui-source.ts`, `agent-tab-core-source.ts`, `agent-tab-fake-source.ts` (only what the new input needs)
  - `packages/design/i18n/catalog/conversation.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/acp.md` (input table), `project-docs/architecture/harness-gui.md` (`!` per adapter: Claude `runShell`/`killShells`, Codex `thread/shellCommand` opens its own turn, OpenCode `session.shell`, omp `bash`/`abort_bash`)
  - upstream (read-only): `/home/pyosechang/projects/harness-lab/codex/`, `/home/pyosechang/projects/harness-lab/open-code/` for how to stop a shell command
- 계약:
  - 내놓는 것: ACP input `stop_shell { type: "stop_shell", session, item }` where `item` is the user tool item id. Update every consumer of the input union in the same change (AGENTS.md: protocol change fixes users). lophn core may answer it as unavailable if it has no such thing; check `packages/core` users of the input schema and report.

## 할 일

1. Add `stop_shell` to the ACP input schema.
2. Adapters: Claude kills the process of that item (today `killShells` kills all); omp `abort_bash`; Codex: interrupt the shell command's turn; OpenCode: find the server API that stops a running `session.shell` (or `interrupt`) and report what works. The row then ends as `cancelled`.
3. Screen: `ShellRun` shows a small stop (■) icon button with a tooltip ("Stop") while `state` is running and the source supports it; it sends `stop_shell`. Hide it where the capability/source cannot (lophn agent without shell).
4. One small test in `claude_test.ts` (stop one of two running shells).

## 끝남

- `npm run check` passes; `npm run check:full` passes.
- 위험 test: 없음 beyond the one above.

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
