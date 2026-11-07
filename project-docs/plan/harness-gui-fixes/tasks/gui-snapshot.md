# gui-snapshot

The harness GUI handle keeps a folded `AcpState` instead of every update, sends one snapshot when a view attaches, and batches later updates per tick, so re-attaching (workspace switch) and resume replay render once instead of once per update.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/wiring/extensions.ts`
  - `packages/shell/main/terminal/gui.ts`
  - `packages/shell/main/terminal/gui_test.ts`
  - `packages/shell/ipc/harness-gui.ts`
  - `packages/shell/preload/harness-gui-api.ts`
  - `packages/shell/renderer/terminal/terminal-gui.tsx`
  - `packages/shell/renderer/conversation/agent-tab-gui-source.ts`
- 읽을 것:
  - issue: `project-docs/issues/harness-gui.md`, section "GUI view가 붙을 때 갱신을 처음부터 하나씩 받아 느리고, 지난 대화가 재생하듯 그려진다"
  - architecture: `project-docs/architecture/harness-gui.md` ("지키는 것": handle buffering, GUI view folds from `EMPTY_ACP_STATE`, `reread`), `project-docs/architecture/acp.md`
  - reducer: `packages/protocol/acp/reduce.ts` (`reduceAcp`, `session_reset`, `reread`)
  - renderer data path: `packages/shell/renderer/conversation/agent-tab-data.ts` (`useAgentTabData` reads `source.acp()` at mount and on `source.changed`, then folds `AcpUpdated` events), `packages/shell/renderer/desktop/connection/events/acp-updates-store.ts`
  - reference (read-only): `/home/pyosechang/projects/harness-lab/t3code/t3code-web/apps/server/src/orchestration-v2/ThreadLiveEventCoalescer.ts`, `/home/pyosechang/projects/harness-lab/emdash/emdash-desktopapp/packages/wire/src/live/follower.ts`
- 계약:
  - 쓰는 것: `AcpSessionHandle.publish`, `TabHandle.attach` (`packages/protocol/extensions/acp-session.ts`, do not change it; if you must, report a request)
  - 내놓는 것: the new shape of `HarnessGuiTabApi.connect` and the update channel payload in `packages/shell/ipc/harness-gui.ts` (only this task's files use them)

## 할 일

1. In `createAcp` (`extensions.ts`), replace the `updates: AcpUpdate[]` buffer with a folded `AcpState` (`reduceAcp` from `packages/protocol/acp/mod.ts`, start from `EMPTY_ACP_STATE`). `attach` gives the listener the current state as a snapshot first, then later updates. Raw `writing_streamed` deltas must no longer be retained.
2. In `terminal/gui.ts` `connect`, send the snapshot and then live updates over the update channel. Batch live updates per handle: collect what is published in one tick (e.g. `setImmediate` or a short timer, at most ~50 ms) and send one message with an array. Keep order. Snapshot must arrive before any update of the same attach. A re-connect from the same sender restarts with a fresh snapshot (as today "다시 로드된 창은 처음부터 다시 받는다").
3. Change the IPC payload in `ipc/harness-gui.ts` and the preload `createHarnessGuiTabApi` accordingly (for example `{handle, snapshot?: AcpState, updates: AcpUpdate[]}`); keep the API small.
4. In `terminal-gui.tsx` `createGuiFeed`, accept a snapshot (replace state) and a batch (fold all, then notify watchers and emit events once per batch in the same task so React renders once). If a snapshot arrives after `AgentView` is mounted, make the view re-read it (`agent-tab-gui-source.ts` can expose `changed` for `useAgentTabData`). Since a real snapshot now exists, `reread` can be answered by re-reading the feed state; drop comments that say there is nothing to re-read.
5. Resume replay in adapters publishes many updates synchronously; with step 2 that becomes one batch. Do not change adapters.
6. Update comments in the touched files that describe "쌓인 갱신을 처음부터" behaviour. Do not edit `project-docs/` (lead updates architecture docs).

## 끝남

- `npm run check` passes.
- 위험 test: 없음 (update existing `gui_test.ts` tests that assert the old replay so they match the new behaviour; delete ones that no longer fit the design).
- 남지 않음: `grep -rn "updates.push\|for (const update of updates)" packages/shell/main/desktop/wiring/extensions.ts` is 0 lines.

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
