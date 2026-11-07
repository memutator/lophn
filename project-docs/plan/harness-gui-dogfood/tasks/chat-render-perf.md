# chat-render-perf

Typing in the chat composer lags, and streamed agent text appears one or two characters and then the whole reply at once at the end. Find the causes and fix them (harness GUI first; the screen is shared with lophn agent tabs).

- 단위: chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/agent-tab-data.ts`
  - `packages/shell/renderer/conversation/live-text.ts`
  - `packages/shell/renderer/conversation/drafts.ts`
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`
  - `packages/shell/renderer/conversation/composer/use-draft-fill.ts`
  - `packages/shell/renderer/terminal/terminal-gui.tsx`
  - `packages/shell/renderer/desktop/connection/events/acp-updates-store.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/harness-gui.md` (handle snapshot + 20ms batches, feed `apply`), `project-docs/architecture/agent-chat.md`
  - main side batching: `packages/shell/main/terminal/gui.ts` (`UPDATE_BATCH_MS`), Claude deltas: `packages/shell/main/extensions/bundled/harness-gui/claude.ts` (`writing_streamed` from `content_block_delta`), reducer `packages/protocol/acp/reduce.ts` (`writing_streamed`, `reread`)
- 계약:
  - 쓰는 것: ACP as is
  - 내놓는 것: 없음

## 할 일

1. Typing lag. Lead's reading: `AgentView` subscribes to the whole `DraftStore` (`useSyncExternalStore(drafts.subscribe, drafts.version)`), so every keystroke re-renders the view, and `AgentThread` is not memoized, so the whole thread (layout, markdown) re-renders per keystroke. Confirm (React Profiler-style reasoning or a quick count is fine), then fix with the smallest change: keep the composer's draft state from re-rendering the thread (memoize `AgentThread` with stable props, or subscribe only the composer to its draft).
2. Streaming. Trace why text shows a couple of characters then jumps to the full reply. Check, in order: whether Claude's adapter publishes `writing_streamed` per delta with correct `offset`/`model_call`; whether the 20ms batching and the feed deliver them; whether the folded `writing` reaches the screen (`agent-tab-data.ts`, `live-text.ts`), or a `reread`/offset mismatch drops the stream until `message_recorded`. Compare with lophn agent tabs. Fix it in owned files. If the cause is in an adapter or main file (not owned), do not edit; report the exact cause and the fix.
3. Keep the diff small; no virtualization.

## 끝남

- `npm run check` passes.
- 위험 test: 없음

## 보고

- 바꾼 file
- 통과한 check
- 원인: lag과 streaming 각각 무엇이었나(근거 file과 줄)
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`, or "없음"
- **알려진 미완 동작**: or "없음"
