# live-throttle

Streamed agent text shows one or two characters and then the whole reply at the end. Fix the live-text throttle so text grows steadily while it streams.

- 단위: chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/message-list/live-message.tsx`
  - `packages/shell/renderer/conversation/message-list/live-message_test.ts` (new, only if needed)
- 읽을 것:
  - `live-message.tsx` (`useThrottledLive`, `LIVE_RENDER_MS`, `LiveMessage`)
  - `packages/shell/renderer/conversation/agent-thread.tsx` (caller; read only)
  - reference (read-only): `/home/pyosechang/projects/harness-lab/omp/omp-desktopapp-nornzach/src/renderer/hooks/use-throttled-text.ts` and `src/renderer/components/chat/StreamingText.tsx`; Codex desktop's frame queue in `/home/pyosechang/projects/harness-lab/codex/derived/codex-desktopapp/app/webview/assets/app-initial-c8dbea294abe.js` around lines 140514-140620 (class `jtn`, `scheduleFlush` returns early if a flush is pending)
- 계약:
  - 쓰는 것: `AcpWriting` as is
  - 내놓는 것: `useThrottledLive(live, now)` keeps its signature

## 할 일

1. Cause (lead's reading, matches both references): `useThrottledLive` clears and re-arms its `setTimeout` in the effect cleanup on every new `live`. With 20ms update batches and renders slower than the remaining wait on a long thread, the pending timer is cancelled every time, so only the first (`fresh`) value shows until `live` becomes null at `message_recorded`.
2. Rewrite it the way nornzach and Codex do: keep the latest `live` in a ref; schedule one `requestAnimationFrame` (fallback timer when rAF is missing) only if none is pending; never cancel it because a new value arrived; in the callback commit the ref's latest value if at least the interval (about 40ms) passed since the last commit, otherwise request the next frame. Cancel only on unmount, and commit immediately on a reset (null, or a different `model_call`), as today.
3. Optional only if small: split the live markdown into finished blocks (memoized) plus a re-parsed tail, as nornzach's `segmentStreamingMarkdown`. Skip and report if it is not small.

## 끝남

- `npm run check` passes.
- 위험 test: "새 값이 interval보다 자주 와도 throttle된 값이 interval마다 최신 값으로 바뀐다" — one small test with fake timers/rAF if the hook can be tested without a DOM; otherwise none and say why.

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
