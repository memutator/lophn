# claude-fixes

Fix two Claude adapter bugs: token totals and cost restart from zero after resume, and resuming a TUI session that was never saved (no message sent yet) fails instead of opening an empty session.

- 단위: adapter (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`
- 읽을 것:
  - issues: `project-docs/issues/harness-gui.md`, sections "Claude GUI를 다시 열면 토큰 합계와 비용이 0부터 다시 센다" and "메시지를 보내지 않은 TUI session에서 GUI로 넘기면 resume이 실패한다"
  - architecture: `project-docs/architecture/harness-gui.md` "Claude Code adapter"
  - skill: `.claude/skills/harness-gui/SKILL.md` (do not record new fixtures; no real model calls)
  - SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`getSessionInfo`, `getSessionMessages`, `SessionMessage.message` is the raw transcript message)
  - reference (read-only): `/home/pyosechang/projects/harness-lab/t3code/t3code-web/apps/server/src/provider/Drivers/claudeUsage.ts` (dedupe by `message.id:requestId`)
- 계약:
  - 쓰는 것: `AcpUsage` (`packages/protocol/acp/`), `HarnessGuiAdapter` (`adapter.ts`)
  - 내놓는 것: 없음

## 할 일

1. Usage restore. In `claude.ts` `replay`, rebuild `totals` (input, output, cache read, cache write, turns) and `cost` from the transcript so that after resume, TUI→GUI toggle and `open_session` the usage matches the whole session. Claude transcripts hold: assistant entries with `message.usage` (the same API message repeats per content block; dedupe by `message.id` plus the entry `requestId` when present), and `cost-state` entries (`{"type":"cost-state","totalCostUSD":…,"modelUsage":{model:{inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens,…}}}`) which the CLI itself uses on resume. `getSessionMessages` may not return non-message entries; check what it returns in the SDK source and pick the source that works (reading the transcript file through the SDK path helpers is fine if the SDK exposes them; do not hard-code `~/.claude`). Cost after resume must not double count with `total_cost_usd` from later `result` messages (see `cost.base`/`cost.last` and `reopen`). Then publish `changed({ usage: usageNow() })`.
2. Empty resume. In `start` (and wherever a `resume` id is opened: toggle start, `open_session`, re-open after `dead`), when the target session has no saved transcript (`getSessionInfo(id, {dir: cwd})` returns nothing, or `getSessionMessages` is empty), open a new session with `sessionId: <that id>` instead of `resume`, skip `replay`, and show no failure. Keep `cli_session` equal to that id so the tracker and `tuiCommand` (`--session-id` path for empty sessions) stay consistent.
3. Add or adjust tests in `claude_test.ts` with fake SDK data for both behaviours (small: one test each).

## 끝남

- `npm run check` passes.
- 위험 test: 없음 beyond the two small tests above.
- 남지 않음: no `TODO`/`FIXME` added.

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
