# event-fanout

watch 하나가 바뀔 때 모든 창이 snapshot을 다시 읽는 것을 막고, `AcpUpdated`를 gateway가 session으로 거르게 하고, renderer의 ACP log가 끝없이 자라지 않게 한다.

- 단위: events (wave 1)
- 선행: session-list. `agent-tab-data.ts` 주변을 같이 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/events/transient.ts` (`AcpUpdated` envelope에 `session`)
  - `packages/core/events/gateway.ts`, `packages/core/events/gateway_test.ts`
  - `packages/shell/main/desktop/core/events.ts`
  - `packages/shell/main/desktop/core/connection.ts`
  - `packages/shell/renderer/desktop/connection/events/client.ts`
  - `packages/shell/renderer/desktop/connection/events/store.ts`
  - `packages/shell/renderer/desktop/connection/events/acp-updates-store.ts`
  - 추가 소유: `AcpUpdated`를 내거나 받는 곳의 그 줄만 — `packages/core/main/daemon/wiring/acp.ts`, `packages/shell/ipc/app-agent.ts`, `packages/shell/main/app-frame/app-agent.ts`, `packages/shell/main/desktop/wiring/app-calls.ts`, `packages/shell/renderer/conversation/agent-tab-core-source.ts`, `agent-tab-source.ts`, `agent-tab-data.ts`, `packages/shell/renderer/terminal/terminal-gui.tsx`
- 읽을 것:
  - `project-docs/architecture/`의 events topic
  - `shell/main/desktop/core/events.ts` 224-231행, `core/events/gateway.ts` 70-95행, `shell/main/desktop/core/connection.ts` 124-128·170행, `renderer/.../events/store.ts` 63행, `events/client.ts` 140-149행
  - `protocol/events/transient.ts` 147-151행, `acp-updates-store.ts` 48-60행
- 계약:
  - 쓰는 것: events gateway protocol(`watch`, `ready`)
  - 내놓는 것: `AcpUpdated`의 envelope에 `session`(구독 조건으로 거를 수 있음)

## 할 일

1. **watch 하나에 전체 재조회** — 조건이 새로 생기거나 없어질 때마다 `watch` frame이 가고, server가 매번 `ready`로 답하고, main이 그 `ready`를 모든 창에 넘기고, 모든 `syncOnReady` 구독자가 `read()`를 다시 돈다. server는 동기로 다시 구독하므로 기존 구독자는 event를 잃지 않는다. 그 사이 연결이 끊긴 적이 없으면 `ready`를 새 구독자에게만 넘긴다(끊겼다 붙은 뒤의 `ready`는 지금처럼 모두에게). 어디서 거를지(main relay냐 renderer client냐)는 가장 작은 쪽을 고르고 보고에 적는다.
2. **AcpUpdated 거르기** — envelope에 top-level `session`을 넣어 gateway가 구독 조건으로 거르게 한다. renderer는 `{types:["AcpUpdated"], session}`으로 구독하고 client 쪽 거르기를 지운다. 다른 소비자(app-agent, app-calls, terminal-gui)도 맞춘다.
3. **log 자람** — `acp-updates-store.ts`의 session별 `log` 배열이 tab이 살아 있는 동안 끝없이 자라고 `ready`에도 비지 않는다. re-sync(`ready`) 뒤에 비우거나 snapshot 이후 것만 남긴다.

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음(성능). gateway에 기존 거르기 test가 있으면 `session` 조건 한 줄을 더한다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
