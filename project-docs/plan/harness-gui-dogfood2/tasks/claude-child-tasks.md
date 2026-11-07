# claude-child-tasks

Two Claude GUI issues with subagents. (1) Background tasks that a subagent starts (its own `run_in_background` Bash) show up in the root conversation as gray "Started: …" and "… (completed)" notice lines; the Claude TUI does not show them in the main view. (2) Two subagents spawned in the same assistant message show elapsed times about 7s apart, because the row's start time is when its tool_use block arrived (the SDK sends one assistant message per finished content block, and a long prompt takes seconds to generate), not when the tool started running.

- 단위: adapter (wave 3)
- 선행: steer-background. It edits `claude.ts`.
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
- 읽을 것:
  - `claude.ts` `onTask` (`task_started` → `info("Started: …")` when the task is not an Agent call; `task_notification` → `info("… (status)")`), `lanes`/`agentCalls` (child lanes keyed by Agent tool_use id; child messages carry `parent_tool_use_id`), `toolStart`, `onAssistant`
  - SDK types for `task_started`/`task_notification` fields (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`): look for a parent/agent id or a tool_use_id that tells which lane started the task
  - ACP tool item `at` and subagent detail (`packages/protocol/acp/items.ts`), renderer `thread-layout.ts` `startedAt: item.at` (read only)
- 계약:
  - 쓰는 것: ACP as is (if a "started running" time cannot be expressed without a protocol change, report a request)

## 할 일

1. Tasks started inside a subagent (the task's tool_use belongs to a child lane, or the SDK message names a parent agent) must not produce root notice lines. Show nothing for them in the root lane (they stay in the background-task list if the adapter tracks them there). Root-lane background tasks keep today's notices.
2. Subagent start time: when `task_started` arrives for an Agent call, make the row's running time count from then (for example update the tool item's start through `tool_detail_changed`/an existing field, or delay publishing the Agent tool item's `at` until execution starts). Pick the smallest change that the renderer already reads; report what you chose.
3. One small test for (1) with fake SDK messages.

## 끝남

- `npm run check` passes.
- 위험 test: 없음 beyond the small test.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`, or "없음"
- **알려진 미완 동작**: or "없음"
