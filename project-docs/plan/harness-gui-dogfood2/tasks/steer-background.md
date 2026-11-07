# steer-background

In the Claude GUI a steer sent while a long Bash command (or subagent) runs waits until that tool ends, while the Claude TUI moves the running command to the background and delivers the message at once. Do the same in the GUI.

- 단위: adapter (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
- 읽을 것:
  - evidence (lead, from a real transcript): TUI steer → tool_result "Command was moved to the background so that a message that arrived while it was running can reach you" 2s later; GUI (SDK mode) steer stayed in the CLI queue until the tool ended.
  - SDK: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` `Query.backgroundTasks(toolUseId?)` ("equivalent to pressing Ctrl+B in the terminal"; throws when background tasks are disabled)
  - `claude.ts` `sendText` (steer path: `priority: "next"`), `toolStart`/running tool tracking, `ClaudeSdk`/`Live` fakes in `claude_test.ts`
  - architecture: `project-docs/architecture/harness-gui.md` "Claude Code adapter"
- 계약:
  - 쓰는 것: ACP as is
  - 내놓는 것: 없음

## 할 일

1. When a steer (`delivery: "steer"`, a turn running) is pushed with `priority: "next"`, and a foreground Bash command or Agent subagent tool is running in the root lane, call `live.q.backgroundTasks()` (all foreground tasks, like Ctrl+B in the TUI) right after pushing the message. Ignore its errors (background tasks may be disabled). Do not do it for "next turn" (queued, `later`) messages.
2. The backgrounded command then runs as a background task; check the existing `task_*` / `tasks_changed` handling shows it (it should already, as `local_bash`); fix only if it does not.
3. One small test with the fake SDK: a steer while a Bash tool is running calls `backgroundTasks` once; a next-turn message does not.

## 끝남

- `npm run check` passes.
- 위험 test: 없음 beyond the small test.

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
