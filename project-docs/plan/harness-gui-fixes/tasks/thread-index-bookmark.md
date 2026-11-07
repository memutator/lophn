# thread-index-bookmark

Clicking the bookmark button in the thread index hover card must toggle the bookmark and must not scroll to another message.

- 단위: chat (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/thread-index/thread-index.tsx`
  - `packages/shell/renderer/conversation/thread-index/index-card.tsx`
- 읽을 것:
  - issue: `project-docs/issues/harness-gui.md`, section "thread index card의 bookmark 단추를 누르면 bookmark되지 않고 다른 메시지로 scroll된다"
  - `packages/design/components/overlay/popover/popover.tsx` (renders through a portal; React events still bubble through the React tree)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

1. In `thread-index.tsx`, the rail's `onPointerDown` (`down`) and `onPointerMove` (`move`) ignore events whose target is not inside the rail DOM node (portal content such as the `IndexCard`), e.g. `if (!event.currentTarget.contains(event.target as Node)) return;`. Check `up` too so pointer capture is never taken for card clicks.
2. Check the rail `onWheel` and `onKeyDown` for the same portal bubbling problem and fix it the same way if it applies.

## 끝남

- `npm run check` passes.
- 위험 test: 없음
- (화면) `npm run wireframes` still builds.

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
