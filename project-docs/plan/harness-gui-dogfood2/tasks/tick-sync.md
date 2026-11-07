# tick-sync

Running rows (subagents, tools, turns) each start their own 1-second `setInterval` when they mount, so two timers started together tick at different moments. The Claude TUI ticks them together. Make every running-time label tick on the same wall-clock second.

- 단위: chat (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/activity/elapsed.ts`
  - `packages/shell/renderer/conversation/message-list/agent-turn.tsx` (its own tick only)
- 읽을 것: `activity/elapsed.ts` (`useSecondTick`), `message-list/agent-turn.tsx` (`setInterval(..., TICK_MS)`), callers `activity/tool-line.tsx`, `activity/subagent-row.tsx`, `dock/running-card.tsx`, `header/agent-header.tsx` (read only)
- 계약: 없음

## 할 일

1. Align each tick to the wall-clock second without module-level mutable state: first `setTimeout` until the next whole second (`1000 - Date.now() % 1000`, using the injected `now` where the hook has one), then a 1000ms interval. All labels then change on the same second boundary. Do the same for the turn tick in `agent-turn.tsx` if it is a second tick.
2. Keep the signature of `useSecondTick` (add an optional `now` only if needed).

## 끝남

- `npm run check` passes.
- 위험 test: 없음

## 보고

- 바꾼 file
- 통과한 check
- 정한 것
- 넘길 줄
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`, or "없음"
- **알려진 미완 동작**: or "없음"
